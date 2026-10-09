/** BD-09 ↔ GCJ-02 换算（开源底图模式使用高德瓦片，需把百度坐标转换为 GCJ-02 显示） */
const X_PI = (Math.PI * 3000.0) / 180.0;

export function bd09ToGcj02({ lng, lat }) {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}

export function gcj02ToBd09({ lng, lat }) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}
