<template>
  <div class="layers card" :class="{ open }">
    <button class="head" @click="open = !open">
      <span>🗂 图层</span>
      <span class="muted">{{ open ? '收起' : '展开' }}</span>
    </button>
    <div v-if="open" class="body scroll">
      <div class="group">
        <div class="gtitle">等时圈</div>
        <label v-for="l in isoLayers" :key="l.key">
          <input v-model="state.layers[l.key]" type="checkbox" />
          <i class="sw" :style="l.style"></i>
          {{ l.name }}
        </label>
      </div>
      <div class="group">
        <div class="gtitle">服务盲区</div>
        <label>
          <input v-model="state.layers.blind" type="checkbox" />
          <i class="sw" :style="{ background: MAP_COLORS.blind, opacity: 0.6 }"></i>
          灰色盲区
        </label>
        <label title="直线 1 公里内有设施、但真实步行超过 1 公里的区域">
          <input v-model="state.layers.blindHidden" type="checkbox" />
          <i class="sw dash" :style="{ borderColor: MAP_COLORS.hidden }"></i>
          隐性盲区
        </label>
        <label>
          <input v-model="state.layers.blindCells" type="checkbox" />
          <i class="sw round" :style="{ background: MAP_COLORS.blind }"></i>
          分析网格点
        </label>
        <label>
          <input v-model="state.layers.residential" type="checkbox" />
          <i class="sw round" :style="{ background: MAP_COLORS.residential }"></i>
          居住小区
        </label>
        <label>
          <input v-model="state.layers.siting" type="checkbox" />
          <i class="sw star">★</i>
          推荐选址
        </label>
        <select v-model="state.blindCategory" class="input sm">
          <option value="all">任一关键设施缺失</option>
          <option value="market">菜市场/生鲜盲区</option>
          <option value="pharmacy">药店盲区</option>
          <option value="primary_school">小学盲区</option>
        </select>
      </div>
      <div class="group">
        <div class="gtitle">
          <label class="inline">
            <input v-model="state.layers.pois" type="checkbox" />
            民生设施
          </label>
          <span class="links">
            <a @click="setAll(true)">全选</a>
            ·
            <a @click="setAll(false)">清空</a>
          </span>
        </div>
        <label v-for="c in state.config?.categories || []" :key="c.key" class="cat">
          <input v-model="state.poiFilter[c.key]" type="checkbox" />
          <i class="sw round" :style="{ background: DIMENSION_COLORS[c.dimension] }"></i>
          {{ CATEGORY_ICONS[c.key] }} {{ c.name }}
          <span class="muted num">{{ counts[c.key] || 0 }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { state, view } from '../store.js';
import { DIMENSION_COLORS, CATEGORY_ICONS, PROFILE_COLORS, MAP_COLORS } from '../utils/theme.js';

const open = ref(true);
// 等时圈名称跟随本次体检的步行时长（体检前按参数面板的设置）
const mins = computed(() => view.value?.isochrone?.metrics.minutes ?? state.params.minutes);
const isoLayers = computed(() => [
  { key: 'bands', name: '步行时间热力', style: { background: `linear-gradient(90deg, ${MAP_COLORS.band}, transparent)` } },
  { key: 'adult', name: `成年人 ${mins.value} 分钟圈`, style: { background: PROFILE_COLORS.adult, height: '3px' } },
  { key: 'elderly', name: `老年人 ${mins.value} 分钟圈`, style: { background: PROFILE_COLORS.elderly, height: '3px' } },
  { key: 'child', name: `亲子 ${mins.value} 分钟圈`, style: { background: PROFILE_COLORS.child, height: '3px' } },
  {
    key: 'circle',
    name: '直线画圆（对照）',
    style: { background: `repeating-linear-gradient(90deg, ${MAP_COLORS.circle} 0 4px, transparent 4px 7px)`, height: '3px' },
  },
  { key: 'samples', name: 'API 采样点（λ 着色）', style: { background: MAP_COLORS.band, borderRadius: '50%' } },
]);
const counts = computed(() => {
  const m = {};
  for (const p of view.value?.pois || []) m[p.category] = (m[p.category] || 0) + 1;
  return m;
});
function setAll(v) {
  for (const k of Object.keys(state.poiFilter)) state.poiFilter[k] = v;
}
</script>

<style scoped>
.layers {
  width: 236px;
  box-shadow: var(--shadow);
  font-size: 13px;
  overflow: hidden;
}

.head {
  display: flex;
  justify-content: space-between;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 9px 12px;
  font-weight: 600;
  cursor: pointer;
}

.body {
  max-height: calc(100vh - 260px);
  padding: 0 12px 10px;
}

.group {
  padding: 6px 0;
  border-top: 1px solid var(--border);
}

.gtitle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.links a {
  cursor: pointer;
  font-weight: 400;
}

label {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 24px;
  cursor: pointer;
  color: var(--text-primary);
}

label.inline {
  line-height: 20px;
  font-weight: 600;
  color: var(--text-secondary);
}

label.cat .muted {
  margin-left: auto;
}

.sw {
  width: 14px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
  flex: none;
}

.sw.dash {
  box-sizing: border-box;
  border: 2px dashed;
  background: transparent;
}

.sw.round {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.sw.star {
  color: var(--series-2);
  font-style: normal;
  width: 14px;
  height: auto;
  text-align: center;
}

.input.sm {
  height: 30px;
  margin-top: 4px;
  font-size: 12px;
}
</style>
