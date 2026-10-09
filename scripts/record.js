#!/usr/bin/env node
/**
 * 录制回放数据：对预置社区执行真实体检，把本次触达的所有 API 响应（精简后）写入 data/replay/<key>.json。
 * 评审在未配置 AK 时，服务以回放模式运行，同一算法基于真实录制数据完整复现体检结果。
 *
 * 用法：npm run record                 录制全部预置社区（标准档）
 *       npm run record -- shangdi       只录制指定社区
 *       npm run record -- shangdi --tiers lite,standard,precise
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../server/config.js';
import { ResponseCache } from '../server/baidu/cache.js';
import { ChaosMonkey } from '../server/baidu/chaos.js';
import { BaiduClient } from '../server/baidu/client.js';
import { runAnalysis } from '../server/core/analyze.js';

const args = process.argv.slice(2);
const tiersArg = args.includes('--tiers') ? args[args.indexOf('--tiers') + 1].split(',') : ['standard'];
const keys = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--tiers');
const presets = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data/presets.json'), 'utf8')).filter((p) => !keys.length || keys.includes(p.key));

if (!config.baidu.serverAk) {
  console.error('录制需要在 .env 中配置 BAIDU_SERVER_AK');
  process.exit(1);
}
config.dataMode = 'live';

// 录制时不读旧回放库，保证数据来自真实 API（磁盘缓存仍可复用以节省配额）
const cache = new ResponseCache({ cacheDir: config.cacheDir, replayDir: null });
const client = new BaiduClient({ config, cache, chaos: new ChaosMonkey() });

for (const preset of presets) {
  const entries = {};
  let summary = '';
  for (const tier of tiersArg) {
    const t0 = Date.now();
    const { result, touched } = await runAnalysis(client, { lng: preset.lng, lat: preset.lat, name: preset.name, tier });
    for (const [key, data] of touched) entries[key] = slim(key, data);
    summary += ` ${tier}: ${result.score.total} 分 / ${result.engineering.requests} 次请求 / ${Date.now() - t0} ms;`;
  }
  const bundle = {
    name: preset.name,
    key: preset.key,
    recordedAt: new Date().toISOString(),
    tiers: tiersArg,
    note: '百度地图 Web 服务 API 真实响应（已剔除 AK 与未使用字段），用于离线回放演示与测试',
    entries,
  };
  const file = path.join(config.replayDir, `${preset.key}.json`);
  fs.mkdirSync(config.replayDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bundle));
  console.log(`✔ ${preset.name}：${Object.keys(entries).length} 条响应，${(fs.statSync(file).size / 1024).toFixed(0)} KB；${summary}`);
}

/** 只保留算法用到的字段，控制仓库体积 */
function slim(key, data) {
  const service = key.split('?')[0];
  if (service === 'place/v2/search') {
    return {
      status: data.status,
      total: data.total,
      results: (data.results || []).map((r) => ({
        uid: r.uid,
        name: r.name,
        location: r.location,
        address: r.address,
        area: r.area,
        detail_info: r.detail_info ? { tag: r.detail_info.tag, classified_poi_tag: r.detail_info.classified_poi_tag, type: r.detail_info.type } : undefined,
      })),
    };
  }
  if (service === 'reverse_geocoding/v3') {
    const r = data.result || {};
    return {
      status: data.status,
      result: {
        formatted_address: r.formatted_address,
        business: r.business,
        sematic_description: r.sematic_description,
        addressComponent: r.addressComponent && {
          city: r.addressComponent.city,
          district: r.addressComponent.district,
          town: r.addressComponent.town,
          street: r.addressComponent.street,
        },
        pois: (r.pois || []).map((p) => ({ uid: p.uid, name: p.name, tag: p.tag, addr: p.addr, point: p.point })),
      },
    };
  }
  if (service === 'routematrix/v2/walking') {
    return {
      status: data.status,
      result: (data.result || []).map((e) => ({ distance: { value: e.distance?.value }, duration: { value: e.duration?.value } })),
    };
  }
  if (service === 'osm') {
    return {
      elements: (data.elements || [])
        .filter((e) => e.tags?.name)
        .map((e) => ({
          type: e.type,
          id: e.id,
          lat: e.lat,
          lon: e.lon,
          center: e.center,
          tags: pick(e.tags, ['name', 'amenity', 'shop', 'leisure', 'highway', 'railway', 'social_facility', 'social_facility:for', 'addr:street']),
        })),
    };
  }
  return data;
}

function pick(o, keys) {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}
