import './style.css'
import { buildDefaultProducers, buildDefaultRequestText, DEMO_REGION } from './data.js'
import { parseRequestText } from './parser.js'
import { computeAllocation, describeInventoryDiff } from './matching.js'

const STORAGE_KEY = 'ai-chiikishosha-state-v1'

/** @type {{
 *  tab: 'restaurant'|'producer',
 *  producers: any[],
 *  requestText: string,
 *  parsed: any|null,
 *  result: any|null,
 *  resultSnapshot: any[]|null,
 *  savedPlans: any[]
 * }} */
let state = loadState()

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.producers) && parsed.producers.length > 0) return parsed
    }
  } catch (e) { /* 読めない場合は初期状態にする */ }
  return {
    tab: 'restaurant',
    producers: buildDefaultProducers(),
    requestText: buildDefaultRequestText(),
    parsed: null,
    result: null,
    resultSnapshot: null,
    savedPlans: []
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) { /* 保存できなくても画面表示は継続する */ }
}

function setState(patch) {
  state = { ...state, ...patch }
  saveState()
  render()
}

function resetDemo() {
  state = {
    tab: state.tab,
    producers: buildDefaultProducers(),
    requestText: buildDefaultRequestText(),
    parsed: null,
    result: null,
    resultSnapshot: null,
    savedPlans: []
  }
  saveState()
  render()
}

async function tryAiParse(text, knownItems) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, knownItems }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) throw new Error('api not ok')
    const json = await res.json()
    if (!json || typeof json !== 'object') throw new Error('invalid json')
    return { ...json, source: 'ai' }
  } catch (e) {
    return { ...parseRequestText(text, knownItems), source: 'rule' }
  }
}

function knownItemNames() {
  return [...new Set(state.producers.map(p => p.item))]
}

