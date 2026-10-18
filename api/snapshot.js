// デモ運営者向け: 共有データ(出品・注文・拠点・チャット)の状態をスナップショット保存し、
// 丸ごと復元できるようにする。全テスターが同じ共有Blobストアを見る設計のため、発表直前に
// 誰かの操作でデモ用データが変わってしまっても、直前に保存した状態へ戻せるようにするための機能。
//
// 復元は既存データを全削除する破壊的操作のため、DEMO_ADMIN_KEY環境変数と一致するキーを
// 要求する。未設定の環境では機能自体を無効として扱い、黙って成功したことにはしない。

import { put, get, list, del } from '@vercel/blob'

const PREFIXES = ['listings/', 'orders/', 'hubs/', 'messages/']
const SNAPSHOT_PATH = 'snapshot/backup.json'

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

async function listAllUnder(prefix) {
  const { blobs } = await list({ prefix })
  const items = await Promise.all(blobs.map(async (b) => ({ pathname: b.pathname, data: await readJson(b.pathname) })))
  return items.filter((i) => i.data)
}

function hasValidAdminKey(req) {
  const configured = process.env.DEMO_ADMIN_KEY
  if (!configured) return false
  const provided = String(req.body?.adminKey || '')
  return provided === configured
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const backup = await readJson(SNAPSHOT_PATH)
      res.status(200).json({
        configured: !!process.env.DEMO_ADMIN_KEY,
        exists: !!backup,
        savedAt: backup?.savedAt || null
      })
      return
    }

    if (req.method === 'POST') {
      if (!process.env.DEMO_ADMIN_KEY) { res.status(501).json({ error: 'DEMO_ADMIN_KEY is not configured' }); return }
      if (!hasValidAdminKey(req)) { res.status(403).json({ error: 'invalid admin key' }); return }

      const action = String(req.body?.action || '')

      if (action === 'save') {
        const data = {}
        for (const prefix of PREFIXES) data[prefix] = await listAllUnder(prefix)
        const savedAt = new Date().toISOString()
        await writeJson(SNAPSHOT_PATH, { savedAt, data })
        res.status(200).json({ ok: true, savedAt })
        return
      }

      if (action === 'restore') {
        const backup = await readJson(SNAPSHOT_PATH)
        if (!backup) { res.status(404).json({ error: 'no snapshot saved yet' }); return }
        // 先にスナップショットの内容を書き戻してから、スナップショットに含まれない分だけ
        // 削除する(逆順だと、途中で失敗した場合にデータが消えたまま戻らない恐れがあるため)。
        for (const prefix of PREFIXES) {
          const items = backup.data[prefix] || []
          await Promise.all(items.map((item) => writeJson(item.pathname, item.data)))
        }
        for (const prefix of PREFIXES) {
          const keepPaths = new Set((backup.data[prefix] || []).map((item) => item.pathname))
          const { blobs } = await list({ prefix })
          const toDelete = blobs.filter((b) => !keepPaths.has(b.pathname))
          await Promise.all(toDelete.map((b) => del(b.pathname)))
        }
        res.status(200).json({ ok: true, restoredFrom: backup.savedAt })
        return
      }

      res.status(400).json({ error: 'unknown action' })
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[api/snapshot] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
