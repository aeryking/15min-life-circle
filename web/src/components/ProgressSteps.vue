<template>
  <div class="steps">
    <div class="bar"><div class="fill" :style="{ width: `${Math.round(state.progress * 100)}%` }"></div></div>
    <div class="msg">
      <span>{{ state.message }}</span>
      <span class="num muted">{{ Math.round(state.progress * 100) }}%</span>
    </div>
    <ol>
      <li v-for="s in stages" :key="s.key" :class="{ done: state.stageDone[s.key] }">
        <span class="mark">{{ state.stageDone[s.key] ? '✓' : '·' }}</span>
        {{ s.name }}
      </li>
    </ol>
  </div>
</template>

<script setup>
import { state, stages } from '../store.js';
</script>

<style scoped>
.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar {
  height: 6px;
  background: var(--surface-3);
  border-radius: 3px;
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--series-1);
  border-radius: 3px;
  transition: width 0.3s;
}

.msg {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  gap: 8px;
}

ol {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
  color: var(--text-muted);
}

li.done {
  color: var(--good-text);
}

.mark {
  display: inline-block;
  width: 12px;
  font-weight: 700;
}
</style>
