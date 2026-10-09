<template>
  <div class="map-wrap">
    <div ref="el" class="map"></div>

    <div v-if="loadError" class="map-banner">{{ loadError }}</div>

    <div class="map-toolbar card">
      <div class="seg">
        <button :class="{ on: state.mapMode === 'select' }" title="在地图上点击设置体检中心点" @click="state.mapMode = 'select'">📍 选点</button>
        <button :class="{ on: state.mapMode === 'probe' }" :disabled="!v?.isochrone" title="点击任意位置估算步行时间" @click="state.mapMode = 'probe'">
          ⏱ 测时探针
        </button>
      </div>
      <!-- 底图类型属于技术信息，默认隐藏；地址栏加 ?debug=1 时显示，便于排查 -->
      <span v-if="debug" class="chip" :class="adapterKind === 'baidu' ? 'brand' : 'warn'">
        {{ adapterKind === 'baidu' ? '百度地图 JS API GL' : adapterKind === 'leaflet' ? '开源底图降级模式' : '地图加载中' }}
      </span>
    </div>

    <LayerControl class="layer-panel" />

    <div v-if="v?.isochrone" class="legend card" :class="{ collapsed: !legendOpen }">
      <button class="legend-title" :aria-expanded="legendOpen" @click="legendOpen = !legendOpen">
        <span>步行时间（{{ v.isochrone.metrics.minutes }} 分钟圈）</span>
        <span class="muted">{{ legendOpen ? '收起' : '展开' }}</span>
      </button>
      <div v-show="legendOpen" class="legend-body">
        <div class="ramp">
          <span v-for="(c, i) in legendRamp" :key="i" :style="{ background: c }"></span>
        </div>
        <div class="ramp-labels num">
          <span>0</span>
          <span>{{ v.isochrone.metrics.minutes / 2 }}</span>
          <span>{{ v.isochrone.metrics.minutes }} 分钟</span>
        </div>
        <div class="legend-row">
          <i class="line" :style="{ background: PROFILE_COLORS.adult }"></i>
          成年人等时圈
        </div>
        <div class="legend-row">
          <i class="line" :style="{ background: PROFILE_COLORS.elderly }"></i>
          老年人等时圈
        </div>
        <div class="legend-row">
          <i class="line" :style="{ background: PROFILE_COLORS.child }"></i>
          亲子等时圈
        </div>
        <div class="legend-row">
          <i class="line dashed"></i>
          直线画圆（对照）
        </div>
        <div v-if="v.blind" class="legend-row">
          <i class="swatch" :style="{ background: MAP_COLORS.blind }"></i>
          服务盲区（灰色区域）
        </div>
        <div v-if="v.blind?.union?.hiddenCells" class="legend-row">
          <i class="swatch hidden-sw" :style="{ borderColor: MAP_COLORS.hidden }"></i>
          隐性盲区（直线近、实际远）
        </div>
        <div v-if="v.siting?.length" class="legend-row">
          <i class="star">★</i>
          推荐新增设施
        </div>
      </div>
    </div>

    <transition name="fade">
      <div v-if="state.probe" class="probe card">
        <button class="close" @click="state.probe = null">×</button>
        <div class="probe-title">⏱ 测时探针</div>
        <template v-if="state.probe.distance !== null">
          <div class="probe-main num">
            {{ Math.round(state.probe.distance) }}
            <small>米步行</small>
          </div>
          <div class="probe-rows">
            <div v-for="p in v.profiles" :key="p.key">
              {{ p.name }}：
              <b class="num">{{ (state.probe.distance / p.speed / 60).toFixed(1) }}</b>
              分钟
              <span v-if="state.probe.distance / p.speed / 60 <= v.params.minutes" class="chip good">圈内</span>
              <span v-else class="chip">圈外</span>
            </div>
          </div>
          <div class="muted small">
            直线 {{ Math.round(state.probe.straight) }} m · 绕行系数 {{ (state.probe.distance / Math.max(1, state.probe.straight)).toFixed(2) }} ·
            由距离场插值估算（0 次 API 调用）
          </div>

          <div class="verify">
            <button v-if="!verify.result && !verify.error" class="btn sm primary" :disabled="verify.loading || !state.result" @click="runVerify">
              {{ verify.loading ? '实测中…' : '🎯 实测验证（1 次批量算路）' }}
            </button>
            <template v-if="verify.result">
              <div class="vs">
                <div>
                  <div class="vs-l">插值估算</div>
                  <div class="vs-v num">{{ Math.round(state.probe.distance) }} m</div>
                  <div class="muted small">成年人 {{ (state.probe.distance / adultSpeed / 60).toFixed(1) }} 分钟</div>
                </div>
                <div class="vs-mid">vs</div>
                <div>
                  <div class="vs-l">百度实测</div>
                  <div class="vs-v num">{{ verify.result.distance }} m</div>
                  <div class="muted small">成年人 {{ (verify.result.distance / adultSpeed / 60).toFixed(1) }} 分钟</div>
                </div>
              </div>
              <div class="err" :class="errClass(verify.errPct)">
                <span class="status-icon">{{ Math.abs(verify.errPct) <= 10 ? '●' : Math.abs(verify.errPct) <= 20 ? '▲' : '■' }}</span>
                误差 {{ verify.errPct > 0 ? '+' : '' }}{{ verify.errPct.toFixed(1) }}%（{{ verify.errM > 0 ? '+' : '' }}{{ verify.errM }} m，约
                {{ Math.abs(verify.errM / adultSpeed / 60).toFixed(1) }} 分钟）
                <span v-if="verify.flip" class="chip bad">圈内外判定不一致</span>
                <span v-else class="chip good">圈内外判定一致</span>
              </div>
            </template>
            <div v-if="verify.error" class="muted small verr">⚠️ {{ verify.error }}</div>
          </div>
        </template>
        <div v-else class="muted">超出分析范围</div>
        <div v-if="probeLog.length" class="tally">
          累计实测
          <b class="num">{{ probeLog.length }}</b>
          个点 · 平均误差
          <b class="num">{{ tally.mape }}%</b>
          （{{ tally.maeM }} m）· 判定一致 {{ tally.agree }}/{{ probeLog.length }}
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, onBeforeUnmount } from 'vue';
import { state, view, setCenter } from '../store.js';
import { api } from '../api.js';
import { loadBaiduGL, BaiduAdapter } from '../map/baiduAdapter.js';
import * as L from '../map/layers.js';
import { PROFILE_COLORS, MAP_COLORS, theme } from '../utils/theme.js';
import { probeDistance, haversine } from '../utils/geo.js';
import LayerControl from './LayerControl.vue';

