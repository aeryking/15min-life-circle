import { BaiduApiError, ErrorKind, classifyStatus } from './errors.js';
import { AdaptiveRateLimiter } from './rateLimiter.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { cacheKey } from './cache.js';

/** 百度个别接口要求路径以「/」结尾，其余接口带「/」会 404 */
const SLASH_SERVICES = new Set(['geoconv/v2']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 百度地图 Web 服务 API 客户端。
 *
 * 请求链路：磁盘缓存 → 上游（回放库 / 真实 API）
 * 上游调用受 自适应限流 + 熔断 + 指数退避重试 保护；每个分析任务通过 session() 获得
 * 独立的调用统计与「触达记录」（用于录制回放数据）。
 */
export class BaiduClient {
  constructor({ config, cache, chaos, fetchImpl = globalThis.fetch, sleepImpl = sleep }) {
    this.config = config;
    this.cache = cache;
    this.chaos = chaos;
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.limiter = new AdaptiveRateLimiter({ qps: config.baidu.qps, concurrency: config.baidu.concurrency });
    this.breakers = new Map();
    this.ledger = { network: 0, cache: 0, replay: 0, errors: 0, byService: {} };
  }

  get mode() {
    return this.config.dataMode;
  }

  get online() {
    return this.mode === 'live' && Boolean(this.config.baidu.serverAk);
  }

  breaker(service) {
    if (!this.breakers.has(service)) this.breakers.set(service, new CircuitBreaker({ failureThreshold: 5, cooldownMs: 20000 }));
    return this.breakers.get(service);
  }

  session(label = 'session') {
    return new ClientSession(this, label);
  }

  status() {
    return {
      mode: this.mode,
      online: this.online,
      limiter: this.limiter.snapshot(),
      breakers: Object.fromEntries([...this.breakers].map(([k, b]) => [k, b.snapshot()])),
      ledger: this.ledger,
      chaos: this.chaos.snapshot(),
      replay: { entries: this.cache.replay.size, bundles: this.cache.replayBundles },
    };
  }

  #count(service, field) {
    this.ledger[field] += 1;
    const s = (this.ledger.byService[service] ||= { network: 0, cache: 0, replay: 0, errors: 0 });
    s[field] += 1;
  }

  /**
   * 执行一次请求。
   * @returns {Promise<{ data: any, source: 'cache'|'replay'|'network', retries: number }>}
   */
  async request(service, params, { noCache = false } = {}) {
    const key = cacheKey(service, params);
    if (!noCache) {
      const cached = await this.cache.get(service, key);
      if (cached !== undefined) {
        this.#count(service, 'cache');
        return { data: cached, source: 'cache', retries: 0, key };
      }
    }

    const breaker = this.breaker(service);
    let retries = 0;
    let lastErr;
    for (let attempt = 0; attempt <= this.config.baidu.maxRetries; attempt++) {
      if (!breaker.canRequest()) {
        throw new BaiduApiError(`服务 ${service} 已熔断：${breaker.lastError || '连续失败'}`, {
          kind: ErrorKind.UNAVAILABLE,
          service,
        });
      }
      try {
        const { data, source } = await this.#upstream(service, params, key);
        if (source === 'network') this.limiter.onSuccess();
        breaker.onSuccess();
        this.#count(service, source);
        if (source === 'network') await this.cache.set(service, key, data);
        return { data, source, retries, key };
      } catch (err) {
        lastErr = err instanceof BaiduApiError ? err : new BaiduApiError(err.message, { kind: ErrorKind.TRANSIENT, service, cause: err });
        if (lastErr.kind === ErrorKind.UNAVAILABLE) throw lastErr;
        this.#count(service, 'errors');
        if (lastErr.kind === ErrorKind.RATE_LIMIT) this.limiter.onRateLimited();
        if (lastErr.kind === ErrorKind.QUOTA || lastErr.kind === ErrorKind.AUTH) {
          breaker.onFailure(lastErr, { immediate: true, openMs: 10 * 60000 });
          throw lastErr;
        }
        if (!lastErr.retryable) throw lastErr;
        if (attempt === this.config.baidu.maxRetries) break;
        retries += 1;
        const base = lastErr.kind === ErrorKind.RATE_LIMIT ? 600 : 250;
        await this.sleep(Math.min(5000, base * 2 ** attempt + Math.random() * 200));
      }
    }
    breaker.onFailure(lastErr);
    lastErr.retries = retries;
    throw lastErr;
  }

  /**
   * 非百度的外部数据源（如 OSM Overpass）同样走 缓存 → 回放 → 网络 链路，
   * 便于录制回放与离线演示。
   */
  async requestExternal(service, keyParams, fetcher) {
    const key = cacheKey(service, keyParams);
    const cached = await this.cache.get(service, key);
    if (cached !== undefined) return { data: cached, source: 'cache', key };
    const replayed = this.cache.getReplay(key);
    if (replayed !== undefined) return { data: replayed, source: 'replay', key };
    if (!this.online) {
      throw new BaiduApiError('离线模式下外部数据源不可用', { kind: ErrorKind.UNAVAILABLE, service });
    }
    const data = await fetcher();
    await this.cache.set(service, key, data);
    return { data, source: 'network', key };
  }

  async #upstream(service, params, key) {
    this.chaos.maybeFail(service);

    const replayed = this.cache.getReplay(key);
    if (replayed !== undefined) return { data: replayed, source: 'replay' };

    if (!this.online) {
      throw new BaiduApiError(this.config.baidu.serverAk ? '当前为回放模式，回放库未包含该请求' : '未配置服务端 AK，且回放库未包含该请求', {
        kind: ErrorKind.UNAVAILABLE,
        service,
      });
    }

    return this.limiter.run(() => this.#fetchNetwork(service, params));
  }

  async #fetchNetwork(service, params) {
    const url = new URL(`${this.config.baidu.baseUrl}/${service}${SLASH_SERVICES.has(service) ? '/' : ''}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    url.searchParams.set('ak', this.config.baidu.serverAk);

    let res;
    try {
      res = await this.fetch(url, { signal: AbortSignal.timeout(this.config.baidu.timeoutMs) });
    } catch (err) {
      throw new BaiduApiError(`网络请求失败：${err.name === 'TimeoutError' ? '超时' : err.message}`, {
        kind: ErrorKind.TRANSIENT,
        service,
        cause: err,
      });
    }
    if (res.status >= 500) throw new BaiduApiError(`HTTP ${res.status}`, { kind: ErrorKind.TRANSIENT, service });
    if (res.status >= 400) throw new BaiduApiError(`HTTP ${res.status}`, { kind: ErrorKind.PARAM, service });
    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new BaiduApiError('响应不是合法 JSON', { kind: ErrorKind.TRANSIENT, service, cause: err });
    }
    const kind = classifyStatus(body.status);
    if (kind) {
      throw new BaiduApiError(`百度 API 返回 status=${body.status}：${body.message || body.msg || ''}`, {
        kind,
        status: Number(body.status),
        service,
      });
    }
    return { data: body, source: 'network' };
  }
}

/** 单次分析任务的请求会话：记录调用统计、降级事件与触达的缓存键 */
export class ClientSession {
  constructor(client, label) {
    this.client = client;
    this.label = label;
    this.touched = new Map();
    this.stats = {
      requests: 0,
      network: 0,
      cache: 0,
      replay: 0,
      retries: 0,
      failures: 0,
      matrixElements: 0,
      byService: {},
      degradations: [],
    };
  }

  async request(service, params, opts) {
    const s = (this.stats.byService[service] ||= { requests: 0, network: 0, cache: 0, replay: 0, failures: 0 });
    this.stats.requests += 1;
    s.requests += 1;
    try {
      const r = await this.client.request(service, params, opts);
      this.stats[r.source] += 1;
      s[r.source] += 1;
      this.stats.retries += r.retries;
      this.touched.set(r.key, r.data);
      return r.data;
    } catch (err) {
      this.stats.failures += 1;
      s.failures += 1;
      this.stats.retries += err.retries || 0;
      throw err;
    }
  }

  async cachedExternal(service, keyParams, fetcher) {
    const r = await this.client.requestExternal(service, keyParams, fetcher);
    this.touched.set(r.key, r.data);
    const s = (this.stats.byService[service] ||= { requests: 0, network: 0, cache: 0, replay: 0, failures: 0 });
    s.requests += 1;
    s[r.source] += 1;
    return r.data;
  }

  /** 记录一次降级事件（供报告「工程指标」展示） */
  degrade(stage, reason, detail = {}) {
    this.stats.degradations.push({ stage, reason, ...detail, at: new Date().toISOString() });
  }

  /** 为并发执行的阶段创建独立计数的子会话（统计同时汇总到父会话） */
  scope(name) {
    return new ScopedSession(this, name);
  }
}

export class ScopedSession {
  constructor(parent, name) {
    this.parent = parent;
    this.name = name;
    this.stats = parent.stats;
    this.counts = { requests: 0, upstream: 0, cache: 0, failures: 0 };
  }

  async request(service, params, opts) {
    this.counts.requests += 1;
    const before = this.parent.stats.network + this.parent.stats.replay;
    const beforeCache = this.parent.stats.cache;
    try {
      return await this.parent.request(service, params, opts);
    } catch (err) {
      this.counts.failures += 1;
      throw err;
    } finally {
      this.counts.upstream += this.parent.stats.network + this.parent.stats.replay - before > 0 ? 1 : 0;
      this.counts.cache += this.parent.stats.cache - beforeCache > 0 ? 1 : 0;
    }
  }

  cachedExternal(...args) {
    return this.parent.cachedExternal(...args);
  }

  degrade(stage, reason, detail) {
    this.parent.degrade(stage, reason, detail);
  }

  get touched() {
    return this.parent.touched;
  }
}
