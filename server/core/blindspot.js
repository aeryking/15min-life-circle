import { routeMatrixWalking } from '../baidu/services.js';
import { haversine, pointInGeometry, median, mean } from '../geo/geo.js';
import { searchCategoryNear, findDuplicate } from './poi.js';
import { contourBelow, filterPolygons } from './contour.js';
import { CATEGORIES, CATEGORY_MAP, CRITICAL_KEYS, BLIND_THRESHOLD_METERS } from './categories.js';
import { config } from '../config.js';

/** 每个点位每类最多考察的候选设施数（直线距离 ≤ 阈值，由近及远） */
const MAX_CANDIDATES = 12;
/** 分支定界每轮每个点位实测的候选数 */
const ROUND_K = 3;

/**
 * 服务盲区识别：生活圈内「周边步行 1 公里内没有菜市场、药店或小学」的点位（任一类缺失即为盲区）。
 *
 * 判定依据「直线距离 ≤ 步行距离」这一必然成立的下界，以及实测标定的绕行上界 λmax：
 *   ① 下界剪枝（严格）：该类设施直线距离全部 > L ⇒ 步行距离必然 > L，判为盲区，零调用；
 *   ② 上界判定（高置信）：最近设施直线距离 × λmax ≤ L ⇒ 即使按本区域实测到的最大绕行也可达；
 *   ③ 分支定界实测（严格）：其余点位按风险排序，把直线 ≤ L 的候选设施由近及远分轮批量实测，
 *      任一候选步行 ≤ L 即判为已覆盖并停止；全部候选实测均 > L 才判为盲区——结论不依赖「最近几个」的假设；
 *   ④ 在线自校准：实测配对出现比中心射线更大的绕行系数时，用新的 λmax 复核 ② 的结论并补测；
 *   ⑤ 盲区复核检索：对盲区片区以片区为中心定点补检索缺失类别的设施（中心检索在设施密集区会被分页截断，
 *      远端设施恰在等时圈边缘），新发现的设施经同一套清洗去重后重新判定，避免「数据缺失」造成的假盲区；
 *   预算用尽仍未完成实测的点，用实测配对标定的局部绕行系数估算，并明确标注为「估算」。
 *
 * 同时给出「直线 1 公里」口径的对照：直线 1 公里内有设施、但真实步行超过 1 公里的点位即「隐性盲区」，
 * 这正是按直线画圈的传统评估发现不了的部分。
 */