const el = ref(null);
// 左下角图例：默认展开，可收起为一条标题栏
const legendOpen = ref(true);
const adapterKind = ref('');
const loadError = ref('');
let map = null;
const v = view;

const legendRamp = ['#1c5cab', '#3d7fd9', '#6ea3e6', '#a6c8f0', '#d7e6f8'];

const query = new URLSearchParams(location.search);
const debug = query.get('debug') === '1';

async function createAdapter(center) {
  const ak = state.config?.browserAk;
  // ?basemap=osm 可强制使用开源底图（无浏览器端 AK、或低性能设备 / 无 GPU 环境）
  const forceOsm = query.get('basemap') === 'osm';
  if (ak && !forceOsm) {
    try {
      await loadBaiduGL(ak);
      adapterKind.value = 'baidu';
      return new BaiduAdapter(el.value, center);
    } catch (err) {
      console.warn('[map] 百度地图 JS API GL 加载失败，改用备用底图：', err);
      loadError.value = debug ? `百度地图加载失败（${err.message}），已切换为开源底图` : '';
    }
  }
  const { LeafletAdapter } = await import('../map/leafletAdapter.js');
  adapterKind.value = 'leaflet';
  return new LeafletAdapter(el.value, center);
}

function redraw(names) {
  if (!map) return;
  const d = v.value;
  const cats = state.config?.categories || [];
  const builders = {
    bands: () => L.bandLayer(d?.isochrone),
    adult: () => L.profileLayer(d?.isochrone, 'adult'),
    elderly: () => L.profileLayer(d?.isochrone, 'elderly'),
    child: () => L.profileLayer(d?.isochrone, 'child'),
    circle: () => L.circleLayer(d),
    samples: () => L.sampleLayer(d?.isochrone),
    blind: () => L.blindLayer(d, state.blindCategory),
    blindCells: () => L.blindCellLayer(d, state.blindCategory),
    blindHidden: () => L.hiddenBlindLayer(d, state.blindCategory),
    residential: () => L.residentialLayer(d),
    pois: () => L.poiLayer(d, state.poiFilter, cats),
    siting: () => L.sitingLayer(d),
  };
  for (const name of names || Object.keys(builders)) {
    map.setLayer(name, builders[name](), state.layers[name] !== false);
  }
}

