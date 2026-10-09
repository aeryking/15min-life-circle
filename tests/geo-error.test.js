import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoErrorMessage, accuracyNote } from '../web/src/utils/geoError.js';

test('定位失败提示：按原因给出中英双语说明，并保留浏览器原始报错', () => {
  for (const code of [1, 2, 3, 'unsupported', 'insecure', 'convert', undefined]) {
    const m = geoErrorMessage({ code, message: code === 1 ? 'User denied Geolocation' : '' });
    assert.ok(/[一-龥]/.test(m.zh) && /[A-Za-z]/.test(m.en), `${code} 缺少中文或英文`);
    assert.ok(!/[一-龥（）]/.test(m.en), `${code} 英文说明里混入了中文或全角括号`);
  }
  const denied = geoErrorMessage({ code: 1, message: 'User denied Geolocation' });
  assert.match(denied.zh, /权限被拒绝/);
  assert.match(denied.zh, /定位服务/, '提示 Mac 系统设置');
  assert.match(denied.en, / \(User denied Geolocation\)$/, '保留原始报错便于排查');
  assert.match(geoErrorMessage({ code: 2 }).zh, /Wi-Fi/);
  assert.match(geoErrorMessage({ code: 3 }).en, /timed out/);
});

test('定位精度说明：按精度分档提示是否需要在地图上核对', () => {
  assert.match(accuracyNote(65), /±65 米.*Wi-Fi/);
  assert.match(accuracyNote(900), /偏差可能较大/);
  assert.match(accuracyNote(4200), /±4\.2 公里.*粗略/);
  assert.equal(accuracyNote(undefined), '');
});
