/**
 * 步行距离场的空间插值（不获取底层路网）。
 *
 * 输入：中心点到分散采样点的 API 实测步行距离 d_net，以及直线距离 r。
 * 支持两种插值量，由留一交叉验证（LOOCV）自动选择：
 *   - lambda：绕行系数 λ = d_net / r，d̂(x) = λ̂(x) · r(x)。适合路网均匀、绕行随距离成比例的区域；
 *   - excess：绕行增量 e = d_net − r，d̂(x) = r(x) + ê(x)。适合存在河流、铁路、封闭大院等
 *            「一次性绕行」屏障的区域（越过屏障后增量沿射线基本不变，而 λ 会随距离衰减）。
 *
 * 插值核：极坐标各向异性 IDW。距离度量 d² = Δr² + α·(r̄·Δθ)²，α 控制角向与径向邻近的相对权重。
 * 超参数 (mode, power, α, k) 在候选集中以 LOOCV 平均绝对误差最小为准则自动选取。
 */

export const MIN_STRAIGHT = 60;

/**
 * @param {Array<{x:number,y:number,dNet:number}>} samples 局部平面坐标（米）
 * @param {{mode?:'lambda'|'excess', power?:number, alpha?:number, k?:number}} params
 */
export function createDistanceField(samples, { mode = 'lambda', power = 2, alpha = 1, k = 8 } = {}) {
  const pts = samples.map((s) => {
    const r = Math.hypot(s.x, s.y);
    return { r, th: Math.atan2(s.y, s.x), v: mode === 'lambda' ? s.dNet / r : s.dNet - r };
  });
  const fallback = pts.length ? median(pts.map((p) => p.v)) : mode === 'lambda' ? 1.35 : 0;

  function value(x, y, exclude = -1) {
    const r = Math.hypot(x, y);
    const th = Math.atan2(y, x);
    const cand = [];
    for (let i = 0; i < pts.length; i++) {
      if (i === exclude) continue;
      const p = pts[i];
      let dth = Math.abs(th - p.th);
      if (dth > Math.PI) dth = 2 * Math.PI - dth;
      const rm = (r + p.r) / 2;
      cand.push([(r - p.r) ** 2 + alpha * (rm * dth) ** 2, p.v]);
    }
    if (!cand.length) return fallback;
    cand.sort((a, b) => a[0] - b[0]);
    let wsum = 0;
    let vsum = 0;
    for (let i = 0; i < Math.min(k, cand.length); i++) {
      const [d2, v] = cand[i];
      if (d2 < 1) return v;
      const w = 1 / d2 ** (power / 2);
      wsum += w;
      vsum += w * v;
    }
    return vsum / wsum;
  }

  /** 预测 (x, y) 处的步行距离（米），保证不小于直线距离 */
  function predict(x, y, exclude = -1) {
    const r = Math.hypot(x, y);
    if (r < 1) return 0;
    const v = value(x, y, exclude);
    const d = mode === 'lambda' ? v * r : r + v;
    return Math.max(r, d);
  }

  return { predict, params: { mode, power, alpha, k }, size: pts.length };
}

/**
 * 极坐标双线性插值（扇形采样的天然插值方式）：
 * 对方位角 θ、半径 r 的任意点，找到两侧相邻射线，分别沿射线按半径做一维分段线性插值，
 * 再按方位角线性加权融合。径向保留采样的高分辨率（边界加密点都在径向上），角向平滑过渡。
 * 超出射线最远采样点时按该射线末端绕行系数外推。
 *
 * @param {Array<{ray:number, bearing:number, r:number, dNet:number}>} samples
 */
export function createPolarField(samples, rayBearings) {
  const rays = rayBearings
    .map((b, idx) => ({
      bearing: b,
      pts: [{ r: 0, d: 0 }, ...samples.filter((s) => s.ray === idx).map((s) => ({ r: s.r, d: s.dNet }))].sort((a, b) => a.r - b.r),
    }))
    .filter((ray) => ray.pts.length > 1);
  const n = rays.length;

  function along(ray, r, skip) {
    const pts = skip ? ray.pts.filter((p) => p !== skip) : ray.pts;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].r >= r) {
        const a = pts[i - 1];
        const b = pts[i];
        return a.d + ((r - a.r) / Math.max(1e-6, b.r - a.r)) * (b.d - a.d);
      }
    }
    const last = pts[pts.length - 1];
    return last.r > 0 ? (last.d / last.r) * r : r;
  }

  /** 输入为方位角（度，正北 0 顺时针）与半径（米） */
  function predictPolar(bearing, r, skip) {
    if (r < 1 || !n) return r;
    let i1 = n - 1;
    for (let i = 0; i < n; i++) if (rays[i].bearing <= bearing) i1 = i;
    const i2 = (i1 + 1) % n;
    const b1 = rays[i1].bearing;
    let span = rays[i2].bearing - b1;
    if (span <= 0) span += 360;
    let off = bearing - b1;
    if (off < 0) off += 360;
    const t = span ? off / span : 0;
    const d = (1 - t) * along(rays[i1], r, skip) + t * along(rays[i2], r, skip);
    return Math.max(r, d);
  }

  const predict = (x, y) => predictPolar(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, Math.hypot(x, y));
  return { predict, predictPolar, rays, params: { mode: 'polar' } };
}

