<template>
  <div class="ov">
    <div v-if="r" class="hero card">
      <div class="score-ring">
        <svg viewBox="0 0 120 120" width="112" height="112">
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface-3)" stroke-width="10" />
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            :stroke="ringColor"
            stroke-width="10"
            stroke-linecap="round"
            :stroke-dasharray="`${(r.score.total / 100) * 314} 314`"
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div class="score-num num">{{ r.score.total }}</div>
        <div class="score-of">/ 100</div>
      </div>
      <div class="hero-text">
        <div class="grade">
          <span class="chip" :class="status.key === 'good' ? 'good' : status.key === 'warning' ? 'warn' : 'bad'">{{ status.icon }} {{ r.score.grade }}</span>
          <span v-if="r.elderlyScore" class="muted small">老年人视角 {{ r.elderlyScore.total }} 分</span>
          <span v-if="r.childScore" class="muted small">亲子视角 {{ r.childScore.total }} 分</span>
        </div>
        <div class="comp">
          <div v-for="c in components" :key="c.name" class="comp-row">
            <span class="comp-name">{{ c.name }}</span>
            <span class="comp-bar"><i :style="{ width: `${c.value}%` }"></i></span>
            <span class="num">{{ c.value }}</span>
          </div>
        </div>
      </div>
    </div>
    <p v-if="r" class="summary">{{ r.diagnosis.summary }}</p>
    <p v-else class="muted">体检进行中，等时圈与设施数据将陆续呈现…</p>

    <div v-if="iso" class="kpi-grid">
      <div class="kpi">
        <div class="label">成年人 {{ iso.metrics.minutes }} 分钟可达</div>
        <div class="value">
          {{ km2(iso.metrics.areas.adult) }}
          <small>km²</small>
        </div>
        <div class="hint">等效半径 {{ iso.metrics.equivalentRadius }} m</div>
      </div>
      <div class="kpi">
        <div class="label">「直线画圆」高估</div>
        <div class="value">
          {{ iso.metrics.circleOverestimate }}
          <small>%</small>
        </div>
        <div class="hint">圆面积 {{ km2(iso.metrics.circleArea) }} km²</div>
      </div>
      <div class="kpi">
        <div class="label">路网绕行系数 λ（中位）</div>
        <div class="value">{{ iso.metrics.lambda.median }}</div>
        <div class="hint">P90 = {{ iso.metrics.lambda.p90 }} · {{ iso.metrics.validSamples }} 个实测点</div>
      </div>
      <div class="kpi">
        <div class="label">老年人 {{ iso.metrics.minutes }} 分钟可达</div>
        <div class="value">
          {{ km2(iso.metrics.areas.elderly) }}
          <small>km²</small>
        </div>
        <div class="hint">较成年人缩小 {{ shrink }}%</div>
      </div>
      <div v-if="v.blind" class="kpi">
        <div class="label">有 1 公里服务盲区的小区</div>
        <div class="value">
          {{ v.blind.union.residentialBlind }}
          <small>/ {{ v.blind.union.residentialTotal ?? v.blind.metrics.residential }}</small>
        </div>
        <div class="hint">
          按面积 {{ pct(v.blind.union.blindRatio) }}
          <template v-if="v.blind.union.residentialHidden">· 隐性 {{ v.blind.union.residentialHidden }} 个</template>
        </div>
      </div>
      <div v-if="r" class="kpi">
        <div class="label">体检耗时 · API 请求</div>
        <div class="value">{{ ms(r.engineering.totalMs) }}</div>
        <div class="hint">{{ r.engineering.requests }} 次（逐点调用需 {{ r.engineering.naiveRequests }} 次）</div>
      </div>
    </div>

    <template v-if="r">
      <h4 class="section-title">六维生活圈画像</h4>
      <EChart :option="radarOption" height="250px" />

      <h4 class="section-title">
        分类评分
        <span class="muted">最近一处步行时间 · 圈内数量</span>
      </h4>
      <table class="data">
        <thead>
          <tr>
            <th>设施</th>
            <th class="r">成人</th>
            <th class="r">老人</th>
            <th class="r">圈内</th>
            <th class="r">得分</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in rows" :key="c.key" class="clickable" @click="focusNearest(c)">
            <td>
              {{ CATEGORY_ICONS[c.key] }} {{ c.name }}
              <span v-if="c.critical" class="chip crit">关键</span>
            </td>
            <td class="r">
              {{ c.adult ?? '–' }}
              <span class="muted">分</span>
            </td>
            <td class="r" :class="{ over: c.elderly > r.params.minutes }">
              {{ c.elderly ?? '–' }}
              <span class="muted">分</span>
            </td>
            <td class="r">{{ c.count }}</td>
            <td class="r">
              <span class="status-icon" :style="{ color: c.score >= 85 ? STATUS.good : c.score >= 60 ? 'var(--warn-text)' : STATUS.critical }">
                {{ c.score >= 85 ? '●' : c.score >= 60 ? '▲' : '■' }}
              </span>
              {{ c.score }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">点击行可在地图上定位最近设施。时间 = 实测步行距离 ÷ 人群步速；目标时间参考 GB 50180-2018。</p>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { state, view } from '../../store.js';
import EChart from '../charts/EChart.vue';
import { radar } from '../charts/options.js';
import { km2, pct, ms } from '../../utils/format.js';
import { CATEGORY_ICONS, STATUS, SERIES, gradeStatus } from '../../utils/theme.js';

const v = view;
const r = computed(() => state.result);
const iso = computed(() => v.value?.isochrone);
const status = computed(() => gradeStatus(r.value?.score.total || 0));
const ringColor = computed(() => (r.value?.score.total >= 70 ? SERIES[0] : r.value?.score.total >= 60 ? SERIES[3] : STATUS.critical));
const shrink = computed(() => {
  const a = iso.value?.metrics.areas;
  return a ? Math.round((1 - a.elderly / a.adult) * 100) : 0;
});
const components = computed(() => [
  { name: '设施可达（55%）', value: r.value.score.components.dimensions },
  { name: '盲区覆盖（30%）', value: r.value.score.components.coverage },
  { name: '类别完整（15%）', value: r.value.score.components.completeness },
]);
const radarOption = computed(() =>
  radar({
    indicators: r.value.score.dimensions.map((d) => d.name),
    series: [
      { name: '成年人视角', values: r.value.score.dimensions.map((d) => d.score) },
      { name: '老年人视角', values: r.value.elderlyScore.dimensions.map((d) => d.score) },
      // 旧版报告没有亲子评分，此时只画两条线
      ...(r.value.childScore ? [{ name: '亲子视角', values: r.value.childScore.dimensions.map((d) => d.score) }] : []),
    ],
  }),
);
const rows = computed(() =>
  r.value.access.map((a) => {
    const s = r.value.score.categories.find((c) => c.key === a.key);
    return {
      key: a.key,
      name: a.name,
      critical: a.critical,
      adult: a.nearest?.minutes.adult,
      elderly: a.nearest?.minutes.elderly,
      count: a.inCircle.adult,
      score: s.score,
      nearest: a.nearest,
    };
  }),
);
function focusNearest(c) {
  if (!c.nearest) return;
  state.highlights = [{ lng: c.nearest.lng, lat: c.nearest.lat, name: `${c.name}：${c.nearest.name}（步行 ${c.nearest.walk} m）` }];
}
</script>

<style scoped>
.ov {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 12px;
}

.score-ring {
  position: relative;
  width: 112px;
  height: 112px;
  flex: none;
}

.score-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
  font-weight: 750;
  margin-top: -8px;
}

.score-of {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 30px;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
}

.hero-text {
  flex: 1;
  min-width: 0;
}

.grade {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.comp-row {
  display: grid;
  grid-template-columns: 96px 1fr 26px;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 22px;
}

.comp-bar {
  height: 6px;
  background: var(--surface-3);
  border-radius: 3px;
  overflow: hidden;
}

.comp-bar i {
  display: block;
  height: 100%;
  background: var(--series-1);
  border-radius: 3px;
}

.summary {
  margin: 0;
  line-height: 1.7;
  color: var(--text-secondary);
  font-size: 13px;
}

.small {
  font-size: 12px;
}

.clickable {
  cursor: pointer;
}

.clickable:hover td {
  background: var(--surface-2);
}

.over {
  color: var(--bad-text);
  font-weight: 600;
}

.crit {
  margin-left: 4px;
  font-size: 10px;
  padding: 0 5px;
}
</style>
