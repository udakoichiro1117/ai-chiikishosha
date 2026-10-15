// 仕入れ案の「地図で見る」用。Leaflet + OpenStreetMap(無料・APIキー不要)。
// 位置情報(緯度経度)が揃っている場合のみ呼び出される前提(main.js側で判定)。

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Vite経由のビルドではLeafletのデフォルトアイコンの相対パス解決が壊れるため、
// バンドルされた実URLを明示的に設定する(Leaflet+Viteの定番の対処)。
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
})

let mapInstance = null

/**
 * @param {string} containerId 地図を描画するdiv要素のid(事前にDOMへ挿入されていること)
 * @param {{center:{lat:number,lng:number}, centerLabel:string, radiusKm:number, farms:{farmName:string, lat:number, lng:number, distanceKm?:number}[]}} opts
 */
export function renderResultMap(containerId, opts) {
  const el = document.getElementById(containerId)
  if (!el) return

  if (mapInstance) {
    try { mapInstance.remove() } catch (e) { /* 既にDOMごと破棄済みの場合は無視 */ }
    mapInstance = null
  }

  const { center, centerLabel, radiusKm, farms } = opts
  const map = L.map(el).setView([center.lat, center.lng], 12)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map)

  L.marker([center.lat, center.lng]).addTo(map).bindPopup(`📍 ${centerLabel}(受取地点)`)
  L.circle([center.lat, center.lng], {
    radius: radiusKm * 1000,
    color: '#2f6f4f',
    weight: 1,
    fillOpacity: 0.06
  }).addTo(map)

  const bounds = [[center.lat, center.lng]]
  farms.forEach(f => {
    if (typeof f.lat !== 'number' || typeof f.lng !== 'number') return
    const distanceLabel = typeof f.distanceKm === 'number' ? `約${f.distanceKm.toFixed(1)}km` : ''
    L.marker([f.lat, f.lng]).addTo(map).bindPopup(`${f.farmName}${distanceLabel ? `(${distanceLabel})` : ''}`)
    bounds.push([f.lat, f.lng])
  })
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30] })

  mapInstance = map
}

export function destroyResultMap() {
  if (!mapInstance) return
  try { mapInstance.remove() } catch (e) { /* no-op */ }
  mapInstance = null
}
