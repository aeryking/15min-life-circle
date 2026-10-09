import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjection, destination, haversine, pointInGeometry } from '../server/geo/geo.js';
import { createGrid, contourBelow } from '../server/core/contour.js';
import { createDistanceField, createPolarField, crossValidate, selectParams } from '../server/core/interpolation.js';
import { buildIsochrone, bracketBoundary } from '../server/core/isochrone.js';
import { planMatrixChunks } from '../server/baidu/services.js';
import { getTier } from '../server/core/tiers.js';
import { SPEED_PROFILES } from '../server/core/categories.js';
import { fakeSession, fakeWalk } from './helpers/fakeCity.js';

const C = { lng: 116.3213, lat: 40.0385 };

test('等值面：径向距离场的 1000 m 等值线面积 ≈ π·1000²', () => {
  const proj = createProjection(C);
  const grid = createGrid(1500, 25);
  const v = new Float64Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) v[i + j * grid.nx] = Math.hypot(grid.x0 + i * 25, grid.y0 + j * 25);
  const [c] = contourBelow(grid, v, [1000], (x, y) => proj.toLngLat(x, y));
  const ring = c.geometry.coordinates[0][0];
  const radii = ring.map(([lng, lat]) => haversine(C, { lng, lat }));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  assert.ok(Math.abs(mean - 1000) < 15, `平均半径 ${mean}`);
});

test('插值：常数绕行系数场可被精确重建', () => {
  const samples = [];
  for (let b = 0; b < 360; b += 30)
    for (const r of [300, 600, 900]) samples.push({ x: r * Math.sin((b * Math.PI) / 180), y: r * Math.cos((b * Math.PI) / 180), dNet: r * 1.4 });
  const f = createDistanceField(samples, { mode: 'lambda', power: 2, alpha: 1, k: 8 });
  assert.ok(Math.abs(f.predict(0, 750) - 1050) < 1);
  const cv = crossValidate(samples, { mode: 'lambda', power: 2, alpha: 1, k: 8 }, { threshold: 1000 });
  assert.ok(cv.maeMeters < 1);
  const sel = selectParams(samples, { threshold: 1000 });
  assert.ok(sel.cv.maeMeters <= sel.baseline.maeMeters);
});

test('极坐标插值：射线之间按方位角线性过渡', () => {
  const samples = [
    { ray: 0, r: 500, dNet: 600 },
    { ray: 1, r: 500, dNet: 800 },
  ];
  const f = createPolarField(samples, [0, 90, 180, 270]);
  assert.ok(Math.abs(f.predictPolar(45, 500) - 700) < 1e-6);
});

test('边界插值：在首次越过阈值的相邻采样对之间割线插值', () => {
  const r = bracketBoundary(
    [
      { r: 400, dNet: 500 },
      { r: 800, dNet: 1300 },
    ],
    1000,
    1080,
  );
  assert.equal(r, 650);
});

test('批量算路分块：元素数不超过上限且覆盖全部配对', () => {
  for (const [o, d] of [
    [1, 120],
    [3, 20],
    [7, 9],
    [60, 1],
  ]) {
    const chunks = planMatrixChunks(o, d, 50);
    let total = 0;
    for (const c of chunks) {
      const n = (c.o1 - c.o0) * (c.d1 - c.d0);
      assert.ok(n <= 50);
      total += n;
    }
    assert.equal(total, o * d);
  }
});

test('等时圈：合成城市中「河流」一侧可达范围明显收缩，且调用次数极少', async () => {
  const session = fakeSession();
  const iso = await buildIsochrone(session, { center: C, minutes: 15, profiles: SPEED_PROFILES, tier: getTier('standard') });
  const east = destination(C, 700, 90); // 河东，需绕桥：700×1.25+600 = 1475 m > 1080 m
  const west = destination(C, 700, 270); // 河西：875 m < 1080 m
  assert.equal(pointInGeometry(west, iso.polygons.adult), true);
  assert.equal(pointInGeometry(east, iso.polygons.adult), false);
  assert.ok(iso.metrics.areas.adult < iso.metrics.circleArea * 0.7);
  assert.ok(iso.metrics.areas.elderly < iso.metrics.areas.adult);
  assert.ok(session.stats.requests <= 8, `请求数 ${session.stats.requests}`);
  const probe = destination(C, 500, 200);
  assert.ok(Math.abs(iso.field.predict(probe) - fakeWalk(C, probe)) < 60);
});

test('等时圈降级：批量算路全部失败时退化为经验绕行系数并记录降级事件', async () => {
  const session = fakeSession({ failRate: 1 });
  const iso = await buildIsochrone(session, { center: C, minutes: 15, profiles: SPEED_PROFILES, tier: getTier('lite') });
  assert.equal(iso.metrics.degraded, true);
  assert.ok(iso.metrics.areas.adult > 0);
  assert.ok(session.stats.degradations.some((d) => d.stage === 'isochrone'));
});
