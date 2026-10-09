/**
 * 脉冲高亮标记的 DOM 结构（两种底图共用，样式见 styles.css 中的 .hl-*）。
 * 以「地面点」为原点：两圈波纹以原点为中心扩散，图钉尖端落在原点上。
 * originLeft / originTop 为原点在容器内的位置（Leaflet 图标容器有尺寸，百度自定义覆盖物容器为 0×0）。
 */
export function pulseHtml({ url, w, h, ax, ay }, color, originLeft = 0, originTop = 0) {
  const ax0 = ax ?? w / 2;
  const ay0 = ay ?? h;
  return (
    `<span class="hl-origin" style="left:${originLeft}px;top:${originTop}px;--hl-c:${color}">` +
    '<span class="hl-ripple"></span><span class="hl-ripple hl-ripple-2"></span>' +
    `<img class="hl-pin" src="${url}" alt="" width="${w}" height="${h}" style="left:${-ax0}px;top:${-ay0}px" draggable="false" />` +
    '</span>'
  );
}

/** 与图钉同尺寸的透明图片：百度底图下垫在动画下方，承接点击（弹出信息窗） */
export function transparentIcon(w, h) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`)}`;
}
