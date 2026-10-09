import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPois, classify, parentName, dice } from '../server/core/poi.js';
import { CATEGORY_MAP } from '../server/core/categories.js';
import { buildIsochrone } from '../server/core/isochrone.js';
import { detectBlindSpots } from '../server/core/blindspot.js';
import { recommendSites } from '../server/core/siting.js';
import { computeScore } from '../server/core/scoring.js';
import { createProjection, destination } from '../server/geo/geo.js';
import { getTier } from '../server/core/tiers.js';
import { SPEED_PROFILES } from '../server/core/categories.js';
import { fakeSession } from './helpers/fakeCity.js';

const C = { lng: 116.3213, lat: 40.0385 };
const at = (d, b) => destination(C, d, b);
const raw = (name, tag, d, b, extra = {}) => ({
  uid: `${name}-${d}-${b}`,
  name,
  tag,
  classifiedTag: tag,
  ...at(d, b),
  source: 'baidu_place',
  queriedFor: extra.q || null,
  ...extra,
});

test('POI 分类：标签优先，名称规则为辅，软规则不误删正规机构', () => {
  assert.equal(classify(raw('明天幼稚集团八幼', '教育培训;幼儿园', 100, 0), CATEGORY_MAP.kindergarten).ok, true);
  assert.equal(classify(raw('小马编程培训', '教育培训;培训机构', 100, 0, { q: 'primary_school' }), CATEGORY_MAP.primary_school).ok, false);
  assert.equal(classify(raw('谊品生鲜', '购物;超市;生鲜超市', 100, 0), CATEGORY_MAP.market).ok, true);
  assert.equal(classify(raw('宠物医院', '医疗;诊所', 100, 0), CATEGORY_MAP.clinic).ok, false);
  // 菜市场的各地写法：明确细分标签直接通过；宽泛「购物;市场」凭「XX市场 / 街市」名称佐证；非生鲜市场排除
  const mk = (name, tag, classified) => ({ ...raw(name, tag, 100, 0), classifiedTag: classified });
  assert.equal(classify(mk('冼村市场新街市', '购物;市场', '购物;农贸市场'), CATEGORY_MAP.market).ok, true);
  assert.equal(classify(mk('钱大妈(六运一街店)', '购物;商铺', '购物;菜店'), CATEGORY_MAP.market).ok, true);
  assert.equal(classify(mk('大冲五谊市场(大冲商业步行街店)', '购物;市场', '购物;市场'), CATEGORY_MAP.market).ok, true);
  assert.equal(classify(mk('华强北电子市场', '购物;市场', '购物;市场'), CATEGORY_MAP.market).ok, false);
  assert.equal(classify(mk('大冲商贸城', '购物', '购物'), CATEGORY_MAP.market).ok, false);
});

test('POI 清洗：出入口剔除、同名去重、父子合并、跨类别复用', () => {
  const list = [
    raw('西二旗地铁站-A1北口', '出入口;其他', 300, 10, { q: 'transit' }),
    raw('西二旗', '交通设施;地铁站', 310, 12, { q: 'transit' }),
    raw('同仁堂', '医疗;药店', 400, 90, { q: 'pharmacy' }),
    { ...raw('同仁堂', '医疗;药店', 405, 90, { q: 'pharmacy' }), uid: 'dup-uid' },
    raw('领秀新硅谷', '房地产;住宅区', 500, 180),
    raw('领秀新硅谷-D区', '房地产;住宅区', 560, 185),
    raw('谊品生鲜(金域店)', '购物;超市;生鲜超市', 600, 270, { q: 'market' }),
    raw('中钞科堡技术有限公司', '公司企业;公司', 200, 45),
  ];
  const r = cleanPois(list, C, 3000);
  const names = r.pois.map((p) => `${p.category}:${p.name}`);
  assert.ok(names.includes('transit:西二旗'));
  assert.ok(!names.some((n) => n.includes('A1北口')));
  assert.equal(r.pois.filter((p) => p.name === '同仁堂').length, 1, '近邻同名去重');
  assert.equal(r.residential.length, 1, '父子小区合并');
  assert.ok(names.includes('market:谊品生鲜(金域店)') && names.includes('supermarket:谊品生鲜(金域店)'), '生鲜超市同时计入两类');
  assert.ok(r.cleaning.excludedTotal >= 2);
});

test('名称工具', () => {
  assert.equal(parentName('领秀新硅谷-D区'), '领秀新硅谷');
  assert.ok(dice('同仁堂大药房', '同仁堂药房') > 0.5);
});

test('盲区识别 + 选址 + 评分：合成城市端到端', async () => {
  // 药店只在西侧，东侧（河对岸）形成药店盲区；菜市场、小学居中
  const pois = [
    { id: 'p1', category: 'pharmacy', name: '西药店', ...at(300, 270) },
    { id: 'm1', category: 'market', name: '中心菜场', ...at(100, 0) },
    { id: 's1', category: 'primary_school', name: '中心小学', ...at(150, 180) },
  ].map((p) => ({ ...p, distance: 0, sources: ['test'] }));
  const residential = [
    { name: '东岸小区', ...at(380, 90) },
    { name: '西岸小区', ...at(380, 270) },
  ];
  const session = fakeSession();
  const tier = getTier('standard');
  const iso = await buildIsochrone(session, { center: C, minutes: 15, profiles: SPEED_PROFILES, tier });
  const blind = await detectBlindSpots(session, { center: C, proj: createProjection(C), isochrone: iso, pois, residential, tier });
  assert.ok(blind.categories.pharmacy.blindCells > 0, '存在药店盲区');
  assert.ok(blind.metrics.decisions.certain + blind.metrics.decisions.safe > 0, '上下界剪枝生效');
  const siting = await recommendSites(session, { blind });
  const ph = siting.find((s) => s.category === 'pharmacy');
  assert.ok(ph && ph.reduction > 50, '药店选址可消除大部分盲区需求');

  const access = [
    {
      key: 'pharmacy',
      name: '药店',
      dimension: 'medical',
      critical: true,
      targetMinutes: 10,
      recommended: 2,
      inCircle: { adult: 1 },
      nearest: { minutes: { adult: 5 } },
    },
    { key: 'market', name: '菜市场', dimension: 'shopping', critical: true, targetMinutes: 10, recommended: 2, inCircle: { adult: 0 }, nearest: null },
  ];
  const score = computeScore({ access, blind });
  assert.ok(score.total >= 0 && score.total <= 100);
  assert.equal(score.categories.find((c) => c.key === 'market').score, 0);
});
