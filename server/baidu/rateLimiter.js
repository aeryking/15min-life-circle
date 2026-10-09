/**
 * 自适应限流器：令牌桶（控制 QPS）+ 信号量（控制在途并发）+ AIMD 速率调节。
 *
 * - 正常情况下以配置的 QPS 平滑放行请求；
 * - 收到「并发超限」时速率乘性减半（Multiplicative Decrease）；
 * - 之后每连续成功若干次，速率加性回升（Additive Increase），直至恢复上限。
 */
export class AdaptiveRateLimiter {
  constructor({ qps = 8, concurrency = 6, minQps = 1, increaseEvery = 10, now = () => Date.now() } = {}) {
    this.maxQps = qps;
    this.minQps = Math.min(minQps, qps);
    this.rate = qps;
    this.tokens = qps;
    this.concurrency = concurrency;
    this.inFlight = 0;
    this.increaseEvery = increaseEvery;
    this.successStreak = 0;
    this.now = now;
    this.lastRefill = now();
    this.queue = [];
    this.timer = null;
    this.stats = { throttled: 0, decreases: 0 };
  }

  /** 获取执行许可，返回释放函数 */
  acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.#drain();
    });
  }

  /** 以限流方式执行异步任务 */
  async run(task) {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  onSuccess() {
    this.successStreak += 1;
    if (this.rate < this.maxQps && this.successStreak >= this.increaseEvery) {
      this.rate = Math.min(this.maxQps, this.rate + 1);
      this.successStreak = 0;
    }
  }

  onRateLimited() {
    this.successStreak = 0;
    this.rate = Math.max(this.minQps, this.rate / 2);
    this.tokens = Math.min(this.tokens, 0);
    this.stats.decreases += 1;
  }

  snapshot() {
    return { rate: Number(this.rate.toFixed(2)), maxQps: this.maxQps, inFlight: this.inFlight, queued: this.queue.length };
  }

  #refill() {
    const t = this.now();
    const elapsed = (t - this.lastRefill) / 1000;
    this.lastRefill = t;
    this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate);
  }

  #drain() {
    this.#refill();
    while (this.queue.length && this.inFlight < this.concurrency && this.tokens >= 1) {
      this.tokens -= 1;
      this.inFlight += 1;
      const resolve = this.queue.shift();
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
        this.#drain();
      });
    }
    if (this.queue.length && !this.timer) {
      if (this.tokens < 1) this.stats.throttled += 1;
      const wait = this.tokens >= 1 ? 5 : Math.ceil(((1 - this.tokens) / this.rate) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.#drain();
      }, wait);
    }
  }
}
