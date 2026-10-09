/**
 * 地理计算工具。坐标统一为 { lng, lat }（BD-09 经纬度），
 * 小范围（< 10 km）分析使用以中心点为原点的局部平面坐标（米），误差 < 0.1%。
 */

const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

/** 球面大圆距离（米） */
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 从 origin 沿方位角 bearing（度，正北为 0，顺时针）前进 distance 米后的点 */
export function destination(origin, distance, bearing) {
  const δ = distance / EARTH_R;
  const θ = bearing * RAD;
  const φ1 = origin.lat * RAD;
  const λ1 = origin.lng * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lng: round6(λ2 / RAD), lat: round6(φ2 / RAD) };
}

export function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * 局部平面投影（等距圆柱近似），用于网格、插值与面积计算。
 * x 向东、y 向北，单位米。
 */
export function createProjection(center) {
  const kx = EARTH_R * RAD * Math.cos(center.lat * RAD);
  const ky = EARTH_R * RAD;
  return {
    center,
    toXY: (p) => ({ x: (p.lng - center.lng) * kx, y: (p.lat - center.lat) * ky }),
    toLngLat: (x, y) => ({ lng: round6(center.lng + x / kx), lat: round6(center.lat + y / ky) }),
  };
}

/** 多边形面积（平方米），ring 为局部平面坐标 [[x,y],...] */
export function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** GeoJSON (Multi)Polygon 面积（平方米），自动扣除内环 */
export function geometryArea(geometry, proj) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const a = ringArea(
        ring.map(([lng, lat]) => {
          const p = proj.toXY({ lng, lat });
          return [p.x, p.y];
        }),
      );
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

/** 射线法判断点是否在环内 */
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点是否在 GeoJSON (Multi)Polygon 内（考虑洞） */
export function pointInGeometry(p, geometry) {
  if (!geometry) return false;
  const pt = [p.lng, p.lat];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((hole) => pointInRing(pt, hole)));
}

/** 方位角（度，0–360） */
export function bearing(a, b) {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const Δλ = (b.lng - a.lng) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function median(values) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(values, q) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

export const toPoint = (p) => ({ lng: Number(p.lng), lat: Number(p.lat) });
