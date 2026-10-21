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

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// デモ出品(A/B/C農家、03spec.mdのデモシナリオ)は、読み込みのたびに「出荷可能日が
// 今日より前(=もう二度とマッチしようがない)」場合だけ、現在時刻基準の新しい内容に
// 自動で作り直す。在庫を使い切っただけ(出荷可能日はまだ有効)の場合は実際の利用結果
// としてそのまま残す(無言で元に戻すと、承認や在庫減少の動作確認ができなくなるため)。
// ownerIdを実デバイスのUUIDと衝突しない'seed'にするため、通常のUIからは編集・削除できない。
//
// 上記の「過去になったら作り直す」判定だけでは、出荷可能日が過去になっていない日でも、
// デモ文言(buildDefaultRequestTextの「明後日までに」)が約束する"今日+2日"からズレて
// しまう期間が生じる(作り直しが起きた日は+2日で一致するが、翌日は実質+1日、翌々日は
// +0日とズレていき、過去になるまでは放置されるため)。そのズレが「②で読み取った希望日」と
// 「出品側の出荷可能日」の完全一致を崩し、デモ入力ボタンが実際にはマッチしなくなる。
// そこで、在庫状況(数量・公開可否)はそのまま保ちつつ、出荷可能日と鮮度期限だけは
// 毎回のアクセスで正しい相対日付("今日+2日")に合わせ直す。
async function ensureDemoListingsFresh() {
  const fresh = buildDefaultProducers()
  const today = todayStr()
  await Promise.all(
    fresh.map(async (p) => {
      const pathname = pathFor(p.id)
      const current = await readListing(pathname)
      const isStale = !current || current.availableDate < today
      if (isStale) {
        // デモのA/B/C農家は「共通受渡拠点」想定(元々の03spec.mdのデモ設定)なので、既定はpickupにする。
        // また、すぐ仕入れられるデモ用在庫として扱うためconfirmed(収穫済み・在庫確定)にする。
        const listing = { ...p, ownerId: SEED_OWNER, deliveryMethod: 'pickup', stockStatus: 'confirmed', expiryDate: computeExpiryDate(p.availableDate, p.item) }
        await put(pathname, JSON.stringify(listing), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json'
        })
        return
      }
      if (current.availableDate !== p.availableDate) {
        const listing = { ...current, availableDate: p.availableDate, expiryDate: computeExpiryDate(p.availableDate, p.item) }
        await put(pathname, JSON.stringify(listing), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json'
        })
      }
    })
  )
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      await ensureDemoListingsFresh()
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
      if (!['deliver', 'pickup', 'hub'].includes(body.deliveryMethod)) { res.status(400).json({ error: 'deliveryMethod must be deliver, pickup, or hub' }); return }
      if (!['confirmed', 'estimated'].includes(body.stockStatus)) { res.status(400).json({ error: 'stockStatus must be confirmed or estimated' }); return }

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
        stockStatus: body.stockStatus,
        deliveryMethod: body.deliveryMethod,
        hubId: body.deliveryMethod === 'hub' ? String(body.hubId || '') : null,
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
