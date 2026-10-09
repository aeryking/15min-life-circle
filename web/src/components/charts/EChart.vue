<template>
  <div ref="el" class="echart" :style="{ height }"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, RadarChart, HeatmapChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  MarkLineComponent,
  MarkAreaComponent,
  GraphicComponent,
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  RadarChart,
  HeatmapChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  MarkLineComponent,
  MarkAreaComponent,
  GraphicComponent,
  LabelLayout,
  CanvasRenderer,
]);

/** 显式指定中文字体：通用族名 sans-serif 触发的字体回退查找会让 canvas 测字慢一个数量级 */
const FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';
const withFont = (o) => ({ textStyle: { fontFamily: FONT }, ...o });

const props = defineProps({ option: { type: Object, required: true }, height: { type: String, default: '240px' } });
const emit = defineEmits(['pick']);
const el = ref(null);
let chart = null;
let ro = null;

let lastWidth = 0;
let frame = 0;

onMounted(() => {
  chart = echarts.init(el.value, null, { renderer: 'canvas' });
  chart.setOption(withFont(props.option));
  // 点击数据项时把 id（若有）抛给父组件，用于跨图表联动高亮
  chart.on('click', (p) => emit('pick', p.data?.id ?? p.data?.cid ?? null, p));
  lastWidth = el.value.clientWidth;
  // 仅在宽度确实变化时重排，并合并到下一帧，避免滚动条出现/消失引起的尺寸振荡
  ro = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (Math.abs(w - lastWidth) < 2) return;
    lastWidth = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => chart?.resize());
  });
  ro.observe(el.value);
});

// option 由 computed 生成，引用变化即代表数据变化，无需深度监听
watch(
  () => props.option,
  (o) => chart?.setOption(withFont(o), true),
);

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  ro?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.echart {
  width: 100%;
}
</style>
