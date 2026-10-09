import { test } from 'node:test';
import assert from 'node:assert/strict';

// router.js 依赖浏览器全局对象，这里提供最小的 window / history 替身
globalThis.window = { location: { pathname: '/', search: '' }, addEventListener() {} };
const { parseRoute, urlFor } = await import('../web/src/router.js');

const loc = (url) => {
  const u = new URL(url, 'http://x');
  return { pathname: u.pathname, search: u.search };
};

test('路由解析：报告、打印、对比、首页，无效标签回落到总览', () => {
  assert.deepEqual(parseRoute(loc('/r/20260928-abc_DEF')), { name: 'report', id: '20260928-abc_DEF', tab: 'overview' });
  assert.deepEqual(parseRoute(loc('/r/abc?tab=assistant')), { name: 'report', id: 'abc', tab: 'assistant' });
  assert.deepEqual(parseRoute(loc('/r/abc?tab=hack')), { name: 'report', id: 'abc', tab: 'overview' });
  assert.deepEqual(parseRoute(loc('/r/abc/print/')), { name: 'print', id: 'abc', tab: 'overview' });
  assert.deepEqual(parseRoute(loc('/compare?ids=a,b,,c')), { name: 'compare', ids: ['a', 'b', 'c'] });
  assert.deepEqual(parseRoute(loc('/r/abc/print?autoprint=1')), { name: 'print', id: 'abc', tab: 'overview', autoprint: true });
  assert.deepEqual(parseRoute(loc('/r/abc?autoprint=1')), { name: 'report', id: 'abc', tab: 'overview' }, '只有打印页才自动打印');
  assert.equal(
    urlFor({ view: 'report', tab: 'overview', compareIds: [], result: { id: 'abc' } }, '?autoprint=1&basemap=osm'),
    '/r/abc/print?basemap=osm',
    '自动打印参数用完即从地址栏去掉',
  );
  assert.deepEqual(parseRoute(loc('/history')), { name: 'history', q: '' });
  assert.deepEqual(parseRoute(loc('/history/?q=%E4%B8%8A%E5%9C%B0')), { name: 'history', q: '上地' });
  assert.deepEqual(parseRoute(loc('/r/../etc')), { name: 'home' });
  assert.deepEqual(parseRoute(loc('/whatever')), { name: 'home' });
});

test('地址生成：随状态变化，保留 basemap / debug 调试参数，丢弃其他参数', () => {
  const s = (o) => ({ view: 'main', tab: 'overview', compareIds: [], result: null, ...o });
  assert.equal(urlFor(s(), ''), '/');
  assert.equal(urlFor(s({ result: { id: 'r1' } }), ''), '/r/r1');
  assert.equal(urlFor(s({ result: { id: 'r1' }, tab: 'assistant' }), ''), '/r/r1?tab=assistant');
  assert.equal(urlFor(s({ result: { id: 'r1' }, view: 'report', tab: 'assistant' }), ''), '/r/r1/print');
  assert.equal(urlFor(s({ view: 'compare', compareIds: ['a', 'b'] }), ''), '/compare?ids=a,b');
  assert.equal(urlFor(s({ view: 'history', historyQuery: '' }), ''), '/history');
  assert.equal(urlFor(s({ view: 'history', historyQuery: ' 上地 ', result: { id: 'r1' } }), '?basemap=osm'), '/history?basemap=osm&q=%E4%B8%8A%E5%9C%B0');
  assert.equal(urlFor(s({ result: { id: 'r1' } }), '?basemap=osm&debug=1&foo=bar'), '/r/r1?basemap=osm&debug=1');
});
