<template>
  <div class="hist">
    <header class="hero">
      <div class="hero-left">
        <button class="btn sm" @click="state.view = 'main'">← 返回地图</button>
        <div>
          <h2>体检历史</h2>
          <p class="muted">仅你本人可见 · 最多保留 100 条 · 点击社区名打开报告，勾选多个可直接对比</p>
        </div>
      </div>
      <div class="hero-kpis">
        <div class="hk">
          <div class="hk-v num">{{ state.history.length }}</div>
          <div class="hk-l">体检记录</div>
        </div>
        <div class="hk">
          <div class="hk-v num">{{ cities }}</div>
          <div class="hk-l">覆盖城市</div>
        </div>
        <div class="hk">
          <div class="hk-v num">{{ avgScore }}</div>
          <div class="hk-l">平均综合评分</div>
        </div>
        <div class="hk">
          <div class="hk-v num sm">{{ latest }}</div>
          <div class="hk-l">最近一次体检</div>
        </div>
      </div>
    </header>

    <div class="body">
      <div v-if="!loaded" class="card empty muted">加载中…</div>
      <div v-else-if="!state.history.length" class="card empty">
        <div class="empty-icon">🗂</div>
        <b>还没有体检记录</b>
        <p class="muted">在地图上选一个社区，点击「开始体检」，结果会自动保存在这里。</p>
        <button class="btn primary" @click="state.view = 'main'">去体检</button>
      </div>

      <template v-else>
        <div class="card toolbar">
          <input v-model="state.historyQuery" class="input search" type="search" placeholder="搜索社区名称、地址或城市" aria-label="搜索体检历史" />
          <div class="calibers">
            <button class="chip toggle" :class="{ on: caliber === 'all' }" @click="caliber = 'all'">全部 · {{ state.history.length }}</button>
            <button v-for="c in calibers" :key="c.key" class="chip toggle" :class="{ on: caliber === c.key }" @click="caliber = c.key">
              {{ c.label }} · {{ c.count }}
            </button>
          </div>
          <label class="sort">
            排序
            <select v-model="sort" class="input sm">
              <option value="time">最新在前</option>
              <option value="scoreDesc">综合评分从高到低</option>
              <option value="scoreAsc">综合评分从低到高</option>
              <option value="blind">盲区小区从多到少</option>
            </select>
          </label>
        </div>

        <div v-if="picked.length" class="card selbar">
          <span>
            已选
            <b class="num">{{ picked.length }}</b>
            个社区
            <span v-if="picked.length > MAX_COMPARE" class="warn-text">（对比最多 {{ MAX_COMPARE }} 个，将取前 {{ MAX_COMPARE }} 个）</span>
          </span>
          <span class="grow"></span>
          <button class="btn sm ghost" @click="picked = []">清除选择</button>
          <button class="btn sm primary" :disabled="picked.length < 2" :title="picked.length < 2 ? '至少选择 2 个社区' : ''" @click="compare">
            📊 对比所选
          </button>
        </div>

        <div class="card table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th class="ck">
                  <input type="checkbox" :checked="allPicked" :indeterminate="somePicked" aria-label="全选当前列表" @change="toggleAll" />
                </th>
                <th>社区</th>
                <th>口径</th>
                <th class="r">综合</th>
                <th class="r">老年人</th>
                <th class="r">亲子</th>
                <th class="r">盲区小区</th>
                <th>体检时间</th>
                <th class="r">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in rows" :key="h.id" :class="{ current: state.result?.id === h.id, sel: picked.includes(h.id) }">
                <td class="ck"><input v-model="picked" type="checkbox" :value="h.id" :aria-label="`选择 ${h.name}`" /></td>
                <td class="name">
                  <a class="link" :title="`打开 ${h.name} 的体检报告`" @click="open(h.id)">{{ h.name }}</a>
                  <span v-if="state.result?.id === h.id" class="chip brand cur">当前</span>
                  <div class="muted small addr">{{ h.address || h.district }}</div>
                </td>
                <td class="nowrap">
                  <span class="tag" :title="`步行时长 ${h.minutes} 分钟`">{{ h.minutes }}′</span>
                  <span class="tag" :class="`tier-${h.tier}`" :title="`采样档位：${TIER_NAME[h.tier] || '未知'}`">{{ TIER_LEVEL[h.tier] || '?' }}</span>
                  <span v-if="(h.threshold ?? 1000) !== 1000" class="tag" title="盲区判定阈值">{{ h.threshold }} m</span>
                </td>
                <td class="r">
                  <span class="chip num" :class="grade(h.score)">{{ h.score ?? '–' }}</span>
                </td>
                <td class="r num">{{ h.elderlyScore ?? '–' }}</td>
                <td class="r num">{{ h.childScore ?? '–' }}</td>
                <td class="r num">
                  <template v-if="Number.isFinite(h.residentialBlind) && h.residentialTotal">{{ h.residentialBlind }} / {{ h.residentialTotal }}</template>
                  <template v-else>–</template>
                </td>
                <td class="nowrap muted small">{{ dateTime(h.createdAt) }}</td>
                <td class="r nowrap">
                  <div class="ops">
                    <button class="btn sm ghost" @click="open(h.id)">打开</button>
                    <button class="btn sm ghost" @click="print(h.id)">报告</button>
                    <button class="btn sm ghost danger" :disabled="removing === h.id" @click="remove(h)">移除</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!rows.length">
                <td colspan="9" class="none muted">没有匹配「{{ state.historyQuery.trim() }}」的记录</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small foot">
          「移除」只会从你自己的历史中删去这条记录，报告本身仍保留，拿到分享链接的人照样能打开。同一社区用不同步行时长或采样档位体检，会保存为不同的记录。
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { state, openAnalysis, refreshHistory } from '../store.js';
import { api } from '../api.js';
import { TIER_LEVEL, TIER_NAME, caliberKey, caliberLabel } from '../utils/caliber.js';
import { dateTime } from '../utils/format.js';

