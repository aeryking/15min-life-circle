import { CATEGORY_MAP } from './categories.js';
import { chat, chatStream, factSheet } from './llm.js';
import { config, llmEnabled } from '../config.js';

/**
 * 生活圈智能问答（多轮）。
 * - 已配置大模型：结构化事实 + 最近几轮对话作为上下文回答，并由规则引擎补充可在地图上定位的设施；
 * - 未配置：基于意图识别的规则引擎，所有回答均来自体检数据；追问时继承上一轮的设施类别与意图。
 */

/** 送入大模型的历史轮数（一问一答为一轮） */
const HISTORY_TURNS = 6;

const ALIASES = [
  ['market', /(菜市场|买菜|生鲜|农贸|菜场|果蔬)/],
  ['pharmacy', /(药店|药房|买药|药)/],
  ['primary_school', /(小学|上学|读书|学校)/],
  ['kindergarten', /(幼儿园|托儿|入园)/],
  ['clinic', /(医院|看病|诊所|社区医疗|卫生|就医|医疗)/],
  ['elderly', /(养老|驿站|日间照料|老年活动|敬老)/],
  ['supermarket', /(超市|便利店|购物|日用品)/],
  ['transit', /(公交|地铁|出行|通勤|车站)/],
  ['park', /(公园|锻炼|运动|健身|散步|体育)/],
];

export async function answer(result, question, history = []) {
  const q = clean(question);
  const rule = ruleAnswer(result, q, history);
  if (!llmEnabled()) return { ...rule, mode: 'rules' };
  const text = await chat(llmMessages(result, q, history), { maxTokens: 400 });
  return text ? { answer: text, highlights: rule.highlights, mode: 'llm', model: config.llm.model } : { ...rule, mode: 'rules' };
}

/**
 * 流式问答：先回调 onMeta({ mode, highlights })，随后逐段 onDelta(text)，最终返回完整回答。
 * - 未配置大模型：规则引擎回答一次性输出；
 * - 大模型在输出第一个字之前失败：回退规则引擎回答；
 * - 中途断开：保留已生成的部分并注明中断。
 */
export async function answerStream(
  result,
  question,
  history = [],
  { thinking = false, onMeta = () => {}, onDelta = () => {}, onReasoning = () => {}, signal } = {},
) {
  const q = clean(question);
  const rule = ruleAnswer(result, q, history);
  const fallback = () => {
    onMeta({ mode: 'rules', highlights: rule.highlights });
    onDelta(rule.answer);
    return { ...rule, mode: 'rules' };
  };
  if (!llmEnabled()) return fallback();
  const think = Boolean(thinking && config.llm.thinking);
  const t0 = Date.now();
  let thinkingMs = null;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    onMeta({ mode: 'llm', model: config.llm.model, thinking: think, highlights: rule.highlights });
  };
  const { text, reasoning, error } = await chatStream(llmMessages(result, q, history), {
    // 思考链可能计入输出上限，开启思考时放宽，避免正式回答被截断
    maxTokens: think ? 8192 : 400,
    thinking: config.llm.thinking ? think : undefined,
    signal,
    onReasoning: (t) => {
      start();
      onReasoning(t);
    },
    onDelta: (t) => {
      start();
      if (thinkingMs === null && think) thinkingMs = Date.now() - t0;
      onDelta(t);
    },
  });
  const extra = think ? { reasoning, thinkingMs: thinkingMs ?? Date.now() - t0 } : {};
  if (!text) return error === 'aborted' ? { ...rule, mode: 'rules', aborted: true } : fallback();
  if (error && error !== 'aborted') {
    const note = '\n\n（大模型连接中断，以上为部分回答）';
    onDelta(note);
    return { answer: text + note, highlights: rule.highlights, mode: 'llm', model: config.llm.model, ...extra };
  }
  return { answer: text, highlights: rule.highlights, mode: 'llm', model: config.llm.model, ...extra, aborted: error === 'aborted' };
}

const clean = (question) =>
  String(question || '')
    .trim()
    .slice(0, 300);