export async function detectBlindSpots(
  session,
  { center, proj, isochrone, pois, residential, tier, threshold = BLIND_THRESHOLD_METERS, primary = 'adult', truncated = {}, onProgress },
) {
  const t0 = Date.now();
  const area = isochrone.polygons[primary];
  const L = threshold;
  const lamMed = isochrone.field.lambdaMedian;
  const lamP90 = isochrone.field.lambdaP90;
  const lamMax = Math.max(isochrone.field.lambdaMax || lamP90, lamP90);

  // —— 1. 分析点位：生活圈内规则网格 + 圈内居住小区
  const cell = tier.blindCell;
  const extent = Math.max(...isochrone.metrics.thresholds.map((t) => t.meters)) * 1.05;
  const n = Math.ceil((2 * extent) / cell) + 3;
  const origin = -((n - 1) * cell) / 2;
  const points = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = proj.toLngLat(origin + i * cell, origin + j * cell);
      if (pointInGeometry(p, area)) points.push({ kind: 'cell', i, j, lng: p.lng, lat: p.lat });
    }
  }
  const resPoints = residential
    .filter((r) => pointInGeometry(r, area))
    .map((r) => ({ kind: 'residential', name: r.name, uid: r.uid, lng: r.lng, lat: r.lat, children: r.children || 0 }));
  const all = [...points, ...resPoints];
  const byCat = Object.fromEntries(CRITICAL_KEYS.map((k) => [k, pois.filter((p) => p.category === k)]));

  // —— 2. 下界 / 上界判定，其余进入风险队列
  const queue = [];
  const upper = [];
  for (const pt of all) {
    pt.cats = {};
    for (const key of CRITICAL_KEYS) {
      const e = newEntry(pt, byCat[key], L);
      pt.cats[key] = e;
      // 直线 1 公里内没有该类设施：记录直线最近的一处（位于阈值之外），供清单展示「最近在多远」
      if (!e.cands.length) setResult(e, 'blind', 'lower-bound', null, e.nearestPoi);
      else if (e.straight * lamMax <= L) {
        setResult(e, 'covered', 'upper-bound', e.straight * lamMed, e.cands[0].poi);
        upper.push({ pt, key, entry: e });
      } else {
        const critical = e.straight * lamP90 > L;
        // 风险排序键：临界组（0）优先于极端绕行组（1）；组内临界组按离阈值远近（居住小区优先）、极端组按直线距离降序
        const rank = critical ? Math.abs(e.straight * lamMed - L) - (pt.kind === 'residential' ? 300 : 0) : -e.straight;
        queue.push({ pt, key, entry: e, group: critical ? 0 : 1, rank });
      }
    }
  }
  queue.sort((a, b) => a.group - b.group || a.rank - b.rank);

  // —— 3. 分支定界批量实测
  const budget = { used: 0, max: tier.verifyBudget };
  const pairLambdas = [];
  const run = { rounds: 0, requests: 0, pairs: 0, strategy: null };
  const verifyRounds = async (items, label) => {
    for (;;) {
      const pairs = [];
      for (const q of items) {
        const e = q.entry;
        if (e.hit || e.next >= e.cands.length) continue;
        const take = e.cands.slice(e.next, e.next + ROUND_K);
        if (budget.used + take.length > budget.max) continue;
        budget.used += take.length;
        e.next += take.length;
        for (const c of take) pairs.push({ q, poi: c.poi, s: c.s });
      }
      if (!pairs.length) return;
      run.rounds += 1;
      onProgress?.(Math.min(0.85, 0.2 + run.rounds * 0.12), `${label}：第 ${run.rounds} 轮 ${pairs.length} 组点位-设施配对`);
      const res = await verifyPairs(session, pairs);
      run.requests += res.requests;
      run.strategy ||= res.strategy;
      for (const { pair, net } of res) {
        const e = pair.q.entry;
        if (!Number.isFinite(net)) {
          e.failed.push(pair);
          continue;
        }
        run.pairs += 1;
        e.nets.push({ poi: pair.poi, net });
        if (pair.s > 50) pairLambdas.push(net / pair.s);
        if (net <= L) e.hit = true;
      }
    }
  };
  await verifyRounds(queue, '盲区核验');

  // —— 4. 在线自校准：实测到更大的绕行系数时，复核上界判定的结论
  const lamPairMax = pairLambdas.length ? Math.max(...pairLambdas) : 0;
  let recheckPairs = 0;
  if (lamPairMax > lamMax) {
    const risky = upper.filter((u) => u.entry.straight * lamPairMax > L).sort((a, b) => b.entry.straight - a.entry.straight);
    const before = budget.used;
    await verifyRounds(risky, '自校准补测');
    recheckPairs = budget.used - before;
    for (const u of risky) if (u.entry.next > 0) queue.push(u);
  }
  const lamLocal = pairLambdas.length >= 5 ? median(pairLambdas) : lamMed;
  for (const q of queue) finalize(q.entry, L, lamLocal);

  // —— 5. 盲区复核检索：定点补检索缺失类别的设施，排除「数据缺失」造成的假盲区
  budget.max += tier.recheckPairs ?? 0;
  const recheck = await recheckSearch(session, { all, byCat, center, cell, L, lamMax, lamLocal, tier, truncated, verifyRounds, onProgress });

  // —— 6. 汇总：严格 / 估算、直线口径对照（隐性盲区）
  for (const pt of all) {
    for (const key of CRITICAL_KEYS) {
      const e = pt.cats[key];
      e.straightBlind = !(e.straight <= L);
      e.hidden = e.status === 'blind' && !e.straightBlind;
    }
    pt.missing = CRITICAL_KEYS.filter((k) => pt.cats[k].status === 'blind');
    pt.hiddenMissing = CRITICAL_KEYS.filter((k) => pt.cats[k].hidden);
  }
  const stat = { certain: 0, safe: 0, verified: 0, estimated: 0 };
  const METHOD_STAT = { 'lower-bound': 'certain', 'upper-bound': 'safe', verified: 'verified', estimate: 'estimated' };
  for (const pt of all) for (const key of CRITICAL_KEYS) stat[METHOD_STAT[pt.cats[key].method]] += 1;

  const cells = all.filter((p) => p.kind === 'cell');
  const toLngLat = (x, y) => proj.toLngLat(x, y);
  const owners = buildOwnerRaster({ cells, resPoints, n, origin, cell, proj, area });
  // 灰色区域在细网格上生成：每个细网格点采用最近分析点（网格中心或居住小区）的结论，
  // 小区所在细格的四个角点强制采用该小区的结论 → 实测为盲区的小区必然落在灰色区域内，判为覆盖的小区必然在外
  const blindGeometry = (pred) => {
    const values = new Float64Array(owners.list.length).fill(1);
    owners.list.forEach((o, k) => {
      if (o && pred(o)) values[k] = 0;
    });
    const [g] = contourBelow(owners.grid, values, [0.5], toLngLat);
    return filterPolygons(g.geometry, () => true);
  };
  const ratio = (part, whole) => (whole ? round3(part / whole) : 0);

  const categories = {};
  for (const key of CRITICAL_KEYS) {
    const blindCells = cells.filter((c) => c.cats[key].status === 'blind');
    const resBlind = resPoints.filter((r) => r.cats[key].status === 'blind');
    categories[key] = {
      key,
      name: CATEGORY_MAP[key].name,
      cells: cells.length,
      blindCells: blindCells.length,
      blindRatio: ratio(blindCells.length, cells.length),
      blindAreaM2: blindCells.length * cell * cell,
      // 直线 1 公里口径对照与隐性盲区（直线看有、实际走不到）
      straightBlindRatio: ratio(cells.filter((c) => c.cats[key].straightBlind).length, cells.length),
      hiddenCells: blindCells.filter((c) => c.cats[key].hidden).length,
      hiddenRatio: ratio(blindCells.filter((c) => c.cats[key].hidden).length, cells.length),
      residentialTotal: resPoints.length,
      residentialBlindRatio: resPoints.length ? ratio(resBlind.length, resPoints.length) : null,
      residentialHidden: resBlind.filter((r) => r.cats[key].hidden).length,
      residentialBlind: resBlind.map((r) => pointDetail(r, key, L)),
      geometry: blindGeometry((c) => c.cats[key].status === 'blind'),
      hiddenGeometry: blindGeometry((c) => c.cats[key].hidden),
      supply: byCat[key].length,
      truncated: Boolean(truncated[key]),
    };
  }
  const anyBlind = cells.filter((c) => c.missing.length);
  const resAnyBlind = resPoints.filter((r) => r.missing.length);
  const union = {
    blindCells: anyBlind.length,
    blindRatio: ratio(anyBlind.length, cells.length),
    blindAreaM2: anyBlind.length * cell * cell,
    severity: [1, 2, 3].map((k) => cells.filter((c) => c.missing.length === k).length),
    residentialTotal: resPoints.length,
    residentialBlind: resAnyBlind.length,
    residentialBlindRatio: resPoints.length ? ratio(resAnyBlind.length, resPoints.length) : null,
    straightBlindRatio: ratio(cells.filter((c) => CRITICAL_KEYS.some((k) => c.cats[k].straightBlind)).length, cells.length),
    hiddenCells: cells.filter((c) => c.hiddenMissing.length).length,
    hiddenRatio: ratio(cells.filter((c) => c.hiddenMissing.length).length, cells.length),
    residentialHidden: resPoints.filter((r) => r.hiddenMissing.length).length,
    geometry: blindGeometry((c) => c.missing.length > 0),
    severeGeometry: blindGeometry((c) => c.missing.length >= 2),
    hiddenGeometry: blindGeometry((c) => c.hiddenMissing.length > 0),
  };
  const patches = extractPatches(cells, n, cell, resPoints);

  // 主结论以「点位」呈现：逐个居住小区列出缺失类别、最近设施与实际步行距离（缺失多者在前）
  const residentialReport = resPoints
    .map((r) => ({
      name: r.name,
      lng: r.lng,
      lat: r.lat,
      missing: r.missing,
      hiddenMissing: r.hiddenMissing,
      cats: Object.fromEntries(CRITICAL_KEYS.map((k) => [k, pointDetail(r, k, L)])),
    }))
    .sort((a, b) => b.missing.length - a.missing.length || b.hiddenMissing.length - a.hiddenMissing.length);

  // 所有类别的覆盖率（估算，零调用）：生活圈内有多少比例的点位在该类设施的目标步行时间内
  const speed = isochrone.metrics.thresholds.find((t) => t.key === primary)?.speed || 1.2;
  const coverage = CATEGORIES.map((cat) => {
    const list = cat.critical ? byCat[cat.key] : pois.filter((p) => p.category === cat.key);
    const limit = cat.targetMinutes * 60 * speed;
    const covered = cells.filter((c) => list.some((p) => haversine(c, p) * lamLocal <= limit)).length;
    return { key: cat.key, name: cat.name, targetMinutes: cat.targetMinutes, ratio: ratio(covered, cells.length) };
  });

  const decided = Object.values(stat).reduce((x, y) => x + y, 0);
  onProgress?.(1, '盲区识别完成');
  return {
    threshold: L,
    cellSize: cell,
    points: all.map((p) => ({
      kind: p.kind,
      name: p.name,
      lng: p.lng,
      lat: p.lat,
      missing: p.missing,
      hiddenMissing: p.hiddenMissing,
      cats: Object.fromEntries(
        CRITICAL_KEYS.map((k) => {
          const e = p.cats[k];
          return [
            k,
            {
              net: e.net,
              straight: round(e.straight),
              status: e.status,
              method: e.method,
              nearest: e.nearest?.name || null,
              hidden: e.hidden,
              rescued: e.rescued || undefined,
            },
          ];
        }),
      ),
    })),
    categories,
    union,
    residential: residentialReport,
    patches,
    coverage,
    addedPois: recheck.added,
    metrics: {
      points: all.length,
      cells: cells.length,
      residential: resPoints.length,
      decisions: stat,
      // 严格结论占比：下界剪枝与实测核验均为确定结论
      exactRatio: ratio(stat.certain + stat.verified, decided),
      pairsVerified: run.pairs,
      pairsPlanned: budget.used,
      budget: budget.max,
      rounds: run.rounds,
      strategy: run.strategy,
      lambdaCenter: round3(lamMed),
      lambdaLocal: round3(lamLocal),
      lambdaMaxCenter: round3(lamMax),
      lambdaMaxPairs: round3(lamPairMax),
      recheckPairs,
      recheckSearch: { ...recheck, added: recheck.added.length },
      requests: run.requests + recheck.requests,
      elapsedMs: Date.now() - t0,
    },
  };
}

