// デモ用の初期データ。仕様書8.「課題が解けた瞬間」のA/B/C農家をそのまま再現する。
// 日付は実行日を基準にした相対日付（明後日）で生成し、いつ実行しても成立するようにする。

function addDays(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const DEMO_REGION = '大阪近郊'
export const DEMO_LOCATION = '大阪近郊の共通受渡拠点P'
export const DEMO_TIME = '10:00〜11:00'

export function buildDefaultProducers() {
  const today = new Date()
  const dayAfterTomorrow = addDays(today, 2)

  return [
    {
      id: 'A',
      farmName: 'A農家',
      item: 'トマト',
      unit: 'kg',
      quantity: 5,
      unitPrice: 600,
      isOffGrade: false,
      offGradeReason: '',
      availableDate: dayAfterTomorrow,
      region: DEMO_REGION,
      deliveryLocation: DEMO_LOCATION,
      deliveryTime: DEMO_TIME,
      minQuantity: 1,
      incrementStep: 1,
      deliveryFee: 0,
      available: true
    },
    {
      id: 'B',
      farmName: 'B農家',
      item: 'トマト',
      unit: 'kg',
      quantity: 3,
      unitPrice: 550,
      isOffGrade: false,
      offGradeReason: '',
      availableDate: dayAfterTomorrow,
      region: DEMO_REGION,
      deliveryLocation: DEMO_LOCATION,
      deliveryTime: DEMO_TIME,
      minQuantity: 1,
      incrementStep: 1,
      deliveryFee: 0,
      available: true
    },
    {
      id: 'C',
      farmName: 'C農家',
      item: 'トマト',
      unit: 'kg',
      quantity: 2,
      unitPrice: 350,
      isOffGrade: true,
      offGradeReason: '形の不揃い',
      availableDate: dayAfterTomorrow,
      region: DEMO_REGION,
      deliveryLocation: DEMO_LOCATION,
      deliveryTime: DEMO_TIME,
      minQuantity: 1,
      incrementStep: 1,
      deliveryFee: 0,
      available: true
    }
  ]
}

export function buildDefaultRequestText() {
  return '明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK'
}
