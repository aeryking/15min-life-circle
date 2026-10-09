<template>
  <div class="eng">
    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">API 请求 / 逐点调用基线</div>
        <div class="value">
          {{ e.requests }}
          <small>/ {{ e.naiveRequests }}</small>
        </div>
        <div class="hint">节省 {{ e.savedRatio }}% 调用</div>
      </div>
      <div class="kpi">
        <div class="label">批量算路因子</div>
        <div class="value">
          {{ e.batchFactor }}
          <small>元素/请求</small>
        </div>
        <div class="hint">共 {{ e.matrixElements }} 个距离元素</div>
      </div>
      <div class="kpi">
        <div class="label">上游调用 · 缓存命中</div>
        <div class="value">
          {{ e.upstream }}
          <small>· {{ e.cacheHits }}</small>
        </div>
        <div class="hint">回放 {{ e.replayHits }} · 实时 {{ e.network }}</div>
      </div>
      <div class="kpi">
        <div class="label">重试 · 失败 · 降级</div>
        <div class="value">
          {{ e.retries }}
          <small>· {{ e.failures }} · {{ e.degradations.length }}</small>
        </div>
        <div class="hint">总耗时 {{ ms(e.totalMs) }}</div>
      </div>
    </div>

    <h4 class="section-title">
      分阶段耗时
      <span class="muted">等时圈与 POI 采集并发执行</span>
    </h4>
    <EChart :option="phaseOption" height="190px" />

    <h4 class="section-title">按服务统计</h4>
    <table class="data">
      <thead>
        <tr>
          <th>服务</th>
          <th class="r">请求</th>
          <th class="r">上游</th>
          <th class="r">缓存</th>
          <th class="r">失败</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, k) in e.byService" :key="k">
          <td>{{ SERVICE_LABEL[k] || k }}</td>
          <td class="r">{{ s.requests }}</td>
          <td class="r">{{ s.network + s.replay }}</td>
          <td class="r">{{ s.cache }}</td>
          <td class="r">{{ s.failures }}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="section-title">
      等时圈算法质量
      <span class="muted">留一交叉验证（LOOCV）</span>
    </h4>
    <table class="data">
      <tbody>
        <tr>
          <td>采样</td>
          <td class="r">
            {{ tier.rays }} 方向 × {{ tier.rings }} 环 + {{ tier.refineRounds }} 轮边界加密 = {{ iso.samples }} 点（有效 {{ iso.validSamples }}）
          </td>
        </tr>
        <tr>
          <td>自动选择的插值模型</td>
          <td class="r">{{ modelLabel }}</td>
        </tr>
        <tr>
          <td>LOOCV 平均误差（集成模型）</td>
          <td class="r">{{ cv?.best.maeMeters ?? '–' }} m（≈ {{ cv?.best.maeSeconds ?? '–' }} s）</td>
        </tr>
        <tr v-if="cv?.candidates">
          <td>单模型：IDW / 极坐标</td>
          <td class="r">{{ cv.candidates.idw.maeMeters }} m / {{ cv.candidates.polar.maeMeters }} m</td>
        </tr>
        <tr>
          <td>各向同性 λ-IDW 基线</td>
          <td class="r">{{ cv?.baseline.maeMeters ?? '–' }} m</td>
        </tr>
        <tr>
          <td>圈内/圈外判定一致率</td>
          <td class="r">{{ cv ? pct(cv.best.agreement) : '–' }}</td>
        </tr>
        <tr>
          <td>等时圈采样请求</td>
          <td class="r">{{ iso.requests }} 次</td>
        </tr>
      </tbody>
    </table>

    <h4 class="section-title">容错与降级事件</h4>
    <div v-if="!e.degradations.length" class="muted small">本次体检未触发降级 ✓（可在下方开启故障演练观察降级链路）</div>
    <ul v-else class="deg">
      <li v-for="(d, i) in e.degradations.slice(0, 12)" :key="i">
        <span class="chip warn">{{ d.stage }}</span>
        {{ d.reason }} →
        <b>{{ d.fallback || '跳过' }}</b>
        <div class="muted small">{{ d.message }}</div>
      </li>
    </ul>

    <h4 class="section-title">
      故障演练（Chaos）
      <span class="muted">模拟网络异常与 QPS 限流</span>
    </h4>
    <div class="chaos card">
      <label class="row">
        <input v-model="chaos.enabled" type="checkbox" @change="applyChaos" />
        开启故障注入
      </label>
      <label class="row">
        网络失败率
        <input v-model.number="chaos.failureRate" type="range" min="0" max="0.8" step="0.05" @change="applyChaos" />
        <span class="num">{{ Math.round(chaos.failureRate * 100) }}%</span>
      </label>
      <label class="row">
        QPS 限流率
        <input v-model.number="chaos.qpsLimitRate" type="range" min="0" max="0.8" step="0.05" @change="applyChaos" />
        <span class="num">{{ Math.round(chaos.qpsLimitRate * 100) }}%</span>
      </label>
      <div v-if="status" class="muted small">
        限流器速率 {{ status.limiter.rate }}/{{ status.limiter.maxQps }} QPS · 在途 {{ status.limiter.inFlight }} · 已注入 失败
        {{ status.chaos.injected.failure }} / 限流 {{ status.chaos.injected.rateLimit }}
        <div>
          熔断器：
          <span v-for="(b, k) in status.breakers" :key="k" class="chip" :class="b.state === 'closed' ? 'good' : 'bad'">
            {{ SERVICE_LABEL[k] || k }} {{ b.state }}
          </span>
        </div>
      </div>
      <button class="btn sm" :disabled="state.running" @click="rerun">开启后重新体检（跳过结果缓存）</button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount } from 'vue';
