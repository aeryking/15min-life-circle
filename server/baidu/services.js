import { BaiduApiError, ErrorKind } from './errors.js';
import { wgs84ToBd09, gcj02ToBd09 } from '../geo/coord.js';
import { haversine } from '../geo/geo.js';

/**
 * 百度地图 Web 服务 API 封装（坐标系统一为 BD-09 经纬度）。
 * 所有函数的第一个参数为 ClientSession，保证调用统计归属到具体分析任务。
 */

const fmt = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** 地理编码：地址 → 坐标 */
export async function geocode(session, address, city) {
  const data = await session.request('geocoding/v3', { address, city, output: 'json', ret_coordtype: 'bd09ll' });
  const r = data.result;
  if (!r?.location) throw new BaiduApiError('地址解析无结果', { kind: ErrorKind.NO_RESULT, service: 'geocoding/v3' });
  return {
    lng: r.location.lng,
    lat: r.location.lat,
    precise: r.precise === 1,
    confidence: r.confidence,
    level: r.level,
  };
}

/** 逆地理编码：坐标 → 结构化地址（可附带周边 POI） */
export async function reverseGeocode(session, point, { pois = false, radius = 300, poiTypes } = {}) {
  const data = await session.request('reverse_geocoding/v3', {
    location: fmt(point),
    output: 'json',
    coordtype: 'bd09ll',
    extensions_poi: pois ? 1 : 0,
    radius: pois ? radius : undefined,
    poi_types: poiTypes,
  });
  const r = data.result || {};
  return {
    address: r.formatted_address || '',
    business: r.business || '',
    component: r.addressComponent || {},
    sematicDescription: r.sematic_description || '',
    pois: (r.pois || []).map((p) => ({
      uid: p.uid,
      name: p.name,
      tag: p.tag || '',
      address: p.addr || '',
      lng: Number(p.point?.x),
      lat: Number(p.point?.y),
    })),
  };
}

/** 地点检索（圆形区域），scope=2 返回 tag 等详细信息 */
export async function placeSearch(session, { query, tag, center, radius, pageNum = 0, pageSize = 20 }) {
  const data = await session.request('place/v2/search', {
    query,
    tag,
    location: fmt(center),
    radius: Math.round(radius),
    radius_limit: 'true',
    scope: 2,
    output: 'json',
    page_size: pageSize,
    page_num: pageNum,
  });
  return {
    total: Number(data.total || 0),
    results: (data.results || [])
      .filter((r) => r.location)
      .map((r) => ({
        uid: r.uid,
        name: r.name,
        address: r.address || '',
        lng: r.location.lng,
        lat: r.location.lat,
        tag: r.detail_info?.tag || '',
        classifiedTag: r.detail_info?.classified_poi_tag || '',
        type: r.detail_info?.type || '',
        area: r.area || '',
        telephone: r.telephone || '',
      })),
  };
}

/**
 * 批量步行算路（距离矩阵）。自动按「起点数 × 终点数 ≤ 上限」切块并发执行；
 * 某个分块失败时，元素数很少则改用单条步行路线 API 补算，否则置空交由上层估算。
 *
 * @returns {Promise<Array<Array<{distance:number,duration:number}|null>>>} matrix[i][j]
 */
export async function routeMatrixWalking(session, origins, destinations, { maxElements = 50 } = {}) {
  const matrix = origins.map(() => destinations.map(() => null));
  if (!origins.length || !destinations.length) return matrix;

  const chunks = planMatrixChunks(origins.length, destinations.length, maxElements);
  await Promise.all(
    chunks.map(async ({ o0, o1, d0, d1 }) => {
      const os = origins.slice(o0, o1);
      const ds = destinations.slice(d0, d1);
      try {
        const data = await session.request('routematrix/v2/walking', {
          origins: os.map(fmt).join('|'),
          destinations: ds.map(fmt).join('|'),
          output: 'json',
          coord_type: 'bd09ll',
        });
        const result = data.result || [];
        session.stats.matrixElements += os.length * ds.length;
        for (let i = 0; i < os.length; i++) {
          for (let j = 0; j < ds.length; j++) {
            const el = result[i * ds.length + j];
            const distance = el?.distance?.value;
            const duration = el?.duration?.value;
            if (Number.isFinite(distance) && Number.isFinite(duration)) {
              matrix[o0 + i][d0 + j] = { distance, duration };
            }
          }
        }
      } catch (err) {
        const small = os.length * ds.length <= 4;
        const canFallback = small && err.kind !== ErrorKind.QUOTA && err.kind !== ErrorKind.AUTH;
        session.degrade('routematrix', err.kind || 'error', {
          message: err.message,
          elements: os.length * ds.length,
          fallback: canFallback ? 'directionlite' : 'estimate',
        });
        if (!canFallback) return;
        for (let i = 0; i < os.length; i++) {
          for (let j = 0; j < ds.length; j++) {
            try {
              matrix[o0 + i][d0 + j] = await walkingRoute(session, os[i], ds[j]);
            } catch {
              // 仍失败：保留 null，由上层用绕行系数估算
            }
          }
        }
      }
    }),
  );
  return matrix;
}

