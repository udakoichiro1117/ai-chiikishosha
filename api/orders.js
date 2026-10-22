// 仕入れ依頼(Order)の共有ストレージ。api/listings.jsと同じVercel Blob方式(1件=1ファイル)。
//
// 1件の依頼が複数農家の出品にまたがる場合がある(matching.jsの複数農家合成)ため、
// 承認/却下はlines配列の「農家(listingId)ごと」に行う。注文全体の状態は保存せず、
// クライアント側でlinesから導出する(二重管理による不整合を避けるため)。
//
// 「所有権」はownerId(端末ごとの匿名UUID)の一致だけで確認する簡易なもの。
// パスワード等を伴う本人認証ではない(api/listings.jsと同じ制約)。
//
// 出品側のstockStatusが'confirmed'(収穫済み・在庫確定)の場合は、飲食店が依頼した瞬間に
// 承認待ちを挟まず即座にaccepted扱いにする(中央卸売市場で即決済できることとの差を縮めるため)。
// 'estimated'(見込み・未収穫)はこれまで通りpendingから始まり、生産者の承認/却下を待つ。
// 承認待ちのまま応答が無い場合に無期限に待たされないよう、依頼側が指定したresponseDeadline
// を過ぎたpending lineはGET時に自動で'expired'にする(lazy expiry。cron等の追加インフラなし)。
// 在庫減算は、確定品の即時accepted・人間による承認のどちらでも同じ処理(applyAcceptedLine)を使う。

import { put, get, list, del } from '@vercel/blob'

const ORDER_PREFIX = 'orders/'
const LISTING_PREFIX = 'listings/' // api/listings.jsと同じパス形式(ここが一致していないと連携できない)

function orderPathFor(id) {
  return `${ORDER_PREFIX}${id}.json`
}
function listingPathFor(id) {
  return `${LISTING_PREFIX}${id}.json`
}

async function readJson(pathname) {
  // useCache:falseでCDNキャッシュを経由させず常に最新を読む(在庫の正しさに直結するため)。
  const result = await get(pathname, { access: 'private', useCache: false })
  if (!result) return null
  const text = await new Response(result.stream).text()
  return JSON.parse(text)
}

async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  })
}

async function readAllOrders() {
  const { blobs } = await list({ prefix: ORDER_PREFIX })
  const items = await Promise.all(blobs.map((b) => readJson(b.pathname)))
  return items.filter(Boolean)
}

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return false
  return lines.every((l) =>
    typeof l.listingId === 'string' && l.listingId &&
    typeof l.ownerId === 'string' && l.ownerId &&
    typeof l.item === 'string' && l.item &&
    typeof l.amount === 'number' && l.amount > 0
  )
}

// lineをacceptedにし、対応する出品のquantityをその場で減算する。
// 出品側の即時確定(POST)と、生産者による人間の承認(PATCH)の両方から呼ばれる。
async function applyAcceptedLine(line) {
  line.status = 'accepted'
  const listing = await readJson(listingPathFor(line.listingId))
  if (listing) {
    listing.quantity = Math.max(0, listing.quantity - line.amount)
    await writeJson(listingPathFor(line.listingId), listing)
  }
}