onMounted(async () => {
  const center = state.center || { lng: 116.404, lat: 39.915 };
  map = await createAdapter(center);
  map.setTheme(theme.value);
  map.setCenterMarker(state.center);
  map.onClick(async (p) => {
    if (state.mapMode === 'probe' && v.value?.isochrone) {
      state.probe = { ...p, distance: probeDistance(v.value, p), straight: haversine(v.value.center, p) };
      Object.assign(verify, { loading: false, result: null, error: null });
      map.setLayer('probe', L.highlightLayer([{ lng: p.lng, lat: p.lat, name: '测时探针' }], { pulse: false }));
      return;
    }
    if (state.running) return;
    setCenter(p, '');
    try {
      const r = await api.reverse(p);
      if (state.center?.lng === Math.round(p.lng * 1e6) / 1e6) state.centerLabel = r.sematicDescription?.replace(/附近.*$/, '') || r.address || '';
    } catch {
      // 离线模式下逆地理编码可能不可用，保留坐标
    }
  });
  redraw();
  map.setLayer('highlights', L.highlightLayer(state.highlights));
  // 容器尺寸变化（收起 / 展开左侧面板、窗口缩放）时让地图重新计算大小，避免边缘留白
  let frame = 0;
  resizeObs = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => map?.resize?.());
  });
  resizeObs.observe(el.value);
});

let resizeObs = null;
onBeforeUnmount(() => {
  resizeObs?.disconnect();
  map = null;
});

// —— 测时探针 · 实测验证：估算值 vs 百度批量算路实测值，并累计本次体检的验证精度
const verify = reactive({ loading: false, result: null, error: null, errPct: 0, errM: 0, flip: false });
const probeLog = ref([]);
const adultSpeed = computed(() => v.value?.profiles?.find((p) => p.key === 'adult')?.speed || 1.2);
const tally = computed(() => {
  const n = probeLog.value.length || 1;
  return {
    mape: (probeLog.value.reduce((s, x) => s + Math.abs(x.errPct), 0) / n).toFixed(1),
    maeM: Math.round(probeLog.value.reduce((s, x) => s + Math.abs(x.errM), 0) / n),
    agree: probeLog.value.filter((x) => !x.flip).length,
  };
});
const errClass = (e) => (Math.abs(e) <= 10 ? 'good' : Math.abs(e) <= 20 ? 'warn' : 'bad');

async function runVerify() {
  const pr = state.probe;
  if (!pr || !state.result) return;
  verify.loading = true;
  verify.error = null;
  try {
    const res = await api.probe(state.result.id, pr);
    if (state.probe !== pr) return;
    const limit = adultSpeed.value * v.value.params.minutes * 60;
    verify.result = res;
    verify.errM = Math.round(pr.distance - res.distance);
    verify.errPct = ((pr.distance - res.distance) / res.distance) * 100;
    verify.flip = pr.distance <= limit !== res.distance <= limit;
    probeLog.value.push({ errPct: verify.errPct, errM: verify.errM, flip: verify.flip });
  } catch (err) {
    verify.error = err.message;
  } finally {
    verify.loading = false;
  }
}

watch(
  () => state.result?.id,
  () => {
    probeLog.value = [];
    map?.clearLayer('probe');
  },
);
watch(
  () => state.probe,
  (p) => !p && map?.clearLayer('probe'),
);

// 切换主题：底图换样式，覆盖物按新配色重建
watch(theme, (t) => {
  map?.setTheme(t);
  redraw();
  map?.setLayer('highlights', L.highlightLayer(state.highlights));
});

watch(
  () => state.center,
  (c) => map?.setCenterMarker(c),
  { deep: true },
);
watch(
  () => state.focus,
  (f) => f && map?.flyTo(f, f.zoom),
);

