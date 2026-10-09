/**
 * 体检「口径」工具。
 *
 * 口径 = 步行时长 + 盲区阈值 + 各人群步速：决定指标的统计范围，口径不同的结果不宜直接比较；
 * 采样档位（低 / 中 / 高）只影响采样密度与精度，不改变指标定义，不同档位之间可以比较。
 */
export const TIER_LEVEL = { lite: '低', standard: '中', precise: '高' };
export const TIER_NAME = { lite: '轻量档', standard: '标准档', precise: '高精度档' };

const speedsText = (s = {}) => [s.adult, s.elderly, s.child].map((v) => v ?? '-').join('/');

/** 可比口径键（不含采样档位） */
export const caliberKey = (h) => `${h.minutes}|${h.threshold ?? 1000}|${speedsText(h.speeds)}`;

/** 去重键：参数完全相同的重复体检只保留最近一次 */
export const dedupeKey = (h) => `${h.name}|${caliberKey(h)}|${h.tier}`;

const DEFAULT_SPEEDS = '1.2/0.9/1';

/** 口径的可读描述，如「15 分钟」「15 分钟 · 阈值 800 m」「30 分钟 · 自定义步速」 */
export function caliberLabel(h) {
  const parts = [`${h.minutes} 分钟`];
  if ((h.threshold ?? 1000) !== 1000) parts.push(`阈值 ${h.threshold} m`);
  if (h.speeds && speedsText(h.speeds) !== DEFAULT_SPEEDS) parts.push(`步速 ${speedsText(h.speeds)}`);
  return parts.join(' · ');
}

/**
 * 为对比行生成标签：同名社区（不同口径 / 档位）自动追加区分后缀，
 * label 用于图表坐标轴（去掉省市前缀），fullLabel 用于需要完整名称的位置。
 */
export function withLabels(rows, shortName) {
  const byName = new Map();
  for (const r of rows) byName.set(r.name, [...(byName.get(r.name) || []), r]);
  return rows.map((r) => {
    const same = byName.get(r.name);
    let suffix = '';
    if (same.length > 1) {
      const diffMin = new Set(same.map((x) => x.minutes)).size > 1;
      const diffTier = new Set(same.map((x) => x.tier)).size > 1;
      suffix = [diffMin ? `${r.minutes}′` : '', diffTier ? `${TIER_LEVEL[r.tier] || ''}精度` : ''].filter(Boolean).join('·');
      if (!suffix) suffix = r.createdAt?.slice(5, 16).replace('T', ' ');
    }
    const tail = suffix ? `（${suffix}）` : '';
    return { ...r, label: `${shortName(r.name)}${tail}`, fullLabel: `${r.name}${tail}` };
  });
}
