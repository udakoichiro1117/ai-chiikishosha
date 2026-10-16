// ワンタイムログインリンク(マジックリンク)によるメール認証。
//
// パスワードは扱わない: ハッシュ化・リセットフローが必要になり、しかもリセット自体に
// 結局メール送信が要るため、最初からパスワード無しのメール確認だけにする。
//
// 「ログインする」とは、api/listings.js・api/orders.js・api/hubs.jsが使う`ownerId`の値を、
// 端末ごとの匿名UUIDから検証済みメールアドレスに切り替えること(main.jsのgetOwnerId()参照)。
// この3つのAPIは`ownerId`がUUIDかメールかを区別しないため、サーバー側の変更はここだけで完結する。
//
// トークンはUUID生成等とは別に、node:cryptoの暗号学的に強い乱数(randomBytes)で作る
// (認証用途なので推測されない強度が必要なため)。
//
// 役割(飲食店/生産者)は1アカウント(メールアドレス)につき1つに固定する。
// 初回のログインリンク申請時に選んだ役割をaccounts/<email>.jsonに記録し、
// 以後その役割以外では同じメールアドレスからログインできないようにする。

import { put, get } from '@vercel/blob'
import { randomBytes } from 'node:crypto'

const PREFIX = 'auth/'
const ACCOUNT_PREFIX = 'accounts/'
const TOKEN_TTL_MS = 15 * 60 * 1000 // 15分
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = ['restaurant', 'producer']

function pathFor(token) {
  return `${PREFIX}${token}.json`
}

// メールアドレスはpathnameにそのまま使う(encodeURIComponentすると、put/getが内部で
// さらに独自にエンコードするため二重エンコードになり、書き込みと読み出しのキーが
// 一致しなくなる実機検証で判明した不具合がある)。
function accountPathFor(email) {
  return `${ACCOUNT_PREFIX}${email}.json`
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

const readAccount = (email) => readJson(accountPathFor(email))
const writeAccount = (email, data) => writeJson(accountPathFor(email), data)

async function sendLoginEmail(email, loginUrl) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: 'AI地域商社 ログインリンク',
      html: `<p>以下のリンクをクリックするとログインできます(15分間だけ有効です)。</p><p><a href="${loginUrl}">${loginUrl}</a></p><p>心当たりが無い場合はこのメールを無視してください。</p>`
    })
  })
  if (!r.ok) throw new Error(`resend http ${r.status}: ${(await r.text()).slice(0, 300)}`)
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return }
    const action = String(req.query?.action || '')
    const body = req.body || {}

    if (action === 'request') {
      const email = String(body.email || '').trim().toLowerCase()
      if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'invalid email' }); return }
      const role = String(body.role || '')
      if (!ROLES.includes(role)) { res.status(400).json({ error: 'invalid role' }); return }

      const account = await readAccount(email)
      if (account && account.role !== role) {
        res.status(409).json({ error: 'role mismatch', existingRole: account.role })
        return
      }
      if (!account) {
        await writeAccount(email, { email, role, createdAt: new Date().toISOString() })
      }

      const token = randomBytes(32).toString('hex')
      const now = Date.now()
      const record = {
        token,
        email,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
        used: false
      }
      await writeJson(pathFor(token), record)

      // ホスト名はクライアントの自己申告ではなく、リクエストヘッダーから取る(Vercelは常にhttps)。
      const host = req.headers?.host || 'localhost'
      const loginUrl = `https://${host}/?loginToken=${token}`
      try {
        await sendLoginEmail(email, loginUrl)
      } catch (e) {
        console.error('[api/auth] email send failed:', e)
        res.status(502).json({ error: 'failed to send login email', detail: String(e) })
        return
      }
      res.status(200).json({ ok: true })
      return
    }

    if (action === 'verify') {
      const token = String(body.token || '')
      if (!token) { res.status(400).json({ error: 'token is required' }); return }
      const record = await readJson(pathFor(token))
      if (!record) { res.status(404).json({ error: 'invalid token' }); return }
      if (record.used) { res.status(410).json({ error: 'token already used' }); return }
      if (Date.now() > new Date(record.expiresAt).getTime()) { res.status(410).json({ error: 'token expired' }); return }

      record.used = true
      await writeJson(pathFor(token), record)
      const account = await readAccount(record.email)
      res.status(200).json({ email: record.email, role: account?.role || null })
      return
    }

    res.status(400).json({ error: 'unknown action' })
  } catch (e) {
    console.error('[api/auth] error:', e)
    res.status(500).json({ error: 'internal error', detail: String(e) })
  }
}
