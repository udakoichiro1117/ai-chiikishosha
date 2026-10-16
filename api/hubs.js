// 共通受渡拠点(Hub)の共有ストレージ。api/listings.js/api/orders.jsと同じVercel Blob方式。
//
// 拠点は運営側が決め打ちで用意するのではなく、実際に使う生産者・飲食店が
// 「このあたりなら集まりやすい」という場所を自分たちで登録していく、追記型の共有リストにする。
// 誰でも登録・閲覧できるが、v1では編集・削除は対象外(間違って登録された場合は実害が小さい
// 簡易な参照情報のため、運営が直接Blobを操作すれば足りる)。
//
// 1件の拠点=1ファイルにすることで、出品(listings)・注文(orders)と同様、他の登録との
// 書き込み競合を避ける。「所有権」の概念は無く、createdByは参考表示用の記録にとどめる。

import { put, get, list, del } from '@vercel/blob'

const PREFIX = 'hubs/'

function pathFor(id) {
  return `${PREFIX}${id}.json`
}

async function readHub(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false })
  if (!result) return null
  const text = await new Response(result.stream).text()
  return JSON.parse(text)
}

async function readAllHubs() {
  const { blobs } = await list({ prefix: PREFIX })
  const items = await Promise.all(blobs.map((b) => readHub(b.pathname)))
  return items.filter(Boolean)
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const hubs = await readAllHubs()
      res.status(200).json({ hubs })
      return
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const name = String(body.name || '').trim()
      const address = String(body.address || '').trim()
      if (!name) { res.status(400).json({ error: 'name is required' }); return }
      if (!address) { res.status(400).json({ error: 'address is required' }); return }

      const id = `H${Date.now()}${Math.random().toString(36).slice(2, 8)}`
      const hub = {
        id,
        name,
        address,
        lat: typeof body.lat === 'number' ? body.lat : null,
        lng: typeof body.lng === 'number' ? body.lng : null,
        createdBy: String(body.createdBy || ''),
        createdAt: new Date().toISOString()
      }
      await put(pathFor(id), JSON.stringify(hub), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/json'
      })
      res.status(201).json({ hub })
      return
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '')
      const createdBy = String(req.query?.createdBy || '')
      if (!id) { res.status(400).json({ error: 'id is required' }); return }
      const current = await readHub(pathFor(id))
      if (!current) { res.status(404).json({ error: 'not found' }); return }
      // 登録者本人だけ削除できる(listings/ordersと同じ簡易な所有権チェック。本人認証ではない)。
      if (current.createdBy !== createdBy) { res.status(403).json({ error: 'createdBy mismatch' }); return }
      await del(pathFor(id))
      res.status(204).end()
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[api/hubs] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
