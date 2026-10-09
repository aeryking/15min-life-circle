<template>
  <!-- 收起后留一条竖向把手：一眼可见、点击任意位置展开 -->
  <button v-if="state.leftCollapsed" class="rail" title="展开左侧面板" aria-label="展开选点与参数面板" @click="state.leftCollapsed = false">
    <span class="rail-chev" aria-hidden="true">»</span>
    <span class="rail-text">选点与参数</span>
  </button>
  <!-- 用 v-show 而非 v-if：收起时保留输入内容、联想列表与定位状态 -->
  <aside v-show="!state.leftCollapsed" class="panel scroll">
    <section>
      <h3 class="section-title">
        ① 选择社区中心点
        <button class="collapse-btn" title="收起左侧面板" aria-label="收起左侧面板" @click="state.leftCollapsed = true">«</button>
      </h3>
      <div class="search">
        <input
          v-model="query"
          class="input"
          placeholder="搜索小区 / 街道 / 地址，如「上地东里」"
          :disabled="offline"
          @input="onInput"
          @keydown.enter="pickFirst"
        />
        <ul v-if="suggestions.length" class="suggest card">
          <li v-for="s in suggestions" :key="s.name + s.lng" @click="pick(s)">
            <b>{{ s.name }}</b>
            <span class="muted">{{ s.city }}{{ s.district }}</span>
          </li>
        </ul>
      </div>
      <div class="row-btns">
        <button class="btn sm" :disabled="offline || locating" @click="locate">{{ locating ? '定位中…' : '🎯 定位我的位置' }}</button>
        <span class="muted tip">或在地图上直接点击选点</span>
      </div>
      <div v-if="locateError" class="loc-msg error" role="alert">
        <div>⚠️ {{ locateError.zh }}</div>
        <div class="en" lang="en">{{ locateError.en }}</div>
        <button class="close" aria-label="关闭提示" @click="locateError = null">×</button>
      </div>
      <p v-else-if="locateNote" class="loc-msg note">📍 {{ locateNote }}</p>
      <p v-if="offline" class="notice">
        当前为
        <b>离线回放模式</b>
        （未配置服务端 AK），可体验下方预置样例社区的完整真实数据；配置 AK 后可分析任意位置。
      </p>

      <div class="presets">
        <button v-for="p in state.config?.presets || []" :key="p.key" class="preset" :class="{ on: state.presetKey === p.key }" @click="selectPreset(p)">
          <div class="pname">{{ p.name }}</div>
          <div class="ptags">
            <span v-for="t in p.tags" :key="t" class="chip">{{ t }}</span>
          </div>
        </button>
      </div>

      <div v-if="state.center" class="picked">
        <div class="picked-name">📍 {{ state.centerLabel || '自定义位置' }}</div>
        <div class="muted num">{{ state.center.lng.toFixed(6) }}, {{ state.center.lat.toFixed(6) }} · BD-09</div>
      </div>
    </section>

    <section>
      <h3 class="section-title">② 体检参数</h3>
      <div class="field">
        <div class="flabel">
          步行时长
          <b class="num">{{ state.params.minutes }} 分钟</b>
        </div>
        <input v-model.number="state.params.minutes" type="range" min="5" max="30" step="5" :disabled="offline" />
      </div>
      <div class="field">
        <div class="flabel">采样档位</div>
        <div class="seg">
          <button
            v-for="t in state.config?.tiers || []"
            :key="t.key"
            :class="{ on: state.params.tier === t.key }"
            :disabled="offline && t.key !== 'standard'"
            @click="state.params.tier = t.key"
          >
            {{ t.name }}
          </button>
        </div>
        <div v-if="tier" class="muted hint">{{ tier.desc }} · 预估 ≤ {{ tier.estimate.total }} 次调用（缓存命中更少）</div>
      </div>
      <details class="adv">
        <summary>人群步速与盲区阈值</summary>
        <div class="speed-grid">
          <label>
            成年人
            <input v-model.number="state.params.adultSpeed" class="input sm num" type="number" step="0.05" min="0.5" max="2" :disabled="offline" />
            m/s
          </label>
          <label>
            老年人
            <input v-model.number="state.params.elderlySpeed" class="input sm num" type="number" step="0.05" min="0.5" max="2" :disabled="offline" />
            m/s
          </label>
          <label>
            亲子
            <input v-model.number="state.params.childSpeed" class="input sm num" type="number" step="0.05" min="0.5" max="2" :disabled="offline" />
            m/s
          </label>
          <label>
            盲区阈值
            <input v-model.number="state.params.threshold" class="input sm num" type="number" step="100" min="300" max="3000" :disabled="offline" />
            m
          </label>
        </div>
        <p class="muted hint">
          一次采样得到的是真实路网距离，各人群等时圈由不同步速换算得出，
          <b>不额外消耗 API 调用</b>
          。
        </p>
      </details>
    </section>

    <section class="run">
      <button class="btn primary lg" :disabled="!state.center || state.running" @click="startAnalysis">
        {{ state.running ? `体检进行中 ${Math.round(state.progress * 100)}%` : state.result ? '重新体检' : '开始智能体检' }}
      </button>
      <ProgressSteps v-if="state.running || state.result || state.error" />
      <p v-if="state.error" class="error">⚠️ {{ state.error }}</p>
    </section>

    <section v-if="state.history.length" class="history">
      <h3 class="section-title">
        历史体检
        <a class="link" @click="state.view = 'history'">全部 {{ state.history.length }} 条 →</a>
      </h3>
      <ul>
        <li v-for="h in state.history.slice(0, 8)" :key="h.id" :class="{ on: state.result?.id === h.id }" @click="openAnalysis(h.id)">
          <span class="hname" :title="`${h.name}\n步行 ${h.minutes} 分钟 · 采样${TIER_NAME[h.tier] || ''}`">{{ h.name }}</span>
          <span class="tag" :title="`步行时长 ${h.minutes} 分钟`">{{ h.minutes }}′</span>
          <span class="tag" :class="`tier-${h.tier}`" :title="`采样档位：${TIER_NAME[h.tier] || '未知'}`">{{ TIER_LEVEL[h.tier] || '?' }}</span>
          <span class="chip num" :class="h.score >= 70 ? 'good' : h.score >= 60 ? 'warn' : 'bad'">{{ h.score }}</span>
        </li>
      </ul>
    </section>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue';