// 数据到达即重绘对应图层（流式渲染）
watch(
  () => v.value?.isochrone,
  (iso) => {
    redraw(['bands', 'adult', 'elderly', 'child', 'circle', 'samples']);
    if (iso?.polygons?.adult?.coordinates?.length && !state.result?.reused) {
      const pts = iso.polygons.adult.coordinates.flatMap((poly) => poly[0].map(([lng, lat]) => ({ lng, lat })));
      map?.fitPoints(pts, 60);
    }
  },
);
watch(
  () => v.value?.pois,
  () => redraw(['pois', 'residential']),
);
watch(
  () => v.value?.blind,
  () => redraw(['blind', 'blindHidden', 'blindCells', 'residential']),
);
watch(
  () => v.value?.siting,
  () => redraw(['siting']),
);
watch(
  () => state.result,
  (r) => {
    redraw();
    if (r?.isochrone?.polygons?.adult?.coordinates?.length) {
      const pts = r.isochrone.polygons.adult.coordinates.flatMap((poly) => poly[0].map(([lng, lat]) => ({ lng, lat })));
      map?.fitPoints(pts, 60);
    }
  },
);
watch(
  () => ({ ...state.poiFilter }),
  () => redraw(['pois']),
  { deep: true },
);
watch(
  () => state.blindCategory,
  () => redraw(['blind', 'blindHidden', 'blindCells']),
);
watch(
  () => ({ ...state.layers }),
  (now) => {
    for (const [k, vis] of Object.entries(now)) map?.setVisible(k, vis);
  },
  { deep: true },
);
watch(
  () => state.highlights,
  (h) => {
    map?.setLayer('highlights', L.highlightLayer(h));
    if (h?.length) map?.fitPoints([...h, v.value.center], 80);
  },
  { deep: true },
);
</script>

<style scoped>
.map-wrap {
  position: relative;
  height: 100%;
  min-height: 420px;
}

.map {
  position: absolute;
  inset: 0;
  background: var(--map-bg);
}

.map-banner {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--warn-soft);
  color: var(--warn-text);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  z-index: 500;
}

.map-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  box-shadow: var(--shadow);
  z-index: 500;
}

.map-toolbar .seg {
  min-width: 200px;
}

.layer-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 500;
}

.legend {
  position: absolute;
  left: 12px;
  bottom: 36px;
  padding: 10px 12px;
  font-size: 12px;
  box-shadow: var(--shadow);
  z-index: 500;
  /* 展开与收起时宽度一致，切换时不跳动 */
  min-width: 210px;
}

.legend-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0;
  margin-bottom: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.legend-title .muted {
  font-weight: 400;
}

.legend.collapsed .legend-title {
  margin-bottom: 0;
}

.ramp {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}

.ramp span {
  flex: 1;
}

.ramp-labels {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  margin: 2px 0 6px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  line-height: 20px;
}

.legend-row .line {
  width: 18px;
  height: 3px;
  border-radius: 2px;
}

.legend-row .line.dashed {
  background: repeating-linear-gradient(90deg, #8391a7 0 5px, transparent 5px 8px);
}

.legend-row .swatch.hidden-sw {
  background: transparent;
  border: 2px dashed;
}

.legend-row .swatch {
  width: 14px;
  height: 10px;
  border-radius: 2px;
  opacity: 0.7;
}

.legend-row .star {
  color: var(--series-2);
  font-style: normal;
  width: 18px;
  text-align: center;
}

.probe {
  position: absolute;
  left: 50%;
  bottom: 36px;
  transform: translateX(-50%);
  padding: 12px 16px;
  min-width: 320px;
  box-shadow: var(--shadow-lg);
  z-index: 600;
}

.probe .close {
  position: absolute;
  right: 8px;
  top: 4px;
  border: 0;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-muted);
}

.probe-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
}

.probe-main {
  font-size: 26px;
  font-weight: 700;
  margin: 4px 0;
}

.probe-main small {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.verify {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.vs {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}

.vs-l {
  font-size: 12px;
  color: var(--text-secondary);
}

.vs-v {
  font-size: 19px;
  font-weight: 700;
}

.vs-mid {
  color: var(--text-muted);
  font-weight: 600;
}

.err {
  margin-top: 6px;
  font-size: 12.5px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.err.good {
  color: var(--good-text);
}

.err.warn {
  color: var(--warn-text);
}

.err.bad {
  color: var(--bad-text);
}

.verr {
  margin-top: 4px;
}

.tally {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--brand-soft);
  font-size: 12px;
  color: var(--text-secondary);
}

.probe-rows {
  display: grid;
  gap: 2px;
  margin-bottom: 6px;
}

.small {
  font-size: 12px;
}
</style>
