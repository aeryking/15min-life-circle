/**
 * 浏览器定位（Geolocation API）的中英双语提示。
 *
 * 电脑没有 GPS：浏览器把请求交给操作系统定位服务（macOS / Windows），
 * 主要依据附近 Wi-Fi 热点推算位置，精度通常为几十到几百米；没有 Wi-Fi 时可能退化为按网络粗略定位，误差可达数公里。
 */

/** 定位失败的提示：{ zh, en }；err 为 GeolocationPositionError，或 { code: 'unsupported' | 'insecure' | 'convert' } */
export function geoErrorMessage(err = {}) {
  // 保留浏览器原始报错便于排查：中文说明用全角括号，英文说明用半角括号
  const raw = err.message ? `（${err.message}）` : '';
  const rawEn = err.message ? ` (${err.message})` : '';
  switch (err.code) {
    case 'unsupported':
      return {
        zh: '当前浏览器不支持定位，请直接在地图上点击选点。',
        en: 'This browser does not support geolocation. Please click on the map to pick a location.',
      };
    case 'insecure':
      return {
        zh: '当前地址不是安全来源，浏览器禁止定位。请用 https 或 http://localhost 打开页面，或直接在地图上点选。',
        en: 'Geolocation requires a secure origin (https or localhost). Please reopen the page securely, or click on the map.',
      };
    case 'convert':
      return {
        zh: `已获取位置，但坐标转换失败，请稍后重试或在地图上点选。${raw}`,
        en: `Location obtained, but coordinate conversion failed. Please retry or click on the map.${rawEn}`,
      };
    case 1: // PERMISSION_DENIED
      return {
        zh: '定位权限被拒绝。请点击地址栏左侧的图标，把「位置」改为允许后重试；Mac 还需在「系统设置 → 隐私与安全性 → 定位服务」中允许当前浏览器。',
        en: `Location permission denied. Allow location access for this site, and on macOS enable Location Services for this browser in System Settings → Privacy & Security.${rawEn}`,
      };
    case 2: // POSITION_UNAVAILABLE
      return {
        zh: '暂时无法获取位置。电脑主要靠附近的 Wi-Fi 推算位置，请确认已打开 Wi-Fi 和系统定位服务后重试，或直接在地图上点选。',
        en: `Position unavailable. Computers locate mainly via nearby Wi-Fi; make sure Wi-Fi and system Location Services are on, then retry, or click on the map.${rawEn}`,
      };
    case 3: // TIMEOUT
      return {
        zh: '定位超时，10 秒内没有拿到结果。请重试，或直接在地图上点选。',
        en: `Location request timed out after 10 seconds. Please retry, or click on the map.${rawEn}`,
      };
    default:
      return {
        zh: `定位失败，请重试或直接在地图上点选。${raw}`,
        en: `Failed to get location. Please retry, or click on the map.${rawEn}`,
      };
  }
}

/** 定位成功时的精度说明（accuracy 为米，浏览器给出的 95% 置信半径） */
export function accuracyNote(accuracy) {
  if (!Number.isFinite(accuracy)) return '';
  const m = accuracy >= 1000 ? `${(accuracy / 1000).toFixed(1)} 公里` : `${Math.round(accuracy)} 米`;
  if (accuracy <= 300) return `定位精度约 ±${m}（由附近 Wi-Fi 推算），请在地图上核对位置。`;
  if (accuracy <= 1500) return `定位精度约 ±${m}，偏差可能较大，建议在地图上点选确认。`;
  return `定位精度约 ±${m}，只是按网络粗略估计的位置，建议直接在地图上点选。`;
}
