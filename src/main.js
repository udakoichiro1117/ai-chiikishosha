import './style.css'
import { buildDefaultProducers, buildDefaultRequest, DEMO_REGION, VEGETABLE_OPTIONS, REGION_OPTIONS } from './data.js'
import { computeAllocation, describeInventoryDiff } from './matching.js'

const STORAGE_KEY = 'ai-chiikishosha-state-v1'

/** @type {{
 *  screen: 'home'|'restaurant'|'producer'|'restaurant-register'|'producer-register',
 *  restaurantProfile: {storeName:string,address:string,station:string,contactName:string}|null,
 *  producerProfile: {farmName:string,address:string,station:string,contactName:string}|null,
 *  producers: any[],
 *  request: {item:string,quantity:number,unit:string,neededDate:string,region:string,allowOffGrade:boolean,priceLimit:number|null},
 *  result: any|null,
 *  resultSnapshot: any[]|null,
 *  savedPlans: any[]
 * }} */
let state = loadState()

function loadState() {
  // ①入口は毎回「飲食店 / 生産者」の選択画面から始める(画面は保存しない)。
  // プロフィール(店舗名・住所等)と、入力途中のデータはlocalStorageから復元する。
  // これにより初回登録さえ済ませれば、2回目以降はログイン状態を保ったまま使える。
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.producers) && parsed.producers.length > 0) {
        return { restaurantProfile: null, producerProfile: null, listingDraft: null, listingStep: 2, ...parsed, screen: 'home' }
      }
    }
  } catch (e) { /* 読めない場合は初期状態にする */ }
  return {
    screen: 'home',
    restaurantProfile: null,
    producerProfile: null,
    listingDraft: null,
    listingStep: 2,
    producers: buildDefaultProducers(),
    request: buildDefaultRequest(),
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
    screen: state.screen,
    restaurantProfile: state.restaurantProfile,
    producerProfile: state.producerProfile,
    listingDraft: null,
    listingStep: 2,
    producers: buildDefaultProducers(),
    request: buildDefaultRequest(),
    result: null,
    resultSnapshot: null,
    savedPlans: []
  }
  saveState()
  render()
}

function knownItemNames() {
  return [...new Set(state.producers.map(p => p.item))]
}

function itemOptions() {
  return [...new Set([...VEGETABLE_OPTIONS, ...knownItemNames()])]
}

function describeRequest(r) {
  if (!r) return ''
  const parts = [`${r.item || '(品目未選択)'} ${fmtNum(r.quantity)}${r.unit || ''}`]
  if (r.neededDate) parts.push(r.neededDate)
  if (r.region) parts.push(r.region)
  parts.push(r.allowOffGrade ? '規格外可' : '規格外不可')
  return parts.join(' / ')
}

