// 品目カテゴリ別の鮮度期限(出荷可能日からの日数)。
// 「葉物は当日〜翌日、果菜類は2〜3日」という一般的な目安に基づく簡易テーブル。
// 個別の正確な保存条件までは扱わず、おまかせ救済タブの優先順位づけの目安として使う。

const LEAFY_ITEMS = ['ねぎ', 'ほうれん草'] // 葉物:当日〜翌日(1日)
const ROOT_OR_BULB_ITEMS = ['じゃがいも', '玉ねぎ'] // 根菜・土物:日持ちしやすい(10日)
// それ以外(トマト・なす・きゅうり等の果菜類)は既定で2〜3日の目安とする

const SHELF_LIFE_DAYS = { leafy: 1, root: 10, fruit: 3 }

export function getFreshnessCategory(item) {
  if (LEAFY_ITEMS.includes(item)) return 'leafy'
  if (ROOT_OR_BULB_ITEMS.includes(item)) return 'root'
  return 'fruit'
}

export function getShelfLifeDays(item) {
  return SHELF_LIFE_DAYS[getFreshnessCategory(item)]
}

function formatLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 出荷可能日 + 品目ごとの鮮度日数 = 鮮度期限(この日まではおいしく食べられる目安)。
export function computeExpiryDate(availableDate, item) {
  if (!availableDate) return null
  const d = new Date(`${availableDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + getShelfLifeDays(item))
  return formatLocalDate(d)
}

// 今日から見て鮮度期限まで残り何日か(0=今日まで、負の値=期限切れ)。
export function daysUntil(dateStr, today = new Date()) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diffMs = target.getTime() - base.getTime()
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}
