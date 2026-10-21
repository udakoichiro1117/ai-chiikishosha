import './style.css'
import { buildDefaultRequestText, DEMO_REGION, DEMO_LOCATION, DEMO_TIME, VEGETABLE_OPTIONS, REGION_BROAD_OPTIONS, OSAKA_CITY_OPTIONS } from './data.js'
import { parseRequestText, parseListingText, offGradeMentioned } from './parser.js'
import { computeAllocation, describeInventoryDiff, MATCH_RADIUS_KM } from './matching.js'
import { geocodeAddress } from './geo.js'
import { renderResultMap, destroyResultMap } from './map.js'
import { computeExpiryDate, daysUntil } from './freshness.js'
import { buildRescueSuggestions } from './rescue.js'

const STORAGE_KEY = 'ai-chiikishosha-state-v1'

/** @type {{
 *  screen: 'home'|'restaurant'|'producer'|'restaurant-register'|'producer-register',
 *  restaurantProfile: {storeName:string,postalCode:string,address:string,preferredRegion:string,defaultAllowOffGrade:boolean,lat?:number|null,lng?:number|null}|null,
 *  producerProfile: {farmName:string,postalCode:string,address:string,station:string,contactName:string,usualDeliveryLocation:string,usualDeliveryTime:string,lat?:number|null,lng?:number|null}|null,
 *  producers: any[],
 *  producersLoading: boolean,
 *  producersError: string|null,
 *  myOrders: any[],
 *  incomingOrders: any[],
 *  ordersLoading: boolean,
 *  ordersError: string|null,
 *  orderSubmitting: boolean,
 *  amendingLineKey: string|null,
 *  chatThreads: Record<string, any[]>,
 *  openChatKey: string|null,
 *  chatLoading: boolean,
 *  chatSubmitting: boolean,
 *  hubs: any[],
 *  showNewHubForm: boolean,
 *  demoSnapshotStatus: {configured:boolean,exists:boolean,savedAt:string|null}|null,
 *  demoSnapshotBusy: boolean,
 *  userEmail: string|null,
 *  userRole: 'restaurant'|'producer'|null,
 *  isAdmin: boolean,
 *  authSubmitting: boolean,
 *  authLinkSent: boolean,
 *  authError: string|null,
 *  requestText: string,
 *  parsed: {item:string,quantity:number,unit:string,neededDate:string,region:string,allowOffGrade:boolean,priceLimit:number|null,source:string}|null,
 *  result: any|null,
 *  resultSnapshot: any[]|null,
 *  listingDraft: {item:string,availableDate:string,region:string,quantity?:number|null,unit?:string,unitPrice?:number|null,isOffGrade?:boolean,offGradeReason?:string,source?:string}|null,
 *  listingStep: 2|3,
 *  listingText: string,
 *  listingSubmitting: boolean,
 *  listingSubmitError: string|null,
 *  photoResult: {item:string,isOffGrade:boolean,offGradeReason:string,source:string}|null,
 *  lastRole: 'restaurant'|'producer'|null,
 *  largeText: boolean,
 *  showResultMap: boolean
 * }} */
let state = loadState()

function loadState() {
  // ①入口は毎回「飲食店 / 生産者」の選択画面から始める(画面は保存しない)。
  // プロフィール(店舗名・住所等)と、入力途中のデータはlocalStorageから復元する。
  // これにより初回登録さえ済ませれば、2回目以降はログイン状態を保ったまま使える。
  // producers(出品一覧)はサーバー(api/listings)が唯一の正であり、localStorageには保存しない
  // (保存しておくと、他の端末からの変更が反映されないまま古いコピーが復元されてしまう)。
  // 読み込み直後は常に空配列+producersLoading:trueとし、fetchListings()で取得する。
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { restaurantProfile: null, producerProfile: null, listingDraft: null, listingStep: 2, listingText: '', photoResult: null, lastRole: null, largeText: false, showResultMap: false, ...parsed, producers: [], producersLoading: true, producersError: null, listingSubmitting: false, listingSubmitError: null, myOrders: [], incomingOrders: [], ordersLoading: true, ordersError: null, orderSubmitting: false, amendingLineKey: null, chatThreads: {}, openChatKey: null, chatLoading: false, chatSubmitting: false, hubs: [], showNewHubForm: false, demoSnapshotStatus: null, demoSnapshotBusy: false, userEmail: getUserEmail(), userRole: getUserRole(), isAdmin: getIsAdmin(), authSubmitting: false, authLinkSent: false, authError: null, screen: 'home' }
    }
  } catch (e) { /* 読めない場合は初期状態にする */ }
  return {
    screen: 'home',
    restaurantProfile: null,
    producerProfile: null,
    listingDraft: null,
    listingStep: 2,
    listingText: '',
    photoResult: null,
    lastRole: null,
    largeText: false,
    showResultMap: false,
    producers: [],
    producersLoading: true,
    producersError: null,
    listingSubmitting: false,
    listingSubmitError: null,
    myOrders: [],
    incomingOrders: [],
    ordersLoading: true,
    ordersError: null,
    orderSubmitting: false,
    amendingLineKey: null,
    chatThreads: {},
    openChatKey: null,
    chatLoading: false,
    chatSubmitting: false,
    hubs: [],
    showNewHubForm: false,
    demoSnapshotStatus: null,
    demoSnapshotBusy: false,
    userEmail: getUserEmail(),
    userRole: getUserRole(),
    isAdmin: getIsAdmin(),
    authSubmitting: false,
    authLinkSent: false,
    authError: null,
    requestText: buildDefaultRequestText(),
    parsed: null,
    result: null,
    resultSnapshot: null
  }
}

