// 「おまかせフードロス救済」提案ロジック。
// 期限間近(鮮度期限まで既定1日以内)の余剰を、近隣(半径10km、位置情報が無ければ地域名)かつ
// 規格外許容条件に合う飲食店へ提案候補として並べる。品目を問わない「おまかせ」なので、
// 通常の仕入れマッチング(matching.js)とは異なり品目の一致は条件にしない。

import { locationCompatible, hasCoords } from './matching.js'
import { distanceKm } from './geo.js'
import { computeExpiryDate, daysUntil } from './freshness.js'

// 鮮度期限までこの日数以内(0=当日まで、1=明日まで)を「間もなく期限」として提案対象にする。
export const RESCUE_THRESHOLD_DAYS = 1

/**
 * @param {any[]} producers 登録済みの出品一覧
 * @param {{region?:string, lat?:number, lng?:number, defaultAllowOffGrade?:boolean}|null} restaurantProfile
 * @param {Date} today
 */
export function buildRescueSuggestions(producers, restaurantProfile, today = new Date()) {
  const allowOffGrade = !!restaurantProfile?.defaultAllowOffGrade
  const viewpoint = {
    region: restaurantProfile?.preferredRegion || null,
    lat: restaurantProfile?.lat ?? null,
    lng: restaurantProfile?.lng ?? null
  }

  return (producers || [])
    .filter(farm => farm.available !== false && farm.quantity > 0)
    .filter(farm => !farm.isOffGrade || allowOffGrade)
    .filter(farm => locationCompatible(viewpoint, farm))
    .map(farm => {
      const expiryDate = farm.expiryDate || computeExpiryDate(farm.availableDate, farm.item)
      return {
        farm,
        expiryDate,
        daysLeft: daysUntil(expiryDate, today),
        distanceKm: (hasCoords(viewpoint) && hasCoords(farm)) ? distanceKm(viewpoint.lat, viewpoint.lng, farm.lat, farm.lng) : null
      }
    })
    .filter(s => s.daysLeft !== null && s.daysLeft >= 0 && s.daysLeft <= RESCUE_THRESHOLD_DAYS)
    .sort((a, b) => (a.daysLeft - b.daysLeft) || ((a.distanceKm ?? 999) - (b.distanceKm ?? 999)))
}
