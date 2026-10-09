import { SERIES, CHART_TEXT, SEQUENTIAL, STATUS } from '../../utils/theme.js';

/**
 * 多社区对比看板的图表配置（dataviz 规范）：
 * - 社区数量可达 10 个，超出分类色板上限，因此「社区身份」一律用名称直接标注 + 焦点高亮，
 *   不给每个社区分配颜色；颜色只承担「量级」（热力矩阵）或「焦点 / 非焦点」两种职责；
 * - 热力矩阵为单色相顺序色阶，格内同时写出原始值，颜色从不单独承载信息。
 */

const tip = () => ({
  backgroundColor: CHART_TEXT.tooltipBg,
  borderColor: CHART_TEXT.axis,
  borderWidth: 1,
  textStyle: { color: CHART_TEXT.primary, fontSize: 12 },
  extraCssText: 'box-shadow: 0 4px 16px rgb(0 0 0 / 18%); border-radius: 8px;',
});

/** 去掉省市前缀，便于在图上直接标注 */
export const shortName = (n) =>
  String(n || '')
    .replace(/^(.{2,3}?省)?(.{2,4}?市)?(.{2,4}?(区|县))?/, '')
    .slice(0, 10) || String(n).slice(-8);

const fmt = (v, m) => (v === null || v === undefined ? '–' : Number(v).toFixed(m?.digits ?? 0));

/** 列内优劣度（0–1）：「分」类指标使用 0–100 绝对刻度，其余在所选社区间相对归一 */
export function goodness(rows, metric) {
  const vals = rows.map((r) => r.values[metric.key]).filter((v) => v !== null && v !== undefined);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (v) => {
    if (v === null || v === undefined) return null;
    let g;
    if (metric.unit === '分') g = v / 100;
    else if (max === min) g = 0.5;
    else g = (v - min) / (max - min);
    if (metric.better === 'low' && metric.unit !== '分') g = 1 - g;
    return Math.max(0, Math.min(1, g));
  };
}

function rampColor(g) {
  const i = Math.round(g * (SEQUENTIAL.length - 1));
  return SEQUENTIAL[i];
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** ① 排名赛道：按所选指标排序的横向条形，焦点社区高亮，第一名加奖杯标注 */
export function rankingOption(rows, metric, focusId) {
  const sorted = [...rows]
    .filter((r) => r.values[metric.key] !== null)
    .sort((a, b) => (metric.better === 'low' ? a.values[metric.key] - b.values[metric.key] : b.values[metric.key] - a.values[metric.key]));
  return {
    animationDuration: 600,
    grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tip(), trigger: 'item', formatter: (p) => `${p.data.full}<br/><b>${p.value}${metric.unit}</b>（第 ${p.dataIndex + 1} 名）` },
    xAxis: {
      type: 'value',
      splitNumber: 4,
      splitLine: { lineStyle: { color: CHART_TEXT.grid } },
      axisLabel: { color: CHART_TEXT.muted, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: sorted.map((r, i) => `${i === 0 ? '🏆 ' : `${i + 1}. `}${r.label || shortName(r.name)}`),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_TEXT.axis } },
      axisLabel: { color: CHART_TEXT.secondary, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        barWidth: 12,
        data: sorted.map((r) => ({
          value: r.values[metric.key],
          id: r.id,
          full: r.fullLabel || r.name,
          itemStyle: { color: r.id === focusId ? SERIES[1] : SERIES[0], borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: 'right', color: CHART_TEXT.secondary, fontSize: 11, formatter: (p) => `${p.value}${metric.unit}` },
      },
    ],
  };
}

/** ② 体检热力矩阵：社区 × 指标，颜色 = 列内优劣度，格内写原始值 */
export function heatmapOption(rows, metrics, focusId) {
  const data = [];
  metrics.forEach((m, x) => {
    const g = goodness(rows, m);
    rows.forEach((r, y) => {
      const v = r.values[m.key];
      const gv = g(v);
      const bg = gv === null ? CHART_TEXT.grid : rampColor(gv);
      const dark = luminance(bg) < 0.3;
      data.push({
        value: [x, y, gv === null ? '-' : Math.round(gv * 100)],
        raw: v,
        metric: m,
        name: r.fullLabel || r.name,
        cid: r.id,
        itemStyle: { color: bg, borderColor: r.id === focusId ? SERIES[1] : CHART_TEXT.surface, borderWidth: r.id === focusId ? 2.5 : 2 },
        label: { color: dark ? '#ffffff' : '#0f172a' },
      });
    });
  });
  return {
    animationDuration: 500,
    tooltip: {
      ...tip(),
      formatter: (p) =>
        `${p.data.name}<br/>${p.data.metric.group} · ${p.data.metric.name}：<b>${fmt(p.data.raw, p.data.metric)} ${p.data.metric.unit}</b><br/><span style="opacity:.7">${p.data.metric.better === 'low' ? '越小越好' : '越大越好'} · 优劣度 ${p.value[2]}</span>`,
    },
    grid: { left: 8, right: 8, top: 44, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      position: 'top',
      data: metrics.map((m) => m.name),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: CHART_TEXT.secondary, fontSize: 11, interval: 0, width: 50, overflow: 'break', lineHeight: 14 },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => r.label || shortName(r.name)),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { color: CHART_TEXT.primary, fontSize: 12, fontWeight: 500 },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: { show: true, fontSize: 10.5, formatter: (p) => fmt(p.data.raw, p.data.metric) },
        emphasis: { itemStyle: { borderColor: SERIES[1], borderWidth: 2.5 } },
      },
    ],
  };
}

