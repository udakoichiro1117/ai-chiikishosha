// 住所→緯度経度の変換(国土地理院 AddressSearch API、無料・APIキー不要・CORS許可済み)と、
// 2地点間の距離計算(ハーバサイン公式)。地図描画はまだ行わず、距離によるマッチング絞り込みのみに使う。

export async function geocodeAddress(address) {
  const text = (address || '').trim()
  if (!text) return null
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(text)}`, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const list = await res.json()
    const first = Array.isArray(list) ? list[0] : null
    const coords = first?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) return null
    const [lng, lat] = coords
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    return { lat, lng }
  } catch (e) {
    return null
  }
}

const EARTH_RADIUS_KM = 6371

export function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}
