<template>
  <div class="compare">
    <header ref="heroEl" class="hero">
      <div class="hero-left">
        <button class="btn sm" @click="state.view = 'main'">← 返回地图</button>
        <div>
          <h2>多社区生活圈横向对比</h2>
          <p class="muted">统一口径、统一算法 · 最多 {{ max }} 个社区 · {{ metrics.length }} 项指标 · 点击任意图表中的社区可在所有图表中联动高亮</p>
        </div>
      </div>
      <div class="hero-kpis">
        <div class="hk">
          <div class="hk-v num">
            {{ rows.length }}
            <small>/{{ max }}</small>
          </div>
          <div class="hk-l">对比社区</div>
        </div>
        <div class="hk">
          <div class="hk-v num">{{ avgScore }}</div>
          <div class="hk-l">平均综合评分</div>
        </div>
        <div class="hk">
          <div class="hk-v num">{{ totalPois.toLocaleString() }}</div>
          <div class="hk-l">累计分析设施</div>
        </div>
        <div class="hk">
          <div class="hk-v num">{{ totalSaved.toLocaleString() }}</div>
          <div class="hk-l">批量化节省 API 调用</div>
        </div>
      </div>
    </header>

    <div class="layout" :style="{ '--hero-h': `${heroH}px` }">
      <aside class="card pick">
        <div class="pick-head">
          <b>选择社区</b>
          <span class="chip num" :class="selected.length >= max ? 'warn' : 'brand'">{{ selected.length }} / {{ max }}</span>
        </div>
        <div class="caliber">
          <div class="cal-title">
            统计口径
            <span class="muted" title="口径 = 步行时长 + 盲区阈值 + 人群步速；口径不同，面积、圈内设施数、盲区范围的统计范围就不同">ⓘ</span>
          </div>
          <div class="cal-opts">
            <button v-for="c in calibers" :key="c.key" class="chip toggle" :class="{ on: caliber === c.key }" @click="setCaliber(c.key)">
              {{ c.label }} · {{ c.count }}
            </button>
            <button v-if="calibers.length > 1" class="chip toggle" :class="{ on: caliber === 'all' }" @click="setCaliber('all')">
              全部 · {{ candidatesAll.length }}
            </button>
          </div>
        </div>
        <div class="pick-actions">
          <button class="btn sm" @click="selected = defaultSelection()">智能选 {{ max }} 个</button>
          <button class="btn sm ghost" @click="selected = []">清空</button>
        </div>
        <div class="pick-list scroll">
          <label v-for="h in candidates" :key="h.id" class="item" :class="{ focus: focusId === h.id }">
            <input v-model="selected" type="checkbox" :value="h.id" :disabled="!selected.includes(h.id) && selected.length >= max" />
            <span class="name" :title="`${h.name}\n${caliberLabel(h)} · 采样${TIER_NAME[h.tier] || ''}\n${dateTime(h.createdAt)}`">{{ h.name }}</span>
            <span class="tag" :title="`步行时长 ${h.minutes} 分钟`">{{ h.minutes }}′</span>
            <span class="tag" :class="`tier-${h.tier}`" :title="`采样档位：${TIER_NAME[h.tier] || '未知'}`">{{ TIER_LEVEL[h.tier] || '?' }}</span>
            <span class="chip num" :class="h.score >= 70 ? 'good' : h.score >= 60 ? 'warn' : 'bad'">{{ h.score }}</span>
          </label>
          <p v-if="!candidates.length" class="muted">暂无历史体检，请先完成至少两次体检。</p>
        </div>
        <p class="muted small">参数完全相同的重复体检只保留最近一次。「′」为步行分钟，「低 / 中 / 高」为采样精度档位。</p>
      </aside>

      <main v-if="rows.length >= 2" class="board">
        <div v-if="mixedCaliber" class="notice warn wide">
          <b>⚠️ 口径不一致，不宜直接比较：</b>
          所选社区包含
          {{
            caliberSummary
          }}。步行时长或阈值不同，可达面积、圈内设施数量、盲区范围的统计范围也不同，排名和热力颜色会偏向时长更长的社区。建议在左侧「统计口径」中选择统一口径。
        </div>
        <div v-if="mixedTier" class="notice info wide">
          <b>ℹ️ 采样档位不同（{{ tierSummary }}），可以比较：</b>
          档位只改变采样密度与精度，不改变指标定义。同一社区三档实测：上地东里 低 83 / 中 82 / 高 81 分，差异在 ±2
          分以内；需要精细排名时建议统一使用「中」或「高」档。
        </div>
        <!-- 冠军 / 关注卡片 -->
        <section class="podium">
          <div class="pod card best" @click="focusId = best.id">
            <div class="pod-tag">🏆 综合最优</div>
            <div class="pod-name" :title="best.fullLabel">{{ best.fullLabel }}</div>
            <div class="pod-score num">
              {{ best.score }}
              <small>分</small>
            </div>
            <div class="pod-sub muted">盲区 {{ best.values.blindUnion }}% · 可达 {{ best.values.areaAdult }} km²</div>
          </div>
          <div class="pod card worst" @click="focusId = worst.id">
            <div class="pod-tag">⚠️ 最需关注</div>
            <div class="pod-name" :title="worst.fullLabel">{{ worst.fullLabel }}</div>
            <div class="pod-score num">
              {{ worst.score }}
              <small>分</small>
            </div>
            <div class="pod-sub muted">短板：{{ weakest(worst) }}</div>
          </div>
          <div class="pod card insight">
            <div class="pod-tag">📌 自动洞察</div>
            <ul>
              <li v-for="(t, i) in insights" :key="i">{{ t }}</li>
            </ul>
          </div>
        </section>

        <section class="card panel">
          <div class="panel-head">
            <h4>① 排名赛道</h4>
            <select v-model="rankKey" class="input sm">
              <optgroup v-for="g in groups" :key="g" :label="g">
                <option v-for="m in metrics.filter((x) => x.group === g)" :key="m.key" :value="m.key">
                  {{ m.name }}（{{ m.better === 'low' ? '越小越好' : '越大越好' }}）
                </option>
              </optgroup>
            </select>
          </div>
          <EChart :option="rankOpt" :height="`${Math.max(220, rows.length * 34 + 24)}px`" @pick="onPick" />
        </section>

        <section class="card panel">
          <div class="panel-head">
            <h4>② 象限气泡图</h4>
            <div class="axis-pick">
              <label>
                X
                <select v-model="qx" class="input sm">
                  <option v-for="m in metrics" :key="m.key" :value="m.key">{{ m.name }}</option>
                </select>
              </label>
              <label>
                Y
                <select v-model="qy" class="input sm">
                  <option v-for="m in metrics" :key="m.key" :value="m.key">{{ m.name }}</option>
                </select>
              </label>
            </div>
          </div>
          <EChart :option="quadOpt" height="360px" @pick="onPick" />
          <p class="muted small">气泡大小 = 民生设施总数；十字线为所选社区均值，把社区分入四个象限。</p>
        </section>

        <section class="card panel wide">
          <div class="panel-head">
            <h4>③ 体检热力矩阵</h4>
            <div class="chips">
              <button v-for="g in ['全部', ...groups]" :key="g" class="chip toggle" :class="{ on: heatGroup === g }" @click="heatGroup = g">{{ g }}</button>
            </div>
          </div>
          <div class="heat-scroll scroll">
            <div :style="{ minWidth: `${heatMetrics.length * 54 + 130}px` }">
              <EChart :option="heatOpt" :height="`${rows.length * 34 + 70}px`" @pick="onPick" />
            </div>
          </div>
          <div class="ramp-legend">
            <span class="muted small">较差</span>
            <span class="ramp"><i v-for="c in SEQUENTIAL" :key="c" :style="{ background: c }"></i></span>
            <span class="muted small">较优</span>
            <span class="muted small">· 颜色为列内优劣度（评分类为 0–100 绝对刻度），格内为原始值</span>
          </div>
        </section>

        <section class="card panel wide">
          <div class="panel-head">
            <h4>④ 最近设施步行时间分布</h4>
            <span class="muted small">每个点是一个社区到该类最近设施的实测步行时间</span>
          </div>
          <EChart :option="dotOpt" height="380px" @pick="onPick" />
        </section>

        <section class="card panel wide">
          <div class="panel-head">
            <h4>⑤ 六维画像墙</h4>
            <span class="muted small">比较每个社区的「形状」：蓝色为成年人视角，橙色为老年人视角，绿色为亲子视角</span>
          </div>
          <EChart :option="radarOpt" :height="`${Math.ceil(rows.length / 5) * 300 + 30}px`" @pick="onPick" />
        </section>

        <section class="card panel wide">
          <div class="panel-head">
            <h4>⑥ 全部指标明细</h4>
            <span class="muted small">点击表头排序 · 每列最优值加粗标绿</span>
          </div>
          <div class="table-wrap scroll">
            <table class="data detail">
              <thead>
                <tr>
                  <th class="sticky">社区</th>
                  <th v-for="m in metrics" :key="m.key" class="r sortable" :class="{ on: sortKey === m.key }" @click="sortBy(m.key)">
                    {{ m.name }}
                    <small>{{ m.unit }}</small>
                    <span v-if="sortKey === m.key">{{ sortDir > 0 ? '▲' : '▼' }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in sortedRows" :key="r.id" :class="{ focus: r.id === focusId }" @click="focusId = r.id">
                  <td class="sticky" :title="r.name">
                    {{ r.fullLabel }}
                    <small class="muted">{{ r.minutes }}′ · {{ TIER_LEVEL[r.tier] }}</small>
                  </td>
                  <td v-for="m in metrics" :key="m.key" class="r" :class="{ best: bestOf[m.key] === r.values[m.key] && r.values[m.key] !== null }">
                    {{ r.values[m.key] ?? '–' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <main v-else class="board empty muted">请在左侧至少勾选 2 个社区进行对比</main>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import { state, refreshHistory } from '../store.js';
import { api } from '../api.js';
import EChart from './charts/EChart.vue';
import { rankingOption, heatmapOption, quadrantOption, dotStripOption, radarWallOption } from './charts/compareCharts.js';
import { SEQUENTIAL } from '../utils/theme.js';
import { TIER_LEVEL, TIER_NAME, caliberKey, caliberLabel, dedupeKey, withLabels } from '../utils/caliber.js';
import { shortName } from './charts/compareCharts.js';
import { dateTime } from '../utils/format.js';

const max = 10;
/** 参数完全相同的重复体检只保留最近一次（历史按时间倒序） */
const candidatesAll = computed(() => {
  const seen = new Set();
  return state.history.filter((h) => {
    const k = dedupeKey(h);
    return seen.has(k) ? false : seen.add(k);
  });
});
/** 可选口径（按社区数量降序），默认选最多的口径 */
const calibers = computed(() => {
  const m = new Map();
  for (const h of candidatesAll.value) {
    const k = caliberKey(h);
    if (!m.has(k)) m.set(k, { key: k, label: caliberLabel(h), count: 0 });
    m.get(k).count += 1;
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
});
// 通过对比链接进入时按链接中的社区显示（不限口径），否则默认选社区最多的口径
const fromLink = state.compareIds.length > 0;
const caliber = ref(fromLink ? 'all' : calibers.value[0]?.key || 'all');
const candidates = computed(() => (caliber.value === 'all' ? candidatesAll.value : candidatesAll.value.filter((h) => caliberKey(h) === caliber.value)));
function defaultSelection() {
  return candidates.value.slice(0, max).map((h) => h.id);
}
function setCaliber(k) {
  caliber.value = k;
  selected.value = defaultSelection();
}
const selected = ref(fromLink ? state.compareIds.slice(0, max) : defaultSelection());
const rows = ref([]);
const metrics = ref([]);
const focusId = ref(null);
const rankKey = ref('score');
const qx = ref('areaAdult');
const qy = ref('blindUnion');
const heatGroup = ref('全部');
const sortKey = ref('score');
const sortDir = ref(-1);

watch(
  selected,
  async (ids) => {
    state.compareIds = ids;
    if (!ids.length) return (rows.value = []);
    const res = await api.compare(ids);
    // 链接中的社区会被服务端加入当前访客的历史，刷新列表以便勾选调整
    if (ids.some((id) => !state.history.some((h) => h.id === id))) refreshHistory();
    metrics.value = res.metrics;
    rows.value = withLabels(res.rows, shortName);
    if (!rows.value.some((r) => r.id === focusId.value)) focusId.value = null;
  },
  { immediate: true },
);

const groups = computed(() => [...new Set(metrics.value.map((m) => m.group))]);
const metricOf = (k) => metrics.value.find((m) => m.key === k);
const mixedCaliber = computed(() => new Set(rows.value.map(caliberKey)).size > 1);
const mixedTier = computed(() => new Set(rows.value.map((r) => r.tier)).size > 1);
const countBy = (fn) => {
  const m = {};
  for (const r of rows.value) m[fn(r)] = (m[fn(r)] || 0) + 1;
  return Object.entries(m)
    .map(([k, n]) => `${k} × ${n}`)
    .join('、');
};
const caliberSummary = computed(() => countBy(caliberLabel));
const tierSummary = computed(() => countBy((r) => TIER_LEVEL[r.tier] || '?'));

// 顶部标题栏固定显示：测量其高度，左侧选择面板吸顶时让出位置
const heroEl = ref(null);
const heroH = ref(120);
let heroRo = null;
onMounted(() => {
  heroRo = new ResizeObserver(([e]) => (heroH.value = Math.ceil(e.target.getBoundingClientRect().height)));
  heroRo.observe(heroEl.value);
});
onBeforeUnmount(() => heroRo?.disconnect());

const avgScore = computed(() => (rows.value.length ? Math.round(rows.value.reduce((s, r) => s + r.score, 0) / rows.value.length) : 0));
const totalPois = computed(() => rows.value.reduce((s, r) => s + (r.values.poiTotal || 0), 0));
const totalSaved = computed(() =>
  rows.value.reduce((s, r) => {
    const req = r.values.requests || 0;
    const saved = (r.values.saved || 0) / 100;
    return s + (saved < 1 ? Math.round(req / (1 - saved) - req) : 0);
  }, 0),
);
const best = computed(() => [...rows.value].sort((a, b) => b.score - a.score)[0]);
const worst = computed(() => [...rows.value].sort((a, b) => a.score - b.score)[0]);

function weakest(r) {
  const d = [...r.dimensions].sort((a, b) => a.score - b.score)[0];
  return d ? `${d.name} ${d.score} 分` : '–';
}

/** 自动洞察：从矩阵中挑出最显著的差异，生成可读结论 */
const insights = computed(() => {
  const out = [];
  const rs = rows.value;
  const byMax = (k, better) =>
    [...rs].filter((r) => r.values[k] !== null).sort((a, b) => (better === 'low' ? a.values[k] - b.values[k] : b.values[k] - a.values[k]));
  const blind = byMax('blindUnion', 'high');
  if (blind[0])
    out.push(`${blind[0].fullLabel} 盲区占比最高（${blind[0].values.blindUnion}%），${blind.at(-1).fullLabel} 最低（${blind.at(-1).values.blindUnion}%）。`);
  const shrink = byMax('elderlyShrink', 'high');
  if (shrink[0]) out.push(`老年人可达范围收缩最明显的是 ${shrink[0].fullLabel}（缩小 ${shrink[0].values.elderlyShrink}%）。`);
  const cats = metrics.value.filter((m) => m.group === '最近设施步行');
  let worstCat = null;
  for (const m of cats) {
    const over = rs.filter((r) => r.values[m.key] !== null && r.values[m.key] > 15).length;
    if (!worstCat || over > worstCat.over) worstCat = { m, over };
  }
  if (worstCat?.over) out.push(`${worstCat.over} 个社区的最近${worstCat.m.name}超过 15 分钟步行，是共性短板。`);
  const lam = byMax('lambda', 'high');
  if (lam[0]) out.push(`${lam[0].fullLabel} 路网绕行最严重（λ = ${lam[0].values.lambda}），直线画圆高估 ${lam[0].values.circleOver}%。`);
  return out.slice(0, 4);
});

const rankOpt = computed(() => rankingOption(rows.value, metricOf(rankKey.value) || metrics.value[0], focusId.value));
const quadOpt = computed(() => quadrantOption(rows.value, metricOf(qx.value), metricOf(qy.value), focusId.value));
const heatMetrics = computed(() => (heatGroup.value === '全部' ? metrics.value : metrics.value.filter((m) => m.group === heatGroup.value)));
const heatOpt = computed(() => heatmapOption(rows.value, heatMetrics.value, focusId.value));
const dotOpt = computed(() => dotStripOption(rows.value, metrics.value, focusId.value));
const radarOpt = computed(() => radarWallOption(rows.value, focusId.value));

function onPick(id) {
  if (id) focusId.value = focusId.value === id ? null : id;
}

function sortBy(k) {
  if (sortKey.value === k) sortDir.value = -sortDir.value;
  else {
    sortKey.value = k;
    sortDir.value = metricOf(k)?.better === 'low' ? 1 : -1;
  }
}
const sortedRows = computed(() =>
  [...rows.value].sort((a, b) => {
    const va = a.values[sortKey.value];
    const vb = b.values[sortKey.value];
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * sortDir.value;
  }),
);
const bestOf = computed(() => {
  const o = {};
  for (const m of metrics.value) {
    const vals = rows.value.map((r) => r.values[m.key]).filter((v) => v !== null);
    o[m.key] = vals.length ? (m.better === 'low' ? Math.min(...vals) : Math.max(...vals)) : null;
  }
  return o;
});
</script>

<style scoped>
.compare {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.hero {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  background:
    radial-gradient(1200px 200px at 10% -40%, color-mix(in srgb, var(--brand) 22%, transparent), transparent),
    linear-gradient(180deg, var(--surface), var(--bg));
  background-color: var(--bg);
  box-shadow: 0 6px 16px rgb(0 0 0 / 8%);
  border-bottom: 1px solid var(--border);
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hero h2 {
  margin: 0;
  font-size: 20px;
}

.hero p {
  margin: 4px 0 0;
  font-size: 12.5px;
}

.hero-kpis {
  display: flex;
  gap: 10px;
}

.hk {
  min-width: 118px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.hk-v {
  font-size: 24px;
  font-weight: 750;
  color: var(--brand);
  line-height: 1.1;
}

.hk-v small {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
}

.hk-l {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.layout {
  display: flex;
  gap: 14px;
  padding: 14px 20px 24px;
  align-items: flex-start;
}

.pick {
  width: 310px;
  flex: none;
  padding: 12px;
  position: sticky;
  top: calc(var(--hero-h) + 14px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pick-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pick-actions {
  display: flex;
  gap: 6px;
}

.pick-list {
  max-height: calc(100vh - var(--hero-h) - 330px);
  min-height: 160px;
}

.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.item.focus {
  background: var(--brand-soft);
}

.item .name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  font-size: 11px;
  line-height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  flex: none;
}

.tag.tier-lite {
  color: var(--warn-text);
  background: var(--warn-soft);
}

.tag.tier-precise {
  color: var(--good-text);
  background: var(--good-soft);
}

.caliber {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.cal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.cal-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.notice {
  grid-column: 1 / -1;
  font-size: 12.5px;
  line-height: 1.7;
  padding: 10px 14px;
  border-radius: 10px;
}

.notice.warn {
  background: var(--warn-soft);
  border: 1px solid var(--warn-border);
  color: var(--warn-text);
}

.notice.info {
  background: var(--brand-soft);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.detail .sticky small {
  display: block;
  font-size: 11px;
}

.small {
  font-size: 12px;
  line-height: 1.6;
  margin: 0;
}

.board {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.board.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.podium {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr 1.6fr;
  gap: 14px;
}

.pod {
  padding: 14px 16px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.pod::after {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
}

.pod.best::after {
  background: var(--good);
}

.pod.worst::after {
  background: var(--critical);
}

.pod.insight {
  cursor: default;
}

.pod.insight::after {
  background: var(--brand);
}

.pod-tag {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.pod-name {
  font-size: 15px;
  font-weight: 650;
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pod-score {
  font-size: 34px;
  font-weight: 800;
  line-height: 1.1;
  margin-top: 4px;
}

.best .pod-score {
  color: var(--good-text);
}

.worst .pod-score {
  color: var(--bad-text);
}

.pod-score small {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.pod-sub {
  font-size: 12px;
  margin-top: 2px;
}

.pod ul {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--text-secondary);
}

.panel {
  padding: 12px 14px;
  min-width: 0;
}

.panel.wide {
  grid-column: 1 / -1;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.panel-head h4 {
  margin: 0;
  font-size: 14px;
}

.input.sm {
  height: 30px;
  font-size: 12px;
  width: auto;
  max-width: 260px;
  padding: 0 8px;
}

.axis-pick {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.axis-pick label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip.toggle {
  border: 0;
  cursor: pointer;
  padding: 3px 10px;
}

.chip.toggle.on {
  background: var(--brand);
  color: var(--on-brand);
}

.ramp-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.ramp {
  display: flex;
  width: 140px;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.ramp i {
  flex: 1;
}

.heat-scroll {
  overflow-x: auto;
}

.table-wrap {
  max-height: 460px;
}

.detail {
  font-size: 12px;
  white-space: nowrap;
}

.detail th small {
  display: block;
  font-weight: 400;
  color: var(--text-muted);
}

.detail th.sortable {
  cursor: pointer;
  user-select: none;
}

.detail th.on {
  color: var(--brand);
}

.detail .sticky {
  position: sticky;
  left: 0;
  background: var(--surface);
  z-index: 1;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail thead .sticky {
  background: var(--surface-2);
  z-index: 2;
}

.detail tbody tr {
  cursor: pointer;
}

.detail tbody tr:hover td,
.detail tbody tr.focus td {
  background: var(--brand-soft);
}

.detail td.best {
  color: var(--good-text);
  font-weight: 700;
}

@media (max-width: 1280px) {
  .board {
    grid-template-columns: 1fr;
  }

  .podium {
    grid-template-columns: 1fr 1fr;
  }

  .pod.insight {
    grid-column: 1 / -1;
  }

  .hero {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