function llmMessages(result, q, history) {
  const minutes = result.params?.minutes ?? 15;
  const past = history.slice(-HISTORY_TURNS * 2).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  return [
    {
      role: 'system',
      content:
        `你是「${minutes} 分钟生活圈」体检助手。只根据下面的体检数据回答居民或规划人员的问题，数据中没有的信息要明确说明，不编造数字。` +
        '结合上下文理解追问（如「那老人呢」「第二个呢」）。回答简洁，150 字以内。' +
        '使用纯文本，不要使用 Markdown 符号（如 **、#、表格），分点时用「1. 2. 3.」。思考过程与回答都使用中文。\n\n' +
        `体检数据：${JSON.stringify(factSheet(result))}`,
    },
    ...past,
    { role: 'user', content: q },
  ];
}

const PROFILE_RE = { elderly: /(老人|老年|长辈|爷爷|奶奶|姥姥|姥爷|适老)/, child: /(孩子|小孩|儿童|亲子|娃)/, adult: /(成年人|年轻人|上班族|成人)/ };
const INTENTS = [
  ['plan', /(建议|规划|选址|建在|新增|补齐|先补|补哪|补什么|改造|怎么办|优先)/],
  ['blind', /(盲区|缺|没有|不足|短板)/],
  ['score', /(评分|得分|分数|打分|为什么)/],
  ['area', /(面积|范围|多大|等时圈|能走到)/],
];

/** 解析单句问题：设施类别、人群、意图（均可能为空） */
function parse(q) {
  return {
    cats: ALIASES.filter(([, re]) => re.test(q)).map(([k]) => k),
    profile: Object.keys(PROFILE_RE).find((k) => PROFILE_RE[k].test(q)) || null,
    intent: INTENTS.find(([, re]) => re.test(q))?.[0] || null,
  };
}

/**
 * 结合上下文解析：当前问题没有提到设施类别和意图时（如「那老人呢」「走路要多久」），
 * 继承最近一轮有明确主题的提问；人群未提及时沿用上一轮的人群。
 */
function parseWithContext(q, history) {
  const cur = parse(q);
  const prev = history
    .filter((m) => m.role === 'user')
    .map((m) => parse(m.text))
    .reverse();
  const topic = !cur.cats.length && !cur.intent ? prev.find((p) => p.cats.length || p.intent) : null;
  return {
    cats: topic ? topic.cats : cur.cats,
    intent: topic ? topic.intent : cur.intent,
    profile: cur.profile || prev.find((p) => p.profile)?.profile || null,
    followUp: Boolean(topic),
  };
}

