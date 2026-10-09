import { CATEGORIES, RESIDENTIAL, GLOBAL_EXCLUDE } from './categories.js';
import { placeSearch, reverseGeocode, toBd09 } from '../baidu/services.js';
import { haversine, destination } from '../geo/geo.js';
import { config } from '../config.js';

/**
 * 多源 POI 采集与清洗流水线
 *
 *   ① 采集：百度地点检索（多关键词 × 分页）+ 逆地理编码周边 POI（补漏）+ OSM（可选）
 *   ② 分类：以百度分类标签为主、名称规则为辅，统一对所有类别判定（一个 POI 可属于多个类别，
 *          例如「生鲜超市」同时计入菜市场/生鲜与超市便利店）
 *   ③ 过滤：出入口/附属点、校外培训、商业健身、已关闭等噪声，全部记录剔除原因
 *   ④ 去重：UID → 同名近邻 → 名称相似度 + 距离 → 父子 POI 合并（如「XX 医院-门诊」）
 */

const ALL_TARGETS = [...CATEGORIES, RESIDENTIAL];
/** 明确的菜场类细分标签 */
const MARKET_STRONG = /(菜市场|农贸市场|生鲜超市|果蔬超市|生鲜店|菜店)/;
const PAGE_SIZE = 20;

/**
 * @param {import('../baidu/client.js').ClientSession} session
 * @param {{ center, radius, maxPages?, rgcPoints?, osm? }} opts
 */
export async function collectPois(session, { center, radius, maxPages = 3, rgcPoints = 7, osm = config.osm.enabled, onProgress }) {
  const raw = [];
  const sourceStats = { baidu_place: 0, baidu_rgc: 0, osm: 0 };
  const failures = [];
  // 被分页上限截断的类别（检索总数多于已取回的条数）：盲区复核检索会优先处理这些类别
  const truncated = {};

  // ③ OSM（可选，与百度检索并发）：WGS-84 坐标经百度坐标转换 API 转为 BD-09
  const osmTask = osm
    ? fetchOsm(session, center, radius)
        .then((list) => {
          raw.push(...list);
          sourceStats.osm = list.length;
        })
        .catch((err) => {
          failures.push({ source: 'osm', message: err.message });
          session.degrade('poi', 'osm_unavailable', { message: err.message, fallback: 'baidu-only' });
        })
    : Promise.resolve();

  // ① 百度地点检索：每个类别的每个关键词分页检索，直到取完或达到页数上限
  const tasks = ALL_TARGETS.flatMap((cat) => cat.keywords.map((kw) => ({ cat, kw })));
  let done = 0;
  await Promise.all(
    tasks.map(async ({ cat, kw }) => {
      for (let page = 0; page < maxPages; page++) {
        try {
          const r = await placeSearch(session, { query: kw, center, radius, pageNum: page, pageSize: PAGE_SIZE });
          for (const p of r.results) raw.push({ ...p, source: 'baidu_place', queriedFor: cat.key, keyword: kw });
          sourceStats.baidu_place += r.results.length;
          if (r.results.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= r.total) break;
          if (page === maxPages - 1) {
            const t = (truncated[cat.key] ||= { total: 0, fetched: 0, keywords: [] });
            t.total = Math.max(t.total, r.total);
            t.fetched = Math.max(t.fetched, maxPages * PAGE_SIZE);
            t.keywords.push(kw);
          }
        } catch (err) {
          failures.push({ source: 'baidu_place', keyword: kw, page, kind: err.kind, message: err.message });
          session.degrade('poi', err.kind || 'error', { keyword: kw, page, message: err.message, fallback: 'skip-keyword' });
          break;
        }
      }
      done += 1;
      onProgress?.(done / tasks.length, `检索「${kw}」`);
    }),
  );

  // ② 逆地理编码周边 POI：在中心与外环取点，补充关键词检索遗漏的设施
  const rgcCenters = [center];
  for (let i = 0; i < rgcPoints - 1; i++) rgcCenters.push(destination(center, radius * 0.55, (360 / (rgcPoints - 1)) * i));
  await Promise.all(
    rgcCenters.map(async (pt) => {
      try {
        const r = await reverseGeocode(session, pt, { pois: true, radius: 1000 });
        for (const p of r.pois) {
          if (!Number.isFinite(p.lng)) continue;
          raw.push({ ...p, classifiedTag: p.tag, source: 'baidu_rgc', queriedFor: null });
          sourceStats.baidu_rgc += 1;
        }
      } catch (err) {
        failures.push({ source: 'baidu_rgc', kind: err.kind, message: err.message });
      }
    }),
  );

  await osmTask;

  return { ...cleanPois(raw, center, radius), sourceStats, failures, truncated };
}