const MAX_COMPARE = 10;
const loaded = ref(false);
const caliber = ref('all');
const sort = ref('time');
const picked = ref([]);
const removing = ref(null);

onMounted(async () => {
  await refreshHistory();
  loaded.value = true;
});

const grade = (s) => (s >= 70 ? 'good' : s >= 60 ? 'warn' : 'bad');
const scores = computed(() => state.history.map((h) => h.score).filter(Number.isFinite));
const avgScore = computed(() => (scores.value.length ? Math.round(scores.value.reduce((a, b) => a + b, 0) / scores.value.length) : '–'));
const cities = computed(() => new Set(state.history.map((h) => (h.district || '').split(' ')[0]).filter(Boolean)).size || '–');
const latest = computed(() => (state.history[0] ? dateTime(state.history[0].createdAt).slice(5, 16) : '–'));

const calibers = computed(() => {
  const m = new Map();
  for (const h of state.history) {
    const k = caliberKey(h);
    if (!m.has(k)) m.set(k, { key: k, label: caliberLabel(h), count: 0 });
    m.get(k).count += 1;
  }
  return m.size > 1 ? [...m.values()].sort((a, b) => b.count - a.count) : [];
});

const rows = computed(() => {
  const q = state.historyQuery.trim().toLowerCase();
  let list = state.history.filter((h) => caliber.value === 'all' || caliberKey(h) === caliber.value);
  if (q) list = list.filter((h) => [h.name, h.address, h.district].some((s) => (s || '').toLowerCase().includes(q)));
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  if (sort.value === 'scoreDesc') list = [...list].sort((a, b) => num(b.score, -1) - num(a.score, -1));
  else if (sort.value === 'scoreAsc') list = [...list].sort((a, b) => num(a.score, 101) - num(b.score, 101));
  else if (sort.value === 'blind') list = [...list].sort((a, b) => num(b.residentialBlind, -1) - num(a.residentialBlind, -1));
  return list;
});

const allPicked = computed(() => rows.value.length > 0 && rows.value.every((h) => picked.value.includes(h.id)));
const somePicked = computed(() => !allPicked.value && rows.value.some((h) => picked.value.includes(h.id)));
function toggleAll() {
  const ids = rows.value.map((h) => h.id);
  picked.value = allPicked.value ? picked.value.filter((id) => !ids.includes(id)) : [...new Set([...picked.value, ...ids])];
}

async function open(id) {
  try {
    await openAnalysis(id);
  } catch {
    state.notice = '这份体检报告不存在或已被删除';
  }
}

async function print(id) {
  await open(id);
  if (state.result?.id === id) state.view = 'report';
}

function compare() {
  // 按列表当前顺序取前 10 个
  const order = rows.value.map((h) => h.id).filter((id) => picked.value.includes(id));
  state.compareIds = order.slice(0, MAX_COMPARE);
  state.view = 'compare';
}

async function remove(h) {
  if (!window.confirm(`从历史中移除「${h.name}」？\n报告本身不会删除，之后通过分享链接仍可打开。`)) return;
  removing.value = h.id;
  try {
    await api.removeHistory(h.id);
    picked.value = picked.value.filter((id) => id !== h.id);
    state.history = state.history.filter((x) => x.id !== h.id);
    state.notice = `已从历史中移除「${h.name}」`;
  } catch (err) {
    state.notice = `移除失败：${err.message}`;
  } finally {
    removing.value = null;
  }
}
</script>

<style scoped>
.hist {
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

.hk-v.sm {
  font-size: 17px;
  line-height: 1.6;
}

.hk-l {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 20px 24px;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 36px;
}

.empty p {
  margin: 0 0 6px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
}

.search {
  width: 280px;
}

.calibers {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.chip.toggle {
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
}

.chip.toggle.on {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}

.sort {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.sort select {
  width: auto;
}

.selbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-color: var(--brand);
  background: var(--brand-soft);
}

.grow {
  flex: 1;
}

.warn-text {
  color: var(--warn-text);
}

.table-wrap {
  padding: 0;
  overflow: hidden;
}

.data th,
.data td {
  vertical-align: middle;
}

.data th {
  white-space: nowrap;
}

.ck {
  width: 32px;
  text-align: center !important;
}

.name {
  min-width: 220px;
}

.name .link {
  font-weight: 600;
  cursor: pointer;
}

.name .link:hover {
  text-decoration: underline;
}

.cur {
  margin-left: 6px;
  font-size: 11px;
}

.addr {
  margin-top: 2px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nowrap {
  white-space: nowrap;
}

tr.current td {
  background: color-mix(in srgb, var(--brand) 6%, transparent);
}

tr.sel td {
  background: var(--brand-soft);
}

tbody tr:hover td {
  background: var(--surface-2);
}

.ops {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}

.btn.danger {
  color: var(--bad-text);
}

.btn.danger:hover:not(:disabled) {
  background: var(--bad-soft);
}

.tag {
  display: inline-block;
  font-size: 11px;
  line-height: 18px;
  padding: 0 5px;
  margin-right: 3px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-secondary);
}

.tag.tier-lite {
  color: var(--warn-text);
  background: var(--warn-soft);
}

.tag.tier-precise {
  color: var(--good-text);
  background: var(--good-soft);
}

.none {
  text-align: center !important;
  padding: 28px !important;
}

.foot {
  margin: 0;
}

@media (max-width: 1100px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .table-wrap {
    overflow-x: auto;
  }
}
</style>
