import { routeMatrixWalking, reverseGeocode } from '../baidu/services.js';
import { haversine } from '../geo/geo.js';
import { CATEGORY_MAP, CRITICAL_KEYS } from './categories.js';
import { config } from '../config.js';

/**
 * 补短板选址推荐：最大覆盖选址模型（MCLP）+ 候选点实测择优
 *
 * 需求点：该类设施的盲区点位。权重 = 1（网格）或 3（居住小区，作为人口代理）。
 * 候选点：生活圈内所有分析网格点。覆盖判定：估计步行距离（直线 × 实测标定绕行系数）≤ 1 km。
 *
 *  ① 贪心求出估计覆盖权重最高、彼此间隔 ≥ 200 m 的 3 个候选位置；
 *  ② 对每个候选位置各发起一次「1 × 需求点」批量算路，得到**实测**覆盖；
 *  ③ 选实测覆盖权重最大者为首选方案（估算与实测不一致时以实测为准）；
 *  ④ 在剩余未覆盖需求上贪心求备选方案；
 *  ⑤ 逆地理编码给出可读位置描述。
 */
export async function recommendSites(session, { blind, maxSites = 2, threshold = 1000, shortlist = 3 }) {
  const lam = blind.metrics.lambdaLocal || 1.35;
  const candidates = blind.points.filter((p) => p.kind === 'cell');
  const out = [];

  for (const key of CRITICAL_KEYS) {
    // 居住小区排在前面：实测时（每次最多 50 个需求点）优先覆盖有人居住的位置，且下标与实测结果一一对应
    const demand = blind.points
      .filter((p) => p.cats[key].status === 'blind')
      .map((p) => ({ ...p, w: p.kind === 'residential' ? 3 : 1 }))
      .sort((a, b) => b.w - a.w);
    if (!demand.length) continue;
    const totalW = demand.reduce((s, d) => s + d.w, 0);
    const estCover = (c, skip = new Set()) => {
      const hits = [];
      demand.forEach((d, i) => !skip.has(i) && haversine(c, d) * lam <= threshold && hits.push(i));
      return hits;
    };
    const weight = (idx) => idx.reduce((s, i) => s + demand[i].w, 0);

    // ① 估计覆盖最高、空间分散的候选短名单
    const ranked = candidates.map((c) => ({ c, hits: estCover(c) })).sort((a, b) => weight(b.hits) - weight(a.hits));
    const picks = [];
    for (const r of ranked) {
      if (weight(r.hits) <= 0 || picks.length >= shortlist) break;
      if (picks.every((p) => haversine(p.c, r.c) >= 200)) picks.push(r);
    }
    if (!picks.length) continue;

    // ②③ 候选点实测择优
    const tested = demand.slice(0, config.baidu.matrixMaxElements);
    let verifiedAll = false;
    for (const pk of picks) {
      try {
        const m = await routeMatrixWalking(session, [pk.c], tested);
        const covered = [];
        m[0].forEach((e, j) => Number.isFinite(e?.distance) && e.distance <= threshold && covered.push(j));
        pk.verified = { tested: tested.length, measured: m[0].filter((e) => Number.isFinite(e?.distance)).length, covered: covered.length, idx: covered };
        verifiedAll = true;
      } catch (err) {
        session.degrade('siting', err.kind || 'error', { message: err.message, fallback: 'estimate-only' });
      }
    }
    const score = (pk) => (pk.verified ? weight(pk.verified.idx) : weight(pk.hits));
    picks.sort((a, b) => score(b) - score(a));
    const best = picks[0];
    const coveredIdx = new Set(best.verified ? best.verified.idx : best.hits);
    const sites = [site(best.c, [...coveredIdx], demand, best.verified)];

    // ④ 备选方案：在剩余需求上继续贪心（估算）
    for (let s = 1; s < maxSites; s++) {
      let alt = null;
      for (const c of candidates) {
        const hits = estCover(c, coveredIdx);
        if (!alt || weight(hits) > weight(alt.hits)) alt = { c, hits };
      }
      if (!alt || weight(alt.hits) <= 0) break;
      alt.hits.forEach((h) => coveredIdx.add(h));
      sites.push(site(alt.c, alt.hits, demand, null));
    }

    // ⑤ 位置描述
    for (const st of sites) {
      try {
        const rg = await reverseGeocode(session, st);
        st.address = rg.address;
        st.description = rg.sematicDescription;
        st.street = rg.component?.street || '';
      } catch {
        st.address = '';
      }
    }

    const primaryW = weight([...new Set(best.verified ? best.verified.idx : best.hits)]);
    const cellsBlind = demand.filter((d) => d.kind === 'cell').length;
    const cellsFixed = [...(best.verified ? best.verified.idx : best.hits)].filter((i) => demand[i].kind === 'cell').length;
    out.push({
      category: key,
      name: CATEGORY_MAP[key].name,
      short: CATEGORY_MAP[key].short,
      demandPoints: demand.length,
      demandResidential: demand.filter((d) => d.kind === 'residential').length,
      sites,
      shortlist: picks.map((p) => ({ lng: p.c.lng, lat: p.c.lat, estimated: p.hits.length, verified: p.verified?.covered ?? null })),
      verified: best.verified ? { tested: best.verified.tested, measured: best.verified.measured, covered: best.verified.covered } : null,
      basis: verifiedAll && best.verified ? 'verified' : 'estimate',
      // 首选方案可消除的盲区需求比例（以实测为准）
      reduction: Math.round((primaryW / totalW) * 1000) / 10,
      reductionAll: Math.round((weight([...coveredIdx]) / totalW) * 1000) / 10,
      blindBefore: blind.categories[key].blindRatio,
      blindAfterEstimate: Math.round(blind.categories[key].blindRatio * (1 - cellsFixed / Math.max(1, cellsBlind)) * 1000) / 1000,
    });
  }
  return out.sort((a, b) => b.demandResidential - a.demandResidential || b.demandPoints - a.demandPoints);
}

function site(c, idx, demand, verified) {
  return {
    lng: c.lng,
    lat: c.lat,
    coveredPoints: idx.length,
    coveredResidential: idx
      .map((i) => demand[i])
      .filter((d) => d.kind === 'residential')
      .map((d) => d.name),
    basis: verified ? 'verified' : 'estimate',
  };
}
