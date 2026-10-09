/* global BMapGL */
import { centerUrl } from './icons.js';
import { pulseHtml, transparentIcon } from './pulse.js';

/** 暗黑底图个性化样式（JS API GL styleJson） */
const c = (hex) => `${hex}ff`;
const DARK_STYLE = [
  ['land', 'geometry', '#111722'],
  ['water', 'geometry', '#0b1a2c'],
  ['green', 'geometry', '#12211c'],
  ['building', 'geometry.fill', '#1d2533'],
  ['building', 'geometry.stroke', '#262f3f'],
  ['manmade', 'geometry', '#161d29'],
  ['education', 'geometry', '#171f2c'],
  ['medical', 'geometry', '#171f2c'],
  ['scenicspots', 'geometry', '#142019'],
  ['highway', 'geometry.fill', '#3a4458'],
  ['highway', 'geometry.stroke', '#161c26'],
  ['arterial', 'geometry.fill', '#2c3546'],
  ['arterial', 'geometry.stroke', '#1a202c'],
  ['local', 'geometry.fill', '#252d3c'],
  ['local', 'geometry.stroke', '#161c26'],
  ['cityhighway', 'geometry.fill', '#2a3242'],
  ['cityhighway', 'geometry.stroke', '#161c26'],
  ['nationalway', 'geometry.fill', '#2a3242'],
  ['nationalway', 'geometry.stroke', '#161c26'],
  ['provincialway', 'geometry.fill', '#2a3242'],
  ['provincialway', 'geometry.stroke', '#161c26'],
  ['tertiaryway', 'geometry.fill', '#2a3242'],
  ['tertiaryway', 'geometry.stroke', '#161c26'],
  ['fourlevelway', 'geometry.fill', '#2a3242'],
  ['fourlevelway', 'geometry.stroke', '#161c26'],
  ['scenicspotsway', 'geometry.fill', '#2a3242'],
  ['scenicspotsway', 'geometry.stroke', '#161c26'],
  ['universityway', 'geometry.fill', '#2a3242'],
  ['universityway', 'geometry.stroke', '#161c26'],
  ['vacationway', 'geometry.fill', '#2a3242'],
  ['vacationway', 'geometry.stroke', '#161c26'],
  ['roadarrow', 'labels.icon', null],
  ['railway', 'geometry', '#2f3848'],
  ['subway', 'geometry', '#2a3242'],
  ['road', 'labels.text.fill', '#8d98aa'],
  ['road', 'labels.text.stroke', '#111722'],
  ['poilabel', 'labels.text.fill', '#8d98aa'],
  ['poilabel', 'labels.text.stroke', '#111722'],
  ['poilabel', 'labels.icon', null],
  ['districtlabel', 'labels.text.fill', '#aab4c3'],
  ['districtlabel', 'labels.text.stroke', '#111722'],
  ['town', 'labels.text.fill', '#aab4c3'],
  ['village', 'labels.text.fill', '#8d98aa'],
].map(([featureType, elementType, color]) => ({
  featureType,
  elementType,
  stylers: color ? { visibility: 'on', color: c(color) } : { visibility: 'off' },
}));

/** 动态加载百度地图 JS API GL */
export function loadBaiduGL(ak, timeoutMs = 12000) {
  if (window.BMapGL?.Map) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cb = `__bmapReady_${Date.now()}`;
    const timer = setTimeout(() => reject(new Error('百度地图脚本加载超时')), timeoutMs);
    window[cb] = () => {
      clearTimeout(timer);
      resolve();
    };
    const s = document.createElement('script');
    s.src = `https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${encodeURIComponent(ak)}&callback=${cb}`;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('百度地图脚本加载失败'));
    };
    document.head.appendChild(s);
  });
}

/**
 * 百度地图适配器。统一的图元（primitive）接口：
 *  polygon { rings, fill, fillOpacity, stroke, strokeOpacity, weight, dashed }
 *  circle  { center, radius, ... }
 *  marker  { lng, lat, icon: { url, w, h, ax, ay }, title, info, zIndex }
 */
export class BaiduAdapter {
  constructor(el, center, zoom = 15) {
    this.kind = 'baidu';
    this.map = new BMapGL.Map(el, { enableMapClick: false });
    this.map.centerAndZoom(new BMapGL.Point(center.lng, center.lat), zoom);
    this.map.enableScrollWheelZoom(true);
    this.map.addControl(new BMapGL.ScaleControl({ anchor: window.BMAP_ANCHOR_BOTTOM_LEFT }));
    this.map.addControl(new BMapGL.ZoomControl({ anchor: window.BMAP_ANCHOR_BOTTOM_RIGHT }));
    this.layers = new Map();
    this.centerMarker = null;
  }

  /** 切换底图明暗：暗黑模式使用个性化样式，浅色模式恢复默认 */
  setTheme(t) {
    try {
      this.map.setMapStyleV2({ styleJson: t === 'dark' ? DARK_STYLE : [] });
    } catch {
      // 旧版本不支持个性化样式时保持默认底图
    }
  }

  onClick(cb) {
    this.map.addEventListener('click', (e) => {
      if (e.overlay) return;
      cb({ lng: e.latlng.lng, lat: e.latlng.lat });
    });
  }

