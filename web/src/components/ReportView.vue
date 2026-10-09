<template>
  <div class="report-page">
    <div class="toolbar no-print">
      <button class="btn" @click="state.view = 'main'">← 返回地图</button>
      <div class="actions">
        <button class="btn primary" :disabled="pdfBusy" title="直接下载 PDF 文件（A4，自动分页）" @click="downloadPdf">
          {{ pdfBusy ? '正在生成 PDF…' : '⬇ 下载 PDF' }}
        </button>
        <button class="btn" :disabled="pdfBusy" title="打开浏览器打印预览（也可按 ⌘P / Ctrl+P）" @click="print">🖨 打印</button>
      </div>
    </div>
    <div v-if="printBlocked" class="print-tip no-print" role="status">
      <!-- 文字片段各自包在元素里：元素之间的换行不会渲染成空格 -->
      <span>当前浏览器没有弹出打印窗口，可能是在应用内置的预览窗口中打开的。可以按</span>
      <kbd>⌘P</kbd>
      <span>/</span>
      <kbd>Ctrl+P</kbd>
      <span>打印，或</span>
      <a class="link" @click="printInNewWindow">在新窗口中打开并打印</a>
      <span>。</span>
      <button class="close" aria-label="关闭提示" @click="printBlocked = false">×</button>
    </div>
    <article v-if="r" ref="paperEl" class="paper force-light">
      <header>
        <div class="kicker">15 分钟生活圈体检报告</div>
        <h1>{{ r.name }}</h1>
        <div class="meta">
          {{ r.address }} · 中心点 {{ r.center.lng.toFixed(6) }}, {{ r.center.lat.toFixed(6) }}（BD-09）· {{ dateTime(r.createdAt) }} ·
          {{ r.params.tierName }} · {{ r.dataMode === 'live' ? '实时数据' : '回放数据' }}
        </div>
      </header>

      <section class="top keep">
        <div class="score">
          <div class="big num">{{ r.score.total }}</div>
          <div class="grade">{{ r.score.grade }}</div>
          <div v-if="r.elderlyScore" class="muted small">老年人视角 {{ r.elderlyScore.total }} 分</div>
          <div v-if="r.childScore" class="muted small">亲子视角 {{ r.childScore.total }} 分</div>
        </div>
        <p class="summary">{{ r.diagnosis.summary }}</p>
      </section>

      <section class="two">
        <div>
          <h2>等时圈与服务盲区</h2>
          <div class="keep">
            <MiniMapSvg :r="r" :categories="state.config.categories" />
            <div class="legend small">
              <span>
                <i class="ln" style="background: #1c5cab"></i>
                成年人 {{ r.params.minutes }} 分钟圈
              </span>
              <span>
                <i class="ln" style="background: #eb6834"></i>
                老年人 {{ r.params.minutes }} 分钟圈
              </span>
              <span v-if="r.isochrone.polygons.child">
                <i class="ln" style="background: #1baf7a"></i>
                亲子 {{ r.params.minutes }} 分钟圈
              </span>
              <span>
                <i class="ln dash"></i>
                直线画圆
              </span>
              <span>
                <i class="sq"></i>
                服务盲区
              </span>
              <span>★ 推荐选址</span>
            </div>
          </div>
        </div>
        <div>
          <h2>核心指标</h2>
          <table class="data">
            <tbody>
              <tr>
                <td>成年人 {{ r.params.minutes }} 分钟可达面积</td>
                <td class="r">{{ km2(m.areas.adult) }} km²</td>
              </tr>
              <tr>
                <td>老年人 {{ r.params.minutes }} 分钟可达面积</td>
                <td class="r">{{ km2(m.areas.elderly) }} km²</td>
              </tr>
              <tr v-if="m.areas.child">
                <td>亲子 {{ r.params.minutes }} 分钟可达面积</td>
                <td class="r">{{ km2(m.areas.child) }} km²</td>
              </tr>
              <tr>
                <td>「直线画圆」高估</td>
                <td class="r">{{ m.circleOverestimate }}%</td>
              </tr>
              <tr>
                <td>路网绕行系数 λ（中位 / P90）</td>
                <td class="r">{{ m.lambda.median }} / {{ m.lambda.p90 }}</td>
              </tr>
              <tr>
                <td>有步行 1 公里服务盲区的小区</td>
                <td class="r">{{ r.blind.union.residentialBlind }} / {{ r.blind.union.residentialTotal ?? r.blind.metrics.residential }}</td>
              </tr>
              <tr v-if="r.blind.union.residentialHidden !== undefined">
                <td>其中隐性盲区（直线 1 公里内有、实际步行超过）</td>
                <td class="r">{{ r.blind.union.residentialHidden }}</td>
              </tr>
              <tr>
                <td>盲区面积占比（真实步行 / 直线 1 公里）</td>
                <td class="r">
                  {{ pct(r.blind.union.blindRatio) }}
                  <template v-if="r.blind.union.straightBlindRatio !== undefined">/ {{ pct(r.blind.union.straightBlindRatio) }}</template>
                </td>
              </tr>
              <tr>
                <td>检出民生设施（清洗后）</td>
                <td class="r">{{ r.pois.length }} 处</td>
              </tr>
              <tr>
                <td>API 请求（逐点基线）</td>
                <td class="r">{{ r.engineering.requests }}（{{ r.engineering.naiveRequests }}）</td>
              </tr>
              <tr>
                <td>等时圈 LOOCV 误差</td>
                <td class="r">{{ m.crossValidation?.best.maeMeters ?? '–' }} m</td>
              </tr>
            </tbody>
          </table>
          <h2>维度得分</h2>
          <div v-for="d in r.score.dimensions" :key="d.key" class="dim">
            <span>{{ d.name }}</span>
            <span class="bar"><i :style="{ width: `${d.score}%` }"></i></span>
            <span class="num">{{ d.score }}</span>
          </div>
        </div>
      </section>

      <!-- 设施表只有九行：整体不跨页（超过一页时才按行切开） -->
      <section class="keep">
        <h2>分类设施可达性</h2>
        <table class="data">
          <thead>
            <tr>
              <th>设施</th>
              <th>最近一处</th>
              <th class="r">步行距离</th>
              <th class="r">成人</th>
              <th class="r">老人</th>
              <th class="r">亲子</th>
              <th class="r">圈内数量</th>
              <th class="r">得分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in r.access" :key="a.key">
              <td>{{ a.name }}</td>
              <td>{{ a.nearest?.name || '未发现' }}</td>
              <td class="r">{{ a.nearest ? meters(a.nearest.walk) : '–' }}</td>
              <td class="r">{{ a.nearest?.minutes.adult ?? '–' }} 分</td>
              <td class="r">{{ a.nearest?.minutes.elderly ?? '–' }} 分</td>
              <td class="r">{{ a.nearest?.minutes.child ?? '–' }} 分</td>
              <td class="r">{{ a.inCircle.adult }}</td>
              <td class="r">{{ r.score.categories.find((c) => c.key === a.key).score }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="two">
        <div>
          <h2>优势</h2>
          <ul>
            <li v-for="s in r.diagnosis.strengths" :key="s.key">{{ s.text }}</li>
          </ul>
          <h2>短板</h2>
          <ul>
            <li v-for="s in r.diagnosis.weaknesses" :key="s.key">{{ s.text }}</li>
            <li v-if="!r.diagnosis.weaknesses.length" class="muted">无明显短板</li>
          </ul>
        </div>
        <div>
          <h2>服务盲区</h2>
          <ul>
            <li v-for="(s, i) in r.diagnosis.blindSpots" :key="i">{{ s }}</li>
            <li v-if="!r.diagnosis.blindSpots.length" class="muted">未发现 1 公里服务盲区</li>
          </ul>
          <h2>适老化评估</h2>
          <p>{{ r.diagnosis.elderly }}</p>
          <template v-if="r.diagnosis.child">
            <h2>亲子友好评估</h2>
            <p>{{ r.diagnosis.child }}</p>
          </template>
        </div>
      </section>

      <section>
        <h2>改造建议</h2>
        <ol>
          <li v-for="(x, i) in r.diagnosis.recommendations" :key="i">
            <b>【{{ x.priority }}】{{ x.title }}</b>
            ：{{ x.detail }}
          </li>
        </ol>
      </section>

      <footer class="small muted">
        方法说明：以百度地图「批量步行算路」对中心点周边扇形多环采样点实测真实路网步行距离，经自适应边界加密与各向异性 IDW 空间插值（LOOCV
        自动选参）生成等时圈； 设施来自百度地点检索、逆地理编码周边 POI 与 OpenStreetMap 多源融合清洗；盲区按「步行 1
        公里内无菜市场/生鲜、药店或小学」判定，采用下界剪枝 + 批量实测核验。 评分标准参考 GB 50180-2018《城市居住区规划设计标准》与 TD/T
        1062-2021《社区生活圈规划技术指南》。
      </footer>
    </article>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, nextTick } from 'vue';
