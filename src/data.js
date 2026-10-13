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

// 飲食店側③(AI整理結果の確認・修正)の品目プルダウンに出す候補。
// 登録済みの品目(knownItemNames)と合わせて重複排除した上で表示する。
export const VEGETABLE_OPTIONS = [
  'トマト', 'なす', '賀茂なす', 'きゅうり', 'ねぎ', '万願寺とうがらし',
  'ピーマン', 'じゃがいも', '玉ねぎ', 'ほうれん草', 'オクラ'
]

// 広域の目安(ざっくり選びたい場合)。マッチングでは文字列の部分一致で比較するため、
// 「大阪市内」を選んでも後述の大阪市の出品と一致する。
export const REGION_BROAD_OPTIONS = ['大阪近郊', '大阪市内', '北摂', '能勢', '京都']

// 大阪府内の全33市(町村は含まない)。受取希望エリアを市区町村レベルで指定したい場合に使う。
export const OSAKA_CITY_OPTIONS = [
  '大阪市', '堺市', '岸和田市', '豊中市', '池田市', '吹田市', '泉大津市', '高槻市',
  '貝塚市', '守口市', '枚方市', '茨木市', '八尾市', '泉佐野市', '富田林市', '寝屋川市',
  '河内長野市', '松原市', '大東市', '和泉市', '箕面市', '柏原市', '羽曳野市', '門真市',
  '摂津市', '高石市', '藤井寺市', '東大阪市', '泉南市', '四條畷市', '交野市',
  '大阪狭山市', '阪南市'
]

export function buildDefaultRequestText() {
  return '明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK'
}
