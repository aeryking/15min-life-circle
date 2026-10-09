/**
 * 采样档位：在精度与 API 配额之间取舍。
 * rings 为采样环半径相对于最大可达距离 D 的倍数（直线距离）。
 * verifyBudget：盲区核验的配对预算；recheckSearches / recheckPairs：盲区复核检索的检索次数与配对预算。
 */
export const TIERS = {
  lite: {
    key: 'lite',
    name: '轻量档',
    desc: '16 方向 × 4 环，适合配额紧张时快速体检',
    rays: 16,
    rings: [0.35, 0.65, 0.95, 1.3],
    refineRounds: 1,
    isoCell: 70,
    blindCell: 200,
    verifyBudget: 150,
    recheckSearches: 4,
    recheckPairs: 60,
    maxPages: 2,
    rgcPoints: 1,
  },
  standard: {
    key: 'standard',
    name: '标准档',
    desc: '24 方向 × 5 环 + 2 轮边界加密，精度与配额均衡（推荐）',
    rays: 24,
    rings: [0.3, 0.55, 0.8, 1.05, 1.35],
    refineRounds: 2,
    isoCell: 50,
    blindCell: 150,
    verifyBudget: 600,
    recheckSearches: 10,
    recheckPairs: 150,
    maxPages: 3,
    rgcPoints: 7,
  },
  precise: {
    key: 'precise',
    name: '高精度档',
    desc: '36 方向 × 7 环 + 3 轮边界加密，适合出正式报告',
    rays: 36,
    rings: [0.22, 0.4, 0.58, 0.76, 0.94, 1.15, 1.45],
    refineRounds: 3,
    isoCell: 40,
    blindCell: 110,
    verifyBudget: 1500,
    recheckSearches: 20,
    recheckPairs: 300,
    maxPages: 5,
    rgcPoints: 7,
  },
};

export const getTier = (key) => TIERS[key] || TIERS.standard;

/** 预估 API 调用次数（上限估计，实际因缓存命中与提前收敛会更少） */
export function estimateCalls(tier, { profiles = 3, keywordCount = 25, maxElements = 50 } = {}) {
  const iso = Math.ceil((tier.rays * tier.rings.length) / maxElements) + tier.refineRounds * Math.ceil((tier.rays * profiles) / maxElements);
  const poi = Math.round(keywordCount * Math.min(tier.maxPages, 1.4)) + tier.rgcPoints;
  const access = 1;
  const blind = Math.ceil((tier.verifyBudget + tier.recheckPairs) / 25) + tier.recheckSearches;
  const siting = 3 * (3 + 2); // 3 类关键设施 ×（3 个候选点实测 + 2 个方案逆地理编码）
  const geocode = 1;
  return { iso, poi, access, blind, siting, geocode, total: iso + poi + access + blind + siting + geocode };
}