function saveState() {
  try {
    // flashMessageは一時的なUI通知、producers/orders関連はサーバーが正、*Submitting等は送信中フラグなので、
    // いずれも保存対象から除く(保存すると、例えば送信中のまま再読み込みした際に固まって見える)。
    const { flashMessage, producers, producersLoading, producersError, listingSubmitting, listingSubmitError, myOrders, incomingOrders, ordersLoading, ordersError, orderSubmitting, amendingLineKey, chatThreads, openChatKey, chatLoading, chatSubmitting, hubs, showNewHubForm, demoSnapshotStatus, demoSnapshotBusy, authSubmitting, authLinkSent, authError, ...persisted } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch (e) { /* 保存できなくても画面表示は継続する */ }
}

function setState(patch) {
  state = { ...state, ...patch }
  // 直近どちらの役割を開いたかを覚えておき、設定画面をその役割だけに絞り込む。
  if (patch.screen === 'restaurant' || patch.screen === 'restaurant-register' || patch.screen === 'rescue') state.lastRole = 'restaurant'
  else if (patch.screen === 'producer' || patch.screen === 'producer-register') state.lastRole = 'producer'
  saveState()
  render()
  if ('screen' in patch) pushScreenHistory(patch.screen)
}

// 画面遷移(state.screen)がURL/履歴に一切反映されていなかったため、ブラウザの「戻る」を
// 押すとアプリ内の前の画面ではなく、アプリの外(直前に見ていた別サイト等)へ離脱してしまう
// 不具合があった。ハッシュ(#画面名)でブラウザ履歴に積み、popstateで画面を復元することで、
// 「戻る」でアプリ内を1画面ずつ戻れるようにする。
const VALID_SCREENS = ['home', 'restaurant', 'restaurant-register', 'rescue', 'producer', 'producer-register', 'orders', 'settings']
let suppressHistoryPush = false
function pushScreenHistory(screen) {
  if (suppressHistoryPush) return
  const hash = `#${screen}`
  if (window.location.hash !== hash) window.history.pushState({ screen }, '', hash)
}
window.addEventListener('popstate', (e) => {
  const screen = (e.state && e.state.screen) || (VALID_SCREENS.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'home')
  suppressHistoryPush = true
  setState({ screen })
  suppressHistoryPush = false
})

let flashTimer = null
function showFlash(message, extraPatch = {}) {
  clearTimeout(flashTimer)
  setState({ ...extraPatch, flashMessage: message })
  flashTimer = setTimeout(() => setState({ flashMessage: null }), 2600)
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

// 共通受渡拠点の選択UI。固定リストではなく、生産者・飲食店が自分たちで登録していく
// 共有リストなので、既存の拠点から選ぶか、その場で新しい拠点を登録できるようにする。
// 拠点ごとに、現在その拠点を使っている出品数を数える。名前・住所だけでは
// 「ここを選んで大丈夫か」の判断材料が無いため、他の出品の利用状況を手がかりとして示す。
function renderHubPicker() {
  const usageCounts = {}
  for (const p of state.producers) {
    if (p.hubId) usageCounts[p.hubId] = (usageCounts[p.hubId] || 0) + 1
  }
  const options = state.hubs.map(h => {
    const count = usageCounts[h.id] || 0
    return `<option value="${h.id}">${escapeHtml(h.name)}(${escapeHtml(h.address)})・利用${count}件</option>`
  }).join('')
  const myHubs = state.hubs.filter(h => h.createdBy === getOwnerId())
  return `
    <div class="hub-picker">
      <label>共通受渡拠点(拠点受け渡しを選んだ場合のみ使います。他の出品の利用件数が多いほど、飲食店が1か所でまとめて受け取りやすくなります)
        <select form="listing-step3-form" name="hubId">
          <option value="">— 拠点を選ぶ —</option>
          ${options}
        </select>
      </label>
      <button type="button" id="new-hub-toggle" class="ghost-btn">${state.showNewHubForm ? 'キャンセル' : '+ 近くに使える拠点が無い場合はここから登録'}</button>
      ${state.showNewHubForm ? `
        <div class="hub-new-form">
          <label>拠点名<input id="new-hub-name" type="text" placeholder="例:能勢町 道の駅前" /></label>
          <label>住所・目印<input id="new-hub-address" type="text" placeholder="例:大阪府豊能郡能勢町○○" /></label>
          <button type="button" id="new-hub-submit" class="table-btn">この内容で登録する</button>
        </div>
      ` : ''}
      ${myHubs.length > 0 ? `
        <details class="hint-details">
          <summary>自分が登録した拠点を管理する(${myHubs.length}件)</summary>
          <ul class="hub-manage-list">
            ${myHubs.map(h => `
              <li>${escapeHtml(h.name)}(${escapeHtml(h.address)})
                <button type="button" class="table-btn table-btn-danger" data-hub-delete="${h.id}">削除</button>
              </li>
            `).join('')}
          </ul>
        </details>
      ` : ''}
    </div>
  `
}

// 出品一覧の「鮮度期限」セル。期限までの残り日数に応じて緊急度を色分け表示する。
function renderFreshnessCell(p) {
  const expiryDate = p.expiryDate || computeExpiryDate(p.availableDate, p.item)
  if (!expiryDate) return '―'
  const daysLeft = daysUntil(expiryDate)
  let urgency = 'ok'
  let label = `残り${daysLeft}日`
  if (daysLeft < 0) { urgency = 'expired'; label = '期限切れ' }
  else if (daysLeft === 0) { urgency = 'urgent'; label = '本日まで' }
  else if (daysLeft === 1) { urgency = 'urgent'; label = '明日まで' }
  else if (daysLeft <= 3) { urgency = 'soon' }
  return `<span class="freshness-badge freshness-${urgency}">${escapeHtml(expiryDate)}(${label})</span>`
}

// ---------- イベントハンドラ ----------

// 出品(producers)はapi/listingsを通じて全端末で共有される。所有権はパスワード等を伴わない
// 簡易な識別(端末ごとの匿名UUID)で確認するだけなので、本格的な本人認証ではない点に注意。
const DEVICE_ID_KEY = 'ai-chiikishosha-device-id'
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = (window.crypto?.randomUUID ? window.crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch (e) {
    return 'unknown-device'
  }
}

// ログイン(マジックリンク)していればそのメールアドレスを、していなければ端末の匿名UUIDを
// 所有権(ownerId)として使う。api側はUUIDかメールかを区別しないため、ログインは
// 「ownerIdとして使う値を切り替えるだけ」で完結する(api/auth.jsのコメント参照)。
// 既知の制約: ログイン前にUUIDで作成した出品・注文は、ログイン後はその端末からも
// 編集・削除できなくなる(自動移行は今回のスコープ外)。
const USER_EMAIL_KEY = 'ai-chiikishosha-user-email'
// 役割(飲食店/生産者)は1アカウントにつき1つに固定(api/auth.jsのコメント参照)。
// ログインリンク申請時に選んだ役割がここに保存され、ログイン中はその役割の画面だけを見せる。
const USER_ROLE_KEY = 'ai-chiikishosha-user-role'
// 管理者アカウント(api/auth.jsのADMIN_EMAILS)だけは役割固定の対象外。
// ログイン中でも「別の役割として使う」を表示し続け、両方の役割を行き来できるようにする。
const USER_IS_ADMIN_KEY = 'ai-chiikishosha-user-is-admin'
function getOwnerId() {
  try {
    return localStorage.getItem(USER_EMAIL_KEY) || getDeviceId()
  } catch (e) {
    return getDeviceId()
  }
}

function getUserEmail() {
  try {
    return localStorage.getItem(USER_EMAIL_KEY)
  } catch (e) {
    return null
  }
}

function getUserRole() {
  try {
    return localStorage.getItem(USER_ROLE_KEY)
  } catch (e) {
    return null
  }
}

function getIsAdmin() {
  try {
    return localStorage.getItem(USER_IS_ADMIN_KEY) === '1'
  } catch (e) {
    return false
  }
}

// ログイン中はアカウントに固定された役割を、未ログイン時は直近に開いた画面の役割を使う
// (未ログインのままでも仕入れ・出品の両方を試せるデモ的な使い方を維持するため)。
function effectiveRole() {
  return state.userRole || state.lastRole
}

async function fetchListings() {
  setState({ producersLoading: true, producersError: null })
  try {
    const res = await fetch('/api/listings')
    if (!res.ok) throw new Error('api not ok')
    const { listings } = await res.json()
    setState({ producers: listings, producersLoading: false, producersError: null })
  } catch (e) {
    setState({ producersLoading: false, producersError: '出品データの取得に失敗しました。通信状況を確認して、再読み込みしてください。' })
  }
}

// 自分が依頼した注文(飲食店視点)と、自分の農家宛に届いた依頼(生産者視点)の両方を取得する。
// 同じ端末で両方の役割を試せるデモ的な使い方も踏まえ、常に両方フェッチする。
async function fetchOrders() {
  setState({ ordersLoading: true })
  const deviceId = getOwnerId()
  try {
    const [mineRes, incomingRes] = await Promise.all([
      fetch(`/api/orders?role=restaurant&ownerId=${encodeURIComponent(deviceId)}`),
      fetch(`/api/orders?role=producer&ownerId=${encodeURIComponent(deviceId)}`)
    ])
    if (!mineRes.ok || !incomingRes.ok) throw new Error('api not ok')
    const mine = await mineRes.json()
    const incoming = await incomingRes.json()
    setState({ myOrders: mine.orders, incomingOrders: incoming.orders, ordersLoading: false, ordersError: null })
  } catch (e) {
    setState({ ordersLoading: false, ordersError: '注文データの取得に失敗しました。通信状況を確認して、再読み込みしてください。' })
  }
}

// 共通受渡拠点(Hub)は固定リストではなく、実際に使う生産者・飲食店が追記していく共有リスト。
async function fetchHubs() {
  try {
    const res = await fetch('/api/hubs')
    if (!res.ok) throw new Error('api not ok')
    const { hubs } = await res.json()
    setState({ hubs })
  } catch (e) {
    // 拠点一覧が取れなくても出品登録自体は続けられるようにし、エラーで止めない。
  }
}

async function handleCreateHub(name, address) {
  try {
    const res = await fetch('/api/hubs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address, createdBy: getOwnerId() })
    })
    if (!res.ok) throw new Error('api not ok')
    const { hub } = await res.json()
    setState({ hubs: [...state.hubs, hub] })
    return hub
  } catch (e) {
    showFlash('拠点の登録に失敗しました。通信状況を確認してください。')
    return null
  }
}

function handleNewHubToggle() {
  setState({ showNewHubForm: !state.showNewHubForm })
}

async function handleNewHubSubmit() {
  const name = document.getElementById('new-hub-name')?.value.trim() || ''
  const address = document.getElementById('new-hub-address')?.value.trim() || ''
  if (!name || !address) {
    showFlash('拠点名と住所の両方を入力してください')
    return
  }
  const hub = await handleCreateHub(name, address)
  if (hub) {
    setState({ showNewHubForm: false })
    showFlash(`拠点「${hub.name}」を登録しました。一覧から選んでください`)
  }
}

async function handleHubDelete(id) {
  const target = state.hubs.find(h => h.id === id)
  const label = target ? `${target.name}(${target.address})` : 'この拠点'
  if (!window.confirm(`${label}を削除します。元に戻せません。よろしいですか？`)) return
  try {
    const res = await fetch(`/api/hubs?id=${encodeURIComponent(id)}&createdBy=${encodeURIComponent(getOwnerId())}`, { method: 'DELETE' })
    if (!res.ok) {
      showFlash(res.status === 403 ? 'この拠点は別の端末で登録されたため削除できません' : '拠点の削除に失敗しました。通信状況を確認してください。')
      return
    }
    setState({ hubs: state.hubs.filter(h => h.id !== id) })
    showFlash(`${label}を削除しました`)
  } catch (e) {
    showFlash('拠点の削除に失敗しました。通信状況を確認してください。')
  }
}

// デモ運営者向け: 出品・注文・拠点・チャットは全利用者が同じ共有ストアを見ているため、
// 発表直前に誰かの操作でデモ用データが変わってしまっても、直前に保存した状態へ戻せるように
// する(api/snapshot.jsのコメント参照)。管理用キーはDEMO_ADMIN_KEY環境変数と照合される。
async function fetchSnapshotStatus() {
  try {
    const res = await fetch('/api/snapshot')
    if (!res.ok) throw new Error('api not ok')
    const status = await res.json()
    setState({ demoSnapshotStatus: status })
  } catch (e) {
    // 取得できなくても設定画面自体は問題なく使えるので、エラー表示はしない
  }
}

async function handleDemoSnapshotSave() {
  const adminKey = document.querySelector('#demo-admin-form input[name="adminKey"]')?.value || ''
  if (!adminKey) { showFlash('管理用キーを入力してください'); return }
  setState({ demoSnapshotBusy: true })
  try {
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', adminKey })
    })
    if (res.status === 403) { setState({ demoSnapshotBusy: false }); showFlash('管理用キーが違います'); return }
    if (!res.ok) throw new Error('api not ok')
    setState({ demoSnapshotBusy: false })
    showFlash('現在の状態を保存しました')
    fetchSnapshotStatus()
  } catch (e) {
    setState({ demoSnapshotBusy: false })
    showFlash('保存に失敗しました。通信状況を確認してください。')
  }
}

async function handleDemoSnapshotRestore() {
  const adminKey = document.querySelector('#demo-admin-form input[name="adminKey"]')?.value || ''
  if (!adminKey) { showFlash('管理用キーを入力してください'); return }
  if (!window.confirm('保存した状態に戻します。現在のデータは失われます。よろしいですか？')) return
  setState({ demoSnapshotBusy: true })
  try {
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', adminKey })
    })
    if (res.status === 403) { setState({ demoSnapshotBusy: false }); showFlash('管理用キーが違います'); return }
    if (res.status === 404) { setState({ demoSnapshotBusy: false }); showFlash('保存されたスナップショットがありません'); return }
    if (!res.ok) throw new Error('api not ok')
    setState({ demoSnapshotBusy: false })
    showFlash('保存した状態に戻しました')
    fetchListings()
    fetchOrders()
    fetchHubs()
  } catch (e) {
    setState({ demoSnapshotBusy: false })
    showFlash('復元に失敗しました。通信状況を確認してください。')
  }
}

// メールアドレスにワンタイムログインリンクを送る。パスワードは扱わない
// (api/auth.jsのコメント参照)。
async function handleAuthRequestLink(email, role) {
  setState({ authSubmitting: true, authError: null })
  try {
    const res = await fetch('/api/auth?action=request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role })
    })
    if (res.status === 409) {
      const { existingRole } = await res.json().catch(() => ({}))
      const label = existingRole === 'producer' ? '生産者' : '飲食店'
      setState({ authSubmitting: false, authError: `このメールアドレスは既に${label}として登録されています。「${label}として使う」を選んで送り直してください。` })
      return
    }
    if (!res.ok) throw new Error('api not ok')
    setState({ authSubmitting: false, authLinkSent: true })
  } catch (e) {
    setState({ authSubmitting: false, authError: 'ログインリンクの送信に失敗しました。メールアドレスをご確認のうえ、もう一度お試しください。' })
  }
}

function handleAuthLogout() {
  try {
    localStorage.removeItem(USER_EMAIL_KEY)
    localStorage.removeItem(USER_ROLE_KEY)
    localStorage.removeItem(USER_IS_ADMIN_KEY)
  } catch (e) { /* no-op */ }
  setState({ userEmail: null, userRole: null, isAdmin: false, authLinkSent: false, authError: null })
  // ログイン状態(=ownerId)が変わったので、自分の出品・注文一覧を取り直す。
  fetchListings()
  fetchOrders()
}

// 役割を選び直すための、明示的なリセット導線(renderRoleResetLink参照)。
// 画面内に「もう一方の役割」への切り替えボタンを常設しない代わりに、ホーム画面からの
// 選び直しという1つの経路に戻す。通常は匿名利用時だけ表示するが、管理者アカウント
// (isAdmin)はログイン中でも表示するため、その場合はuserRoleもあわせて解除する。
function handleRoleReset() {
  if (!window.confirm('別の役割として使います。ホーム画面に戻りますが、よろしいですか？')) return
  if (state.isAdmin) {
    try { localStorage.removeItem(USER_ROLE_KEY) } catch (e) { /* no-op */ }
    setState({ lastRole: null, userRole: null, screen: 'home' })
    return
  }
  setState({ lastRole: null, screen: 'home' })
}

