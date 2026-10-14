// AI停止時でも動く、ルールベースの日本語条件抽出。
// 03spec.md 3.「AIを使う意味」の通り、ここでの抽出結果は確定ではなく、
// 画面上で利用者が確認・修正してから「仕入れ案を作る」に進む前提。

import { REGION_BROAD_OPTIONS, OSAKA_CITY_OPTIONS } from './data.js'

const UNIT_ALIASES = {
  'kg': 'kg', 'キロ': 'kg', 'きろ': 'kg',
  '個': '個', '玉': '個', '本': '本', '袋': '袋', '房': '房'
}

// 地域キーワードはdata.jsの選択肢(広域の目安+大阪府の市)と同じものを使う。
// 市区町村名は文字列が長い順に判定しないと、例えば「大阪市」が先に「大阪」を
// 含む他の候補より誤って短く一致することがあるため、長い順に並べ替える。
const REGION_KEYWORDS = [...REGION_BROAD_OPTIONS, ...OSAKA_CITY_OPTIONS]
  .sort((a, b) => b.length - a.length)

const OFFGRADE_YES_PATTERNS = [
  '形が悪くても', '形悪くても', '形不揃い', '不揃いでも', '不揃いOK', '不揃いok',
  '規格外可', '規格外もOK', '規格外もok', '訳あり可', '訳ありOK', '訳ありok',
  '多少形が悪くても'
]
const OFFGRADE_NO_PATTERNS = ['規格外不可', '通常品のみ', '形が揃った', '規格外不要']

function addDays(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function extractDate(text, today) {
  if (text.includes('明後日')) return { date: addDays(today, 2), label: '明後日' }
  if (text.includes('明日')) return { date: addDays(today, 1), label: '明日' }
  if (text.includes('今日')) return { date: addDays(today, 0), label: '今日' }
  if (text.includes('今週中')) return { date: addDays(today, 6), label: '今週中' }
  if (text.includes('来週')) return { date: addDays(today, 7), label: '来週' }

  const md = text.match(/(\d{1,2})月(\d{1,2})日/)
  if (md) {
    const year = today.getFullYear()
    const date = new Date(year, Number(md[1]) - 1, Number(md[2]))
    if (date < today) date.setFullYear(year + 1)
    return { date: date.toISOString().slice(0, 10), label: `${md[1]}月${md[2]}日` }
  }
  return { date: null, label: null }
}

function extractQuantity(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|キロ|きろ|個|玉|本|袋|房)/)
  if (!m) return { quantity: null, unit: null }
  return { quantity: Number(m[1]), unit: UNIT_ALIASES[m[2]] || m[2] }
}

function extractRegion(text) {
  for (const r of REGION_KEYWORDS) {
    if (text.includes(r)) return r
  }
  return null
}

function extractOffGrade(text) {
  if (OFFGRADE_NO_PATTERNS.some(p => text.includes(p))) return false
  if (OFFGRADE_YES_PATTERNS.some(p => text.includes(p))) return true
  return false // 指定なしは「含めない」を安全側のデフォルトにする（3.「配分では規格外可否の反映」参照）
}

// 自然文中に規格外の可否を示すキーワードが実際に含まれているか。
// 含まれていなければ「未指定」とみなし、呼び出し側で飲食店の既定値にフォールバックできるようにする。
export function offGradeMentioned(text) {
  const t = text || ''
  return OFFGRADE_YES_PATTERNS.some(p => t.includes(p)) || OFFGRADE_NO_PATTERNS.some(p => t.includes(p))
}

function extractPriceLimit(text) {
  const m = text.match(/(\d+)\s*円\s*(以内|まで)/)
  return m ? Number(m[1]) : null
}

// 生産者側は「予算の上限」ではなく「単価そのもの」を話す(例:「1キロ800円」)。
// 「以内/まで」を伴わない、最初の「数字+円」を単価として扱う。
function extractUnitPrice(text) {
  const m = text.match(/(\d+)\s*円(?!\s*(以内|まで))/)
  return m ? Number(m[1]) : null
}

function extractItem(text, knownItems) {
  const found = knownItems.find(name => name && text.includes(name))
  return found || null
}

/**
 * @param {string} text 自然文
 * @param {string[]} knownItems 現在登録されている品目名の一覧（照合用）
 * @param {Date} today 実行時点の日付（デモの再現性のため外から渡す）
 */
export function parseRequestText(text, knownItems, today = new Date()) {
  const trimmed = (text || '').trim()
  const { quantity, unit } = extractQuantity(trimmed)
  const { date, label } = extractDate(trimmed, today)
  return {
    rawText: trimmed,
    item: extractItem(trimmed, knownItems),
    quantity,
    unit,
    neededDate: date,
    neededDateLabel: label,
    region: extractRegion(trimmed),
    allowOffGrade: extractOffGrade(trimmed),
    priceLimit: extractPriceLimit(trimmed)
  }
}

/**
 * 生産者側(出品)用。「トマトが5キロ採れた。1キロ800円で明日出せる。大阪近郊で。」
 * のような自然文から、出品に必要な項目をまとめて抽出する。
 * @param {string} text 自然文
 * @param {string[]} knownItems 既存の品目名一覧(照合用)
 * @param {Date} today 実行時点の日付
 */
export function parseListingText(text, knownItems, today = new Date()) {
  const trimmed = (text || '').trim()
  const { quantity, unit } = extractQuantity(trimmed)
  const { date } = extractDate(trimmed, today)
  return {
    rawText: trimmed,
    item: extractItem(trimmed, knownItems),
    quantity,
    unit,
    availableDate: date,
    region: extractRegion(trimmed),
    unitPrice: extractUnitPrice(trimmed),
    isOffGrade: extractOffGrade(trimmed),
    offGradeReason: extractOffGrade(trimmed) ? offGradeReasonHint(trimmed) : ''
  }
}

function offGradeReasonHint(text) {
  if (text.includes('形')) return '形の不揃い'
  if (text.includes('サイズ') || text.includes('大きさ')) return 'サイズの不揃い'
  if (text.includes('傷') || text.includes('変色')) return '傷・変色'
  if (text.includes('余剰') || text.includes('余って')) return '余剰'
  return ''
}
