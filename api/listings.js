// 出品一覧(producers)の共有ストレージ。Vercel Blob(出品1件=1ファイル)を使う理由:
// ・作成は独立したファイル書き込みなので、他の出品との競合が起きない
// ・更新/削除も対象ファイルのみを触るため、同時書き込みのレースを実質回避できる
// ・この規模(小規模な実証運用)でSQLのスキーマ移行を持ち込む必要がない
//
// 「所有権」はownerId(端末ごとの匿名UUID、main.js側で生成)の一致だけで確認する簡易なもの。
// パスワード等を伴う本人認証ではない点に注意(03spec.mdのスコープ外。将来の課題として別途)。

import { put, get, list, del } from '@vercel/blob'
import { buildDefaultProducers } from '../src/data.js'
import { computeExpiryDate } from '../src/freshness.js'

// ストアはprivateアクセスで作成済み(ダッシュボード操作不要でCLIから作れるのはprivateのみのため)。
// private blobの読み取りはpublic URLへの素のfetchでは出来ないので、必ずget()をaccess:'private'で使う。
const PREFIX = 'listings/'
const SEED_OWNER = 'seed'

function pathFor(id) {
  return `${PREFIX}${id}.json`
}

async function readListing(pathname) {
  // useCache:falseでCDNキャッシュを経由させず常に最新を読む(在庫の正しさに直結するため)。
  const result = await get(pathname, { access: 'private', useCache: false })
  if (!result) return null
  const text = await new Response(result.stream).text()
  return JSON.parse(text)
}

async function readAllListings() {
  const { blobs } = await list({ prefix: PREFIX })
  const items = await Promise.all(blobs.map((b) => readListing(b.pathname)))
  return items.filter(Boolean)
}

// ストアが空(=このプロジェクトで誰も出品したことがない)の場合のみ、
// 03spec.mdのデモシナリオ(A/B/C農家・トマト5,350円)を1回だけ投入する。
// ownerIdを実デバイスのUUIDと衝突しない'seed'にするため、以後は通常のUIからは編集・削除できない。
async function seedIfEmpty() {
  const { blobs } = await list({ prefix: PREFIX, limit: 1 })
  if (blobs.length > 0) return
  const demo = buildDefaultProducers()
  await Promise.all(
    demo.map((p) => {
      // デモのA/B/C農家は「共通受渡拠点」想定(元々の03spec.mdのデモ設定)なので、既定はpickupにする。
      const listing = { ...p, ownerId: SEED_OWNER, deliveryMethod: 'pickup', expiryDate: computeExpiryDate(p.availableDate, p.item) }
      return put(pathFor(p.id), JSON.stringify(listing), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json'
      })
    })
  )
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      await seedIfEmpty()
      const listings = await readAllListings()
      res.status(200).json({ listings })
      return
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const ownerId = String(body.ownerId || '')
      if (!ownerId) { res.status(400).json({ error: 'ownerId is required' }); return }
      if (typeof body.item !== 'string' || !body.item) { res.status(400).json({ error: 'item is required' }); return }
      if (typeof body.quantity !== 'number' || !(body.quantity > 0)) { res.status(400).json({ error: 'quantity must be a positive number' }); return }
      if (!['deliver', 'pickup'].includes(body.deliveryMethod)) { res.status(400).json({ error: 'deliveryMethod must be deliver or pickup' }); return }

      const id = `L${Date.now()}${Math.random().toString(36).slice(2, 8)}`
      const listing = {
        id,
        ownerId,
        farmName: String(body.farmName || '新規農家'),
        lat: typeof body.lat === 'number' ? body.lat : null,
        lng: typeof body.lng === 'number' ? body.lng : null,
        item: body.item,
        availableDate: String(body.availableDate || ''),
        region: body.region ?? null,
        unit: String(body.unit || 'kg'),
        quantity: body.quantity,
        unitPrice: Number(body.unitPrice || 0),
        isOffGrade: !!body.isOffGrade,
        offGradeReason: String(body.offGradeReason || ''),
        deliveryMethod: body.deliveryMethod,
        deliveryLocation: String(body.deliveryLocation || ''),
        deliveryTime: String(body.deliveryTime || ''),
        minQuantity: Number(body.minQuantity || 1),
        incrementStep: Number(body.incrementStep || 1),
        deliveryFee: Number(body.deliveryFee || 0),
        available: true,
        expiryDate: computeExpiryDate(String(body.availableDate || ''), body.item)
      }
      await put(pathFor(id), JSON.stringify(listing), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json'
      })
      res.status(201).json({ listing })
      return
    }

    const id = String(req.query?.id || '')
    if (!id) { res.status(400).json({ error: 'id is required' }); return }

    if (req.method === 'PATCH') {
      const body = req.body || {}
      const ownerId = String(body.ownerId || '')
      const current = await readListing(pathFor(id))
      if (!current) { res.status(404).json({ error: 'not found' }); return }
      if (current.ownerId !== ownerId) { res.status(403).json({ error: 'ownerId mismatch' }); return }

      const updated = { ...current }
      if (typeof body.quantity === 'number') updated.quantity = Math.max(0, body.quantity)
      if (typeof body.available === 'boolean') updated.available = body.available
      await put(pathFor(id), JSON.stringify(updated), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json'
      })
      res.status(200).json({ listing: updated })
      return
    }

    if (req.method === 'DELETE') {
      const ownerId = String(req.query?.ownerId || '')
      const current = await readListing(pathFor(id))
      if (!current) { res.status(404).json({ error: 'not found' }); return }
      if (current.ownerId !== ownerId) { res.status(403).json({ error: 'ownerId mismatch' }); return }
      await del(pathFor(id))
      res.status(204).end()
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[api/listings] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
