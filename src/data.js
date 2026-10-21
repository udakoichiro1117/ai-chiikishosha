// デモ用の初期データ。仕様書8.「課題が解けた瞬間」のA/B/C農家をそのまま再現する。
// 日付は実行日を基準にした相対日付（明後日）で生成し、いつ実行しても成立するようにする。

// このファイルはクライアント(ユーザーのブラウザ、実質JST)とサーバー(api/listings.js経由、
// Vercelの既定タイムゾーンは協定世界時)の両方から呼ばれる。実行環境のローカルタイムゾーンに
// 依存すると、JST深夜〜朝(UTCではまだ前日)の時間帯にサーバー側だけ「今日」が1日ずれ、
// サーバー側で生成した出品の出荷可能日と、api/parse.js(こちらは常にJSTで解決する)が
// 読み取った希望日が食い違ってマッチしなくなる。api/parse.jsと同じ方式で、常に日本時間の
// 「今日」を基準にする。
function todayJstStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

// 上記のtodayJstStr()で得た「年-月-日」に対して、実行環境のタイムゾーンに影響されない
// UTC日付演算で日数を加算する(Dateオブジェクトのローカルgetter/setterを使うと、結局
// 実行環境のタイムゾーンに逆戻りしてしまうため)。
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export const DEMO_REGION = '大阪近郊'
export const DEMO_LOCATION = '大阪近郊の共通受渡拠点P'
export const DEMO_TIME = '10:00〜11:00'

export function buildDefaultProducers() {
  const today = todayJstStr()
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

// 飲食店側のデモ文は、生産者側のデモ出品(buildDefaultProducers)と同じ値から
// 組み立てる。別々に書くと、片方だけ数量や品目を変えたときに嚙み合わなくなるため。
export function buildDefaultRequestText() {
  const producers = buildDefaultProducers()
  const totalQuantity = producers.reduce((sum, p) => sum + p.quantity, 0)
  const { item, unit, region } = producers[0]
  const offGradeNote = producers.some((p) => p.isOffGrade) ? '、多少形が悪くてもOK' : ''
  return `明後日までに${region}の${item}を${totalQuantity}${unit}${offGradeNote}`
}
