/**
 * 离线回放端到端测试：不配置 AK、不访问网络，基于 data/replay 录制的真实响应完整复现体检，
 * 同时覆盖 HTTP 接口与 SSE 流式体检。保证评审「零配置」即可跑通。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-'));
process.env.DATA_MODE = 'replay';
process.env.BAIDU_SERVER_AK = '';
// 与本地 .env 隔离：测试始终走规则引擎，结果确定且不消耗大模型额度
process.env.LLM_BASE_URL = '';
process.env.LLM_API_KEY = '';
process.env.CACHE_DIR = path.join(tmp, 'cache');
process.env.ANALYSES_DIR = path.join(tmp, 'analyses');
process.env.VISITORS_DIR = path.join(tmp, 'visitors');
process.env.OSM_ENABLED = 'true';

const { config, ROOT_DIR } = await import('../server/config.js');
const { createApp } = await import('../server/app.js');
const { runAnalysis } = await import('../server/core/analyze.js');
const { pointInGeometry } = await import('../server/geo/geo.js');

const presets = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/presets.json'), 'utf8'));
let server;
let base;
let app;

/** 模拟一个浏览器访客：自动保存并回传服务端签发的访客 Cookie */
function visitor() {
  let cookie = '';
  const f = async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers: { ...opts.headers, ...(cookie ? { Cookie: cookie } : {}) } });
    const set = res.headers.get('set-cookie');
    if (set) {
      f.setCookie = set;
      cookie = set.split(';')[0];
    }
    return res;
  };
  return f;
}
const alice = visitor();
const bob = visitor();
const ask = (who, id, question) =>
  who(`${base}/api/analyses/${id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }).then((r) =>
    r.json(),
  );

before(async () => {
  app = createApp({
    fetchImpl: () => {
      throw new Error('回放模式下不应发起网络请求');
    },
  });
  await new Promise((r) => {
    server = app.app.listen(0, r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('配置为回放模式', () => {
  assert.equal(config.dataMode, 'replay');
  assert.ok(app.cache.replay.size > 100, '回放库已加载');
});

for (const p of presets) {
  test(`回放体检：${p.name}`, async () => {
    const { result } = await runAnalysis(app.client, { lng: p.lng, lat: p.lat, name: p.name, tier: 'standard' });
    const e = result.engineering;
    assert.equal(e.network, 0, '零网络调用');
    assert.equal(e.failures, 0, `回放全部命中（失败 ${e.failures}）`);
    // OSM 为可选补充源，录制时若 Overpass 超时，回放中会如实呈现为一次「降级为仅百度数据源」
    assert.deepEqual(
      e.degradations.filter((d) => d.reason !== 'osm_unavailable'),
      [],
    );
    assert.ok(result.isochrone.metrics.areas.adult > 3e5);
    assert.ok(result.isochrone.metrics.areas.elderly < result.isochrone.metrics.areas.adult);
    assert.ok(result.pois.length > 30);
    assert.ok(result.score.total > 0 && result.score.total <= 100);
    // 三类人群视角评分齐全，诊断中有亲子友好评估
    for (const k of ['elderlyScore', 'childScore']) assert.ok(result[k].total >= 0 && result[k].total <= 100, `${k} 缺失`);
    assert.equal(result.childScore.profile, 'child');
    assert.match(result.diagnosis.child, /陪同儿童步速/);
    assert.ok(result.blind.points.length > 10);
    // 灰色区域与小区结论一致：实测为盲区的小区落在该类灰色区域内，判为覆盖的小区不在其中
    for (const [k, c] of Object.entries(result.blind.categories)) {
      for (const pt of result.blind.points.filter((x) => x.kind === 'residential')) {
        assert.equal(pointInGeometry(pt, c.geometry), pt.cats[k].status === 'blind', `${pt.name}（${c.name}）与灰色区域不一致`);
      }
    }
    assert.ok(e.requests < e.naiveRequests / 4, '批量化与剪枝显著减少请求');
  });
}

test('故障演练：注入 20% 网络失败 + 10% 限流，体检结果与无故障时一致', async () => {
  const p = presets[0];
  const { result: clean } = await runAnalysis(app.client, { lng: p.lng, lat: p.lat, tier: 'lite' });
  const { ChaosMonkey } = await import('../server/baidu/chaos.js');
  const { BaiduClient } = await import('../server/baidu/client.js');
  const { ResponseCache } = await import('../server/baidu/cache.js');
  // 固定种子的伪随机数，保证故障序列可复现
  let seed = 20260928;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const chaos = new ChaosMonkey({ enabled: true, failureRate: 0.2, qpsLimitRate: 0.1, random });
  const client = new BaiduClient({
    config,
    cache: new ResponseCache({ cacheDir: path.join(tmp, 'chaos-cache'), replayDir: config.replayDir }),
    chaos,
    sleepImpl: () => Promise.resolve(),
  });
  const { result } = await runAnalysis(client, { lng: p.lng, lat: p.lat, tier: 'lite' });
  const injected = chaos.snapshot().injected;
  assert.ok(injected.failure + injected.rateLimit > 5, '确实注入了故障');
  assert.ok(result.engineering.retries > 0, '故障由重试消化');
  assert.equal(result.isochrone.metrics.areas.adult, clean.isochrone.metrics.areas.adult);
  assert.equal(result.score.total, clean.score.total);
});

test('HTTP：/api/config 不泄露服务端 AK', async () => {
  const cfg = await (await alice(`${base}/api/config`)).json();
  assert.equal(cfg.dataMode, 'replay');
  assert.equal(cfg.online, false);
  assert.equal(cfg.presets.length, presets.length);
  assert.ok(!JSON.stringify(cfg).includes(process.env.BAIDU_SERVER_AK || '__none__'));
});

test('HTTP：SSE 流式体检 → 结果查询 → 问答 → GeoJSON 导出', async () => {
  const p = presets[0];
  const res = await alice(`${base}/api/analyze/stream?lng=${p.lng}&lat=${p.lat}&name=${encodeURIComponent(p.name)}&tier=standard`);
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) }));
  const stages = events.filter((e) => e.type === 'stage').map((e) => e.data.stage);
  assert.deepEqual(stages, ['resolve', 'isochrone', 'pois', 'blind', 'siting']);
  const done = events.find((e) => e.type === 'done');
  assert.ok(done, '收到 done 事件');
  const id = done.data.id;

  const got = await (await alice(`${base}/api/analyses/${id}`)).json();
  assert.equal(got.id, id);

  const ans = await (
    await alice(`${base}/api/analyses/${id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '最近的药店在哪？' }),
    })
  ).json();
  assert.equal(ans.mode, 'rules');
  assert.match(ans.answer, /药店/);
  assert.ok(ans.highlights.length >= 1);

  const geo = await (await alice(`${base}/api/analyses/${id}/geojson`)).json();
  assert.equal(geo.type, 'FeatureCollection');
  assert.ok(geo.features.some((f) => f.properties.layer === 'isochrone'));

  const again = await (await alice(`${base}/api/analyze/stream?lng=${p.lng}&lat=${p.lat}&tier=standard`)).text();
  assert.match(again, /命中结果缓存/, '相同参数复用结果');
});

