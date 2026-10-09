import { BaiduApiError, ErrorKind } from './errors.js';

/**
 * 故障注入器：按概率模拟网络异常与 QPS 限流，用于演示与测试系统的容错降级能力。
 * 运行时可通过 PUT /api/chaos 动态开关。
 */
export class ChaosMonkey {
  constructor({ enabled = false, failureRate = 0.2, qpsLimitRate = 0.1, random = Math.random } = {}) {
    this.enabled = enabled;
    this.failureRate = failureRate;
    this.qpsLimitRate = qpsLimitRate;
    this.random = random;
    this.injected = { failure: 0, rateLimit: 0 };
  }

  configure({ enabled, failureRate, qpsLimitRate }) {
    if (enabled !== undefined) this.enabled = Boolean(enabled);
    if (failureRate !== undefined) this.failureRate = clamp01(failureRate);
    if (qpsLimitRate !== undefined) this.qpsLimitRate = clamp01(qpsLimitRate);
    return this.snapshot();
  }

  /** 在真实请求前调用，命中时抛出模拟错误 */
  maybeFail(service) {
    if (!this.enabled) return;
    const r = this.random();
    if (r < this.qpsLimitRate) {
      this.injected.rateLimit += 1;
      throw new BaiduApiError('[故障注入] 当前并发量已经超过约定并发配额', {
        kind: ErrorKind.RATE_LIMIT,
        status: 401,
        service,
      });
    }
    if (r < this.qpsLimitRate + this.failureRate) {
      this.injected.failure += 1;
      throw new BaiduApiError('[故障注入] 网络连接被重置', { kind: ErrorKind.TRANSIENT, service });
    }
  }

  snapshot() {
    return {
      enabled: this.enabled,
      failureRate: this.failureRate,
      qpsLimitRate: this.qpsLimitRate,
      injected: { ...this.injected },
    };
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