function newEntry(pt, list, L) {
  let straight = Infinity;
  let nearestPoi = null;
  const cands = [];
  for (const poi of list) {
    const s = haversine(pt, poi);
    if (s < straight) {
      straight = s;
      nearestPoi = poi;
    }
    if (s <= L) cands.push({ poi, s });
  }
  cands.sort((a, b) => a.s - b.s);
  return {
    straight,
    nearestPoi,
    cands: cands.slice(0, MAX_CANDIDATES),
    next: 0,
    nets: [],
    failed: [],
    hit: false,
    status: null,
    method: null,
    net: null,
    nearest: null,
  };
}

function setResult(e, status, method, net = null, poi = null) {
  Object.assign(e, { status, method, net: round(net), nearest: poi ? { name: poi.name, lng: poi.lng, lat: poi.lat } : e.nearest });
}

/**
 * 实测结束后的判定：命中即覆盖；全部候选实测均 > L 为严格盲区；
 * 预算不足或请求失败而未测完的，按局部绕行系数估算剩余候选并标注「估算」。
 */
function finalize(e, L, lamLocal) {
  const best = e.nets.length ? e.nets.reduce((a, b) => (a.net <= b.net ? a : b)) : null;
  if (e.hit) return setResult(e, 'covered', 'verified', best.net, best.poi);
  const rest = [...e.cands.slice(e.next), ...e.failed];
  if (!rest.length) return setResult(e, 'blind', 'verified', best?.net ?? null, best?.poi ?? e.cands[0]?.poi);
  const est = rest.map((c) => ({ poi: c.poi, net: c.s * lamLocal }));
  const guess = [...e.nets, ...est].reduce((a, b) => (a.net <= b.net ? a : b));
  setResult(e, guess.net <= L ? 'covered' : 'blind', 'estimate', guess.net, guess.poi);
}

