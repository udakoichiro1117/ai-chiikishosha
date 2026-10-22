// クライアントがAIの利用可否を「読み取りを試す前」に知るための軽量なエンドポイント。
// ai-chiiki-shoshaの「AIはまだ設定されていません」という事前表示を参考に、
// GEMINI_API_KEYが無い場合は読み取りを試す前にその旨を案内できるようにする。
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  res.status(200).json({ aiReady: !!process.env.GEMINI_API_KEY })
}