/** ③ 象限气泡图：两个可选指标构成四象限，气泡大小 = 设施总数，均值线分隔象限 */
export function quadrantOption(rows, mx, my, focusId) {
  const pts = rows.filter((r) => r.values[mx.key] !== null && r.values[my.key] !== null);
  const avg = (k) => pts.reduce((s, r) => s + r.values[k], 0) / Math.max(1, pts.length);
  const sizes = pts.map((r) => r.values.poiTotal || 0);
  const smax = Math.max(1, ...sizes);
  // 「越小越好」的指标反转坐标轴，保证右上角永远是优质象限、左下角永远是待改造象限
  const invX = mx.better === 'low';
  const invY = my.better === 'low';
  const corner = (pos, text, color) => ({
    type: 'text',
    ...pos,
    z: 10,
    style: { text, fill: color, font: '600 12px "PingFang SC", "Microsoft YaHei", sans-serif', opacity: 0.9 },
  });
  const axis = (m, inv) => ({
    inverse: inv,
    scale: true,
    splitLine: { lineStyle: { color: CHART_TEXT.grid } },
    axisLine: { lineStyle: { color: CHART_TEXT.axis } },
    axisLabel: { color: CHART_TEXT.muted, fontSize: 11 },
    name: `${m.name}${m.unit ? `（${m.unit}）` : ''} · ${m.better === 'low' ? '越小越好' : '越大越好'}`,
    nameLocation: 'middle',
    nameTextStyle: { color: CHART_TEXT.secondary, fontSize: 12 },
  });
  return {
    animationDuration: 700,
    grid: { left: 58, right: 28, top: 20, bottom: 50 },
    tooltip: {
      ...tip(),
      formatter: (p) =>
        `${p.data.full}<br/>${mx.name}：<b>${p.value[0]}${mx.unit}</b><br/>${my.name}：<b>${p.value[1]}${my.unit}</b><br/>设施总数：${p.value[2]} 处`,
    },
    xAxis: { ...axis(mx, invX), nameGap: 30 },
    yAxis: { ...axis(my, invY), nameGap: 40 },
    graphic: [corner({ right: 40, top: 28 }, '✦ 优质生活圈', STATUS.good), corner({ left: 70, bottom: 62 }, '▲ 优先改造', STATUS.critical)],
    series: [
      {
        type: 'scatter',
        data: pts.map((r) => ({
          value: [r.values[mx.key], r.values[my.key], r.values.poiTotal || 0],
          id: r.id,
          full: r.fullLabel || r.name,
          name: r.label || shortName(r.name),
          symbolSize: 14 + 30 * Math.sqrt((r.values.poiTotal || 0) / smax),
          itemStyle: {
            color: r.id === focusId ? SERIES[1] : SERIES[0],
            opacity: r.id === focusId ? 0.95 : 0.72,
            borderColor: CHART_TEXT.surface,
            borderWidth: 2,
          },
        })),
        label: { show: true, position: 'top', color: CHART_TEXT.primary, fontSize: 11, formatter: (p) => p.data.name },
        labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: CHART_TEXT.muted, type: 'solid', width: 1, opacity: 0.6 },
          label: { show: false },
          data: [{ xAxis: Math.round(avg(mx.key) * 100) / 100 }, { yAxis: Math.round(avg(my.key) * 100) / 100 }],
        },
      },
    ],
  };
}

