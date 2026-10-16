// 仕入れ依頼(Order)の共有ストレージ。api/listings.jsと同じVercel Blob方式(1件=1ファイル)。
//
// 1件の依頼が複数農家の出品にまたがる場合がある(matching.jsの複数農家合成)ため、
// 承認/却下はlines配列の「農家(listingId)ごと」に行う。注文全体の状態は保存せず、
// クライアント側でlinesから導出する(二重管理による不整合を避けるため)。
//
// 「所有権」はownerId(端末ごとの匿名UUID)の一致だけで確認する簡易なもの。
// パスワード等を伴う本人認証ではない(api/listings.jsと同じ制約)。
//
// 在庫の事前予約はスコープ外: 依頼(POST)の時点ではlistingsのquantityを一切変更せず、
// 生産者が承認(PATCH status:'accepted')した瞬間にだけ該当listingのquantityを減らす。
// 却下時は何もしない(最初から確保していないため)。承認取消による在庫復元も今回は対象外。

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

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const role = String(req.query?.role || '')
      const ownerId = String(req.query?.ownerId || '')
      const all = await readAllOrders()
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
        lines: body.lines.map((l) => ({
          listingId: l.listingId,
          ownerId: l.ownerId,
          farmName: String(l.farmName || ''),
          item: l.item,
          amount: l.amount,
          unitPrice: Number(l.unitPrice || 0),
          status: 'pending'
        })),
        createdAt: new Date().toISOString()
      }
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
      const status = String(body.status || '')
      if (!['accepted', 'rejected'].includes(status)) { res.status(400).json({ error: 'invalid status' }); return }

      const order = await readJson(orderPathFor(id))
      if (!order) { res.status(404).json({ error: 'not found' }); return }
      const line = order.lines.find((l) => l.listingId === listingId)
      if (!line) { res.status(404).json({ error: 'line not found' }); return }
      if (line.ownerId !== ownerId) { res.status(403).json({ error: 'ownerId mismatch' }); return }

      line.status = status
      await writeJson(orderPathFor(id), order)

      if (status === 'accepted') {
        const listing = await readJson(listingPathFor(listingId))
        if (listing) {
          listing.quantity = Math.max(0, listing.quantity - line.amount)
          await writeJson(listingPathFor(listingId), listing)
        }
      }
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
