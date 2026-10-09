<template>
  <div class="chat">
    <div class="mode muted small">
      <span
        class="chip"
        :class="state.config.llm ? 'brand' : ''"
        :title="
          state.config.llm
            ? `由大模型 ${state.config.llmModel || ''} 基于本次体检数据生成回答`
            : '未配置大模型（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），由规则引擎回答'
        "
      >
        {{ state.config.llm ? '大模型模式' : '规则引擎模式' }}
      </span>
      <span v-if="state.config.llm" class="grow">回答仅基于本次体检数据，支持追问；对话只有你自己可见。</span>
      <span v-else class="grow">未接入大模型，按固定规则从本次体检数据中查找并组织回答，话术较固定；支持追问，对话只有你自己可见。</span>
      <button v-if="messages.length" class="btn sm ghost" :disabled="loading" title="清空这份报告下的对话" @click="reset">新对话</button>
    </div>
    <div ref="list" class="msgs scroll">
      <div class="msg bot">
        <div class="who" :title="sourceTitle({})">
          <span class="avatar" :class="{ rules: isRules({}) }">{{ isRules({}) ? '规' : 'AI' }}</span>
          {{ currentModel }}
        </div>
        <div class="bubble">{{ greeting }}</div>
      </div>
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div v-if="m.role === 'bot'" class="who" :title="sourceTitle(m)">
          <span class="avatar" :class="{ rules: isRules(m) }">{{ isRules(m) ? '规' : 'AI' }}</span>
          {{ modelLabel(m) }}
        </div>
        <div v-if="m.reasoning" class="think" :class="{ open: m.showReasoning }">
          <button type="button" class="think-head" @click="m.showReasoning = !m.showReasoning">
            <span v-if="m.thinkingLive" class="spinner" aria-hidden="true"></span>
            <BrainIcon v-else />
            {{ m.thinkingLive ? '深度思考中…' : `已深度思考（用时 ${((m.thinkingMs || 0) / 1000).toFixed(1)} 秒）` }}
            <span class="arrow">{{ m.showReasoning ? '收起' : '展开' }}</span>
          </button>
          <div v-if="m.showReasoning" class="think-body" v-text="m.reasoning"></div>
        </div>
        <div
          v-if="m.role === 'user' || m.text || !m.reasoning"
          class="bubble"
          :class="{ streaming: m.streaming && !m.thinkingLive }"
          v-text="plain(m.text)"
        ></div>
        <!-- 定位做成独立按钮：气泡只负责显示文字，拖选复制时不会误触发地图定位 -->
        <button v-if="m.role === 'bot' && m.highlights?.length && !m.streaming" type="button" class="locate" @click="state.highlights = m.highlights">
          📍 在地图上标出 {{ m.highlights.length }} 处
        </button>
      </div>
      <div v-if="loading && !streaming" class="msg bot">
        <div class="who">
          <span class="avatar">AI</span>
          {{ currentModel }}
        </div>
        <div class="bubble muted">思考中…</div>
      </div>
    </div>
    <div class="suggest">
      <button v-for="q in state.config.suggestedQuestions" :key="q" class="chip" @click="ask(q)">{{ q }}</button>
    </div>
    <form class="composer" :class="{ focus: focused }" @submit.prevent="ask(input)">
      <textarea
        v-model="input"
        class="composer-input"
        rows="2"
        placeholder="问问这个社区，例如：孩子上学要走多久？"
        @focus="focused = true"
        @blur="focused = false"
        @keydown.enter.exact.prevent="!composing && ask(input)"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      ></textarea>
      <div class="composer-bar">
        <button
          v-if="state.config.llmThinking"
          type="button"
          class="pill"
          :class="{ on: thinking }"
          :aria-pressed="thinking"
          title="开启后模型会先推理再回答，并展示思考过程；回答更深入，但需要多等几秒"
          @click="thinking = !thinking"
        >
          <BrainIcon />
          深度思考
        </button>
        <span class="grow"></span>
        <button class="send" :disabled="!input.trim() || loading" title="发送（Enter）；Shift + Enter 换行" aria-label="发送">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </form>
    <p class="disclaimer">AI 回答可能会出错，仅供参考。</p>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount, h } from 'vue';
import { state } from '../../store.js';
import { api, askStream } from '../../api.js';

