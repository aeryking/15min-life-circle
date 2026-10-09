<template>
  <div class="fac">
    <h4 class="section-title">
      {{ state.result?.params.minutes ?? state.params.minutes }} 分钟圈内设施数量
      <span class="muted">成年人圈</span>
    </h4>
    <EChart :option="countOption" height="250px" />

    <template v-if="v.blind?.coverage">
      <h4 class="section-title">
        目标时间覆盖率
        <span class="muted">圈内点位在该类设施目标步行时间内的比例</span>
      </h4>
      <EChart :option="coverageOption" height="250px" />
    </template>

    <h4 class="section-title">设施清单</h4>
    <div class="cats">
      <details v-for="c in cats" :key="c.key" class="cat card">
        <summary>
          <span>{{ CATEGORY_ICONS[c.key] }} {{ c.name }}</span>
          <span class="muted num">{{ c.list.length }} 处 · 最近 {{ c.list[0] ? meters(c.list[0].walk) : '–' }}</span>
        </summary>
        <ul>
          <li v-for="p in c.list.slice(0, 12)" :key="p.id" @click="focus(p)">
            <span class="pname">{{ p.name }}</span>
            <span class="num muted">
              {{ meters(p.walk) }}
              <span v-if="p.walkMeasured" class="chip good tiny">实测</span>
            </span>
          </li>
          <li v-if="!c.list.length" class="muted">检索范围内未发现</li>
        </ul>
      </details>
    </div>

    <template v-if="cleaning">
      <h4 class="section-title">多源 POI 清洗流水线</h4>
      <div class="pipeline">
        <div v-for="(s, i) in pipeline" :key="s.name" class="pstep">
          <div class="pnum num">{{ s.value }}</div>
          <div class="plabel">{{ s.name }}</div>
          <span v-if="i < pipeline.length - 1" class="arrow">→</span>
        </div>
      </div>
      <div class="sources">
        <span v-for="(n, k) in cleaning.sources" :key="k" class="chip">{{ SOURCE_LABEL[k] || k }} {{ n }} 条</span>
        <span class="chip">多类别复用 {{ cleaning.multiCategory }}</span>
      </div>
      <table class="data">
        <thead>
          <tr>
            <th>剔除原因</th>
            <th class="r">数量</th>
            <th>示例</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in excluded" :key="e.reason">
            <td>{{ e.reason }}</td>
            <td class="r">{{ e.count }}</td>
            <td class="ex muted">{{ e.examples.slice(0, 2).join('、') }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { state, view } from '../../store.js';
import EChart from '../charts/EChart.vue';
import { hbar } from '../charts/options.js';
import { meters, SOURCE_LABEL } from '../../utils/format.js';
import { CATEGORY_ICONS } from '../../utils/theme.js';

const v = view;
const categories = computed(() => state.config?.categories || []);
const cats = computed(() =>
  categories.value.map((c) => ({
    ...c,
    list: (v.value.pois || []).filter((p) => p.category === c.key).sort((a, b) => (a.walk ?? a.distance) - (b.walk ?? b.distance)),
  })),
);
const countOption = computed(() => {
  const access = v.value.access || [];
  return hbar({
    labels: categories.value.map((c) => c.name),
    values: categories.value.map((c) => access.find((a) => a.key === c.key)?.inCircle.adult ?? 0),
    unit: ' 处',
  });
});
const coverageOption = computed(() =>
  hbar({
    labels: v.value.blind.coverage.map((c) => `${c.name}（${c.targetMinutes}′）`),
    values: v.value.blind.coverage.map((c) => Math.round(c.ratio * 100)),
    unit: '%',
    max: 100,
  }),
);
const cleaning = computed(() => state.result?.cleaning || state.partial.pois?.cleaning);
const pipeline = computed(() => {
  const c = cleaning.value;
  const final = Object.entries(c.byCategory).reduce((s, [, n]) => s + n, 0);
  return [
    { name: '原始记录', value: c.rawRecords },
    { name: 'UID 合并后', value: c.uniqueRecords },
    { name: '剔除噪声', value: -c.excludedTotal },
    { name: '近邻/父子去重', value: -(c.nearDuplicates + c.childMerged) },
    { name: '最终设施', value: final },
  ];
});
const excluded = computed(() =>
  Object.entries(cleaning.value.excluded)
    .map(([reason, e]) => ({ reason, ...e }))
    .sort((a, b) => b.count - a.count),
);
function focus(p) {
  state.highlights = [{ lng: p.lng, lat: p.lat, name: `${p.name}（步行 ${Math.round(p.walk)} m）` }];
}
</script>

<style scoped>
.fac {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cat summary {
  display: flex;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
}

.cat ul {
  list-style: none;
  margin: 0;
  padding: 0 10px 8px;
}

.cat li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
  border-top: 1px solid var(--border);
  cursor: pointer;
}

.cat li:hover .pname {
  color: var(--brand);
}

.pname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tiny {
  font-size: 10px;
  padding: 0 4px;
  margin-left: 4px;
}

.pipeline {
  display: flex;
  justify-content: space-between;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 8px;
}

.pstep {
  position: relative;
  text-align: center;
  flex: 1;
}

.pnum {
  font-size: 17px;
  font-weight: 700;
}

.plabel {
  font-size: 11px;
  color: var(--text-secondary);
}

.arrow {
  position: absolute;
  right: -6px;
  top: 4px;
  color: var(--text-muted);
}

.sources {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ex {
  font-size: 12px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