// 起動時、メール内のログインリンク(?loginToken=...)を踏んでいればログイン状態にする。
async function handleAuthTokenFromUrl() {
  const token = new URLSearchParams(window.location.search).get('loginToken')
  if (!token) return
  window.history.replaceState(null, '', window.location.pathname) // トークンをURL・履歴から消す
  try {
    const res = await fetch('/api/auth?action=verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
    if (!res.ok) throw new Error('api not ok')
    const { email, role, isAdmin } = await res.json()
    localStorage.setItem(USER_EMAIL_KEY, email)
    // 管理者は役割を固定しない(userRoleは設定せず、直近開いた画面=lastRoleで判定させる)。
    if (isAdmin) {
      localStorage.setItem(USER_IS_ADMIN_KEY, '1')
    } else if (role) {
      localStorage.setItem(USER_ROLE_KEY, role)
    }
    showFlash(isAdmin ? `${email} で管理者としてログインしました` : `${email} でログインしました`, { userEmail: email, userRole: isAdmin ? null : (role || null), isAdmin: !!isAdmin })
    fetchListings()
    fetchOrders()
    fetchServerProfile(email)
  } catch (e) {
    showFlash('ログインリンクが無効か、有効期限が切れています。もう一度お試しください。')
  }
}

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

// 写真からの品目・規格外判定(数量は画像から推定できないため対象外。数量は音声/手入力で別途補う)。
// 画像解析にはルールベースの代替手段がないため、失敗時は null を返し、呼び出し側で
// 「手入力に切り替えてください」という案内を出す。
async function tryAiParsePhoto(base64, mimeType, knownItems) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000) // 画像解析はテキストより時間がかかるため長めに待つ
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'listing-photo', image: { data: base64, mimeType }, knownItems }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const json = await res.json()
    if (!json || typeof json !== 'object') return null
    return { item: json.item || '', isOffGrade: !!json.isOffGrade, offGradeReason: json.offGradeReason || '', source: 'ai' }
  } catch (e) {
    return null
  }
}

// 写真ファイルを縮小してJPEGのbase64に変換する(通信量削減・サーバー側の受け入れ上限対策)。
function resizeImageToBase64(file, maxDim = 768, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
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
  setState({ listingDraft: null, listingStep: 2, listingText: '', photoResult: null, listingSubmitError: null, screen: 'producer' })
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

// 仕入れ案を実際の依頼として生産者に送る。複数農家にまたがる場合は農家ごとにlineとして
// 送り、承認/却下は各農家が自分のlineにだけ行う(api/orders.js参照)。送信後はstate.result.orderId
// を記録してボタンを「依頼済み」表示にし、二重送信を防ぐ。
async function handleRequestOrder() {
  const r = state.result
  if (!r || r.status !== 'success' || r.orderId) return
  setState({ orderSubmitting: true })
  const deadlineHours = document.getElementById('order-deadline-select')?.value || '4'
  const payload = {
    requesterId: getOwnerId(),
    requesterName: state.restaurantProfile?.storeName || '',
    neededDate: r.neededDate,
    unit: r.allocation[0]?.farm.unit || 'kg',
    totalQuantity: r.totalQuantity,
    totalPrice: r.totalPrice,
    responseDeadline: computeResponseDeadline(deadlineHours),
    lines: r.allocation.map(a => ({
      listingId: a.farm.id,
      ownerId: a.farm.ownerId,
      farmName: a.farm.farmName,
      item: a.farm.item,
      amount: a.amount,
      unitPrice: a.farm.unitPrice,
      // 受け渡し方法は出品(生産者)側が決めたものをそのまま引き継ぐ(A+Bの組み合わせ: 農家ごとに異なってよい)。
      deliveryMethod: a.farm.deliveryMethod || 'pickup',
      deliveryLocation: a.farm.deliveryLocation || '',
      deliveryTime: a.farm.deliveryTime || ''
    }))
  }
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error('api not ok')
    const { order } = await res.json()
    const allConfirmed = order.lines.every(l => l.status === 'accepted')
    showFlash(allConfirmed ? '在庫確定の出品だったため、その場で仕入れが確定しました！' : '仕入れを依頼しました。生産者の承認をお待ちください', {
      result: { ...r, orderId: order.id },
      myOrders: [...state.myOrders, order],
      orderSubmitting: false
    })
  } catch (e) {
    setState({ orderSubmitting: false })
    showFlash('仕入れ依頼の送信に失敗しました。通信状況を確認してもう一度お試しください。')
  }
}

// おまかせ救済タブで選んだ出品をそのまま仕入れ案にする。品目を問わないおまかせ提案から
// 自ら選んだ時点で規格外は承知の上とみなし、allowOffGradeは常にtrueにして除外されないようにする。
// 他の農家の同品目在庫と自動的に組み合わされる場合もある(matching.jsの複数農家合成の仕組みをそのまま利用)。
function handleRescueAdopt(farmId) {
  const farm = state.producers.find(p => p.id === farmId)
  if (!farm) return
  const parsed = {
    item: farm.item,
    quantity: farm.quantity,
    unit: farm.unit,
    neededDate: farm.availableDate,
    region: state.restaurantProfile?.preferredRegion || farm.region,
    allowOffGrade: true,
    priceLimit: null,
    lat: state.restaurantProfile?.lat ?? null,
    lng: state.restaurantProfile?.lng ?? null
  }
  const result = computeAllocation(parsed, state.producers)
  const snapshot = state.producers.map(p => ({ id: p.id, farmName: p.farmName, quantity: p.quantity, unit: p.unit, available: p.available }))
  showFlash(`おまかせ救済から仕入れ案を作成しました(${farm.item} ${fmtNum(farm.quantity)}${farm.unit})`, {
    parsed,
    result,
    resultSnapshot: snapshot,
    requestText: `(おまかせ救済)${farm.farmName}の${farm.item} ${fmtNum(farm.quantity)}${farm.unit}を仕入れる`,
    screen: 'restaurant'
  })
}

// 出品の更新・削除は、作成時に記録したownerId(端末ごとの匿名UUID)が一致する場合のみ
// サーバー側で許可される。一致しない場合(=別の端末で登録された出品)は403が返るため、
// その旨をメッセージで案内する。いずれも楽観的更新(先に画面を更新)→失敗時はロールバック。
async function patchListing(id, patch) {
  const prev = state.producers
  setState({ producers: prev.map(p => p.id === id ? { ...p, ...patch } : p) })
  try {
    const res = await fetch(`/api/listings?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: getOwnerId(), ...patch })
    })
    if (!res.ok) {
      setState({ producers: prev })
      showFlash(res.status === 403 ? 'この出品は別の端末で登録されたため変更できません' : '出品の更新に失敗しました。通信状況を確認してください。')
    }
  } catch (e) {
    setState({ producers: prev })
    showFlash('出品の更新に失敗しました。通信状況を確認してください。')
  }
}

function handleProducerQuantityChange(id, value) {
  const quantity = Number(value)
  if (value === '' || Number.isNaN(quantity) || quantity < 0) {
    showFlash('数量は0以上の数で入力してください')
    fetchListings() // 不正な値を入力した欄を、サーバー上の正しい値で表示し直す(無言で0にしない)
    return
  }
  patchListing(id, { quantity })
}

function handleProducerAvailabilityToggle(id) {
  const target = state.producers.find(p => p.id === id)
  if (!target) return
  patchListing(id, { available: !target.available })
}

async function handleProducerDelete(id) {
  const target = state.producers.find(p => p.id === id)
  const label = target ? `${target.farmName}・${target.item}(${fmtNum(target.quantity)}${target.unit})` : 'この出品'
  if (!window.confirm(`${label}を削除します。元に戻せません。よろしいですか？`)) return
  try {
    const res = await fetch(`/api/listings?id=${encodeURIComponent(id)}&ownerId=${encodeURIComponent(getOwnerId())}`, { method: 'DELETE' })
    if (!res.ok) {
      showFlash(res.status === 403 ? 'この出品は別の端末で登録されたため削除できません' : '出品の削除に失敗しました。通信状況を確認してください。')
      return
    }
    setState({ producers: state.producers.filter(p => p.id !== id) })
  } catch (e) {
    showFlash('出品の削除に失敗しました。通信状況を確認してください。')
  }
}

// 生産者が自分の農家のline(listingId)にだけ承認/却下できる。承認すると、該当出品の
// quantityがサーバー側で減る(api/orders.js参照)ため、成功時はproducersも更新し直す。
async function handleOrderLineRespond(orderId, listingId, status) {
  const prev = state.incomingOrders
  setState({
    incomingOrders: prev.map(o => o.id === orderId
      ? { ...o, lines: o.lines.map(l => l.listingId === listingId ? { ...l, status } : l) }
      : o)
  })
  try {
    const res = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: getOwnerId(), listingId, status })
    })
    if (!res.ok) {
      showFlash(
        res.status === 403 ? 'この依頼は自分の出品ではないため操作できません'
        : res.status === 409 ? 'この依頼はすでに処理済み、または期限切れのため操作できません'
        : '承認/却下の送信に失敗しました。通信状況を確認してください。'
      )
      await fetchOrders() // 最新の状態(期限切れ等)を取り直して表示を合わせる
      return
    }
    showFlash(status === 'accepted' ? '仕入れ依頼を承認しました' : '仕入れ依頼を却下しました')
    if (status === 'accepted') fetchListings() // 在庫が減っているはずなので出品一覧も最新化する
  } catch (e) {
    setState({ incomingOrders: prev })
    showFlash('承認/却下の送信に失敗しました。通信状況を確認してください。')
  }
}

async function handleOrderCancel(orderId) {
  if (!window.confirm('この仕入れ依頼を取り消します。よろしいですか？')) return
  try {
    const res = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}&ownerId=${encodeURIComponent(getOwnerId())}`, { method: 'DELETE' })
    if (!res.ok) {
      showFlash('依頼の取り消しに失敗しました。通信状況を確認してください。')
      return
    }
    setState({ myOrders: state.myOrders.filter(o => o.id !== orderId) })
  } catch (e) {
    showFlash('依頼の取り消しに失敗しました。通信状況を確認してください。')
  }
}

// 注文内の1農家分(line)を一意に特定するキー。事後修正フォームの開閉、
// チャットスレッドの特定など、line単位のUI状態を扱う箇所で共通して使う。
function orderLineKey(orderId, listingId) {
  return `${orderId}:${listingId}`
}

// 承認後に天候等で実際に用意できる量が減った場合、生産者が承認済みlineを減額できる。
// インライン編集フォームの開閉だけを行う(送信はhandleOrderLineAmendSubmitで行う)。
function handleOrderLineAmendToggle(orderId, listingId) {
  const key = orderLineKey(orderId, listingId)
  setState({ amendingLineKey: state.amendingLineKey === key ? null : key })
}

async function handleOrderLineAmendSubmit(orderId, listingId, form) {
  const data = new FormData(form)
  const newAmount = Number(data.get('newAmount'))
  const reason = String(data.get('reason') || '').trim()
  if (!(newAmount >= 0) || !reason) return

  const prev = state.incomingOrders
  setState({
    incomingOrders: prev.map(o => o.id === orderId
      ? { ...o, lines: o.lines.map(l => l.listingId === listingId ? { ...l, amendedAmount: newAmount, amendedReason: reason } : l) }
      : o),
    amendingLineKey: null
  })
  try {
    const res = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: getOwnerId(), listingId, action: 'amend', newAmount, reason })
    })
    if (!res.ok) {
      setState({ incomingOrders: prev })
      showFlash(res.status === 400 ? '修正内容が正しくありません(現在の数量より少ない値を入力してください)' : '数量の修正に失敗しました。通信状況を確認してください。')
      return
    }
    showFlash('数量の修正を飲食店に伝えました')
  } catch (e) {
    setState({ incomingOrders: prev })
    showFlash('数量の修正に失敗しました。通信状況を確認してください。')
  }
}