/**
 * 盲区复核检索：把各类别的盲区点位按空间邻近聚成片区，按「受影响小区多、面积大、该类检索被截断」排序，
 * 在检索预算内以片区中心定点补检索；新设施去重后并入，受影响点位对新候选重新做上界判定与分支定界实测。
 */
async function recheckSearch(session, { all, byCat, center, cell, L, lamMax, lamLocal, tier, truncated, verifyRounds, onProgress }) {
  const out = { clusters: 0, searches: 0, requests: 0, found: 0, rescued: 0, failures: 0, added: [] };
  const maxSearches = tier.recheckSearches ?? 0;
  if (!maxSearches) return out;
  const jobs = [];
  for (const key of CRITICAL_KEYS) {
    const blindPts = all.filter((p) => p.cats[key].status === 'blind');
    for (const members of clusterPoints(blindPts, cell * 1.6)) {
      const res = members.filter((m) => m.kind === 'residential').length;
      jobs.push({ key, members, priority: res * 3 + members.length + (truncated[key] ? 1000 : 0) });
    }
  }
  jobs.sort((a, b) => b.priority - a.priority);
  const picked = [];
  let cost = 0;
  for (const j of jobs) {
    const c = CATEGORY_MAP[j.key].keywords.length;
    if (cost + c > maxSearches) continue;
    cost += c;
    picked.push(j);
  }
  if (!picked.length) return out;
  onProgress?.(0.88, `盲区复核检索：${picked.length} 个片区定点补检索`);

  const found = await Promise.all(
    picked.map(async (j) => {
      const c = { lng: mean(j.members.map((m) => m.lng)), lat: mean(j.members.map((m) => m.lat)) };
      const spread = Math.max(...j.members.map((m) => haversine(c, m)));
      const r = await searchCategoryNear(session, { key: j.key, center: c, radius: Math.min(3000, spread + L) });
      return { ...j, ...r };
    }),
  );
  out.clusters = picked.length;
  for (const f of found) {
    out.searches += 1;
    out.requests += f.requests;
    out.failures += f.failures;
    for (const p of f.pois) {
      if (findDuplicate(byCat[f.key], p)) continue;
      const poi = { ...p, id: `${f.key}:${p.uid || p.name}`, distance: Math.round(haversine(center, p)), sources: ['baidu_place'], recheck: true };
      byCat[f.key].push(poi);
      out.added.push(poi);
    }
  }
  out.found = out.added.length;
  if (!out.added.length) return out;

  // 受影响点位：对新发现的候选重新判定
  const items = [];
  for (const pt of all) {
    for (const key of CRITICAL_KEYS) {
      const e = pt.cats[key];
      if (e.status !== 'blind') continue;
      const fresh = out.added
        .filter((p) => p.category === key)
        .map((poi) => ({ poi, s: haversine(pt, poi) }))
        .filter((c) => c.s <= L)
        .sort((a, b) => a.s - b.s);
      if (!fresh.length) {
        for (const p of out.added) {
          if (p.category !== key) continue;
          const s = haversine(pt, p);
          if (s < e.straight) {
            e.straight = s;
            if (e.method === 'lower-bound') e.nearest = { name: p.name, lng: p.lng, lat: p.lat };
          }
        }
        continue;
      }
      e.straight = Math.min(e.straight, fresh[0].s);
      if (fresh[0].s * lamMax <= L) {
        setResult(e, 'covered', 'upper-bound', fresh[0].s * lamLocal, fresh[0].poi);
        e.rescued = true;
        continue;
      }
      Object.assign(e, { cands: fresh.slice(0, MAX_CANDIDATES), next: 0, failed: [], hit: false });
      items.push({ pt, key, entry: e });
    }
  }
  await verifyRounds(items, '复核实测');
  for (const q of items) {
    finalize(q.entry, L, lamLocal);
    if (q.entry.status === 'covered') q.entry.rescued = true;
  }
  out.rescued = all.reduce((s, pt) => s + CRITICAL_KEYS.filter((k) => pt.cats[k].rescued).length, 0);
  return out;
}