/**
 * 定点补检索：以指定位置为中心检索某一类设施（每个关键词取按距离排序的第 1 页），经同一套分类清洗后返回该类设施。
 * 用于盲区复核：中心点检索在设施密集区会被分页上限截断，远端（恰是等时圈边缘）的设施可能缺失。
 */
export async function searchCategoryNear(session, { key, center, radius }) {
  const cat = CATEGORIES.find((c) => c.key === key);
  const raw = [];
  let failures = 0;
  await Promise.all(
    cat.keywords.map(async (kw) => {
      try {
        const r = await placeSearch(session, { query: kw, center, radius, pageNum: 0, pageSize: PAGE_SIZE });
        for (const p of r.results) raw.push({ ...p, source: 'baidu_place', queriedFor: key, keyword: kw });
      } catch (err) {
        failures += 1;
        session.degrade('blind', err.kind || 'error', { keyword: kw, message: err.message, fallback: 'skip-recheck-search' });
      }
    }),
  );
  return { pois: cleanPois(raw, center, radius).pois.filter((p) => p.category === key), requests: cat.keywords.length, failures };
}

/** 是否与已有设施重复（同 UID / 同名近邻 / 高相似名称近邻），与清洗阶段的去重规则一致 */
export function findDuplicate(list, p) {
  const n = normalizeName(p.name);
  return list.find((k) => {
    if (p.uid && k.uid === p.uid) return true;
    const dist = haversine(k, p);
    const kn = normalizeName(k.name);
    return (kn === n && dist < 120) || (dist < 60 && dice(kn, n) >= 0.8);
  });
}

