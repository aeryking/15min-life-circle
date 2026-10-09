import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { bd09ToGcj02, gcj02ToBd09 } from './coord.js';
import { centerUrl } from './icons.js';
import { pulseHtml } from './pulse.js';

/**
 * 开源底图适配器（未配置浏览器端 AK 时的降级方案）：Leaflet + 高德矢量瓦片（GCJ-02）。
 * 业务数据统一为 BD-09，这里在渲染与点击时做坐标换算，接口与 BaiduAdapter 完全一致。
 */
export class LeafletAdapter {
  constructor(el, center, zoom = 15) {
    this.kind = 'leaflet';
    const c = bd09ToGcj02(center);
    this.map = L.map(el, { zoomControl: false, attributionControl: true }).setView([c.lat, c.lng], zoom);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234',
      maxZoom: 19,
      attribution: '底图 © 高德地图',
    }).addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);
    this.layers = new Map();
    this.centerMarker = null;
  }

  #ll(p) {
    const g = bd09ToGcj02(p);
    return [g.lat, g.lng];
  }

  /** 开源底图的暗化由 CSS 滤镜完成（只作用于瓦片层），这里无需处理 */
  setTheme() {}

  onClick(cb) {
    this.map.on('click', (e) => cb(gcj02ToBd09({ lng: e.latlng.lng, lat: e.latlng.lat })));
  }

  setLayer(name, prims, visible = true) {
    this.clearLayer(name);
    const group = L.layerGroup(prims.map((p) => this.#create(p)).filter(Boolean));
    if (visible) group.addTo(this.map);
    this.layers.set(name, { group, visible });
  }

  clearLayer(name) {
    const l = this.layers.get(name);
    if (!l) return;
    l.group.remove();
    this.layers.delete(name);
  }

  setVisible(name, visible) {
    const l = this.layers.get(name);
    if (!l) return;
    l.visible = visible;
    if (visible) l.group.addTo(this.map);
    else l.group.remove();
  }

  setCenterMarker(p) {
    this.centerMarker?.remove();
    if (!p) return;
    this.centerMarker = L.marker(this.#ll(p), {
      icon: L.icon({ iconUrl: centerUrl(), iconSize: [34, 34], iconAnchor: [17, 17] }),
      interactive: false,
      zIndexOffset: 9999,
    }).addTo(this.map);
  }

  flyTo(p, zoom) {
    this.map.flyTo(this.#ll(p), zoom || this.map.getZoom(), { duration: 0.6 });
  }

  /** 容器尺寸变化（如收起左侧面板）后重新计算地图大小 */
  resize() {
    this.map.invalidateSize({ pan: false });
  }

  fitPoints(points, margin = 40) {
    if (!points.length) return;
    this.map.fitBounds(L.latLngBounds(points.map((p) => this.#ll(p))), { padding: [margin, margin], maxZoom: 16 });
  }

  openInfo(p, html) {
    L.popup({ offset: [0, -8] })
      .setLatLng(this.#ll(p))
      .setContent(`<div class="info-card">${html}</div>`)
      .openOn(this.map);
  }

  closeInfo() {
    this.map.closePopup();
  }

  #create(p) {
    if (p.kind === 'polygon') {
      const o = L.polygon(
        p.ring.map(([lng, lat]) => this.#ll({ lng, lat })),
        {
          color: p.stroke || 'transparent',
          weight: p.weight ?? 0,
          opacity: p.strokeOpacity ?? 1,
          fillColor: p.fill || 'transparent',
          fillOpacity: p.fillOpacity ?? 0,
          dashArray: p.dashed ? '6 6' : null,
          interactive: Boolean(p.info),
        },
      );
      if (p.info) o.bindPopup(`<div class="info-card">${p.info}</div>`);
      return o;
    }
    if (p.kind === 'circle') {
      return L.circle(this.#ll(p.center), {
        radius: p.radius,
        color: p.stroke,
        weight: p.weight ?? 1.5,
        opacity: p.strokeOpacity ?? 0.9,
        fillColor: p.fill || 'transparent',
        fillOpacity: p.fillOpacity ?? 0,
        dashArray: p.dashed ? '6 6' : null,
        interactive: false,
      });
    }
    if (p.kind === 'pulse') {
      const { w, h, ax, ay } = p.icon;
      const m = L.marker(this.#ll(p), {
        icon: L.divIcon({
          className: 'hl-pulse',
          html: pulseHtml(p.icon, p.color, ax ?? w / 2, ay ?? h),
          iconSize: [w, h],
          iconAnchor: [ax ?? w / 2, ay ?? h],
        }),
        title: p.title || '',
        zIndexOffset: p.zIndex || 0,
      });
      if (p.info) m.bindPopup(`<div class="info-card">${p.info}</div>`);
      return m;
    }
    if (p.kind === 'marker') {
      const { url, w, h, ax, ay } = p.icon;
      const m = L.marker(this.#ll(p), {
        icon: L.icon({ iconUrl: url, iconSize: [w, h], iconAnchor: [ax ?? w / 2, ay ?? h] }),
        title: p.title || '',
        zIndexOffset: p.zIndex || 0,
      });
      if (p.info) m.bindPopup(`<div class="info-card">${p.info}</div>`);
      return m;
    }
    return null;
  }
}
