import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 请求级缓存 + 回放库。
 *
 * - 缓存键 = 服务路径 + 排序后的请求参数（剔除 ak），与 AK 无关，可安全提交回放数据；
 * - 磁盘缓存：data/cache/<service>/<hash>.json，按服务设置 TTL；
 * - 回放库：data/replay/*.json，由 `npm run record` 从真实请求录制，只读、永不过期，
 *   用于评审零配置演示与离线测试。
 */

export function cacheKey(service, params) {
  const clean = Object.keys(params)
    .filter((k) => k !== 'ak' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return `${service}?${clean}`;
}

const hash = (key) => crypto.createHash('sha1').update(key).digest('hex');

const DAY = 86400000;
/** 各服务缓存有效期：路网变化慢，POI 变化相对快 */
export const TTL = {
  'routematrix/v2/walking': 30 * DAY,
  'directionlite/v1/walking': 30 * DAY,
  'place/v2/search': 7 * DAY,
  'place/v2/suggestion': 7 * DAY,
  'geocoding/v3': 90 * DAY,
  'reverse_geocoding/v3': 30 * DAY,
  'geoconv/v2': 365 * DAY,
  osm: 30 * DAY,
};

export class ResponseCache {
  constructor({ cacheDir, replayDir }) {
    this.cacheDir = cacheDir;
    this.replayDir = replayDir;
    this.replay = new Map();
    this.memory = new Map();
    this.replayBundles = [];
    this.#loadReplay();
  }

  #loadReplay() {
    if (!this.replayDir || !fs.existsSync(this.replayDir)) return;
    for (const file of fs
      .readdirSync(this.replayDir)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      try {
        const bundle = JSON.parse(fs.readFileSync(path.join(this.replayDir, file), 'utf8'));
        const entries = bundle.entries || {};
        for (const [k, v] of Object.entries(entries)) this.replay.set(k, v);
        this.replayBundles.push({ file, name: bundle.name, recordedAt: bundle.recordedAt, entries: Object.keys(entries).length });
      } catch (err) {
        console.warn(`[cache] 回放文件 ${file} 解析失败：${err.message}`);
      }
    }
  }

  getReplay(key) {
    return this.replay.has(key) ? this.replay.get(key) : undefined;
  }

  #file(service, key) {
    const h = hash(key);
    return path.join(this.cacheDir, service.replace(/[^\w]+/g, '_'), h.slice(0, 2), `${h}.json`);
  }

  async get(service, key) {
    const mem = this.memory.get(key);
    const ttl = TTL[service] ?? 7 * DAY;
    if (mem && Date.now() - mem.t < ttl) return mem.data;
    try {
      const raw = JSON.parse(await fsp.readFile(this.#file(service, key), 'utf8'));
      if (Date.now() - raw.t < ttl) {
        this.memory.set(key, raw);
        return raw.data;
      }
    } catch {
      // 未命中
    }
    return undefined;
  }

  async set(service, key, data) {
    const entry = { t: Date.now(), key, data };
    this.memory.set(key, entry);
    const file = this.#file(service, key);
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, JSON.stringify(entry));
    } catch (err) {
      console.warn(`[cache] 写入失败：${err.message}`);
    }
  }
}