import { state } from '../store.js';
import MiniMapSvg from './MiniMapSvg.vue';
import { km2, pct, meters, dateTime } from '../utils/format.js';
import { exportReportPdf } from '../utils/reportPdf.js';

const r = computed(() => state.result);
const m = computed(() => r.value.isochrone.metrics);
/**
 * 打印：部分应用内置的预览窗口会静默忽略 window.print()。
 * 调用后 1 秒内没有触发 beforeprint，就提示改用快捷键或新窗口；嵌在其他页面中时直接到新窗口打印。
 */
const printBlocked = ref(false);
function print() {
  if (window.self !== window.top) return printInNewWindow();
  let started = false;
  const onBefore = () => (started = true);
  window.addEventListener('beforeprint', onBefore, { once: true });
  try {
    window.print();
  } catch {
    // 个别环境会直接抛错，按「未弹出」处理
  }
  setTimeout(() => {
    window.removeEventListener('beforeprint', onBefore);
    printBlocked.value = !started;
  }, 1000);
}
function printInNewWindow() {
  const q = new URLSearchParams(window.location.search);
  q.set('autoprint', '1');
  window.open(`${window.location.pathname}?${q.toString()}`, '_blank', 'noopener');
}
// 通过「新窗口打印」打开时：报告渲染完成后自动弹出打印
onMounted(async () => {
  if (!state.autoPrint) return;
  state.autoPrint = false;
  await nextTick();
  setTimeout(() => window.print(), 400);
});

