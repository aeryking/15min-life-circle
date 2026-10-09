import crypto from 'node:crypto';
import { reverseGeocode } from '../baidu/services.js';
import { createProjection, round6 } from '../geo/geo.js';
import { buildIsochrone } from './isochrone.js';
import { collectPois } from './poi.js';
import { measureAccess } from './access.js';
import { detectBlindSpots } from './blindspot.js';
import { recommendSites } from './siting.js';
import { computeScore } from './scoring.js';
import { buildDiagnosis } from './diagnosis.js';
import { getTier } from './tiers.js';
import { SPEED_PROFILES, BLIND_THRESHOLD_METERS, CRITICAL_KEYS } from './categories.js';

// v4：盲区识别改为分支定界严格判定 + 复核检索 + 直线口径对照（隐性盲区）+ 小区点位清单
export const RESULT_VERSION = 6;

/** 规范化并校验分析参数 */
export function normalizeParams(input = {}) {
  const lng = Number(input.lng);
  const lat = Number(input.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 73 || lng > 136 || lat < 3 || lat > 54) {
    throw Object.assign(new Error('中心点坐标无效（需为中国境内 BD-09 经纬度）'), { status: 400 });
  }
  const minutes = clamp(Number(input.minutes) || 15, 5, 30);
  const tier = getTier(input.tier);
  const speeds = { adult: Number(input.adultSpeed), elderly: Number(input.elderlySpeed), child: Number(input.childSpeed) };
  const profiles = SPEED_PROFILES.map((p) => ({ ...p, speed: clamp(Number.isFinite(speeds[p.key]) && speeds[p.key] > 0 ? speeds[p.key] : p.speed, 0.5, 2) }));
  return {
    center: { lng: round6(lng), lat: round6(lat) },
    name: String(input.name || '').slice(0, 60),
    minutes,
    tier: tier.key,
    profiles,
    threshold: clamp(Number(input.threshold) || BLIND_THRESHOLD_METERS, 300, 3000),
  };
}

export function paramsKey(p) {
  // 带上结果版本号：算法或评分口径升级后，不复用旧版本的结果
  return [`v${RESULT_VERSION}`, p.center.lng.toFixed(5), p.center.lat.toFixed(5), p.minutes, p.tier, p.threshold, ...p.profiles.map((x) => x.speed)].join('|');
}

/**
 * 执行一次完整体检。onEvent 会依次收到：
 *   progress（进度）/ stage（阶段完成，附带可先行渲染的数据）/ done（完整结果）
 */
