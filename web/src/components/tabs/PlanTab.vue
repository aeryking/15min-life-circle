<template>
  <div class="plan">
    <h4 class="section-title">
      补短板选址推荐
      <span class="muted">最大覆盖模型（MCLP）</span>
    </h4>
    <div v-if="!r.siting.length" class="muted">未发现需要补点的关键设施盲区 ✓</div>
    <div v-for="s in r.siting" :key="s.category" class="site card">
      <div class="site-head">
        <b>★ 新增{{ s.name }}</b>
        <span class="chip good">{{ s.basis === 'verified' ? '实测' : '估算' }}消除 {{ s.reduction }}% 盲区需求</span>
      </div>
      <div class="addr">📍 {{ s.sites[0].description || s.sites[0].address }}</div>
      <div class="meta muted">
        覆盖 {{ s.sites[0].coveredPoints }} 个盲区点位
        <template v-if="s.sites[0].coveredResidential.length">
          · 惠及 {{ s.sites[0].coveredResidential.slice(0, 4).join('、') }}{{ s.sites[0].coveredResidential.length > 4 ? ' 等' : '' }}
        </template>
      </div>
      <div v-if="s.verified" class="meta">✅ API 实测：{{ s.verified.covered }}/{{ s.verified.measured }} 个需求点步行 ≤ {{ r.params.threshold }} m</div>
      <div v-if="s.shortlist?.length > 1" class="meta muted">
        候选点实测择优：{{ s.shortlist.length }} 个候选位置实测覆盖 {{ s.shortlist.map((c) => c.verified ?? '–').join(' / ') }} 个需求点（估算
        {{ s.shortlist.map((c) => c.estimated).join(' / ') }}）
      </div>
      <div class="meta muted">
        盲区占比 {{ pct(s.blindBefore) }} → 约 {{ pct(s.blindAfterEstimate) }}
        <template v-if="s.sites.length > 1">· 加上备选方案合计可消除约 {{ s.reductionAll }}%</template>
      </div>
      <button class="btn sm" @click="focusSite(s)">在地图上查看</button>
    </div>

    <h4 class="section-title">改造建议</h4>
    <ol class="recs">
      <li v-for="(x, i) in r.diagnosis.recommendations" :key="i">
        <span class="chip" :class="x.priority === '高' ? 'bad' : x.priority === '中' ? 'warn' : ''">{{ x.priority }}优先</span>
        <b>{{ x.title }}</b>
        <div class="muted small">{{ x.detail }}</div>
      </li>
    </ol>

    <h4 class="section-title">
      适老化评估
      <span class="muted">成年人 {{ sp(adult.speed) }} m/s · 老年人 {{ sp(elderly.speed) }} m/s</span>
    </h4>
    <p class="small">{{ r.diagnosis.elderly }}</p>
    <table class="data">
      <thead>
        <tr>
          <th>设施</th>
          <th class="r">成年人</th>
          <th class="r">老年人</th>
          <th class="r">老人圈内</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in r.access" :key="a.key">
          <td>{{ CATEGORY_ICONS[a.key] }} {{ a.name }}</td>
          <td class="r">{{ a.nearest?.minutes.adult ?? '–' }} 分</td>
          <td class="r" :class="{ over: a.nearest?.minutes.elderly > r.params.minutes }">{{ a.nearest?.minutes.elderly ?? '–' }} 分</td>
          <td class="r">{{ a.inCircle.elderly }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="child && r.diagnosis.child">
      <h4 class="section-title">
        亲子友好评估
        <span class="muted">
          陪同儿童 {{ sp(child.speed) }} m/s
          <template v-if="r.childScore">· 亲子视角 {{ r.childScore.total }} 分</template>
        </span>
      </h4>
      <p class="small">{{ r.diagnosis.child }}</p>
      <table class="data">
        <thead>
          <tr>
            <th>设施</th>
            <th class="r">目标</th>
            <th class="r">成年人</th>
            <th class="r">亲子</th>
            <th class="r">亲子圈内</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in childRows" :key="a.key">
            <td>{{ CATEGORY_ICONS[a.key] }} {{ a.name }}</td>
            <td class="r muted">≤ {{ a.targetMinutes }} 分</td>
            <td class="r">{{ a.nearest?.minutes.adult ?? '–' }} 分</td>
            <td class="r" :class="{ over: !a.nearest || a.nearest.minutes.child > a.targetMinutes }">{{ a.nearest?.minutes.child ?? '–' }} 分</td>
            <td class="r">{{ a.inCircle.child ?? 0 }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <h4 class="section-title">AI 报告润色</h4>
    <div v-if="!state.config.llm" class="muted small">
      未配置大模型（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL），当前报告由可解释的规则引擎生成；配置后可一键生成专家口吻的文字报告。
    </div>
    <template v-else>
      <button class="btn sm" :disabled="polishing" @click="polish">{{ polishing ? '生成中…' : '✨ 生成 AI 体检报告' }}</button>
      <div v-if="polished" class="polished card">{{ polished }}</div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { state } from '../../store.js';
import { api } from '../../api.js';
import { pct } from '../../utils/format.js';
import { CATEGORY_ICONS } from '../../utils/theme.js';

const r = computed(() => state.result);
const adult = computed(() => r.value.profiles.find((p) => p.key === 'adult'));
const elderly = computed(() => r.value.profiles.find((p) => p.key === 'elderly'));
const child = computed(() => r.value.profiles.find((p) => p.key === 'child'));
// 步速统一显示一位小数（1 → 1.0）
const sp = (v) => (Number.isInteger(v) ? v.toFixed(1) : v);
// 亲子出行最相关的四类设施：上学、游憩、儿童就医
const CHILD_KEYS = ['kindergarten', 'primary_school', 'park', 'clinic'];
const childRows = computed(() => CHILD_KEYS.map((k) => r.value.access.find((a) => a.key === k)).filter(Boolean));
const polishing = ref(false);
const polished = ref('');

function focusSite(s) {
  state.layers.siting = true;
  state.blindCategory = s.category;
  state.highlights = s.sites.map((x, i) => ({ lng: x.lng, lat: x.lat, name: `建议新增${s.short}（方案 ${i + 1}）` }));
}

async function polish() {
  polishing.value = true;
  try {
    const res = await api.polish(r.value.id);
    polished.value = res.text || res.reason;
  } finally {
    polishing.value = false;
  }
}
</script>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.site {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.site-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.addr {
  font-weight: 500;
}

.meta {
  font-size: 12px;
}

.site .btn {
  align-self: flex-start;
  margin-top: 4px;
}

.recs {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.recs .chip {
  margin-right: 6px;
}

.small {
  font-size: 12.5px;
  line-height: 1.7;
  margin: 2px 0 0;
}

.over {
  color: var(--bad-text);
  font-weight: 600;
}

.polished {
  white-space: pre-wrap;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
}
</style>
