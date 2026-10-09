import { DIMENSIONS, CATEGORIES, PROFILE_WEIGHTS } from './categories.js';

/**
 * 生活圈评分（0–100）
 *
 * 单类设施得分 = 0.7 × 可达性得分 + 0.3 × 供给得分
 *   可达性：最近一处步行时间 t 与目标时间 T 比较；t ≤ T 满分，T < t ≤ 2.5T 线性下降至 0；缺失为 0
 *   供给：圈内数量 / 建议数量，封顶 1
 * 维度得分 = 维度内各类设施得分均值（医疗/教育/生鲜购物/养老/交通/休闲）
 * 综合得分 = 0.55 × 维度加权均值 + 0.30 × 盲区覆盖率（1 − 任一关键设施盲区占比）+ 0.15 × 类别完整度
 *
 * 人群视角（profile）同时决定两件事：步行时间与圈内数量取该人群步速下的结果；
 * 维度加权均值使用该人群的权重（PROFILE_WEIGHTS，成年人等权）。
 */
export function computeScore({ access, blind, profile = 'adult' }) {
  const catScores = access.map((a) => {
    const t = a.nearest?.minutes?.[profile];
    let accessScore = 0;
    if (Number.isFinite(t)) {
      if (t <= a.targetMinutes) accessScore = 100;
      else accessScore = Math.max(0, 100 * (1 - (t - a.targetMinutes) / (1.5 * a.targetMinutes)));
    }
    const count = a.inCircle?.[profile] ?? 0;
    const supplyScore = Math.min(1, count / a.recommended) * 100;
    const score = Math.round(0.7 * accessScore + 0.3 * supplyScore);
    return {
      key: a.key,
      name: a.name,
      dimension: a.dimension,
      accessScore: Math.round(accessScore),
      supplyScore: Math.round(supplyScore),
      score,
      minutes: t ?? null,
      count,
    };
  });

  const dimensions = DIMENSIONS.map((d) => {
    const list = catScores.filter((c) => c.dimension === d.key);
    return { key: d.key, name: d.name, score: list.length ? Math.round(list.reduce((s, c) => s + c.score, 0) / list.length) : 0 };
  });

  const weights = PROFILE_WEIGHTS[profile] || PROFILE_WEIGHTS.adult;
  for (const d of dimensions) d.weight = weights[d.key] ?? 1;
  const wSum = dimensions.reduce((s, d) => s + d.weight, 0);
  const dimMean = dimensions.reduce((s, d) => s + d.weight * d.score, 0) / wSum;
  // 盲区覆盖：面积口径与居住小区口径各占一半（小区少于 3 个时只看面积），避免空地、水面与住宅同权
  const u = blind?.union;
  const areaCov = u ? 1 - u.blindRatio : 1;
  const resCov = u && u.residentialTotal >= 3 && u.residentialBlindRatio !== null ? 1 - u.residentialBlindRatio : null;
  const coverage = (resCov === null ? areaCov : 0.5 * areaCov + 0.5 * resCov) * 100;
  const completeness = (catScores.filter((c) => c.count > 0).length / CATEGORIES.length) * 100;
  // 向下取整：只有各项均无短板时才给满分
  const total = Math.floor(0.55 * dimMean + 0.3 * coverage + 0.15 * completeness + 1e-9);

  return {
    total,
    grade: total >= 85 ? '优秀' : total >= 70 ? '良好' : total >= 60 ? '合格' : '待提升',
    components: {
      dimensions: Math.round(dimMean),
      coverage: Math.round(coverage),
      completeness: Math.round(completeness),
    },
    dimensions,
    categories: catScores,
    profile,
  };
}
