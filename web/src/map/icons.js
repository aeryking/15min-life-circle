/** 地图标记图标（SVG），颜色 + 图标 + 名称三重编码，颜色从不单独承载含义 */

const enc = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function pinSvg(color, emoji, { size = 30, ring = '#ffffff' } = {}) {
  const h = Math.round(size * 1.25);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 30 37.5">
  <path d="M15 36.5c-.6 0-1-.3-1.3-.8C9.6 29.8 3 23.4 3 15a12 12 0 1 1 24 0c0 8.4-6.6 14.8-10.7 20.7-.3.5-.7.8-1.3.8z" fill="${color}" stroke="${ring}" stroke-width="2"/>
  <circle cx="15" cy="15" r="8.6" fill="#ffffff"/>
  <text x="15" y="19.2" font-size="11.5" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text>
</svg>`;
}

export const pinUrl = (color, emoji, opts) => enc(pinSvg(color, emoji, opts));

export function dotSvg(color, r = 5, { stroke = '#ffffff', opacity = 1 } = {}) {
  const s = r * 2 + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${r}" fill="${color}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/></svg>`;
}

export const dotUrl = (color, r, opts) => enc(dotSvg(color, r, opts));

export function centerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
  <circle cx="17" cy="17" r="15" fill="#1c5cab" fill-opacity="0.18"/>
  <circle cx="17" cy="17" r="8" fill="#1c5cab" stroke="#fff" stroke-width="3"/>
</svg>`;
}

export function starSvg(color = '#eb6834') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="16" fill="#ffffff" stroke="${color}" stroke-width="2.5"/>
  <path d="M18 7.5l3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5.1-4.9 7-1z" fill="${color}"/>
</svg>`;
}

export const centerUrl = () => enc(centerSvg());
export const starUrl = (c) => enc(starSvg(c));