function fmtNum(n) {
  if (n === null || n === undefined) return '―'
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

// ---------- イベントハンドラ ----------

async function handleParseClick() {
  const text = document.getElementById('request-text').value
  setState({ requestText: text })
  const parsed = await tryAiParse(text, knownItemNames())
  setState({ parsed, result: null, resultSnapshot: null })
}

function handleParsedFieldChange(field, value) {
  const parsed = { ...state.parsed, [field]: value }
  setState({ parsed })
}

function handleComputeClick() {
  const result = computeAllocation(state.parsed, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  setState({ result, resultSnapshot: snapshot })
}

function handleRecomputeClick() {
  const diffNotices = state.resultSnapshot ? describeInventoryDiff(state.resultSnapshot, state.producers) : []
  const result = computeAllocation(state.parsed, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  setState({ result: { ...result, diffNotices }, resultSnapshot: snapshot })
}

function handleSavePlan() {
  if (!state.result || state.result.status !== 'success') return
  const plan = { ...state.result, savedAt: new Date().toISOString(), requestText: state.requestText }
  setState({ savedPlans: [...state.savedPlans, plan] })
}

function handleProducerQuantityChange(id, value) {
  const quantity = Math.max(0, Number(value) || 0)
  const producers = state.producers.map(p => p.id === id ? { ...p, quantity } : p)
  setState({ producers })
}

function handleProducerAvailabilityToggle(id) {
  const producers = state.producers.map(p => p.id === id ? { ...p, available: !p.available } : p)
  setState({ producers })
}

function handleProducerDelete(id) {
  const producers = state.producers.filter(p => p.id !== id)
  setState({ producers })
}

function handleAddProducer(form) {
  const data = new FormData(form)
  const id = `P${Date.now()}`
  const producer = {
    id,
    farmName: String(data.get('farmName') || '新規農家'),
    item: String(data.get('item') || ''),
    unit: String(data.get('unit') || 'kg'),
    quantity: Number(data.get('quantity') || 0),
    unitPrice: Number(data.get('unitPrice') || 0),
    isOffGrade: data.get('isOffGrade') === 'on',
    offGradeReason: String(data.get('offGradeReason') || ''),
    availableDate: String(data.get('availableDate') || ''),
    region: String(data.get('region') || DEMO_REGION),
    deliveryLocation: String(data.get('deliveryLocation') || ''),
    deliveryTime: String(data.get('deliveryTime') || ''),
    minQuantity: Number(data.get('minQuantity') || 1),
    incrementStep: Number(data.get('incrementStep') || 1),
    deliveryFee: Number(data.get('deliveryFee') || 0),
    available: true
  }
  setState({ producers: [...state.producers, producer] })
  form.reset()
}

// ---------- 画面描画 ----------

function render() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">AI地域商社 <span class="brand-sub">仕入れ案MVP</span></div>
      <nav class="tabs">
        <button class="tab ${state.tab === 'restaurant' ? 'active' : ''}" data-tab="restaurant">飲食店として使う</button>
        <button class="tab ${state.tab === 'producer' ? 'active' : ''}" data-tab="producer">生産者として使う</button>
      </nav>
      <button class="reset-btn" id="reset-demo">デモデータに戻す</button>
    </header>
    <main class="content">
      ${state.tab === 'restaurant' ? renderRestaurant() : renderProducer()}
    </main>
    <footer class="scope-note">
      このMVPが示すのは「仕入れ案の作成」までです。注文確定・在庫予約・決済・配送手配は対象外で、結果は常に「未確保」です。
    </footer>
  `
  attachEvents()
}

function renderRestaurant() {
  return `
    <section class="panel">
      <h2>① 入口 → ② 希望条件を入力</h2>
      <p class="hint">自然文のまま入力できます。(例:「明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK」)</p>
      <textarea id="request-text" rows="3">${escapeHtml(state.requestText)}</textarea>
      <div class="actions">
        <button id="parse-btn" class="primary">AIで読み取る</button>
      </div>
    </section>

    ${state.parsed ? renderParsedForm() : ''}
    ${state.result ? renderResult() : ''}
    ${state.savedPlans.length ? renderSavedPlans() : ''}
  `
}

function renderParsedForm() {
  const p = state.parsed
  const items = knownItemNames()
  const missing = !p.item || !p.quantity || !p.unit || !p.neededDate
  return `
    <section class="panel">
      <h2>③ AIの整理結果を確認・修正</h2>
      <p class="hint">読み取り方式: ${p.source === 'ai' ? 'AI(Gemini)' : 'ルールベース(AI停止時のフォールバック)'}</p>
      <div class="form-grid">
        <label>品目
          <select id="f-item">
            <option value="">選択してください</option>
            ${items.map(i => `<option value="${escapeHtml(i)}" ${p.item === i ? 'selected' : ''}>${escapeHtml(i)}</option>`).join('')}
          </select>
        </label>
        <label>数量
          <input id="f-quantity" type="number" min="0" step="0.1" value="${p.quantity ?? ''}" />
        </label>
        <label>単位
          <select id="f-unit">
            ${['kg', '個', '本', '袋', '房'].map(u => `<option value="${u}" ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </label>
        <label>希望日
          <input id="f-date" type="date" value="${p.neededDate || ''}" />
        </label>
        <label>地域(任意)
          <input id="f-region" type="text" value="${escapeHtml(p.region || '')}" placeholder="指定なし" />
        </label>
        <label>価格上限(任意・円)
          <input id="f-price" type="number" min="0" value="${p.priceLimit ?? ''}" placeholder="指定なし" />
        </label>
        <label class="checkbox">
          <input id="f-offgrade" type="checkbox" ${p.allowOffGrade ? 'checked' : ''} />
          規格外(形の不揃い等)を許容する
        </label>
      </div>
      ${missing ? '<p class="warn">品目・数量・希望日を入力してください。</p>' : ''}
      <div class="actions">
        <button id="compute-btn" class="primary" ${missing ? 'disabled' : ''}>仕入れ案を作る</button>
      </div>
    </section>
  `
}

function renderResult() {
  const r = state.result
  if (r.status === 'empty' || r.status === 'no_candidates') {
    return `
      <section class="panel result">
        <h2>④ 仕入れ案</h2>
        <p class="warn">${escapeHtml(r.message)}</p>
        ${renderExclusions(r.exclusions)}
      </section>
    `
  }
  if (r.status === 'insufficient' || r.status === 'step_mismatch') {
    return `
      <section class="panel result">
        <h2>④ 仕入れ案</h2>
        <p class="warn">${escapeHtml(r.message)}</p>
        ${r.eligible ? `
          <table class="alloc-table">
            <thead><tr><th>農家</th><th>登録数量</th><th>単価</th></tr></thead>
            <tbody>
              ${r.eligible.map(f => `<tr><td>${escapeHtml(f.farmName)}</td><td>${fmtNum(f.quantity)}${f.unit}</td><td>${fmtNum(f.unitPrice)}円</td></tr>`).join('')}
            </tbody>
          </table>` : ''}
        ${renderExclusions(r.exclusions)}
        <div class="actions"><button id="recompute-btn">条件を変えずに再計算</button></div>
      </section>
    `
  }
  // success
  return `
    <section class="panel result success">
      <h2>④ 仕入れ案</h2>
      ${r.diffNotices && r.diffNotices.length ? `<p class="diff-notice">${r.diffNotices.map(escapeHtml).join(' ')}</p>` : ''}
      <div class="summary-line">
        <span>希望数量を満たすか:<strong>満たす</strong></span>
        <span>いつ・どこで受け取るか:<strong>${escapeHtml(r.neededDate)} ${escapeHtml(r.deliveryTime || '')} ${escapeHtml(r.deliveryLocation || '')}</strong></span>
        <span>費用はいくらか:<strong>${fmtNum(r.totalPrice)}円(税込)</strong></span>
      </div>
      <table class="alloc-table">
        <thead><tr><th>生産者</th><th>配分</th><th>商品代</th><th>備考</th></tr></thead>
        <tbody>
          ${r.allocation.map(a => `
            <tr>
              <td>${escapeHtml(a.farm.farmName)}</td>
              <td>${fmtNum(a.amount)}${a.farm.unit}</td>
              <td>${fmtNum(a.amount * a.farm.unitPrice)}円</td>
              <td>${a.farm.isOffGrade ? `規格外(${escapeHtml(a.farm.offGradeReason || '形の不揃い')})含む` : '通常品'}</td>
            </tr>`).join('')}
          <tr class="total-row">
            <td>合計</td><td>${fmtNum(r.totalQuantity)}</td><td>${fmtNum(r.totalPrice)}円(税込)</td><td></td>
          </tr>
        </tbody>
      </table>
      <p class="status-note">状態:農家承認前・在庫未確保。この案は注文確定ではありません。</p>
      <div class="actions">
        <button id="recompute-btn">在庫の最新状態で再計算</button>
        <button id="save-plan-btn" class="primary">案を保存(相談用)</button>
      </div>
    </section>
  `
}

function renderExclusions(exclusions) {
  if (!exclusions || exclusions.length === 0) return ''
  return `
    <details class="exclusions">
      <summary>除外された登録(${exclusions.length}件)の理由を見る</summary>
      <ul>
        ${exclusions.map(e => `<li>${escapeHtml(e.farm.farmName)}:${escapeHtml(e.reason)}</li>`).join('')}
      </ul>
    </details>
  `
}

function renderSavedPlans() {
  return `
    <section class="panel">
      <h2>⑤ 保存済みの仕入れ案(相談用)</h2>
      <ul class="saved-list">
        ${state.savedPlans.map(p => `
          <li>${new Date(p.savedAt).toLocaleString('ja-JP')} - ${fmtNum(p.totalQuantity)}(合計${fmtNum(p.totalPrice)}円) - 「${escapeHtml(p.requestText)}」</li>
        `).join('')}
      </ul>
    </section>
  `
}

function renderProducer() {
  return `
    <section class="panel">
      <h2>① 入口 → ② 出品内容を登録</h2>
      <form id="add-producer-form" class="form-grid">
        <label>農家名<input name="farmName" type="text" required placeholder="例:D農家" /></label>
        <label>品目<input name="item" type="text" required placeholder="例:トマト" /></label>
        <label>数量<input name="quantity" type="number" min="0" step="0.1" required /></label>
        <label>単位
          <select name="unit">
            ${['kg', '個', '本', '袋', '房'].map(u => `<option value="${u}">${u}</option>`).join('')}
          </select>
        </label>
        <label>単価(円)<input name="unitPrice" type="number" min="0" required /></label>
        <label>出荷可能日<input name="availableDate" type="date" required /></label>
        <label>地域<input name="region" type="text" placeholder="${DEMO_REGION}" /></label>
        <label>受渡場所<input name="deliveryLocation" type="text" placeholder="共通受渡拠点P" /></label>
        <label>受渡時間<input name="deliveryTime" type="text" placeholder="10:00〜11:00" /></label>
        <label>最低販売量<input name="minQuantity" type="number" min="0" step="0.1" value="1" /></label>
        <label>販売刻み<input name="incrementStep" type="number" min="0.1" step="0.1" value="1" /></label>
        <label class="checkbox"><input name="isOffGrade" type="checkbox" /> 規格外(余剰・形不揃い等)</label>
        <label>規格外理由(任意)<input name="offGradeReason" type="text" placeholder="形の不揃い" /></label>
      </form>
      <div class="actions"><button id="add-producer-btn" class="primary">登録する</button></div>
    </section>

    <section class="panel">
      <h2>④ 登録済みの出品(飲食店への提案に使われる)</h2>
      <table class="producer-table">
        <thead><tr><th>農家</th><th>品目</th><th>数量</th><th>単価</th><th>出荷可能日</th><th>規格外</th><th>状態</th><th></th></tr></thead>
        <tbody>
          ${state.producers.map(p => `
            <tr class="${p.available === false ? 'unavailable' : ''}">
              <td>${escapeHtml(p.farmName)}</td>
              <td>${escapeHtml(p.item)}</td>
              <td><input type="number" min="0" step="0.1" value="${p.quantity}" data-qty-id="${p.id}" style="width:5em" />${escapeHtml(p.unit)}</td>
              <td>${fmtNum(p.unitPrice)}円</td>
              <td>${escapeHtml(p.availableDate || '')}</td>
              <td>${p.isOffGrade ? `規格外(${escapeHtml(p.offGradeReason || '')})` : '通常品'}</td>
              <td>${p.available === false ? '出荷不可' : '出荷可能'}</td>
              <td>
                <button data-toggle-id="${p.id}">${p.available === false ? '出荷再開' : '出荷停止'}</button>
                <button data-delete-id="${p.id}">削除</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="hint">⑤ 数量・公開状態を変えたら、飲食店タブで「在庫の最新状態で再計算」を押すと反映されます(在庫変動・欠品ケースのデモ)。</p>
    </section>
  `
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function attachEvents() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => setState({ tab: btn.dataset.tab }))
  })
  document.getElementById('reset-demo')?.addEventListener('click', resetDemo)

  document.getElementById('parse-btn')?.addEventListener('click', handleParseClick)
  document.getElementById('compute-btn')?.addEventListener('click', () => {
    const p = state.parsed
    const updated = {
      ...p,
      item: document.getElementById('f-item').value || null,
      quantity: Number(document.getElementById('f-quantity').value) || null,
      unit: document.getElementById('f-unit').value,
      neededDate: document.getElementById('f-date').value || null,
      region: document.getElementById('f-region').value || null,
      priceLimit: document.getElementById('f-price').value ? Number(document.getElementById('f-price').value) : null,
      allowOffGrade: document.getElementById('f-offgrade').checked
    }
    setState({ parsed: updated })
    handleComputeClick()
  })
  document.getElementById('recompute-btn')?.addEventListener('click', handleRecomputeClick)
  document.getElementById('save-plan-btn')?.addEventListener('click', handleSavePlan)

  document.getElementById('add-producer-btn')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('add-producer-form')
    if (!form.reportValidity()) return
    handleAddProducer(form)
  })
  document.querySelectorAll('[data-qty-id]').forEach(input => {
    input.addEventListener('change', () => handleProducerQuantityChange(input.dataset.qtyId, input.value))
  })
  document.querySelectorAll('[data-toggle-id]').forEach(btn => {
    btn.addEventListener('click', () => handleProducerAvailabilityToggle(btn.dataset.toggleId))
  })
  document.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => handleProducerDelete(btn.dataset.deleteId))
  })
}

render()