  setLayer(name, prims, visible = true) {
    this.clearLayer(name);
    const overlays = [];
    for (const p of prims) {
      // 一个图元可能对应多个覆盖物（脉冲标记 = 透明点击标记 + DOM 动画）
      for (const o of [].concat(this.#create(p) || [])) {
        this.map.addOverlay(o);
        if (!visible) o.hide?.();
        overlays.push(o);
      }
    }
    this.layers.set(name, { overlays, visible });
  }

  clearLayer(name) {
    const l = this.layers.get(name);
    if (!l) return;
    l.overlays.forEach((o) => this.map.removeOverlay(o));
    this.layers.delete(name);
  }

  setVisible(name, visible) {
    const l = this.layers.get(name);
    if (!l) return;
    l.visible = visible;
    l.overlays.forEach((o) => (visible ? o.show?.() : o.hide?.()));
  }

  setCenterMarker(p) {
    if (this.centerMarker) this.map.removeOverlay(this.centerMarker);
    if (!p) return;
    const icon = new BMapGL.Icon(centerUrl(), new BMapGL.Size(34, 34), { anchor: new BMapGL.Size(17, 17) });
    this.centerMarker = new BMapGL.Marker(new BMapGL.Point(p.lng, p.lat), { icon, enableClicking: false });
    this.centerMarker.setZIndex(9999);
    this.map.addOverlay(this.centerMarker);
  }

  flyTo(p, zoom) {
    const pt = new BMapGL.Point(p.lng, p.lat);
    if (zoom) this.map.centerAndZoom(pt, zoom);
    else this.map.panTo(pt);
  }

  /** 容器尺寸变化（如收起左侧面板）后重新计算地图大小 */
  resize() {
    if (typeof this.map.checkResize === 'function') this.map.checkResize();
    else if (typeof this.map.resize === 'function') this.map.resize();
    else window.dispatchEvent(new Event('resize'));
  }

  fitPoints(points, margin = 40) {
    if (!points.length) return;
    const pts = points.map((p) => new BMapGL.Point(p.lng, p.lat));
    const view = this.map.getViewport(pts, { margins: [margin, margin, margin, margin] });
    this.map.centerAndZoom(view.center, Math.min(16, view.zoom));
  }

  openInfo(p, html) {
    const iw = new BMapGL.InfoWindow(`<div class="info-card">${html}</div>`, { width: 0, height: 0, offset: new BMapGL.Size(0, -8), enableAutoPan: true });
    this.map.openInfoWindow(iw, new BMapGL.Point(p.lng, p.lat));
  }

  closeInfo() {
    this.map.closeInfoWindow();
  }

  #create(p) {
    if (p.kind === 'polygon') {
      const pts = p.ring.map(([lng, lat]) => new BMapGL.Point(lng, lat));
      const o = new BMapGL.Polygon(pts, {
        strokeColor: p.stroke || 'transparent',
        strokeWeight: p.weight ?? 0,
        strokeOpacity: p.strokeOpacity ?? 1,
        fillColor: p.fill || 'transparent',
        fillOpacity: p.fillOpacity ?? 0,
        strokeStyle: p.dashed ? 'dashed' : 'solid',
        enableMassClear: false,
        enableClicking: Boolean(p.info),
      });
      if (p.info) o.addEventListener('click', (e) => this.openInfo(e.latLng || e.latlng || p.anchor, p.info));
      return o;
    }
    if (p.kind === 'circle') {
      return new BMapGL.Circle(new BMapGL.Point(p.center.lng, p.center.lat), p.radius, {
        strokeColor: p.stroke,
        strokeWeight: p.weight ?? 1.5,
        strokeOpacity: p.strokeOpacity ?? 0.9,
        fillColor: p.fill || 'transparent',
        fillOpacity: p.fillOpacity ?? 0,
        strokeStyle: p.dashed ? 'dashed' : 'solid',
        enableClicking: false,
      });
    }
    if (p.kind === 'pulse') {
      // WebGL 画布上的标记无法做 CSS 动画：画一个同尺寸的透明标记承接点击，动画用 DOM 自定义覆盖物叠加（不拦截鼠标事件）
      if (typeof BMapGL.CustomOverlay !== 'function') return this.#create({ ...p, kind: 'marker' });
      const { w, h, ax, ay } = p.icon;
      const hit = this.#create({ ...p, kind: 'marker', icon: { ...p.icon, url: transparentIcon(w, h) } });
      const dom = new BMapGL.CustomOverlay(
        () => {
          const el = document.createElement('div');
          el.className = 'hl-pulse hl-pulse-bmap';
          el.innerHTML = pulseHtml({ ...p.icon, ax: ax ?? w / 2, ay: ay ?? h }, p.color);
          return el;
        },
        { point: new BMapGL.Point(p.lng, p.lat), offsetX: 0, offsetY: 0 },
      );
      return [hit, dom];
    }
    if (p.kind === 'marker') {
      const { url, w, h, ax, ay } = p.icon;
      const icon = new BMapGL.Icon(url, new BMapGL.Size(w, h), { anchor: new BMapGL.Size(ax ?? w / 2, ay ?? h) });
      const m = new BMapGL.Marker(new BMapGL.Point(p.lng, p.lat), { icon, title: p.title || '' });
      if (p.zIndex) m.setZIndex(p.zIndex);
      if (p.info) m.addEventListener('click', () => this.openInfo(p, p.info));
      return m;
    }
    return null;
  }
}
