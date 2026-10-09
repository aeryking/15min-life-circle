<template>
  <aside class="result">
    <div v-if="!v" class="empty">
      <div class="empty-icon">🗺️</div>
      <h3>选择社区，开始 15 分钟生活圈体检</h3>
      <ol>
        <li>在左侧搜索地址、点击地图或选择预置社区</li>
        <li>
          点击「开始智能体检」，系统基于
          <b>真实步行路网</b>
          生成等时圈
        </li>
        <li>
          自动统计九类民生设施、识别 1 公里
          <b>服务盲区</b>
          并给出
          <b>补点选址</b>
        </li>
      </ol>
    </div>
    <template v-else>
      <header class="rhead">
        <div class="title-row">
          <h2 :title="v.name">{{ v.name }}</h2>
          <div v-if="state.result" class="actions">
            <button class="btn sm" title="生成可打印 / 另存为 PDF 的体检报告" @click="state.view = 'report'">📄 报告</button>
            <a class="btn sm" :href="api.geojsonUrl(state.result.id)" title="导出 GeoJSON">⬇ GeoJSON</a>
          </div>
        </div>
        <div class="sub muted">
          {{ v.address || v.district }}
          <span v-if="state.result" class="chip" :class="state.result.dataMode === 'live' ? 'brand' : 'warn'">
            {{ state.result.dataMode === 'live' ? '实时数据' : '回放数据' }}
          </span>
          <span v-if="state.result?.reused" class="chip">结果缓存</span>
        </div>
      </header>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="{ on: state.tab === t.key, 'has-badge': t.badge }"
          :disabled="t.need && !t.need()"
          @click="state.tab = t.key"
        >
          {{ t.name }}
          <sup v-if="t.badge" class="badge">{{ t.badge }}</sup>
        </button>
      </nav>
      <div class="body scroll">
        <OverviewTab v-if="state.tab === 'overview'" />
        <FacilitiesTab v-else-if="state.tab === 'facilities'" />
        <BlindTab v-else-if="state.tab === 'blind'" />
        <PlanTab v-else-if="state.tab === 'plan'" />
        <EngineeringTab v-else-if="state.tab === 'engineering'" />
        <AssistantTab v-else-if="state.tab === 'assistant'" />
      </div>
    </template>
  </aside>
</template>

<script setup>
import { state, view } from '../store.js';
import { api } from '../api.js';
import OverviewTab from './tabs/OverviewTab.vue';
import FacilitiesTab from './tabs/FacilitiesTab.vue';
import BlindTab from './tabs/BlindTab.vue';
import PlanTab from './tabs/PlanTab.vue';
import EngineeringTab from './tabs/EngineeringTab.vue';
import AssistantTab from './tabs/AssistantTab.vue';

const v = view;
const tabs = [
  { key: 'overview', name: '总览' },
  { key: 'facilities', name: '设施', need: () => v.value?.pois?.length },
  { key: 'blind', name: '盲区', need: () => v.value?.blind },
  { key: 'plan', name: '规划', need: () => state.result },
  { key: 'assistant', name: 'AI 助手', badge: 'Beta', need: () => state.result },
  // 调用量、耗时与故障演练：面向评审与技术人员，放在业务流程之后
  { key: 'engineering', name: '技术指标', need: () => state.result },
];
</script>

<style scoped>
.result {
  width: 440px;
  flex: none;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.empty {
  padding: 40px 28px;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 40px;
}

.empty h3 {
  color: var(--text-primary);
  margin: 12px 0;
}

.empty ol {
  padding-left: 18px;
  line-height: 2;
}

.rhead {
  padding: 14px 16px 8px;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 17px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions {
  display: flex;
  gap: 6px;
}

.actions a {
  text-decoration: none;
  color: inherit;
}

.sub {
  font-size: 12px;
  margin-top: 4px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.tabs {
  display: flex;
  gap: 2px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}

.tabs button {
  border: 0;
  background: transparent;
  padding: 9px 10px;
  cursor: pointer;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  font-weight: 500;
}

.tabs button {
  position: relative;
}

/* 标签右上角的角标胶囊（如 Beta），为角标留出右侧空间 */
.tabs button.has-badge {
  margin-right: 16px;
}

.badge {
  position: absolute;
  top: -1px;
  right: -16px;
  padding: 0 5px;
  border-radius: 7px;
  background: var(--brand);
  color: var(--on-brand);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.tabs button.on {
  color: var(--brand);
  border-bottom-color: var(--brand);
}

.tabs button:disabled {
  color: var(--text-muted);
  opacity: 0.5;
  cursor: default;
}

.body {
  flex: 1;
  min-height: 0;
  padding: 14px 16px 24px;
}
</style>
