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

  const { text, knownItems, mode, image } = req.body || {}
  const items = Array.isArray(knownItems) ? knownItems.slice(0, 50) : []

  // mode:'listing-photo'は画像のみ(品目・規格外の視覚判定用)。それ以外は自然文(音声入力含む)が必須。
  if (mode === 'listing-photo') {
    if (!image || typeof image.data !== 'string' || typeof image.mimeType !== 'string' || image.data.length > 6_000_000) {
      res.status(400).json({ error: 'invalid image' })
      return
    }
  } else if (typeof text !== 'string' || text.length === 0 || text.length > 500) {
    res.status(400).json({ error: 'invalid text' })
    return
  }

  // Geminiは「今日」を知らないため、日本時間の基準日を明示しないと
  // 「明日」「明後日」等の相対表現を絶対日付に変換できずnullになる。
  const todayJst = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())

  // mode別にプロンプトを切り替える。
  // 'listing-photo' は生産者が撮った写真から品目・規格外を視覚判定(数量は写真から推定不可のため対象外。
  //   泥だらけの手でも、数量だけは音声/直接入力で補う前提 — main.js側で合成する)。
  // 'listing' は生産者の出品内容(自然文・音声入力共通)、既定は飲食店の仕入れ希望。
  let prompt
  if (mode === 'listing-photo') {
    prompt = `次の画像に写っている農作物について、JSONで回答してください。
既知の品目候補: ${items.join('、') || 'なし'}
出力は次のキーのみを持つJSONオブジェクトにしてください。品目が判別できない場合はitemをnullにしてください。
{
  "item": string|null,
  "isOffGrade": boolean,
  "offGradeReason": string|null
}
isOffGradeは、形の不揃い・傷・変色・サイズのばらつきなど、規格外(訳あり品)に見える場合にtrueにしてください。
JSON以外の文字は出力しないでください。`
  } else if (mode === 'listing') {
    prompt = `次の日本語の自然文から、生産者の出品内容をJSONで抽出してください。
今日の日付(日本時間)は ${todayJst} です。「明日」「明後日」「今週中」のような相対的な日付表現は、この日付を基準にYYYY-MM-DD形式の絶対日付に変換してください。
入力: "${text}"
既知の品目候補: ${items.join('、') || 'なし'}
出力は次のキーのみを持つJSONオブジェクトにしてください。値が読み取れない場合は null にしてください(allowOffGradeに相当するisOffGradeのみboolean、他はnull可)。
{
  "item": string|null,
  "quantity": number|null,
  "unit": "kg"|"個"|"本"|"袋"|"房"|null,
  "availableDate": "YYYY-MM-DD"|null,
  "region": string|null,
  "unitPrice": number|null,
  "isOffGrade": boolean,
  "offGradeReason": string|null
}
JSON以外の文字は出力しないでください。`
  } else {
    prompt = `次の日本語の自然文から、飲食店の仕入れ希望条件をJSONで抽出してください。
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
  }

  // モデル名は世代交代が早いため決め打ちにせず、環境変数GEMINI_MODELで上書きできるようにする。
  // 未設定の場合のみ既定値を使う(Google AI Studioの現行モデル一覧で要確認。画像入力にも対応している必要がある)。
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'

  const parts = [{ text: prompt }]
  if (mode === 'listing-photo') {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      }
    )
    if (!r.ok) throw new Error(`gemini http ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const data = await r.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) throw new Error('empty gemini response')
    const parsed = JSON.parse(raw)
    res.status(200).json({ rawText: text || null, ...parsed })
  } catch (e) {
    // Vercelのダッシュボード/`vercel logs`で原因を追えるように、失敗時は必ずサーバー側へ記録する。
    console.error(`[api/parse] gemini call failed (model=${model}, mode=${mode}):`, e)
    res.status(502).json({ error: 'ai parse failed', detail: String(e) })
  }
}
