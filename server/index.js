import { config } from './config.js';
import { createApp } from './app.js';

const { app, client, cache } = createApp();

app.listen(config.port, config.host, () => {
  const mode = client.mode === 'live' ? '实时模式（调用百度地图 API，带磁盘缓存）' : '回放模式（使用 data/replay 录制的真实响应，零外部调用）';
  console.log(`\n  15 分钟生活圈体检助手已启动`);
  console.log(`  ➜ 访问地址：http://localhost:${config.port}`);
  console.log(`  ➜ 数据模式：${mode}`);
  console.log(`  ➜ 回放库：${cache.replay.size} 条记录（${cache.replayBundles.map((b) => b.name || b.file).join('、') || '无'}）`);
  console.log(
    `  ➜ 服务端 AK：${config.baidu.serverAk ? mask(config.baidu.serverAk) : '未配置'}；浏览器端 AK：${config.baidu.browserAk ? mask(config.baidu.browserAk) : '未配置（将使用开源底图）'}\n`,
  );
});

function mask(ak) {
  return `${ak.slice(0, 4)}****${ak.slice(-4)}`;
}