/** 规划矩阵分块：尽量让每块元素数接近上限，减少请求次数 */
export function planMatrixChunks(nO, nD, maxElements) {
  const chunks = [];
  if (nD >= maxElements) {
    for (let o = 0; o < nO; o++) {
      for (let d = 0; d < nD; d += maxElements) chunks.push({ o0: o, o1: o + 1, d0: d, d1: Math.min(nD, d + maxElements) });
    }
    return chunks;
  }
  const oPer = Math.max(1, Math.floor(maxElements / nD));
  for (let o = 0; o < nO; o += oPer) chunks.push({ o0: o, o1: Math.min(nO, o + oPer), d0: 0, d1: nD });
  return chunks;
}

/** 单条步行路线（轻量路线规划），返回距离、时长与路径折线 */
export async function walkingRoute(session, origin, destination, { withPath = false } = {}) {
  const data = await session.request('directionlite/v1/walking', {
    origin: fmt(origin),
    destination: fmt(destination),
    coord_type: 'bd09ll',
  });
  const route = data.result?.routes?.[0];
  if (!route) throw new BaiduApiError('步行路线无结果', { kind: ErrorKind.NO_RESULT, service: 'directionlite/v1/walking' });
  const out = { distance: route.distance, duration: route.duration };
  if (withPath) {
    out.path = route.steps.flatMap((s) =>
      String(s.path || '')
        .split(';')
        .filter(Boolean)
        .map((pair) => {
          const [lng, lat] = pair.split(',').map(Number);
          return { lng, lat };
        }),
    );
  }
  return out;
}

/**
 * 坐标转换为 BD-09。优先调用百度坐标转换 API（每批 ≤ 100 个），失败时本地算法兜底。
 * @param {'wgs84'|'gcj02'} from
 */
export async function toBd09(session, points, from = 'wgs84') {
  const model = from === 'wgs84' ? 2 : 1;
  const local = from === 'wgs84' ? wgs84ToBd09 : gcj02ToBd09;
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    try {
      const data = await session.request('geoconv/v2', {
        coords: batch.map((p) => `${p.lng.toFixed(7)},${p.lat.toFixed(7)}`).join(';'),
        model,
      });
      data.result.forEach((r, k) => out.push({ ...batch[k], lng: r.x, lat: r.y, converter: 'api' }));
    } catch (err) {
      session.degrade('geoconv', err.kind || 'error', { message: err.message, fallback: 'local-formula' });
      batch.forEach((p) => out.push({ ...p, ...local(p), converter: 'local' }));
    }
  }
  return out;
}

/** 以直线距离与绕行系数估算步行距离（降级方案） */
export function estimateWalk(a, b, detour, speed) {
  const distance = haversine(a, b) * detour;
  return { distance, duration: distance / speed, estimated: true };
}

/** 地点输入提示（搜索框联想） */
export async function placeSuggest(session, query, region = '全国') {
  const data = await session.request('place/v2/suggestion', { query, region, city_limit: 'false', output: 'json', ret_coordtype: 'bd09ll' });
  return (data.result || [])
    .filter((r) => r.location)
    .map((r) => ({ name: r.name, city: r.city, district: r.district, lng: r.location.lng, lat: r.location.lat, address: r.address || '' }));
}
