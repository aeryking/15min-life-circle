<template>
  <header class="topbar">
    <div class="brand">
      <img src="/favicon.svg" alt="" width="28" height="28" />
      <div>
        <div class="name">生活圈体检助手</div>
        <div class="sub">基于百度地图开放能力的 15 分钟生活圈智能体检与规划</div>
      </div>
    </div>
    <div class="center"><RunStatus /></div>
    <div class="right">
      <span
        v-if="state.config"
        class="chip"
        :class="state.config.online ? 'good' : 'warn'"
        :title="state.config.online ? '服务端实时调用百度地图 Web 服务 API（带磁盘缓存）' : '未配置服务端 AK：使用录制的真实 API 响应回放，零外部调用'"
      >
        {{ state.config.online ? '● 实时模式' : '▲ 离线回放模式' }}
      </span>
      <span v-if="state.config" class="chip" :class="state.config.llm ? 'brand' : ''">{{ state.config.llm ? 'AI：大模型' : 'AI：规则引擎' }}</span>
      <button
        class="btn sm ghost theme-btn"
        :title="theme === 'dark' ? '切换到浅色模式' : '切换到暗黑模式'"
        :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到暗黑模式'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '☀️ 浅色' : '🌙 暗黑' }}
      </button>
      <button class="btn sm ghost" :class="{ on: state.view === 'history' }" @click="state.view = state.view === 'history' ? 'main' : 'history'">
        🕘 历史记录
      </button>
      <button class="btn sm ghost" :class="{ on: state.view === 'compare' }" @click="state.view = state.view === 'compare' ? 'main' : 'compare'">
        📊 多社区对比
      </button>
    </div>
  </header>
</template>

<script setup>
import { state } from '../store.js';
import { theme, toggleTheme } from '../utils/theme.js';
import RunStatus from './RunStatus.vue';
</script>

<style scoped>
.topbar {
  height: 56px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.brand {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 1280px) {
  .sub {
    display: none;
  }
}

.name {
  font-weight: 700;
  font-size: 16px;
}

.sub {
  font-size: 12px;
  color: var(--text-muted);
}

.center {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  padding: 0 16px;
}

.right {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.right a {
  text-decoration: none;
  color: inherit;
}

.btn.on {
  background: var(--brand-soft);
  color: var(--brand-strong);
}
</style>
