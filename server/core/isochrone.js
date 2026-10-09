import { routeMatrixWalking } from '../baidu/services.js';
import { createProjection, destination, geometryArea, pointInRing, median, quantile } from '../geo/geo.js';
import {
  createDistanceField,
  createPolarField,
  createEnsembleField,
  crossValidatePolar,
  crossValidateEnsemble,
  selectParams,
  MIN_STRAIGHT,
} from './interpolation.js';
import { createGrid, gridPoint, contourBelow, filterPolygons } from './contour.js';
import { config } from '../config.js';

const DEFAULT_LAMBDA = 1.35;
const MAX_LAMBDA = 4;

/**
 * 基于真实路网的步行等时圈（不获取底层路网数据）
 *
 * 1. 扇形多环采样：以中心为原点，N 个方位 × M 个半径环布点，调用「批量步行算路」一次性测得
 *    中心 → 各采样点的真实步行距离（1 × 50 分块，N×M 个点只需 ⌈N·M/50⌉ 次请求）。
 * 2. 自适应边界加密：每条射线上找到跨越阈值 D 的相邻采样对，按割线法插值出边界估计点，
 *    所有射线、所有人群阈值的新点合并为一次批量请求；迭代 refineRounds 轮逐步逼近边界。
 * 3. 空间插值：对 λ = d_net / d_straight 做各向异性 IDW（LOOCV 自动选参），得到连续的步行距离场。
 * 4. 等值面提取：在规则网格上用 marching squares 提取 5/10/15… 分钟等时带与各人群等时圈，
 *    只保留包含中心或实测可达点的分量（剔除插值伪岛）。
 */
