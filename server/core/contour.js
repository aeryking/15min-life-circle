import { contours } from 'd3-contour';

/**
 * 规则网格 → 等值面（GeoJSON），基于 marching squares（d3-contour）。
 *
 * 网格约定：values[i + j * nx] 位于局部坐标 (x0 + i·cell, y0 + j·cell)，j 自南向北。
 * d3-contour 把索引 i 的样本放在坐标 i + 0.5 处，这里据此换算回经纬度。
 */
export function createGrid(extent, cell) {
  const nx = Math.ceil((2 * extent) / cell) + 1;
  const ny = nx;
  const x0 = -((nx - 1) * cell) / 2;
  const y0 = x0;
  return { nx, ny, x0, y0, cell };
}

export function gridPoint(grid, i, j) {
  return { x: grid.x0 + i * grid.cell, y: grid.y0 + j * grid.cell };
}

/**
 * 求「值 ≤ threshold」的区域。
 * @param {Float64Array|number[]} values
 * @param {number[]} thresholds
 * @param {(x:number,y:number)=>{lng:number,lat:number}} toLngLat
 * @returns {Array<{threshold:number, geometry: {type:'MultiPolygon', coordinates:any}}>}
 */
export function contourBelow(grid, values, thresholds, toLngLat) {
  const { nx, ny } = grid;
  // 取负号把「≤ t」转换为 d3 的「≥ -t」；外圈填充极大值，保证等值面在网格内闭合
  const neg = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      neg[i + j * nx] = edge ? -1e9 : -values[i + j * nx];
    }
  }
  const gen = contours()
    .size([nx, ny])
    .thresholds(thresholds.map((t) => -t));
  return gen(neg).map((g, idx) => ({
    threshold: thresholds[idx],
    geometry: {
      type: 'MultiPolygon',
      coordinates: g.coordinates.map((poly) =>
        poly.map((ring) =>
          ring.map(([gx, gy]) => {
            const p = toLngLat(grid.x0 + (gx - 0.5) * grid.cell, grid.y0 + (gy - 0.5) * grid.cell);
            return [p.lng, p.lat];
          }),
        ),
      ),
    },
  }));
}

/** 只保留满足条件的多边形分量（如：包含中心点或包含实测可达采样点） */
export function filterPolygons(geometry, keep) {
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.filter((poly) => keep(poly)) };
}