/** ④ 最近设施步行时间分布：每类设施一行，每个社区一个点，超过 15 分钟的区域加底色 */
export function dotStripOption(rows, metrics, focusId, limitMinutes = 15) {
  const cats = metrics.filter((m) => m.group === '最近设施步行');
  const n = rows.length;
  const data = [];
  cats.forEach((m, ci) => {
    rows.forEach((r, ri) => {
      const v = r.values[m.key];
      if (v === null) return;
      const jitter = n > 1 ? (ri / (n - 1) - 0.5) * 0.5 : 0;
      data.push({
        value: [Math.min(v, 45), ci + jitter],
        raw: v,
        cat: m.name,
        full: r.fullLabel || r.name,
        cid: r.id,
        symbolSize: r.id === focusId ? 14 : 9,
        itemStyle: { color: r.id === focusId ? SERIES[1] : SERIES[0], opacity: r.id === focusId ? 1 : 0.7, borderColor: CHART_TEXT.surface, borderWidth: 1.5 },
      });
    });
  });
  return {
    animationDuration: 600,
    grid: { left: 8, right: 24, top: 20, bottom: 36, containLabel: true },
    tooltip: {
      ...tip(),
      formatter: (p) => `${p.data.full}<br/>最近${p.data.cat}：<b>${p.data.raw} 分钟</b>${p.data.raw > limitMinutes ? ' ⚠️ 超出 15 分钟' : ''}`,
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 45,
      name: '成年人步行分钟',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: CHART_TEXT.secondary, fontSize: 12 },
      axisLine: { onZero: false, lineStyle: { color: CHART_TEXT.axis } },
      splitLine: { lineStyle: { color: CHART_TEXT.grid } },
      axisLabel: { color: CHART_TEXT.muted, fontSize: 11, formatter: (v) => (v === 45 ? '45+' : v) },
    },
    yAxis: {
      type: 'value',
      min: -0.5,
      max: cats.length - 0.5,
      inverse: true,
      splitLine: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      // 行标签只放在整数位置（每类设施一行）
      axisLabel: { color: CHART_TEXT.secondary, fontSize: 12, customValues: cats.map((_, i) => i), formatter: (v) => cats[Math.round(v)]?.name ?? '' },
    },
    series: [
      {
        type: 'scatter',
        data,
        markArea: {
          silent: true,
          itemStyle: { color: STATUS.critical, opacity: 0.07 },
          label: { show: true, position: 'insideTopRight', color: STATUS.critical, fontSize: 11, formatter: '超出 15 分钟生活圈' },
          data: [[{ xAxis: limitMinutes }, { xAxis: 45 }]],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: STATUS.critical, type: 'solid', width: 1.5, opacity: 0.7 },
          label: { color: STATUS.critical, fontSize: 11, formatter: '15 分钟' },
          data: [{ xAxis: limitMinutes }],
        },
      },
    ],
  };
}

/**
 * 雷达标题显示完整社区名：区分后缀（如「（中精度）」）单独成行，
 * 名称本身超过一行宽度时再按字数折行，避免把后缀拆开。
 */
function wrapName(n, per = 18) {
  const m = String(n).match(/^(.*?)(（[^（）]*）)?$/);
  const base = m[1];
  const lines = [];
  for (let i = 0; i < base.length; i += per) lines.push(base.slice(i, i + per));
  if (m[2]) lines.push(m[2]);
  return lines.join('\n');
}

/** ⑤ 六维雷达小多图：每个社区一个雷达（成年人 / 老年人 / 亲子三条线），便于比较「形状」 */
export function radarWallOption(rows, focusId, cols = 5) {
  const n = rows.length;
  const rowsN = Math.ceil(n / cols);
  const colsN = Math.min(cols, n);
  const radars = [];
  const series = [];
  const titles = [];
  rows.forEach((r, i) => {
    const cx = ((i % colsN) + 0.5) / colsN;
    const cy = (Math.floor(i / colsN) + 0.6) / rowsN;
    const center = [`${(cx * 100).toFixed(1)}%`, `${(cy * 100).toFixed(1)}%`];
    radars.push({
      center,
      radius: rowsN > 1 ? '20%' : '32%',
      indicator: r.dimensions.map((d) => ({ name: d.name.slice(0, 2), max: 100 })),
      axisName: { color: CHART_TEXT.muted, fontSize: 10 },
      splitNumber: 3,
      splitLine: { lineStyle: { color: CHART_TEXT.grid } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: CHART_TEXT.grid } },
    });
    titles.push({
      text: `${wrapName(r.fullLabel || r.name)}\n{score|${r.score} 分}`,
      left: `${(cx * 100).toFixed(1)}%`,
      top: `${((Math.floor(i / colsN) / rowsN) * 100 + 1).toFixed(1)}%`,
      textAlign: 'center',
      textStyle: {
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 16,
        color: r.id === focusId ? SERIES[1] : CHART_TEXT.primary,
        rich: { score: { fontSize: 13, fontWeight: 700, lineHeight: 18, color: r.id === focusId ? SERIES[1] : SERIES[0] } },
      },
    });
    series.push({
      type: 'radar',
      radarIndex: i,
      symbol: 'none',
      data: [
        {
          name: '成年人',
          value: r.dimensions.map((d) => d.score),
          lineStyle: { width: 2, color: SERIES[0] },
          areaStyle: { color: SERIES[0], opacity: 0.18 },
          itemStyle: { color: SERIES[0] },
        },
        { name: '老年人', value: r.elderlyDimensions.map((d) => d.score), lineStyle: { width: 1.5, color: SERIES[1] }, itemStyle: { color: SERIES[1] } },
        ...(r.childDimensions?.length
          ? [{ name: '亲子', value: r.childDimensions.map((d) => d.score), lineStyle: { width: 1.5, color: SERIES[2] }, itemStyle: { color: SERIES[2] } }]
          : []),
      ],
    });
  });
  return {
    animationDuration: 600,
    legend: {
      bottom: 0,
      data: ['成年人', '老年人', '亲子'],
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 4,
      textStyle: { color: CHART_TEXT.secondary, fontSize: 12 },
    },
    tooltip: { ...tip(), trigger: 'item' },
    title: titles,
    radar: radars,
    series,
  };
}
