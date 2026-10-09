import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const COOKIE = 'lc_vid';
const VID_RE = /^[A-Za-z0-9_-]{22,64}$/;
const MAX_ANALYSES = 100;
const MAX_CHATS = 100;
const MAX_MESSAGES = 60;

/**
 * 匿名访客隔离：无需登录，服务端为每个浏览器签发随机访客 ID（HttpOnly Cookie）。
 * 每位访客只能看到自己的体检历史，AI 对话按「访客 × 体检编号」分别保存。
 * 磁盘上只保存访客 ID 的 SHA-256 摘要作为文件名，数据文件本身不含可用于冒充的凭据。
 */
export class VisitorStore {
  constructor({ dir, maxMemory = 200 }) {
    this.dir = dir;
    this.maxMemory = maxMemory;
    this.memory = new Map();
    this.queues = new Map();
    fs.mkdirSync(dir, { recursive: true });
    // 升级前的体检记录没有归属：若尚无任何访客数据，则由升级后第一位访客认领（本地单人使用的平滑迁移）
    this.legacyPending = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length === 0;
  }

  /** Express 中间件：读取或签发访客 ID，挂到 req.visitorId */
  middleware() {
    return (req, res, next) => {
      let vid = readCookie(req.headers.cookie, COOKIE);
      if (!vid || !VID_RE.test(vid)) {
        vid = crypto.randomBytes(18).toString('base64url');
        const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `${COOKIE}=${vid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
      }
      req.visitorId = vid;
      next();
    };
  }

  #key(vid) {
    return crypto.createHash('sha256').update(vid).digest('hex').slice(0, 32);
  }

  async #load(vid) {
    const key = this.#key(vid);
    if (this.memory.has(key)) return this.memory.get(key);
    let doc;
    try {
      doc = JSON.parse(await fsp.readFile(path.join(this.dir, `${key}.json`), 'utf8'));
    } catch {
      doc = { createdAt: new Date().toISOString(), analyses: [], chats: {} };
    }
    this.memory.set(key, doc);
    while (this.memory.size > this.maxMemory) this.memory.delete(this.memory.keys().next().value);
    return doc;
  }

  /** 同一访客的读改写串行执行，避免并发请求互相覆盖 */
  #update(vid, fn) {
    const key = this.#key(vid);
    const prev = this.queues.get(key) || Promise.resolve();
    const run = prev.then(async () => {
      const doc = await this.#load(vid);
      const out = fn(doc);
      doc.updatedAt = new Date().toISOString();
      await fsp.writeFile(path.join(this.dir, `${key}.json`), JSON.stringify(doc));
      return out;
    });
    const tail = run.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => this.queues.get(key) === tail && this.queues.delete(key));
    return run;
  }

  /** 体检历史（新 → 旧）的编号列表 */
  async analysisIds(vid) {
    return (await this.#load(vid)).analyses.map((a) => a.id);
  }

  addAnalysis(vid, id) {
    return this.#update(vid, (doc) => {
      doc.analyses = [{ id, at: Date.now() }, ...doc.analyses.filter((a) => a.id !== id)].slice(0, MAX_ANALYSES);
    });
  }

  /**
   * 通过链接打开的报告（含他人分享的）：不在历史中时加到最前，已在历史中则保持原有顺序。
   * 只读访问不写盘，避免每次打开都产生写入。
   */
  async ensureAnalysis(vid, id) {
    const doc = await this.#load(vid);
    if (doc.analyses.some((a) => a.id === id)) return false;
    await this.addAnalysis(vid, id);
    return true;
  }

  /** 升级迁移：把旧版本遗留的全部体检记录归入该访客 */
  async claimLegacy(vid, ids) {
    if (!this.legacyPending) return;
    this.legacyPending = false;
    if (!ids.length) return;
    await this.#update(vid, (doc) => {
      const have = new Set(doc.analyses.map((a) => a.id));
      doc.analyses = [...doc.analyses, ...ids.filter((id) => !have.has(id)).map((id) => ({ id, at: Date.now() }))].slice(0, MAX_ANALYSES);
    });
  }

  async chat(vid, analysisId) {
    return (await this.#load(vid)).chats[analysisId]?.messages || [];
  }

  appendChat(vid, analysisId, ...messages) {
    return this.#update(vid, (doc) => {
      const c = doc.chats[analysisId] || { messages: [] };
      c.messages = [...c.messages, ...messages.map((m) => ({ ...m, at: Date.now() }))].slice(-MAX_MESSAGES);
      c.updatedAt = Date.now();
      delete doc.chats[analysisId];
      doc.chats[analysisId] = c;
      // 只保留最近活跃的若干段对话
      const keys = Object.keys(doc.chats);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_CHATS))) delete doc.chats[k];
      return c.messages;
    });
  }

  /** 从该访客的历史中移除一份报告（连同其在这份报告下的对话）；报告本身不删除，其他访客不受影响 */
  removeAnalysis(vid, id) {
    return this.#update(vid, (doc) => {
      const before = doc.analyses.length;
      doc.analyses = doc.analyses.filter((a) => a.id !== id);
      delete doc.chats[id];
      return doc.analyses.length < before;
    });
  }

  clearChat(vid, analysisId) {
    return this.#update(vid, (doc) => {
      delete doc.chats[analysisId];
    });
  }
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
