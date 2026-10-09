import { SERIES, CHART_TEXT } from '../../utils/theme.js';

/**
 * 图表规范（dataviz）：细标记、4px 圆角数据端、2px 线、≥ 8px 标记点、
 * 发丝级实线网格、文字使用文本色而非系列色；≥ 2 个系列时始终显示图例。
 */
/** 每次调用时读取当前主题配色（在 computed 中调用即可随主题切换自动重算） */
const tooltip = () => ({
  backgroundColor: CHART_TEXT.tooltipBg,
  borderColor: CHART_TEXT.axis,
  borderWidth: 1,
  textStyle: { color: CHART_TEXT.primary, fontSize: 12 },
  extraCssText: 'box-shadow: 0 4px 16px rgb(0 0 0 / 18%); border-radius: 8px;',
});

/** 单系列横向条形图（类别无序 → 统一使用系列 1 的颜色） */
export function hbar({ labels, values, unit = '', max, color, format = (v) => v, tooltipFormat }) {
  return {
    animationDuration: 400,
    grid: { left: 8, right: 44, top: 6, bottom: 6, containLabel: true },
    tooltip: {
      ...tooltip(),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(42,120,214,0.06)' } },
      formatter: (ps) => {
        const p = ps[0];
        return tooltipFormat ? tooltipFormat(p.dataIndex) : `${p.name}<br/><b>${format(p.value)}${unit}</b>`;
      },
    },
    xAxis: {
      type: 'value',
      max,
      splitLine: { lineStyle: { color: CHART_TEXT.grid } },
      splitNumber: 4,
      axisLabel: { color: CHART_TEXT.muted, fontSize: 11, hideOverlap: true, formatter: (v) => `${format(v)}${unit}` },
    },
    yAxis: {
      type: 'category',
      data: labels,
      inverse: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_TEXT.axis } },
      axisLabel: { color: CHART_TEXT.secondary, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        data: values,
        barWidth: 10,
        barCategoryGap: '40%',
        itemStyle: { color: color || SERIES[0], borderRadius: [0, 4, 4, 0] },
        emphasis: { itemStyle: { color: CHART_TEXT.emphasis } },
        label: { show: true, position: 'right', color: CHART_TEXT.secondary, fontSize: 11, formatter: (p) => `${format(p.value)}${unit}` },
      },
    ],
  };
}

/** 雷达图：成年人 vs 老年人（2 个系列，图例 + 系列色 1/2） */
/**
 * 双系列横向条形图：主系列（如真实步行口径）用系列 1 的颜色，对照系列（如直线口径）用弱化的灰色，
 * 两个系列始终显示图例。
 */
export function hbarPair({ labels, main, ref, unit = '', max }) {
  const bar = (s, color, z) => ({
    name: s.name,
    type: 'bar',
    data: s.values,
    barWidth: 8,
    barGap: '25%',
    z,
    itemStyle: { color, borderRadius: [0, 4, 4, 0] },
    label: { show: true, position: 'right', color: CHART_TEXT.secondary, fontSize: 10.5, formatter: (p) => `${p.value}${unit}` },
  });
  return {
    animationDuration: 400,
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 8, textStyle: { color: CHART_TEXT.secondary, fontSize: 11 } },
    grid: { left: 8, right: 44, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltip(),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(42,120,214,0.06)' } },
      formatter: (ps) => `${ps[0].name}${ps.map((x) => `<br/>${x.marker}${x.seriesName}：<b>${x.value}${unit}</b>`).join('')}`,
    },
    xAxis: {
      type: 'value',
      max,
      splitLine: { lineStyle: { color: CHART_TEXT.grid } },
      splitNumber: 4,
      axisLabel: { color: CHART_TEXT.muted, fontSize: 11, hideOverlap: true, formatter: (v) => `${v}${unit}` },
    },
    yAxis: {
      type: 'category',
      data: labels,
      inverse: true,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_TEXT.axis } },
      axisLabel: { color: CHART_TEXT.secondary, fontSize: 12 },
    },
    series: [bar(main, SERIES[0], 2), bar(ref, CHART_TEXT.muted, 1)],
  };
}

export function radar({ indicators, series }) {
  return {
    animationDuration: 400,
    tooltip: { ...tooltip(), trigger: 'item' },
    legend: { top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, textStyle: { color: CHART_TEXT.secondary, fontSize: 12 } },
    radar: {
      center: ['50%', '56%'],
      radius: '66%',
      indicator: indicators.map((n) => ({ name: n, max: 100 })),
      axisName: { color: CHART_TEXT.secondary, fontSize: 12 },
      splitLine: { lineStyle: { color: CHART_TEXT.grid } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: CHART_TEXT.grid } },
    },
    series: [
      {
        type: 'radar',
        data: series.map((s, i) => ({
          name: s.name,
          value: s.values,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: SERIES[i] },
          itemStyle: { color: SERIES[i], borderColor: CHART_TEXT.surface, borderWidth: 2 },
          areaStyle: { color: SERIES[i], opacity: 0.1 },
        })),
      },
    ],
  };
}

/** 100% 堆叠单条（部分-整体，≤ 4 段，段间 2px 表面色间隙） */
export function stack100({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return {
    animationDuration: 400,
    grid: { left: 4, right: 4, top: 30, bottom: 4 },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: CHART_TEXT.secondary, fontSize: 11 } },
    tooltip: { ...tooltip(), trigger: 'item', formatter: (p) => `${p.seriesName}<br/><b>${p.data.raw} 项（${((p.data.raw / total) * 100).toFixed(1)}%）</b>` },
    xAxis: { type: 'value', max: 100, show: false },
    yAxis: { type: 'category', data: [''], show: false },
    series: parts.map((p, i) => ({
      name: p.name,
      type: 'bar',
      stack: 'all',
      barWidth: 16,
      data: [{ value: (p.value / total) * 100, raw: p.value }],
      itemStyle: {
        color: SERIES[i],
        borderColor: CHART_TEXT.surface,
        borderWidth: 2,
        borderRadius: i === 0 ? [4, 0, 0, 4] : i === parts.length - 1 ? [0, 4, 4, 0] : 0,
      },
    })),
  };
}