/** 单链聚类：相距不超过 gap 的点位归入同一片区 */
function clusterPoints(list, gap) {
  const left = new Set(list);
  const groups = [];
  for (const seed of list) {
    if (!left.has(seed)) continue;
    left.delete(seed);
    const members = [seed];
    for (let i = 0; i < members.length; i++) {
      for (const o of left) {
        if (haversine(members[i], o) <= gap) {
          left.delete(o);
          members.push(o);
        }
      }
    }
    groups.push(members);
  }
  return groups;
}

/** 单个点位在某类设施上的判定详情（用于小区清单与报告） */
function pointDetail(p, key, L) {
  const e = p.cats[key];
  return {
    name: p.name,
    lng: p.lng,
    lat: p.lat,
    status: e.status,
    method: e.method,
    net: e.net,
    straight: round(e.straight),
    gap: e.status === 'blind' && Number.isFinite(e.net) ? Math.max(0, e.net - L) : null,
    nearest: e.nearest?.name || null,
    hidden: Boolean(e.hidden),
  };
}

/**
 * 配对批量核验调度：比较「按设施聚合」与「按点位聚合」两种矩阵切分，选择请求数更少者。
 */
export async function verifyPairs(session, pairs) {
  const out = [];
  out.requests = 0;
  if (!pairs.length) return out;
  const max = config.baidu.matrixMaxElements;
  const byPoi = group(pairs, (p) => p.poi.id);
  const byPt = group(pairs, (p) => p.q.pt);
  const cost = (m) => [...m.values()].reduce((s, list) => s + Math.ceil(list.length / max), 0);
  const usePoi = cost(byPoi) <= cost(byPt);
  const groups = usePoi ? byPoi : byPt;
  const before = session.counts?.requests ?? session.stats.requests;

  await Promise.all(
    [...groups.values()].flatMap((list) => {
      const chunks = [];
      for (let i = 0; i < list.length; i += max) chunks.push(list.slice(i, i + max));
      return chunks.map(async (chunk) => {
        const origin = usePoi ? chunk[0].poi : chunk[0].q.pt;
        const dests = chunk.map((p) => (usePoi ? p.q.pt : p.poi));
        const m = await routeMatrixWalking(session, [origin], dests, { maxElements: max });
        chunk.forEach((pair, j) => out.push({ pair, net: m[0][j]?.distance }));
      });
    }),
  );
  out.requests = (session.counts?.requests ?? session.stats.requests) - before;
  out.strategy = usePoi ? 'group-by-facility' : 'group-by-point';
  return out;
}

