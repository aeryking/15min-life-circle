export const km2 = (m2) => (Number.isFinite(m2) ? (m2 / 1e6).toFixed(2) : '–');
export const ha = (m2) => (Number.isFinite(m2) ? (m2 / 1e4).toFixed(1) : '–');
export const pct = (r, d = 1) => (Number.isFinite(r) ? `${(r * 100).toFixed(d)}%` : '–');
export const meters = (m) => (!Number.isFinite(m) ? '–' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const minutes = (m) => (Number.isFinite(m) ? `${m.toFixed(1)} 分钟` : '–');
export const ms = (v) => (!Number.isFinite(v) ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const dateTime = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const METHOD_LABEL = {
  'lower-bound': '下界剪枝（确定）',
  'upper-bound': '上界判定（高置信）',
  verified: 'API 实测核验',
  estimate: '标定估算',
};

export const SOURCE_LABEL = { baidu_place: '百度地点检索', baidu_rgc: '百度逆地理编码', osm: 'OpenStreetMap' };

export const SERVICE_LABEL = {
  'routematrix/v2/walking': '批量步行算路',
  'place/v2/search': '地点检索',
  'place/v2/suggestion': '输入提示',
  'reverse_geocoding/v3': '逆地理编码',
  'geocoding/v3': '地理编码',
  'directionlite/v1/walking': '步行路线规划',
  'geoconv/v2': '坐标转换',
  osm: 'OSM Overpass',
};
