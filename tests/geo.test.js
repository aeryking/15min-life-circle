import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, destination, createProjection, ringArea, pointInGeometry, bearing, quantile } from '../server/geo/geo.js';
import { wgs84ToBd09, bd09ToGcj02, gcj02ToBd09 } from '../server/geo/coord.js';

const C = { lng: 116.3213, lat: 40.0385 };

test('destination 与 haversine 互逆', () => {
  for (const b of [0, 45, 90, 180, 270]) {
    const p = destination(C, 1000, b);
    assert.ok(Math.abs(haversine(C, p) - 1000) < 0.5);
    assert.ok(Math.abs(((bearing(C, p) - b + 540) % 360) - 180) < 0.1);
  }
});

test('局部投影往返误差 < 0.1 m', () => {
  const proj = createProjection(C);
  const p = destination(C, 1500, 33);
  const { x, y } = proj.toXY(p);
  const q = proj.toLngLat(x, y);
  assert.ok(haversine(p, q) < 0.1);
  assert.ok(Math.abs(Math.hypot(x, y) - 1500) < 2);
});

test('多边形面积与点包含', () => {
  assert.equal(
    ringArea([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]),
    10000,
  );
  const g = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
        [
          [0.5, 0.5],
          [1.5, 0.5],
          [1.5, 1.5],
          [0.5, 1.5],
          [0.5, 0.5],
        ],
      ],
    ],
  };
  assert.equal(pointInGeometry({ lng: 0.2, lat: 0.2 }, g), true);
  assert.equal(pointInGeometry({ lng: 1, lat: 1 }, g), false, '洞内的点不在多边形内');
});

test('WGS-84 → BD-09 本地算法与百度坐标转换 API 实测值偏差 < 2 m', () => {
  // 百度 geoconv/v2 model=2 实测：116.3078,40.05703 → 116.32042060874884,40.06423771193952
  const p = wgs84ToBd09({ lng: 116.3078, lat: 40.05703 });
  assert.ok(haversine(p, { lng: 116.3204206087488, lat: 40.06423771193952 }) < 2);
  const back = gcj02ToBd09(bd09ToGcj02(C));
  assert.ok(haversine(back, C) < 0.5);
});

test('分位数', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5], 1), 5);
});
