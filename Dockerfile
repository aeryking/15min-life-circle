# ---------- 构建阶段：安装全部依赖并构建前端 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- 运行阶段：仅包含运行所需文件 ----------
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/data/presets.json ./data/presets.json
COPY --from=build /app/data/replay ./data/replay
RUN mkdir -p data/cache data/analyses data/visitors && chown -R node:node data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/index.js"]
