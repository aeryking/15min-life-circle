/** 体检结果 → GeoJSON FeatureCollection（可直接导入 QGIS / ArcGIS / geojson.io） */
export function toGeoJSON(a) {
  const features = [];
  for (const [profile, geometry] of Object.entries(a.isochrone.polygons)) {
    features.push({
      type: 'Feature',
      properties: { layer: 'isochrone', profile, minutes: a.params.minutes, areaM2: a.isochrone.metrics.areas[profile] },
      geometry,
    });
  }
  for (const b of a.isochrone.bands) features.push({ type: 'Feature', properties: { layer: 'band', minutes: b.minutes }, geometry: b.geometry });
  for (const [key, c] of Object.entries(a.blind.categories)) {
    features.push({ type: 'Feature', properties: { layer: 'blindspot', category: key, name: c.name, blindRatio: c.blindRatio }, geometry: c.geometry });
    if (c.hiddenGeometry?.coordinates?.length) {
      features.push({ type: 'Feature', properties: { layer: 'hidden_blindspot', category: key, name: `${c.name}（隐性盲区）` }, geometry: c.hiddenGeometry });
    }
  }
  for (const p of a.pois) {
    features.push({
      type: 'Feature',
      properties: { layer: 'poi', category: p.category, name: p.name, walk: p.walk, measured: p.walkMeasured, sources: p.sources.join(',') },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    });
  }
  for (const s of a.siting) {
    s.sites.forEach((site, i) =>
      features.push({
        type: 'Feature',
        properties: { layer: 'recommendation', category: s.category, rank: i + 1, address: site.address },
        geometry: { type: 'Point', coordinates: [site.lng, site.lat] },
      }),
    );
  }
  return {
    type: 'FeatureCollection',
    name: a.name,
    crs: { type: 'name', properties: { name: 'BD-09 (Baidu)' } },
    features,
  };
}
