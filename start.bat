@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul || (echo 未检测到 Node.js，请先安装 Node.js 20.12 及以上版本 & exit /b 1)
if not exist .env copy .env.example .env >nul
if not exist node_modules call npm ci --no-audit --no-fund
call npm run build
call npm start
