<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="mini" role="img" :aria-label="`${r.name} 等时圈与服务盲区示意图`">
    <rect :width="W" :height="H" fill="#f7f8fb" />
    <path v-for="(b, i) in bands" :key="`b${i}`" :d="b" fill="#2a78d6" fill-opacity="0.1" />
    <path v-if="blind" :d="blind" fill="#5b6472" fill-opacity="0.45" />
    <circle :cx="W / 2" :cy="H / 2" :r="circleR" fill="none" stroke="#8391a7" stroke-dasharray="5 4" stroke-width="1.2" />
    <path v-if="child" :d="child" fill="none" :stroke="PROFILE_COLORS.child" stroke-width="2" />
    <path :d="elderly" fill="none" :stroke="PROFILE_COLORS.elderly" stroke-width="2" />
    <path :d="adult" fill="none" :stroke="PROFILE_COLORS.adult" stroke-width="2.5" />
    <g v-for="p in pois" :key="p.id">
      <circle :cx="p.x" :cy="p.y" r="3.2" :fill="p.color" stroke="#fff" stroke-width="1" />
    </g>
    <g v-for="(s, i) in sites" :key="`s${i}`">
      <circle :cx="s.x" :cy="s.y" r="7" fill="#fff" stroke="#eb6834" stroke-width="2" />
      <text :x="s.x" :y="s.y + 3.5" text-anchor="middle" font-size="9" fill="#eb6834">★</text>
    </g>
    <circle :cx="W / 2" :cy="H / 2" r="5" fill="#1c5cab" stroke="#fff" stroke-width="2" />
    <g class="scale">
      <line :x1="16" :y1="H - 16" :x2="16 + scalePx" :y2="H - 16" stroke="#475569" stroke-width="2" />
      <text :x="16" :y="H - 22" font-size="10" fill="#475569">500 m</text>
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue';
import { PALETTES } from '../utils/theme.js';

// 报告示意图是「纸张」上的内容，两种主题下都使用浅色配色
const PROFILE_COLORS = PALETTES.light.profiles;
const DIMENSION_COLORS = PALETTES.light.dimensions;
import { toXY } from '../utils/geo.js';

const props = defineProps({ r: { type: Object, required: true }, categories: { type: Array, default: () => [] } });
const W = 520;
const H = 400;
const extent = computed(() => Math.max(...props.r.isochrone.metrics.thresholds.map((t) => t.meters)) * 1.15);
const k = computed(() => H / 2 / extent.value);
const px = (p) => {
  const { x, y } = toXY(props.r.center, p);
  return { x: W / 2 + x * k.value, y: H / 2 - y * k.value };
};
const path = (geom) =>
  (geom?.coordinates || [])
    .map((poly) =>
      poly
        .map(
          (ring) =>
            ring
              .map(([lng, lat], i) => {
                const q = px({ lng, lat });
                return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
              })
              .join('') + 'Z',
        )
        .join(''),
    )
    .join('');
const bands = computed(() =>
  [...props.r.isochrone.bands]
    .filter((b) => b.minutes <= props.r.params.minutes)
    .sort((a, b) => b.minutes - a.minutes)
    .map((b) => path(b.geometry)),
);
const adult = computed(() => path(props.r.isochrone.polygons.adult));
const elderly = computed(() => path(props.r.isochrone.polygons.elderly));
const child = computed(() => path(props.r.isochrone.polygons.child));
const blind = computed(() => path(props.r.blind.union.geometry));
const circleR = computed(() => props.r.isochrone.metrics.thresholds.find((t) => t.key === 'adult').meters * k.value);
const scalePx = computed(() => 500 * k.value);
const dims = computed(() => Object.fromEntries(props.categories.map((c) => [c.key, c.dimension])));
const pois = computed(() =>
  props.r.pois
    .filter((p) => ['market', 'pharmacy', 'primary_school'].includes(p.category))
    .map((p) => ({ id: p.id, ...px(p), color: DIMENSION_COLORS[dims.value[p.category]] || '#475569' }))
    .filter((p) => p.x > 0 && p.x < W && p.y > 0 && p.y < H),
);
const sites = computed(() => props.r.siting.map((s) => px(s.sites[0])));
</script>

<style scoped>
.mini {
  width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
</style>
