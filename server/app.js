import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { ResponseCache } from './baidu/cache.js';
import { ChaosMonkey } from './baidu/chaos.js';
import { BaiduClient } from './baidu/client.js';
import { AnalysisStore } from './store/analysisStore.js';
import { VisitorStore } from './store/visitorStore.js';
import { createApiRouter } from './routes/api.js';

export function createApp({ fetchImpl } = {}) {
  const cache = new ResponseCache({ cacheDir: config.cacheDir, replayDir: config.replayDir });
  const chaos = new ChaosMonkey(config.chaos);
  const client = new BaiduClient({ config, cache, chaos, fetchImpl });
  const store = new AnalysisStore({ dir: config.analysesDir });
  const visitors = new VisitorStore({ dir: config.visitorsDir });

  const app = express();
  app.disable('x-powered-by');
  app.use('/api', visitors.middleware(), createApiRouter({ client, store, visitors }));

  // 生产模式：托管前端构建产物（SPA 回退到 index.html）
  if (fs.existsSync(path.join(config.webDistDir, 'index.html'))) {
    app.use(express.static(config.webDistDir, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(config.webDistDir, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text/plain; charset=utf-8').send('前端尚未构建：请执行 npm run build，或使用 npm run dev 启动开发模式。'));
  }
  return { app, client, store, visitors, cache };
}
