import { DIMENSION_COLORS, CATEGORY_ICONS, PROFILE_COLORS, BLUE_RAMP, MAP_COLORS as C } from '../utils/theme.js';
import { METHOD_LABEL, SOURCE_LABEL, meters } from '../utils/format.js';
import { pinUrl, dotUrl, starUrl } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** GeoJSON MultiPolygon → 外环图元列表 */
function polygonPrims(geometry, style) {
  if (!geometry?.coordinates) return [];
  return geometry.coordinates.map((poly) => ({ kind: 'polygon', ring: poly[0], ...style }));
}

export function bandLayer(iso) {
  if (!iso?.bands) return [];
  // 由外向内叠加同一色相的半透明面：越靠近中心叠加越深，形成单色相顺序热力
  return [...iso.bands]
    .sort((a, b) => b.minutes - a.minutes)
    .flatMap((b) => polygonPrims(b.geometry, { fill: C.band, fillOpacity: b.minutes > iso.metrics.minutes ? C.bandOpacity / 2 : C.bandOpacity }));
}

export function profileLayer(iso, key) {
  return polygonPrims(iso?.polygons?.[key], { stroke: PROFILE_COLORS[key], weight: key === 'adult' ? 3 : 2.5, strokeOpacity: 0.95 });
}

export function circleLayer(v) {
  const th = v?.isochrone?.metrics?.thresholds?.find((t) => t.key === 'adult');
  if (!th) return [];
  return [{ kind: 'circle', center: v.center, radius: th.meters, stroke: C.circle, weight: 1.5, dashed: true, strokeOpacity: 0.9 }];
}

export function sampleLayer(iso) {
  if (!iso?.samples) return [];
  return iso.samples.map((s) => {
    const ok = Number.isFinite(s.dNet);
    const lam = s.lambda ?? 1;
    const idx = Math.min(BLUE_RAMP.length - 1, Math.round(((Math.min(lam, 3) - 1) / 2) * (BLUE_RAMP.length - 1)));
    return {
      kind: 'marker',
      lng: s.lng,
      lat: s.lat,
      icon: { url: dotUrl(ok ? BLUE_RAMP[Math.max(3, idx)] : '#d03b3b', 4.5), w: 13, h: 13, ax: 6.5, ay: 6.5 },
      title: ok ? `λ=${lam}` : '采样失败',
      info: ok
        ? `<b>采样点 · ${s.phase === 'ring' ? '扇形环' : '边界加密'}</b><div class="row">方位 ${Math.round(s.bearing)}° · 直线 ${s.r} m</div><div class="row">实测步行 ${s.dNet} m · 绕行系数 λ = ${lam}</div>`
        : '<b>采样失败</b><div class="row">该点由距离场插值兜底</div>',
    };
  });
}

export function poiLayer(v, filter, categories) {
  const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));
  return (v?.pois || [])
    .filter((p) => filter[p.category] !== false)
    .map((p) => {
      const cat = byKey[p.category] || {};
      const color = DIMENSION_COLORS[cat.dimension] || '#475569';
      const walk = Number.isFinite(p.walk)
        ? `${meters(p.walk)}（${p.walkMeasured ? 'API 实测' : '距离场估算'}）· 成人约 ${(p.walk / 1.2 / 60).toFixed(1)} 分钟`
        : `直线 ${meters(p.distance)}`;
      return {
        kind: 'marker',
        lng: p.lng,
        lat: p.lat,
        icon: { url: pinUrl(color, CATEGORY_ICONS[p.category] || '•'), w: 26, h: 33, ax: 13, ay: 32 },
        title: p.name,
        zIndex: cat.critical ? 20 : 10,
        info: `<b>${esc(p.name)}</b><div class="row">${CATEGORY_ICONS[p.category] || ''} ${esc(cat.name || p.category)} · ${esc(p.tag || '')}</div><div class="row">步行 ${walk}</div><div class="row">来源：${p.sources.map((s) => SOURCE_LABEL[s] || s).join(' / ')}</div>`,
      };
    });
}

export function residentialLayer(v) {
  const blindByName = new Map();
  for (const pt of v?.blind?.points || []) if (pt.kind === 'residential') blindByName.set(pt.name, pt);
  return (v?.residential || []).map((r) => {
    const b = blindByName.get(r.name);
    const missing = b?.missing || [];
    return {
      kind: 'marker',
      lng: r.lng,
      lat: r.lat,
      icon: {
        url: dotUrl(missing.length ? C.blind : C.residential, missing.length ? 6 : 4.5, { opacity: missing.length ? 1 : 0.85 }),
        w: missing.length ? 16 : 13,
        h: missing.length ? 16 : 13,
        ax: missing.length ? 8 : 6.5,
        ay: missing.length ? 8 : 6.5,
      },
      title: r.name,
      zIndex: missing.length ? 15 : 5,
      info: `<b>🏠 ${esc(r.name)}</b>${
        b
          ? `<div class="row">${missing.length ? `⚠️ 1 公里步行范围内缺少：${missing.map(nameOf).join('、')}` : '✅ 三类关键设施均在 1 公里步行范围内'}</div>${Object.entries(
              b.cats,
            )
              .map(([k, c]) => `<div class="row">${nameOf(k)}：${c.net ? meters(c.net) : '–'} · ${METHOD_LABEL[c.method] || ''}</div>`)
              .join('')}`
          : '<div class="row">位于 15 分钟生活圈之外，未参与盲区统计</div>'
      }`,
    };
  });
}