/** 四邻域连通分量 → 盲区斑块，按受影响小区数与面积排序，作为优先改造片区 */
/** 细网格倍数：灰色区域边界分辨率 = 网格边长 / FINE（标准档 150 m → 50 m，高精度档 110 m → 约 37 m） */
const FINE = 3;

/**
 * 灰色区域的「归属栅格」：细网格上每个点归属于最近的分析点（生活圈外为 null）。
 * 最近邻只在周围 3×3 个粗网格中心与邻近小区中查找；小区所在细格的四个角点强制归属该小区。
 */
function buildOwnerRaster({ cells, resPoints, n, origin, cell, proj, area }) {
  const fc = cell / FINE;
  const N = (n - 1) * FINE + 1;
  const byIdx = new Map(cells.map((c) => [c.i + c.j * n, c]));
  const res = resPoints.map((r) => ({ r, ...proj.toXY(r) }));
  const list = new Array(N * N).fill(null);
  for (let J = 0; J < N; J++) {
    for (let I = 0; I < N; I++) {
      const x = origin + I * fc;
      const y = origin + J * fc;
      if (!pointInGeometry(proj.toLngLat(x, y), area)) continue;
      let best = null;
      let bd = Infinity;
      const i0 = Math.round(I / FINE);
      const j0 = Math.round(J / FINE);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const c = byIdx.get(i0 + di + (j0 + dj) * n);
          if (!c) continue;
          const d = (origin + c.i * cell - x) ** 2 + (origin + c.j * cell - y) ** 2;
          if (d < bd) [bd, best] = [d, c];
        }
      }
      for (const q of res) {
        const d = (q.x - x) ** 2 + (q.y - y) ** 2;
        if (d < bd) [bd, best] = [d, q.r];
      }
      list[I + J * N] = best;
    }
  }
  for (const q of res) {
    const I = Math.floor((q.x - origin) / fc);
    const J = Math.floor((q.y - origin) / fc);
    for (const [a, b] of [
      [I, J],
      [I + 1, J],
      [I, J + 1],
      [I + 1, J + 1],
    ]) {
      if (a > 0 && b > 0 && a < N - 1 && b < N - 1) list[a + b * N] = q.r;
    }
  }
  return { list, grid: { nx: N, ny: N, x0: origin, y0: origin, cell: fc } };
}

