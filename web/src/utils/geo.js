/** 前端地理工具：与服务端一致的局部平面投影，用于「任意点步行时间探针」 */
const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function toXY(center, p) {
  const kx = EARTH_R * RAD * Math.cos(center.lat * RAD);
  const ky = EARTH_R * RAD;
  return { x: (p.lng - center.lng) * kx, y: (p.lat - center.lat) * ky };
}

/** 双线性插值读取网格步行距离；超出网格返回 null */
export function probeDistance(result, p) {
  const g = result.isochrone.grid;
  const { x, y } = toXY(result.center, p);
  const fx = (x - g.x0) / g.cell;
  const fy = (y - g.y0) / g.cell;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return null;
  const tx = fx - i;
  const ty = fy - j;
  const v = (a, b) => g.dnet[a + b * g.nx];
  return v(i, j) * (1 - tx) * (1 - ty) + v(i + 1, j) * tx * (1 - ty) + v(i, j + 1) * (1 - tx) * ty + v(i + 1, j + 1) * tx * ty;
}

export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(p, geometry) {
  if (!geometry?.coordinates) return false;
  const pt = [p.lng, p.lat];
  return geometry.coordinates.some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((h) => pointInRing(pt, h)));
}
