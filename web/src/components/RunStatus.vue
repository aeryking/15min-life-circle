<template>
  <Transition name="fade">
    <button v-if="mode" class="run-status" :class="mode" :title="title" @click="goMain">
      <template v-if="mode === 'running'">
        <span class="spinner" aria-hidden="true"></span>
        <span class="label">正在体检</span>
        <span class="target">{{ state.centerLabel || '自定义中心点' }}</span>
        <span class="stage">{{ stageName }}</span>
        <span class="pct num">{{ pct }}%</span>
        <span class="bar"><span class="fill" :style="{ width: `${pct}%` }"></span></span>
      </template>
      <template v-else-if="mode === 'done'">
        <span class="icon">✓</span>
        <span class="label">{{ state.result.reused ? '已复用近期结果' : '体检完成' }}</span>
        <span class="target">{{ state.result.name }}</span>
        <span class="score num">{{ state.result.score.total }} 分 · {{ state.result.score.grade }}</span>
      </template>
      <template v-else>
        <span class="icon">⚠</span>
        <span class="label">体检失败</span>
        <span class="target">{{ state.error }}</span>
      </template>
    </button>
  </Transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { state, stages } from '../store.js';

// 完成提示停留的时长；运行中与失败状态则一直显示，直到状态变化
const DONE_MS = 8000;
const justDone = ref(false);
let timer = null;

watch(
  () => state.running,
  (now, before) => {
    clearTimeout(timer);
    justDone.value = false;
    if (before && !now && state.result && !state.error) {
      justDone.value = true;
      // 结果到达后地图与图表要重绘，等首帧绘制完成再开始计时，保证提示确实被看到
      requestAnimationFrame(() => (timer = setTimeout(() => (justDone.value = false), DONE_MS)));
    }
  },
);

const mode = computed(() => (state.running ? 'running' : state.error ? 'error' : justDone.value && state.result ? 'done' : null));
const pct = computed(() => Math.round(state.progress * 100));
const stageName = computed(() => (state.message.startsWith('排队') ? '排队中' : (stages.find((s) => !state.stageDone[s.key]) || stages.at(-1)).name));
const title = computed(() => (state.view === 'main' ? state.message : `${state.message}（点击返回地图查看）`));

function goMain() {
  state.view = 'main';
  if (mode.value !== 'running') justDone.value = false;
}
</script>

<style scoped>
.run-status {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 480px;
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  border: 1px solid var(--border);
  background: var(--surface-2, var(--surface));
  color: var(--text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
}

.run-status.running {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.run-status.done {
  border-color: var(--good);
  background: var(--good-soft);
  color: var(--good-text);
}

.run-status.error {
  border-color: var(--bad-text);
  background: var(--bad-soft);
  color: var(--bad-text);
}

.label {
  font-weight: 600;
}

.target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

.done .target,
.error .target {
  color: inherit;
  opacity: 0.85;
}

.stage {
  flex: none;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--brand-strong);
  font-size: 12px;
}

.pct,
.score {
  flex: none;
  font-weight: 600;
}

.pct {
  width: 34px;
  text-align: right;
  color: var(--brand-strong);
}

.icon {
  font-weight: 700;
}

.bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
}

.fill {
  display: block;
  height: 100%;
  background: var(--brand);
  transition: width 0.3s;
}

.spinner {
  flex: none;
  width: 14px;
  height: 14px;
  border: 2px solid var(--brand-soft);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
