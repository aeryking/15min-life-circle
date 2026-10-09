/**
 * 熔断器：按服务维度统计失败，连续失败达到阈值后「断开」一段时间，
 * 期间请求立即失败并走降级逻辑，避免在配额耗尽 / 服务故障时继续浪费时间。
 * 冷却结束后进入「半开」状态，放行一个探测请求，成功则恢复。
 */
export class CircuitBreaker {
  constructor({ failureThreshold = 5, cooldownMs = 30000, now = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = 0;
    this.openMs = cooldownMs;
    this.lastError = null;
    this.probing = false;
  }

  /** 是否允许发出请求 */
  canRequest() {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && this.now() - this.openedAt >= this.openMs) {
      this.state = 'half-open';
      this.probing = false;
    }
    if (this.state === 'half-open' && !this.probing) {
      this.probing = true;
      return true;
    }
    return false;
  }

  onSuccess() {
    this.state = 'closed';
    this.failures = 0;
    this.probing = false;
  }

  /**
   * @param {Error} err
   * @param {{ immediate?: boolean, openMs?: number }} [opts] 配额 / 鉴权类错误立即熔断
   */
  onFailure(err, { immediate = false, openMs } = {}) {
    this.failures += 1;
    this.lastError = err?.message || String(err);
    if (immediate || this.state === 'half-open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
      this.openMs = openMs ?? this.cooldownMs;
      this.probing = false;
    }
  }

  snapshot() {
    return { state: this.state, failures: this.failures, lastError: this.lastError };
  }
}
