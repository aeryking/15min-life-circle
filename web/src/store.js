import { reactive, computed, markRaw } from 'vue';
import { api, analyzeStream } from './api.js';

const STAGES = [
  { key: 'resolve', name: '解析位置' },
  { key: 'isochrone', name: '等时圈采样' },
  { key: 'pois', name: '多源 POI' },
  { key: 'access', name: '最近设施实测' },
  { key: 'blind', name: '盲区识别' },
  { key: 'siting', name: '选址推荐' },
  { key: 'report', name: '生成报告' },
];

export const state = reactive({
  config: null,
  configError: null,
  center: null,
  centerLabel: '',
  params: { minutes: 15, tier: 'standard', adultSpeed: 1.2, elderlySpeed: 0.9, childSpeed: 1.0, threshold: 1000 },
  running: false,
  progress: 0,
  message: '',
  stageDone: {},
  error: null,
  partial: {},
  result: null,
  history: [],
  layers: {
    bands: true,
    adult: true,
    elderly: true,
    child: true,
    circle: true,
    samples: false,
    pois: true,
    blind: true,
    blindCells: false,
    blindHidden: true,
    residential: true,
    siting: true,
  },
  poiFilter: {},
  blindCategory: 'all',
  tab: 'overview',
  mapMode: 'select',
  highlights: [],
  focus: null,
  view: 'main',
  compareIds: [],
  historyQuery: '',
  autoPrint: false,
  // 左侧「选点与参数」面板：默认展开，不记忆（每次打开页面都是展开的）
  leftCollapsed: false,
  notice: null,
  probe: null,
});

export const stages = STAGES;

/** 当前用于渲染的数据：完成后用完整结果，运行中用已到达的阶段数据 */
export const view = computed(() => {
  if (state.result) return state.result;
  const p = state.partial;
  if (!p.resolve) return null;
  return {
    partial: true,
    ...p.resolve,
    isochrone: p.isochrone || null,
    pois: p.pois?.pois || [],
    residential: p.pois?.residential || [],
    access: p.pois?.access || [],
    blind: p.blind || null,
    siting: p.siting || [],
  };
});

export async function loadConfig() {
  try {
    state.config = await api.config();
    // 默认只显示需重点关注的设施，高密度类别（超市 / 公交 / 公园）按需开启，避免地图过载
    const dense = new Set(['supermarket', 'transit', 'park']);
    for (const c of state.config.categories) state.poiFilter[c.key] = !dense.has(c.key);
    const preset = state.config.presets[0];
    if (preset && !state.center) selectPreset(preset);
    refreshHistory();
  } catch (err) {
    state.configError = err.message;
  }
}

export function selectPreset(p) {
  state.center = { lng: p.lng, lat: p.lat };
  state.centerLabel = p.name;
  state.presetKey = p.key;
  state.focus = { lng: p.lng, lat: p.lat, zoom: 15, t: Date.now() };
}

export function setCenter(p, label = '') {
  state.center = { lng: Math.round(p.lng * 1e6) / 1e6, lat: Math.round(p.lat * 1e6) / 1e6 };
  state.centerLabel = label;
  state.presetKey = null;
}

let cancel = null;

export function startAnalysis() {
  if (!state.center || state.running) return;
  cancel?.();
  Object.assign(state, {
    running: true,
    progress: 0,
    message: '连接服务…',
    stageDone: {},
    error: null,
    partial: {},
    result: null,
    highlights: [],
    probe: null,
  });
  state.tab = 'overview';
  cancel = analyzeStream(
    { ...state.center, name: state.centerLabel, ...state.params },
    {
      onProgress: (e) => {
        state.progress = Math.max(state.progress, e.progress);
        state.message = e.message;
        if (e.stage && e.progress >= 1) state.stageDone[e.stage] = true;
      },
      onStage: (e) => {
        // 大体量结果数据不做深度响应式代理（只替换引用），显著降低渲染与地图绘制开销
        state.partial[e.stage] = markRaw(e.data);
        state.stageDone[e.stage] = true;
        if (e.stage === 'pois') state.stageDone.access = true;
      },
      onDone: (result) => {
        state.result = markRaw(result);
        state.running = false;
        state.progress = 1;
        state.message = result.reused ? '已复用近期相同参数的体检结果' : '体检完成';
        STAGES.forEach((s) => (state.stageDone[s.key] = true));
        refreshHistory();
      },
      onFail: (e) => {
        state.running = false;
        state.error = e.label ? `${e.label}：${e.message}` : e.message;
      },
    },
  );
}

export async function openAnalysis(id) {
  const r = markRaw(await api.analysis(id));
  Object.assign(state, { result: r, partial: {}, error: null, running: false, highlights: [], probe: null, view: 'main' });
  state.center = r.center;
  state.centerLabel = r.name;
  state.focus = { ...r.center, zoom: 15, t: Date.now() };
}

// 只采用最后一次请求的结果：并发刷新时，较早发出、较晚返回的旧列表不会覆盖新列表
let historySeq = 0;
export async function refreshHistory() {
  const seq = ++historySeq;
  let list = [];
  try {
    list = await api.history();
  } catch {
    // 读取失败时显示为空
  }
  if (seq === historySeq) state.history = list;
}
