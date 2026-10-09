/**
 * 大模型流式调用：用本地模拟服务复现 OpenAI 兼容的 SSE 流（含跨数据包拆行、中途断开、客户端中止、上游报错）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let hits = [];
const chunk = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      hits.push({ url: req.url, body: JSON.parse(body) });
      const mode = req.url.split('/')[1];
      if (mode === 'error') {
        res.writeHead(500);
        return res.end('{"error":"boom"}');
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const all = [chunk('  你好'), chunk('，这是'), ': keep-alive\n\n', chunk('流式回答。'), 'data: [DONE]\n\n'].join('');
      if (mode === 'ok') {
        // 故意按 7 字节切片发送，验证跨数据包的行拼接
        for (let i = 0; i < all.length; i += 7) {
          res.write(all.slice(i, i + 7));
          await new Promise((r) => setTimeout(r, 1));
        }
        return res.end();
      }
      if (mode === 'think') {
        const r = (t) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: t } }] })}\n\n`;
        res.write(r('  先看盲区占比，') + r('再比较维度得分。'));
        res.write(chunk('先补菜市场。'));
        return res.end('data: [DONE]\n\n');
      }
      if (mode === 'drop') {
        res.write(chunk('前半段'));
        return setTimeout(() => res.destroy(), 20);
      }
      if (mode === 'slow') {
        res.write(chunk('开始'));
        const t = setInterval(() => res.write(chunk('…')), 20);
        res.on('close', () => clearInterval(t));
      }
    });
  });
  await new Promise((r) => server.listen(0, r));
});

after(() => server.close());

/** 把大模型配置指向模拟服务的不同路径（同一进程内共享 config 对象） */
async function load(mode) {
  const { config, resolveChatUrl } = await import('../server/config.js');
  Object.assign(config.llm, {
    url: resolveChatUrl(`http://127.0.0.1:${server.address().port}/${mode}`),
    apiKey: 'sk-test',
    model: 'mock',
    extraBody: {},
    thinking: true,
  });
  return import('../server/core/llm.js');
}

/** 规则引擎回答「评分」类问题所需的最小体检结果 */
const fakeResult = () => ({
  params: { minutes: 15 },
  profiles: [{ key: 'adult', name: '成年人', speed: 1.2 }],
  access: [],
  blind: { categories: {} },
  siting: [],
  isochrone: { metrics: { areas: { adult: 1e6 }, circleOverestimate: 30 } },
  score: {
    total: 80,
    grade: '良好',
    components: { dimensions: 80, coverage: 80, completeness: 80 },
    dimensions: [{ name: '医疗健康', score: 90 }],
    categories: [],
  },
  diagnosis: { summary: '' },
});

test('流式：跨数据包拆行也能完整拼出回答，开头空白被去掉，请求带 stream: true', async () => {
  const { chatStream } = await load('ok');
  const deltas = [];
  const { text, error } = await chatStream([{ role: 'user', content: 'hi' }], { onDelta: (t) => deltas.push(t) });
  assert.equal(error, null);
  assert.equal(text, '你好，这是流式回答。');
  assert.deepEqual(deltas, ['你好', '，这是', '流式回答。']);
  assert.equal(hits.at(-1).body.stream, true);
  assert.equal(hits.at(-1).url, '/ok/chat/completions');
});

test('流式：中途断开时保留已生成部分并返回错误', async () => {
  const { chatStream } = await load('drop');
  const { text, error } = await chatStream([{ role: 'user', content: 'hi' }]);
  assert.equal(text, '前半段');
  assert.ok(error);
});

test('流式：客户端中止后立即停止读取上游', async () => {
  const { chatStream } = await load('slow');
  const ac = new AbortController();
  let n = 0;
  const t0 = Date.now();
  const p = chatStream([{ role: 'user', content: 'hi' }], { signal: ac.signal, onDelta: () => ++n === 3 && ac.abort() });
  const { error } = await p;
  assert.equal(error, 'aborted');
  assert.ok(Date.now() - t0 < 2000);
});

test('流式问答：上游报错且未输出任何文字时回退规则引擎', async () => {
  await load('error');
  const { answerStream } = await import('../server/core/assistant.js');
  const metas = [];
  let streamed = '';
  const r = await answerStream(fakeResult(), '综合评分是怎么算的？', [], { onMeta: (m) => metas.push(m), onDelta: (t) => (streamed += t) });
  assert.equal(r.mode, 'rules');
  assert.deepEqual(
    metas.map((m) => m.mode),
    ['rules'],
  );
  assert.equal(streamed, r.answer);
  assert.match(r.answer, /综合评分/);
});

test('深度思考：思考链与正式回答分开回调，开启时发送 thinking 且不带 temperature，关闭时显式关闭', async () => {
  const { chatStream } = await load('think');
  const thoughts = [];
  const deltas = [];
  const r = await chatStream([{ role: 'user', content: 'hi' }], { thinking: true, onReasoning: (t) => thoughts.push(t), onDelta: (t) => deltas.push(t) });
  assert.equal(r.reasoning, '先看盲区占比，再比较维度得分。');
  assert.equal(r.text, '先补菜市场。');
  assert.deepEqual(thoughts, ['先看盲区占比，', '再比较维度得分。']);
  assert.deepEqual(hits.at(-1).body.thinking, { type: 'enabled' });
  assert.equal('temperature' in hits.at(-1).body, false);

  await chatStream([{ role: 'user', content: 'hi' }], { thinking: false });
  assert.deepEqual(hits.at(-1).body.thinking, { type: 'disabled' });
  assert.equal(hits.at(-1).body.temperature, 0.3);
});

test('深度思考：服务不支持 thinking 参数时不发送该字段', async () => {
  const { chatStream } = await load('ok');
  const { config } = await import('../server/config.js');
  config.llm.thinking = false;
  await chatStream([{ role: 'user', content: 'hi' }], { thinking: true });
  assert.equal('thinking' in hits.at(-1).body, false);
});