/** 分类 + 过滤 + 去重，纯函数，便于单元测试 */
export function cleanPois(raw, center, radius) {
  const excluded = {};
  const note = (reason, p) => {
    const e = (excluded[reason] ||= { count: 0, examples: [] });
    e.count += 1;
    if (e.examples.length < 5 && !e.examples.includes(p.name)) e.examples.push(p.name);
  };

  // 同一 UID 的多次检索结果先合并（保留检索来源信息）
  const byUid = new Map();
  let uidDuplicates = 0;
  for (const p of raw) {
    const k = p.uid ? `uid:${p.uid}` : `${p.source}:${p.name}:${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
    const prev = byUid.get(k);
    if (prev) {
      uidDuplicates += 1;
      prev.queriedFor = [...new Set([...prev.queriedFor, p.queriedFor].filter(Boolean))];
      prev.sources = [...new Set([...prev.sources, p.source])];
      if (!prev.classifiedTag && p.classifiedTag) prev.classifiedTag = p.classifiedTag;
    } else {
      byUid.set(k, { ...p, queriedFor: [p.queriedFor].filter(Boolean), sources: [p.source] });
    }
  }

  const accepted = [];
  for (const p of byUid.values()) {
    const d = haversine(center, p);
    if (d > radius * 1.05) {
      note('超出检索范围', p);
      continue;
    }
    const tag = `${p.tag || ''};${p.classifiedTag || ''}`;
    const strongTag = ALL_TARGETS.some((c) => c.tagMatch?.test(tag) && !c.tagExclude?.test(tag));
    const globalHit = GLOBAL_EXCLUDE.find((r) => r.re.test(p.name) && !(r.soft && strongTag));
    if (globalHit || /出入口;/.test(tag)) {
      note(globalHit?.reason || '出入口/附属点', p);
      continue;
    }
    const cats = [];
    let lastReason = null;
    for (const cat of ALL_TARGETS) {
      const verdict = classify(p, cat, tag);
      if (verdict.ok) cats.push({ key: cat.key, by: verdict.by });
      else if (p.queriedFor.includes(cat.key)) lastReason = verdict.reason;
    }
    if (!cats.length) {
      note(lastReason || '类别不相关', p);
      continue;
    }
    for (const c of cats) {
      accepted.push({
        id: `${c.key}:${p.uid || p.name}`,
        uid: p.uid,
        name: p.name,
        category: c.key,
        matchedBy: c.by,
        lng: p.lng,
        lat: p.lat,
        address: p.address,
        tag: p.classifiedTag || p.tag,
        sources: p.sources,
        distance: Math.round(d),
      });
    }
  }

  // 同类别内去重：同名近邻 / 高相似名称近邻 / 父子 POI
  const final = [];
  let nearDuplicates = 0;
  let childMerged = 0;
  const byCat = groupBy(accepted, (p) => p.category);
  for (const [, list] of byCat) {
    list.sort((a, b) => a.name.length - b.name.length || a.distance - b.distance);
    const kept = [];
    for (const p of list) {
      const n = normalizeName(p.name);
      const base = parentName(p.name);
      const dup = kept.find((k) => {
        const dist = haversine(k, p);
        const kn = normalizeName(k.name);
        if (kn === n && dist < 120) return true;
        if (dist < 60 && dice(kn, n) >= 0.8) return true;
        return false;
      });
      if (dup) {
        nearDuplicates += 1;
        dup.sources = [...new Set([...dup.sources, ...p.sources])];
        continue;
      }
      const parent = base && kept.find((k) => normalizeName(k.name) === normalizeName(base) && haversine(k, p) < 800);
      if (parent) {
        childMerged += 1;
        parent.children = (parent.children || 0) + 1;
        continue;
      }
      kept.push(p);
    }
    final.push(...kept);
  }
  final.sort((a, b) => a.distance - b.distance);

  const byCategory = Object.fromEntries(ALL_TARGETS.map((c) => [c.key, final.filter((p) => p.category === c.key).length]));
  return {
    pois: final.filter((p) => p.category !== RESIDENTIAL.key),
    residential: final.filter((p) => p.category === RESIDENTIAL.key),
    cleaning: {
      rawRecords: raw.length,
      uniqueRecords: byUid.size,
      uidDuplicates,
      nearDuplicates,
      childMerged,
      excluded,
      excludedTotal: Object.values(excluded).reduce((s, e) => s + e.count, 0),
      byCategory,
      multiCategory: countMulti(accepted),
    },
  };
}

/**
 * 单个 POI 对单个类别的判定
 * @returns {{ ok: boolean, by?: 'tag'|'name', reason?: string }}
 */
export function classify(p, cat, tag = `${p.tag || ''};${p.classifiedTag || ''}`) {
  const strong = Boolean(cat.tagMatch?.test(tag));
  const nameRule = (cat.exclude || []).find((r) => r.re.test(p.name) && !(r.soft && strong));
  if (nameRule) return { ok: false, reason: nameRule.reason };
  if (cat.tagExclude && cat.tagExclude.test(tag)) return { ok: false, reason: '分类标签不符' };
  if (cat.tagMatch && cat.tagMatch.test(tag)) {
    // 「购物;市场」是宽泛标签（也可能是建材 / 服装市场），只有分类标签里没有明确菜场类细分时才需要名称佐证；
    // 「XX 市场」「XX 街市」（粤港地区对菜市场的叫法）在排除规则已过滤非生鲜业态后视为菜市场
    if (cat.key === 'market' && !MARKET_STRONG.test(tag) && /购物;市场/.test(tag) && !cat.nameInclude.test(p.name) && !/(市场|街市)/.test(p.name)) {
      return { ok: false, reason: '非生鲜业态' };
    }
    return { ok: true, by: 'tag' };
  }
  const queried = Array.isArray(p.queriedFor) ? p.queriedFor.includes(cat.key) : p.queriedFor === cat.key;
  const genericTag = !p.tag || /;其他|^[^;]*$/.test(p.tag) || /购物;超市/.test(tag);
  if ((queried || p.source === 'osm') && genericTag && cat.nameInclude.test(p.name)) return { ok: true, by: 'name' };
  return { ok: false, reason: '分类标签不符' };
}

export function normalizeName(name) {
  return String(name)
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s·•\-－—_]/g, '')
    .replace(/(北京市|上海市|杭州市|海淀区|朝阳区|西湖区)/g, '')
    .toLowerCase();
}

/** 「领秀新硅谷-D区」→「领秀新硅谷」；「XX医院(新院区)-门诊」→「XX医院(新院区)」 */
export function parentName(name) {
  const m = String(name).match(/^(.{2,}?)[-－—]([^-－—]{1,10})$/);
  if (m) return m[1];
  const m2 = String(name).match(/^(.{2,}?)(?:[A-Za-z一二三四五六七八九十\d]+区|\d+号院|[东西南北中]区|[一二三四五六七八九十\d]+期)$/);
  return m2 ? m2[1] : null;
}

/** 字符二元组 Dice 相似度 */
export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, c] of ga) inter += Math.min(c, gb.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

function countMulti(accepted) {
  const m = new Map();
  for (const p of accepted) if (p.uid) m.set(p.uid, (m.get(p.uid) || 0) + 1);
  return [...m.values()].filter((v) => v > 1).length;
}

function groupBy(list, fn) {
  const m = new Map();
  for (const x of list) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** OSM Overpass 检索（国内覆盖度有限，作为补充源；结果经坐标转换为 BD-09） */
async function fetchOsm(session, center, radius) {
  const { bd09ToWgs84 } = await import('../geo/coord.js');
  const w = bd09ToWgs84(center);
  const selectors = CATEGORIES.flatMap((c) => (c.osm || []).map((s) => `${s}(around:${Math.round(radius)},${w.lat.toFixed(6)},${w.lng.toFixed(6)});`));
  const query = `[out:json][timeout:10];(${selectors.join('')});out center 300;`;
  const key = { q: query };
  const data = await session.cachedExternal('osm', key, async () => {
    const res = await fetch(config.osm.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'life-circle-checkup/1.0' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(config.osm.timeoutMs),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    return res.json();
  });
  const elements = (data.elements || []).filter((e) => e.tags?.name);
  if (!elements.length) return [];
  const pts = elements.map((e) => ({ lng: e.lon ?? e.center?.lon, lat: e.lat ?? e.center?.lat, e }));
  const converted = await toBd09(session, pts, 'wgs84');
  return converted.map(({ lng, lat, e }) => ({
    uid: `osm-${e.type}-${e.id}`,
    name: e.tags.name,
    lng,
    lat,
    address: e.tags['addr:street'] || '',
    tag: osmTag(e.tags),
    classifiedTag: osmTag(e.tags),
    source: 'osm',
    queriedFor: osmCategory(e.tags),
  }));
}

function osmTag(t) {
  if (t.amenity === 'pharmacy') return '医疗;药店';
  if (t.amenity === 'school') return '教育培训;小学';
  if (t.amenity === 'kindergarten') return '教育培训;幼儿园';
  if (t.amenity === 'marketplace' || t.shop === 'greengrocer') return '购物;市场;菜市场';
  if (['clinic', 'doctors', 'hospital'].includes(t.amenity)) return '医疗;诊所';
  if (t.amenity === 'social_facility' || t.amenity === 'nursing_home') return '生活服务;养老服务';
  if (t.shop === 'supermarket' || t.shop === 'convenience') return '购物;超市';
  if (t.highway === 'bus_stop') return '交通设施;公交车站';
  if (t.railway === 'station') return '交通设施;地铁站';
  if (t.leisure) return '旅游景点;公园';
  return '';
}

function osmCategory(t) {
  const tag = osmTag(t);
  const hit = CATEGORIES.find((c) => c.tagMatch?.test(tag));
  return hit?.key || null;
}
