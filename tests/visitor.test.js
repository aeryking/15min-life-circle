import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VisitorStore } from '../server/store/visitorStore.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lc-visitor-'));

test('访客数据：文件名为访客 ID 摘要，磁盘上不出现原始 ID', async () => {
  const dir = tmpDir();
  const vs = new VisitorStore({ dir });
  const vid = 'A'.repeat(24);
  await vs.addAnalysis(vid, 'r1');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes(vid));
  assert.ok(!fs.readFileSync(path.join(dir, files[0]), 'utf8').includes(vid));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('访客数据：旧版本遗留记录只由第一位访客认领一次', async () => {
  const dir = tmpDir();
  const vs = new VisitorStore({ dir });
  assert.equal(vs.legacyPending, true);
  await vs.claimLegacy('first-visitor-xxxxxxxxxxx', ['old1', 'old2']);
  await vs.claimLegacy('second-visitor-xxxxxxxxxx', ['old1', 'old2']);
  assert.deepEqual(await vs.analysisIds('first-visitor-xxxxxxxxxxx'), ['old1', 'old2']);
  assert.deepEqual(await vs.analysisIds('second-visitor-xxxxxxxxxx'), []);
  // 重启后已有访客数据，不再触发迁移
  assert.equal(new VisitorStore({ dir }).legacyPending, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('访客数据：并发写入串行化不丢消息，历史去重且新记录在前', async () => {
  const dir = tmpDir();
  const vs = new VisitorStore({ dir });
  const vid = 'B'.repeat(24);
  await Promise.all(Array.from({ length: 20 }, (_, i) => vs.appendChat(vid, 'r1', { role: 'user', text: `q${i}` })));
  assert.equal((await vs.chat(vid, 'r1')).length, 20);
  await vs.addAnalysis(vid, 'r1');
  await vs.addAnalysis(vid, 'r2');
  await vs.addAnalysis(vid, 'r1');
  assert.deepEqual(await vs.analysisIds(vid), ['r1', 'r2']);
  // 重新加载（清空内存）后数据仍在
  assert.equal((await new VisitorStore({ dir }).chat(vid, 'r1')).length, 20);
  fs.rmSync(dir, { recursive: true, force: true });
});