/** 极坐标插值的留一交叉验证（剔除射线上的单个采样点） */
export function crossValidatePolar(samples, rayBearings, { speed = 1.2, threshold } = {}) {
  const field = createPolarField(samples, rayBearings);
  const errs = [];
  let agree = 0;
  for (const s of samples) {
    const ray = field.rays.find((r) => r.bearing === rayBearings[s.ray]);
    const skip = ray?.pts.find((p) => p.r === s.r && p.d === s.dNet);
    const pred = field.predictPolar(rayBearings[s.ray], s.r, skip);
    errs.push(Math.abs(pred - s.dNet));
    if (threshold && pred <= threshold === s.dNet <= threshold) agree += 1;
  }
  const mae = mean(errs);
  return {
    maeMeters: round1(mae),
    rmseMeters: round1(Math.sqrt(mean(errs.map((e) => e * e)))),
    maeSeconds: round1(mae / speed),
    p90Meters: round1(quantile(errs, 0.9)),
    agreement: threshold ? round3(agree / samples.length) : null,
    n: samples.length,
  };
}

/**
 * 模型集成：各向异性 IDW（捕捉面状空间相关）与 极坐标双线性（保留径向高分辨率）等权平均。
 * 两类模型的误差来源不同，集成在所有样例社区上都不劣于单一模型（见 docs/等时圈生成算法.md）。
 */
export function createEnsembleField(idw, polar, w = 0.5) {
  return {
    predict: (x, y) => w * idw.predict(x, y) + (1 - w) * polar.predict(x, y),
    params: { mode: 'ensemble', idw: idw.params, weight: w },
  };
}

export function crossValidateEnsemble(samples, idwParams, rayBearings, { speed = 1.2, threshold, w = 0.5 } = {}) {
  const idw = createDistanceField(samples, idwParams);
  const polar = createPolarField(samples, rayBearings);
  const errs = [];
  let agree = 0;
  samples.forEach((s, i) => {
    const ray = polar.rays.find((r) => r.bearing === rayBearings[s.ray]);
    const skip = ray?.pts.find((p) => p.r === s.r && p.d === s.dNet);
    const pred = w * idw.predict(s.x, s.y, i) + (1 - w) * polar.predictPolar(rayBearings[s.ray], s.r, skip);
    errs.push(Math.abs(pred - s.dNet));
    if (threshold && pred <= threshold === s.dNet <= threshold) agree += 1;
  });
  const mae = mean(errs);
  return {
    maeMeters: round1(mae),
    rmseMeters: round1(Math.sqrt(mean(errs.map((e) => e * e)))),
    maeSeconds: round1(mae / speed),
    p90Meters: round1(quantile(errs, 0.9)),
    agreement: threshold ? round3(agree / samples.length) : null,
    n: samples.length,
  };
}

/**
 * 留一交叉验证：逐个剔除采样点，用其余点预测其步行距离。
 * @param {number} speed 距离误差换算为时间误差（米/秒）
 * @param {number} threshold 等时圈阈值（米），统计「圈内 / 圈外」判定一致率
 */
export function crossValidate(samples, params, { speed = 1.2, threshold } = {}) {
  const field = createDistanceField(samples, params);
  const errs = [];
  let agree = 0;
  let judged = 0;
  samples.forEach((s, i) => {
    const pred = field.predict(s.x, s.y, i);
    errs.push(Math.abs(pred - s.dNet));
    if (threshold) {
      judged += 1;
      if (pred <= threshold === s.dNet <= threshold) agree += 1;
    }
  });
  const mae = mean(errs);
  return {
    maeMeters: round1(mae),
    rmseMeters: round1(Math.sqrt(mean(errs.map((e) => e * e)))),
    maeSeconds: round1(mae / speed),
    p90Meters: round1(quantile(errs, 0.9)),
    agreement: judged ? round3(agree / judged) : null,
    n: samples.length,
  };
}

export const PARAM_GRID = (() => {
  const grid = [];
  for (const mode of ['lambda', 'excess'])
    for (const power of [1, 2, 3]) for (const alpha of [0.5, 1, 2, 4]) for (const k of [6, 10]) grid.push({ mode, power, alpha, k });
  return grid;
})();

/** 在候选超参数中选择 LOOCV 误差最小者；同时给出各向同性 λ-IDW 基线用于对比 */
export function selectParams(samples, opts) {
  let best = null;
  const trials = [];
  for (const p of PARAM_GRID) {
    const cv = crossValidate(samples, p, opts);
    trials.push({ ...p, maeMeters: cv.maeMeters });
    if (!best || cv.maeMeters < best.cv.maeMeters) best = { params: p, cv };
  }
  const baseline = crossValidate(samples, { mode: 'lambda', power: 2, alpha: 1, k: 8 }, opts);
  trials.sort((a, b) => a.maeMeters - b.maeMeters);
  return { ...best, baseline, trials: trials.slice(0, 8) };
}

export function median(v) {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(v, q) {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;