// 注文1件の中の1農家分(line)ごとのチャット(メルカリの取引チャットをイメージ)。
// やり取りできるのはその当事者2者(依頼した飲食店・その農家)だけで、
// 一度に開けるスレッドは1つに絞る(amendingLineKeyと同じ作法)。
function handleChatToggle(orderId, listingId) {
  const key = orderLineKey(orderId, listingId)
  if (state.openChatKey === key) {
    setState({ openChatKey: null })
    return
  }
  setState({ openChatKey: key })
  if (!state.chatThreads[key]) fetchChatThread(orderId, listingId)
}

async function fetchChatThread(orderId, listingId) {
  const key = orderLineKey(orderId, listingId)
  setState({ chatLoading: true })
  try {
    const res = await fetch(`/api/messages?orderId=${encodeURIComponent(orderId)}&listingId=${encodeURIComponent(listingId)}&ownerId=${encodeURIComponent(getOwnerId())}`)
    if (!res.ok) throw new Error('api not ok')
    const { messages } = await res.json()
    setState({ chatThreads: { ...state.chatThreads, [key]: messages }, chatLoading: false })
  } catch (e) {
    setState({ chatLoading: false })
    showFlash('メッセージの取得に失敗しました。通信状況を確認してください。')
  }
}

async function handleChatSend(orderId, listingId, form) {
  const key = orderLineKey(orderId, listingId)
  const text = String(new FormData(form).get('text') || '').trim()
  if (!text) return
  setState({ chatSubmitting: true })
  try {
    const res = await fetch(`/api/messages?orderId=${encodeURIComponent(orderId)}&listingId=${encodeURIComponent(listingId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: getOwnerId(), text })
    })
    if (!res.ok) throw new Error('api not ok')
    const { message } = await res.json()
    setState({
      chatThreads: { ...state.chatThreads, [key]: [...(state.chatThreads[key] || []), message] },
      chatSubmitting: false
    })
  } catch (e) {
    setState({ chatSubmitting: false })
    showFlash('メッセージの送信に失敗しました。通信状況を確認してください。')
  }
}

// ログイン済み(userEmail)のアカウントだけ、受取条件・農園情報をサーバーにも保存する
// (api/profile.jsのコメント参照)。匿名利用時はこれまで通りlocalStorageだけで完結させる。
// 失敗してもこの端末にはローカル保存済みなので、そのまま使い続けられる(致命的ではない)。
async function fetchServerProfile(ownerId) {
  try {
    const res = await fetch(`/api/profile?ownerId=${encodeURIComponent(ownerId)}`)
    if (!res.ok) return
    const { restaurantProfile, producerProfile } = await res.json()
    const patch = {}
    if (restaurantProfile) patch.restaurantProfile = restaurantProfile
    if (producerProfile) patch.producerProfile = producerProfile
    if (Object.keys(patch).length > 0) setState(patch)
  } catch (e) { /* 取得できなくても、この端末にローカル保存済みの内容で続行できる */ }
}

function pushServerProfile(patch) {
  if (!state.userEmail) return
  fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId: getOwnerId(), ...patch })
  }).catch(() => { /* サーバー保存に失敗しても、この端末には保存済みなので致命的ではない */ })
}

// 住所をジオコーディングし、解決できれば緯度経度をプロフィールに追記する(マッチングの距離絞り込み用)。
// 入力が速く終わる画面遷移はブロックしない(バックグラウンドで実行し、終わり次第setStateで反映)。
// 解決時に住所が変わっていたら(ユーザーが再編集した等)、古い結果は破棄する。
async function geocodeAndAttach(profileKey, address) {
  const coords = await geocodeAddress(address)
  const current = state[profileKey]
  if (!coords || !current || current.address !== address) return
  const updated = { ...current, lat: coords.lat, lng: coords.lng }
  setState({ [profileKey]: updated })
  pushServerProfile({ [profileKey]: updated })
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
  pushServerProfile({ restaurantProfile })
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
    // 普段の受け渡し場所・時間帯(例:直売所)。出品登録のたびに入力し直さず、
    // ここで一度登録した内容を既定値として使い回す(双方向マッチングの一環)。
    usualDeliveryLocation: String(data.get('usualDeliveryLocation') || ''),
    usualDeliveryTime: String(data.get('usualDeliveryTime') || ''),
    lat: null,
    lng: null
  }
  showFlash(wasEdit ? '農園情報を保存しました' : '農園情報を登録しました', { producerProfile, screen: 'producer' })
  pushServerProfile({ producerProfile })
  geocodeAndAttach('producerProfile', producerProfile.address)
}

function handleListingStepTwoNext(form) {
  const data = new FormData(form)
  const photo = state.photoResult
  const listingDraft = {
    item: String(data.get('item') || '') || photo?.item || '',
    availableDate: String(data.get('availableDate') || ''),
    region: String(data.get('region') || DEMO_REGION),
    isOffGrade: !!photo?.isOffGrade,
    offGradeReason: photo?.offGradeReason || '',
    source: photo?.source
  }
  setState({ listingDraft, listingStep: 3, photoResult: null })
}

async function handleListingParseClick() {
  const text = document.getElementById('listing-text').value
  setState({ listingText: text })
  const extracted = await tryAiParseListing(text, itemOptions())
  // 写真で品目・規格外の判定済みなら、それを優先して採用する(数量・単価・日付は声/文章の値を使う)。
  const photo = state.photoResult
  const listingDraft = {
    item: photo?.item || extracted.item || '',
    availableDate: extracted.availableDate || '',
    region: extracted.region || DEMO_REGION,
    quantity: extracted.quantity ?? null,
    unit: extracted.unit || 'kg',
    unitPrice: extracted.unitPrice ?? null,
    isOffGrade: !!(photo?.isOffGrade || extracted.isOffGrade),
    offGradeReason: photo?.offGradeReason || extracted.offGradeReason || '',
    source: extracted.source
  }
  setState({ listingDraft, listingStep: 3, photoResult: null })
}

async function handleListingPhotoChange(input) {
  const file = input.files?.[0]
  if (!file) return
  const msgEl = document.getElementById('listing-photo-msg')
  if (msgEl) msgEl.textContent = '📷 写真を解析しています…'
  try {
    const { base64, mimeType } = await resizeImageToBase64(file)
    const result = await tryAiParsePhoto(base64, mimeType, itemOptions())
    if (!result || !result.item) {
      if (msgEl) msgEl.textContent = '写真から品目を判定できませんでした。品目は直接入力するか、声で伝えてください。'
      return
    }
    setState({ photoResult: result })
    if (msgEl) {
      msgEl.textContent = `📷 判定結果:${result.item} / ${result.isOffGrade ? `規格外(${result.offGradeReason || '形の不揃い'})` : '通常品'}。数量は声か直接入力で伝えてください。`
    }
  } catch (e) {
    if (msgEl) msgEl.textContent = '写真の解析に失敗しました。品目は直接入力するか、声で伝えてください。'
  } finally {
    input.value = ''
  }
}

async function handleListingStepThreeSubmit(form) {
  const data = new FormData(form)
  const deliveryMethod = String(data.get('deliveryMethod') || '')
  const hubId = String(data.get('hubId') || '')

  if (deliveryMethod === 'hub') {
    if (!hubId) {
      setState({ listingSubmitError: '共通受渡拠点を選択してください(無ければ新しい拠点を登録できます)' })
      return
    }
  }
  const hub = state.hubs.find(h => h.id === hubId)

  const payload = {
    ownerId: getOwnerId(),
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
    stockStatus: String(data.get('stockStatus') || ''),
    deliveryMethod,
    // 拠点受け渡しの場合は、選んだ拠点の名前・住所をそのまま受渡場所として使う(自由記述を上書き)。
    deliveryLocation: deliveryMethod === 'hub' && hub ? `${hub.name}(${hub.address})` : String(data.get('deliveryLocation') || ''),
    deliveryTime: String(data.get('deliveryTime') || ''),
    hubId: deliveryMethod === 'hub' ? hubId : null,
    minQuantity: Number(data.get('minQuantity') || 1),
    incrementStep: Number(data.get('incrementStep') || 1),
    deliveryFee: Number(data.get('deliveryFee') || 0)
  }
  setState({ listingSubmitting: true, listingSubmitError: null })
  try {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error('api not ok')
    const { listing } = await res.json()
    showFlash(`出品を登録しました(${listing.item} ${fmtNum(listing.quantity)}${listing.unit})`, {
      producers: [...state.producers, listing],
      listingDraft: null,
      listingStep: 2,
      listingSubmitting: false
    })
  } catch (e) {
    setState({ listingSubmitting: false, listingSubmitError: '出品の登録に失敗しました。通信状況を確認してもう一度お試しください。' })
  }
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
          このMVPでは、仕入れ案の作成から、生産者ごとの承認・却下による注文確定、在庫反映までを行います。決済や配送網そのものの構築は対象外です。
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

// ボトムナビは「ホーム・役割スロット・プロフィール」の3項目に絞っている(以前は
// 仕入れ・おまかせ救済・出品・注文・設定の最大6項目があり、スマホで誤タップしやすかった)。
// おまかせ救済・注文は各役割画面内のタブ(renderRestaurantTabBar/renderProducerTabBar)に
// 統合したため、画面としては残っていてもボトムナビ上の独立項目ではなくなった。
// そのぶん「今どの役割の文脈にいるか」をハイライトで示す必要があるため、
// rescue/ordersもそれぞれ該当する役割スロットにマッピングする。
function activeNavKey() {
  if (state.screen === 'restaurant' || state.screen === 'restaurant-register' || state.screen === 'rescue') return 'restaurant'
  if (state.screen === 'producer' || state.screen === 'producer-register') return 'producer'
  if (state.screen === 'orders') return effectiveRole() === 'producer' ? 'producer' : 'restaurant'
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
  // 役割スロットは1つだけ表示する。ログイン中はuserRole、未ログインでも直近に開いた
  // 画面(lastRole)が分かっていればそちらを優先し、何も分からなければ仕入れを既定にする。
  // 反対側の役割を試したい場合はホーム画面の2ブロックから切り替える。
  const roleSlot = effectiveRole() === 'producer'
    ? item('producer', '🌱', '出品')
    : item('restaurant', '🛒', '仕入れ')
  return `
    <nav class="sidebar">
      <div class="sidebar-brand"><span class="sidebar-brand-icon">🌱</span>AI地域商社</div>
      <div class="sidebar-nav">
        ${item('home', '🏠', 'ホーム')}
        ${roleSlot}
        ${item('settings', '👤', 'プロフィール')}
      </div>
    </nav>
  `
}

// 仕入れ・おまかせ救済・注文状況は、すべて飲食店の文脈の中の1画面として扱う。
// data-nav属性は既存のナビクリックハンドラをそのまま再利用する(ボトムナビと同じ仕組み)。
function renderRestaurantTabBar(active) {
  const tab = (key, icon, label) => `
    <button class="subtab ${active === key ? 'active' : ''}" data-nav="${key}">${icon} ${label}</button>
  `
  return `
    <div class="subtab-bar">
      ${tab('restaurant', '🛒', '仕入れを作る')}
      ${tab('rescue', '⏰', 'おまかせ救済')}
      ${tab('orders', '📦', '注文状況')}
    </div>
  `
}

function renderProducerTabBar(active) {
  const tab = (key, icon, label) => `
    <button class="subtab ${active === key ? 'active' : ''}" data-nav="${key}">${icon} ${label}</button>
  `
  return `
    <div class="subtab-bar">
      ${tab('producer', '🌱', '出品する')}
      ${tab('orders', '📦', '届いた注文')}
    </div>
  `
}

// 「注文」「設定」は仕入れ・出品と違い役割別のdivで囲まれておらず、ホーム画面の
// 色分けされたゲートを通ってもこの2画面だけ色の手がかりが消えてしまっていた。
// 直近使っていた役割(effectiveRole())が分かっていれば、同じ色分けを適用する。
function renderRoleWrapped(html) {
  const role = effectiveRole()
  if (!role) return html
  return `<div class="role-${role}">${html}</div>`
}

// 生産者側は年齢層が比較的高いと想定し(研究ノート参照:ポケットマルシェ登録生産者の
// 平均年齢48歳、上昇傾向)、文字・ボタンを大きくし、見える項目数を絞ったUIにする。
// 飲食店側(三上さん想定・38歳)は通常サイズのまま。
function renderScreen() {
  switch (state.screen) {
    case 'home': return renderHome()
    case 'restaurant-register': return `<div class="role-restaurant">${renderRestaurantRegister()}</div>`
    case 'producer-register': return `<div class="role-producer">${renderProducerRegister()}</div>`
    case 'restaurant': return `<div class="role-restaurant">${renderRestaurantTabBar('restaurant')}${renderRestaurant()}</div>`
    case 'rescue': return `<div class="role-restaurant">${renderRestaurantTabBar('rescue')}${renderRescue()}</div>`
    case 'producer': return `<div class="role-producer">${renderProducerTabBar('producer')}${renderProducer()}</div>`
    case 'orders': {
      const role = effectiveRole()
      const tabBar = role === 'producer' ? renderProducerTabBar('orders') : role === 'restaurant' ? renderRestaurantTabBar('orders') : ''
      return renderRoleWrapped(`${tabBar}${renderOrders()}`)
    }
    case 'settings': return renderRoleWrapped(renderSettings())
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

    <section class="role-gate">
      <p class="role-gate-label">${effectiveRole() ? '' : 'どちらで使いますか？'}</p>
      <div class="role-gate-blocks">
        ${effectiveRole() !== 'producer' ? `
        <button class="role-gate-block role-gate-restaurant" data-nav="restaurant">
          <span class="role-gate-decor" aria-hidden="true">🏪</span>
          <span class="role-gate-title">飲食店</span>
          <span class="role-gate-action">仕入れ案を作る<span class="role-gate-arrow">→</span></span>
          <p class="role-gate-why">欲しい量を伝えるだけで、近隣の複数の農家から自動で組み合わせます</p>
        </button>` : ''}
        ${effectiveRole() !== 'restaurant' ? `
        <button class="role-gate-block role-gate-producer" data-nav="producer">
          <span class="role-gate-decor" aria-hidden="true">🌾</span>
          <span class="role-gate-title">生産者</span>
          <span class="role-gate-action">今日出せる量を登録する<span class="role-gate-arrow">→</span></span>
          <p class="role-gate-why">規格外・余剰品にも、自分で値段をつけて出品できます</p>
        </button>` : ''}
      </div>
      ${!state.userEmail ? `<p class="role-gate-login-hint">登録済みの方は<button type="button" class="link-btn" data-nav="settings">ログイン</button>から</p>` : ''}
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

// 「今すぐの操作に必要な説明」ではなく「背景・理由の補足」にあたる長い文章を、
// 既定で畳んだ状態にする(①長い説明文の折りたたみ化)。操作に直結する説明
// (入力例・選択肢の挙動説明・不可逆な変更の注意書き等)はここでは畳まず、常に見せる。
function renderCollapsibleHint(text) {
  return `
    <details class="hint-details">
      <summary>ℹ️ 詳しく</summary>
      <p class="hint">${text}</p>
    </details>
  `
}

function renderRestaurantRegister() {
  const p = state.restaurantProfile || {}
  const isEdit = !!state.restaurantProfile
  return `
    ${isEdit ? '' : `
      <details class="panel value-prop">
        <summary>なぜこのアプリ？</summary>
        <p>中央卸売市場で直接買い付けるには資格や実績が必要で、個人店にはハードルが高いのが実情です。かといって、出品中の農家を毎回1件ずつ見比べて選ぶのも大変です。</p>
        <p>このアプリでは、欲しい食材・量を伝えるだけで、近隣の複数の農家から必要な分だけをAIが自動で組み合わせます。1軒で足りなければ、他の農家を足して希望量ちょうどに。</p>
      </details>
    `}
    <section class="panel">
      <h2>${isEdit ? '受取条件の編集' : '① 受取条件を設定'}</h2>
      ${renderCollapsibleHint('この画面の目的は店舗の登録ではなく、「欲しい食材・数量・受取条件を伝えること」の準備です。ここで決めた内容は次の②の初期値になり、自然文で省略しても自動的に補われます。あとからいつでも変更できます。')}
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
    ${isEdit ? '' : `
      <details class="panel value-prop">
        <summary>なぜこのアプリ？</summary>
        <p>卸売市場では、形が不揃いな規格外品や、見積もりより多く穫れた余剰分は、値段がつかず出荷できないことがあります。</p>
        <p>このアプリでは、そうした規格外・余剰の食材にも自分で値段をつけて、近隣の飲食店に直接販売できます。捨てるはずだったものが、収入になります。</p>
      </details>
    `}
    <section class="panel">
      <h2>${isEdit ? '農園情報の編集' : '① 入口:農園情報の登録'}</h2>
      ${renderCollapsibleHint('初回のみ入力します。次回以降はこの端末で自動的にログイン状態が保たれ、この画面は表示されません。')}
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
        <label>普段の受け渡し場所<input name="usualDeliveryLocation" type="text" value="${escapeHtml(p.usualDeliveryLocation || '')}" placeholder="例:森畠農園 直売所前" /></label>
        <label>普段の受け渡し時間帯<input name="usualDeliveryTime" type="text" value="${escapeHtml(p.usualDeliveryTime || '')}" placeholder="例:10:00〜12:00" /></label>
      </form>
      ${renderCollapsibleHint('ここで登録した場所・時間帯は、出品登録のたびに初期値として使われます(出品ごとに個別に変更することもできます)。飲食店にはこの場所まで受け取りに来てもらいます。')}
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
    ${renderProducersStatus()}
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
      ${r.reason ? `<p class="allocation-reason">💡 ${escapeHtml(r.reason)}</p>` : ''}
      <div class="summary-line">
        <span>希望数量を満たすか<strong>満たす</strong></span>
        <span>ご希望の受取エリア<strong>${escapeHtml(state.restaurantProfile?.preferredRegion || '指定なし')}</strong></span>
        <span>実際の受け渡し場所<strong>${escapeHtml(r.neededDate)} ${escapeHtml(r.deliveryTime || '')} ${escapeHtml(r.deliveryLocation || '')}</strong></span>
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
            <div class="alloc-delivery">${renderDeliveryMethodLabel(a.farm)}</div>
          </div>
        `).join('')}
        <div class="alloc-card alloc-total">
          <div class="alloc-card-head"><span class="alloc-farm">合計</span></div>
          <div class="alloc-amount">${fmtNum(r.totalQuantity)}</div>
          <div class="alloc-price">${fmtNum(r.totalPrice)}円<span class="alloc-unitprice">(税込)</span></div>
        </div>
      </div>
      ${renderResultMapSection(r)}
      ${renderOrderRequestSection(r)}
      ${r.orderId ? '' : `
        <div class="actions">
          <button id="recompute-btn">在庫の最新状態で再計算</button>
        </div>
      `}
    </section>
  `
}

// 注文全体の状態は保存せず、常にlinesから導出する(別フィールドでの二重管理を避けるため)。
function summarizeOrderStatus(order) {
  const statuses = order.lines.map(l => l.status)
  if (statuses.every(s => s === 'accepted')) return { label: '確定(全農家が承認済み)', tone: 'ok' }
  if (statuses.some(s => s === 'rejected' || s === 'expired')) return { label: '一部却下・期限切れあり(内容をご確認ください)', tone: 'urgent' }
  return { label: '生産者の承認待ち', tone: 'soon' }
}

// 返信期限のプリセット(時間単位)。選択値から実時刻(ISO文字列)を計算する。
const RESPONSE_DEADLINE_PRESETS = [
  { value: '1', label: '1時間以内' },
  { value: '4', label: '4時間以内' },
  { value: '12', label: '本日中(12時間以内)' },
  { value: '24', label: '明日まで(24時間以内)' }
]
function computeResponseDeadline(hours) {
  return new Date(Date.now() + Number(hours) * 60 * 60 * 1000).toISOString()
}

function renderOrderRequestSection(r) {
  if (!r.orderId) {
    return `
      <p class="status-note">状態:在庫確定の出品はこの場で即確定します。見込みの出品は生産者の承認待ちになります。</p>
      <label class="checkbox">見込み品の返信期限
        <select id="order-deadline-select">
          ${RESPONSE_DEADLINE_PRESETS.map(p => `<option value="${p.value}" ${p.value === '4' ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </label>
      <p class="hint">期限を過ぎても生産者から返事が無い場合、自動的に「期限切れ」としてキャンセルされます。いつまでも待たされることはありません。</p>
      <div class="actions">
        <button id="request-order-btn" class="primary" ${state.orderSubmitting ? 'disabled' : ''}>${state.orderSubmitting ? '依頼しています…' : 'この内容で仕入れを依頼する'}</button>
      </div>
    `
  }
  const order = state.myOrders.find(o => o.id === r.orderId)
  if (!order) {
    return `<p class="status-note">状態:依頼済み(読み込み中…)</p>`
  }
  const summary = summarizeOrderStatus(order)
  return `
    <p class="status-note">状態:<span class="freshness-badge freshness-${summary.tone}">${escapeHtml(summary.label)}</span></p>
    <ul class="order-line-list">
      ${order.lines.map(l => `<li>${escapeHtml(l.farmName)}・${escapeHtml(l.item)} ${fmtNum(effectiveLineAmount(l))}${escapeHtml(order.unit)}・${renderDeliveryMethodLabel(l)}:${renderOrderLineLabel(l.status)}${renderAmendInfo(l, order.unit)}</li>`).join('')}
    </ul>
    ${order.lines.some(l => l.status === 'pending') && order.responseDeadline ? `<p class="hint">返信期限:${new Date(order.responseDeadline).toLocaleString('ja-JP')}</p>` : ''}
    <div class="next-actions">
      <p class="next-actions-label">次にできること</p>
      <div class="actions">
        <button type="button" data-nav="orders" class="table-btn">注文タブで詳細を見る・農家にメッセージを送る</button>
        <button type="button" id="restart-after-order-btn" class="table-btn">別の仕入れ案も作る</button>
      </div>
    </div>
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

function renderRescue() {
  const suggestions = buildRescueSuggestions(state.producers, state.restaurantProfile, new Date())
  return `
    <section class="panel">
      <h2>⏰ おまかせフードロス救済</h2>
      <p class="hint">期限が近い近隣の余剰を、品目を問わずおまかせで提案します。メニューの穴埋めにどうぞ。</p>
      ${renderCollapsibleHint(`対象の目安:鮮度期限が近い(葉物は当日〜翌日、果菜類は2〜3日)、近隣(半径${MATCH_RADIUS_KM}km)の出品です。`)}
      ${renderProducersStatus()}
      ${suggestions.length === 0
        ? `<p class="hint">いまのところ、期限が近い近隣の余剰はありません。</p>`
        : `<div class="rescue-grid">${suggestions.map(renderRescueCard).join('')}</div>`
      }
    </section>
  `
}

function renderRescueCard(s) {
  const { farm, daysLeft, distanceKm: dist } = s
  const urgency = daysLeft <= 0 ? 'urgent' : 'soon'
  const urgencyLabel = daysLeft <= 0 ? '本日中が期限' : '明日までが期限'
  return `
    <div class="rescue-card">
      <div class="rescue-card-head">
        <span class="freshness-badge freshness-${urgency}">${urgencyLabel}</span>
        ${typeof dist === 'number' ? `<span class="badge badge-distance">約${dist.toFixed(1)}km</span>` : ''}
        ${farm.isOffGrade ? `<span class="badge badge-offgrade">規格外:${escapeHtml(farm.offGradeReason || '形の不揃い')}</span>` : '<span class="badge badge-normal">通常品</span>'}
      </div>
      <div class="rescue-item">${escapeHtml(farm.item)}<span class="rescue-qty">${fmtNum(farm.quantity)}${escapeHtml(farm.unit)}</span></div>
      <div class="rescue-meta">${escapeHtml(farm.farmName)}・単価${fmtNum(farm.unitPrice)}円/${escapeHtml(farm.unit)}</div>
      <div class="actions">
        <button type="button" data-rescue-adopt="${farm.id}" class="primary">この内容で仕入れ案を作る</button>
      </div>
    </div>
  `
}

function renderListingStepTwo() {
  const d = state.listingDraft || {}
  const photo = state.photoResult
  const prefillItem = d.item || photo?.item || ''
  return `
    <section class="panel">
      <h2>② 出品内容を入力</h2>
      <p class="hint">泥がついた手でもすぐ使えるように、写真を撮るだけで品目・規格外の判定をAIが行います。数量は声で伝えてください。</p>
      <div class="actions demo-fill-row">
        <label class="ghost-btn photo-capture-btn">
          📷 写真を撮る(品目・規格外を自動判定)
          <input type="file" id="listing-photo-input" accept="image/*" capture="environment" style="display:none" />
        </label>
      </div>
      <p id="listing-photo-msg" class="zip-msg">${photo ? `📷 判定結果:${escapeHtml(photo.item)} / ${photo.isOffGrade ? `規格外(${escapeHtml(photo.offGradeReason || '形の不揃い')})` : '通常品'}。数量は声か直接入力で伝えてください。` : ''}</p>
    </section>

    <section class="panel">
      <p class="hint">話しかけるか文章で書くと、品目・数量・単価・出荷可能日などをAIがまとめて読み取ります。(例:「5キロ採れた。1キロ800円で明日出せる。大阪近郊で。」。写真で品目判定済みなら品目は省略できます)</p>
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
        <label>品目<input name="item" type="text" required value="${escapeHtml(prefillItem)}" placeholder="例:トマト" /></label>
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
      <fieldset class="delivery-method-choice">
        <legend>受け渡し方法(いずれか選んでください)</legend>
        <label class="checkbox"><input form="listing-step3-form" type="radio" name="deliveryMethod" value="deliver" required /> 🚚 自分で配達する</label>
        <label class="checkbox"><input form="listing-step3-form" type="radio" name="deliveryMethod" value="pickup" required /> 🏃 お店に取りに来てもらう</label>
        <label class="checkbox"><input form="listing-step3-form" type="radio" name="deliveryMethod" value="hub" required /> 🏠 共通受渡拠点で渡す</label>
      </fieldset>
      ${renderHubPicker()}
      <fieldset class="delivery-method-choice">
        <legend>在庫状況(どちらか選んでください)</legend>
        <label class="checkbox"><input form="listing-step3-form" type="radio" name="stockStatus" value="confirmed" required /> ✅ もう収穫済み(在庫あり・すぐ出せる)</label>
        <label class="checkbox"><input form="listing-step3-form" type="radio" name="stockStatus" value="estimated" required /> 🌱 まだ見込み(収穫前)</label>
      </fieldset>
      <p class="hint">「収穫済み」を選ぶと、飲食店が仕入れを依頼した時点で承認不要ですぐ確定します。「見込み」は、依頼が来た後にあなたが承認/却下できます。</p>
      <details class="advanced-settings">
        <summary>受渡し等の詳しい設定(通常は変更しなくて大丈夫です)</summary>
        <div class="form-grid" style="margin-top:12px">
          <label>受渡場所の目安(引き取りの場合は集合場所)<input form="listing-step3-form" name="deliveryLocation" type="text" value="${escapeHtml(state.producerProfile?.usualDeliveryLocation || DEMO_LOCATION)}" /></label>
          <label>受渡時間帯<input form="listing-step3-form" name="deliveryTime" type="text" value="${escapeHtml(state.producerProfile?.usualDeliveryTime || DEMO_TIME)}" /></label>
          <label>最低販売量<input form="listing-step3-form" name="minQuantity" type="number" min="0" step="0.1" value="1" /></label>
          <label>販売刻み<input form="listing-step3-form" name="incrementStep" type="number" min="0.1" step="0.1" value="1" /></label>
        </div>
      </details>
      ${state.listingSubmitError ? `<p class="warn">${escapeHtml(state.listingSubmitError)}</p>` : ''}
      <div class="actions">
        <button id="listing-step3-back" ${state.listingSubmitting ? 'disabled' : ''}>← ②に戻る</button>
        <button id="listing-step3-submit" class="primary" ${state.listingSubmitting ? 'disabled' : ''}>${state.listingSubmitting ? '登録しています…' : '登録する'}</button>
      </div>
    </section>
  `
}

// 出品一覧(producers)はapi/listingsから全端末共有で取得する。読み込み中・失敗時の状態と、
// 手動更新ボタンをここでまとめて表示する(リアルタイム同期ではなく、画面を開く/押すたびに最新化する方式)。
function renderProducersStatus() {
  if (state.producersLoading) return `<p class="hint">出品データを読み込み中…</p>`
  if (state.producersError) {
    return `<p class="warn">${escapeHtml(state.producersError)} <button type="button" data-refresh-listings class="table-btn">再読み込み</button></p>`
  }
  return `<div class="actions"><button type="button" data-refresh-listings class="ghost-btn">🔄 最新の状態に更新</button></div>`
}

// 出品一覧は全生産者共有のため、自分以外の行にも編集欄・操作ボタンをそのまま出すと、
// 触ってから初めて「別の端末で登録されたため変更できません」と弾かれることになり紛らわしい。
// 自分の出品かどうかをここで判定し、他人の行は数量を数値のまま表示して操作ボタンも出さない
// ようにする(サーバー側の403チェック自体は変えず、UI側で事前に区別するだけ)。
function renderProducerTable() {
  const ownerId = getOwnerId()
  return `
    <div class="table-scroll">
      <table class="producer-table">
        <thead><tr><th>農家</th><th>品目</th><th>数量</th><th>単価</th><th>出荷可能日</th><th>鮮度期限</th><th>規格外</th><th>在庫状況</th><th>受け渡し</th><th>状態</th><th></th></tr></thead>
        <tbody>
          ${state.producers.map(p => {
            const isOwn = p.ownerId === ownerId
            return `
            <tr class="${p.available === false ? 'unavailable' : ''}">
              <td>${escapeHtml(p.farmName)}${isOwn ? ' <span class="own-badge">自分の出品</span>' : ''}</td>
              <td>${escapeHtml(p.item)}</td>
              <td>${isOwn
                ? `<input type="number" min="0" step="0.1" value="${p.quantity}" data-qty-id="${p.id}" style="width:5em" />${escapeHtml(p.unit)}`
                : `${fmtNum(p.quantity)}${escapeHtml(p.unit)}`}</td>
              <td>${fmtNum(p.unitPrice)}円</td>
              <td>${escapeHtml(p.availableDate || '')}</td>
              <td>${renderFreshnessCell(p)}</td>
              <td>${p.isOffGrade ? `規格外(${escapeHtml(p.offGradeReason || '')})` : '通常品'}</td>
              <td>${renderStockStatusLabel(p)}</td>
              <td>${renderDeliveryMethodLabel(p)}</td>
              <td>${p.available === false ? '出荷不可' : '出荷可能'}</td>
              <td class="table-actions">
                ${isOwn ? `
                  <button data-toggle-id="${p.id}" class="table-btn">${p.available === false ? '出荷再開' : '出荷停止'}</button>
                  <button data-delete-id="${p.id}" class="table-btn table-btn-danger">削除</button>
                ` : '―'}
              </td>
            </tr>`
          }).join('')}
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
      ${renderProducersStatus()}
      ${renderProducerTable()}
      <p class="hint">⑤ 数量・公開状態を変えたら、飲食店タブで「在庫の最新状態で再計算」を押すと反映されます(在庫変動・欠品ケースのデモ)。</p>
    </section>
  `
}

// 注文(orders)もlistingsと同じく全端末共有で取得する。読み込み中・失敗時の表示と
// 手動更新ボタンはrenderProducersStatus()と同じ作法。
function renderOrdersStatus() {
  if (state.ordersLoading) return `<p class="hint">注文データを読み込み中…</p>`
  if (state.ordersError) {
    return `<p class="warn">${escapeHtml(state.ordersError)} <button type="button" data-refresh-orders class="table-btn">再読み込み</button></p>`
  }
  return `<div class="actions"><button type="button" data-refresh-orders class="ghost-btn">🔄 最新の状態に更新</button></div>`
}

function renderOrders() {
  const role = effectiveRole()
  if (!role) {
    return `
      <section class="panel">
        <h2>注文</h2>
        <p class="hint">「仕入れ」または「出品」をホーム画面から選ぶと、その役割の注文状況だけがここに表示されます。</p>
      </section>
    `
  }
  return role === 'restaurant' ? renderMyOrders() : renderIncomingOrders()
}

function renderOrderLineLabel(status) {
  if (status === 'accepted') return '承認済み'
  if (status === 'rejected') return '却下'
  if (status === 'expired') return '期限切れ(自動却下)'
  return '承認待ち'
}

// 承認後に天候等の事情で数量が減らされた場合の実際の数量。未修正ならそのまま元の数量。
function effectiveLineAmount(l) {
  return l.amendedAmount ?? l.amount
}

// 事後修正があった場合の注記(当初の数量→修正後の数量、理由)。無い場合は空文字。
function renderAmendInfo(l, unit) {
  if (l.amendedAmount == null) return ''
  return `<p class="warn">⚠️ 当初${fmtNum(l.amount)}${escapeHtml(unit)}→${fmtNum(l.amendedAmount)}${escapeHtml(unit)}に変更(理由:${escapeHtml(l.amendedReason || '')})</p>`
}

// 在庫状況(収穫済み・在庫確定 / 見込み・収穫前)の表示。出品オブジェクトを受け取る。
function renderStockStatusLabel(p) {
  return p.stockStatus === 'confirmed' ? '✅ 在庫確定' : '🌱 見込み'
}

// 受け渡し方法(A:生産者が配達/B:お店が引き取り)の表示。出品・注文lineの両方で
// 同じ形のオブジェクト({deliveryMethod, deliveryLocation, deliveryTime})を受け取れる。
function renderDeliveryMethodLabel(d) {
  if (d.deliveryMethod === 'deliver') {
    return `🚚 生産者が配達${d.deliveryTime ? `(${escapeHtml(d.deliveryTime)})` : ''}`
  }
  const place = [d.deliveryLocation, d.deliveryTime].filter(Boolean).map(escapeHtml).join('・')
  if (d.deliveryMethod === 'hub') {
    return `🏠 共通受渡拠点${place ? `(${place})` : ''}`
  }
  return `🏃 お店が引き取り${place ? `(${place})` : ''}`
}

function renderMyOrders() {
  return `
    <section class="panel">
      <h2>依頼した仕入れ</h2>
      ${renderOrdersStatus()}
      ${state.myOrders.length === 0
        ? `<p class="hint">まだ仕入れを依頼していません。「仕入れ」タブの④で仕入れ案を作ると依頼できます。</p>`
        : `<div class="order-grid">${state.myOrders.slice().reverse().map(renderMyOrderCard).join('')}</div>`}
    </section>
  `
}

function renderMyOrderCard(order) {
  const summary = summarizeOrderStatus(order)
  const cancellable = order.lines.every(l => l.status === 'pending')
  return `
    <div class="order-card">
      <div class="order-card-head">
        <span class="freshness-badge freshness-${summary.tone}">${escapeHtml(summary.label)}</span>
        <span class="hint">${new Date(order.createdAt).toLocaleString('ja-JP')}</span>
      </div>
      <ul class="order-line-list">
        ${order.lines.map(l => renderMyOrderLine(order, l)).join('')}
      </ul>
      <div class="order-total">合計 ${fmtNum(order.totalQuantity)}${escapeHtml(order.unit)}・${fmtNum(order.totalPrice)}円</div>
      ${order.lines.some(l => l.status === 'pending') && order.responseDeadline ? `<p class="hint">返信期限:${new Date(order.responseDeadline).toLocaleString('ja-JP')}</p>` : ''}
      ${cancellable ? `<div class="actions"><button type="button" data-order-cancel="${order.id}" class="table-btn table-btn-danger">依頼を取り消す</button></div>` : ''}
    </div>
  `
}

function renderMyOrderLine(order, l) {
  return `<li>
    ${escapeHtml(l.farmName)}・${escapeHtml(l.item)} ${fmtNum(effectiveLineAmount(l))}${escapeHtml(order.unit)}(${fmtNum(effectiveLineAmount(l) * l.unitPrice)}円)・${renderDeliveryMethodLabel(l)}:${renderOrderLineLabel(l.status)}${renderAmendInfo(l, order.unit)}
    ${renderChatToggleButton(order, l)}
    ${renderChatPanel(order, l)}
  </li>`
}

function renderIncomingOrders() {
  const deviceId = getOwnerId()
  return `
    <section class="panel">
      <h2>届いた仕入れ依頼</h2>
      ${renderOrdersStatus()}
      ${state.incomingOrders.length === 0
        ? `<p class="hint">まだ仕入れ依頼は届いていません。</p>`
        : `<div class="order-grid">${state.incomingOrders.slice().reverse().map(o => renderIncomingOrderCard(o, deviceId)).join('')}</div>`}
    </section>
  `
}

function renderIncomingOrderCard(order, deviceId) {
  return `
    <div class="order-card">
      <div class="order-card-head">
        <span class="hint">${escapeHtml(order.requesterName || '飲食店')}より・${new Date(order.createdAt).toLocaleString('ja-JP')}</span>
      </div>
      <ul class="order-line-list">
        ${order.lines.map(l => renderIncomingOrderLine(order, l, deviceId)).join('')}
      </ul>
      ${order.lines.some(l => l.status === 'pending') && order.responseDeadline ? `<p class="hint">返信期限:${new Date(order.responseDeadline).toLocaleString('ja-JP')}(過ぎると自動的に期限切れになります)</p>` : ''}
    </div>
  `
}

// 承認後に天候等で実際に用意できる量が減った場合、自分の農家のline(accepted)にだけ
// 「数量を修正する」を出す。pending中は従来通り承認/却下ボタンを出す。
function renderIncomingOrderLine(order, l, deviceId) {
  const mine = l.ownerId === deviceId
  const lineKey = orderLineKey(order.id, l.listingId)
  const isAmending = state.amendingLineKey === lineKey

  let actionHtml = `:${renderOrderLineLabel(l.status)}${mine ? '' : '(他の農家の出品)'}`
  if (mine && l.status === 'pending') {
    actionHtml = `<span class="order-line-actions">
        <button type="button" data-order-respond data-order-id="${order.id}" data-listing-id="${l.listingId}" data-status="accepted" class="table-btn">承認</button>
        <button type="button" data-order-respond data-order-id="${order.id}" data-listing-id="${l.listingId}" data-status="rejected" class="table-btn table-btn-danger">却下</button>
      </span>`
  } else if (mine && l.status === 'accepted' && l.amendedAmount == null) {
    actionHtml = `:${renderOrderLineLabel(l.status)}
      <button type="button" data-order-amend-toggle data-order-id="${order.id}" data-listing-id="${l.listingId}" class="table-btn">数量を修正する</button>`
  }

  const amendForm = isAmending ? `
    <form class="amend-line-form" data-order-id="${order.id}" data-listing-id="${l.listingId}">
      <label>実際に用意できる数量(現在:${fmtNum(effectiveLineAmount(l))}${escapeHtml(order.unit)})
        <input type="number" name="newAmount" min="0" max="${effectiveLineAmount(l) - (order.unit === 'kg' ? 0.1 : 1)}" step="${order.unit === 'kg' ? '0.1' : '1'}" required />
      </label>
      <p class="hint">※ 現在の数量(${fmtNum(effectiveLineAmount(l))}${escapeHtml(order.unit)})より少ない値のみ入力できます(増量は対象外です)</p>
      <label>理由<input type="text" name="reason" placeholder="例:長雨で収穫が減った" required /></label>
      <div class="actions">
        <button type="submit" class="primary table-btn">変更を送信</button>
        <button type="button" data-order-amend-toggle data-order-id="${order.id}" data-listing-id="${l.listingId}" class="table-btn">キャンセル</button>
      </div>
    </form>
  ` : ''

  return `<li>
    ${escapeHtml(l.farmName)}・${escapeHtml(l.item)} ${fmtNum(effectiveLineAmount(l))}${escapeHtml(order.unit)}(${fmtNum(effectiveLineAmount(l) * l.unitPrice)}円)・${renderDeliveryMethodLabel(l)}${actionHtml}${renderAmendInfo(l, order.unit)}${amendForm}
    ${renderChatToggleButton(order, l)}
    ${renderChatPanel(order, l)}
  </li>`
}

// 注文1件の中の1農家分(line)ごとのチャット(メルカリの取引チャットをイメージ)。
// 飲食店側・生産者側どちらの一覧からも同じ見た目で開けるよう共通化する。
function renderChatToggleButton(order, l) {
  const key = orderLineKey(order.id, l.listingId)
  const open = state.openChatKey === key
  const count = state.chatThreads[key]?.length
  const label = open ? '閉じる' : `💬 メッセージ${count ? `(${count})` : ''}`
  return `<button type="button" data-chat-toggle data-order-id="${order.id}" data-listing-id="${l.listingId}" class="table-btn chat-toggle-btn">${label}</button>`
}

function renderChatMessage(m) {
  const mine = m.senderId === getOwnerId()
  const roleLabel = m.senderRole === 'restaurant' ? '飲食店' : '生産者'
  return `
    <div class="chat-bubble ${mine ? 'chat-bubble-mine' : ''}">
      <div class="chat-bubble-meta">${mine ? '自分' : roleLabel}・${new Date(m.createdAt).toLocaleString('ja-JP')}</div>
      <div class="chat-bubble-text">${escapeHtml(m.text)}</div>
    </div>
  `
}

function renderChatPanel(order, l) {
  const key = orderLineKey(order.id, l.listingId)
  if (state.openChatKey !== key) return ''
  const messages = state.chatThreads[key] || []
  return `
    <div class="chat-panel">
      <div class="chat-messages">
        ${state.chatLoading && messages.length === 0
          ? '<p class="hint">読み込み中…</p>'
          : messages.length === 0
            ? '<p class="hint">まだメッセージはありません。受け渡しの相談などに使えます。</p>'
            : messages.map(renderChatMessage).join('')}
      </div>
      <form class="chat-form" data-order-id="${order.id}" data-listing-id="${l.listingId}">
        <input type="text" name="text" placeholder="メッセージを入力" maxlength="2000" required />
        <button type="submit" class="table-btn primary" ${state.chatSubmitting ? 'disabled' : ''}>${state.chatSubmitting ? '送信中…' : '送信'}</button>
      </form>
    </div>
  `
}

// 生産者・飲食店で画面を完全に分けたい(同じ画面に両方の設定が同居するのをやめたい)という
// 要望を受けて、画面を切り替えるボタン(旧renderSettingsSwitch)は廃止した。役割を変えたい
// 場合は必ずホーム画面の2ブロックから選び直す(=renderRoleResetLinkで明示的にリセットする)
// という1つの経路に統一し、設定画面の中に「もう一方の役割」の気配を残さないようにしている。
function renderRoleResetLink() {
  // ログイン済みアカウントは役割が恒久的に固定されるため、ここには出さない(api/auth.jsの
  // コメント参照:1アカウント=1役割)。匿名のまま役割を選び間違えた場合のための導線。
  // ただし管理者アカウント(isAdmin)は役割固定の対象外なので、ログイン中でも表示する。
  if ((state.userEmail && !state.isAdmin) || !effectiveRole()) return ''
  return `<p class="role-reset-hint"><button type="button" class="link-btn" id="role-reset-btn">別の役割として使う(ホーム画面からやり直します)</button></p>`
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

// メールアドレス+ワンタイムログインリンクでのログイン(パスワードは扱わない)。
// ログインすると、端末の匿名UUIDの代わりにこのメールアドレスを所有権(ownerId)として使う。
function renderAccountCard() {
  if (state.userEmail) {
    const roleLabel = state.isAdmin ? '管理者・両方の役割を利用可' : state.userRole === 'producer' ? '生産者' : state.userRole === 'restaurant' ? '飲食店' : null
    return `
      <section class="panel">
        <h3>アカウント</h3>
        <p class="hint">ログイン中:<strong>${escapeHtml(state.userEmail)}</strong>${roleLabel ? `(${roleLabel})` : ''}</p>
        <p class="hint">この端末で作成した出品・注文、受取条件・農園情報は、このメールアドレスでどの端末からでも管理できます。</p>
        <div class="actions"><button id="auth-logout-btn">ログアウトする</button></div>
      </section>
    `
  }
  if (state.authLinkSent) {
    return `
      <section class="panel">
        <h3>アカウント</h3>
        <p class="hint">✉️ ログインリンクを送信しました。メール内のリンクを開いてください(15分間だけ有効です)。</p>
        <div class="actions"><button id="auth-link-resend-btn" class="ghost-btn">別のメールアドレスで送り直す</button></div>
      </section>
    `
  }
  // 直近使っていた役割が分かっていれば(仕入れ・出品のどちらかを一度でも開いていれば)、
  // それを前提にログインフォームを出し分ける(飲食店/生産者でログイン画面を分けたい、という
  // 意図を汲み、毎回ラジオボタンで選び直させない)。役割がまだ不明な場合のみ選択式にする。
  const role = effectiveRole()
  return `
    <section class="panel">
      <h3>アカウント</h3>
      <p class="hint">機種変更やブラウザのデータ削除があっても安心(パスワードは不要です)。</p>
      ${renderCollapsibleHint('メールアドレスを登録すると、機種変更やブラウザのデータ削除があっても、別の端末から自分の出品・注文にアクセスできるようになります。')}
      <form id="auth-request-form" class="form-grid">
        <label>メールアドレス<input type="email" name="email" required placeholder="例:mikami@example.com" /></label>
        ${role ? `
          <input type="hidden" name="role" value="${role}" />
          <p class="hint">${role === 'restaurant' ? '🛒 飲食店として登録します' : '🌾 生産者として登録します'}</p>
        ` : `
          <label class="checkbox"><input type="radio" name="role" value="restaurant" checked /> 飲食店として使う</label>
          <label class="checkbox"><input type="radio" name="role" value="producer" /> 生産者として使う</label>
        `}
      </form>
      <p class="hint">※ 一度登録した役割は後から変更できません${role ? '' : '(生産者・飲食店どちらも試したい場合は、別のメールアドレスでご登録ください)'}。</p>
      ${state.authError ? `<p class="warn">${escapeHtml(state.authError)}</p>` : ''}
      <div class="actions">
        <button id="auth-request-submit" class="primary" ${state.authSubmitting ? 'disabled' : ''}>${state.authSubmitting ? '送信しています…' : 'ログインリンクを送る'}</button>
      </div>
    </section>
  `
}

// デモ運営者向け: 出品・注文・拠点・チャットは全利用者が同じ共有ストアを見ているため、発表
// 直前に誰かの操作でデモ用データが変わってしまっても、直前に保存した状態へ戻せるようにする。
// DEMO_ADMIN_KEYが未設定の環境ではカード自体を出さない(使えない機能を見せて混乱させない)。
function renderDemoAdminCard() {
  const status = state.demoSnapshotStatus
  if (!status || !status.configured) return ''
  // 一般の利用者には関係が無い破壊的な機能なので、既定では畳んでおき、管理用キーを
  // 知っている人だけが開けるようにする(①の折りたたみパターンを流用)。
  return `
    <details class="panel">
      <summary>デモ運営者向け</summary>
      <p class="hint">${status.exists ? `最終保存:${new Date(status.savedAt).toLocaleString('ja-JP')}` : 'まだ保存されたスナップショットはありません。'}</p>
      ${renderCollapsibleHint('発表直前に今の状態を保存しておくと、他の人の操作でデータが変わってしまっても保存時点に戻せます。')}
      <form id="demo-admin-form" class="form-grid">
        <label>管理用キー<input type="password" name="adminKey" placeholder="DEMO_ADMIN_KEY" /></label>
      </form>
      <div class="actions">
        <button type="button" id="demo-snapshot-save-btn" ${state.demoSnapshotBusy ? 'disabled' : ''}>${state.demoSnapshotBusy ? '処理中…' : '今の状態を保存する'}</button>
        <button type="button" id="demo-snapshot-restore-btn" class="table-btn-danger" ${!status.exists || state.demoSnapshotBusy ? 'disabled' : ''}>${state.demoSnapshotBusy ? '処理中…' : '保存した状態に戻す'}</button>
      </div>
    </details>
  `
}

function renderSettings() {
  const role = effectiveRole()

  if (!role) {
    return `
      <section class="panel">
        <h2>設定</h2>
        <p class="hint">「仕入れ」または「出品」をホーム画面から選ぶと、その役割の設定だけがここに表示されます。</p>
      </section>
      ${renderAccountCard()}
      ${renderDisplaySettingsCard()}
      ${renderDemoAdminCard()}
    `
  }

  if (role === 'restaurant') {
    const r = state.restaurantProfile
    return `
      <section class="panel">
        <h2>設定(飲食店)</h2>
      </section>
      ${renderAccountCard()}
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
      ${renderDemoAdminCard()}
      ${renderRoleResetLink()}
    `
  }

  const p = state.producerProfile
  return `
    <section class="panel">
      <h2>設定(生産者)</h2>
    </section>
    ${renderAccountCard()}
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
      ${renderDemoAdminCard()}
      ${renderRoleResetLink()}
  `
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function attachEvents() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.nav
      // ログイン中は役割が固定されているため、他の役割の画面には遷移させない
      // (念のための二重チェック。通常はボタン自体が表示されない)。
      if (state.userRole === 'producer' && key === 'restaurant') return
      if (state.userRole === 'producer' && key === 'rescue') return
      if (state.userRole === 'restaurant' && key === 'producer') return
      // 仕入れ・出品・おまかせ救済は他端末の出品状況に関わる画面なので、開くたびに最新化する。
      if (['restaurant', 'producer', 'rescue'].includes(key)) fetchListings()
      if (['restaurant', 'producer', 'orders'].includes(key)) fetchOrders()
      if (key === 'producer') fetchHubs() // 共通受渡拠点の選択肢は出品登録(生産者)でのみ使う
      if (key === 'settings') fetchSnapshotStatus() // デモ運営者向けカードの表示判定・最終保存日時に使う
      if (key === 'restaurant') goToRestaurant()
      else if (key === 'producer') goToProducer()
      else setState({ screen: key })
    })
  })
  document.querySelectorAll('[data-refresh-listings]').forEach(btn => {
    btn.addEventListener('click', () => fetchListings())
  })
  document.querySelectorAll('[data-refresh-orders]').forEach(btn => {
    btn.addEventListener('click', () => fetchOrders())
  })
  document.querySelectorAll('[data-order-respond]').forEach(btn => {
    btn.addEventListener('click', () => handleOrderLineRespond(btn.dataset.orderId, btn.dataset.listingId, btn.dataset.status))
  })
  document.querySelectorAll('[data-order-cancel]').forEach(btn => {
    btn.addEventListener('click', () => handleOrderCancel(btn.dataset.orderCancel))
  })
  document.querySelectorAll('[data-order-amend-toggle]').forEach(btn => {
    btn.addEventListener('click', () => handleOrderLineAmendToggle(btn.dataset.orderId, btn.dataset.listingId))
  })
  document.querySelectorAll('.amend-line-form').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!form.reportValidity()) return
      handleOrderLineAmendSubmit(form.dataset.orderId, form.dataset.listingId, form)
    })
  })
  // ブラウザ標準の検証メッセージは一般的な文言になりがちなため、min/max違反時は
  // 「なぜその範囲なのか」を説明する独自メッセージに差し替える(無言で弾かれないように)。
  document.querySelectorAll('.amend-line-form input[name="newAmount"]').forEach(input => {
    input.addEventListener('invalid', () => {
      input.setCustomValidity(`0以上${input.max}未満の数で、現在の数量より少ない値を入力してください`)
    })
    input.addEventListener('input', () => input.setCustomValidity(''))
  })
  // 出品ステップ③の「受け渡し方法」「在庫状況」も同じ理由(ブラウザ標準の検証メッセージは
  // 一般的な文言になりがち)で、選び忘れたときの独自メッセージに差し替える。他の必須項目
  // (例:共通受渡拠点の選び忘れ)には専用の案内があるのに、ここだけ素っ気ない標準メッセージ
  // のままだと一貫しないため。
  ;[
    ['deliveryMethod', '受け渡し方法を1つ選んでください'],
    ['stockStatus', '在庫状況を1つ選んでください']
  ].forEach(([name, message]) => {
    const radios = document.querySelectorAll(`input[name="${name}"]`)
    radios.forEach(input => {
      input.addEventListener('invalid', () => input.setCustomValidity(message))
      input.addEventListener('change', () => radios.forEach(r => r.setCustomValidity('')))
    })
  })
  document.querySelectorAll('[data-chat-toggle]').forEach(btn => {
    btn.addEventListener('click', () => handleChatToggle(btn.dataset.orderId, btn.dataset.listingId))
  })
  document.querySelectorAll('.chat-form').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (!form.reportValidity()) return
      handleChatSend(form.dataset.orderId, form.dataset.listingId, form)
    })
  })
  document.querySelectorAll('.chat-messages').forEach(el => { el.scrollTop = el.scrollHeight })
  document.getElementById('new-hub-toggle')?.addEventListener('click', handleNewHubToggle)
  document.getElementById('new-hub-submit')?.addEventListener('click', handleNewHubSubmit)
  document.querySelectorAll('[data-hub-delete]').forEach(btn => {
    btn.addEventListener('click', () => handleHubDelete(btn.dataset.hubDelete))
  })
  document.getElementById('demo-snapshot-save-btn')?.addEventListener('click', handleDemoSnapshotSave)
  document.getElementById('demo-snapshot-restore-btn')?.addEventListener('click', handleDemoSnapshotRestore)
  document.getElementById('auth-request-submit')?.addEventListener('click', (e) => {
    e.preventDefault()
    const form = document.getElementById('auth-request-form')
    if (!form.reportValidity()) return
    const fd = new FormData(form)
    const email = fd.get('email')
    const role = fd.get('role')
    handleAuthRequestLink(String(email || '').trim(), String(role || ''))
  })
  document.getElementById('auth-link-resend-btn')?.addEventListener('click', () => setState({ authLinkSent: false }))
  document.getElementById('auth-logout-btn')?.addEventListener('click', handleAuthLogout)
  document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => setState({ screen: btn.dataset.goto }))
  })
  document.getElementById('role-reset-btn')?.addEventListener('click', handleRoleReset)
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
  document.getElementById('toggle-large-text')?.addEventListener('click', () => setState({ largeText: !state.largeText }))
  document.getElementById('restart-after-order-btn')?.addEventListener('click', handleRestartRestaurant)

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
  document.getElementById('request-order-btn')?.addEventListener('click', handleRequestOrder)
  document.getElementById('toggle-result-map')?.addEventListener('click', () => setState({ showResultMap: !state.showResultMap }))
  document.querySelectorAll('[data-rescue-adopt]').forEach(btn => {
    btn.addEventListener('click', () => handleRescueAdopt(btn.dataset.rescueAdopt))
  })

  document.getElementById('listing-voice-btn')?.addEventListener('click', () => startVoiceInput('listing-text', 'listing-voice-msg'))
  document.getElementById('listing-parse-btn')?.addEventListener('click', handleListingParseClick)
  document.getElementById('listing-photo-input')?.addEventListener('change', (e) => handleListingPhotoChange(e.target))

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
// 画面(state.screen)は毎回「home」から始まる設計のため、前回セッションの再読み込み等で
// URLに画面ハッシュ(#orders等)が残っていると実際の表示と食い違う。起動時点でクリアする
// (?loginToken=等のクエリ文字列はhandleAuthTokenFromUrl()が別途読むため保持する)。
if (window.location.hash) {
  window.history.replaceState({ screen: state.screen }, '', window.location.pathname + window.location.search)
}
fetchListings()
fetchOrders()
fetchHubs()
// 前回のセッションからログイン済みの場合、サーバー保存済みの受取条件・農園情報を
// 取り直す(?loginTokenを踏んだ直後の初回ログインはhandleAuthTokenFromUrl側で行う)。
if (state.userEmail) fetchServerProfile(state.userEmail)
handleAuthTokenFromUrl()
