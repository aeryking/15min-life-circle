import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from '../server/core/scoring.js';
import { CATEGORIES, DIMENSIONS, PROFILE_WEIGHTS } from '../server/core/categories.js';

/** 构造九类设施的可达数据：minutes 为三类人群统一的步行时间（null 表示缺失），隔离「权重」的影响 */
function makeAccess(minutesByKey) {
  return CATEGORIES.map((c) => {
    const t = minutesByKey[c.key];
    const has = Number.isFinite(t);
    return {
      key: c.key,
      name: c.name,
      dimension: c.dimension,
      critical: c.critical,
      targetMinutes: c.targetMinutes,
      recommended: c.recommended,
      inCircle: has ? { adult: c.recommended, elderly: c.recommended, child: c.recommended } : { adult: 0, elderly: 0, child: 0 },
      nearest: has ? { minutes: { adult: t, elderly: t, child: t } } : null,
    };
  });
}

const blind = { union: { blindRatio: 0, residentialTotal: 0, residentialBlindRatio: null } };

test('人群权重表：三类人群齐全、覆盖六个维度、成年人等权', () => {
  for (const p of ['adult', 'elderly', 'child']) {
    assert.ok(PROFILE_WEIGHTS[p], `缺少 ${p} 权重`);
    for (const d of DIMENSIONS) assert.ok(PROFILE_WEIGHTS[p][d.key] > 0, `${p}.${d.key} 权重应为正数`);
  }
  assert.ok(Object.values(PROFILE_WEIGHTS.adult).every((w) => w === 1));
  assert.ok(PROFILE_WEIGHTS.child.education > PROFILE_WEIGHTS.adult.education, '亲子加重基础教育');
  assert.ok(PROFILE_WEIGHTS.child.elderly >= PROFILE_WEIGHTS.adult.elderly, '亲子不弱化养老（避免养老短板让亲子分虚高）');
  assert.ok(PROFILE_WEIGHTS.elderly.elderly > PROFILE_WEIGHTS.adult.elderly, '老年人加重养老');
  assert.ok(PROFILE_WEIGHTS.elderly.education < PROFILE_WEIGHTS.adult.education, '老年人弱化基础教育');
});

test('成年人等权：维度均分等于六维简单平均（与引入权重前的口径一致）', () => {
  const access = makeAccess({ kindergarten: 3, primary_school: 8, market: 25, pharmacy: 5, clinic: 30, supermarket: 4, transit: 3, park: 12 });
  const s = computeScore({ access, blind, profile: 'adult' });
  const plain = s.dimensions.reduce((a, d) => a + d.score, 0) / s.dimensions.length;
  assert.equal(s.components.dimensions, Math.round(plain));
  assert.ok(s.dimensions.every((d) => d.weight === 1));
});

test('同样的设施条件下，教育强、养老缺的社区：亲子视角 > 成年人 > 老年人', () => {
  // 幼儿园、小学、公园就近；养老缺失；其余居中
  const access = makeAccess({ kindergarten: 3, primary_school: 6, park: 5, market: 14, pharmacy: 14, clinic: 20, supermarket: 7, transit: 7, elderly: null });
  const adult = computeScore({ access, blind, profile: 'adult' });
  const elderly = computeScore({ access, blind, profile: 'elderly' });
  const child = computeScore({ access, blind, profile: 'child' });
  // 步行时间三类人群相同，差异只来自权重，所以各维度得分一致
  assert.deepEqual(
    child.dimensions.map((d) => d.score),
    adult.dimensions.map((d) => d.score),
  );
  assert.ok(child.total > adult.total, `亲子 ${child.total} 应高于成年人 ${adult.total}`);
  assert.ok(adult.total > elderly.total, `成年人 ${adult.total} 应高于老年人 ${elderly.total}`);
  assert.equal(child.profile, 'child');
});

test('亲子视角使用亲子步速下的步行时间', () => {
  const access = makeAccess({ kindergarten: 4, primary_school: 8, park: 8, market: 8, pharmacy: 8, clinic: 10, supermarket: 4, transit: 4, elderly: 10 });
  const kg = access.find((a) => a.key === 'kindergarten');
  kg.nearest.minutes.child = 12; // 陪同儿童走得慢，超出 5 分钟目标
  const adult = computeScore({ access, blind, profile: 'adult' });
  const child = computeScore({ access, blind, profile: 'child' });
  assert.equal(adult.categories.find((c) => c.key === 'kindergarten').minutes, 4);
  assert.equal(child.categories.find((c) => c.key === 'kindergarten').minutes, 12);
  assert.ok(child.categories.find((c) => c.key === 'kindergarten').accessScore < 100);
});

test('教育短板：幼儿园、小学远的社区，亲子视角低于成年人', () => {
  // 养老同样缺失（现实中最常见的短板），但亲子分不应因此「虚高」
  const access = makeAccess({ kindergarten: 12, primary_school: 22, park: 16, market: 6, pharmacy: 5, clinic: 8, supermarket: 3, transit: 3, elderly: null });
  const adult = computeScore({ access, blind, profile: 'adult' });
  const child = computeScore({ access, blind, profile: 'child' });
  assert.ok(child.total < adult.total, `亲子 ${child.total} 应低于成年人 ${adult.total}`);
});
