import { config, llmEnabled } from '../config.js';

/**
 * 可选的大模型接入（兼容 OpenAI Chat Completions 协议：通义千问、DeepSeek、文心、Kimi 等均可）。
 * 未配置或调用失败时返回 null，由调用方回退到规则引擎。
 */
export async function chat(messages, { temperature = 0.3, maxTokens = 900 } = {}) {
  if (!llmEnabled()) return null;
  try {
    const res = await post(messages, { temperature, maxTokens }, AbortSignal.timeout(config.llm.timeoutMs));
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn(`[llm] 调用失败，回退规则引擎：${err.message}`);
    return null;
  }
}

/**
 * 流式调用（stream: true，解析 SSE 增量）。正式回答逐段回调 onDelta(text)，
 * 思考链（DeepSeek 等返回的 delta.reasoning_content）逐段回调 onReasoning(text)。
 * thinking 为 true / false 时显式开关深度思考（仅对支持该参数的服务发送），undefined 时沿用 LLM_EXTRA_BODY。
 * 返回 { text, reasoning, error }：error 为中途失败的原因（成功时为 null）。
 * signal 用于客户端断开时中止上游请求，避免继续消耗 token。
 */
export async function chatStream(messages, { temperature = 0.3, maxTokens = 900, thinking, onDelta = () => {}, onReasoning = () => {}, signal } = {}) {
  if (!llmEnabled()) return { text: '', reasoning: '', error: 'disabled' };
  let text = '';
  let reasoning = '';
  try {
    const timeout = AbortSignal.timeout(thinking ? config.llm.thinkingTimeoutMs : config.llm.timeoutMs);
    const res = await post(messages, { temperature, maxTokens, thinking, stream: true }, signal ? AbortSignal.any([signal, timeout]) : timeout);
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return { text: text.trim(), reasoning: reasoning.trim(), error: null };
        let d;
        try {
          d = JSON.parse(payload).choices?.[0]?.delta || {};
        } catch {
          continue;
        }
        let r = d.reasoning_content || '';
        if (r) {
          if (!reasoning) r = r.replace(/^\s+/, '');
          if (r) {
            reasoning += r;
            onReasoning(r);
          }
        }
        let delta = d.content || '';
        if (delta) {
          // 去掉开头的空白，避免气泡首行空一格
          if (!text) delta = delta.replace(/^\s+/, '');
          if (!delta) continue;
          text += delta;
          onDelta(delta);
        }
      }
    }
    return { text: text.trim(), reasoning: reasoning.trim(), error: null };
  } catch (err) {
    if (!signal?.aborted) console.warn(`[llm] 流式调用失败：${err.message}`);
    return { text: text.trim(), reasoning: reasoning.trim(), error: signal?.aborted ? 'aborted' : err.message };
  }
}

async function post(messages, { temperature, maxTokens, thinking, stream = false }, signal) {
  const body = { model: config.llm.model, messages, temperature, max_tokens: maxTokens, ...(stream ? { stream: true } : {}), ...config.llm.extraBody };
  if (config.llm.thinking && typeof thinking === 'boolean') {
    body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    // 思考模式不支持 temperature（会被忽略），直接不发送
    if (thinking) delete body.temperature;
  }
  const res = await fetch(config.llm.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    // 只记录地址的域名与路径（不含查询参数，避免泄露放在 URL 里的密钥）和响应摘要，便于排查配置错误
    const u = new URL(config.llm.url);
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`HTTP ${res.status}（${u.origin}${u.pathname}）${text}`);
  }
  return res;
}

/** 精简的事实摘要，作为大模型上下文（控制 token，避免幻觉：只提供结构化事实） */
export function factSheet(result) {
  const { name, address, score, access, blind, siting, isochrone, diagnosis } = result;
  const profiles = result.profiles || [];
  return {
    社区: name,
    地址: address,
    口径: `步行 ${result.params?.minutes ?? 15} 分钟；盲区判定为步行 ${result.params?.threshold ?? 1000} 米内无该类设施`,
    综合评分: `${score.total}（${score.grade}）`,
    维度得分: Object.fromEntries(score.dimensions.map((d) => [d.name, d.score])),
    人群视角评分: {
      成年人: score.total,
      ...(result.elderlyScore ? { 老年人: result.elderlyScore.total } : {}),
      ...(result.childScore ? { 亲子: result.childScore.total } : {}),
      说明: '老年人视角加重医疗、养老、休闲权重，亲子视角加重基础教育、休闲、医疗权重，并各自使用该人群步速',
    },
    可达面积_km2: Object.fromEntries(Object.entries(isochrone.metrics.areas).map(([k, v]) => [k, +(v / 1e6).toFixed(2)])),
    直线画圆高估比例: `${isochrone.metrics.circleOverestimate}%`,
    各类设施: access.map((a) => ({
      类别: a.name,
      圈内数量: Object.fromEntries(profiles.map((p) => [p.name, a.inCircle[p.key] ?? 0])),
      // 各人群步行时间都给出，避免模型用成年人时间代答老人或儿童的问题
      最近: a.nearest ? `${a.nearest.name} 步行${a.nearest.walk}米 ${profiles.map((p) => `${p.name}${a.nearest.minutes[p.key] ?? '-'}分钟`).join(' ')}` : '无',
    })),
    盲区口径: '步行（真实路网）1 公里内没有该类设施即为盲区；隐性盲区 = 直线 1 公里内有、实际步行超过 1 公里',
    盲区: Object.values(blind.categories).map((c) => ({
      类别: c.name,
      有盲区的小区: `${c.residentialBlind.length}/${c.residentialTotal ?? '-'}`,
      其中隐性盲区小区: c.residentialHidden ?? 0,
      按面积盲区占比: `${(c.blindRatio * 100).toFixed(1)}%`,
      直线口径面积占比: c.straightBlindRatio === undefined ? '-' : `${(c.straightBlindRatio * 100).toFixed(1)}%`,
    })),
    // 逐个小区的盲区详情（缺失多者在前），便于回答「哪些小区」「最近的在哪、要走多远」
    盲区小区详情: (blind.residential || [])
      .filter((r) => r.missing.length)
      .slice(0, 10)
      .map((r) => ({
        小区: r.name,
        缺失: r.missing
          .map((k) => r.cats[k])
          .map((d, i) => {
            const name = blind.categories[r.missing[i]].name;
            const dist = Number.isFinite(d.net)
              ? `最近「${d.nearest || '未知'}」步行 ${d.net} 米`
              : d.nearest
                ? `最近「${d.nearest}」直线已 ${d.straight} 米`
                : '附近无';
            return `${name}（${dist}${d.hidden ? '，隐性盲区' : ''}）`;
          }),
      })),
    选址建议: siting.map((s) => ({ 类别: s.name, 位置: s.sites[0]?.description || s.sites[0]?.address, 可消除盲区需求: `${s.reduction}%` })),
    规则诊断: diagnosis.summary,
  };
}

export async function polishReport(result) {
  const facts = factSheet(result);
  return chat([
    {
      role: 'system',
      content:
        `你是城市规划与社区治理专家。请基于用户提供的结构化体检数据，撰写一份面向街道办的「${result.params?.minutes ?? 15} 分钟生活圈体检报告」，` +
        '包含：总体结论、突出优势、主要短板与服务盲区、适老化与亲子友好评估、分优先级的改造建议。要求：只使用给定数据，不编造数字；' +
        '语言专业简洁，600 字以内，使用 Markdown 小标题。',
    },
    { role: 'user', content: JSON.stringify(facts) },
  ]);
}
