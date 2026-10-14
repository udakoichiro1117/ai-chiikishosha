// Vercel Functions (api/ フォルダ経由)。GEMINI_API_KEY はサーバー側の環境変数としてのみ扱い、
// フロントエンドには一切公開しない(03spec.md 技術環境 / 悪意イレギュラーケース 準拠)。
// キー未設定、またはAI呼び出し失敗時は、クライアント側がルールベース抽出に自動フォールバックする
// (main.js の tryAiParse を参照)。このファイルは「使えるときだけ使う」補助であり必須ではない。

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured' })
    return
  }

  const { text, knownItems } = req.body || {}
  if (typeof text !== 'string' || text.length === 0 || text.length > 500) {
    res.status(400).json({ error: 'invalid text' })
    return
  }
  const items = Array.isArray(knownItems) ? knownItems.slice(0, 50) : []

  // Geminiは「今日」を知らないため、日本時間の基準日を明示しないと
  // 「明日」「明後日」等の相対表現をneededDateに変換できずnullになる。
  const todayJst = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())

  const prompt = `次の日本語の自然文から、飲食店の仕入れ希望条件をJSONで抽出してください。
今日の日付(日本時間)は ${todayJst} です。「明日」「明後日」「今週中」のような相対的な日付表現は、この日付を基準にYYYY-MM-DD形式の絶対日付に変換してください。
入力: "${text}"
既知の品目候補: ${items.join('、') || 'なし'}
出力は次のキーのみを持つJSONオブジェクトにしてください。値が読み取れない場合は null にしてください。
{
  "item": string|null,
  "quantity": number|null,
  "unit": "kg"|"個"|"本"|"袋"|"房"|null,
  "neededDate": "YYYY-MM-DD"|null,
  "region": string|null,
  "allowOffGrade": boolean,
  "priceLimit": number|null
}
JSON以外の文字は出力しないでください。`

  // モデル名は世代交代が早いため決め打ちにせず、環境変数GEMINI_MODELで上書きできるようにする。
  // 未設定の場合のみ既定値を使う(Google AI Studioの現行モデル一覧で要確認)。
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      }
    )
    if (!r.ok) throw new Error(`gemini http ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const data = await r.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) throw new Error('empty gemini response')
    const parsed = JSON.parse(raw)
    res.status(200).json({ rawText: text, ...parsed })
  } catch (e) {
    // Vercelのダッシュボード/`vercel logs`で原因を追えるように、失敗時は必ずサーバー側へ記録する。
    console.error(`[api/parse] gemini call failed (model=${model}):`, e)
    res.status(502).json({ error: 'ai parse failed', detail: String(e) })
  }
}