test('HTTP：多社区对比返回完整指标体系，最多 10 个并自动去重', async () => {
  const list = await (await alice(`${base}/api/analyses`)).json();
  const ids = list.map((x) => x.id);
  const res = await (await alice(`${base}/api/compare?ids=${[...ids, ...ids].join(',')}`)).json();
  assert.equal(res.max, 10);
  assert.ok(res.metrics.length >= 30, `指标数 ${res.metrics.length}`);
  assert.equal(res.rows.length, Math.min(10, new Set(ids).size));
  for (const m of res.metrics) assert.ok(m.key in res.rows[0].values);
  assert.ok(res.rows[0].values.score > 0);
});

test('HTTP：测时探针实测验证在离线回放模式下给出明确提示', async () => {
  const [first] = await (await alice(`${base}/api/analyses`)).json();
  const res = await alice(`${base}/api/analyses/${first.id}/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lng: first.center.lng + 0.003, lat: first.center.lat + 0.002 }),
  });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /离线回放模式/);
  const bad = await alice(`${base}/api/analyses/${first.id}/probe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400);
});

test('访客隔离：历史与对话只对本人可见，Cookie 为 HttpOnly', async () => {
  assert.match(alice.setCookie, /HttpOnly/);
  assert.match(alice.setCookie, /SameSite=Lax/);
  const mine = await (await alice(`${base}/api/analyses`)).json();
  assert.ok(mine.length > 0, '自己的历史可见');
  const id = mine[0].id;
  const theirs = await (await bob(`${base}/api/analyses`)).json();
  assert.equal(theirs.length, 0, '其他访客看不到我的历史');

  const aliceChat = await (await alice(`${base}/api/analyses/${id}/chat`)).json();
  assert.ok(aliceChat.messages.length >= 2, '对话已持久化');
  const bobChat = await (await bob(`${base}/api/analyses/${id}/chat`)).json();
  assert.deepEqual(bobChat.messages, [], '其他访客看不到我的对话');

  // 其他访客对同一份报告提问，得到独立的对话，互不影响
  await ask(bob, id, '综合评分是怎么算的？');
  assert.equal((await (await bob(`${base}/api/analyses/${id}/chat`)).json()).messages.length, 2);
  assert.equal((await (await alice(`${base}/api/analyses/${id}/chat`)).json()).messages.length, aliceChat.messages.length);

  // 伪造的访客 Cookie 会被替换为新的随机 ID
  const forged = await fetch(`${base}/api/analyses`, { headers: { Cookie: 'lc_vid=../../etc' } });
  assert.match(forged.headers.get('set-cookie') || '', /lc_vid=/);
  assert.deepEqual(await forged.json(), []);
});

