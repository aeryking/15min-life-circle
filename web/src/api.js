async function request(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `请求失败（HTTP ${res.status}）`), { data });
  return data;
}

export const api = {
  config: () => request('/api/config'),
  status: () => request('/api/status'),
  suggest: (q) => request(`/api/suggest?q=${encodeURIComponent(q)}`),
  reverse: (p) => request(`/api/reverse?lng=${p.lng}&lat=${p.lat}`),
  geoconv: (points, from = 'wgs84') => request('/api/geoconv', { method: 'POST', body: JSON.stringify({ points, from }) }),
  history: (limit = 100) => request(`/api/history?limit=${limit}`),
  removeHistory: (id) => request(`/api/history/${id}`, { method: 'DELETE' }),
  analysis: (id) => request(`/api/analyses/${id}`),
  chat: (id) => request(`/api/analyses/${id}/chat`),
  clearChat: (id) => request(`/api/analyses/${id}/chat`, { method: 'DELETE' }),
  ask: (id, question) => request(`/api/analyses/${id}/ask`, { method: 'POST', body: JSON.stringify({ question }) }),
  probe: (id, p) => request(`/api/analyses/${id}/probe`, { method: 'POST', body: JSON.stringify({ lng: p.lng, lat: p.lat }) }),
  polish: (id) => request(`/api/analyses/${id}/polish`, { method: 'POST' }),
  compare: (ids) => request(`/api/compare?ids=${ids.join(',')}`),
  chaos: (cfg) => request('/api/chaos', { method: 'PUT', body: JSON.stringify(cfg) }),
  geojsonUrl: (id) => `/api/analyses/${id}/geojson`,
};

/**
 * 订阅流式体检。返回取消函数。
 * @param {Record<string, any>} params
 * @param {{ onProgress, onStage, onDone, onFail }} handlers
 */
export function analyzeStream(params, { onProgress, onStage, onDone, onFail }) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const es = new EventSource(`/api/analyze/stream?${qs}`);
  let finished = false;
  es.addEventListener('progress', (e) => onProgress?.(JSON.parse(e.data)));
  es.addEventListener('stage', (e) => onStage?.(JSON.parse(e.data)));
  es.addEventListener('done', (e) => {
    finished = true;
    es.close();
    onDone?.(JSON.parse(e.data));
  });
  es.addEventListener('fail', (e) => {
    finished = true;
    es.close();
    onFail?.(JSON.parse(e.data));
  });
  es.onerror = () => {
    if (finished) return;
    finished = true;
    es.close();
    onFail?.({ message: '与服务器的连接中断，请检查服务是否运行' });
  };
  return () => {
    finished = true;
    es.close();
  };
}

/**
 * 流式问答（SSE over POST）：EventSource 只支持 GET，这里用 fetch 读取响应流并按 SSE 格式解析。
 * 依次回调 onMeta({ mode, highlights }) 与 onDelta(text)，最终返回 done 事件中的完整回答。
 */
export async function askStream(id, question, { thinking = false, onMeta, onDelta, onReasoning, signal } = {}) {
  const res = await fetch(`/api/analyses/${id}/ask/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, thinking }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const raw = /^data: (.*)$/m.exec(block)?.[1];
      if (!event || raw === undefined) continue;
      const data = JSON.parse(raw);
      if (event === 'meta') onMeta?.(data);
      else if (event === 'delta') onDelta?.(data.text);
      else if (event === 'reasoning') onReasoning?.(data.text);
      else if (event === 'done') done = data;
      else if (event === 'fail') throw new Error(data.message || '回答失败');
    }
  }
  if (!done) throw new Error('与服务器的连接中断');
  return done;
}