/** 「深度思考」图标：单色线条大脑（左右半脑 + 中线 + 脑回），随文字颜色着色 */
const BRAIN_PATHS = [
  'M12 5.5C11.2 4 8.6 3.6 7.6 5.6C5.4 5.4 4 7.4 4.7 9.4C3.2 10.4 3.2 13 4.8 13.9C4.2 16.2 6 18.2 8.2 17.7C8.9 19.6 11.2 19.9 12 18.5',
  'M12 5.5C12.8 4 15.4 3.6 16.4 5.6C18.6 5.4 20 7.4 19.3 9.4C20.8 10.4 20.8 13 19.2 13.9C19.8 16.2 18 18.2 15.8 17.7C15.1 19.6 12.8 19.9 12 18.5',
  'M12 5.5V18.5',
  'M7.8 9.2C8.9 9.1 9.8 9.9 9.9 11',
  'M6.6 13.6C7.8 12.9 9.3 13.3 9.9 14.5',
  'M16.2 9.2C15.1 9.1 14.2 9.9 14.1 11',
  'M17.4 13.6C16.2 12.9 14.7 13.3 14.1 14.5',
];
const BrainIcon = () =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: 16,
      height: 16,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    BRAIN_PATHS.map((d) => h('path', { d })),
  );

const input = ref('');
const loading = ref(false);
const streaming = ref(false);
let controller = null;
const list = ref(null);
const messages = ref([]);

// 深度思考开关：默认关闭（秒级回答），每次打开页面都从关闭开始
const thinking = ref(false);
const focused = ref(false);
// 中文输入法选词时按回车不应发送
const composing = ref(false);

/** 回答来源：大模型显示模型名（随消息保存，换模型后历史仍准确），规则引擎显示「规则引擎」 */
const currentModel = computed(() => state.config.llmModel || '规则引擎');
/** 是否为规则引擎回答：消息已标明来源时按标明的；尚未标明（问候语、刚开始生成）时按当前是否接入大模型判断 */
const isRules = (m) => (m.mode ? m.mode === 'rules' : !state.config.llm);
const sourceTitle = (m) => (isRules(m) ? '由规则引擎根据本次体检数据生成' : '由大模型基于本次体检数据生成');
const modelLabel = (m) => (m.mode === 'llm' ? m.model || state.config.llmModel || '大模型' : m.mode === 'rules' ? '规则引擎' : currentModel.value);

/** 以纯文本显示回答：去掉大模型偶尔输出的 Markdown 强调与标题符号（不以 HTML 渲染，避免注入） */
const plain = (t) =>
  String(t || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '');
const greeting = computed(
  () => `你好！我已完成「${state.result.name}」的生活圈体检，可以回答设施可达、服务盲区、适老化与补点规划的问题，也可以接着追问，例如「那老人呢」。`,
);

// 对话按「访客 × 报告编号」保存在服务端：切换报告或刷新页面后自动恢复
let loadSeq = 0;
async function load() {
  const id = state.result?.id;
  const seq = ++loadSeq;
  // 切换报告时中止进行中的回答（服务端随之中止大模型请求，不再消耗 token）
  controller?.abort();
  messages.value = [];
  if (!id) return;
  try {
    const res = await api.chat(id);
    if (seq === loadSeq) messages.value = res.messages;
  } catch {
    // 读取失败时从空对话开始，不影响提问
  }
  scroll();
}
watch(() => state.result?.id, load, { immediate: true });
onBeforeUnmount(() => controller?.abort());

async function reset() {
  await api.clearChat(state.result.id);
  messages.value = [];
  state.highlights = [];
}

async function ask(q) {
  q = String(q || '').trim();
  if (!q || loading.value) return;
  const id = state.result.id;
  messages.value.push({ role: 'user', text: q });
  input.value = '';
  loading.value = true;
  await scroll();
  controller = new AbortController();
  let bot = null;
  const typer = createTyper();
  // 首段文字到达时才创建回答气泡，之前显示「思考中…」
  const ensureBot = () => {
    if (!bot) {
      bot = messages.value[messages.value.push({ role: 'bot', text: '', streaming: true }) - 1];
      streaming.value = true;
    }
    return bot;
  };
  try {
    const res = await askStream(id, q, {
      thinking: thinking.value && state.config.llmThinking,
      signal: controller.signal,
      onReasoning: (t) => {
        const b = ensureBot();
        if (!b.reasoning) Object.assign(b, { reasoning: '', thinkingLive: true, showReasoning: true, t0: performance.now() });
        b.reasoning += t;
        scrollSoon();
      },
      onMeta: (m) => {
        const b = ensureBot();
        b.mode = m.mode;
        b.model = m.model;
        b.highlights = m.highlights;
        if (m.highlights?.length) state.highlights = m.highlights;
      },
      onDelta: (t) => {
        const b = ensureBot();
        // 正式回答开始：思考区自动收起并记下用时
        if (b.thinkingLive) Object.assign(b, { thinkingLive: false, showReasoning: false, thinkingMs: performance.now() - b.t0 });
        typer.push(b, t);
      },
    });
    await typer.drain();
    Object.assign(ensureBot(), { text: res.answer, highlights: res.highlights, mode: res.mode, model: res.model, thinkingLive: false });
    if (res.thinkingMs) bot.thinkingMs = res.thinkingMs;
  } catch (err) {
    typer.stop();
    if (err.name === 'AbortError') return;
    const b = ensureBot();
    b.text = b.text ? `${b.text}\n\n（连接中断：${err.message}）` : `抱歉，出错了：${err.message}`;
  } finally {
    if (bot) Object.assign(bot, { streaming: false, thinkingLive: false });
    streaming.value = false;
    loading.value = false;
    scroll();
  }
}