test('分享链接：他人打开报告后加入其历史，对话仍互不可见；已有的历史顺序不变', async () => {
  const mine = await (await alice(`${base}/api/analyses`)).json();
  const shared = mine.at(-1).id;
  const carol = visitor();
  assert.deepEqual(await (await carol(`${base}/api/analyses`)).json(), []);
  assert.equal((await carol(`${base}/api/analyses/${shared}`)).status, 200);
  const carolList = await (await carol(`${base}/api/analyses`)).json();
  assert.deepEqual(
    carolList.map((x) => x.id),
    [shared],
  );
  assert.deepEqual((await (await carol(`${base}/api/analyses/${shared}/chat`)).json()).messages, []);
  // 自己重新打开旧报告，不会被挪到历史最前
  await alice(`${base}/api/analyses/${shared}`);
  assert.deepEqual(
    (await (await alice(`${base}/api/analyses`)).json()).map((x) => x.id),
    mine.map((x) => x.id),
  );
  // 对比链接中的报告同样加入历史
  const dave = visitor();
  await dave(`${base}/api/compare?ids=${mine.map((x) => x.id).join(',')}`);
  assert.equal((await (await dave(`${base}/api/analyses`)).json()).length, Math.min(10, mine.length));
});

test('历史接口：GET /api/history 列出本人记录，DELETE 只从本人历史移除，报告与他人历史不受影响', async () => {
  // 再体检一次（轻量档，回放库中已录制），保证至少有两条历史
  const p = presets[0];
  await (await alice(`${base}/api/analyze/stream?lng=${p.lng}&lat=${p.lat}&tier=lite`)).text();
  const mine = await (await alice(`${base}/api/history`)).json();
  assert.ok(mine.length >= 2, '已有多条历史');
  assert.deepEqual(
    mine.map((x) => x.id),
    (await (await alice(`${base}/api/analyses`)).json()).map((x) => x.id),
    '与兼容接口一致',
  );
  const h = mine[0];
  for (const k of ['score', 'elderlyScore', 'childScore', 'minutes', 'tier', 'residentialTotal', 'residentialBlind']) assert.ok(k in h, `摘要含 ${k}`);

  const target = mine.at(-1).id;
  const erin = visitor();
  await erin(`${base}/api/analyses/${target}`); // 另一位访客通过链接打开，同样拥有这条历史
  await ask(alice, target, '综合评分是怎么算的？');

  const del = await alice(`${base}/api/history/${target}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  const after = await (await alice(`${base}/api/history`)).json();
  assert.ok(!after.some((x) => x.id === target), '已从本人历史移除');
  assert.equal(after.length, mine.length - 1);
  assert.equal((await alice(`${base}/api/history/${target}`, { method: 'DELETE' })).status, 404, '重复移除返回 404');
  // 报告本身仍在，其他访客的历史不受影响
  assert.equal((await erin(`${base}/api/analyses/${target}/chat`)).status, 200);
  assert.ok((await (await erin(`${base}/api/history`)).json()).some((x) => x.id === target));
  // 本人在这份报告下的对话一并清除；重新打开链接后会再次加入历史
  const reopened = await alice(`${base}/api/analyses/${target}`);
  assert.equal(reopened.status, 200);
  assert.deepEqual((await (await alice(`${base}/api/analyses/${target}/chat`)).json()).messages, []);
  assert.ok((await (await alice(`${base}/api/history`)).json()).some((x) => x.id === target));
});

test('多轮问答：追问继承上一轮主题，清空后重新开始', async () => {
  const [first] = await (await alice(`${base}/api/analyses`)).json();
  await alice(`${base}/api/analyses/${first.id}/chat`, { method: 'DELETE' });
  const a1 = await ask(alice, first.id, '最近的菜市场在哪？');
  assert.match(a1.answer, /菜市场/);
  const a2 = await ask(alice, first.id, '那老人呢？');
  assert.match(a2.answer, /接着上一个问题/);
  assert.match(a2.answer, /菜市场/);
  assert.match(a2.answer, /老年人/);
  const { messages } = await (await alice(`${base}/api/analyses/${first.id}/chat`)).json();
  assert.deepEqual(
    messages.map((m) => m.role),
    ['user', 'bot', 'user', 'bot'],
  );
  assert.ok(messages[1].highlights.length >= 1, '回答附带可在地图上定位的设施');
  await alice(`${base}/api/analyses/${first.id}/chat`, { method: 'DELETE' });
  assert.deepEqual((await (await alice(`${base}/api/analyses/${first.id}/chat`)).json()).messages, []);
  assert.equal(
    (await alice(`${base}/api/analyses/${first.id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status,
    400,
  );
});

test('流式问答：SSE 依次推送 meta / delta / done，并写入对话记录', async () => {
  const [first] = await (await alice(`${base}/api/analyses`)).json();
  await alice(`${base}/api/analyses/${first.id}/chat`, { method: 'DELETE' });
  const res = await alice(`${base}/api/analyses/${first.id}/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '最近的药店在哪？' }),
  });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const events = [...(await res.text()).matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) }));
  assert.deepEqual([...new Set(events.map((x) => x.type))], ['meta', 'delta', 'done']);
  const done = events.find((x) => x.type === 'done').data;
  assert.equal(done.mode, 'rules');
  assert.equal(
    events
      .filter((x) => x.type === 'delta')
      .map((x) => x.data.text)
      .join(''),
    done.answer,
  );
  const { messages } = await (await alice(`${base}/api/analyses/${first.id}/chat`)).json();
  assert.equal(messages.length, 2);
  assert.equal(messages[1].text, done.answer);
  const empty = await alice(`${base}/api/analyses/${first.id}/ask/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(empty.status, 400);
});

test('HTTP：非法参数与不存在的记录', async () => {
  const bad = await (await alice(`${base}/api/analyze/stream?lng=0&lat=0`)).text();
  assert.match(bad, /event: fail/);
  assert.equal((await alice(`${base}/api/analyses/not-exist`)).status, 404);
  assert.equal((await alice(`${base}/api/analyses/..%2F..%2Fetc`)).status, 400);
});
