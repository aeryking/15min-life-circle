<template>
  <div class="app">
    <TopBar v-if="state.view !== 'report'" />
    <div v-if="state.configError" class="fatal">
      无法连接后端服务：{{ state.configError }}。请确认已执行
      <code>npm start</code>
      。
    </div>
    <template v-else-if="state.config">
      <div v-show="state.view === 'main'" class="workspace">
        <ControlPanel />
        <main class="map-area"><MapView /></main>
        <ResultPanel />
      </div>
      <ReportView v-if="state.view === 'report' && state.result" />
      <CompareView v-if="state.view === 'compare'" />
      <HistoryView v-if="state.view === 'history'" />
    </template>
    <div v-else class="loading muted">加载中…</div>
    <Transition name="toast">
      <div v-if="state.notice" class="toast" role="status" @click="state.notice = null">{{ state.notice }}</div>
    </Transition>
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue';
import { state, loadConfig } from './store.js';
import { initRouter } from './router.js';
import TopBar from './components/TopBar.vue';
import ControlPanel from './components/ControlPanel.vue';
import MapView from './components/MapView.vue';
import ResultPanel from './components/ResultPanel.vue';
import ReportView from './components/ReportView.vue';
import CompareView from './components/CompareView.vue';
import HistoryView from './components/HistoryView.vue';

onMounted(async () => {
  await loadConfig();
  if (state.config) initRouter();
});

// 提示条几秒后自动消失
let noticeTimer = null;
watch(
  () => state.notice,
  (n) => {
    clearTimeout(noticeTimer);
    if (n) noticeTimer = setTimeout(() => (state.notice = null), 5000);
  },
);
</script>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}

.map-area {
  flex: 1;
  min-width: 0;
  position: relative;
}

.toast {
  position: fixed;
  top: 68px;
  left: 50%;
  z-index: 3000;
  transform: translateX(-50%);
  padding: 8px 16px;
  border: 1px solid var(--warn-border);
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn-text);
  font-size: 13px;
  box-shadow: 0 4px 16px rgb(15 23 42 / 12%);
  cursor: pointer;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}

.fatal,
.loading {
  padding: 40px;
  text-align: center;
}

@media print {
  .toast {
    display: none;
  }
}

@media (max-width: 1180px) {
  .workspace {
    flex-direction: column;
    overflow: auto;
  }

  .map-area {
    min-height: 60vh;
  }
}
</style>