// pendingのまま応答期限(responseDeadline)を過ぎたlineを'expired'にする。
// 変更があった場合はtrueを返す(呼び出し側で書き戻すかどうかの判断に使う)。
function expirePendingLines(order, now) {
  if (!order.responseDeadline) return false
  const deadline = new Date(order.responseDeadline).getTime()
  if (Number.isNaN(deadline) || now < deadline) return false
  let changed = false
  for (const line of order.lines) {
    if (line.status === 'pending') {
      line.status = 'expired'
      changed = true
    }
  }
  return changed
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const role = String(req.query?.role || '')
      const ownerId = String(req.query?.ownerId || '')
      const all = await readAllOrders()
      const now = Date.now()
      await Promise.all(
        all.map((o) => {
          if (expirePendingLines(o, now)) return writeJson(orderPathFor(o.id), o)
          return null
        })
      )
      const orders = role === 'producer'
        ? all.filter((o) => o.lines.some((l) => l.ownerId === ownerId))
        : all.filter((o) => o.requesterId === ownerId)
      res.status(200).json({ orders })
      return
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const requesterId = String(body.requesterId || '')
      if (!requesterId) { res.status(400).json({ error: 'requesterId is required' }); return }
      if (!validateLines(body.lines)) { res.status(400).json({ error: 'lines is invalid' }); return }

      const id = `O${Date.now()}${Math.random().toString(36).slice(2, 8)}`
      const order = {
        id,
        requesterId,
        requesterName: String(body.requesterName || ''),
        neededDate: String(body.neededDate || ''),
        unit: String(body.unit || 'kg'),
        totalQuantity: Number(body.totalQuantity || 0),
        totalPrice: Number(body.totalPrice || 0),
        responseDeadline: String(body.responseDeadline || ''),
        lines: body.lines.map((l) => ({
          listingId: l.listingId,
          ownerId: l.ownerId,
          farmName: String(l.farmName || ''),
          item: l.item,
          amount: l.amount,
          unitPrice: Number(l.unitPrice || 0),
          deliveryMethod: ['deliver', 'pickup', 'hub', 'discuss'].includes(l.deliveryMethod) ? l.deliveryMethod : 'pickup',
          deliveryLocation: String(l.deliveryLocation || ''),
          deliveryTime: String(l.deliveryTime || ''),
          status: 'pending'
        })),
        createdAt: new Date().toISOString()
      }

      // 出品側が「収穫済み・在庫確定」なら、承認待ちを挟まずこの場で確定させる
      // (中央卸売市場で即決済できることとの差を縮めるため)。
      await Promise.all(
        order.lines.map(async (line) => {
          const listing = await readJson(listingPathFor(line.listingId))
          if (listing?.stockStatus === 'confirmed') await applyAcceptedLine(line)
        })
      )

      await writeJson(orderPathFor(id), order)
      res.status(201).json({ order })
      return
    }

    const id = String(req.query?.id || '')
    if (!id) { res.status(400).json({ error: 'id is required' }); return }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      const ownerId = String(body.ownerId || '')
      const listingId = String(body.listingId || '')

      const order = await readJson(orderPathFor(id))
      if (!order) { res.status(404).json({ error: 'not found' }); return }
      // 期限切れの反映を先に適用してから判定する(期限切れ後の承認/却下を弾くため)。
      if (expirePendingLines(order, Date.now())) await writeJson(orderPathFor(id), order)
      const line = order.lines.find((l) => l.listingId === listingId)
      if (!line) { res.status(404).json({ error: 'line not found' }); return }
      if (line.ownerId !== ownerId) { res.status(403).json({ error: 'ownerId mismatch' }); return }

      // action:'amend' は、承認後に天候等で実際に用意できる量が減った場合の事後修正。
      // 在庫(listingのquantity)には触れない(承認時点で既に見積もり分を確保済みの扱いのため、
      // ここで戻すと「実際には無い在庫」が再び売り物として出てしまう)。減額のみ許可し、
      // 増額(＝見積もりより多く用意できた、は別の問題なので対象外)は弾く。
      if (body.action === 'amend') {
        if (line.status !== 'accepted') { res.status(409).json({ error: `line is ${line.status}, not accepted` }); return }
        const currentAmount = line.amendedAmount ?? line.amount
        const newAmount = Number(body.newAmount)
        const reason = String(body.reason || '')
        if (!(newAmount >= 0) || !(newAmount < currentAmount)) { res.status(400).json({ error: 'newAmount must be a non-negative number less than the current amount' }); return }
        if (!reason) { res.status(400).json({ error: 'reason is required' }); return }
        line.amendedAmount = newAmount
        line.amendedReason = reason
        line.amendedAt = new Date().toISOString()
        await writeJson(orderPathFor(id), order)
        res.status(200).json({ order })
        return
      }

      const status = String(body.status || '')
      if (!['accepted', 'rejected'].includes(status)) { res.status(400).json({ error: 'invalid status' }); return }
      if (line.status !== 'pending') { res.status(409).json({ error: `line is already ${line.status}` }); return }

      if (status === 'accepted') await applyAcceptedLine(line)
      else line.status = 'rejected'
      await writeJson(orderPathFor(id), order)
      res.status(200).json({ order })
      return
    }

    if (req.method === 'DELETE') {
      const ownerId = String(req.query?.ownerId || '')
      const order = await readJson(orderPathFor(id))
      if (!order) { res.status(404).json({ error: 'not found' }); return }
      if (order.requesterId !== ownerId) { res.status(403).json({ error: 'ownerId mismatch' }); return }
      await del(orderPathFor(id))
      res.status(204).end()
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[api/orders] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
