import { summary } from '../store/analysisStore.js';
import { CATEGORIES, CRITICAL_KEYS } from './categories.js';

export const MAX_COMPARE = 10;

/**
 * 多社区横向对比的指标体系。每项指标给出取值函数、单位与「越大越好 / 越小越好」方向，
 * 前端据此归一化为 0–100 的「优劣度」做热力矩阵着色，同时展示原始值。
 */
export const COMPARE_METRICS = [
  // —— 综合
  { key: 'score', group: '综合', name: '综合评分', unit: '分', better: 'high', get: (a) => a.score.total },
  { key: 'elderlyScore', group: '综合', name: '老年人视角评分', unit: '分', better: 'high', get: (a) => a.elderlyScore?.total },
  { key: 'childScore', group: '综合', name: '亲子视角评分', unit: '分', better: 'high', get: (a) => a.childScore?.total },
  // —— 六维
  ...['medical', 'education', 'shopping', 'elderly', 'transit', 'leisure'].map((d) => ({
    key: `dim_${d}`,
    group: '六维得分',
    name: { medical: '医疗健康', education: '基础教育', shopping: '生鲜购物', elderly: '养老服务', transit: '公共交通', leisure: '休闲健身' }[d],
    unit: '分',
    better: 'high',
    get: (a) => a.score.dimensions.find((x) => x.key === d)?.score,
  })),
  // —— 可达性
  { key: 'areaAdult', group: '可达范围', name: '成年人可达面积', unit: 'km²', better: 'high', digits: 2, get: (a) => a.isochrone.metrics.areas.adult / 1e6 },
  {
    key: 'areaElderly',
    group: '可达范围',
    name: '老年人可达面积',
    unit: 'km²',
    better: 'high',
    digits: 2,
    get: (a) => a.isochrone.metrics.areas.elderly / 1e6,
  },
  {
    key: 'elderlyShrink',
    group: '可达范围',
    name: '老人可达缩减',
    unit: '%',
    better: 'low',
    digits: 0,
    get: (a) => (1 - a.isochrone.metrics.areas.elderly / a.isochrone.metrics.areas.adult) * 100,
  },
  { key: 'lambda', group: '可达范围', name: '路网绕行系数', unit: '', better: 'low', digits: 2, get: (a) => a.isochrone.metrics.lambda.median },
  { key: 'circleOver', group: '可达范围', name: '直线画圆高估', unit: '%', better: 'low', digits: 0, get: (a) => a.isochrone.metrics.circleOverestimate },
  // —— 服务盲区
  { key: 'blindUnion', group: '服务盲区', name: '综合盲区占比', unit: '%', better: 'low', digits: 1, get: (a) => a.blind.union.blindRatio * 100 },
  ...CRITICAL_KEYS.map((k) => ({
    key: `blind_${k}`,
    group: '服务盲区',
    name: `${{ market: '菜市场', pharmacy: '药店', primary_school: '小学' }[k]}盲区`,
    unit: '%',
    better: 'low',
    digits: 1,
    get: (a) => a.blind.categories[k].blindRatio * 100,
  })),
  {
    key: 'resBlind',
    group: '服务盲区',
    name: '受影响小区占比',
    unit: '%',
    better: 'low',
    digits: 0,
    get: (a) => (a.blind.metrics.residential ? (a.blind.union.residentialBlind / a.blind.metrics.residential) * 100 : 0),
  },
  {
    key: 'hiddenRes',
    group: '服务盲区',
    name: '隐性盲区小区',
    unit: '个',
    better: 'low',
    digits: 0,
    // v4 起提供：直线 1 公里内有设施、实际步行超过 1 公里的小区数
    get: (a) => a.blind.union.residentialHidden ?? null,
  },
  // —— 最近设施步行时间（成年人）
  ...CATEGORIES.map((c) => ({
    key: `near_${c.key}`,
    group: '最近设施步行',
    name: c.short,
    unit: '分钟',
    better: 'low',
    digits: 1,
    get: (a) => a.access.find((x) => x.key === c.key)?.nearest?.minutes?.adult ?? null,
  })),
  // —— 供给密度
  { key: 'poiTotal', group: '供给', name: '民生设施总数', unit: '处', better: 'high', digits: 0, get: (a) => a.pois.length },
  {
    key: 'poiDensity',
    group: '供给',
    name: '圈内设施密度',
    unit: '处/km²',
    better: 'high',
    digits: 0,
    get: (a) => {
      const inCircle = a.access.reduce((s, x) => s + (x.inCircle?.adult || 0), 0);
      return inCircle / Math.max(0.01, a.isochrone.metrics.areas.adult / 1e6);
    },
  },
  {
    key: 'coverage10',
    group: '供给',
    name: '目标时间覆盖率',
    unit: '%',
    better: 'high',
    digits: 0,
    get: (a) => (a.blind.coverage?.length ? (a.blind.coverage.reduce((s, c) => s + c.ratio, 0) / a.blind.coverage.length) * 100 : null),
  },
  // —— 工程
  { key: 'requests', group: '工程', name: 'API 请求', unit: '次', better: 'low', digits: 0, get: (a) => a.engineering.requests },
  { key: 'saved', group: '工程', name: '较逐点调用节省', unit: '%', better: 'high', digits: 1, get: (a) => a.engineering.savedRatio },
];

export function buildCompareRow(a) {
  const values = {};
  for (const m of COMPARE_METRICS) {
    let v = null;
    try {
      v = m.get(a);
    } catch {
      v = null;
    }
    values[m.key] = Number.isFinite(v) ? Math.round(v * 10 ** (m.digits ?? 0)) / 10 ** (m.digits ?? 0) : null;
  }
  return {
    ...summary(a),
    city: a.district?.split(' ')[0] || '',
    dimensions: a.score.dimensions,
    elderlyDimensions: a.elderlyScore?.dimensions || [],
    childDimensions: a.childScore?.dimensions || [],
    siting: a.siting.map((s) => ({ category: s.category, short: s.short, reduction: s.reduction })),
    values,
  };
}

export const metricMeta = () => COMPARE_METRICS.map(({ key, group, name, unit, better, digits }) => ({ key, group, name, unit, better, digits: digits ?? 0 }));