export async function runAnalysis(client, rawParams, { onEvent = () => {} } = {}) {
  const params = normalizeParams(rawParams);
  const tier = getTier(params.tier);
  const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(9).toString('base64url')}`;
  const session = client.session(id);
  const { center, minutes, profiles, threshold } = params;
  const proj = createProjection(center);
  const phases = [];
  const t0 = Date.now();

  // 各阶段在总进度条中的区间
  const W = {
    resolve: [0, 0.04],
    isochrone: [0.04, 0.4],
    pois: [0.04, 0.55],
    access: [0.55, 0.62],
    blind: [0.62, 0.88],
    siting: [0.88, 0.97],
    report: [0.97, 1],
  };
  const progress = (stage, p, message) => {
    const [a, b] = W[stage];
    onEvent({ type: 'progress', stage, progress: Math.round((a + (b - a) * p) * 1000) / 1000, message });
  };
  const timed = async (key, label, fn) => {
    const s = Date.now();
    const scoped = session.scope(key);
    const r = await fn(scoped);
    phases.push({ key, label, ms: Date.now() - s, ...scoped.counts });
    return r;
  };

  // 1. 逆地理编码：得到可读地址
  const place = await timed('resolve', '逆地理编码', async (ss) => {
    progress('resolve', 0, '解析中心点地址');
    try {
      return await reverseGeocode(ss, center);
    } catch (err) {
      session.degrade('resolve', err.kind || 'error', { message: err.message, fallback: 'coordinates' });
      return { address: '', component: {}, sematicDescription: '' };
    }
  });
  const name = params.name || place.sematicDescription?.replace(/附近.*$/, '') || place.address || `${center.lng.toFixed(5)}, ${center.lat.toFixed(5)}`;
  onEvent({ type: 'stage', stage: 'resolve', data: { id, name, address: place.address, center, params } });

  // 2. 等时圈 与 多源 POI 采集 并发执行
  const Dmax = Math.max(...profiles.map((p) => p.speed)) * minutes * 60;
  const searchRadius = Math.round(Dmax * 1.1 + threshold);
  const [isochrone, poiResult] = await Promise.all([
    timed('isochrone', '等时圈采样与插值', async (ss) => {
      const iso = await buildIsochrone(ss, { center, minutes, profiles, tier, onProgress: (p, m) => progress('isochrone', p, m) });
      onEvent({ type: 'stage', stage: 'isochrone', data: publicIsochrone(iso) });
      return iso;
    }),
    timed('pois', '多源 POI 采集与清洗', async (ss) => {
      const r = await collectPois(ss, {
        center,
        radius: searchRadius,
        maxPages: tier.maxPages,
        rgcPoints: tier.rgcPoints,
        onProgress: (p, m) => progress('pois', p, m),
      });
      return r;
    }),
  ]);

  // 3. 中心点可达性（精确最近设施）
  const access = await timed('access', '最近设施实测', async (ss) => {
    progress('access', 0, '实测中心点到各类设施的步行距离');
    return measureAccess(ss, { center, pois: poiResult.pois, isochrone, profiles });
  });
  onEvent({ type: 'stage', stage: 'pois', data: { pois: poiResult.pois, residential: poiResult.residential, cleaning: poiResult.cleaning, access } });

  // 4. 服务盲区
  const blind = await timed('blind', '服务盲区识别', (ss) =>
    detectBlindSpots(ss, {
      center,
      proj,
      isochrone,
      pois: poiResult.pois,
      residential: poiResult.residential,
      tier,
      threshold,
      truncated: poiResult.truncated,
      onProgress: (p, m) => progress('blind', p, m),
    }),
  );
  // 复核检索新发现的设施并入设施清单（标注 recheck），保证清单、地图与盲区判定使用同一份数据
  const recheckPois = blind.addedPois || [];
  delete blind.addedPois;
  if (recheckPois.length) poiResult.pois.push(...recheckPois);
  onEvent({ type: 'stage', stage: 'blind', data: blind });

  // 5. 选址推荐
  const siting = await timed('siting', '补短板选址', async (ss) => {
    progress('siting', 0, '最大覆盖模型求解选址');
    return recommendSites(ss, { blind, threshold });
  });
  onEvent({ type: 'stage', stage: 'siting', data: siting });

  // 6. 评分与诊断
  progress('report', 0, '生成体检报告');
  const score = computeScore({ access, blind, profile: 'adult' });
  const elderlyScore = computeScore({ access, blind, profile: 'elderly' });
  const childScore = computeScore({ access, blind, profile: 'child' });
  const result = {
    id,
    version: RESULT_VERSION,
    createdAt: new Date().toISOString(),
    name,
    address: place.address,
    district: [place.component?.city, place.component?.district, place.component?.town].filter(Boolean).join(' '),
    center,
    params: { ...params, searchRadius, tierName: tier.name },
    dataMode: client.mode,
    profiles,
    isochrone: publicIsochrone(isochrone),
    pois: poiResult.pois,
    residential: poiResult.residential,
    cleaning: {
      ...poiResult.cleaning,
      sources: poiResult.sourceStats,
      failures: poiResult.failures.length,
      truncated: poiResult.truncated,
      recheckAdded: recheckPois.length,
    },
    access,
    blind,
    siting,
    score,
    elderlyScore,
    childScore,
  };
  result.diagnosis = buildDiagnosis(result);
  result.engineering = engineeringReport(session, { phases, t0, isochrone, blind, access, client, tier });
  onEvent({ type: 'progress', stage: 'report', progress: 1, message: '体检完成' });
  return { result, touched: session.touched };
}

/** 去掉仅服务端使用的函数字段 */
function publicIsochrone(iso) {
  const { field, ...rest } = iso;
  return { ...rest, lambdaMedian: field.lambdaMedian };
}

/**
 * 工程指标：调用次数、缓存命中、批量化收益、降级事件。
 * 「逐点调用」基线 = 若每个距离元素都单独调用一次路线规划 API 所需的请求数。
 */
function engineeringReport(session, { phases, t0, isochrone, blind, access, client, tier }) {
  const s = session.stats;
  const blindPairsNaive = blind.metrics.points * CRITICAL_KEYS.length * 3;
  const naive = isochrone.metrics.samples + blindPairsNaive + access.length * 3;
  const upstream = s.network + s.replay;
  return {
    totalMs: Date.now() - t0,
    phases,
    requests: s.requests,
    upstream,
    network: s.network,
    cacheHits: s.cache,
    replayHits: s.replay,
    retries: s.retries,
    failures: s.failures,
    matrixElements: s.matrixElements,
    batchFactor: s.byService['routematrix/v2/walking']
      ? Math.round((s.matrixElements / Math.max(1, s.byService['routematrix/v2/walking'].requests)) * 10) / 10
      : 0,
    naiveRequests: naive,
    savedRatio: Math.round((1 - s.requests / Math.max(1, naive)) * 1000) / 10,
    byService: s.byService,
    degradations: s.degradations,
    limiter: client.limiter.snapshot(),
    tier: { key: tier.key, name: tier.name, rays: tier.rays, rings: tier.rings.length, refineRounds: tier.refineRounds, verifyBudget: tier.verifyBudget },
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
