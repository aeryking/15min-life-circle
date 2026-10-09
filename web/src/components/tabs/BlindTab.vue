<template>
  <div class="blind">
    <p class="lead">
      判定口径：生活圈内每个居住小区（及 {{ b.cellSize }} m 网格点）沿
      <b>真实步行路网 {{ b.threshold }} 米</b>
      内没有
      <b>菜市场/生鲜、药店或小学</b>
      ，即为服务盲区（任一类缺失即计入）。同时对照「直线 1 公里」口径，找出直线看着近、实际要绕路的
      <b>隐性盲区</b>
      。
    </p>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">有盲区的小区</div>
        <div class="value">
          {{ u.residentialBlind }}
          <small>/ {{ resTotal }}</small>
        </div>
        <div class="hint">圈内小区中至少缺一类</div>
      </div>
      <div class="kpi">
        <div class="label">隐性盲区小区</div>
        <div class="value">
          {{ u.residentialHidden ?? '–' }}
          <small>个</small>
        </div>
        <div class="hint">直线 1 km 内有，实际步行 &gt; 1 km</div>
      </div>
      <div class="kpi">
        <div class="label">盲区面积占比</div>
        <div class="value">{{ pct(u.blindRatio) }}</div>
        <div class="hint">{{ u.straightBlindRatio !== undefined ? `直线口径仅 ${pct(u.straightBlindRatio)}` : `约 ${ha(u.blindAreaM2)} 公顷` }}</div>
      </div>
      <div class="kpi">
        <div class="label">严格结论占比</div>
        <div class="value">{{ pct(b.metrics.exactRatio) }}</div>
        <div class="hint">直线已超 1 km 或全部候选实测</div>
      </div>
    </div>

    <h4 class="section-title">
      小区盲区清单
      <span class="muted">步行距离 · 点击定位</span>
    </h4>
    <table v-if="resRows.length" class="data res-table">
      <thead>
        <tr>
          <th>小区</th>
          <th v-for="c in cats" :key="c.key" class="r">{{ CATEGORY_ICONS[c.key] }} {{ short(c) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in shownRows" :key="r.name" class="clickable" @click="focus(r)">
          <td class="rname" :title="r.name">{{ r.name }}</td>
          <td v-for="c in cats" :key="c.key" class="r cell" :class="cellClass(r.cats[c.key])" :title="cellTitle(r.cats[c.key], c)">
            {{ cellText(r.cats[c.key]) }}
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted small">生活圈内未检索到居住小区，以下按网格点统计。</p>
    <button v-if="resRows.length > ROWS" class="btn sm ghost more" @click="allRows = !allRows">
      {{ allRows ? '收起' : `展开全部 ${resRows.length} 个小区` }}
    </button>
    <p v-if="resRows.length" class="muted small legend-line">
      <span class="tag ok">✓ 620</span>
      步行可达（米）
      <span class="tag bad">✗ 1380</span>
      超出 1 km
      <span class="tag bad hidden">✗ 1164</span>
      虚线框 = 隐性盲区（直线 1 km 内有）
      <span class="tag bad">✗ &gt;1.6k</span>
      直线已超 1 km
    </p>

    <h4 class="section-title">分类盲区面积占比</h4>
    <EChart :option="ratioOption" :height="u.straightBlindRatio !== undefined ? '150px' : '130px'" />

    <div v-for="c in cats" :key="c.key" class="catblock">
      <div class="cb-head">
        <b>{{ CATEGORY_ICONS[c.key] }} {{ c.name }}</b>
        <span class="muted">
          供给 {{ c.supply }} 处 · 小区 {{ c.residentialBlind.length }}/{{ c.residentialTotal ?? resTotal }}
          <template v-if="c.residentialHidden">· 隐性 {{ c.residentialHidden }}</template>
        </span>
        <button class="btn sm ghost" @click="show(c.key)">地图查看</button>
      </div>
      <div v-if="c.residentialBlind.length" class="res">
        <span v-for="r in c.residentialBlind" :key="r.name" class="chip bad" :class="{ 'hidden-chip': r.hidden }" :title="cellTitle(r, c)" @click="focus(r)">
          🏠 {{ r.name }}
        </span>
      </div>
      <div v-else class="muted small">圈内小区均在步行 1 公里范围内 ✓</div>
      <div v-if="c.truncated" class="muted small note">该类检索结果较多、中心检索被分页截断，已对盲区片区定点补检索复核。</div>
    </div>

    <h4 class="section-title">
      判定方式构成
      <span class="muted">越多「确定 / 高置信」越省调用</span>
    </h4>
    <EChart :option="methodOption" height="64px" />
    <p class="muted small">
      下界剪枝：该类设施直线距离全部 &gt; 1 km ⇒ 步行必然 &gt; 1 km，严格判为盲区，零调用；上界判定：直线 × λ
      <sub>max</sub>
      （{{ b.metrics.lambdaMaxCenter }}）≤ 1 km ⇒ 最坏绕行也可达；其余按风险排序做
      <b>分支定界实测</b>
      ：直线 1 km 内的候选由近及远分轮批量实测，任一可达即停，全部不可达才判为盲区{{ b.metrics.rounds ? `（共 ${b.metrics.rounds} 轮）` : ''
      }}{{ b.metrics.recheckPairs ? `，并自校准补测 ${b.metrics.recheckPairs} 组` : '' }}。实测标定局部 λ = {{ b.metrics.lambdaLocal }}（中心射线 λ =
      {{ b.metrics.lambdaCenter }}）。
      <template v-if="rs">
        复核检索：对 {{ rs.clusters }} 个盲区片区定点补检索 {{ rs.requests }} 次，补回 {{ rs.added }} 处中心检索遗漏的设施{{
          rs.rescued ? `，${rs.rescued} 个点位据此改判为已覆盖` : ''
        }}。
      </template>
    </p>

    <template v-if="b.patches.length">
      <h4 class="section-title">优先改造片区</h4>
      <table class="data">
        <thead>
          <tr>
            <th>#</th>
            <th>缺失</th>
            <th class="r">面积</th>
            <th>受影响小区</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in b.patches" :key="i" class="clickable" @click="focus({ ...p, name: `盲区片区 ${i + 1}：缺${p.missingNames.join('、')}` })">
            <td>{{ i + 1 }}</td>
            <td>{{ p.missingNames.join('、') }}</td>
            <td class="r">{{ ha(p.areaM2) }} ha</td>
            <td class="muted small">{{ p.affectedResidential.slice(0, 3).join('、') || '–' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { state, view } from '../../store.js';
import EChart from '../charts/EChart.vue';
import { hbar, hbarPair, stack100 } from '../charts/options.js';
import { pct, ha, meters } from '../../utils/format.js';
import { CATEGORY_ICONS } from '../../utils/theme.js';

const ROWS = 8;
const b = computed(() => view.value.blind);
const u = computed(() => b.value.union);
const rs = computed(() => b.value.metrics.recheckSearch || null);
const cats = computed(() => Object.entries(b.value.categories).map(([key, c]) => ({ key, ...c })));
const resTotal = computed(() => u.value.residentialTotal ?? b.value.metrics.residential);
const short = (c) => ({ market: '菜市场', pharmacy: '药店', primary_school: '小学' })[c.key] || c.name;

/** 小区清单：v4 起由服务端给出（缺失多者在前）；旧版结果从点位数据还原 */
const resRows = computed(() => {
  if (b.value.residential) return b.value.residential;
  return b.value.points
    .filter((p) => p.kind === 'residential')
    .map((p) => ({ ...p, cats: Object.fromEntries(Object.entries(p.cats).map(([k, c]) => [k, { ...c, name: p.name }])) }))
    .sort((x, y) => y.missing.length - x.missing.length);
});
const allRows = ref(false);
const shownRows = computed(() => (allRows.value ? resRows.value : resRows.value.slice(0, ROWS)));

const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}k` : `${Math.round(m)}`);
function cellText(d) {
  if (!d) return '–';
  if (d.status !== 'blind') return Number.isFinite(d.net) ? `✓ ${Math.round(d.net)}` : '✓';
  if (Number.isFinite(d.net)) return `✗ ${Math.round(d.net)}`;
  return Number.isFinite(d.straight) ? `✗ >${km(d.straight)}` : '✗ 无';
}
const cellClass = (d) => (d?.status === 'blind' ? (d.hidden ? 'bad hidden' : 'bad') : 'ok');
function cellTitle(d, c) {
  if (!d) return '';
  const near = d.nearest ? `最近「${d.nearest}」` : '附近未检索到';
  const walk = Number.isFinite(d.net) ? `步行 ${meters(d.net)}` : '';
  const line = Number.isFinite(d.straight) ? `直线 ${meters(d.straight)}` : '';
  const verdict = d.status === 'blind' ? (d.hidden ? '隐性盲区：直线 1 km 内有，但实际步行超过 1 km' : '盲区') : '步行 1 km 内可达';
  return [`${c.name}：${verdict}`, [near, walk, line].filter(Boolean).join('，')].join('\n');
}

const ratioOption = computed(() => {
  const labels = cats.value.map((c) => c.name);
  const val = (r) => Math.round(r * 1000) / 10;
  if (u.value.straightBlindRatio === undefined) return hbar({ labels, values: cats.value.map((c) => val(c.blindRatio)), unit: '%', max: 100 });
  return hbarPair({
    labels,
    main: { name: '真实步行 1 km', values: cats.value.map((c) => val(c.blindRatio)) },
    ref: { name: '直线 1 km（对照）', values: cats.value.map((c) => val(c.straightBlindRatio)) },
    unit: '%',
    max: 100,
  });
});
const methodOption = computed(() => {
  const d = b.value.metrics.decisions;
  return stack100({
    parts: [
      { name: '下界剪枝', value: d.certain },
      { name: '上界判定', value: d.safe },
      { name: 'API 实测', value: d.verified },
      { name: '标定估算', value: d.estimated },
    ],
  });
});
function show(key) {
  state.blindCategory = key;
  state.layers.blind = true;
}
function focus(p) {
  state.highlights = [{ lng: p.lng, lat: p.lat, name: p.name }];
}
</script>

<style scoped>
.blind {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lead {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-secondary);
  background: var(--surface-2);
  border-radius: 8px;
  padding: 8px 10px;
}

.catblock {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.cb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.cb-head .muted {
  flex: 1;
  font-size: 12px;
}

.res {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.res .chip {
  cursor: pointer;
}

.small {
  font-size: 12px;
  line-height: 1.6;
}

.clickable {
  cursor: pointer;
}

.res-table {
  table-layout: fixed;
  width: 100%;
}

.res-table th:first-child {
  width: 34%;
}

.rname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  white-space: nowrap;
}

.cell.ok {
  color: var(--good-text);
}

.cell.bad {
  color: var(--bad-text);
  font-weight: 600;
}

.cell.hidden,
.tag.hidden,
.hidden-chip {
  outline: 1.5px dashed var(--bad-text);
  outline-offset: -3px;
  border-radius: 4px;
}

.more {
  align-self: flex-start;
}

.legend-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}

.tag {
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11px;
}

.tag.ok {
  color: var(--good-text);
  background: var(--good-soft);
}

.tag.bad {
  color: var(--bad-text);
  background: var(--bad-soft);
}

.note {
  margin-top: 4px;
}

.clickable:hover td {
  background: var(--surface-2);
}
</style>