export function ruleAnswer(result, q, history = []) {
  const { access, blind, siting, score, isochrone, profiles } = result;
  const minutes = result.params?.minutes ?? 15;
  const ctx = parseWithContext(q, history);
  const { cats, intent } = ctx;
  const profile = ctx.profile || 'adult';
  const elderlyAsk = profile === 'elderly';
  const childAsk = profile === 'child';
  const pName = profiles.find((p) => p.key === profile)?.name || '成年人';
  const highlights = [];

  if (intent === 'plan') {
    if (!siting.length) return { answer: '当前生活圈内未发现需要补点的关键设施盲区，建议关注设施品质与适老化改造。', highlights };
    const lines = siting.map((s) => {
      const t = s.sites[0];
      highlights.push({ lng: t.lng, lat: t.lat, name: `建议新增${s.short}` });
      return `· ${s.name}：建议在「${t.description || t.address}」附近新增，可消除约 ${s.reduction}% 的盲区需求。`;
    });
    return { answer: `根据最大覆盖选址模型，优先建议：\n${lines.join('\n')}`, highlights };
  }

  if (intent === 'blind' && !cats.length) {
    const lines = Object.values(blind.categories).map((c) => {
      const res = c.residentialBlind.length
        ? `${c.residentialBlind.length} 个小区（${c.residentialBlind
            .slice(0, 3)
            .map((r) => r.name)
            .join('、')}${c.residentialBlind.length > 3 ? ' 等' : ''}）${c.residentialHidden ? `，其中 ${c.residentialHidden} 个为隐性盲区` : ''}`
        : '无小区';
      for (const r of c.residentialBlind.slice(0, 3)) highlights.push({ lng: r.lng, lat: r.lat, name: `${r.name}（缺${c.name}）` });
      return `· ${c.name}：${res}；按面积计 ${(c.blindRatio * 100).toFixed(1)}%`;
    });
    return {
      answer: `按「真实步行 1 公里内」口径识别的服务盲区：\n${lines.join('\n')}\n\n隐性盲区指直线 1 公里内有设施、但实际要绕路走超过 1 公里的小区，按直线画圈的传统评估发现不了。`,
      highlights,
    };
  }

  if (intent === 'score') {
    // 问到老人 / 孩子时给该人群视角的评分；否则给综合评分，并附上三类人群视角的对照
    const ps = { elderly: result.elderlyScore, child: result.childScore }[profile];
    const s = ps || score;
    const dims = s.dimensions.map((d) => `${d.name} ${d.score}${d.weight && d.weight !== 1 ? `（权重 ×${d.weight}）` : ''}`).join('，');
    const title = ps ? `${pName}视角评分` : '综合评分';
    const views = [
      result.elderlyScore ? `老年人视角 ${result.elderlyScore.total} 分` : '',
      result.childScore ? `亲子视角 ${result.childScore.total} 分` : '',
    ].filter(Boolean);
    const tail = ps
      ? `该视角按${pName}步速计算步行时间，并调整六维权重。`
      : views.length
        ? `人群视角：${views.join('，')}（按各自步速计算，并调整六维权重）。`
        : '';
    return {
      answer: `${title} ${s.total} 分（${s.grade}）= 55% 维度${ps ? '加权' : ''}均分 ${s.components.dimensions} + 30% 盲区覆盖率 ${s.components.coverage} + 15% 类别完整度 ${s.components.completeness}。各维度：${dims}。${tail}`,
      highlights,
    };
  }

  if (intent === 'area' && !cats.length) {
    const areas = profiles.map((p) => `${p.name} ${(isochrone.metrics.areas[p.key] / 1e6).toFixed(2)} km²`).join('，');
    return { answer: `基于真实步行路网的 ${minutes} 分钟可达面积：${areas}；直线画圆会高估 ${isochrone.metrics.circleOverestimate}%。`, highlights };
  }

  const targets = cats.length ? cats : elderlyAsk ? ['clinic', 'pharmacy', 'market', 'elderly'] : childAsk ? ['kindergarten', 'primary_school', 'park'] : [];
  if (targets.length) {
    const lines = targets.map((key) => {
      const a = access.find((x) => x.key === key);
      if (!a?.nearest) return `· ${CATEGORY_MAP[key].name}：检索范围内暂未发现。`;
      highlights.push({ lng: a.nearest.lng, lat: a.nearest.lat, name: a.nearest.name });
      const min = a.nearest.minutes[profile] ?? a.nearest.minutes.adult;
      const ok = min <= minutes ? '✅' : '⚠️';
      return `${ok} ${a.name}：最近「${a.nearest.name}」，步行 ${a.nearest.walk} 米，${pName}约 ${min} 分钟${a.nearest.measured ? '（实测）' : '（估算）'}；${minutes} 分钟圈内共 ${a.inCircle[profile] ?? a.inCircle.adult} 处。`;
    });
    const lead = ctx.followUp ? `接着上一个问题，按${pName}步速：\n` : '';
    return { answer: lead + lines.join('\n'), highlights };
  }

  const top = [...score.categories].sort((a, b) => a.score - b.score)[0];
  return {
    answer: `${result.diagnosis.summary}\n\n您可以这样问我：「老人看病方便吗」「最近的菜市场在哪」「药店盲区涉及哪些小区」「应该在哪里新增${CATEGORY_MAP[top.key]?.short || '设施'}」。`,
    highlights,
  };
}

export const SUGGESTED_QUESTIONS = ['老人看病、买药方便吗？', '最近的菜市场在哪？', '哪些小区是服务盲区？', '应该在哪里新增设施？', '综合评分是怎么算的？'];
