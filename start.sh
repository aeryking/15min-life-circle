#!/usr/bin/env bash
# 一键启动：安装依赖 → 构建前端 → 启动服务（未配置 AK 时自动进入离线回放模式）
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node.js 20.12 及以上版本（https://nodejs.org）"; exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node.js 版本过低（当前 $(node -v)），需要 ≥ 20.12"; exit 1; fi

[ -f .env ] || { cp .env.example .env; echo "已从 .env.example 生成 .env（未填写 AK 时使用离线回放模式）"; }
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build
npm start