/**
 * 平滑输出：网络分包常常一次带来十几段文字，先入队再逐帧释放。
 * 按时间释放：每帧放出「距上一帧时间 / 130 ms」比例的积压（至少 1 个字），与帧率无关，
 * 积压越多释放越快，最多落后约 130 ms，不会刻意拖慢回答。
 */
function createTyper() {
  let pending = '';
  let target = null;
  let raf = 0;
  let last = 0;
  const step = (now) => {
    raf = 0;
    if (!pending || !target) return;
    const dt = last ? now - last : 16;
    last = now;
    const n = Math.max(1, Math.ceil(pending.length * Math.min(1, dt / 130)));
    target.text += pending.slice(0, n);
    pending = pending.slice(n);
    scrollSoon();
    if (pending) raf = requestAnimationFrame(step);
    else last = 0;
  };
  return {
    push(b, t) {
      target = b;
      pending += t;
      if (!raf) raf = requestAnimationFrame(step);
    },
    drain: () =>
      new Promise((resolve) => {
        const check = () => (pending ? requestAnimationFrame(check) : resolve());
        check();
      }),
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (target && pending) target.text += pending;
      pending = '';
    },
  };
}

// 流式输出期间按帧合并滚动；用户向上翻看历史时不强制拉回底部
let frame = 0;
function scrollSoon() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const el = list.value;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
    // 思考区有独立的滚动高度，思考进行中保持显示最新内容
    const think = el?.querySelector('.msg:last-child .think-body');
    if (think) think.scrollTop = think.scrollHeight;
  });
}

async function scroll() {
  await nextTick();
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
}
</script>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 460px;
}

.small {
  font-size: 12px;
}

.mode {
  display: flex;
  gap: 6px;
  align-items: center;
}

.msgs {
  flex: 1;
  min-height: 260px;
  max-height: 52vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}

.msg {
  display: flex;
}

.msg.user {
  justify-content: flex-end;
}

.msg.bot {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.who {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.avatar {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--on-brand);
  font-size: 10px;
  font-weight: 700;
}

.avatar.rules {
  background: var(--surface-3);
  color: var(--text-secondary);
}

.think {
  max-width: 88%;
  font-size: 12px;
}

.think-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-2);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.think-head .arrow {
  color: var(--text-muted);
}

.think-body {
  margin-top: 6px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--border);
  color: var(--text-muted);
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 220px;
  overflow-y: auto;
}

.spinner {
  width: 11px;
  height: 11px;
  border: 2px solid var(--brand-soft);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 2px 10px rgb(15 23 42 / 6%);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.composer.focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.composer-input {
  width: 100%;
  min-height: 40px;
  max-height: 120px;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
}

.composer-input::placeholder {
  color: var(--text-muted);
}

.composer-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}

.pill:hover {
  border-color: var(--brand);
}

.pill.on {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand-strong);
  font-weight: 600;
}

.send {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--brand);
  color: var(--on-brand);
  cursor: pointer;
}

.send:disabled {
  background: var(--surface-3);
  color: var(--text-muted);
  cursor: not-allowed;
}

.disclaimer {
  margin: -4px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
}

.bubble {
  max-width: 88%;
  white-space: pre-wrap;
  line-height: 1.65;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--surface-3);
}

.msg.user .bubble {
  background: var(--brand);
  color: var(--on-brand);
  border-bottom-right-radius: 4px;
}

.msg.bot .bubble {
  border-bottom-left-radius: 4px;
}

.bubble.streaming::after {
  content: '▍';
  margin-left: 1px;
  color: var(--brand);
  animation: caret 1s steps(1) infinite;
}

@keyframes caret {
  50% {
    opacity: 0;
  }
}

.bubble,
.think-body {
  user-select: text;
  cursor: text;
}

/* 蓝底白字的用户消息：浏览器默认的蓝色选区看不出来，改为半透明白色 */
.msg.user .bubble::selection {
  background: rgb(255 255 255 / 38%);
  color: inherit;
}

.locate {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.locate:hover {
  border-color: var(--brand);
  color: var(--brand-strong);
}

.grow {
  flex: 1;
}

.suggest {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggest .chip {
  border: 0;
  cursor: pointer;
  padding: 4px 10px;
}

.suggest .chip:hover {
  background: var(--brand-soft);
  color: var(--brand-strong);
}
</style>
