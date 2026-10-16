// 生産者⇔飲食店のチャット(メルカリの取引チャットをイメージ)。
// api/orders.jsと同じVercel Blob方式。「取引」にあたるのは注文1件の中の1農家分
// (line)で、やり取りできるのはその当事者2者だけ(依頼した飲食店=order.requesterId、
// その農家=line.ownerId)。1スレッド=1ファイル(メッセージの配列)。
//
// 「所有権」はownerId(端末ごとの匿名UUID、またはログイン済みメールアドレス)の
// 一致だけで確認する簡易なもの(api/orders.jsと同じ制約)。

import { put, get } from '@vercel/blob'

const ORDER_PREFIX = 'orders/' // api/orders.jsと同じパス形式(揃っていないと連携できない)
const MESSAGE_PREFIX = 'messages/'
const MAX_TEXT_LENGTH = 2000

function orderPathFor(id) {
  return `${ORDER_PREFIX}${id}.json`
}
function threadPathFor(orderId, listingId) {
  return `${MESSAGE_PREFIX}${orderId}__${listingId}.json`
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

// このスレッドの当事者(飲食店側ownerId・農家側ownerId)を注文から特定する。
// 注文またはlineが見つからなければnull(呼び出し側で404にする)。
async function findParticipants(orderId, listingId) {
  const order = await readJson(orderPathFor(orderId))
  if (!order) return null
  const line = order.lines.find((l) => l.listingId === listingId)
  if (!line) return null
  return { requesterId: order.requesterId, producerOwnerId: line.ownerId }
}

export default async function handler(req, res) {
  try {
    const orderId = String(req.query?.orderId || '')
    const listingId = String(req.query?.listingId || '')
    if (!orderId || !listingId) { res.status(400).json({ error: 'orderId and listingId are required' }); return }

    if (req.method === 'GET') {
      const ownerId = String(req.query?.ownerId || '')
      const participants = await findParticipants(orderId, listingId)
      if (!participants) { res.status(404).json({ error: 'order or line not found' }); return }
      if (ownerId !== participants.requesterId && ownerId !== participants.producerOwnerId) {
        res.status(403).json({ error: 'ownerId mismatch' })
        return
      }
      const thread = await readJson(threadPathFor(orderId, listingId))
      res.status(200).json({ messages: thread?.messages || [] })
      return
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      const ownerId = String(body.ownerId || '')
      const text = String(body.text || '').trim()
      if (!text) { res.status(400).json({ error: 'text is required' }); return }
      if (text.length > MAX_TEXT_LENGTH) { res.status(400).json({ error: 'text is too long' }); return }

      const participants = await findParticipants(orderId, listingId)
      if (!participants) { res.status(404).json({ error: 'order or line not found' }); return }
      if (ownerId !== participants.requesterId && ownerId !== participants.producerOwnerId) {
        res.status(403).json({ error: 'ownerId mismatch' })
        return
      }
      const senderRole = ownerId === participants.requesterId ? 'restaurant' : 'producer'

      const thread = (await readJson(threadPathFor(orderId, listingId))) || { orderId, listingId, messages: [] }
      const message = {
        id: `M${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        senderId: ownerId,
        senderRole,
        text,
        createdAt: new Date().toISOString()
      }
      thread.messages.push(message)
      await writeJson(threadPathFor(orderId, listingId), thread)
      res.status(201).json({ message })
      return
    }

    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    console.error('[api/messages] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
