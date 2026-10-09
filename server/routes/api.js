import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, llmEnabled, ROOT_DIR } from '../config.js';
import { geocode, reverseGeocode, placeSuggest, toBd09, routeMatrixWalking } from '../baidu/services.js';
import { runAnalysis, normalizeParams, paramsKey } from '../core/analyze.js';
import { answer, answerStream, SUGGESTED_QUESTIONS } from '../core/assistant.js';
import { polishReport } from '../core/llm.js';
import { toGeoJSON } from '../core/export.js';
import { CATEGORIES, SPEED_PROFILES, DIMENSIONS, BLIND_THRESHOLD_METERS, CRITICAL_KEYS } from '../core/categories.js';
import { TIERS, estimateCalls } from '../core/tiers.js';
import { buildCompareRow, metricMeta, MAX_COMPARE } from '../core/compare.js';
import { kindLabel } from '../baidu/errors.js';

const PRESETS = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/presets.json'), 'utf8'));

/**
 * REST + SSE 接口。所有百度调用都在服务端完成，服务端 AK 不会下发到浏览器。
 * 体检历史与 AI 对话按匿名访客隔离（req.visitorId 由 VisitorStore 中间件签发）。
 */
export function createApiRouter({ client, store, visitors }) {
  const r = express.Router();
  const running = new Map(); // paramsKey → Promise，合并并发的相同体检请求
  let active = 0;
  const MAX_ACTIVE = 2;

  r.get('/health', (req, res) => res.json({ ok: true, mode: client.mode, uptime: process.uptime() }));

  r.get('/config', (req, res) => {
    res.json({
      browserAk: config.baidu.browserAk || null,
      dataMode: client.mode,
      online: client.online,
      llm: llmEnabled(),
      // 模型名用于在对话中标注回答来源（不含任何密钥）
      llmModel: llmEnabled() ? config.llm.model : null,
      llmThinking: llmEnabled() && config.llm.thinking,
      blindThreshold: BLIND_THRESHOLD_METERS,
      criticalKeys: CRITICAL_KEYS,
      categories: CATEGORIES.map(({ key, name, short, dimension, critical, targetMinutes, recommended }) => ({
        key,
        name,
        short,
        dimension,
        critical,
        targetMinutes,
        recommended,
      })),
      dimensions: DIMENSIONS,
      profiles: SPEED_PROFILES,
      tiers: Object.values(TIERS).map((t) => ({
        key: t.key,
        name: t.name,
        desc: t.desc,
        rays: t.rays,
        rings: t.rings.length,
        refineRounds: t.refineRounds,
        estimate: estimateCalls(t),
      })),
      presets: PRESETS,
      suggestedQuestions: SUGGESTED_QUESTIONS,
    });
  });

  r.get('/status', (req, res) => res.json(client.status()));

  r.put('/chaos', express.json(), (req, res) => res.json(client.chaos.configure(req.body || {})));

  r.get(
    '/geocode',
    wrap(async (req, res) => {
      const s = client.session('geocode');
      res.json(await geocode(s, String(req.query.address || ''), String(req.query.city || '')));
    }),
  );

  r.get(
    '/suggest',
    wrap(async (req, res) => {
      const q = String(req.query.q || '').trim();
      if (!q) return res.json([]);
      const s = client.session('suggest');
      res.json(await placeSuggest(s, q, String(req.query.region || '全国')));
    }),
  );

  r.get(
    '/reverse',
    wrap(async (req, res) => {
      const s = client.session('reverse');
      res.json(await reverseGeocode(s, { lng: Number(req.query.lng), lat: Number(req.query.lat) }));
    }),
  );

  /** 浏览器定位得到的 WGS-84 坐标 → BD-09 */
  r.post(
    '/geoconv',
    express.json(),
    wrap(async (req, res) => {
      const points = (req.body?.points || []).slice(0, 100).map((p) => ({ lng: Number(p.lng), lat: Number(p.lat) }));
      const s = client.session('geoconv');
      res.json(await toBd09(s, points, req.body?.from === 'gcj02' ? 'gcj02' : 'wgs84'));
    }),
  );

  /**
   * 流式体检（Server-Sent Events）：进度与各阶段结果边算边推，前端可先渲染等时圈再渲染盲区。
   * 事件：progress / stage / done / error
   */
  r.get('/analyze/stream', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    let closed = false;
    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
    });
    try {
      const params = normalizeParams(req.query);
      const key = paramsKey(params);
      if (req.query.fresh !== '1') {
        const reuse = await store.findReusable(key);
        if (reuse) {
          await visitors.addAnalysis(req.visitorId, reuse.id);
          send('progress', { stage: 'report', progress: 1, message: '命中结果缓存' });
          send('done', { ...reuse, reused: true });
          return res.end();
        }
      }
      if (active >= MAX_ACTIVE && !running.has(key)) {
        send('progress', { stage: 'queue', progress: 0, message: '排队中：同时进行的体检较多，为保护 API 配额稍候执行' });
        while (active >= MAX_ACTIVE && !closed) await new Promise((r2) => setTimeout(r2, 500));
      }
      if (closed) return;
      let job = running.get(key);
      const listeners = new Set();
      if (!job) {
        active += 1;
        job = runAnalysis(client, { ...req.query, name: req.query.name }, { onEvent: (e) => listeners.forEach((l) => l(e)) })
          .then(async ({ result }) => {
            const preset = PRESETS.find((p) => Math.abs(p.lng - result.center.lng) < 1e-5 && Math.abs(p.lat - result.center.lat) < 1e-5);
            if (preset) result.presetKey = preset.key;
            await store.save(result, key);
            return result;
          })
          .finally(() => {
            active -= 1;
            running.delete(key);
          });
        job.listeners = listeners;
        running.set(key, job);
      }
      const onEvent = (e) => !closed && send(e.type, e);
      job.listeners.add(onEvent);
      const result = await job;
      job.listeners.delete(onEvent);
      await visitors.addAnalysis(req.visitorId, result.id);
      if (!closed) send('done', result);
    } catch (err) {
      console.error('[analyze]', err);
      if (!closed) send('fail', { message: err.message, kind: err.kind, label: kindLabel[err.kind] || null });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  /**
   * 体检历史：属于当前访客的资源集合。
   *   GET    /api/history        当前访客的历史（新 → 旧），?limit= 默认 30、最多 100
   *   DELETE /api/history/:id    从自己的历史中移除（报告本身保留，其他访客不受影响）
   * /api/analyses 为兼容旧版前端保留的同义列表接口。
   */
  const listHistory = wrap(async (req, res) => {
    if (visitors.legacyPending) await visitors.claimLegacy(req.visitorId, await store.allIds());
    res.json(await store.summaries(await visitors.analysisIds(req.visitorId), Math.min(100, Number(req.query.limit) || 30)));
  });
  r.get('/history', listHistory);
  r.get('/analyses', listHistory);

  r.delete(
    '/history/:id',
    wrap(async (req, res) => {
      const removed = await visitors.removeAnalysis(req.visitorId, req.params.id);
      if (!removed) return res.status(404).json({ error: '历史中没有这条记录' });
      res.status(204).end();
    }),
  );

  r.get(
    '/analyses/:id',
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      // 通过分享链接打开的报告自动加入当前访客的历史（对话仍按访客隔离）
      await visitors.ensureAnalysis(req.visitorId, a.id);
      res.json(a);
    }),
  );

  r.get(
    '/analyses/:id/geojson',
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      res.setHeader('Content-Disposition', `attachment; filename="life-circle-${a.id}.geojson"`);
      res.json(toGeoJSON(a));
    }),
  );

  /**
   * 流式多轮问答（SSE over POST）：事件 meta（回答方式与地图高亮）/ delta（增量文字）/ done（完整回答）/ fail。
   * 客户端断开时中止上游大模型请求；已生成的内容仍写入对话记录。
   */
  r.post(
    '/analyses/:id/ask/stream',
    express.json(),
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      const question = String(req.body?.question || '')
        .trim()
        .slice(0, 300);
      if (!question) return res.status(400).json({ error: '问题不能为空' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      const send = (event, data) => !res.writableEnded && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const abort = new AbortController();
      res.on('close', () => !res.writableEnded && abort.abort());
      try {
        const history = await visitors.chat(req.visitorId, a.id);
        const reply = await answerStream(a, question, history, {
          thinking: req.body?.thinking === true,
          signal: abort.signal,
          onReasoning: (text) => send('reasoning', { text }),
          onMeta: (m) => send('meta', m),
          onDelta: (text) => send('delta', { text }),
        });
        if (reply.answer) {
          await visitors.appendChat(
            req.visitorId,
            a.id,
            { role: 'user', text: question },
            {
              role: 'bot',
              text: reply.answer,
              highlights: reply.highlights,
              mode: reply.mode,
              model: reply.model || null,
              // 思考链只用于展示，不再发回模型（DeepSeek 要求无工具调用时历史中不带 reasoning_content）
              ...(reply.reasoning ? { reasoning: reply.reasoning.slice(0, 20000), thinkingMs: reply.thinkingMs } : {}),
            },
          );
        }
        send('done', reply);
      } catch (err) {
        console.error('[ask/stream]', err);
        send('fail', { message: err.message });
      } finally {
        res.end();
      }
    }),
  );

  /** 当前访客在这份报告下的对话记录（其他访客互不可见） */
  r.get(
    '/analyses/:id/chat',
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      res.json({ messages: await visitors.chat(req.visitorId, a.id) });
    }),
  );

  r.delete(
    '/analyses/:id/chat',
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      await visitors.clearChat(req.visitorId, a.id);
      res.json({ messages: [] });
    }),
  );

  /** 多轮问答：带上该访客在这份报告下的历史对话 */
  r.post(
    '/analyses/:id/ask',
    express.json(),
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      const question = String(req.body?.question || '')
        .trim()
        .slice(0, 300);
      if (!question) return res.status(400).json({ error: '问题不能为空' });
      const history = await visitors.chat(req.visitorId, a.id);
      const reply = await answer(a, question, history);
      await visitors.appendChat(
        req.visitorId,
        a.id,
        { role: 'user', text: question },
        { role: 'bot', text: reply.answer, highlights: reply.highlights, mode: reply.mode, model: reply.model || null },
      );
      res.json(reply);
    }),
  );

  /**
   * 测时探针「实测验证」：对地图上任意一点调用 1 次批量步行算路（与训练距离场同一接口），
   * 返回中心点到该点的真实步行距离，供前端与插值估算值对比。
   */
  r.post(
    '/analyses/:id/probe',
    express.json(),
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      const p = { lng: Number(req.body?.lng), lat: Number(req.body?.lat) };
      if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return res.status(400).json({ error: '坐标无效' });
      const s = client.session('probe');
      const m = await routeMatrixWalking(s, [a.center], [p], { maxElements: config.baidu.matrixMaxElements });
      const e = m[0][0];
      if (!e) {
        const d = s.stats.degradations[0];
        const offline = !client.online;
        return res.status(offline ? 503 : 502).json({
          error: offline ? '离线回放模式下无法实测：录制数据中没有这个点，配置服务端 AK 后可用' : `实测失败：${d?.message || '百度未返回该点的步行路线'}`,
          kind: d?.reason || null,
        });
      }
      res.json({
        distance: e.distance,
        duration: e.duration,
        source: s.stats.cache ? 'cache' : s.stats.replay ? 'replay' : 'network',
        requests: s.stats.requests,
      });
    }),
  );

  r.post(
    '/analyses/:id/polish',
    wrap(async (req, res) => {
      const a = await store.get(req.params.id);
      if (!a) return res.status(404).json({ error: '体检记录不存在' });
      if (!llmEnabled()) return res.json({ text: null, reason: '未配置大模型（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），已使用规则引擎报告' });
      const text = await polishReport(a);
      res.json({ text, reason: text ? null : '大模型调用失败，已回退规则引擎报告' });
    }),
  );

  r.get(
    '/compare',
    wrap(async (req, res) => {
      const ids = [
        ...new Set(
          String(req.query.ids || '')
            .split(',')
            .filter(Boolean),
        ),
      ].slice(0, MAX_COMPARE);
      const list = (await Promise.all(ids.map((id) => store.get(id)))).filter(Boolean);
      // 分享的对比链接：其中的报告同样加入当前访客的历史，便于之后调整对比组合
      for (const a of list) await visitors.ensureAnalysis(req.visitorId, a.id);
      res.json({ metrics: metricMeta(), rows: list.map(buildCompareRow), max: MAX_COMPARE });
    }),
  );

  r.use((err, req, res, _next) => {
    console.error('[api]', err.message);
    res
      .status(err.status || (err.kind === 'no_result' ? 404 : err.kind === 'unavailable' ? 503 : 500))
      .json({ error: err.message, kind: err.kind, label: kindLabel[err.kind] || null });
  });
  return r;
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
