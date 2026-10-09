import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveRateLimiter } from '../server/baidu/rateLimiter.js';
import { CircuitBreaker } from '../server/baidu/circuitBreaker.js';
import { classifyStatus, ErrorKind } from '../server/baidu/errors.js';
import { BaiduClient } from '../server/baidu/client.js';
import { ChaosMonkey } from '../server/baidu/chaos.js';

test('百度状态码分类', () => {
  assert.equal(classifyStatus(0), null);
  assert.equal(classifyStatus(401), ErrorKind.RATE_LIMIT);
  assert.equal(classifyStatus(302), ErrorKind.QUOTA);
  assert.equal(classifyStatus(4), ErrorKind.QUOTA);
  assert.equal(classifyStatus(240), ErrorKind.AUTH);
  assert.equal(classifyStatus(2), ErrorKind.PARAM);
  assert.equal(classifyStatus(1), ErrorKind.TRANSIENT);
});

test('令牌桶限制 QPS，AIMD 在限流时减半、成功后回升', async () => {
  const lim = new AdaptiveRateLimiter({ qps: 20, concurrency: 50, increaseEvery: 2 });
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 40 }, () => lim.run(async () => null)));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 900, `40 个请求 @20QPS 至少约 1s，实际 ${elapsed}ms`);
  lim.onRateLimited();
  assert.equal(lim.rate, 10);
  lim.onSuccess();
  lim.onSuccess();
  assert.equal(lim.rate, 11);
});

test('限流器同时在途请求不超过 concurrency', async () => {
  const lim = new AdaptiveRateLimiter({ qps: 1000, concurrency: 3 });
  let inFlight = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 12 }, () =>
      lim.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
      }),
    ),
  );
  assert.ok(peak <= 3);
});

test('熔断器：连续失败断开，冷却后半开探测，成功恢复', () => {
  let now = 0;
  const b = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => now });
  for (let i = 0; i < 3; i++) b.onFailure(new Error('x'));
  assert.equal(b.state, 'open');
  assert.equal(b.canRequest(), false);
  now = 1500;
  assert.equal(b.canRequest(), true, '半开状态放行一个探测请求');
  assert.equal(b.canRequest(), false, '探测期间其余请求仍被拒绝');
  b.onSuccess();
  assert.equal(b.state, 'closed');
});

function makeClient(responses, { mode = 'live' } = {}) {
  const calls = [];
  const store = new Map();
  const cache = {
    replay: new Map(),
    replayBundles: [],
    getReplay: () => undefined,
    get: async (s, k) => store.get(k),
    set: async (s, k, v) => store.set(k, v),
  };
  const config = {
    dataMode: mode,
    baidu: { serverAk: 'test-ak', baseUrl: 'https://example.invalid', qps: 1000, concurrency: 10, timeoutMs: 1000, maxRetries: 3, matrixMaxElements: 50 },
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { status: 200, json: async () => r };
  };
  const client = new BaiduClient({ config, cache, chaos: new ChaosMonkey(), fetchImpl, sleepImpl: async () => {} });
  return { client, calls };
}

test('QPS 超限自动退避重试并降速，最终成功且结果写入缓存', async () => {
  const { client, calls } = makeClient([
    { status: 401, message: '并发超限' },
    { status: 401, message: '并发超限' },
    { status: 0, result: { ok: 1 } },
  ]);
  const s = client.session('t');
  const data = await s.request('geocoding/v3', { address: 'x' });
  assert.deepEqual(data.result, { ok: 1 });
  assert.equal(calls.length, 3);
  assert.equal(s.stats.retries, 2);
  assert.ok(client.limiter.rate < 1000, '限流后速率下降');
  await s.request('geocoding/v3', { address: 'x' });
  assert.equal(calls.length, 3, '第二次命中缓存，不再请求');
  assert.equal(s.stats.cache, 1);
  assert.ok(!calls[0].includes('geocoding/v3/'), 'geocoding 路径不应带结尾斜杠');
});

test('配额耗尽立即熔断，后续请求不再打到上游', async () => {
  const { client, calls } = makeClient([{ status: 302, message: '天配额超限' }]);
  const s = client.session('t');
  await assert.rejects(s.request('place/v2/search', { query: 'a' }), (e) => e.kind === ErrorKind.QUOTA);
  await assert.rejects(s.request('place/v2/search', { query: 'b' }), (e) => e.kind === ErrorKind.UNAVAILABLE);
  assert.equal(calls.length, 1);
});

test('网络异常重试耗尽后抛出可重试错误', async () => {
  const { client, calls } = makeClient([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')]);
  await assert.rejects(client.session('t').request('geocoding/v3', { address: 'y' }), (e) => e.kind === ErrorKind.TRANSIENT);
  assert.equal(calls.length, 4);
});

test('回放模式：未录制的请求直接不可用，不访问网络', async () => {
  const { client, calls } = makeClient([], { mode: 'replay' });
  await assert.rejects(client.session('t').request('geocoding/v3', { address: 'z' }), (e) => e.kind === ErrorKind.UNAVAILABLE);
  assert.equal(calls.length, 0);
});

test('大模型地址：与 OpenAI SDK 约定一致，在 Base URL 后拼接 /chat/completions', async () => {
  const { resolveChatUrl } = await import('../server/config.js');
  assert.equal(resolveChatUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  assert.equal(resolveChatUrl(' https://api.deepseek.com/ '), 'https://api.deepseek.com/chat/completions');
  assert.equal(resolveChatUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/'), 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(resolveChatUrl(''), '');
  assert.equal(resolveChatUrl('not a url'), '');
});
