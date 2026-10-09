import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * 体检结果存储：JSON 文件持久化 + 内存 LRU。
 * 另维护「参数 → 结果」索引，相同参数的重复体检在有效期内直接复用结果（结果级缓存）。
 */
export class AnalysisStore {
  constructor({ dir, maxMemory = 30, reuseMs = 6 * 3600 * 1000 }) {
    this.dir = dir;
    this.maxMemory = maxMemory;
    this.reuseMs = reuseMs;
    this.memory = new Map();
    this.byParams = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  #file(id) {
    if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error('非法的体检编号'), { status: 400 });
    return path.join(this.dir, `${id}.json`);
  }

  async save(result, paramsKey) {
    this.#remember(result);
    if (paramsKey) this.byParams.set(paramsKey, { id: result.id, at: Date.now() });
    await fsp.writeFile(this.#file(result.id), JSON.stringify(result));
    return result.id;
  }

  async get(id) {
    if (this.memory.has(id)) return this.memory.get(id);
    try {
      const r = JSON.parse(await fsp.readFile(this.#file(id), 'utf8'));
      this.#remember(r);
      return r;
    } catch (err) {
      if (err.status) throw err;
      return null;
    }
  }

  async findReusable(paramsKey) {
    const hit = this.byParams.get(paramsKey);
    if (!hit || Date.now() - hit.at > this.reuseMs) return null;
    return this.get(hit.id);
  }

  /** 全部体检编号（新 → 旧），用于旧版本数据迁移 */
  async allIds() {
    let files = [];
    try {
      files = (await fsp.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const items = await Promise.all(
      files.map(async (f) => {
        const stat = await fsp.stat(path.join(this.dir, f));
        return { id: f.replace(/\.json$/, ''), mtime: stat.mtimeMs };
      }),
    );
    return items.sort((a, b) => b.mtime - a.mtime).map((it) => it.id);
  }

  /** 按给定编号顺序返回摘要，已不存在的记录自动跳过 */
  async summaries(ids, limit = 30) {
    const out = [];
    for (const id of ids) {
      if (out.length >= limit) break;
      const r = await this.get(id).catch(() => null);
      if (r) out.push(summary(r));
    }
    return out;
  }

  #remember(r) {
    this.memory.delete(r.id);
    this.memory.set(r.id, r);
    while (this.memory.size > this.maxMemory) this.memory.delete(this.memory.keys().next().value);
  }
}

export function summary(r) {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    center: r.center,
    createdAt: r.createdAt,
    score: r.score?.total,
    grade: r.score?.grade,
    elderlyScore: r.elderlyScore?.total ?? null,
    childScore: r.childScore?.total ?? null,
    district: r.district || '',
    tier: r.params?.tier,
    tierName: r.params?.tierName,
    minutes: r.params?.minutes,
    threshold: r.params?.threshold,
    // 各人群步速（米/秒）：口径的一部分，不同步速下的等时圈不可直接比较
    speeds: Object.fromEntries((r.params?.profiles || []).map((p) => [p.key, p.speed])),
    dataMode: r.dataMode,
    blindRatio: r.blind?.union?.blindRatio,
    residentialTotal: r.blind?.union?.residentialTotal ?? null,
    residentialBlind: r.blind?.union?.residentialBlind ?? null,
    presetKey: r.presetKey || null,
  };
}