import { state, selectPreset, setCenter, startAnalysis, openAnalysis } from '../store.js';
import { api } from '../api.js';
import { TIER_LEVEL, TIER_NAME } from '../utils/caliber.js';
import { geoErrorMessage, accuracyNote } from '../utils/geoError.js';
import ProgressSteps from './ProgressSteps.vue';

const query = ref('');
const suggestions = ref([]);
const locating = ref(false);
const locateError = ref(null);
const locateNote = ref('');
const offline = computed(() => state.config && !state.config.online);
const tier = computed(() => state.config?.tiers.find((t) => t.key === state.params.tier));

let timer = null;
function onInput() {
  clearTimeout(timer);
  const q = query.value.trim();
  if (!q) return (suggestions.value = []);
  timer = setTimeout(async () => {
    try {
      suggestions.value = (await api.suggest(q)).slice(0, 8);
    } catch {
      suggestions.value = [];
    }
  }, 250);
}

function pick(s) {
  setCenter(s, s.name);
  state.focus = { lng: s.lng, lat: s.lat, zoom: 15, t: Date.now() };
  query.value = s.name;
  suggestions.value = [];
}

function pickFirst() {
  if (suggestions.value[0]) pick(suggestions.value[0]);
}

/**
 * 浏览器定位：电脑没有 GPS，由操作系统定位服务主要依据附近 Wi-Fi 推算，精度几十到几百米。
 * 返回 WGS-84 坐标，经服务端「坐标转换 API」转为 BD-09。失败时按原因给出中英双语提示。
 */