export async function buildIsochrone(session, { center, minutes, profiles, primary = 'adult', tier, onProgress }) {
  const t0 = Date.now();
  const proj = createProjection(center);
  const thresholds = profiles.map((p) => ({ key: p.key, speed: p.speed, meters: p.speed * minutes * 60 }));
  const primaryTh = thresholds.find((t) => t.key === primary) || thresholds[0];
  const Dmax = Math.max(...thresholds.map((t) => t.meters));

  const rays = Array.from({ length: tier.rays }, (_, i) => ({ idx: i, bearing: (360 * i) / tier.rays, samples: [] }));
  const allSamples = [];
  let requests = 0;

  const measure = async (points, phase) => {
    const dests = points.map(({ ray, r }) => destination(center, r, ray.bearing));
    const before = session.counts?.requests ?? session.stats.requests;
    const matrix = await routeMatrixWalking(session, [center], dests, { maxElements: config.baidu.matrixMaxElements });
    requests += (session.counts?.requests ?? session.stats.requests) - before;
    points.forEach(({ ray, r }, j) => {
      const m = matrix[0][j];
      const s = {
        ray: ray.idx,
        bearing: ray.bearing,
        r: Math.round(r),
        lng: dests[j].lng,
        lat: dests[j].lat,
        phase,
        dNet: m ? m.distance : null,
        duration: m ? m.duration : null,
      };
      ray.samples.push(s);
      allSamples.push(s);
    });
  };

  onProgress?.(0.05, `扇形采样：${tier.rays} 方向 × ${tier.rings.length} 环`);
  await measure(
    rays.flatMap((ray) => tier.rings.map((f) => ({ ray, r: f * Dmax }))),
    'ring',
  );

  for (let round = 1; round <= tier.refineRounds; round++) {
    const pts = [];
    for (const ray of rays) {
      for (const th of thresholds) {
        const r = bracketBoundary(ray.samples, th.meters, Dmax);
        if (r && !ray.samples.some((s) => Math.abs(s.r - r) < 25) && !pts.some((p) => p.ray === ray && Math.abs(p.r - r) < 25)) {
          pts.push({ ray, r });
        }
      }
    }
    if (!pts.length) break;
    onProgress?.(0.05 + (0.6 * round) / tier.refineRounds, `边界加密第 ${round} 轮：${pts.length} 个点`);
    await measure(pts, `refine-${round}`);
  }

  // —— 训练样本（λ 限制在 [1, 4]：吸附到路网造成的轻微 <1 视为 1，极端大值多为不可达点）
  const valid = allSamples.filter((s) => Number.isFinite(s.dNet) && s.r >= MIN_STRAIGHT);
  const failed = allSamples.filter((s) => !Number.isFinite(s.dNet)).length;
  const training = valid.map((s) => {
    const { x, y } = proj.toXY(s);
    const lambda = Math.min(MAX_LAMBDA, Math.max(1, s.dNet / s.r));
    s.lambda = Math.round(lambda * 1000) / 1000;
    return { x, y, lambda, dNet: lambda * s.r, ray: s.ray, r: s.r };
  });
  const rayBearings = rays.map((r) => r.bearing);

  let fieldModel;
  let cv = null;
  let degraded = false;
  if (training.length >= 8) {
    const opts = { speed: primaryTh.speed, threshold: primaryTh.meters };
    // IDW 超参数（插值量 λ / 绕行增量、幂次、各向异性、近邻数）由 LOOCV 自动选择，再与极坐标双线性等权集成
    const sel = selectParams(training, opts);
    const polarCv = crossValidatePolar(training, rayBearings, opts);
    const ensembleCv = crossValidateEnsemble(training, sel.params, rayBearings, opts);
    fieldModel = createEnsembleField(createDistanceField(training, sel.params), createPolarField(training, rayBearings));
    cv = {
      best: ensembleCv,
      baseline: sel.baseline,
      params: { mode: 'ensemble', idw: sel.params },
      candidates: { ensemble: ensembleCv, idw: { ...sel.params, ...sel.cv }, polar: polarCv },
      trials: sel.trials,
    };
  } else {
    degraded = true;
    const lam = training.length ? median(training.map((t) => t.lambda)) : DEFAULT_LAMBDA;
    fieldModel = { predict: (x, y) => lam * Math.hypot(x, y), params: { mode: 'constant', lambda: lam }, size: training.length };
    session.degrade('isochrone', 'insufficient_samples', {
      valid: training.length,
      failed,
      fallback: training.length ? 'median-lambda' : 'empirical-lambda',
      lambda: lam,
    });
  }

  // —— 规则网格上的步行距离场
  const extent = Dmax * 1.3;
  const grid = createGrid(extent, tier.isoCell);
  const dnet = new Float64Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const { x, y } = gridPoint(grid, i, j);
      const s = Math.hypot(x, y);
      dnet[i + j * grid.nx] = s < 1 ? 0 : fieldModel.predict(x, y);
    }
  }
  const toLngLat = (x, y) => proj.toLngLat(x, y);

  const reachable = (th) => valid.filter((s) => s.dNet <= th.meters);
  const keepComponent = (th) => (poly) => {
    const ring = poly[0];
    if (pointInRing([center.lng, center.lat], ring)) return true;
    return reachable(th).some((s) => pointInRing([s.lng, s.lat], ring));
  };

  // 各人群等时圈
  const polygons = {};
  const areas = {};
  for (const th of thresholds) {
    const [c] = contourBelow(grid, dnet, [th.meters], toLngLat);
    const geometry = filterPolygons(c.geometry, keepComponent(th));
    polygons[th.key] = geometry;
    areas[th.key] = Math.round(geometryArea(geometry, proj));
  }

  // 主人群的分钟等时带（热力渲染用）
  const step = minutes / 6;
  const bandMinutes = [];
  for (let m = step; m <= minutes * 1.34 + 1e-6; m += step) bandMinutes.push(Math.round(m * 10) / 10);
  const bands = contourBelow(
    grid,
    dnet,
    bandMinutes.map((m) => m * 60 * primaryTh.speed),
    toLngLat,
  ).map((b, i) => ({
    minutes: bandMinutes[i],
    geometry: filterPolygons(b.geometry, keepComponent({ meters: b.threshold })),
  }));

  // 与「直线画圆」对比
  const circleArea = Math.round(Math.PI * primaryTh.meters ** 2);
  const lambdas = training.map((t) => t.lambda);
  const boundary = rays.map((ray) => ({ bearing: ray.bearing, r: bracketBoundary(ray.samples, primaryTh.meters, Dmax, false) }));

  onProgress?.(1, '等时圈生成完成');
  return {
    field: {
      predict: (p) => {
        const { x, y } = proj.toXY(p);
        return fieldModel.predict(x, y);
      },
      lambdaMedian: lambdas.length ? median(lambdas) : DEFAULT_LAMBDA,
      lambdaP75: lambdas.length ? quantile(lambdas, 0.75) : DEFAULT_LAMBDA,
      lambdaP90: lambdas.length ? quantile(lambdas, 0.9) : DEFAULT_LAMBDA,
      lambdaMax: lambdas.length ? Math.max(...lambdas) : DEFAULT_LAMBDA * 1.5,
    },
    grid: {
      nx: grid.nx,
      ny: grid.ny,
      cell: grid.cell,
      x0: grid.x0,
      y0: grid.y0,
      // 前端「任意点步行时间探针」使用：网格节点的步行距离（米，取整）
      dnet: Array.from(dnet, (v) => Math.round(v)),
    },
    polygons,
    bands,
    samples: allSamples.map(({ ray, bearing, r, lng, lat, phase, dNet, duration, lambda }) => ({
      ray,
      bearing,
      r,
      lng,
      lat,
      phase,
      dNet,
      duration,
      lambda: lambda ?? null,
    })),
    boundary,
    metrics: {
      minutes,
      thresholds,
      areas,
      circleArea,
      circleOverestimate: areas[primaryTh.key] ? Math.round(((circleArea - areas[primaryTh.key]) / circleArea) * 1000) / 10 : null,
      equivalentRadius: Math.round(Math.sqrt((areas[primaryTh.key] || 0) / Math.PI)),
      samples: allSamples.length,
      validSamples: valid.length,
      failedSamples: failed,
      requests,
      lambda: {
        median: round3(median(lambdas)),
        p75: round3(quantile(lambdas, 0.75)),
        p90: round3(quantile(lambdas, 0.9)),
        max: round3(Math.max(...lambdas, 1)),
      },
      crossValidation: cv,
      degraded,
      elapsedMs: Date.now() - t0,
    },
  };
}

/**
 * 在一条射线的采样中寻找首次越过阈值 D 的位置（直线半径）。
 * 数据不足时向外扩展采样；extend=false 时只返回插值结果。
 */
export function bracketBoundary(samples, D, Dmax, extend = true) {
  const pts = [{ r: 0, dNet: 0 }, ...samples.filter((s) => Number.isFinite(s.dNet))].sort((a, b) => a.r - b.r);
  if (pts.length < 2) return null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].dNet > D) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (D - a.dNet) / Math.max(1, b.dNet - a.dNet);
      return Math.round(a.r + Math.max(0.05, Math.min(0.95, t)) * (b.r - a.r));
    }
  }
  const last = pts[pts.length - 1];
  if (!extend) return last.r;
  return last.r < Dmax * 2 ? Math.round(last.r * 1.3) : null;
}

const round3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
