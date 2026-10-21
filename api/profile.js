// ログイン済みアカウント(ownerId=検証済みメールアドレス)の店舗情報・農園情報を
// サーバーに保存する。匿名利用(端末ローカルのUUID)の場合はこのAPIを呼ばず、今まで
// 通りlocalStorageだけで完結させる(main.js側のgetOwnerId()/state.userEmailを参照)。
// これにより「ログインすればどの端末からでも自分の出品・注文にアクセスできる」という
// 価値を、受取条件・農園情報そのものにも広げる。
//
// 1アカウント=1役割が基本だが、管理者アカウント(api/auth.jsのADMIN_EMAILS)は
// 両方の役割を行き来できるため、ここでは単純にrestaurantProfile/producerProfileの
// どちらもそのアカウントに結び付けて保存できるようにしておく。

import { put, get } from '@vercel/blob'

const PREFIX = 'profiles/'

// api/auth.jsのaccountPathFor()と同じ理由で、メールアドレスはpathnameにそのまま使う
// (encodeURIComponentすると二重エンコードになり、書き込みと読み出しのキーが食い違う)。
function pathFor(ownerId) {
  return `${PREFIX}${ownerId}.json`
}

async function readJson(pathname) {
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

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const ownerId = String(req.query?.ownerId || '')
      if (!ownerId) { res.status(400).json({ error: 'ownerId is required' }); return }
      const saved = await readJson(pathFor(ownerId))
      res.status(200).json({
        restaurantProfile: saved?.restaurantProfile || null,
        producerProfile: saved?.producerProfile || null
      })
      return
    }

    if (req.method === 'PUT') {
      const body = req.body || {}
      const ownerId = String(body.ownerId || '')
      if (!ownerId) { res.status(400).json({ error: 'ownerId is required' }); return }
      const current = (await readJson(pathFor(ownerId))) || {}
      if ('restaurantProfile' in body) current.restaurantProfile = body.restaurantProfile
      if ('producerProfile' in body) current.producerProfile = body.producerProfile
      current.updatedAt = new Date().toISOString()
      await writeJson(pathFor(ownerId), current)
      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[api/profile] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