import { state, startAnalysis } from '../../store.js';
import { api } from '../../api.js';
import EChart from '../charts/EChart.vue';
import { hbar } from '../charts/options.js';
import { ms, pct, SERVICE_LABEL } from '../../utils/format.js';

const e = computed(() => state.result.engineering);
const tier = computed(() => e.value.tier);
const iso = computed(() => state.result.isochrone.metrics);
const cv = computed(() => iso.value.crossValidation);
const modelLabel = computed(() => {
  const p = cv.value?.params;
  if (!p) return '经验绕行系数（降级）';
  const idw = p.idw || p;
  const idwText = `${idw.mode === 'lambda' ? '绕行系数 λ' : '绕行增量 e'} IDW（p=${idw.power}, α=${idw.alpha}, k=${idw.k}）`;
  return p.mode === 'ensemble' ? `${idwText} ⊕ 极坐标双线性` : idwText;
});
const phaseOption = computed(() =>
  hbar({
    labels: e.value.phases.map((p) => p.label),
    values: e.value.phases.map((p) => p.ms),
    unit: ' ms',
    tooltipFormat: (i) => {
      const p = e.value.phases[i];
      return `${p.label}<br/><b>${ms(p.ms)}</b> · 请求 ${p.requests}（上游 ${p.upstream} / 缓存 ${p.cache}）`;
    },
  }),
);

const chaos = reactive({ enabled: false, failureRate: 0.2, qpsLimitRate: 0.1 });
const status = ref(null);
let timer = null;
async function poll() {
  try {
    status.value = await api.status();
    Object.assign(chaos, { enabled: status.value.chaos.enabled, failureRate: status.value.chaos.failureRate, qpsLimitRate: status.value.chaos.qpsLimitRate });
  } catch {
    status.value = null;
  }
}
async function applyChaos() {
  await api.chaos({ ...chaos });
  poll();
}
function rerun() {
  state.params.fresh = 1;
  startAnalysis();
  delete state.params.fresh;
}
onMounted(() => {
  poll();
  timer = setInterval(poll, 3000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.eng {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.small {
  font-size: 12px;
  line-height: 1.7;
}

.deg {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chaos {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.chaos .row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chaos input[type='range'] {
  flex: 1;
  accent-color: var(--brand);
}

.chaos .btn {
  align-self: flex-start;
}

.chaos .chip {
  margin: 2px 2px 0 0;
}
</style>