function fmtNum(n) {
  if (n === null || n === undefined) return '―'
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

// ---------- イベントハンドラ ----------

function readRequestForm() {
  return {
    item: document.getElementById('f-item').value || null,
    quantity: Number(document.getElementById('f-quantity').value) || null,
    unit: document.getElementById('f-unit').value,
    neededDate: document.getElementById('f-date').value || null,
    region: document.getElementById('f-region').value || null,
    priceLimit: document.getElementById('f-price').value ? Number(document.getElementById('f-price').value) : null,
    allowOffGrade: document.getElementById('f-offgrade').checked
  }
}

function handleComputeClick() {
  const request = readRequestForm()
  const result = computeAllocation(request, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  setState({ request, result, resultSnapshot: snapshot })
}

function handleRecomputeClick() {
  const diffNotices = state.resultSnapshot ? describeInventoryDiff(state.resultSnapshot, state.producers) : []
  const result = computeAllocation(state.request, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  setState({ result: { ...result, diffNotices }, resultSnapshot: snapshot })
}

function handleSavePlan() {
  if (!state.result || state.result.status !== 'success') return
  const plan = { ...state.result, savedAt: new Date().toISOString(), requestSummary: describeRequest(state.request) }
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

function handleRestaurantRegisterSubmit(form) {
  const data = new FormData(form)
  const restaurantProfile = {
    storeName: String(data.get('storeName') || ''),
    address: String(data.get('address') || ''),
    station: String(data.get('station') || ''),
    contactName: String(data.get('contactName') || '')
  }
  setState({ restaurantProfile, screen: 'restaurant' })
}

function handleProducerRegisterSubmit(form) {
  const data = new FormData(form)
  const producerProfile = {
    farmName: String(data.get('farmName') || ''),
    address: String(data.get('address') || ''),
    station: String(data.get('station') || ''),
    contactName: String(data.get('contactName') || '')
  }
  setState({ producerProfile, screen: 'producer' })
}

function handleListingStepTwoNext(form) {
  const data = new FormData(form)
  const listingDraft = {
    item: String(data.get('item') || ''),
    availableDate: String(data.get('availableDate') || ''),
    region: String(data.get('region') || DEMO_REGION)
  }
  setState({ listingDraft, listingStep: 3 })
}

function handleListingStepThreeSubmit(form) {
  const data = new FormData(form)
  const id = `P${Date.now()}`
  const producer = {
    id,
    farmName: state.producerProfile?.farmName || '新規農家',
    item: state.listingDraft.item,
    availableDate: state.listingDraft.availableDate,
    region: state.listingDraft.region,
    unit: String(data.get('unit') || 'kg'),
    quantity: Number(data.get('quantity') || 0),
    unitPrice: Number(data.get('unitPrice') || 0),
    isOffGrade: data.get('isOffGrade') === 'on',
    offGradeReason: String(data.get('offGradeReason') || ''),
    deliveryLocation: String(data.get('deliveryLocation') || ''),
    deliveryTime: String(data.get('deliveryTime') || ''),
    minQuantity: Number(data.get('minQuantity') || 1),
    incrementStep: Number(data.get('incrementStep') || 1),
    deliveryFee: Number(data.get('deliveryFee') || 0),
    available: true
  }
  setState({ producers: [...state.producers, producer], listingDraft: null, listingStep: 2 })
}

// ---------- 画面描画 ----------

function render() {
  const app = document.getElementById('app')
  const onHome = state.screen === 'home'
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">AI地域商社 <span class="brand-sub">仕入れ案MVP</span></div>
      ${onHome ? '' : '<button class="back-btn" id="back-home">← 選択画面に戻る</button>'}
      <button class="reset-btn" id="reset-demo">デモデータに戻す</button>
    </header>
    <main class="content">
      ${renderScreen()}
    </main>
    <footer class="scope-note">
      このMVPが示すのは「仕入れ案の作成」までです。注文確定・在庫予約・決済・配送手配は対象外で、結果は常に「未確保」です。
    </footer>
  `
  attachEvents()
}

function renderScreen() {
  switch (state.screen) {
    case 'home': return renderHome()
    case 'restaurant-register': return renderRestaurantRegister()
    case 'producer-register': return renderProducerRegister()
    case 'restaurant': return renderRestaurant()
    case 'producer': return renderProducer()
    default: return renderHome()
  }
}

function renderHome() {
  return `
    <section class="entry-choice">
      <h1 class="entry-title">どちらとして使いますか？</h1>
      <p class="hint">①入口:まず立場を選んでください。</p>
      <div class="entry-cards">
        <button class="entry-card" data-screen="restaurant">
          <span class="entry-card-label">飲食店側はこちら</span>
          <span class="entry-card-desc">欲しい食材を伝えて、仕入れ案を作る</span>
        </button>
        <button class="entry-card" data-screen="producer">
          <span class="entry-card-label">生産者側はこちら</span>
          <span class="entry-card-desc">販売できるものを登録する</span>
        </button>
      </div>
    </section>
  `
}

function renderRestaurantRegister() {
  const p = state.restaurantProfile || {}
  const isEdit = !!state.restaurantProfile
  return `
    <section class="panel">
      <h2>① 入口:店舗情報の登録${isEdit ? '(編集)' : ''}</h2>
      <p class="hint">初回のみ入力します。次回以降はこの端末で自動的にログイン状態が保たれ、この画面は表示されません。</p>
      <form id="restaurant-register-form" class="form-grid">
        <label>店舗名<input name="storeName" type="text" required value="${escapeHtml(p.storeName || '')}" placeholder="例:小料理屋 みかみ" /></label>
        <label>住所<input name="address" type="text" required value="${escapeHtml(p.address || '')}" placeholder="例:大阪市福島区..." /></label>
        <label>最寄り駅<input name="station" type="text" value="${escapeHtml(p.station || '')}" placeholder="例:JR福島駅" /></label>
        <label>担当者名<input name="contactName" type="text" value="${escapeHtml(p.contactName || '')}" placeholder="例:三上由香" /></label>
      </form>
      <div class="actions">
        <button id="restaurant-register-submit" class="primary">登録して進む</button>
        ${isEdit ? '<button id="cancel-register">キャンセル</button>' : ''}
      </div>
    </section>
  `
}

function renderProducerRegister() {
  const p = state.producerProfile || {}
  const isEdit = !!state.producerProfile
  return `
    <section class="panel">
      <h2>① 入口:農園情報の登録${isEdit ? '(編集)' : ''}</h2>
      <p class="hint">初回のみ入力します。次回以降はこの端末で自動的にログイン状態が保たれ、この画面は表示されません。</p>
      <form id="producer-register-form" class="form-grid">
        <label>農園名<input name="farmName" type="text" required value="${escapeHtml(p.farmName || '')}" placeholder="例:森畠農園" /></label>
        <label>住所<input name="address" type="text" required value="${escapeHtml(p.address || '')}" placeholder="例:大阪府豊能郡能勢町..." /></label>
        <label>最寄り駅<input name="station" type="text" value="${escapeHtml(p.station || '')}" placeholder="例:能勢電鉄 山下駅" /></label>
        <label>担当者名<input name="contactName" type="text" value="${escapeHtml(p.contactName || '')}" placeholder="例:森畠正輝" /></label>
      </form>
      <div class="actions">
        <button id="producer-register-submit" class="primary">登録して進む</button>
        ${isEdit ? '<button id="cancel-register">キャンセル</button>' : ''}
      </div>
    </section>
  `
}

function renderRestaurant() {
  return `
    <section class="panel profile-bar">
      <span>ログイン中:<strong>${escapeHtml(state.restaurantProfile?.storeName || '')}</strong>${state.restaurantProfile?.contactName ? `(${escapeHtml(state.restaurantProfile.contactName)})` : ''}</span>
      <button id="edit-restaurant-profile" class="link-btn">プロフィールを編集</button>
    </section>
    ${renderRequestForm()}
    ${state.result ? renderResult() : ''}
    ${state.savedPlans.length ? renderSavedPlans() : ''}
  `
}

function renderRequestForm() {
  const r = state.request
  const items = itemOptions()
  const missing = !r.item || !r.quantity || !r.unit || !r.neededDate
  return `
    <section class="panel">
      <h2>② 希望条件を入力</h2>
      <p class="hint">必要な野菜をプルダウンから選び、数量・希望日などを指定してください。</p>
      <div class="form-grid">
        <label>品目
          <select id="f-item">
            ${items.map(i => `<option value="${escapeHtml(i)}" ${r.item === i ? 'selected' : ''}>${escapeHtml(i)}</option>`).join('')}
          </select>
        </label>
        <label>数量
          <input id="f-quantity" type="number" min="0" step="0.1" value="${r.quantity ?? ''}" />
        </label>
        <label>単位
          <select id="f-unit">
            ${['kg', '個', '本', '袋', '房'].map(u => `<option value="${u}" ${r.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </label>
        <label>希望日
          <input id="f-date" type="date" value="${r.neededDate || ''}" />
        </label>
        <label>地域
          <select id="f-region">
            <option value="" ${!r.region ? 'selected' : ''}>指定なし</option>
            ${REGION_OPTIONS.map(g => `<option value="${g}" ${r.region === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
        </label>
        <label>価格上限(任意・円)
          <input id="f-price" type="number" min="0" value="${r.priceLimit ?? ''}" placeholder="指定なし" />
        </label>
        <label class="checkbox">
          <input id="f-offgrade" type="checkbox" ${r.allowOffGrade ? 'checked' : ''} />
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
          <li>${new Date(p.savedAt).toLocaleString('ja-JP')} - ${fmtNum(p.totalQuantity)}(合計${fmtNum(p.totalPrice)}円) - 「${escapeHtml(p.requestSummary)}」</li>
        `).join('')}
      </ul>
    </section>
  `
}

function renderListingStepTwo() {
  const d = state.listingDraft || {}
  return `
    <section class="panel">
      <h2>② 出品内容を入力</h2>
      <p class="hint">まず、何を・いつから・どのあたりで出せるかを選びます。</p>
      <form id="listing-step2-form" class="form-grid">
        <label>品目<input name="item" type="text" required value="${escapeHtml(d.item || '')}" placeholder="例:トマト" /></label>
        <label>出荷可能日<input name="availableDate" type="date" required value="${d.availableDate || ''}" /></label>
        <label>地域<input name="region" type="text" value="${escapeHtml(d.region ?? DEMO_REGION)}" placeholder="${DEMO_REGION}" /></label>
      </form>
      <div class="actions"><button id="listing-step2-next" class="primary">次へ(供給条件を入力)</button></div>
    </section>
  `
}

function renderListingStepThree() {
  const d = state.listingDraft || {}
  return `
    <section class="panel">
      <h2>③ 供給条件を登録</h2>
      <p class="hint">品目:${escapeHtml(d.item)} / 出荷可能日:${escapeHtml(d.availableDate)} / 地域:${escapeHtml(d.region)}</p>
      <form id="listing-step3-form" class="form-grid">
        <label>数量<input name="quantity" type="number" min="0" step="0.1" required /></label>
        <label>単位
          <select name="unit">
            ${['kg', '個', '本', '袋', '房'].map(u => `<option value="${u}">${u}</option>`).join('')}
          </select>
        </label>
        <label>単価(円)<input name="unitPrice" type="number" min="0" required /></label>
        <label>受渡場所<input name="deliveryLocation" type="text" placeholder="共通受渡拠点P" /></label>
        <label>受渡時間<input name="deliveryTime" type="text" placeholder="10:00〜11:00" /></label>
        <label>最低販売量<input name="minQuantity" type="number" min="0" step="0.1" value="1" /></label>
        <label>販売刻み<input name="incrementStep" type="number" min="0.1" step="0.1" value="1" /></label>
        <label class="checkbox"><input name="isOffGrade" type="checkbox" /> 規格外(余剰・形不揃い等)</label>
        <label>規格外理由(任意)<input name="offGradeReason" type="text" placeholder="形の不揃い" /></label>
      </form>
      <div class="actions">
        <button id="listing-step3-back">← ②に戻る</button>
        <button id="listing-step3-submit" class="primary">登録する</button>
      </div>
    </section>
  `
}

function renderProducer() {
  return `
    <section class="panel profile-bar">
      <span>ログイン中:<strong>${escapeHtml(state.producerProfile?.farmName || '')}</strong>${state.producerProfile?.contactName ? `(${escapeHtml(state.producerProfile.contactName)})` : ''}</span>
      <button id="edit-producer-profile" class="link-btn">プロフィールを編集</button>
    </section>
    ${state.listingStep === 3 ? renderListingStepThree() : renderListingStepTwo()}

    <section class="panel">
      <h2>④ 登録結果を確認(飲食店への提案に使われる)</h2>
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
  document.querySelectorAll('.entry-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen
      if (target === 'restaurant') {
        setState({ screen: state.restaurantProfile ? 'restaurant' : 'restaurant-register' })
      } else {
        setState({ screen: state.producerProfile ? 'producer' : 'producer-register' })
      }
    })
  })
  document.getElementById('back-home')?.addEventListener('click', () => setState({ screen: 'home' }))
  document.getElementById('reset-demo')?.addEventListener('click', resetDemo)

  document.getElementById('restaurant-register-submit')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('restaurant-register-form')
    if (!form.reportValidity()) return
    handleRestaurantRegisterSubmit(form)
  })
  document.getElementById('producer-register-submit')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('producer-register-form')
    if (!form.reportValidity()) return
    handleProducerRegisterSubmit(form)
  })
  document.getElementById('cancel-register')?.addEventListener('click', () => {
    if (state.screen === 'restaurant-register') setState({ screen: 'restaurant' })
    else if (state.screen === 'producer-register') setState({ screen: 'producer' })
    else setState({ screen: 'home' })
  })
  document.getElementById('edit-restaurant-profile')?.addEventListener('click', () => setState({ screen: 'restaurant-register' }))
  document.getElementById('edit-producer-profile')?.addEventListener('click', () => setState({ screen: 'producer-register' }))

  document.getElementById('compute-btn')?.addEventListener('click', handleComputeClick)
  document.getElementById('recompute-btn')?.addEventListener('click', handleRecomputeClick)
  document.getElementById('save-plan-btn')?.addEventListener('click', handleSavePlan)

  document.getElementById('listing-step2-next')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('listing-step2-form')
    if (!form.reportValidity()) return
    handleListingStepTwoNext(form)
  })
  document.getElementById('listing-step3-back')?.addEventListener('click', (e) => {
    e.preventDefault()
    setState({ listingStep: 2 })
  })
  document.getElementById('listing-step3-submit')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('listing-step3-form')
    if (!form.reportValidity()) return
    handleListingStepThreeSubmit(form)
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
