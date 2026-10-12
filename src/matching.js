// 配分ロジック（03spec.md 3.「実装範囲：A」「配分では…」/ 5.イレギュラーケース 準拠）。
// AIは候補作成の補助であり、数量・在庫・単位・条件の正しさはすべてここ（通常ロジック）で検証する。

function regionCompatible(requestRegion, farmRegion) {
  if (!requestRegion) return true // 指定なしは絞り込まない
  if (!farmRegion) return false
  return farmRegion.includes(requestRegion) || requestRegion.includes(farmRegion)
}

function dateCompatible(requestDate, farmDate) {
  if (!requestDate || !farmDate) return false
  return farmDate === requestDate
}

// 候補農家ごとに「組み合わせに使ってよい数量」の取り得る値を列挙する（最低販売量・販売刻みを守る）。
function possibleContributions(farm) {
  const values = []
  const min = Math.max(farm.minQuantity || 0, 0)
  const step = farm.incrementStep && farm.incrementStep > 0 ? farm.incrementStep : 1
  for (let q = min > 0 ? min : step; q <= farm.quantity + 1e-9; q += step) {
    values.push(Number(q.toFixed(3)))
  }
  if (values.length === 0 && farm.quantity > 0) values.push(farm.quantity)
  return values
}

function classifyExclusion(request, farm) {
  if (farm.available === false) return '欠品・出荷停止中'
  if (farm.item !== request.item) return '品目が異なる'
  if (farm.unit !== request.unit) return '数量単位が異なる'
  if (farm.quantity <= 0) return '在庫なし'
  if (!dateCompatible(request.neededDate, farm.availableDate)) return '希望日と出荷可能日が異なる'
  if (!regionCompatible(request.region, farm.region)) return '地域が条件外'
  if (farm.isOffGrade && !request.allowOffGrade) return '規格外不可のため除外'
  return null
}

export function computeAllocation(request, producers) {
  if (!request.item || !request.quantity || !request.unit || !request.neededDate) {
    return {
      status: 'empty',
      message: '品目・数量・希望日を入力してください。'
    }
  }

  const exclusions = []
  const eligible = []
  for (const farm of producers) {
    const reason = classifyExclusion(request, farm)
    if (reason) exclusions.push({ farm, reason })
    else eligible.push(farm)
  }

  if (eligible.length === 0) {
    return {
      status: 'no_candidates',
      message: '条件に合う登録がありません。',
      exclusions
    }
  }

  // 全候補を使い切った場合に届く最大量（組み合わせ探索の上限チェック用）
  const maxReachable = eligible.reduce((sum, f) => sum + f.quantity, 0)

  // 候補数が少ない前提（デモ規模）で全組み合わせを列挙し、各組み合わせ内で
  // 「ちょうど希望数量になる」配分があるかを総当たりで探す。
  const combos = []
  const n = eligible.length
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(eligible[i])
    combos.push(subset)
  }

  let bestExact = null
  for (const subset of combos) {
    const perFarmOptions = subset.map(possibleContributions)
    const picks = new Array(subset.length).fill(0)

    const search = (idx, remaining) => {
      if (idx === subset.length) {
        if (Math.abs(remaining) < 1e-6) {
          const allocation = subset.map((farm, i) => ({ farm, amount: picks[i] }))
          const totalPrice = allocation.reduce((s, a) => s + a.amount * a.farm.unitPrice, 0)
          const candidate = { allocation, totalPrice, farmCount: allocation.length }
          if (!bestExact) bestExact = candidate
          else if (candidate.farmCount < bestExact.farmCount) bestExact = candidate
          else if (candidate.farmCount === bestExact.farmCount && candidate.totalPrice < bestExact.totalPrice) bestExact = candidate
        }
        return
      }
      for (const v of perFarmOptions[idx]) {
        if (v - remaining > 1e-6) continue // 使いすぎ防止(枝刈り)
        picks[idx] = v
        search(idx + 1, remaining - v)
      }
      picks[idx] = 0
    }

    search(0, request.quantity)
  }

  if (bestExact) {
    return {
      status: 'success',
      allocation: bestExact.allocation,
      totalQuantity: request.quantity,
      totalPrice: bestExact.totalPrice,
      deliveryLocation: bestExact.allocation[0].farm.deliveryLocation,
      deliveryTime: bestExact.allocation[0].farm.deliveryTime,
      neededDate: request.neededDate,
      exclusions
    }
  }

  if (maxReachable < request.quantity) {
    return {
      status: 'insufficient',
      message: `希望${request.quantity}${request.unit}に対し、条件の合う登録数量は${maxReachable}${request.unit}。${(request.quantity - maxReachable).toFixed(2).replace(/\.00$/, '')}${request.unit}不足`,
      maxReachable,
      eligible,
      exclusions
    }
  }

  // 合計は足りているが、最低販売量・販売刻みの制約で「ちょうど」を作れない場合
  return {
    status: 'step_mismatch',
    message: '数量単位・販売刻みの都合で、希望数量ちょうどの組み合わせを作れません。',
    maxReachable,
    eligible,
    exclusions
  }
}

export function describeInventoryDiff(prevSnapshot, currentProducers) {
  const notices = []
  for (const prev of prevSnapshot) {
    const current = currentProducers.find(p => p.id === prev.id)
    if (!current) continue
    if (prev.available !== false && current.available === false) {
      notices.push(`${current.farmName}の${prev.quantity}${current.unit}が出荷不可。`)
    } else if (current.quantity !== prev.quantity) {
      notices.push(`${current.farmName}が${prev.quantity}${current.unit}→${current.quantity}${current.unit}。`)
    }
  }
  return notices
}