function locate() {
  locateError.value = null;
  locateNote.value = '';
  if (!navigator.geolocation) return (locateError.value = geoErrorMessage({ code: 'unsupported' }));
  if (window.isSecureContext === false) return (locateError.value = geoErrorMessage({ code: 'insecure' }));
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const [p] = await api.geoconv([{ lng: pos.coords.longitude, lat: pos.coords.latitude }], 'wgs84');
        // 以坐标命名（与服务端未命名时的格式一致），多次定位的体检在历史里可以区分
        setCenter(p, `${p.lng.toFixed(5)}, ${p.lat.toFixed(5)}`);
        state.focus = { ...p, zoom: 15, t: Date.now() };
        locateNote.value = accuracyNote(pos.coords.accuracy);
      } catch (err) {
        locateError.value = geoErrorMessage({ code: 'convert', message: err.message });
      } finally {
        locating.value = false;
      }
    },
    (err) => {
      locating.value = false;
      locateError.value = geoErrorMessage(err);
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}
</script>

<style scoped>
.rail {
  flex: none;
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
  border: 0;
  border-right: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.rail:hover {
  background: var(--brand-soft);
  color: var(--brand);
}

.rail-chev {
  font-size: 18px;
  line-height: 1;
  color: var(--brand);
}

.rail-text {
  writing-mode: vertical-rl;
  letter-spacing: 0.2em;
  font-size: 13px;
  font-weight: 600;
}

.collapse-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.collapse-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.loc-msg {
  position: relative;
  margin: 8px 0 0;
  padding: 8px 28px 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.6;
}

.loc-msg.error {
  background: var(--bad-soft);
  color: var(--bad-text);
}

.loc-msg.note {
  padding-right: 10px;
  background: var(--surface-2);
  color: var(--text-secondary);
}

.loc-msg .en {
  margin-top: 2px;
  opacity: 0.85;
  font-size: 12px;
}

.loc-msg .close {
  position: absolute;
  top: 2px;
  right: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
}

.panel {
  width: 340px;
  flex: none;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search {
  position: relative;
}

.suggest {
  position: absolute;
  top: 40px;
  left: 0;
  right: 0;
  list-style: none;
  margin: 0;
  padding: 4px;
  z-index: 1000;
  box-shadow: var(--shadow-lg);
}

.suggest li {
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.suggest li:hover {
  background: var(--surface-3);
}

.row-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tip {
  font-size: 12px;
}

.notice {
  font-size: 12px;
  line-height: 1.6;
  background: var(--warn-soft);
  border: 1px solid var(--warn-border);
  color: var(--warn-text);
  padding: 8px 10px;
  border-radius: 8px;
  margin: 0;
}

.presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.preset {
  text-align: left;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
}

.preset:hover {
  border-color: var(--brand);
}

.preset.on {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.pname {
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.35;
}

.ptags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 5px;
}

.ptags .chip {
  font-size: 10.5px;
  padding: 1px 6px;
}

.picked {
  background: var(--surface-2);
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.picked-name {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flabel {
  font-size: 13px;
  display: flex;
  justify-content: space-between;
}

input[type='range'] {
  width: 100%;
  accent-color: var(--brand);
}

.hint {
  font-size: 12px;
  line-height: 1.5;
}

.adv summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}

.speed-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 8px;
}

.speed-grid label {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.speed-grid .input.sm {
  height: 28px;
  padding: 0 6px;
  width: 64px;
}

.run .btn {
  width: 100%;
}

.error {
  color: var(--critical);
  font-size: 13px;
  margin: 0;
}

.history ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.history li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.history li:hover,
.history li.on {
  background: var(--surface-3);
}

.history li {
  gap: 4px;
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

.hname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

.link {
  cursor: pointer;
  font-weight: 500;
}
</style>
