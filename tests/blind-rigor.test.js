/**
 * 盲区识别的严格性：分支定界（不依赖「最近 3 个」假设）、复核检索（排除数据缺失造成的假盲区）、
 * 直线口径对照（隐性盲区）。基于对称的合成路网：步行 = 直线 × 1.25，中心以东 400 m 处有南北向河流，跨河 +600 m。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIsochrone } from '../server/core/isochrone.js';
import { detectBlindSpots } from '../server/core/blindspot.js';
import { createProjection, destination } from '../server/geo/geo.js';
import { getTier } from '../server/core/tiers.js';
import { SPEED_PROFILES } from '../server/core/categories.js';
import { fakeSession as baseSession, riverWalk } from './helpers/fakeCity.js';

const C = { lng: 116.3213, lat: 40.0385 };
const at = (d, b, from = C) => destination(from, d, b);
const tier = { ...getTier('standard'), recheckSearches: 10 };
const walk = riverWalk(C);
const fakeSession = (opts = {}) => baseSession({ walk, ...opts });
const facility = (id, category, name, p) => ({ id, uid: id, category, name, ...p, distance: 0, sources: ['test'] });

let iso = null;
async function isochrone() {
  iso ||= await buildIsochrone(fakeSession(), { center: C, minutes: 15, profiles: SPEED_PROFILES, tier });
  return iso;
}

// 菜市场、小学放在中心附近，避免与药店的场景互相干扰
const basics = [facility('m1', 'market', '中心菜场', at(80, 0)), facility('s1', 'primary_school', '中心小学', at(80, 180))];

test('分支定界：直线最近的 3 家都要绕河，第 4 家在身后可达 ⇒ 已覆盖（旧的「只测最近 3 家」会误判为盲区）', async () => {
  const R = at(500, 0);
  const pois = [
    ...basics,
    // 小区东侧 450–490 m 的三家药店：位于河东岸，跨河步行 = s × 1.25 + 600 > 1000 m
    facility('e1', 'pharmacy', '东岸药店甲', at(450, 90, R)),
    facility('e2', 'pharmacy', '东岸药店乙', at(470, 88, R)),
    facility('e3', 'pharmacy', '东岸药店丙', at(490, 92, R)),
    // 小区西侧 700 m：直线更远，但无需过河，步行 875 m
    facility('w1', 'pharmacy', '西街药店', at(700, 270, R)),
  ];
  const session = fakeSession();
  const blind = await detectBlindSpots(session, {
    center: C,
    proj: createProjection(C),
    isochrone: await isochrone(),
    pois,
    residential: [{ name: '北苑小区', ...R }],
    tier: { ...tier, recheckSearches: 0 },
  });
  const r = blind.residential.find((x) => x.name === '北苑小区');
  assert.equal(r.cats.pharmacy.status, 'covered');
  assert.equal(r.cats.pharmacy.method, 'verified');
  assert.equal(r.cats.pharmacy.nearest, '西街药店');
  assert.equal(r.cats.pharmacy.net, 875);
  assert.ok(blind.metrics.rounds >= 2, `分轮实测（${blind.metrics.rounds} 轮）`);
  // 判定为盲区的实测结论是严格的：所有直线 ≤ 1 km 的候选均已实测
  assert.ok(blind.metrics.exactRatio > 0.5);
});

test('复核检索：中心检索被分页截断而遗漏的药店被定点补检索找回，假盲区改判为已覆盖', async () => {
  const R2 = at(500, 180);
  const hidden = { uid: 'lost-1', name: '南门大药房', keyword: '药店', tag: '医疗;药店', ...at(200, 270, R2) };
  const pois = [...basics, facility('n1', 'pharmacy', '北区药店', at(600, 0))];
  const session = fakeSession({ pois: [hidden] });
  const blind = await detectBlindSpots(session, {
    center: C,
    proj: createProjection(C),
    isochrone: await isochrone(),
    pois,
    residential: [{ name: '南苑小区', ...R2 }],
    tier,
    truncated: { pharmacy: { total: 94, fetched: 60, keywords: ['药店'] } },
  });
  const r = blind.residential.find((x) => x.name === '南苑小区');
  assert.equal(r.cats.pharmacy.status, 'covered', '补检索后不再是盲区');
  assert.equal(r.cats.pharmacy.nearest, '南门大药房');
  assert.equal(blind.categories.pharmacy.truncated, true);
  const rs = blind.metrics.recheckSearch;
  assert.ok(rs.searches >= 1 && rs.added >= 1 && rs.rescued >= 1, JSON.stringify(rs));
  assert.equal(blind.addedPois.length, rs.added);
  assert.equal(blind.addedPois[0].recheck, true);
  assert.equal(blind.addedPois[0].category, 'pharmacy');
  assert.ok(blind.addedPois[0].distance > 0, '距离按体检中心重新计算');
  assert.ok(session.stats.byService['place/v2/search'] >= 1);
});

test('隐性盲区：直线 700 m 有药店但需绕河、步行 1475 m ⇒ 真实口径为盲区，直线口径看不出', async () => {
  const R3 = at(300, 0);
  const pois = [...basics, facility('x1', 'pharmacy', '河东药店', at(700, 90, R3))];
  const blind = await detectBlindSpots(fakeSession(), {
    center: C,
    proj: createProjection(C),
    isochrone: await isochrone(),
    pois,
    residential: [{ name: '临河小区', ...R3 }],
    tier: { ...tier, recheckSearches: 0 },
  });
  const r = blind.residential.find((x) => x.name === '临河小区');
  assert.equal(r.cats.pharmacy.status, 'blind');
  assert.equal(r.cats.pharmacy.method, 'verified');
  assert.equal(r.cats.pharmacy.hidden, true);
  assert.equal(r.cats.pharmacy.straight, 700);
  assert.equal(r.cats.pharmacy.net, 1475);
  assert.equal(r.cats.pharmacy.gap, 475);
  assert.deepEqual(r.hiddenMissing, ['pharmacy']);
  assert.equal(blind.union.residentialHidden, 1);
  assert.ok(blind.categories.pharmacy.hiddenCells > 0, '网格中同样存在隐性盲区');
  assert.ok(blind.categories.pharmacy.blindRatio > blind.categories.pharmacy.straightBlindRatio, '真实口径盲区大于直线口径');
  assert.equal(blind.union.residentialBlindRatio, 1);
});