const NAMES = { market: '菜市场/生鲜', pharmacy: '药店', primary_school: '小学' };
const nameOf = (k) => NAMES[k] || k;

export function blindLayer(v, category) {
  const b = v?.blind;
  if (!b) return [];
  if (category === 'all') {
    return [
      ...polygonPrims(b.union.geometry, { fill: C.blind, fillOpacity: 0.38, stroke: C.blind, weight: 1, strokeOpacity: 0.7 }),
      ...polygonPrims(b.union.severeGeometry, { fill: C.blindSevere, fillOpacity: 0.3 }),
    ];
  }
  return polygonPrims(b.categories[category]?.geometry, { fill: C.blind, fillOpacity: 0.42, stroke: C.blind, weight: 1, strokeOpacity: 0.7 });
}

/** 隐性盲区：直线 1 公里内有设施、真实步行超过 1 公里的区域，叠加在灰色盲区上的虚线轮廓 */
export function hiddenBlindLayer(v, category) {
  const b = v?.blind;
  if (!b) return [];
  const g = category === 'all' ? b.union.hiddenGeometry : b.categories[category]?.hiddenGeometry;
  return polygonPrims(g, { fill: C.hidden, fillOpacity: 0.08, stroke: C.hidden, weight: 2, strokeOpacity: 0.95, dashed: true });
}

export function blindCellLayer(v, category) {
  return (v?.blind?.points || [])
    .filter((p) => p.kind === 'cell')
    .map((p) => {
      const blind = category === 'all' ? p.missing.length > 0 : p.cats[category]?.status === 'blind';
      return {
        kind: 'marker',
        lng: p.lng,
        lat: p.lat,
        icon: { url: dotUrl(blind ? C.blind : C.cellOk, blind ? 4.5 : 3.5, { opacity: blind ? 1 : 0.9 }), w: 13, h: 13, ax: 6.5, ay: 6.5 },
        info: `<b>分析网格点</b>${Object.entries(p.cats)
          .map(
            ([k, c]) =>
              `<div class="row">${c.status === 'blind' ? '⚠️' : '✅'} ${nameOf(k)}：${c.net ? `步行 ${meters(c.net)}` : c.straight ? `直线已 ${meters(c.straight)}` : '附近无'}${c.hidden ? '（隐性盲区）' : ''} · ${METHOD_LABEL[c.method] || ''}</div>`,
          )
          .join('')}`,
      };
    });
}

export function sitingLayer(v) {
  return (v?.siting || []).flatMap((s) =>
    s.sites.map((site, i) => ({
      kind: 'marker',
      lng: site.lng,
      lat: site.lat,
      icon: { url: starUrl(i === 0 ? C.siting : C.sitingAlt), w: i === 0 ? 34 : 28, h: i === 0 ? 34 : 28, ax: i === 0 ? 17 : 14, ay: i === 0 ? 17 : 14 },
      zIndex: 50,
      title: `建议新增${s.short}`,
      info: `<b>★ 建议新增${esc(s.name)}${s.sites.length > 1 ? `（方案 ${i + 1}）` : ''}</b><div class="row">${esc(site.description || site.address || '')}</div><div class="row">覆盖 ${site.coveredPoints} 个盲区点位${site.coveredResidential.length ? `，含 ${site.coveredResidential.length} 个小区` : ''}</div>${
        i === 0 && s.verified ? `<div class="row">API 实测：${s.verified.covered}/${s.verified.measured} 个需求点步行 ≤ 1 km</div>` : ''
      }`,
    })),
  );
}

/**
 * 地图高亮点（AI 回答「在地图上标出」、测时探针等）。
 * pulse = true 时输出「脉冲标记」：图钉落下并弹跳、地面波纹扩散，便于一眼找到；两种底图均用 DOM 动画实现。
 */
export function highlightLayer(list, { pulse = true } = {}) {
  return (list || []).map((h) => ({
    kind: pulse ? 'pulse' : 'marker',
    color: C.highlight,
    lng: h.lng,
    lat: h.lat,
    icon: { url: pinUrl(C.highlight, '📍', { size: 36 }), w: 36, h: 45, ax: 18, ay: 44 },
    zIndex: 100,
    title: h.name,
    info: `<b>${esc(h.name)}</b>`,
  }));
}