const paperEl = ref(null);
const pdfBusy = ref(false);
/** 文件名：生活圈体检报告_社区名_体检日期.pdf（去掉文件名中不允许的字符） */
const pdfName = () => {
  const name = (r.value.name || '社区').replace(/[\\/:*?"<>|\s]+/g, '');
  const day = (r.value.createdAt || new Date().toISOString()).slice(0, 10).replace(/-/g, '');
  return `生活圈体检报告_${name}_${day}.pdf`;
};
async function downloadPdf() {
  if (!paperEl.value || pdfBusy.value) return;
  pdfBusy.value = true;
  try {
    const { pages } = await exportReportPdf(paperEl.value, { filename: pdfName() });
    state.notice = `PDF 已生成，共 ${pages} 页`;
  } catch (err) {
    console.error('[pdf]', err);
    state.notice = `PDF 生成失败：${err.message}。可改用「打印」另存为 PDF`;
  } finally {
    pdfBusy.value = false;
  }
}
</script>

<style scoped>
.report-page {
  height: 100%;
  overflow: auto;
  background: var(--bg);
  padding: 20px;
}

.toolbar {
  max-width: 900px;
  margin: 0 auto 12px;
  display: flex;
  justify-content: space-between;
}

.actions {
  display: flex;
  gap: 8px;
}

.print-tip {
  position: relative;
  max-width: 900px;
  margin: 0 auto 12px;
  padding: 8px 36px 8px 12px;
  border: 1px solid var(--warn-border);
  border-radius: 8px;
  background: var(--warn-soft);
  color: var(--warn-text);
  font-size: 13px;
}

.print-tip kbd {
  margin: 0 4px;
  padding: 0 4px;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
}

.print-tip .link {
  margin-left: 2px;
  cursor: pointer;
  text-decoration: underline;
}

.print-tip .close {
  position: absolute;
  top: 4px;
  right: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
}

/* 数字列不折行（如「12.8 分」「2.48 km」） */
.paper :deep(td.r),
.paper :deep(th.r) {
  white-space: nowrap;
}

/* 导出 PDF 时的排版：固定宽度、去掉纸张内边距与阴影（边距由 PDF 页面提供） */
.paper.pdf-mode {
  max-width: none;
  padding: 0;
  border-radius: 0;
  box-shadow: none;
}

.paper {
  max-width: 900px;
  margin: 0 auto;
  background: #fff;
  padding: 36px 44px;
  border-radius: 12px;
  box-shadow: var(--shadow);
  font-size: 13px;
  line-height: 1.7;
}

.kicker {
  color: var(--brand);
  font-weight: 600;
  letter-spacing: 0.08em;
  font-size: 12px;
}

h1 {
  margin: 4px 0;
  font-size: 24px;
}

h2 {
  font-size: 15px;
  margin: 18px 0 8px;
  padding-left: 8px;
  border-left: 3px solid var(--brand);
}

.meta {
  color: var(--text-secondary);
  font-size: 12px;
}

.top {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-top: 18px;
  padding: 16px;
  background: var(--surface-2);
  border-radius: 10px;
}

.score {
  text-align: center;
  min-width: 110px;
}

.big {
  font-size: 48px;
  font-weight: 800;
  color: var(--brand-strong);
  line-height: 1;
}

.grade {
  font-weight: 700;
  margin-top: 4px;
}

.summary {
  margin: 0;
}

.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
  color: var(--text-secondary);
}

.legend i {
  display: inline-block;
  vertical-align: middle;
  margin-right: 4px;
}

.ln {
  width: 16px;
  height: 3px;
}

.ln.dash {
  background: repeating-linear-gradient(90deg, #8391a7 0 4px, transparent 4px 7px);
}

.sq {
  width: 12px;
  height: 10px;
  background: #5b6472;
  opacity: 0.6;
}

.dim {
  display: grid;
  grid-template-columns: 70px 1fr 30px;
  gap: 8px;
  align-items: center;
}

.dim .bar {
  height: 6px;
  background: var(--surface-3);
  border-radius: 3px;
}

.dim .bar i {
  display: block;
  height: 100%;
  background: var(--series-1);
  border-radius: 3px;
}

ul,
ol {
  padding-left: 18px;
  margin: 0;
}

.small {
  font-size: 11.5px;
}

footer {
  margin-top: 24px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

@media print {
  .no-print {
    display: none !important;
  }

  .report-page {
    padding: 0;
    background: #fff;
    overflow: visible;
    height: auto;
  }

  .paper {
    box-shadow: none;
    padding: 0;
    max-width: none;
  }

  /* 只保护小的单元不被切开，大段落允许跨页，避免整段被推到下一页而在上一页留下大片空白 */
  .keep,
  tr,
  li,
  .dim,
  footer {
    break-inside: avoid;
  }

  h2 {
    break-after: avoid;
  }

  p {
    orphans: 3;
    widows: 3;
  }

  /* 表格跨页时在新的一页重复表头 */
  thead {
    display: table-header-group;
  }
}

@page {
  size: A4;
  margin: 12mm;
}
</style>
