import { watch, nextTick } from 'vue';
import { state, openAnalysis, refreshHistory } from './store.js';

/**
 * 轻量前端路由（History API，无额外依赖）：地址栏与页面状态双向同步。
 *   /                      首页（选点、体检）
 *   /r/:id?tab=assistant   打开某份体检报告，可指定标签页
 *   /r/:id/print           可打印的体检报告
 *   /compare?ids=a,b,c     多社区对比
 *   /history?q=关键词       体检历史（可带搜索词）
 * 服务端已对所有非 /api 路径回退到 index.html，刷新或直接打开链接都能进入对应页面。
 */

const TABS = ['overview', 'facilities', 'blind', 'plan', 'assistant', 'engineering'];
// 全局调试开关在所有页面间保留
const KEEP_PARAMS = ['basemap', 'debug'];

export function parseRoute(loc = window.location) {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(loc.search);
  const m = path.match(/^\/r\/([\w-]+)(\/print)?$/);
  if (m) {
    const route = { name: m[2] ? 'print' : 'report', id: m[1], tab: TABS.includes(q.get('tab')) ? q.get('tab') : 'overview' };
    // 「新窗口打印」：打开报告页后自动弹出打印（参数只读取一次，随后从地址栏去掉）
    if (m[2] && q.get('autoprint') === '1') route.autoprint = true;
    return route;
  }
  if (path === '/compare') return { name: 'compare', ids: (q.get('ids') || '').split(',').filter(Boolean) };
  if (path === '/history') return { name: 'history', q: (q.get('q') || '').slice(0, 60) };
  return { name: 'home' };
}

/** 由当前状态计算应有的地址 */
export function urlFor(s, search = window.location.search) {
  const cur = new URLSearchParams(search);
  const q = new URLSearchParams();
  for (const k of KEEP_PARAMS) if (cur.has(k)) q.set(k, cur.get(k));
  let path = '/';
  if (s.view === 'history') {
    path = '/history';
    if (s.historyQuery?.trim()) q.set('q', s.historyQuery.trim());
  } else if (s.view === 'compare') {
    path = '/compare';
    if (s.compareIds.length) q.set('ids', s.compareIds.join(','));
  } else if (s.result) {
    path = `/r/${s.result.id}${s.view === 'report' ? '/print' : ''}`;
    if (s.view === 'main' && s.tab !== 'overview') q.set('tab', s.tab);
  }
  const qs = q.toString().replace(/%2C/g, ',');
  return qs ? `${path}?${qs}` : path;
}

let applying = false;

/** 按地址恢复页面状态（首次加载、浏览器前进 / 后退） */
async function apply(route) {
  applying = true;
  try {
    if (route.name === 'report' || route.name === 'print') {
      if (state.result?.id !== route.id) await openAnalysis(route.id);
      state.tab = route.tab;
      state.view = route.name === 'print' ? 'report' : 'main';
      if (route.autoprint) state.autoPrint = true;
    } else if (route.name === 'history') {
      state.historyQuery = route.q;
      state.view = 'history';
    } else if (route.name === 'compare') {
      state.compareIds = route.ids;
      state.view = 'compare';
    } else {
      Object.assign(state, { view: 'main', result: null, partial: {}, highlights: [], probe: null });
    }
  } catch {
    state.notice = '这份体检报告不存在或已被删除，已返回首页';
    Object.assign(state, { view: 'main', result: null });
  } finally {
    await nextTick();
    applying = false;
    // 规范化地址（如无效的标签名、404 后回到首页）
    const url = urlFor(state);
    if (url !== currentUrl()) history.replaceState(null, '', url);
  }
}

const currentUrl = () => window.location.pathname + window.location.search;

export async function initRouter() {
  // 先注册：首次按链接打开的报告也会被服务端加入历史，需要刷新列表
  watch(
    () => state.result?.id,
    (id) => id && !state.history.some((h) => h.id === id) && refreshHistory(),
  );
  await apply(parseRoute());
  window.addEventListener('popstate', () => apply(parseRoute()));

  watch(
    // 体检进行中不改地址：完成后直接从旧报告跳到新报告，「后退」不会停在空白的中间态
    () => (state.running ? null : urlFor(state)),
    (url) => {
      if (!url || applying || url === currentUrl()) return;
      // 仅查询参数变化（切换标签、调整对比组合）时替换当前记录，避免「后退」要按很多次
      const samePath = url.split('?')[0] === window.location.pathname;
      history[samePath ? 'replaceState' : 'pushState'](null, '', url);
    },
  );

  // 标签页标题跟随当前报告，便于收藏与多标签页区分
  watch(
    () => [state.view, state.result?.name],
    ([v, name]) => {
      const base = '生活圈体检助手';
      document.title = v === 'compare' ? `多社区对比 · ${base}` : v === 'history' ? `体检历史 · ${base}` : name ? `${name} · ${base}` : base;
    },
    { immediate: true },
  );
}
