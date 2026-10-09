import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 优先读取项目根目录 .env（Node ≥ 20.12 内置），不存在时仅使用进程环境变量
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

const serverAk = (process.env.BAIDU_SERVER_AK || '').trim();

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '0.0.0.0',

  baidu: {
    serverAk,
    browserAk: (process.env.BAIDU_BROWSER_AK || '').trim(),
    baseUrl: process.env.BAIDU_BASE_URL || 'https://api.map.baidu.com',
    /** 令牌桶 QPS 上限（个人认证开发者建议 ≤ 10） */
    qps: num(process.env.BAIDU_QPS, 8),
    /** 同时在途请求数上限 */
    concurrency: num(process.env.BAIDU_CONCURRENCY, 6),
    timeoutMs: num(process.env.BAIDU_TIMEOUT_MS, 8000),
    maxRetries: num(process.env.BAIDU_MAX_RETRIES, 3),
    /** 批量算路单次最多元素数（起点数 × 终点数） */
    matrixMaxElements: num(process.env.BAIDU_MATRIX_MAX_ELEMENTS, 50),
  },

  /**
   * 数据模式：
   *  live   —— 实时调用百度 API（带磁盘缓存）
   *  replay —— 只读回放 data/replay 下录制的真实响应，零外部调用
   *  auto   —— 有服务端 AK 用 live，否则 replay
   */
  dataMode: resolveDataMode(process.env.DATA_MODE, serverAk),

  cacheDir: path.resolve(ROOT_DIR, process.env.CACHE_DIR || 'data/cache'),
  replayDir: path.resolve(ROOT_DIR, 'data/replay'),
  analysesDir: path.resolve(ROOT_DIR, process.env.ANALYSES_DIR || 'data/analyses'),
  visitorsDir: path.resolve(ROOT_DIR, process.env.VISITORS_DIR || 'data/visitors'),
  webDistDir: path.resolve(ROOT_DIR, 'web/dist'),

  /** 故障注入（演示容错能力），可在运行时通过 API 动态调整 */
  chaos: {
    enabled: bool(process.env.CHAOS_ENABLED),
    failureRate: num(process.env.CHAOS_FAILURE_RATE, 0.2),
    qpsLimitRate: num(process.env.CHAOS_QPS_LIMIT_RATE, 0.1),
  },

  /** 可选：兼容 OpenAI 协议的大模型，用于润色报告与智能问答；未配置时使用规则引擎 */
  llm: {
    url: resolveChatUrl(process.env.LLM_BASE_URL),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 30000),
    extraBody: llmExtraBody(process.env.LLM_EXTRA_BODY, process.env.LLM_BASE_URL),
    // 是否支持「深度思考」开关（请求体 thinking 字段）：auto 时按地址识别 DeepSeek
    thinking: llmThinking(process.env.LLM_THINKING, process.env.LLM_BASE_URL),
    thinkingTimeoutMs: num(process.env.LLM_THINKING_TIMEOUT_MS, 120000),
  },

  osm: {
    enabled: bool(process.env.OSM_ENABLED, true),
    endpoint: process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
    timeoutMs: num(process.env.OSM_TIMEOUT_MS, 8000),
  },
};

/**
 * 大模型接口地址：与 OpenAI SDK 的 base_url 约定一致，填厂商给出的 Base URL
 * （如 https://api.deepseek.com、https://dashscope.aliyuncs.com/compatible-mode/v1），程序在其后拼接 /chat/completions。
 */
export function resolveChatUrl(raw) {
  const base = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) return '';
  try {
    new URL(base);
  } catch {
    console.warn('[config] LLM_BASE_URL 不是合法的 URL，已忽略');
    return '';
  }
  return `${base}/chat/completions`;
}

/**
 * 附加到请求体的厂商参数（JSON）。DeepSeek 默认开启思考模式，思考内容会占用输出上限、拖慢问答，
 * 因此未显式配置时对 DeepSeek 默认关闭思考。
 */
function llmExtraBody(raw, baseUrl = '') {
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      console.warn('[config] LLM_EXTRA_BODY 不是合法 JSON，已忽略');
      return {};
    }
  }
  return /deepseek\.com/i.test(baseUrl) ? { thinking: { type: 'disabled' } } : {};
}

function llmThinking(raw, baseUrl = '') {
  const v = String(raw || 'auto').toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return /deepseek\.com/i.test(baseUrl);
}

function resolveDataMode(mode, ak) {
  const m = (mode || 'auto').toLowerCase();
  if (m === 'live' || m === 'replay') return m;
  return ak ? 'live' : 'replay';
}

export const llmEnabled = () => Boolean(config.llm.url && config.llm.apiKey && config.llm.model);
