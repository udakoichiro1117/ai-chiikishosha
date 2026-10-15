import './style.css'
import { buildDefaultProducers, buildDefaultRequestText, DEMO_REGION, DEMO_LOCATION, DEMO_TIME, VEGETABLE_OPTIONS, REGION_BROAD_OPTIONS, OSAKA_CITY_OPTIONS } from './data.js'
import { parseRequestText, parseListingText, offGradeMentioned } from './parser.js'
import { computeAllocation, describeInventoryDiff, MATCH_RADIUS_KM } from './matching.js'
import { geocodeAddress } from './geo.js'
import { renderResultMap, destroyResultMap } from './map.js'

const STORAGE_KEY = 'ai-chiikishosha-state-v1'

/** @type {{
 *  screen: 'home'|'restaurant'|'producer'|'restaurant-register'|'producer-register',
 *  restaurantProfile: {storeName:string,postalCode:string,address:string,preferredRegion:string,defaultAllowOffGrade:boolean,lat?:number|null,lng?:number|null}|null,
 *  producerProfile: {farmName:string,postalCode:string,address:string,station:string,contactName:string,lat?:number|null,lng?:number|null}|null,
 *  producers: any[],
 *  requestText: string,
 *  parsed: {item:string,quantity:number,unit:string,neededDate:string,region:string,allowOffGrade:boolean,priceLimit:number|null,source:string}|null,
 *  result: any|null,
 *  resultSnapshot: any[]|null,
 *  savedPlans: any[],
 *  listingDraft: {item:string,availableDate:string,region:string,quantity?:number|null,unit?:string,unitPrice?:number|null,isOffGrade?:boolean,offGradeReason?:string,source?:string}|null,
 *  listingStep: 2|3,
 *  listingText: string,
 *  lastRole: 'restaurant'|'producer'|null,
 *  largeText: boolean,
 *  showResultMap: boolean
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
        return { restaurantProfile: null, producerProfile: null, listingDraft: null, listingStep: 2, listingText: '', lastRole: null, largeText: false, showResultMap: false, ...parsed, screen: 'home' }
      }
    }
  } catch (e) { /* 読めない場合は初期状態にする */ }
  return {
    screen: 'home',
    restaurantProfile: null,
    producerProfile: null,
    listingDraft: null,
    listingStep: 2,
    listingText: '',
    lastRole: null,
    largeText: false,
    showResultMap: false,
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
    // flashMessageは一時的なUI通知なので保存対象から除く(再読み込み時に再表示されないように)。
    const { flashMessage, ...persisted } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch (e) { /* 保存できなくても画面表示は継続する */ }
}

function setState(patch) {
  state = { ...state, ...patch }
  // 直近どちらの役割を開いたかを覚えておき、設定画面をその役割だけに絞り込む。
  if (patch.screen === 'restaurant' || patch.screen === 'restaurant-register') state.lastRole = 'restaurant'
  else if (patch.screen === 'producer' || patch.screen === 'producer-register') state.lastRole = 'producer'
  saveState()
  render()
}

let flashTimer = null
function showFlash(message, extraPatch = {}) {
  clearTimeout(flashTimer)
  setState({ ...extraPatch, flashMessage: message })
  flashTimer = setTimeout(() => setState({ flashMessage: null }), 2600)
}

