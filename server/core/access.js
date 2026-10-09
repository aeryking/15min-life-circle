import { routeMatrixWalking } from '../baidu/services.js';
import { pointInGeometry } from '../geo/geo.js';
import { CATEGORIES } from './categories.js';
import { config } from '../config.js';

/**
 * 中心点可达性：每类设施取直线最近的 k 个候选，合并成一次「1 × ≤50」批量算路，
 * 得到中心到每类设施最近一处的真实步行距离，以及各人群 15 分钟圈内的设施数量。
 */
export async function measureAccess(session, { center, pois, isochrone, k = 3, profiles }) {
  const candidates = [];
  for (const cat of CATEGORIES) {
    pois
      .filter((p) => p.category === cat.key)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k)
      .forEach((p) => candidates.push(p));
  }
  const matrix = await routeMatrixWalking(session, [center], candidates, { maxElements: config.baidu.matrixMaxElements });
  const net = new Map(candidates.map((p, j) => [p.id, matrix[0][j]?.distance ?? null]));
  const lam = isochrone.field.lambdaMedian;

  // 给每个 POI 标注步行距离（实测优先，否则用距离场估算）与所在人群圈
  for (const p of pois) {
    const measured = net.get(p.id);
    p.walk = Number.isFinite(measured) ? Math.round(measured) : Math.round(isochrone.field.predict(p) || p.distance * lam);
    p.walkMeasured = Number.isFinite(measured);
    p.inCircle = Object.fromEntries(profiles.map((pr) => [pr.key, pointInGeometry(p, isochrone.polygons[pr.key])]));
  }

  return CATEGORIES.map((cat) => {
    const list = pois.filter((p) => p.category === cat.key);
    const nearest = list.reduce((best, p) => (!best || p.walk < best.walk ? p : best), null);
    return {
      key: cat.key,
      name: cat.name,
      dimension: cat.dimension,
      critical: cat.critical,
      targetMinutes: cat.targetMinutes,
      recommended: cat.recommended,
      total: list.length,
      inCircle: Object.fromEntries(profiles.map((pr) => [pr.key, list.filter((p) => p.inCircle[pr.key]).length])),
      nearest: nearest
        ? {
            name: nearest.name,
            lng: nearest.lng,
            lat: nearest.lat,
            straight: nearest.distance,
            walk: nearest.walk,
            measured: nearest.walkMeasured,
            minutes: Object.fromEntries(profiles.map((pr) => [pr.key, Math.round((nearest.walk / pr.speed / 60) * 10) / 10])),
          }
        : null,
    };
  });
}
