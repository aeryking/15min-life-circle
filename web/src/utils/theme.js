import { reactive, ref } from 'vue';

/**
 * 可视化配色（经 dataviz 校验脚本验证，浅色 / 深色两套独立选定，而不是简单反色）
 *
 * 地图设施按「维度」着色（6 色）：
 *  - 浅色（底 #fcfcfb）：全配对正常视觉 ΔE 15.6 ≥ 15；CVD ΔE 6.9
 *  - 深色（底 #1b2230）：全配对正常视觉 ΔE 15.1 ≥ 15；CVD ΔE 6.2；对比度均 ≥ 3:1
 * CVD 处于 6–8 区间，因此地图标记始终配合「图标 + 名称 + 图例」二级编码，颜色从不单独承载含义。
 *
 * 所有导出的配色对象都是响应式的：切换主题时原地替换取值，图表 computed 与地图图层会自动重算。
 */
export const PALETTES = {
  light: {
    dimensions: { medical: '#e34948', education: '#2a78d6', shopping: '#008300', elderly: '#4a3aa7', transit: '#eda100', leisure: '#1baf7a' },
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'],
    profiles: { adult: '#1c5cab', elderly: '#eb6834', child: '#1baf7a' },
    status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
    chart: {
      primary: '#0f172a',
      secondary: '#475569',
      muted: '#8391a7',
      grid: '#e9edf3',
      axis: '#cfd6e2',
      tooltipBg: '#ffffff',
      surface: '#ffffff',
      emphasis: '#1c5cab',
    },
    sequential: ['#eef4fc', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'],
    map: {
      band: '#2a78d6',
      bandOpacity: 0.1,
      blind: '#5b6472',
      blindSevere: '#2b303a',
      // 隐性盲区虚线轮廓：对底图与灰色盲区填充的对比度均 ≥ 3:1
      hidden: '#b42318',
      circle: '#8391a7',
      residential: '#94a3b8',
      cellOk: '#86b6ef',
      highlight: '#0d366b',
      siting: '#eb6834',
      sitingAlt: '#ec835a',
      pinRing: '#ffffff',
    },
  },
  dark: {
    dimensions: { medical: '#e34948', education: '#2a78d6', shopping: '#008300', elderly: '#dc3bb1', transit: '#c98500', leisure: '#1baf7a' },
    series: ['#3987e5', '#d95926', '#199e70', '#c98500'],
    profiles: { adult: '#5598e7', elderly: '#d95926', child: '#199e70' },
    status: { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' },
    chart: {
      primary: '#e8edf5',
      secondary: '#aab4c3',
      muted: '#7c889b',
      grid: '#2a3344',
      axis: '#3a4558',
      tooltipBg: '#1b2230',
      surface: '#161c26',
      emphasis: '#86b6ef',
    },
    sequential: ['#1a2334', '#1c3150', '#1f4270', '#255896', '#2f6fbe', '#4f8fdf', '#86b6ef'],
    map: {
      band: '#3987e5',
      bandOpacity: 0.13,
      blind: '#a3adbd',
      blindSevere: '#d4dae3',
      hidden: '#ff8a80',
      circle: '#9aa6b8',
      residential: '#7c889b',
      cellOk: '#3987e5',
      highlight: '#86b6ef',
      siting: '#ff8a4c',
      sitingAlt: '#ec835a',
      pinRing: '#161c26',
    },
  },
};

const THEME_KEY = 'lc-theme';

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // 隐私模式下 localStorage 不可用
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const theme = ref(initialTheme());

const clone = (p) => JSON.parse(JSON.stringify(p));
const current = clone(PALETTES[theme.value]);

export const DIMENSION_COLORS = reactive(current.dimensions);
export const SERIES = reactive(current.series);
export const PROFILE_COLORS = reactive(current.profiles);
export const STATUS = reactive(current.status);
export const CHART_TEXT = reactive(current.chart);
export const MAP_COLORS = reactive(current.map);
export const SEQUENTIAL = reactive(current.sequential);

/** 切换主题：更新 <html data-theme>、持久化，并原地替换全部响应式配色 */
export function applyTheme(t) {
  theme.value = t === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme.value;
  try {
    localStorage.setItem(THEME_KEY, theme.value);
  } catch {
    // 忽略
  }
  const p = PALETTES[theme.value];
  Object.assign(DIMENSION_COLORS, p.dimensions);
  SERIES.splice(0, SERIES.length, ...p.series);
  Object.assign(PROFILE_COLORS, p.profiles);
  Object.assign(STATUS, p.status);
  Object.assign(CHART_TEXT, p.chart);
  Object.assign(MAP_COLORS, p.map);
  SEQUENTIAL.splice(0, SEQUENTIAL.length, ...p.sequential);
}

export const toggleTheme = () => applyTheme(theme.value === 'dark' ? 'light' : 'dark');

export const CATEGORY_ICONS = {
  market: '🥬',
  pharmacy: '💊',
  primary_school: '🏫',
  kindergarten: '🧸',
  clinic: '🏥',
  elderly: '👴',
  supermarket: '🛒',
  transit: '🚌',
  park: '🌳',
  residential: '🏠',
};

/** 单色相顺序色阶（蓝，浅 → 深），用于绕行系数等量级编码 */
export const BLUE_RAMP = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
];

export function gradeStatus(score) {
  if (score >= 85) return { key: 'good', label: '优秀', icon: '●' };
  if (score >= 70) return { key: 'good', label: '良好', icon: '●' };
  if (score >= 60) return { key: 'warning', label: '合格', icon: '▲' };
  return { key: 'critical', label: '待提升', icon: '■' };
}