function resetDemo() {
  state = {
    screen: state.screen,
    restaurantProfile: state.restaurantProfile,
    producerProfile: state.producerProfile,
    lastRole: state.lastRole,
    largeText: state.largeText,
    showResultMap: false,
    listingDraft: null,
    listingStep: 2,
    listingText: '',
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

function knownItemNames() {
  return [...new Set(state.producers.map(p => p.item))]
}

function itemOptions() {
  return [...new Set([...VEGETABLE_OPTIONS, ...knownItemNames()])]
}

function renderRegionOptions(selected) {
  const opt = (g) => `<option value="${escapeHtml(g)}" ${selected === g ? 'selected' : ''}>${escapeHtml(g)}</option>`
  return `
    <optgroup label="広域の目安">${REGION_BROAD_OPTIONS.map(opt).join('')}</optgroup>
    <optgroup label="大阪府の市">${OSAKA_CITY_OPTIONS.map(opt).join('')}</optgroup>
  `
}

// 郵便番号→住所変換(zipcloud、APIキー不要・ブラウザから直接呼び出し可能)。
// https://zipcloud.ibsnet.co.jp/doc/api
async function lookupAddressByZip(rawZip) {
  const zip = String(rawZip || '').replace(/[^0-9]/g, '')
  if (zip.length !== 7) return { ok: false, message: '郵便番号は7桁の数字で入力してください' }
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`)
    if (!res.ok) throw new Error(`http ${res.status}`)
    const json = await res.json()
    if (json.status !== 200 || !json.results || json.results.length === 0) {
      return { ok: false, message: '該当する住所が見つかりませんでした' }
    }
    const r = json.results[0]
    return { ok: true, address: `${r.address1}${r.address2}${r.address3}` }
  } catch (e) {
    return { ok: false, message: '住所の取得に失敗しました(通信エラー)' }
  }
}

function fmtNum(n) {
  if (n === null || n === undefined) return '―'
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

// 住所から取得した位置情報の有無を表示する(距離マッチングが使えているかの透明性のため)。
function renderGeoStatus(profile) {
  if (typeof profile.lat === 'number' && typeof profile.lng === 'number') {
    return `<p class="zip-msg">📍 位置情報を取得しました(半径${MATCH_RADIUS_KM}km以内の候補でマッチングします)</p>`
  }
  if (profile.address) {
    return `<p class="zip-msg">📍 位置情報を取得できませんでした。地域名でのマッチングになります</p>`
  }
  return ''
}

// ---------- イベントハンドラ ----------

async function tryAiParseGeneric(text, knownItems, mode, fallbackFn) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, knownItems, mode }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) throw new Error('api not ok')
    const json = await res.json()
    if (!json || typeof json !== 'object') throw new Error('invalid json')
    return { ...json, source: 'ai' }
  } catch (e) {
    return { ...fallbackFn(text, knownItems), source: 'rule' }
  }
}

function tryAiParse(text, knownItems) {
  return tryAiParseGeneric(text, knownItems, 'request', parseRequestText)
}

function tryAiParseListing(text, knownItems) {
  return tryAiParseGeneric(text, knownItems, 'listing', parseListingText)
}

// 音声入力(Web Speech API、ブラウザ標準・追加サーバー不要)。
// 対応していないブラウザ(iOS Safariの一部等)では、その旨をメッセージ欄に表示し、
// 手入力(自然文/構造化フォーム)にそのまま切り替えられるようにする。
function startVoiceInput(textareaId, msgId) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  const msgEl = document.getElementById(msgId)
  if (!SR) {
    if (msgEl) msgEl.textContent = 'お使いのブラウザは音声入力に対応していません。文章を直接入力してください。'
    return
  }
  const recognition = new SR()
  recognition.lang = 'ja-JP'
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  if (msgEl) msgEl.textContent = '聞き取り中…話してください'
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript
    const ta = document.getElementById(textareaId)
    if (ta) ta.value = (ta.value ? ta.value + ' ' : '') + text
    if (msgEl) msgEl.textContent = ''
  }
  recognition.onerror = () => { if (msgEl) msgEl.textContent = '聞き取れませんでした。もう一度お試しください。' }
  recognition.onend = () => { if (msgEl && msgEl.textContent === '聞き取り中…話してください') msgEl.textContent = '' }
  try { recognition.start() } catch (e) { if (msgEl) msgEl.textContent = '音声入力を開始できませんでした。' }
}

function readParsedForm() {
  return {
    item: document.getElementById('f-item').value || null,
    quantity: Number(document.getElementById('f-quantity').value) || null,
    unit: document.getElementById('f-unit').value,
    neededDate: document.getElementById('f-date').value || null,
    region: document.getElementById('f-region').value || null,
    priceLimit: document.getElementById('f-price').value ? Number(document.getElementById('f-price').value) : null,
    allowOffGrade: document.getElementById('f-offgrade').checked,
    lat: state.restaurantProfile?.lat ?? null,
    lng: state.restaurantProfile?.lng ?? null
  }
}

async function handleParseClick() {
  const text = document.getElementById('request-text').value
  setState({ requestText: text })
  const extracted = await tryAiParse(text, knownItemNames())
  // 自然文に地域・規格外可否の指定がなければ、登録済みの受取希望条件を既定値として補う。
  const prefs = state.restaurantProfile
  const parsed = { ...extracted }
  if (!parsed.region && prefs?.preferredRegion) parsed.region = prefs.preferredRegion
  if (extracted.source === 'rule' && !offGradeMentioned(text) && prefs) {
    parsed.allowOffGrade = prefs.defaultAllowOffGrade
  }
  setState({ parsed, result: null, resultSnapshot: null })
}

function handleDemoFill() {
  setState({ requestText: buildDefaultRequestText(), parsed: null, result: null, resultSnapshot: null })
}

function goToRestaurant() {
  setState({ screen: state.restaurantProfile ? 'restaurant' : 'restaurant-register' })
}

function goToProducer() {
  setState({ screen: state.producerProfile ? 'producer' : 'producer-register' })
}

function handleRestartRestaurant() {
  setState({ requestText: buildDefaultRequestText(), parsed: null, result: null, resultSnapshot: null, screen: 'restaurant' })
}

function handleRestartProducer() {
  setState({ listingDraft: null, listingStep: 2, listingText: '', screen: 'producer' })
}

function handleComputeClick() {
  const parsed = readParsedForm()
  const result = computeAllocation(parsed, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  setState({ parsed, result, resultSnapshot: snapshot })
}

function handleRecomputeClick() {
  const diffNotices = state.resultSnapshot ? describeInventoryDiff(state.resultSnapshot, state.producers) : []
  const result = computeAllocation(state.parsed, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  setState({ result: { ...result, diffNotices }, resultSnapshot: snapshot })
}

function handleSavePlan() {
  if (!state.result || state.result.status !== 'success') return
  const plan = { ...state.result, savedAt: new Date().toISOString(), requestSummary: state.requestText }
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
  const target = state.producers.find(p => p.id === id)
  const label = target ? `${target.farmName}・${target.item}(${fmtNum(target.quantity)}${target.unit})` : 'この出品'
  if (!window.confirm(`${label}を削除します。元に戻せません。よろしいですか？`)) return
  const producers = state.producers.filter(p => p.id !== id)
  setState({ producers })
}

// 住所をジオコーディングし、解決できれば緯度経度をプロフィールに追記する(マッチングの距離絞り込み用)。
// 入力が速く終わる画面遷移はブロックしない(バックグラウンドで実行し、終わり次第setStateで反映)。
// 解決時に住所が変わっていたら(ユーザーが再編集した等)、古い結果は破棄する。
async function geocodeAndAttach(profileKey, address) {
  const coords = await geocodeAddress(address)
  const current = state[profileKey]
  if (!coords || !current || current.address !== address) return
  setState({ [profileKey]: { ...current, lat: coords.lat, lng: coords.lng } })
}

function handleRestaurantRegisterSubmit(form) {
  const data = new FormData(form)
  const wasEdit = !!state.restaurantProfile
  const restaurantProfile = {
    storeName: String(data.get('storeName') || ''),
    postalCode: String(data.get('postalCode') || ''),
    address: String(data.get('address') || ''),
    preferredRegion: String(data.get('preferredRegion') || ''),
    defaultAllowOffGrade: data.get('defaultAllowOffGrade') === 'on',
    lat: null,
    lng: null
  }
  showFlash(wasEdit ? '受取条件を保存しました' : '受取条件を設定しました', { restaurantProfile, screen: 'restaurant' })
  geocodeAndAttach('restaurantProfile', restaurantProfile.address)
}

function handleRestaurantRegisterSkip() {
  const restaurantProfile = state.restaurantProfile || {
    storeName: '未設定の店舗',
    postalCode: '',
    address: '',
    preferredRegion: '',
    defaultAllowOffGrade: false
  }
  setState({ restaurantProfile, screen: 'restaurant' })
}

function handleProducerRegisterSubmit(form) {
  const data = new FormData(form)
  const wasEdit = !!state.producerProfile
  const producerProfile = {
    farmName: String(data.get('farmName') || ''),
    postalCode: String(data.get('postalCode') || ''),
    address: String(data.get('address') || ''),
    station: String(data.get('station') || ''),
    contactName: String(data.get('contactName') || ''),
    lat: null,
    lng: null
  }
  showFlash(wasEdit ? '農園情報を保存しました' : '農園情報を登録しました', { producerProfile, screen: 'producer' })
  geocodeAndAttach('producerProfile', producerProfile.address)
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

async function handleListingParseClick() {
  const text = document.getElementById('listing-text').value
  setState({ listingText: text })
  const extracted = await tryAiParseListing(text, itemOptions())
  const listingDraft = {
    item: extracted.item || '',
    availableDate: extracted.availableDate || '',
    region: extracted.region || DEMO_REGION,
    quantity: extracted.quantity ?? null,
    unit: extracted.unit || 'kg',
    unitPrice: extracted.unitPrice ?? null,
    isOffGrade: !!extracted.isOffGrade,
    offGradeReason: extracted.offGradeReason || '',
    source: extracted.source
  }
  setState({ listingDraft, listingStep: 3 })
}

function handleListingStepThreeSubmit(form) {
  const data = new FormData(form)
  const id = `P${Date.now()}`
  const producer = {
    id,
    farmName: state.producerProfile?.farmName || '新規農家',
    lat: state.producerProfile?.lat ?? null,
    lng: state.producerProfile?.lng ?? null,
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
  showFlash(`出品を登録しました(${producer.item} ${fmtNum(producer.quantity)}${producer.unit})`, {
    producers: [...state.producers, producer],
    listingDraft: null,
    listingStep: 2
  })
}

// ---------- 画面描画 ----------

function render() {
  const app = document.getElementById('app')
  app.innerHTML = `
    <div class="app-shell ${state.largeText ? 'large-text' : ''}">
      ${renderSidebar()}
      <div class="shell-main">
        ${state.flashMessage ? `<div class="flash-toast">✓ ${escapeHtml(state.flashMessage)}</div>` : ''}
        <main class="content">
          ${renderScreen()}
        </main>
        <footer class="scope-note">
          このMVPが示すのは「仕入れ案の作成」までです。注文確定・在庫予約・決済・配送手配は対象外で、結果は常に「未確保」です。
        </footer>
      </div>
    </div>
  `
  attachEvents()
  initResultMapIfNeeded()
}

// Leafletは実DOM要素が必要なため、innerHTML描画後(attachEvents後)にここで初期化する。
// コンテナが無ければ(地図を閉じている/条件未達の)場合は何もしない。
function initResultMapIfNeeded() {
  if (!document.getElementById('result-map')) {
    destroyResultMap()
    return
  }
  const r = state.result
  if (!r || r.status !== 'success') return
  const farmsWithDistance = r.allocation.filter(a => typeof a.distanceKm === 'number')
  if (farmsWithDistance.length === 0) return
  renderResultMap('result-map', {
    center: { lat: state.restaurantProfile.lat, lng: state.restaurantProfile.lng },
    centerLabel: state.restaurantProfile?.storeName || '受取地点',
    radiusKm: MATCH_RADIUS_KM,
    farms: farmsWithDistance.map(a => ({ farmName: a.farm.farmName, lat: a.farm.lat, lng: a.farm.lng, distanceKm: a.distanceKm }))
  })
}

function activeNavKey() {
  if (state.screen === 'restaurant' || state.screen === 'restaurant-register') return 'restaurant'
  if (state.screen === 'producer' || state.screen === 'producer-register') return 'producer'
  if (state.screen === 'records') return 'records'
  if (state.screen === 'settings') return 'settings'
  return 'home'
}

function renderSidebar() {
  const active = activeNavKey()
  const item = (key, icon, label) => `
    <button class="nav-item ${active === key ? 'active' : ''}" data-nav="${key}">
      <span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>
    </button>
  `
  return `
    <nav class="sidebar">
      <div class="sidebar-brand"><span class="sidebar-brand-icon">🌱</span>AI地域商社</div>
      <div class="sidebar-nav">
        ${item('home', '🏠', 'ホーム')}
        ${item('restaurant', '🛒', '仕入れ')}
        ${item('producer', '🌱', '出品')}
        ${item('records', '📖', '記録')}
        ${item('settings', '⚙️', '設定')}
      </div>
    </nav>
  `
}

// 生産者側は年齢層が比較的高いと想定し(研究ノート参照:ポケットマルシェ登録生産者の
// 平均年齢48歳、上昇傾向)、文字・ボタンを大きくし、見える項目数を絞ったUIにする。
// 飲食店側(三上さん想定・38歳)は通常サイズのまま。
function renderScreen() {
  switch (state.screen) {
    case 'home': return renderHome()
    case 'restaurant-register': return `<div class="role-restaurant">${renderRestaurantRegister()}</div>`
    case 'producer-register': return `<div class="role-producer">${renderProducerRegister()}</div>`
    case 'restaurant': return `<div class="role-restaurant">${renderRestaurant()}</div>`
    case 'producer': return `<div class="role-producer">${renderProducer()}</div>`
    case 'records': return renderRecords()
    case 'settings': return renderSettings()
    default: return renderHome()
  }
}

function renderDraftCard({ icon, title, preview, resumeKey, restartKey, role }) {
  return `
    <div class="draft-card role-${role}">
      <div class="draft-card-body">
        <span class="draft-icon">${icon}</span>
        <div class="draft-text">
          <div class="draft-title">${escapeHtml(title)}</div>
          <div class="draft-preview">${escapeHtml(preview || '')}</div>
        </div>
      </div>
      <div class="draft-actions">
        <button class="draft-resume" data-nav="${resumeKey}">続きから</button>
        <button class="draft-restart" data-restart="${restartKey}">最初から</button>
      </div>
    </div>
  `
}

function renderHome() {
  const hasAnyProfile = !!(state.restaurantProfile || state.producerProfile)
  const greeting = hasAnyProfile ? 'おかえりなさい 😀' : 'はじめまして 👋'

  const restaurantDraftActive = !!state.restaurantProfile
  const producerDraftActive = !!state.producerProfile && !!state.listingDraft
  const hasDrafts = restaurantDraftActive || producerDraftActive

  return `
    <section class="hero hero-compact">
      <p class="hero-greeting">${greeting}</p>
      <h1 class="hero-heading">今日も、関西のおいしいを見つけよう。</h1>
    </section>

    ${hasDrafts ? `
      <section class="draft-section">
        <p class="draft-label">入力の続きから再開できます。</p>
        ${restaurantDraftActive ? renderDraftCard({
          icon: '✏️',
          title: '仕入れの希望を入力中',
          preview: state.requestText,
          resumeKey: 'restaurant',
          restartKey: 'restart-restaurant',
          role: 'restaurant'
        }) : ''}
        ${producerDraftActive ? renderDraftCard({
          icon: '✏️',
          title: `出品を登録中(ステップ${state.listingStep === 3 ? 2 : 1}/2)`,
          preview: `${state.producerProfile.farmName}・${state.listingDraft.item || ''}`,
          resumeKey: 'producer',
          restartKey: 'restart-producer',
          role: 'producer'
        }) : ''}
      </section>
    ` : ''}

    <section class="cta-section">
      <p class="cta-label">どちらで使いますか？</p>
      <div class="cta-row">
        <button class="cta-btn cta-primary" data-nav="restaurant">
          <span class="cta-icon">🛒</span><span class="cta-text">仕入れ案を作る(飲食店)</span><span class="cta-arrow">→</span>
        </button>
        <button class="cta-btn cta-outline" data-nav="producer">
          <span class="cta-icon">🌱</span><span class="cta-text">販売できるものを登録(生産者)</span><span class="cta-plus">＋</span>
        </button>
      </div>
    </section>

    <details class="how-it-works">
      <summary>使い方を見る(4ステップの流れ)</summary>
      <p class="hero-sub">飲食店の「欲しい」と、農家さんの「売りたい」を、1つの仕入れ案にまとめます。</p>
      <div class="step-flow">
        <div class="step-item"><span class="step-icon">💬</span><span class="step-label">希望を入力</span></div>
        <span class="step-dots"></span>
        <div class="step-item"><span class="step-icon">✨</span><span class="step-label">AIが条件を整理</span></div>
        <span class="step-dots"></span>
        <div class="step-item"><span class="step-icon">🧑</span><span class="step-label">複数の農家を組み合わせ</span></div>
        <span class="step-dots"></span>
        <div class="step-item"><span class="step-icon">📄</span><span class="step-label">1つの仕入れ案</span></div>
      </div>
    </details>
  `
}

function renderRestaurantRegister() {
  const p = state.restaurantProfile || {}
  const isEdit = !!state.restaurantProfile
  return `
    <section class="panel">
      <h2>${isEdit ? '受取条件の編集' : '① 受取条件を設定'}</h2>
      <p class="hint">この画面の目的は店舗の登録ではなく、「欲しい食材・数量・受取条件を伝えること」の準備です。ここで決めた内容は次の②の初期値になり、自然文で省略しても自動的に補われます。あとからいつでも変更できます。</p>
      ${isEdit ? `
        <div class="current-settings">
          <span class="current-settings-label">現在の設定</span>
          <span>${escapeHtml(p.storeName || '(未設定)')}</span>
          <span>${escapeHtml(p.address || '住所未設定')}</span>
          <span>受取希望エリア:${escapeHtml(p.preferredRegion || '指定なし')}</span>
          <span>規格外:${p.defaultAllowOffGrade ? '基本許容' : '基本不可'}</span>
        </div>
      ` : ''}
      <form id="restaurant-register-form" class="form-grid">
        <label>店舗名<input name="storeName" type="text" required value="${escapeHtml(p.storeName || '')}" placeholder="例:小料理屋 みかみ" /></label>
        <label>郵便番号
          <div class="zip-row">
            <input id="restaurant-postal" name="postalCode" type="text" inputmode="numeric" value="${escapeHtml(p.postalCode || '')}" placeholder="例:530-0001" />
            <button type="button" class="zip-lookup-btn" data-zip-input="restaurant-postal" data-address-input="restaurant-address" data-msg="restaurant-zip-msg">住所を自動入力</button>
          </div>
          <span id="restaurant-zip-msg" class="zip-msg"></span>
        </label>
        <label>住所<input id="restaurant-address" name="address" type="text" value="${escapeHtml(p.address || '')}" placeholder="例:大阪市北区..." /></label>
        ${renderGeoStatus(p)}
        <label>受取希望エリア
          <select name="preferredRegion">
            <option value="" ${!p.preferredRegion ? 'selected' : ''}>指定なし</option>
            ${renderRegionOptions(p.preferredRegion)}
          </select>
        </label>
        <label class="checkbox">
          <input name="defaultAllowOffGrade" type="checkbox" ${p.defaultAllowOffGrade ? 'checked' : ''} />
          規格外・形の不揃い食材も基本的に許容する
        </label>
      </form>
      <div class="actions">
        <button id="restaurant-register-submit" class="primary">${isEdit ? '保存する' : '設定して進む'}</button>
        ${isEdit ? '<button id="cancel-register">変更せずに戻る</button>' : '<button id="restaurant-register-skip">スキップ(あとで設定する)</button>'}
      </div>
    </section>
  `
}

function renderProducerRegister() {
  const p = state.producerProfile || {}
  const isEdit = !!state.producerProfile
  return `
    <section class="panel">
      <h2>${isEdit ? '農園情報の編集' : '① 入口:農園情報の登録'}</h2>
      <p class="hint">初回のみ入力します。次回以降はこの端末で自動的にログイン状態が保たれ、この画面は表示されません。</p>
      ${isEdit ? `
        <div class="current-settings">
          <span class="current-settings-label">現在の設定</span>
          <span>${escapeHtml(p.farmName || '(未設定)')}</span>
          <span>${escapeHtml(p.address || '住所未設定')}</span>
          <span>${escapeHtml(p.station || '最寄り駅未設定')}</span>
        </div>
      ` : ''}
      <form id="producer-register-form" class="form-grid">
        <label>農園名<input name="farmName" type="text" required value="${escapeHtml(p.farmName || '')}" placeholder="例:森畠農園" /></label>
        <label>郵便番号
          <div class="zip-row">
            <input id="producer-postal" name="postalCode" type="text" inputmode="numeric" value="${escapeHtml(p.postalCode || '')}" placeholder="例:563-0131" />
            <button type="button" class="zip-lookup-btn" data-zip-input="producer-postal" data-address-input="producer-address" data-msg="producer-zip-msg">住所を自動入力</button>
          </div>
          <span id="producer-zip-msg" class="zip-msg"></span>
        </label>
        <label>住所<input id="producer-address" name="address" type="text" required value="${escapeHtml(p.address || '')}" placeholder="例:大阪府豊能郡能勢町..." /></label>
        ${renderGeoStatus(p)}
        <label>最寄り駅<input name="station" type="text" value="${escapeHtml(p.station || '')}" placeholder="例:能勢電鉄 山下駅" /></label>
        <label>担当者名<input name="contactName" type="text" value="${escapeHtml(p.contactName || '')}" placeholder="例:森畠正輝" /></label>
      </form>
      <div class="actions">
        <button id="producer-register-submit" class="primary">${isEdit ? '保存する' : '登録して進む'}</button>
        ${isEdit ? '<button id="cancel-register">変更せずに戻る</button>' : ''}
      </div>
    </section>
  `
}

function renderRestaurant() {
  const prefsLine = state.restaurantProfile
    ? [
        state.restaurantProfile.preferredRegion ? `受取希望:${state.restaurantProfile.preferredRegion}` : null,
        `規格外:${state.restaurantProfile.defaultAllowOffGrade ? '基本許容' : '基本不可'}`
      ].filter(Boolean).join(' / ')
    : ''
  return `
    <section class="panel profile-bar">
      <span>ログイン中:<strong>${escapeHtml(state.restaurantProfile?.storeName || '')}</strong>${prefsLine ? ` (${escapeHtml(prefsLine)})` : ''}</span>
      <button id="edit-restaurant-profile" class="edit-chip">✎ 受取条件を編集</button>
    </section>
    <section class="panel">
      <h2>② 欲しい食材・数量・受取条件を伝える</h2>
      <p class="hint">自然文のまま入力できます。(例:「明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK」)</p>
      <div class="actions demo-fill-row">
        <button id="demo-fill-btn" class="ghost-btn">【デモ用】明後日までに大阪近郊のトマトを10kg、形不揃いOK を入力</button>
        <button type="button" id="request-voice-btn" class="ghost-btn">🎤 音声で入力する</button>
      </div>
      <textarea id="request-text" rows="3">${escapeHtml(state.requestText)}</textarea>
      <p id="request-voice-msg" class="zip-msg"></p>
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
  const items = itemOptions()
  const missing = !p.item || !p.quantity || !p.unit || !p.neededDate
  return `
    <section class="panel">
      <h2>③ AIの整理結果を確認・修正</h2>
      <p class="hint">読み取り方式:${p.source === 'ai' ? 'AI(Gemini)' : 'ルールベース(AI停止時のフォールバック)'}。内容がおかしければここで直接修正できます。</p>
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
        <label>地域
          <select id="f-region">
            <option value="" ${!p.region ? 'selected' : ''}>指定なし</option>
            ${renderRegionOptions(p.region)}
          </select>
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
  const formula = r.allocation.map(a => `${escapeHtml(a.farm.farmName)} ${fmtNum(a.amount)}${a.farm.unit}`).join(' ＋ ')
  return `
    <section class="panel result success">
      <h2>④ 仕入れ案</h2>
      ${r.diffNotices && r.diffNotices.length ? `<p class="diff-notice">${r.diffNotices.map(escapeHtml).join(' ')}</p>` : ''}
      <p class="formula-line">${formula} ＝ <strong>${fmtNum(r.totalQuantity)}</strong></p>
      <div class="summary-line">
        <span>希望数量を満たすか<strong>満たす</strong></span>
        <span>いつ・どこで受け取るか<strong>${escapeHtml(r.neededDate)} ${escapeHtml(r.deliveryTime || '')} ${escapeHtml(r.deliveryLocation || '')}</strong></span>
        <span>費用はいくらか<strong>${fmtNum(r.totalPrice)}円(税込)</strong></span>
      </div>
      <div class="alloc-grid">
        ${r.allocation.map(a => `
          <div class="alloc-card">
            <div class="alloc-card-head">
              <span class="alloc-farm">${escapeHtml(a.farm.farmName)}</span>
              ${typeof a.distanceKm === 'number' ? `<span class="badge badge-distance">約${a.distanceKm.toFixed(1)}km</span>` : ''}
              ${a.farm.isOffGrade ? `<span class="badge badge-offgrade">規格外:${escapeHtml(a.farm.offGradeReason || '形の不揃い')}</span>` : '<span class="badge badge-normal">通常品</span>'}
            </div>
            <div class="alloc-amount">${fmtNum(a.amount)}<span class="alloc-unit">${escapeHtml(a.farm.unit)}</span></div>
            <div class="alloc-price">${fmtNum(a.amount * a.farm.unitPrice)}円<span class="alloc-unitprice">(${fmtNum(a.farm.unitPrice)}円/${escapeHtml(a.farm.unit)})</span></div>
          </div>
        `).join('')}
        <div class="alloc-card alloc-total">
          <div class="alloc-card-head"><span class="alloc-farm">合計</span></div>
          <div class="alloc-amount">${fmtNum(r.totalQuantity)}</div>
          <div class="alloc-price">${fmtNum(r.totalPrice)}円<span class="alloc-unitprice">(税込)</span></div>
        </div>
      </div>
      ${renderResultMapSection(r)}
      <p class="status-note">状態:農家承認前・在庫未確保。この案は注文確定ではありません。</p>
      <div class="actions">
        <button id="recompute-btn">在庫の最新状態で再計算</button>
        <button id="save-plan-btn" class="primary">案を保存(相談用)</button>
      </div>
    </section>
  `
}

function renderResultMapSection(r) {
  const hasMapData = r.allocation.some(a => typeof a.distanceKm === 'number')
  if (!hasMapData) {
    return `<p class="hint">住所(位置情報)を登録すると、ここに仕入れ先を地図で表示できます。</p>`
  }
  return `
    <div class="actions">
      <button type="button" id="toggle-result-map" class="ghost-btn">${state.showResultMap ? '地図を閉じる' : '🗺️ 地図で見る'}</button>
    </div>
    ${state.showResultMap ? '<div id="result-map" class="result-map"></div>' : ''}
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
      <p class="hint">話しかけるか文章で書くと、品目・数量・単価・出荷可能日などをAIがまとめて読み取ります。(例:「トマトが5キロ採れた。1キロ800円で明日出せる。大阪近郊で。」)</p>
      <div class="actions demo-fill-row">
        <button type="button" id="listing-voice-btn" class="ghost-btn">🎤 音声で入力する</button>
      </div>
      <textarea id="listing-text" rows="3">${escapeHtml(state.listingText || '')}</textarea>
      <p id="listing-voice-msg" class="zip-msg"></p>
      <div class="actions">
        <button type="button" id="listing-parse-btn" class="primary">AIで読み取る</button>
      </div>
    </section>

    <section class="panel">
      <h3>または、直接入力する</h3>
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
  const readModeNote = d.source
    ? `<p class="hint">読み取り方式:${d.source === 'ai' ? 'AI(Gemini)' : 'ルールベース'}。内容を確認し、必要なら修正してください。</p>`
    : ''
  return `
    <section class="panel">
      <h2>③ 供給条件を登録</h2>
      <p class="hint">品目:${escapeHtml(d.item)} / 出荷可能日:${escapeHtml(d.availableDate)} / 地域:${escapeHtml(d.region)}</p>
      ${readModeNote}
      <form id="listing-step3-form" class="form-grid">
        <label>数量<input name="quantity" type="number" min="0" step="0.1" required value="${d.quantity ?? ''}" /></label>
        <label>単位
          <select name="unit">
            ${['kg', '個', '本', '袋', '房'].map(u => `<option value="${u}" ${d.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </label>
        <label>単価(円)<input name="unitPrice" type="number" min="0" required value="${d.unitPrice ?? ''}" /></label>
        <label class="checkbox"><input name="isOffGrade" type="checkbox" ${d.isOffGrade ? 'checked' : ''} /> 規格外(余剰・形不揃い等)</label>
        <label>規格外理由(任意)<input name="offGradeReason" type="text" placeholder="形の不揃い" value="${escapeHtml(d.offGradeReason || '')}" /></label>
      </form>
      <details class="advanced-settings">
        <summary>受渡し等の詳しい設定(通常は変更しなくて大丈夫です)</summary>
        <div class="form-grid" style="margin-top:12px">
          <label>受渡場所<input form="listing-step3-form" name="deliveryLocation" type="text" value="${escapeHtml(DEMO_LOCATION)}" /></label>
          <label>受渡時間<input form="listing-step3-form" name="deliveryTime" type="text" value="${escapeHtml(DEMO_TIME)}" /></label>
          <label>最低販売量<input form="listing-step3-form" name="minQuantity" type="number" min="0" step="0.1" value="1" /></label>
          <label>販売刻み<input form="listing-step3-form" name="incrementStep" type="number" min="0.1" step="0.1" value="1" /></label>
        </div>
      </details>
      <div class="actions">
        <button id="listing-step3-back">← ②に戻る</button>
        <button id="listing-step3-submit" class="primary">登録する</button>
      </div>
    </section>
  `
}

function renderProducerTable() {
  return `
    <div class="table-scroll">
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
              <td class="table-actions">
                <button data-toggle-id="${p.id}" class="table-btn">${p.available === false ? '出荷再開' : '出荷停止'}</button>
                <button data-delete-id="${p.id}" class="table-btn table-btn-danger">削除</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `
}

function renderProducer() {
  return `
    <section class="panel profile-bar">
      <span>ログイン中:<strong>${escapeHtml(state.producerProfile?.farmName || '')}</strong>${state.producerProfile?.contactName ? `(${escapeHtml(state.producerProfile.contactName)})` : ''}</span>
      <button id="edit-producer-profile" class="edit-chip">✎ 農園情報を編集</button>
    </section>
    ${state.listingStep === 3 ? renderListingStepThree() : renderListingStepTwo()}

    <section class="panel">
      <h2>④ 登録結果を確認(飲食店への提案に使われる)</h2>
      ${renderProducerTable()}
      <p class="hint">⑤ 数量・公開状態を変えたら、飲食店タブで「在庫の最新状態で再計算」を押すと反映されます(在庫変動・欠品ケースのデモ)。</p>
    </section>
  `
}

function renderRecords() {
  return `
    <section class="panel">
      <h2>記録</h2>
      <p class="hint">保存した仕入れ案と、登録されている生産者の出品状況をまとめて確認できます。</p>
    </section>
    ${state.savedPlans.length ? renderSavedPlans() : '<section class="panel"><p class="hint">保存済みの仕入れ案はまだありません。②の「仕入れ案を作る」で成立案を保存するとここに表示されます。</p></section>'}
    <section class="panel">
      <h3>登録済みの生産者出品一覧</h3>
      ${renderProducerTable()}
    </section>
  `
}

function renderSettingsSwitch() {
  const role = state.lastRole
  return `
    <div class="settings-switch">
      <button class="settings-switch-btn ${role === 'restaurant' ? 'active' : ''}" data-settings-role="restaurant">飲食店の設定</button>
      <button class="settings-switch-btn ${role === 'producer' ? 'active' : ''}" data-settings-role="producer">生産者の設定</button>
    </div>
  `
}

function renderDisplaySettingsCard() {
  const on = !!state.largeText
  return `
    <section class="panel">
      <h3>表示設定</h3>
      <p class="hint">飲食店・生産者どちらの画面にも共通で適用される、文字・ボタンの大きさの設定です。</p>
      <div class="actions">
        <button id="toggle-large-text" class="${on ? 'primary' : ''}">${on ? '✓ 文字を大きく表示中(標準に戻す)' : '文字を大きくする'}</button>
      </div>
    </section>
  `
}

function renderDemoResetCard() {
  return `
    <section class="panel">
      <h3>デモ操作</h3>
      <p class="hint">在庫・保存済み案などをすべて初期状態(A/B/C農家)に戻します。プロフィールは維持されます。</p>
      <div class="actions"><button id="reset-demo">デモデータに戻す</button></div>
    </section>
  `
}

function renderSettings() {
  const role = state.lastRole

  if (!role) {
    return `
      <section class="panel">
        <h2>設定</h2>
        <p class="hint">「仕入れ」または「出品」を一度開くと、その役割の設定だけがここに表示されます。先に下から選ぶこともできます。</p>
        ${renderSettingsSwitch()}
      </section>
      ${renderDisplaySettingsCard()}
      ${renderDemoResetCard()}
    `
  }

  if (role === 'restaurant') {
    const r = state.restaurantProfile
    return `
      <section class="panel">
        <h2>設定(飲食店)</h2>
        ${renderSettingsSwitch()}
      </section>
      <section class="panel">
        <h3>受取条件</h3>
        ${r ? `
          <div class="current-settings">
            <span>${escapeHtml(r.storeName)}</span>
            <span>${escapeHtml(r.address || '住所未設定')}</span>
            <span>受取希望エリア:${escapeHtml(r.preferredRegion || '指定なし')}</span>
            <span>規格外:${r.defaultAllowOffGrade ? '基本許容' : '基本不可'}</span>
          </div>
        ` : '<p class="hint">まだ設定されていません。</p>'}
        <div class="actions"><button data-goto="restaurant-register" class="primary">${r ? '編集する' : '設定する'}</button></div>
      </section>
      ${renderDisplaySettingsCard()}
      ${renderDemoResetCard()}
    `
  }

  const p = state.producerProfile
  return `
    <section class="panel">
      <h2>設定(生産者)</h2>
      ${renderSettingsSwitch()}
    </section>
    <section class="panel">
      <h3>農園情報</h3>
      ${p ? `
        <div class="current-settings">
          <span>${escapeHtml(p.farmName)}</span>
          <span>${escapeHtml(p.address || '住所未設定')}</span>
          <span>${escapeHtml(p.station || '最寄り駅未設定')}</span>
        </div>
      ` : '<p class="hint">まだ登録されていません。</p>'}
      <div class="actions"><button data-goto="producer-register" class="primary">${p ? '編集する' : '登録する'}</button></div>
    </section>
    ${renderDisplaySettingsCard()}
    ${renderDemoResetCard()}
  `
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function attachEvents() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.nav
      if (key === 'restaurant') goToRestaurant()
      else if (key === 'producer') goToProducer()
      else setState({ screen: key })
    })
  })
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => setState({ screen: btn.dataset.goto }))
  })
  document.querySelectorAll('[data-settings-role]').forEach(btn => {
    btn.addEventListener('click', () => setState({ lastRole: btn.dataset.settingsRole }))
  })
  document.querySelectorAll('.zip-lookup-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const zipInput = document.getElementById(btn.dataset.zipInput)
      const addressInput = document.getElementById(btn.dataset.addressInput)
      const msgEl = document.getElementById(btn.dataset.msg)
      if (!zipInput || !addressInput) return
      btn.disabled = true
      if (msgEl) { msgEl.textContent = '検索中…'; msgEl.className = 'zip-msg' }
      const result = await lookupAddressByZip(zipInput.value)
      btn.disabled = false
      if (result.ok) {
        addressInput.value = result.address
        addressInput.focus()
        if (msgEl) { msgEl.textContent = ''; msgEl.className = 'zip-msg' }
      } else if (msgEl) {
        msgEl.textContent = result.message
        msgEl.className = 'zip-msg zip-msg-error'
      }
    })
  })
  document.querySelectorAll('[data-restart]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.restart === 'restart-restaurant') handleRestartRestaurant()
      else if (btn.dataset.restart === 'restart-producer') handleRestartProducer()
    })
  })
  document.getElementById('reset-demo')?.addEventListener('click', resetDemo)
  document.getElementById('toggle-large-text')?.addEventListener('click', () => setState({ largeText: !state.largeText }))

  document.getElementById('restaurant-register-submit')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('restaurant-register-form')
    if (!form.reportValidity()) return
    handleRestaurantRegisterSubmit(form)
  })
  document.getElementById('restaurant-register-skip')?.addEventListener('click', handleRestaurantRegisterSkip)
  document.getElementById('demo-fill-btn')?.addEventListener('click', handleDemoFill)
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

  document.getElementById('parse-btn')?.addEventListener('click', handleParseClick)
  document.getElementById('request-voice-btn')?.addEventListener('click', () => startVoiceInput('request-text', 'request-voice-msg'))
  document.getElementById('compute-btn')?.addEventListener('click', handleComputeClick)
  document.getElementById('recompute-btn')?.addEventListener('click', handleRecomputeClick)
  document.getElementById('save-plan-btn')?.addEventListener('click', handleSavePlan)
  document.getElementById('toggle-result-map')?.addEventListener('click', () => setState({ showResultMap: !state.showResultMap }))

  document.getElementById('listing-voice-btn')?.addEventListener('click', () => startVoiceInput('listing-text', 'listing-voice-msg'))
  document.getElementById('listing-parse-btn')?.addEventListener('click', handleListingParseClick)

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