function extractPatches(cells, n, cellSize, resPoints) {
  const idx = new Map(cells.map((c) => [c.i + c.j * n, c]));
  const seen = new Set();
  const patches = [];
  for (const c of cells) {
    const k = c.i + c.j * n;
    if (!c.missing.length || seen.has(k)) continue;
    const stack = [c];
    seen.add(k);
    const members = [];
    while (stack.length) {
      const cur = stack.pop();
      members.push(cur);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nk = cur.i + di + (cur.j + dj) * n;
        const nb = idx.get(nk);
        if (nb && nb.missing.length && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nb);
        }
      }
    }
    const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const missing = [...new Set(members.flatMap((m) => m.missing))];
    const radius = Math.sqrt(members.length) * cellSize * 0.75 + cellSize;
    const affected = resPoints.filter((r) => r.missing.length && haversine(r, { lng, lat }) <= radius).map((r) => r.name);
    patches.push({
      lng: round6(lng),
      lat: round6(lat),
      cells: members.length,
      areaM2: members.length * cellSize * cellSize,
      missing,
      missingNames: missing.map((k) => CATEGORY_MAP[k].short),
      affectedResidential: affected,
    });
  }
  return patches.sort((a, b) => b.affectedResidential.length - a.affectedResidential.length || b.cells - a.cells).slice(0, 12);
}

function group(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

const round = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const round3 = (v) => Math.round(v * 1000) / 1000;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
