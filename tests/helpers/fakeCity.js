import { haversine, bearing } from '../../server/geo/geo.js';

/**
 * 合成城市：步行距离 = 直线距离 × 1.25；东侧（方位 45°–135°）存在一条距中心 400 m 的「河流」，
 * 只能从一座桥绕行，越过河后额外增加 600 m。用于在无网络环境下测试完整算法链路。
 */
export function fakeWalk(a, b) {
  const s = haversine(a, b);
  let d = s * 1.25;
  const br = bearing(a, b);
  if (br > 45 && br < 135 && s > 400) d += 600;
  return Math.round(d);
}

/**
 * 对称的合成路网：中心以东 riverX 米处有一条南北走向的河，两点分处两岸时步行额外 +600 m。
 * 与真实路网一样满足 d(a, b) = d(b, a)，用于检验与起终点方向无关的算法（如盲区的分支定界）。
 */
export function riverWalk(center, riverX = 400) {
  const k = Math.cos((center.lat * Math.PI) / 180) * 111320;
  const x = (p) => (p.lng - center.lng) * k;
  return (a, b) => {
    const d = haversine(a, b) * 1.25 + ((x(a) - riverX) * (x(b) - riverX) < 0 ? 600 : 0);
    return Math.round(d);
  };
}

/** 模拟 ClientSession：按服务返回合成数据，并记录调用次数；walk 可替换合成路网 */
export function fakeSession({ pois = [], failRate = 0, walk = fakeWalk } = {}) {
  const stats = { requests: 0, network: 0, cache: 0, replay: 0, retries: 0, failures: 0, matrixElements: 0, byService: {}, degradations: [] };
  const parse = (str) =>
    str.split('|').map((x) => {
      const [lat, lng] = x.split(',').map(Number);
      return { lng, lat };
    });
  return {
    stats,
    counts: { requests: 0 },
    touched: new Map(),
    degrade(stage, reason, detail) {
      stats.degradations.push({ stage, reason, ...detail });
    },
    async cachedExternal() {
      return { elements: [] };
    },
    async request(service, params) {
      stats.requests += 1;
      this.counts.requests += 1;
      stats.byService[service] = (stats.byService[service] || 0) + 1;
      if (failRate && Math.random() < failRate) {
        const err = new Error('fake failure');
        err.kind = 'transient';
        throw err;
      }
      if (service === 'routematrix/v2/walking') {
        const os = parse(params.origins);
        const ds = parse(params.destinations);
        const result = [];
        for (const o of os)
          for (const d of ds) {
            const m = walk(o, d);
            result.push({ distance: { value: m }, duration: { value: Math.round(m / 1.1) } });
          }
        return { status: 0, result };
      }
      if (service === 'place/v2/search') {
        const hits = pois.filter((p) => p.keyword === params.query);
        return {
          status: 0,
          total: hits.length,
          results: hits.map((p) => ({
            uid: p.uid,
            name: p.name,
            location: { lng: p.lng, lat: p.lat },
            address: '',
            detail_info: { tag: p.tag, classified_poi_tag: p.tag },
          })),
        };
      }
      if (service === 'reverse_geocoding/v3') {
        return { status: 0, result: { formatted_address: '测试市测试区', sematic_description: '测试社区附近', addressComponent: {}, pois: [] } };
      }
      return { status: 0, result: [] };
    },
  };
}
