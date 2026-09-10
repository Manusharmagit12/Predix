/* ============ Predix front-end — Kalshi-style SPA (v2, no build step) ============ */
'use strict';

/* ---------- helpers ---------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (c) => (c === null || c === undefined || isNaN(c)) ? '$0.00' : '$' + (Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney0 = (c) => (c === null || c === undefined || isNaN(c)) ? '$0' : '$' + Math.round(Number(c) / 100).toLocaleString('en-US');
const fmtPrice = (p) => (p === null || p === undefined || isNaN(p)) ? '—' : '$' + (Number(p) / 100).toFixed(2);
const fmtCents = (p) => (p === null || p === undefined || isNaN(p)) ? '—' : '$' + (Number(p) / 100).toFixed(2);
const fmtPct = (p) => (p === null || p === undefined || isNaN(p)) ? '—' : `${Math.round(Number(p))}%`;
const fmtQty = (q) => (q === null || q === undefined || isNaN(q)) ? '0' : Number(q).toLocaleString('en-US');
const sgn = (c) => (c === null || c === undefined || isNaN(c)) ? '$0.00' : (c > 0 ? '+' : '') + fmtMoney(c).replace('$-', '−$');
const shortTitle = (s, n = 46) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));

/* ---------- inline icon system (Lucide-style, stroke-based, no emoji) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  flame: '<path d="M12 3s1 2.5-1 5c-1.2 1.5-2 2.6-2 4.5a3 3 0 0 0 6 0c0-.8-.3-1.5-.7-2.2 1.9.6 3.2 2.3 3.2 4.4A5.5 5.5 0 0 1 12 20a5.5 5.5 0 0 1-5.5-5.5C6.5 9.6 12 8.5 12 3Z"/>',
  sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6L12 16.8l-5.4 2.9 1.1-6L3.2 9.4l6.1-.8L12 3Z"/>',
  starFilled: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6L12 16.8l-5.4 2.9 1.1-6L3.2 9.4l6.1-.8L12 3Z" fill="currentColor" stroke="none"/>',
  briefcase: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5a3 3 0 0 0 3 5"/><path d="M16 5h3a3 3 0 0 1-3 5"/><path d="M12 13v4"/><path d="M8 21h8M10 17h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M5 21c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/><path d="M9 7h6"/>',
  landmark: '<path d="M4 21h16"/><path d="M6 21V10"/><path d="M18 21V10"/><path d="M3 10l9-6 9 6"/><path d="M10 14h.01M14 14h.01"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6.5C16 5 14 4.5 12 4.5c-2.6 0-4.5 1.3-4.5 3.2 0 4.6 9 2.4 9 7 0 1.9-2 3.3-4.5 3.3-2.4 0-4.3-.9-5-2.5"/>',
  bitcoin: '<circle cx="12" cy="12" r="9"/><path d="M9.5 7.5h4a2 2 0 0 1 0 4h-4zM9.5 11.5h4.5a2 2 0 0 1 0 4H9.5z"/><path d="M11 5.5v2M11 15.5v2M13.5 5.5v2"/>',
  laptop: '<path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10H4V5Z"/><path d="M2 19h20v-2H2z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  flask: '<path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4A1.5 1.5 0 0 0 19.5 19L14 9V3"/><path d="M8.5 3h7"/><path d="M7.5 15h9"/>',
  cloudSun: '<circle cx="7" cy="7" r="3"/><path d="M7 1.5v1M1.5 7h1M3.2 3.2l.7.7M10.8 3.2l-.7.7"/><path d="M10 20a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 1 21 13.5a3.5 3.5 0 0 1-.5 6.5H10Z"/>',
  cloudRain: '<path d="M17.5 17H7a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 17.8 9 4 4 0 0 1 17.5 17Z"/><path d="M8 20l-.8 1.7M12 20l-.8 1.7M16 20l-.8 1.7"/>',
  thermometer: '<path d="M10 4a2 2 0 1 1 4 0v9.3a4.5 4.5 0 1 1-4 0V4Z"/><circle cx="12" cy="17.5" r="1.8" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 3.5-4.5 3 3L18 8"/>',
  trendingUp: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  trendingDown: '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 15.7c1.6.6 2.9 1.9 3.7 4.3"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H3"/><circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none"/>',
  arrowRight: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  refresh: '<path d="M20 11A8 8 0 0 0 5.6 6.6L4 8.3"/><path d="M4 4v4.3h4.3"/><path d="M4 13a8 8 0 0 0 14.4 4.4l1.6-1.7"/><path d="M20 20v-4.3h-4.3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  candle: '<path d="M7 5v3M7 16v3M17 5v3M17 16v3"/><rect x="4.5" y="8" width="5" height="8" rx="1"/><rect x="14.5" y="8" width="5" height="8" rx="1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 5.5V8M9 5.5h6"/><circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none"/><path d="M9.5 16.5h5"/><path d="M2.5 12v4M21.5 12v4"/>',
  gift: '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/><path d="M12 9v12"/><path d="M12 9c-4 0-5-2-4.5-3.5C8 4 10.5 4.5 12 9ZM12 9c4 0 5-2 4.5-3.5C16 4 13.5 4.5 12 9Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 2.5 4.5 5.5v6c0 4.7 3.2 8 7.5 10 4.3-2 7.5-5.3 7.5-10v-6L12 2.5Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m15 8 4 4-4 4M19 12H9"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8 13 5.4a7 7 0 0 1 2 1.2l2.7-.7 1.7 3-1.9 2a7.2 7.2 0 0 1 0 2.2l1.9 2-1.7 3-2.7-.7a7 7 0 0 1-2 1.2L12 21.2 11 18.6a7 7 0 0 1-2-1.2l-2.7.7-1.7-3 1.9-2a7.2 7.2 0 0 1 0-2.2l-1.9-2 1.7-3 2.7.7a7 7 0 0 1 2-1.2L12 2.8Z"/>',
  banknote: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v.01M18 14v.01"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="m12 12.8.9 1.9 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3.9-1.9Z"/><path d="M8.5 9.5 6 3h4l2 5 2-5h4l-2.5 6.5"/>',
  bolt: '<path d="M13 2 5 13h5.5L11 22l8-11h-5.5L13 2Z"/>',
  handshake: '<path d="m2.5 12.5 4-4 3.5 3 2-1.5 2 1.5 3.5-3 4 4-4 4.5-3-2.5-2.5 2L8 19l-5.5-6.5Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2.5 3H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/>',
  gamepad: '<path d="M7 8h10a5 5 0 0 1 5 5.5c-.3 2.3-1.6 3.5-3 3.5-1.7 0-2.2-1.5-4-1.5h-6c-1.8 0-2.3 1.5-4 1.5-1.4 0-2.7-1.2-3-3.5A5 5 0 0 1 7 8Z"/><path d="M8.5 11v3M7 12.5h3"/><circle cx="15.5" cy="11.5" r=".9" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13.5" r=".9" fill="currentColor" stroke="none"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14 21l-3.5-7.5L3 10 21 3Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 3v12"/>',
  helpCircle: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3.4"/><path d="M3 7v5c0 1.9 2.7 3.4 6 3.4s6-1.5 6-3.4V7"/><path d="M15 8.6c3 .3 5.5 1.7 5.5 3.6v5c0 1.9-2.5 3.4-5.5 3.4s-6-1.5-6-3.4"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  arrowDownRight: '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>',
  creditCard: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  arrowUpRight: '<path d="M7 17 17 7M7 7h10v10"/>',
  qrCode: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1"/>',
  externalLink: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
};
function ic(name, size = 18, cls = '') {
  const p = ICONS[name] || ICONS.info;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
const CAT_ICONS = { Politics: 'landmark', Economics: 'dollar', Crypto: 'bitcoin', Sports: 'trophy', Tech: 'laptop', Entertainment: 'film', Science: 'flask', Weather: 'cloudSun', All: 'chart' };
const catIcon = (cat, size = 17) => ic(CAT_ICONS[cat] || 'chart', size);



function countdown(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  if (ms <= 0) return 'closed';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}
function timeAgo(ts) {
  if (!ts) return '—';
  const time = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(time)) return '—';
  const s = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Server took too long to respond — check your connection and retry.' : 'Cannot reach the server — it may be restarting. Retry in a moment.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

/* friendly full-page error with a retry button (never leave a blank/stuck page) */
function errorScreen(msg, retryHash) {
  return `
    <div class="card card-pad" style="max-width:520px;margin:40px auto;text-align:center;padding:34px 26px;">
      <div style="margin-bottom:10px;color:var(--muted)">${ic('chart', 40)}</div>
      <h2 style="margin:0 0 8px;font-size:20px">Having trouble loading</h2>
      <p class="muted" style="margin:0 0 18px">${esc(msg)}</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="btn-primary" style="width:auto;margin:0;padding:11px 22px" onclick="location.reload()">Reload page</button>
        <a class="mini-btn" href="${retryHash || '#/'}" style="padding:11px 16px" onclick="setTimeout(()=>location.reload(),60)">Go to markets</a>
      </div>
    </div>`;
}
function toast(msg, isErr) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 4600);
  setTimeout(() => el.remove(), 5100);
}
const notifIcon = { fill: 'bolt', settlement: 'flag', promo: 'gift', referral: 'handshake', security: 'lock' };

/* ---------- state ---------- */
const state = {
  me: null,
  snapshot: null,            // {wallet, orders, positions}
  rewards: null,
  unread: 0,
  watching: 0,
  watchSet: new Set(),       // market ids on watchlist
  markets: [],
  byslug: new Map(),
  hist: new Map(),           // slug -> [[ts,price],...]
  sparks: new Map(),         // slug -> [price,...]
  book: null,
  detail: null,
  category: 'All',
  q: '',
  sort: 'volume',
  chartRange: '7D',
  chartType: 'line',
  chartData: [],
  stats: null,
  es: null,
  selOutcome: 0,           // multi-outcome: selected option tab
  bookSide: 'yes',         // order book view: 'yes' | 'no'
  comments: [],            // current market comments
  lbWindow: 'all',         // leaderboard timeframe
};
window.state = state;

function upsertMarket(m) { state.byslug.set(m.slug, m); }

/* ================= chrome (sidebar + topbar + ticker) ================= */
function renderHeader() {
  const box = $('#userbox');
  if (state.me) {
    const avail = state.snapshot ? state.snapshot.wallet.available : 0;
    const res = state.snapshot ? state.snapshot.wallet.reserved : 0;
    const wc = $('#watch-count');
    if (wc) {
      wc.style.display = state.watching ? '' : 'none';
      wc.textContent = state.watching;
    }
    box.innerHTML = `
      <span class="balance-pill clickable" id="bal-pill" title="Available ${fmtMoney(avail)} · Reserved ${fmtMoney(res)} (Click for Payments & Wallet)"><span class="dot"></span>${fmtMoney(avail)}</span>
      <button class="btn-deposit" id="btn-deposit">+ Deposit</button>
      <button class="iconbtn" id="bell-btn" title="Notifications">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3a6 6 0 0 0-6 6v3.2l-1.4 2.8A1 1 0 0 0 5.5 16.5h13a1 1 0 0 0 .9-1.5L18 12.2V9a6 6 0 0 0-6-6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.8 19a2.3 2.3 0 0 0 4.4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        ${state.unread ? `<span class="notif-badge">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}
      </button>
      <button class="iconbtn" id="avatar-btn" style="width:auto;padding:0 4px 0 4px;border-radius:999px" title="Account">
        <span class="avatar" style="width:28px;height:28px;font-size:12px">${esc(state.me.username[0].toUpperCase())}</span>
      </button>`;
    $('#btn-deposit').onclick = () => openDepositModal();
    $('#bal-pill').onclick = () => { location.hash = '#/wallet'; };
    $('#bell-btn').onclick = (e) => { e.stopPropagation(); toggleNotifPanel(); };
    $('#avatar-btn').onclick = (e) => { e.stopPropagation(); toggleAvatarMenu(); };
  } else {
    box.innerHTML = `
      <a href="#/login" class="btn-top ghost">Log in</a>
      <a href="#/signup" class="btn-deposit" style="text-decoration:none">Sign up</a>`;
  }
}

function generateQrSvg() {
  return `<svg viewBox="0 0 100 100" width="120" height="120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="white" rx="4"/>
    <rect x="8" y="8" width="28" height="28" fill="#0b0e14"/>
    <rect x="12" y="12" width="20" height="20" fill="white"/>
    <rect x="16" y="16" width="12" height="12" fill="#0b0e14"/>
    <rect x="64" y="8" width="28" height="28" fill="#0b0e14"/>
    <rect x="68" y="12" width="20" height="20" fill="white"/>
    <rect x="72" y="16" width="12" height="12" fill="#0b0e14"/>
    <rect x="8" y="64" width="28" height="28" fill="#0b0e14"/>
    <rect x="12" y="68" width="20" height="20" fill="white"/>
    <rect x="16" y="72" width="12" height="12" fill="#0b0e14"/>
    <rect x="40" y="20" width="4" height="4" fill="#0b0e14"/>
    <rect x="48" y="20" width="4" height="4" fill="#0b0e14"/>
    <rect x="56" y="20" width="4" height="4" fill="#0b0e14"/>
    <rect x="20" y="40" width="4" height="4" fill="#0b0e14"/>
    <rect x="20" y="48" width="4" height="4" fill="#0b0e14"/>
    <rect x="20" y="56" width="4" height="4" fill="#0b0e14"/>
    <rect x="40" y="40" width="8" height="8" fill="#0066FF"/>
    <rect x="52" y="40" width="8" height="8" fill="#0b0e14"/>
    <rect x="64" y="40" width="8" height="8" fill="#0b0e14"/>
    <rect x="40" y="52" width="8" height="8" fill="#0b0e14"/>
    <rect x="64" y="52" width="8" height="8" fill="#0066FF"/>
    <rect x="52" y="64" width="8" height="8" fill="#0b0e14"/>
    <rect x="64" y="64" width="8" height="8" fill="#0b0e14"/>
    <rect x="76" y="64" width="8" height="8" fill="#0b0e14"/>
    <rect x="40" y="76" width="8" height="8" fill="#0b0e14"/>
    <rect x="52" y="76" width="8" height="8" fill="#0066FF"/>
    <rect x="76" y="76" width="8" height="8" fill="#0b0e14"/>
    <rect x="88" y="76" width="4" height="8" fill="#0b0e14"/>
    <rect x="40" y="88" width="8" height="4" fill="#0b0e14"/>
    <rect x="64" y="88" width="8" height="4" fill="#0b0e14"/>
    <rect x="76" y="40" width="8" height="8" fill="#0b0e14"/>
    <rect x="88" y="40" width="4" height="8" fill="#0b0e14"/>
    <rect x="40" y="8" width="4" height="8" fill="#0b0e14"/>
    <rect x="48" y="8" width="8" height="4" fill="#0b0e14"/>
  </svg>`;
}

function openDepositModal(prefillCents, onDone) {
  if (!state.me) { location.hash = '#/login'; return; }
  $('#deposit-modal') && $('#deposit-modal').remove();
  const el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.id = 'deposit-modal';
  const avail = state.snapshot ? state.snapshot.wallet.available : 0;

  let curMethod = 'card';
  let curAmount = prefillCents ? Math.max(5, Math.ceil(prefillCents / 100)) : 50;
  let curNet = 'Polygon';

  const renderModalContent = () => {
    el.innerHTML = `
    <div class="modal-card" style="max-width:520px">
      <div class="modal-head">
        <div style="display:flex;align-items:center;gap:9px">
          <svg class="brand-mark" viewBox="0 0 32 32" fill="none" style="width:24px;height:24px">
            <defs>
              <linearGradient id="brand_logo_g1_dep" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#0066FF"/>
                <stop offset="50%" stop-color="#00C8FF"/>
                <stop offset="100%" stop-color="#00E599"/>
              </linearGradient>
              <linearGradient id="brand_logo_g2_dep" x1="16" y1="2" x2="28" y2="14" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.85"/>
                <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.1"/>
              </linearGradient>
            </defs>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M5 4C5 2.89543 5.89543 2 7 2H19C24.5228 2 29 6.47715 29 12C29 17.5228 24.5228 22 19 22H12V29C12 30.1046 11.1046 31 10 31H7C5.89543 31 5 30.1046 5 29V4ZM12 7.5V16.5H18.5C20.9853 16.5 23 14.4853 23 12C23 9.51472 20.9853 7.5 18.5 7.5H12Z" fill="url(#brand_logo_g1_dep)"/>
            <path d="M19 2L29 12L24 12L15.5 3.5L19 2Z" fill="url(#brand_logo_g2_dep)"/>
          </svg>
          <h3>Deposit Funds (Play Money)</h3>
        </div>
        <button class="modal-close" id="dep-close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <div class="dep-bal-box" style="margin-bottom:14px">
          <div>
            <div class="dep-bal-label">Current Available Cash</div>
            <div style="font-size:11.5px;color:var(--muted)">Instant trading limit</div>
          </div>
          <span class="dep-bal-val">${fmtMoney(avail)}</span>
        </div>

        ${prefillCents ? `
        <div style="background:rgba(0,102,255,0.08);border:1px solid rgba(0,102,255,0.25);border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:12.5px;display:flex;align-items:center;gap:8px">
          <span style="color:var(--accent)">${ic('bolt', 14)}</span>
          <span>Funding needed for open trade: <b>${fmtMoney(prefillCents)}</b></span>
        </div>` : ''}

        <div class="pay-method-grid modal-pay-grid" style="margin-bottom:14px">
          <button type="button" class="pay-method-btn ${curMethod === 'card' ? 'active' : ''}" data-pm="card">
            ${ic('creditCard', 18)}
            <span class="pm-title">Card</span>
            <span class="pm-sub">Instant</span>
          </button>
          <button type="button" class="pay-method-btn ${curMethod === 'bank' ? 'active' : ''}" data-pm="bank">
            ${ic('building', 18)}
            <span class="pm-title">Bank ACH</span>
            <span class="pm-sub">0% Fee</span>
          </button>
          <button type="button" class="pay-method-btn ${curMethod === 'crypto' ? 'active' : ''}" data-pm="crypto">
            ${ic('bitcoin', 18)}
            <span class="pm-title">Crypto</span>
            <span class="pm-sub">USDC</span>
          </button>
          <button type="button" class="pay-method-btn ${curMethod === 'promo' ? 'active' : ''}" data-pm="promo">
            ${ic('gift', 18)}
            <span class="pm-title">Promo</span>
            <span class="pm-sub">Code</span>
          </button>
        </div>

        ${curMethod !== 'promo' ? `
        <label style="font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:6px;display:block">Select Amount</label>
        <div class="amount-presets">
          ${[25, 50, 100, 250, 500].map((amt) => `
            <button type="button" class="amount-chip ${curAmount === amt ? 'active' : ''}" data-amt="${amt}">$${amt}</button>
          `).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div style="position:relative;flex:1">
            <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-weight:700;color:var(--muted)">$</span>
            <input id="dep-custom-amt" class="input" type="number" min="5" max="100000" step="1" value="${curAmount}" style="padding-left:26px" placeholder="Custom amount" />
          </div>
        </div>` : ''}

        ${curMethod === 'card' ? `
          <div style="background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <span style="font-size:12px;font-weight:700">Card Information (Simulated)</span>
              <span style="font-size:11px;color:var(--green);font-weight:600">${ic('shield', 12)} 256-Bit Encrypted</span>
            </div>
            <div style="margin-bottom:8px">
              <input id="dep-card-num" class="input" placeholder="4242 •••• •••• 4242" value="4242 4242 4242 4242" style="font-family:monospace" />
            </div>
            <div class="card-inline-fields">
              <input id="dep-card-exp" class="input" placeholder="MM/YY" value="12/28" />
              <input id="dep-card-cvc" class="input" placeholder="CVC" value="888" maxlength="4" />
              <input id="dep-card-zip" class="input" placeholder="ZIP" value="10001" />
            </div>
          </div>
          <button class="btn-primary" id="dep-submit" style="width:100%;margin:0;padding:12px">
            Deposit $${curAmount} Instantly (0% Fee)
          </button>
        ` : curMethod === 'bank' ? `
          <div style="background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px">
            <div style="font-size:12px;font-weight:700;margin-bottom:8px">Select Bank Institution</div>
            <div class="bank-chips-grid">
              ${['Chase Bank', 'Bank of America', 'Wells Fargo', 'Citibank'].map((b, i) => `
                <button type="button" class="chip ${i === 0 ? 'active' : ''}" data-bank="${b}" style="justify-content:center;padding:7px">${b}</button>
              `).join('')}
            </div>
            <div style="font-size:11.5px;color:var(--muted)">Checking account ending in <b>•••• 9102</b> · Ready for instant ACH clearing.</div>
          </div>
          <button class="btn-primary" id="dep-submit" style="width:100%;margin:0;padding:12px">
            Transfer $${curAmount} via ACH (Instant)
          </button>
        ` : curMethod === 'crypto' ? `
          <div class="crypto-deposit-box" style="margin-bottom:14px">
            <div class="crypto-qr">
              ${generateQrSvg()}
            </div>
            <div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
                ${['Polygon', 'Solana', 'Arbitrum', 'Ethereum'].map((n) => `
                  <span class="network-badge ${curNet === n ? 'active' : ''}" data-cnet="${n}">${n}</span>
                `).join('')}
              </div>
              <div style="font-size:11.5px;color:var(--muted)">Deposit Address (USDC / USDT):</div>
              <div class="crypto-address-row">
                <span id="dep-crypto-addr">0x71C8658d5D6C99516c52674eBE46bBc87A29B92F</span>
                <button type="button" class="copy-btn" id="dep-copy-addr">${ic('copy', 12)} Copy</button>
              </div>
              <div style="font-size:11px;color:var(--muted)">Send USDC on ${curNet}. Credits to balance automatically.</div>
            </div>
          </div>
          <button class="btn-primary" id="dep-submit" style="width:100%;margin:0;padding:12px">
            Simulate Web3 Deposit ($${curAmount} USDC)
          </button>
        ` : `
          <label style="font-size:12.5px;font-weight:700;display:block;margin:6px 0 6px">Enter Promo / Voucher Code</label>
          <div style="display:flex;gap:8px">
            <input id="dep-code" class="input" placeholder="e.g. WELCOME100, TOPUP25" style="flex:1" />
            <button class="btn-deposit" id="dep-apply">Redeem</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
            <button class="chip" type="button" data-chip="TOPUP25">+ $25 (TOPUP25)</button>
            <button class="chip" type="button" data-chip="CRYPTO50">+ $50 (CRYPTO50)</button>
            <button class="chip" type="button" data-chip="WELCOME100">+ $100 (WELCOME100)</button>
          </div>
        `}

        <div id="dep-msg" style="margin-top:12px;font-size:13px"></div>
        <div style="margin-top:12px;text-align:center;font-size:11.5px;color:var(--muted)">
          ${ic('gamepad', 12)} Play-money demonstration. Transactions simulate real payment rails.
        </div>
      </div>
    </div>`;

    wireModalEvents();
  };

  const wireModalEvents = () => {
    const closeDep = () => {
      el.remove();
      window.removeEventListener('keydown', onDepKey);
    };
    const onDepKey = (e) => { if (e.key === 'Escape') closeDep(); };
    window.addEventListener('keydown', onDepKey);
    $('#dep-close').onclick = closeDep;
    el.onclick = (e) => { if (e.target === el) closeDep(); };

    // Method selection
    $$('[data-pm]').forEach((b) => b.onclick = () => {
      curMethod = b.dataset.pm;
      renderModalContent();
    });

    // Network selection
    $$('[data-cnet]').forEach((b) => b.onclick = () => {
      curNet = b.dataset.cnet;
      renderModalContent();
    });

    // Preset selection
    $$('[data-amt]').forEach((b) => b.onclick = () => {
      curAmount = parseInt(b.dataset.amt, 10);
      renderModalContent();
    });

    // Custom amount input
    const custIn = $('#dep-custom-amt');
    if (custIn) {
      custIn.oninput = () => {
        const val = parseInt(custIn.value, 10);
        if (val > 0) curAmount = val;
        const subBtn = $('#dep-submit');
        if (subBtn && curMethod !== 'promo') {
          subBtn.textContent = curMethod === 'crypto'
            ? `Simulate Web3 Deposit ($${curAmount} USDC)`
            : curMethod === 'bank'
            ? `Transfer $${curAmount} via ACH (Instant)`
            : `Deposit $${curAmount} Instantly (0% Fee)`;
        }
      };
    }

    // Copy address button
    const copyBtn = $('#dep-copy-addr');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const addr = $('#dep-crypto-addr').textContent;
        navigator.clipboard && navigator.clipboard.writeText(addr);
        toast('Deposit address copied to clipboard!');
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.innerHTML = `${ic('copy', 12)} Copy`; }, 2000);
      };
    }

    // Promo chips
    $$('[data-chip]').forEach((b) => b.onclick = () => {
      const cin = $('#dep-code');
      if (cin) cin.value = b.dataset.chip;
    });

    // Promo apply
    const promoBtn = $('#dep-apply');
    if (promoBtn) {
      promoBtn.onclick = async () => {
        const code = ($('#dep-code').value || '').trim();
        if (!code) return;
        const msg = $('#dep-msg');
        promoBtn.disabled = true;
        try {
          const res = await api('/api/promo/redeem', { method: 'POST', body: { code } });
          msg.innerHTML = `<span class="up">✓ Credited ${fmtMoney(res.amount || 2500)}!</span>`;
          toast(`Voucher redeemed: +${fmtMoney(res.amount || 2500)}`);
          await refreshMe();
          renderHeader();
          setTimeout(() => {
            closeDep();
            if (onDone) onDone(res.amount);
          }, 800);
        } catch (e) {
          msg.innerHTML = `<span class="down">⚠ ${esc(e.message)}</span>`;
          promoBtn.disabled = false;
        }
      };
    }

    // Deposit submit (card / bank / crypto)
    const subBtn = $('#dep-submit');
    if (subBtn) {
      subBtn.onclick = async () => {
        const msg = $('#dep-msg');
        if (curAmount < 5 || curAmount > 100000) {
          msg.innerHTML = '<span class="down">⚠ Enter an amount between $5 and $100,000.</span>';
          return;
        }
        subBtn.disabled = true;
        subBtn.textContent = 'Processing transaction…';
        try {
          const cents = curAmount * 100;
          const res = await api('/api/deposit', {
            method: 'POST',
            body: {
              amountCents: cents,
              method: curMethod,
              network: curNet,
              last4: '4242',
              bankName: 'Chase Bank',
            },
          });
          msg.innerHTML = `<span class="up">✓ Deposited ${fmtMoney(res.amount)} successfully!</span>`;
          toast(`Deposit confirmed: +${fmtMoney(res.amount)} credited to your wallet.`);
          await refreshMe();
          renderHeader();
          setTimeout(() => {
            closeDep();
            if (onDone) onDone(cents);
          }, 700);
        } catch (e) {
          msg.innerHTML = `<span class="down">⚠ ${esc(e.message)}</span>`;
          subBtn.disabled = false;
          subBtn.textContent = `Deposit $${curAmount} Instantly`;
        }
      };
    }
  };

  document.body.appendChild(el);
  renderModalContent();
}

function toggleAvatarMenu() {
  const existing = $('#avatar-menu');
  if (existing) { existing.remove(); return; }
  closeNotifPanel();
  const el = document.createElement('div');
  el.className = 'menu';
  el.id = 'avatar-menu';
  const adminLink = state.me && state.me.role === 'admin' ? `<a href="#/admin">${ic('settings', 13)} Admin dashboard</a>` : '';
  el.innerHTML = `
    <div class="who">
      <span class="who-name">${esc(state.me.username)}</span>
      <span class="who-email">${esc(state.me.email)}</span>
      ${state.rewards ? `<span class="who-tier">${esc(state.rewards.tier)} tier · ${fmtQty(state.rewards.points)} pts</span>` : ''}
    </div>
    <div class="sep"></div>
    <a href="#/wallet">${ic('creditCard', 14)} Payments &amp; Wallet</a>
    <a href="#/portfolio">${ic('briefcase', 14)} Portfolio</a>
    <a href="#/profile">${ic('user', 14)} Profile &amp; rewards</a>
    <a href="#/leaderboard">${ic('trophy', 14)} Leaderboard</a>
    ${adminLink}
    <div class="sep"></div>
    <button id="menu-logout">Log out</button>`;
  document.body.appendChild(el);
  $('#menu-logout').onclick = async () => {
    el.remove();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    state.me = null; state.snapshot = null; state.rewards = null; state.watchSet.clear();
    renderHeader(); route();
  };
  setTimeout(() => document.addEventListener('click', function closer(ev) {
    if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', closer); }
  }), 0);
}

/* ---------- notifications ---------- */
async function toggleNotifPanel() {
  const panel = $('#notif-panel');
  if (panel.classList.contains('open')) { closeNotifPanel(); return; }
  $('#avatar-menu') && $('#avatar-menu').remove();
  let data = { notifications: [], unread: 0 };
  if (state.me) {
    try { data = await api('/api/me/notifications'); } catch {}
  }
  renderNotifPanel(data);
  panel.classList.add('open');
  setTimeout(() => document.addEventListener('click', function notifCloser(ev) {
    if (!panel.classList.contains('open')) {
      document.removeEventListener('click', notifCloser);
      return;
    }
    const bell = $('#bell-btn');
    if (!panel.contains(ev.target) && (!bell || !bell.contains(ev.target))) {
      closeNotifPanel();
      document.removeEventListener('click', notifCloser);
    }
  }), 0);
}
function closeNotifPanel() { $('#notif-panel').classList.remove('open'); }

function renderNotifPanel(data) {
  const panel = $('#notif-panel');
  const items = (data.notifications || []).map((n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-ic">${ic('bell', 15)}</div>
      <div style="min-width:0">
        <div class="nt">${esc(n.title)}</div>
        <div class="nb">${esc(n.body)}</div>
        <div class="ntime">${timeAgo(n.ts)}</div>
      </div>
    </div>`).join('');
  panel.innerHTML = `
    <div class="notif-head">
      <h3>Notifications ${data.unread ? `<span class="snav-count">${data.unread} new</span>` : ''}</h3>
      <button id="notif-read">Mark all read</button>
    </div>
    <div class="notif-list">${items || '<div class="notif-empty">Nothing yet — trade a market and fills will show up here.</div>'}</div>`;
  $('#notif-read').onclick = async () => {
    try { await api('/api/me/notifications/read', { method: 'POST' }); } catch {}
    state.unread = 0;
    renderHeader();
    closeNotifPanel();
  };
}

/* ---------- ticker ---------- */
let tickerTimer = null;
function buildTicker() {
  const track = $('#tickertrack');
  if (!track) return;
  let movers = [...state.byslug.values()].filter((m) => m.status === 'open' && m.last !== null);
  movers.sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0) || (b.vol24 || 0) - (a.vol24 || 0));
  movers = movers.slice(0, 12);
  if (!movers.length) movers = [...state.byslug.values()].slice(0, 10);
  const html = movers.map((m) => {
    const chg = m.change;
    let chgHtml = '';
    if (chg !== null && chg !== undefined && chg !== 0) {
      const cls = chg > 0 ? 'up' : 'down';
      chgHtml = `<span class="t-chg ${cls}">${chg > 0 ? '▲ +$' : '▼ −$'}${(Math.abs(chg) / 100).toFixed(2)}</span>`;
    }
    return `<a class="ticker-item" href="#/market/${m.slug}"><span class="t-emoji">${catIcon(m.category)}</span>${esc(shortTitle(m.title, 42))}<span class="t-price">${fmtPrice(m.last)}</span>${chgHtml}</a>`;
  }).join('');
  const half = `<span class="ticker-half">${html}</span>`;
  track.innerHTML = half + half; // duplicated for a seamless loop
}
function startTicker() {
  buildTicker();
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = setInterval(buildTicker, 20000);
  tickerTimer.unref && tickerTimer.unref();
}

/* ---------- sidebar active state ---------- */
function renderChrome() {
  const h = location.hash || '#/';
  $$('.snav a').forEach((a) => a.classList.remove('active'));
  let key = 'home';
  if (h.startsWith('#/market/')) key = '';
  else if (h === '#/' || h === '') key = 'home';
  else if (h === '#/trending') key = 'trending';
  else if (h === '#/new') key = 'new';
  else if (h === '#/closing') key = 'closing';
  else if (h === '#/watchlist') key = 'watchlist';
  else if (h === '#/wallet' || h === '#/payments') key = 'wallet';
  else if (h === '#/portfolio') key = 'portfolio';
  else if (h === '#/leaderboard') key = 'leaderboard';
  else if (h === '#/profile') key = 'profile';
  else if (h.startsWith('#/c/')) key = '';
  if (key) {
    const link = document.querySelector(`[data-nav="${key}"]`);
    if (link) link.classList.add('active');
  }
  // category highlight
  const cat = h.match(/^#\/c\/(\w+)$/);
  $$('#snav-cats a').forEach((a) => {
    a.classList.toggle('active', !!cat && a.getAttribute('href') === '#/c/' + cat[1]);
  });
  // Polymarket category pill active highlight
  $$('#cat-pill-nav .cat-pill').forEach((a) => {
    const pill = a.dataset.pill;
    let active = false;
    if (pill === 'home' && (h === '#/' || h === '' || h === '#/markets')) active = true;
    else if (pill === 'trending' && h === '#/trending') active = true;
    else if (pill === 'analytics' && h === '#/analytics') active = true;
    else if (pill === 'watchlist' && h === '#/watchlist') active = true;
    else if (cat && pill.toLowerCase() === cat[1].toLowerCase()) active = true;
    a.classList.toggle('active', active);
  });
  // sync mobile bottom nav items
  $$('.mobile-bottom-nav .mobile-nav-item[data-mnav]').forEach((a) => {
    const nav = a.dataset.mnav;
    let active = false;
    if (nav === 'home' && (h === '#/' || h === '' || h === '#/markets' || h.startsWith('#/c/'))) active = true;
    else if (nav === 'trending' && h === '#/trending') active = true;
    else if (nav === 'portfolio' && h === '#/portfolio') active = true;
    else if (nav === 'wallet' && (h === '#/wallet' || h === '#/payments')) active = true;
    a.classList.toggle('active', active);
  });
  // mobile: close drawer and mobile search on navigation
  const sb = $('#sidebar'); if (sb) sb.classList.remove('open');
  const sbd = $('#sidebar-backdrop'); if (sbd) sbd.classList.remove('show');
  const sw = $('.searchwrap'); if (sw) sw.classList.remove('mobile-open');
}

/* ---------- router ---------- */
const app = () => $('#app');
function route() {
  const raw = location.hash || '#/';
  const qIdx = raw.indexOf('?');
  const h = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const routeQuery = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '');
  renderChrome();
  renderHeader();
  window.scrollTo(0, 0);
  let m;
  if ((m = h.match(/^#\/market\/([\w-]+)$/))) return viewMarket(m[1]);
  if (h === '#/wallet' || h === '#/payments') return viewWallet(routeQuery);
  if (h === '#/portfolio') return viewPortfolio();
  if (h === '#/leaderboard') return viewLeaderboard();
  if ((m = h.match(/^#\/trader\/([A-Za-z0-9_]{3,24})$/))) return viewTrader(m[1]);
  if (h === '#/learn') return viewLearn();
  if (h === '#/profile') return viewProfile();
  if (h === '#/admin') return viewAdmin();
  if (h === '#/login') return viewLogin();
  if (h === '#/signup') return viewSignup(routeQuery.get('ref') || '');
  if (h === '#/analytics') return viewAnalytics();
  if (h === '#/watchlist') return viewWatchlist();
  if (h === '#/trending') return viewHome('trending');
  if (h === '#/new') return viewHome('new');
  if (h === '#/closing') return viewHome('closing');
  if ((m = h.match(/^#\/c\/(\w+)$/))) return viewHome('category', decodeURIComponent(m[1]));
  return viewHome('home');
}
window.addEventListener('hashchange', route);

/* ================= HOME ================= */
const HOME_TITLES = {
  home: ['For you', 'Markets moving right now'],
  trending: ['Trending markets', 'The most-traded markets in the last 24 hours'],
  new: ['New markets', 'Freshly listed questions'],
  closing: ['Ending soon', 'Resolution is just around the corner'],
};

async function viewHome(variant, category) {
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading markets…</p></div>`;
  try {
    const params = new URLSearchParams();
    if (variant === 'category' && category) params.set('category', category);
    if (state.q) params.set('q', state.q);
    params.set('sort', variant === 'new' ? 'newest' : variant === 'closing' ? 'closing' : state.sort);
    const { markets } = await api('/api/markets?' + params.toString());
    state.markets = markets;
    state.markets.forEach((m) => { upsertMarket(m); if (m.spark) state.sparks.set(m.slug, m.spark); });
    if (!state.stats) {
      try { state.stats = await api('/api/stats'); } catch {}
    }
  } catch (e) { return app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }

  const isAuthed = !!state.me;
  let head = '';
  if (variant === 'category') {
    head = `
      <div class="page-head"><div>
        <h2 class="page-title">${category === 'Live' ? '🟢 Live Real-World Synced Markets' : esc(category)}</h2>
        <p class="page-sub">${category === 'Live' ? 'Real-time prediction questions mirrored directly from global prediction markets' : `${state.markets.length} market${state.markets.length === 1 ? '' : 's'} in this category`}</p>
      </div></div>`;
  } else {
    const t = HOME_TITLES[variant] || HOME_TITLES.home;
    head = `
      <div class="hero">
        <div class="hero-copy">
          ${isAuthed ? '' : `<div class="hero-promo">${ic('gift', 15)} New here? Code <code>WELCOME100</code> → <b>$100</b> at signup</div>`}
          <h1>${variant === 'home' ? 'What will happen next?' : esc(t[0])}</h1>
          <p>${variant === 'home'
            ? 'Trade your opinion on real-world events — Fed decisions, crypto prices, cricket, elections. Every contract pays <b>$1</b> if your side wins.'
            : esc(t[1])}</p>
          <div class="cta-row">
            ${isAuthed
              ? `<a class="btn-hero green" href="#/portfolio">View portfolio ${ic('arrowRight', 15)}</a><a class="btn-hero outline" href="#/trending">${ic('flame', 15)} Trending markets</a>`
              : `<a class="btn-hero green" href="#/signup">${ic('gift', 16)} Claim $100 &amp; start trading</a><a class="btn-hero outline" href="#/trending">Browse trending ${ic('arrowRight', 15)}</a>`}
          </div>
          ${state.stats ? `<div class="hero-stats">
            <div class="hero-stat"><div class="v">${fmtQty(state.stats.traders)}</div><div class="l">Traders</div></div>
            <div class="hero-stat"><div class="v">${fmtQty(state.stats.openMarkets)}</div><div class="l">Live markets</div></div>
            <div class="hero-stat"><div class="v">${fmtQty(state.stats.vol24)}</div><div class="l">Shares traded · 24h</div></div>
            <div class="hero-stat"><div class="v">${fmtQty(state.stats.trades)}</div><div class="l">Total trades</div></div>
          </div>` : ''}
        </div>
        <div class="hero-visual" aria-hidden="true">
          <svg viewBox="0 0 440 330" fill="none">
            <defs>
              <linearGradient id="hv-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--chart-up)" stop-opacity=".3"/>
                <stop offset="100%" stop-color="var(--chart-up)" stop-opacity="0"/>
              </linearGradient>
              <linearGradient id="hv-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="var(--chart-up)" stop-opacity=".55"/>
                <stop offset="100%" stop-color="var(--chart-up)" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <circle cx="330" cy="150" r="118" stroke="var(--line-2)" stroke-width="1"/>
            <ellipse cx="330" cy="150" rx="118" ry="46" stroke="var(--line-2)" stroke-width="1"/>
            <ellipse cx="330" cy="150" rx="80" ry="118" stroke="var(--line)" stroke-width="1"/>
            <ellipse cx="330" cy="150" rx="40" ry="118" stroke="var(--line)" stroke-width="1"/>
            <circle cx="330" cy="150" r="118" stroke="url(#hv-ring)" stroke-width="2" stroke-dasharray="200 542" stroke-linecap="round" transform="rotate(-70 330 150)"/>
            <circle cx="330" cy="32" r="3.5" fill="var(--chart-up)"/><circle cx="448" cy="150" r="3" fill="var(--blue)"/>
            <circle cx="252" cy="90" r="2.5" fill="var(--blue)"/><circle cx="404" cy="216" r="2.5" fill="var(--chart-up)"/>
            <circle cx="268" cy="222" r="2" fill="var(--muted)"/><circle cx="392" cy="74" r="2" fill="var(--muted)"/>
            <g>
              <line x1="60" y1="196" x2="60" y2="240" stroke="var(--chart-down)" stroke-width="1.5" opacity=".7"/><rect x="52" y="204" width="16" height="26" rx="3" fill="var(--chart-down)" opacity=".55"/>
              <line x1="98" y1="176" x2="98" y2="228" stroke="var(--chart-up)" stroke-width="1.5" opacity=".8"/><rect x="90" y="186" width="16" height="32" rx="3" fill="var(--chart-up)" opacity=".6"/>
              <line x1="136" y1="150" x2="136" y2="212" stroke="var(--chart-up)" stroke-width="1.5" opacity=".85"/><rect x="128" y="162" width="16" height="38" rx="3" fill="var(--chart-up)" opacity=".7"/>
              <line x1="174" y1="166" x2="174" y2="206" stroke="var(--chart-down)" stroke-width="1.5" opacity=".7"/><rect x="166" y="174" width="16" height="22" rx="3" fill="var(--chart-down)" opacity=".5"/>
              <line x1="212" y1="118" x2="212" y2="186" stroke="var(--chart-up)" stroke-width="1.5" opacity=".9"/><rect x="204" y="128" width="16" height="44" rx="3" fill="var(--chart-up)" opacity=".78"/>
              <line x1="250" y1="96" x2="250" y2="162" stroke="var(--chart-up)" stroke-width="1.5" opacity=".9"/><rect x="242" y="106" width="16" height="42" rx="3" fill="var(--chart-up)" opacity=".85"/>
            </g>
            <path d="M40 232 C 90 224, 120 196, 160 178 S 230 132, 268 108 S 340 74, 404 58 L 404 300 L 40 300 Z" fill="url(#hv-area)"/>
            <path d="M40 232 C 90 224, 120 196, 160 178 S 230 132, 268 108 S 340 74, 404 58" stroke="var(--chart-up)" stroke-width="2.6" stroke-linecap="round"/>
            <circle cx="404" cy="58" r="5.5" fill="var(--chart-up)"/><circle cx="404" cy="58" r="10" fill="var(--chart-up)" opacity=".22"/>
            <line x1="36" y1="264" x2="420" y2="264" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 6"/>
            <line x1="36" y1="196" x2="300" y2="196" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 6"/>
          </svg>
        </div>
      </div>`;
  }

  const cats = ['All', 'Live', 'Politics', 'Economics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Weather'];
  const chips = `
    <div class="chips" id="cats">${cats.map((c) => {
      const active = variant === 'category' ? c === category : c === 'All' && variant === 'home';
      const label = c === 'Live' ? '🟢 Live Synced' : c;
      return `<a class="chip ${active ? 'active' : ''}" href="${c === 'All' ? '#/' : '#/c/' + c}" style="text-decoration:none">${label}</a>`;
    }).join('')}</div>`;

  // group: series collections first (only on "for you")
  let seriesHtml = '';
  if (variant === 'home' && !state.q) {
    const groups = new Map();
    for (const m of state.markets) {
      if (!m.seriesSlug) continue;
      if (!groups.has(m.seriesSlug)) groups.set(m.seriesSlug, { name: m.seriesName, emoji: m.seriesEmoji, items: [] });
      groups.get(m.seriesSlug).items.push(m);
    }
    for (const [slug, g] of groups) {
      seriesHtml += `
        <div class="section">
          <div class="section-head">
            <h2>${ic('folder', 18)} ${esc(g.name)}</h2>
            <span class="sub">${g.items.length} related market${g.items.length === 1 ? '' : 's'}</span>
          </div>
          <div class="grid-markets">${g.items.map(marketCard).join('')}</div>
        </div>`;
    }
  }

  const featured = variant === 'home' && !state.q ? state.markets.filter((m) => m.featured && m.status === 'open') : [];
  const featuredHtml = featured.length ? `
    <div class="section">
      <div class="section-head"><h2>${ic('flame', 18)} Featured</h2><span class="sub">Hand-picked markets</span></div>
      <div class="grid-markets">${featured.slice(0, 3).map(marketCard).join('')}</div>
    </div>` : '';

  const gridTitle = state.q
    ? `Results for “${esc(state.q)}”`
    : variant === 'home' ? 'All markets' : '';

  const statusFilter = state.statusFilter || 'active';
  const openMarkets = state.markets.filter((m) => m.status === 'open');
  const resolvedMarkets = state.markets.filter((m) => m.status === 'resolved');

  let displayOpen = openMarkets;
  let displayResolved = resolvedMarkets;

  if (statusFilter === 'active') {
    displayResolved = [];
  } else if (statusFilter === 'resolved') {
    displayOpen = [];
  }

  const sortbarHtml = `
    <div class="sortbar" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div class="ranges" id="market-status-tabs">
        <button data-mst="active" class="${statusFilter === 'active' ? 'active' : ''}">Active (${openMarkets.length})</button>
        <button data-mst="resolved" class="${statusFilter === 'resolved' ? 'active' : ''}">Resolved (${resolvedMarkets.length})</button>
        <button data-mst="all" class="${statusFilter === 'all' ? 'active' : ''}">All (${state.markets.length})</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span>Sort</span>
        <select id="sort">
          <option value="volume" ${state.sort === 'volume' ? 'selected' : ''}>24h volume</option>
          <option value="closing" ${state.sort === 'closing' ? 'selected' : ''}>Closing soon</option>
          <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="title" ${state.sort === 'title' ? 'selected' : ''}>A–Z</option>
        </select>
      </div>
    </div>`;

  const activeGridHtml = displayOpen.length ? `
    <div class="section">
      <div class="section-head">
        <h2>${gridTitle || (statusFilter === 'all' ? 'Active markets' : 'Live questions')}</h2>
        <span class="sub">${openMarkets.length} market${openMarkets.length === 1 ? '' : 's'} open for trading</span>
      </div>
      <div class="grid-markets" id="grid" data-grid="grid">${displayOpen.map(marketCard).join('')}</div>
    </div>` : (statusFilter === 'active' ? `<div class="grid-markets" id="grid" data-grid="grid"><div class="empty">No active markets match your criteria.</div></div>` : '');

  const resolvedGridHtml = displayResolved.length ? `
    <div class="section" id="resolved-section" style="margin-top:36px">
      <div class="section-head" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2>${ic('check', 18)} Concluded &amp; Resolved Markets</h2>
          <span class="sub">${resolvedMarkets.length} settled contract${resolvedMarkets.length === 1 ? '' : 's'} · winners paid out $1.00</span>
        </div>
      </div>
      <div class="grid-markets">${displayResolved.map(marketCard).join('')}</div>
    </div>` : '';

  app().innerHTML = `
    ${head}
    ${chips}
    ${sortbarHtml}
    ${featuredHtml}
    ${seriesHtml}
    ${activeGridHtml}
    ${resolvedGridHtml}`;

  const sortEl = $('#sort');
  if (sortEl) sortEl.onchange = (e) => { state.sort = e.target.value; viewHome(variant, category); };
  $$('#market-status-tabs button').forEach((b) => {
    b.onclick = () => {
      state.statusFilter = b.dataset.mst;
      viewHome(variant, category);
    };
  });
  wireStars();
  buildTicker();
}

/* ================= WATCHLIST ================= */
async function viewWatchlist() {
  if (!state.me) { location.hash = '#/login'; return; }
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading watchlist…</p></div>`;
  let d;
  try { d = await api('/api/watchlist'); }
  catch (e) { app().innerHTML = errorScreen(e.message, '#/'); return; }
  state.markets = d.markets;
  state.markets.forEach((m) => { upsertMarket(m); if (m.spark) state.sparks.set(m.slug, m.spark); });
  app().innerHTML = `
    <div class="page-head"><div>
      <h2 class="page-title">${ic('star', 22)} Watchlist</h2>
      <p class="page-sub">${d.markets.length} market${d.markets.length === 1 ? '' : 's'} — tap the star on any card to follow it</p>
    </div></div>
    <div class="grid-markets">${d.markets.map(marketCard).join('') || `<div class="empty">Your watchlist is empty. Tap the ${ic('star', 13)} on any market card to add it here.</div>`}</div>`;
  wireStars();
}

/* ---------- stars ---------- */
function starBtn(m) {
  const on = state.watchSet.has(m.id);
  return `<button class="starbtn ${on ? 'on' : ''}" data-star="${m.id}" title="${on ? 'Remove from watchlist' : 'Add to watchlist'}">${on ? ic('starFilled', 16) : ic('star', 16)}</button>`;
}
function wireStars() {
  $$('[data-star]').forEach((b) => b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!state.me) { toast('Log in to build a watchlist.', true); location.hash = '#/login'; return; }
    const id = +b.dataset.star;
    try {
      const r = await api('/api/watchlist/toggle', { method: 'POST', body: { marketId: id } });
      if (r.watching) { state.watchSet.add(id); state.watching++; } else { state.watchSet.delete(id); state.watching = Math.max(0, state.watching - 1); }
      b.classList.toggle('on', r.watching);
      b.innerHTML = r.watching ? ic('starFilled', 16) : ic('star', 16);
      renderHeader();
      if (location.hash === '#/watchlist') viewWatchlist();
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------- market card ---------- */
function statusBadge(m) {
  if (m.isLiveSync && m.status === 'open') return `<span class="badge-live-sync"><span class="live-pulse-dot"></span>Live Sync</span>`;
  if (m.status === 'resolved') return `<span class="badge resolved-${m.outcome}">Resolved ${m.outcome === 'yes' ? `YES ${ic('check', 11)}` : `NO ${ic('check', 11)}`}</span>`;
  if (m.status === 'closed') return `<span class="badge closed">Closed · resolution pending</span>`;
  if (m.status === 'halted') return `<span class="badge halted">${ic('alert', 11)} Halted</span>`;
  return `<span class="badge live"><span class="dot"></span>Live</span>`;
}

function marketCard(m) {
  if (m.multi && m.outcomes) return multiCard(m);
  const yes = m.last, no = m.last === null ? null : 100 - m.last;
  const chg = m.change;
  let chgPill = '';
  if (chg !== null && chg !== undefined && chg !== 0) {
    chgPill = `<span class="chgpill ${chg > 0 ? 'up' : 'down'}">${chg > 0 ? '▲ +$' : '▼ −$'}${(Math.abs(chg) / 100).toFixed(2)}</span>`;
  } else if (chg === 0) {
    chgPill = '<span class="chgpill flat">— $0.00</span>';
  }
  const spark = sparkSVG(m);

  let body = '';
  if (m.status === 'resolved') {
    body = `
      <div class="mcard-price-row">
        <div class="mcard-bigprice">
          <div class="bp">${m.outcome === 'yes' ? 'YES 100%' : m.outcome === 'no' ? 'NO 100%' : 'Resolved'}<span class="bp-chance"> settled</span></div>
          <span class="chgpill flat">Settled $1.00</span>
        </div>
      </div>
      <div class="mcard-actions">
        <a class="btn-top" href="#/market/${m.slug}" style="width:100%;justify-content:center;font-size:12.5px;padding:9px 14px">View settlement details →</a>
      </div>`;
  } else {
    body = `
      <div class="mcard-price-row">
        <div class="mcard-bigprice">
          <div class="bp">${yes === null ? '—' : `${yes}%`}<span class="bp-chance"> chance</span></div>
          ${chgPill}
        </div>
        <div class="mcard-spark">${spark}</div>
      </div>
      <div class="mcard-actions">
        <a class="pricebtn yes" href="#/market/${m.slug}?side=buy&outcome=yes&price=${yes ?? 50}">
          <span class="pbtn-fill" style="width:${yes === null ? 50 : Math.max(0, Math.min(100, yes))}%"></span>
          <span class="pbtn-text"><span class="pbtn-label">Buy Yes</span><span class="pbtn-price">${fmtPrice(yes)}</span></span>
        </a>
        <a class="pricebtn no" href="#/market/${m.slug}?side=buy&outcome=no&price=${no ?? 50}">
          <span class="pbtn-fill" style="width:${no === null ? 50 : Math.max(0, Math.min(100, no))}%"></span>
          <span class="pbtn-text"><span class="pbtn-label">Buy No</span><span class="pbtn-price">${fmtPrice(no)}</span></span>
        </a>
      </div>`;
  }

  return `
  <div class="card mcard">
    ${starBtn(m)}
    <div class="mcard-top">
      <div class="mcard-emoji">${catIcon(m.category)}</div>
      <div style="min-width:0">
        <h3 class="mcard-title"><a href="#/market/${m.slug}">${esc(m.title)}</a></h3>
        <div class="mcard-meta">
          <span class="badge cat">${esc(m.category)}</span>
          <span class="mm">${ic('clock', 12)} ${countdown(m.closeTime - Date.now())}</span>
          <span class="mm">${ic('trendingUp', 12)} ${fmtQty(m.vol24 || 0)}</span>
        </div>
      </div>
    </div>
    ${body}
    <div class="mcard-vol">
      <span>Vol <b>${fmtQty(m.vol24 || 0)}</b> shares ${m.isLiveSync && m.liveVolume ? `<small class="muted" title="Real-world Manifold volume">($${fmtQty(m.liveVolume)})</small>` : ''}</span>
      <span style="margin-left:auto">${statusBadge(m)}</span>
    </div>
  </div>`;
}

function multiCard(m) {
  const winner = m.winnerIdx;
  const totalOutcomes = (m.outcomes || []).length;
  // Standardize height: show top 2 leading options + "+ X more" indicator, or all 3 if exactly 3
  const maxDisplay = totalOutcomes > 3 ? 2 : totalOutcomes;
  const displayOutcomes = (m.outcomes || []).slice(0, maxDisplay);
  const remaining = totalOutcomes - maxDisplay;

  const opts = displayOutcomes.map((o) => {
    const won = m.status === 'resolved' && winner === o.idx;
    const priceVal = (o.last === null || o.last === undefined) ? 50 : o.last;
    const pct = Math.max(0, Math.min(100, priceVal));
    return `
      <a class="opt-row ${won ? 'won' : ''}" href="#/market/${m.slug}?o=${o.idx}">
        <span class="opt-fill" style="width:${pct}%"></span>
        <span class="opt-left">
          <span class="opt-dot"></span>
          <span class="opt-label">${esc(o.label)}</span>
        </span>
        <b class="opt-price">${o.last === null || o.last === undefined ? '—' : Math.round(o.last) + '%'} <small style="font-size:11.5px;color:var(--muted)">${fmtPrice(o.last)}</small></b>
      </a>`;
  }).join('');

  const moreRow = remaining > 0 ? `
    <a class="opt-more" href="#/market/${m.slug}">
      <span>+${remaining} more option${remaining === 1 ? '' : 's'}</span>
      <span class="opt-more-arrow">→</span>
    </a>` : '';

  return `
  <div class="card mcard">
    ${starBtn(m)}
    <div class="mcard-top">
      <div class="mcard-emoji">${catIcon(m.category)}</div>
      <div style="min-width:0">
        <h3 class="mcard-title"><a href="#/market/${m.slug}">${esc(m.title)}</a></h3>
        <div class="mcard-meta">
          <span class="badge cat">${esc(m.category)}</span>
          <span class="mm">${ic('clock', 12)} ${countdown(m.closeTime - Date.now())}</span>
          <span class="badge cat">${m.outcomes.length} options</span>
        </div>
      </div>
    </div>
    <div class="opt-list">
      ${opts}
      ${moreRow}
    </div>
    <div class="mcard-vol">
      <span>Vol <b>${fmtQty(m.vol24 || 0)}</b> shares</span>
      <span style="margin-left:auto">${statusBadge(m)}</span>
    </div>
  </div>`;
}

function sparkSVG(m) {
  const pts = state.sparks.get(m.slug) || [];
  if (pts.length < 2) return '';
  const up = (m.change || 0) >= 0;
  const col = up ? 'var(--spark-up)' : 'var(--spark-down)';
  const gid = 'sg' + m.id;
  const P = pts.map((p, i) => [ (i / (pts.length - 1)) * 100, 37 - (p / 100) * 34 ]);
  // smooth path (catmull-rom → cubic bezier)
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const last = P[P.length - 1];
  return `<svg class="sparksvg" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${d} L100,40 L0,40 Z" fill="url(#${gid})" stroke="none"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.6" fill="${col}" stroke="none"/>
  </svg>`;
}

/* ================= MARKET DETAIL ================= */
async function viewMarket(slug) {
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading market…</p></div>`;
  let d;
  try { d = await api('/api/markets/' + slug); }
  catch (e) { app().innerHTML = errorScreen(e.message, '#/'); return; }
  state.detail = d;
  state.comments = d.comments || [];
  const urlParams = new URLSearchParams((location.hash.split('?')[1] || ''));
  state.selOutcome = d.multi ? Math.min(d.outcomes.length - 1, Math.max(0, Number(urlParams.get('o') || 0) || 0)) : 0;
  if (urlParams.has('side')) orderSel.side = urlParams.get('side');
  if (urlParams.has('outcome')) orderSel.outcome = urlParams.get('outcome');
  if (urlParams.has('price')) {
    const p = Number(urlParams.get('price'));
    if (p >= 1 && p <= 99) orderSel.price = p;
  }
  if (d.multi) {
    state.book = (d.bookByOutcome || [])[state.selOutcome] || { bids: [], asks: [] };
    state.hist.set(slug + ':' + state.selOutcome, (d.historyByOutcome || [])[state.selOutcome] || []);
  } else {
    state.book = d.book;
    state.hist.set(slug, d.history || []);
  }
  upsertMarket(d);
  if (d.watching) state.watchSet.add(d.id); else state.watchSet.delete(d.id);

  const tradeable = d.status === 'open';
  const seriesChip = d.seriesSlug ? `<a class="series-chip" href="#/" title="Collection">${ic('folder', 13)} ${esc(d.seriesName)}</a>` : '';
  const optTabs = d.multi ? `
    <div class="opt-tabs" id="opt-tabs">
      ${d.outcomes.map((o) => `
        <button class="opt-tab ${o.idx === state.selOutcome ? 'active' : ''}" data-opt="${o.idx}">
          <span class="opt-emoji"><span class="opt-dot"></span></span>
          <span>${esc(o.label)}</span>
          <b class="opt-price ${o.idx === state.selOutcome ? 'sel' : ''}">${o.last === null || o.last === undefined ? '—' : fmtPrice(o.last)}</b>
        </button>`).join('')}
    </div>` : '';

  let closedPanel = '';
  if (!tradeable) {
    let msg = 'Trading has closed — resolution pending.';
    if (d.status === 'resolved') msg = `This market resolved <b>${d.outcome === 'yes' ? 'YES' : 'NO'}</b>. Winning shares paid $1 each.`;
    if (d.status === 'halted') msg = 'Trading is halted on this market by the exchange.';
    closedPanel = `<div class="empty" style="padding:26px 6px">${msg}</div>`;
  }

  const histKey = d.multi ? slug + ':' + state.selOutcome : slug;
  const selOpt = d.multi ? d.outcomes[state.selOutcome] : null;
  const resolvedLabel = d.status === 'resolved' && d.multi && d.winnerIdx !== null && d.winnerIdx !== undefined ? d.outcomes[d.winnerIdx].label : null;

  // external feed card — CoinGecko crypto / Open-Meteo weather (reference data only — probabilities come from trading)
  const fd = d.feed || null, fq = d.feedQuote || null, fp = d.feedProposal || null;
  const fmtUsd = (v) => v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let feedCard = '';
  if (fd) {
    const isWx = fd.kind === 'weather';
    const live = fq && fq.status === 'live';
    const valText = fq && fq.value != null ? (fq.valueText || (isWx ? `${fq.value}${fd.unitLabel}` : fmtUsd(fq.value))) : '—';
    const feedIc = isWx ? (fd.metric === 'precipitation' ? 'cloudRain' : 'thermometer') : 'bitcoin';
    const title = isWx ? `${ic(feedIc, 18)} ${fd.metricLabel} · ${fd.location || fd.latLonText}` : `${ic('bitcoin', 18)} ${fd.label} · ${fd.symbol}/${fd.currency}`;
    const locLine = isWx ? `<div>Location: <b>${esc(fd.location || fd.latLonText)}</b> <span class="muted">(${fd.latLonText})</span></div>` : '';
    const ruleWhat = isWx ? fd.metricLabel : fd.symbol;
    const ruleTarget = fd.targetText || (isWx ? fd.targetValue + fd.unitLabel : '$' + Number(fd.targetValue).toLocaleString('en-US'));
    const propVal = fp && (fp.valueText || (isWx ? fp.value + fd.unitLabel : fmtUsd(fp.value)));
    const propTarget = fp && (fp.targetText || ruleTarget);
    const propBlock = d.status === 'open' ? '' : (
      fp && fp.state === 'ready' ? `<div class="feed-prop ready">${ic('bot', 15)} Feed proposal: <b>${fp.outcome === 'yes' ? 'YES' : 'NO'}</b> — ${ruleWhat} ${fp.operatorText || fd.operatorText} ${propTarget} at ${propVal || '—'} (${timeAgo(fp.priceAt)}) · awaiting admin confirmation</div>`
      : fp && fp.state === 'blocked' ? `<div class="feed-prop blocked">${ic('alert', 15)} Feed proposal blocked — ${esc(fp.reason)}: ${esc(fp.detail || '')}. Auto-resolution is blocked until fresh data is available.</div>`
      : `<div class="feed-prop waiting">${ic('bot', 15)} Feed proposal will be generated at ${fmtClock(fd.resolutionTime)} from the ${isWx ? 'Open-Meteo' : 'CoinGecko'} ${isWx ? 'weather data' : 'price'}.</div>`);
    feedCard = `
      <div class="card card-pad section feed-card" id="feed-card">
        <div class="feed-head">
          <h3 style="margin:0">${title}</h3>
          <span class="feed-pill ${live ? 'live' : 'stale'}"><span class="dot"></span>${live ? 'LIVE' : 'STALE'}</span>
        </div>
        <div class="feed-price-row">
          <div class="feed-price">${valText}</div>
          <div class="feed-meta">
            <div>Source: <b>${esc(fq ? fq.source : (isWx ? 'Open-Meteo' : 'CoinGecko'))}</b></div>
            ${locLine}
            <div class="muted small">Updated ${fq && fq.fetchedAt ? timeAgo(fq.fetchedAt) : '—'}</div>
          </div>
          <button class="act-btn" id="feed-rf" title="Refresh market data">${ic('refresh', 13)} Refresh</button>
        </div>
        <div class="feed-rule">${ic('target', 15)} <b>YES</b> if ${ruleWhat} ${fd.operatorText} <b>${ruleTarget}</b> at ${fmtClock(fd.resolutionTime)}</div>
        <div class="muted small">Reference data from ${isWx ? 'Open-Meteo' : 'CoinGecko'} — the probability on this page is set by Predix trading, not by this ${isWx ? 'weather reading' : 'price'}.${fq && fq.error ? ' <span class="down">(' + esc(fq.error) + ')</span>' : ''}</div>
        ${propBlock}
      </div>`;
  }


  app().innerHTML = `
  <div class="mk-layout">
    <div class="mk-main-col">
      <div class="card mk-head section">
        <div class="mk-badges">
          ${statusBadge(d)}
          <span class="badge cat">${esc(d.category)}</span>
          <span class="badge cat">Closes ${fmtClock(d.closeTime)} · in ${countdown(d.closeTime - Date.now())}</span>
          ${seriesChip}
          ${resolvedLabel ? `<span class="badge resolved-yes">Winner: ${esc(resolvedLabel)}</span>` : ''}
        </div>
        <h1>${catIcon(d.category, 19)} ${esc(d.title)} <button class="starbtn ${d.watching ? 'on' : ''}" data-star="${d.id}" style="position:static;display:inline-flex;vertical-align:middle">${d.watching ? ic('starFilled', 19) : ic('star', 19)}</button></h1>
        <p class="page-sub" style="max-width:720px">${esc(d.description || '')}</p>
        ${optTabs}
        <div class="mk-quote">
          <div>
            <div class="lastprice" id="mk-last">${(d.multi ? (selOpt ? selOpt.last : null) : d.last) === null ? '—' : fmtPrice(d.multi ? selOpt.last : d.last)} <small>${d.multi ? esc(selOpt ? selOpt.label : '') + ' · ' + fmtPct(selOpt ? selOpt.last : null) : 'YES · ' + fmtPct(d.last)}</small></div>
            <div id="mk-chg"></div>
          </div>
        </div>
        <div class="stat-strip" id="stat-strip">
          <div class="st"><div class="lbl">Best bid</div><div class="val bid-c" id="st-bid">—</div></div>
          <div class="st"><div class="lbl">Best ask</div><div class="val ask-c" id="st-ask">—</div></div>
          <div class="st"><div class="lbl">Spread</div><div class="val" id="st-spread">—</div></div>
          <div class="st st-hl"><div class="lbl">Mid · probability</div><div class="val" id="st-mid">—</div></div>
          <div class="st"><div class="lbl">Last trade</div><div class="val" id="st-last">—</div><div class="sub" id="st-last-t"></div></div>
          <div class="st"><div class="lbl">24h volume</div><div class="val" id="st-vol">${fmtQty(d.vol24 || 0)}</div><div class="sub">shares</div></div>
          <div class="st"><div class="lbl">24h range</div><div class="val" id="st-range">${!d.multi && d.low24 !== null && d.low24 !== undefined ? fmtPrice(d.low24) + ' – ' + fmtPrice(d.high24) : '—'}</div></div>
          <div class="st"><div class="lbl">Liquidity</div><div class="val" id="st-liq">—</div><div class="sub" id="st-liq-s"></div></div>
        </div>
      </div>

      ${feedCard}
      ${strikeLadderHTML(d)}
      <div class="card chart-card section">
        <div class="chart-toolbar">
          <h3 style="margin:0">Price history <span class="muted small">— ${d.multi ? esc(selOpt ? selOpt.label : '') : 'YES'} price in point dollars ($0.01 – $0.99) · implied probability</span></h3>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div class="ranges" id="chart-type">
              <button data-ct="line" class="${state.chartType === 'candles' ? '' : 'active'}">Line</button>
              <button data-ct="candles" class="${state.chartType === 'candles' ? 'active' : ''}">Candles</button>
            </div>
            <div class="ranges" id="ranges">
              ${['1H', '24H', '7D', 'ALL'].map((r) => `<button data-r="${r}" class="${state.chartRange === r ? 'active' : ''}">${r}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="chart-wrap" id="chartwrap">${priceChart(state.hist.get(histKey) || [], state.chartRange, d)}<div class="chart-tip" id="chart-tip"></div><div class="chart-cross" id="chart-cross"></div></div>
      </div>

      <div class="two-col section" id="trading-core-grid">
        <div class="card card-pad" id="orderbook-card">
          <div class="bookhead">
            <h3 style="margin:0">Order book <span class="muted small">— click a price to load it</span></h3>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <div class="ranges" id="book-mode">
                <button data-bm="stacked" class="${state.bookMode === 'split' ? '' : 'active'}">Stacked</button>
                <button data-bm="split" class="${state.bookMode === 'split' ? 'active' : ''}">Split</button>
              </div>
              <div class="ranges" id="book-side">
                <button data-bs="yes" class="${state.bookSide === 'no' ? '' : 'active'}">YES</button>
                <button data-bs="no" class="${state.bookSide === 'no' ? 'active' : ''}">NO</button>
              </div>
            </div>
          </div>
          <div class="book" id="bookbox">${bookHTML(state.book)}</div>
        </div>
        ${marketActivityHTML(d)}
      </div>

      ${marketAnalyticsHTML(d)}

      ${profitCalcHTML(d)}

      <div class="card card-pad section" id="comments-card">
        <h3>${ic('users', 17)} Discussion <span class="muted small">— ${state.comments.length} comment${state.comments.length === 1 ? '' : 's'}</span></h3>
        <div class="comment-list" id="comment-list">${commentsHTML()}</div>
        ${state.me ? `
        <div class="comment-box">
          <span class="avatar" style="width:30px;height:30px;font-size:13px">${esc(state.me.username[0].toUpperCase())}</span>
          <input id="comment-in" class="input" maxlength="500" placeholder="Share your take on this market…" />
          <button class="mini-btn" id="comment-send" style="border-color:var(--ink);color:var(--ink)">Post</button>
        </div>` : `<div class="empty" style="padding:10px"><a href="#/login">Log in</a> to join the discussion.</div>`}
      </div>

      <div class="card card-pad section" id="related-card" style="display:none">
        <h3>${ic('chart', 17)} Related markets</h3>
        <div class="grid-markets" id="related-grid"></div>
      </div>

      <div class="card card-pad section" id="resolution-card">
        <h3>${ic('shield', 17)} Resolution</h3>
        <div class="res-timeline">
          <div class="res-step done"><span class="res-dot"></span>Created<small>${fmtClock(d.createdAt)}</small></div>
          <div class="res-arrow"></div>
          <div class="res-step ${d.status}"><span class="res-dot"></span>${d.status === 'open' ? 'Trading open' : d.status === 'halted' ? 'Halted' : d.status === 'closed' ? 'Closed · resolution pending' : 'Resolved'}<small>${d.status === 'resolved' ? (d.multi && d.winnerIdx !== null && d.winnerIdx !== undefined ? 'Winner: ' + esc((d.outcomes[d.winnerIdx] || {}).label || '') : 'Outcome: ' + (d.outcome || '').toUpperCase()) : 'live order book'}</small></div>
          <div class="res-arrow"></div>
          <div class="res-step ${d.status === 'resolved' ? 'done' : ''}"><span class="res-dot"></span>${d.status === 'resolved' ? 'Settled' : 'Closes'}<small>${d.status === 'resolved' ? 'winners paid $1/share' : fmtClock(d.closeTime) + ' · in ' + countdown(d.closeTime - Date.now())}</small></div>
        </div>
        <div class="two-col" style="margin-top:14px">
          <div class="src-box"><b>Resolution source</b><div>${esc(d.resolutionSource || '—')}</div></div>
          <div class="src-box"><b>Resolution rules</b><div>${esc(d.resolutionRules || d.resolutionRule || '—')}</div></div>
        </div>
        <div class="res-grid">
          <div class="rg"><span class="rg-l">Closing time</span><span class="rg-v">${fmtClock(d.closeTime)}</span></div>
          <div class="rg"><span class="rg-l">Expected resolution</span><span class="rg-v">${fmtClock(d.expectedResolutionTime || d.closeTime)}</span></div>
          <div class="rg"><span class="rg-l">Resolver</span><span class="rg-v">${esc(d.resolver || 'admin')}</span></div>
          ${d.resolution && !d.resolution.legacy ? `
          <div class="rg"><span class="rg-l">Resolved outcome</span><span class="rg-v win-c">${ic('check', 13)} ${esc(d.resolution.outcome)}</span></div>
          <div class="rg"><span class="rg-l">Resolver of record</span><span class="rg-v">${esc(d.resolution.resolvedBy.username)} <span class="muted">(${esc(d.resolution.resolvedBy.role)})</span></span></div>
          <div class="rg"><span class="rg-l">Resolved at</span><span class="rg-v">${fmtClock(d.resolution.resolvedAt)} <span class="muted">· ${timeAgo(d.resolution.resolvedAt)}</span></span></div>
          <div class="rg rg-wide"><span class="rg-l">Evidence / reference</span><span class="rg-v">${esc(d.resolution.evidence)}</span></div>
          ${d.resolution.notes ? `<div class="rg rg-wide"><span class="rg-l">Notes</span><span class="rg-v">${esc(d.resolution.notes)}</span></div>` : ''}
          <div class="rg rg-wide"><span class="rg-l">Evidence hash (SHA-256)</span><span class="rg-v res-hash" title="${d.resolution.hash}">${d.resolution.hash.slice(0, 24)}… ${d.resolution.verified ? ic('check', 12) + ' chain verified' : ic('alert', 12) + ' MISMATCH'}</span></div>` : ''}
          ${d.status === 'resolved' && (!d.resolution || d.resolution.legacy) ? `<div class="rg rg-wide"><span class="rg-l">Outcome</span><span class="rg-v">${d.multi && d.winnerIdx !== null && d.winnerIdx !== undefined && d.outcomes ? esc((d.outcomes[d.winnerIdx] || {}).label || '') : String(d.outcome === null || d.outcome === undefined ? '?' : d.outcome).toUpperCase()} <span class="muted">· resolved before the audit system existed</span></span></div>` : ''}
          ${d.proposal ? `<div class="rg rg-wide"><span class="rg-l">${ic('clock', 13)} Pending confirmation</span><span class="rg-v">Proposed <b>${esc(d.proposal.outcome)}</b> by ${esc(d.proposal.proposedBy)} — awaiting final confirmation</span></div>` : ''}
        </div>
      </div>
    </div>

    <div class="mk-side-col">
      <div class="mk-side-sticky">
        <div class="card card-pad" style="padding:12px 14px;margin-bottom:0" id="alert-card">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:13.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px">${ic('bell', 14)} Price alert</span>
            <select id="alert-dir" class="input" style="width:auto;padding:5px 8px;font-size:13px"><option value="above">crosses above</option><option value="below">drops below</option></select>
            <input id="alert-price" class="input" type="number" min="1" max="99" value="${d.multi ? (selOpt && selOpt.last || 50) : (d.last || 50)}" style="width:74px;padding:5px 8px;font-size:13px" />
            <span class="muted small">¢ (cents)</span>
            <button class="mini-btn" id="alert-set" style="border-color:var(--accent);color:var(--accent);margin-left:auto">Set alert</button>
          </div>
          <div id="alert-list"></div>
        </div>
        <div class="order-panel card card-pad" id="orderpanel">${tradeable ? orderPanelHTML(d) : closedPanel}</div>
        <div id="posbox">${positionHTML(d)}</div>
        <div id="myordersbox">${myOrdersHTML(d)}</div>
      </div>
    </div>
  </div>`;

  $('#mk-chg').innerHTML = (d.change !== null && d.change !== undefined)
    ? `<span class="chg ${d.change >= 0 ? 'up' : 'down'}">${d.change >= 0 ? '▲ +$' : '▼ −$'}${(Math.abs(d.change) / 100).toFixed(2)} (24h)</span>` : '';

  const redrawChart = () => {
    $('#chartwrap').innerHTML = priceChart(state.hist.get(histKey) || [], state.chartRange, d) +
      '<div class="chart-tip" id="chart-tip"></div><div class="chart-cross" id="chart-cross"></div>';
    wireChartHover();
  };
  $$('#ranges button').forEach((b) => b.onclick = () => {
    state.chartRange = b.dataset.r;
    $$('#ranges button').forEach((x) => x.classList.toggle('active', x === b));
    redrawChart();
  });
  $$('#chart-type button').forEach((b) => b.onclick = () => {
    state.chartType = b.dataset.ct;
    $$('#chart-type button').forEach((x) => x.classList.toggle('active', x === b));
    redrawChart();
  });
  $$('#opt-tabs .opt-tab').forEach((b) => b.onclick = () => {
    location.hash = '#/market/' + slug + '?o=' + b.dataset.opt;
  });
  wireChartHover();
  if (tradeable) wireOrderForm(d);
  wireBookClicks();
  wireActivityTabs(d);
  wireStars();
  const feedRf = $('#feed-rf'); if (feedRf) feedRf.onclick = () => viewMarket(slug);
  wireComments(slug);
  wireAlerts(d, state.selOutcome);
  loadRelated(d);

  // Kalshi book layout mode (Stacked vs Split)
  $$('#book-mode button').forEach((b) => b.onclick = () => {
    state.bookMode = b.dataset.bm;
    $$('#book-mode button').forEach((x) => x.classList.toggle('active', x === b));
    const box = $('#bookbox');
    if (box) { box.innerHTML = bookHTML(state.book); wireBookClicks(); }
  });

  $$('#book-side button').forEach((b) => b.onclick = () => {
    state.bookSide = b.dataset.bs;
    $$('#book-side button').forEach((x) => x.classList.toggle('active', x === b));
    const box = $('#bookbox');
    if (box) { box.innerHTML = bookHTML(state.book); wireBookClicks(); }
    updateMarketStats();
  });

  // Kalshi Multi-Outcome Strike Ladder click interactions
  $$('.strike-btn').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const idx = parseInt(b.dataset.idx, 10);
    const side = b.dataset.side;
    const price = parseInt(b.dataset.price, 10);
    state.selOutcome = idx;
    orderSel.outcome = side;
    if (price && price > 0 && price < 100) orderSel.price = price;
    location.hash = '#/market/' + slug + '?o=' + idx;
  });
  $$('.strike-row').forEach((r) => r.onclick = () => {
    const idx = parseInt(r.dataset.idx, 10);
    state.selOutcome = idx;
    location.hash = '#/market/' + slug + '?o=' + idx;
  });

  // Kalshi Profit & Return Simulator
  wireProfitCalc(d);

  // 1-Click Cash Out
  const cashOut = $('#btn-cashout');
  if (cashOut) {
    cashOut.onclick = async () => {
      const outcome = cashOut.dataset.o;
      const qty = parseInt(cashOut.dataset.q, 10);
      if (!qty || qty <= 0) return;
      if (!confirm(`Cash out ${qty} ${outcome.toUpperCase()} shares at market price?`)) return;
      cashOut.disabled = true;
      cashOut.textContent = 'Cashing out…';
      try {
        await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            marketId: d.id,
            outcomeIdx: d.multi ? state.selOutcome : 0,
            outcome,
            side: 'sell',
            type: 'market',
            qty,
            tif: 'IOC'
          })
        });
        toast(`Successfully cashed out ${qty} ${outcome.toUpperCase()} shares!`);
        viewMarket(slug);
      } catch (err) {
        toast(err.message, true);
        cashOut.disabled = false;
        cashOut.innerHTML = `${ic('arrowDownRight', 14)} 1-Click Cash Out (${qty} ${outcome.toUpperCase()})`;
      }
    };
  }

  updateMarketStats();
}

/* ----- comments / alerts / related ----- */
function commentsHTML() {
  if (!state.comments.length) return '<div class="empty" style="padding:12px">No comments yet — be the first to share your take.</div>';
  return state.comments.map((c) => `
    <div class="comment-item">
      <span class="avatar" style="width:28px;height:28px;font-size:12px">${esc((c.user || '?')[0].toUpperCase())}</span>
      <div style="min-width:0">
        <div class="comment-head"><a href="#/trader/${esc(c.user)}">@${esc(c.user)}</a> <span class="muted small">${timeAgo(c.ts)}</span></div>
        <div class="comment-body">${esc(c.body)}</div>
      </div>
    </div>`).join('');
}
function wireComments(slug) {
  const send = $('#comment-send');
  if (send) send.onclick = async () => {
    const inp = $('#comment-in');
    const body = inp.value.trim();
    if (!body) return;
    try {
      const r = await api('/api/markets/' + slug + '/comments', { method: 'POST', body: { body } });
      state.comments = [r.comment, ...state.comments];
      $('#comment-list').innerHTML = commentsHTML();
      inp.value = '';
      toast('Comment posted');
    } catch (e) { toast(e.message, true); }
  };
  const inp = $('#comment-in');
  if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') send.click(); };
}
function wireAlerts(d, idx) {
  const set = $('#alert-set');
  if (!set) return;
  if (!state.me) { set.onclick = () => { toast('Log in to set alerts.', true); location.hash = '#/login'; }; return; }
  set.onclick = async () => {
    try {
      await api('/api/me/alerts', { method: 'POST', body: {
        marketId: d.id, outcomeIdx: idx, dir: $('#alert-dir').value, price: +$('#alert-price').value,
      } });
      toast('Alert set — you will be notified when price crosses.');
      renderMarketAlerts(d, idx);
    } catch (e) { toast(e.message, true); }
  };
  renderMarketAlerts(d, idx);
}
async function renderMarketAlerts(d, idx) {
  const box = $('#alert-list');
  if (!box) return;
  try {
    const { alerts } = await api('/api/me/alerts');
    const mine = alerts.filter((a) => a.marketId === d.id && a.outcomeIdx === idx);
    box.innerHTML = mine.map((a) => `
      <div class="pos-line" style="margin-top:8px">
        <span class="small muted">${a.status === 'active' ? ic('circle', 12) : ic('check', 12)} ${a.dir === 'above' ? 'above' : 'below'} ${fmtPrice(a.price)} ${a.status === 'triggered' ? '· triggered' : ''}</span>
        <button class="mini-btn" data-delalert="${a.id}">Remove</button>
      </div>`).join('');
    $$('[data-delalert]').forEach((b) => b.onclick = async () => {
      try { await api('/api/me/alerts/' + b.dataset.delalert, { method: 'DELETE' }); renderMarketAlerts(d, idx); }
      catch (e) { toast(e.message, true); }
    });
  } catch {}
}
async function loadRelated(d) {
  const card = $('#related-card');
  if (!card) return;
  try {
    if (!state.markets.length) {
      const r = await api('/api/markets');
      state.markets = r.markets;
      state.markets.forEach((m) => { upsertMarket(m); if (m.spark) state.sparks.set(m.slug, m.spark); });
    }
    const related = state.markets.filter((m) => m.slug !== d.slug && (m.seriesSlug && m.seriesSlug === d.seriesSlug || (!d.seriesSlug && m.category === d.category)))
      .sort((a, b) => (b.vol24 || 0) - (a.vol24 || 0)).slice(0, 2);
    if (!related.length) return;
    card.style.display = '';
    $('#related-grid').innerHTML = related.map((m) => marketCard(state.byslug.get(m.slug) || m)).join('');
    wireStars();
  } catch {}
}

/* ----- chart ----- */
function candleChart(data) {
  // bucket the series into OHLC candles
  const spans = { '1H': 5 * 60e3, '24H': 36e5, '7D': 4 * 36e5, 'ALL': 864e5 };
  const bucket = spans[state.chartRange] || 36e5;
  const candles = [];
  let cur = null;
  for (const [ts, p] of data) {
    const b = Math.floor(ts / bucket);
    if (!cur || cur.b !== b) {
      if (cur) candles.push(cur);
      cur = { b, o: p, h: p, l: p, c: p, t: b * bucket };
    } else {
      cur.h = Math.max(cur.h, p); cur.l = Math.min(cur.l, p); cur.c = p;
    }
  }
  if (cur) candles.push(cur);
  if (candles.length < 2) return '<div class="empty">Not enough data for candles.</div>';
  const W = 760, H = 240, padL = 34, padR = 12, padT = 14, padB = 26;
  let lo = Math.min(...candles.map((c) => c.l)), hi = Math.max(...candles.map((c) => c.h));
  lo = Math.max(0, lo - 4); hi = Math.min(100, hi + 4);
  if (hi - lo < 8) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 5); hi = Math.min(100, mid + 5); }
  const Y = (p) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  const cw = Math.max(2, (W - padL - padR) / candles.length - 2);
  const gridVals = [0, 25, 50, 75, 100].filter((v) => v >= lo && v <= hi);
  const body = candles.map((c, i) => {
    const x = padL + (i + 0.5) * (W - padL - padR) / candles.length;
    const up = c.c >= c.o;
    const col = up ? 'var(--chart-up)' : 'var(--chart-down)';
    const yO = Y(c.o), yC = Y(c.c);
    const top = Math.min(yO, yC), h = Math.max(1.5, Math.abs(yO - yC));
    return `<line x1="${x}" x2="${x}" y1="${Y(c.h)}" y2="${Y(c.l)}" stroke="${col}" stroke-width="1.1" opacity=".85"/>
      <rect x="${x - cw / 2}" y="${top}" width="${cw}" height="${h}" fill="${col}" opacity="${up ? 0.95 : 0.82}" rx="${Math.min(2.5, cw / 4)}"/>`;
  }).join('');
  state.chartData = data;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" id="mainchart">
    ${gridVals.map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="chgrid"/>
      <text x="${padL - 7}" y="${Y(v) + 4}" text-anchor="end" class="chaxis">${fmtPrice(v)}</text>`).join('')}
    ${body}
  </svg>`;
}

function priceChart(pts, range) {
  if (state.chartType === 'candles') {
    const now = Date.now();
    const spans = { '1H': 36e5, '24H': 864e5, '7D': 7 * 864e5, 'ALL': Infinity };
    const data = pts.filter((p) => p[0] >= now - spans[range]);
    return candleChart(data.length >= 2 ? data : pts.slice(-2));
  }
  const now = Date.now();
  const spans = { '1H': 36e5, '24H': 864e5, '7D': 7 * 864e5, 'ALL': Infinity };
  const cut = now - spans[range];
  let data = pts.filter((p) => p[0] >= cut);
  if (data.length < 2) data = pts.slice(-2);
  if (data.length < 2) return '<div class="empty">No price data yet.</div>';
  state.chartData = data;
  const W = 760, H = 240, padL = 34, padR = 12, padT = 14, padB = 26;
  let lo = Math.min(...data.map((p) => p[1])), hi = Math.max(...data.map((p) => p[1]));
  lo = Math.max(0, lo - 4); hi = Math.min(100, hi + 4);
  if (hi - lo < 8) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 5); hi = Math.min(100, mid + 5); }
  const t0 = data[0][0], t1 = data[data.length - 1][0];
  const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const Y = (p) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  // smooth path (catmull-rom → cubic bezier) over the sample points
  const raw = data.map((p) => [X(p[0]), Y(p[1])]);
  let line = `M${raw[0][0].toFixed(1)},${raw[0][1].toFixed(1)}`;
  for (let i = 0; i < raw.length - 1; i++) {
    const p0 = raw[Math.max(0, i - 1)], p1 = raw[i], p2 = raw[i + 1], p3 = raw[Math.min(raw.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    if (i > 0 && Math.abs(p2[0] - p1[0]) < 1.5) continue; // skip ultra-dense micro segments
    line += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const up = (data[data.length - 1][1] - data[0][1]) >= 0;
  const col = up ? 'var(--chart-up)' : 'var(--chart-down)';
  const gridVals = [0, 25, 50, 75, 100].filter((v) => v >= lo && v <= hi);
  const lastP = data[data.length - 1][1];
  const lx = X(t1).toFixed(1), ly = Y(lastP).toFixed(1);
  return `
  <svg viewBox="0 0 ${W} ${H}" class="chart-svg" id="mainchart">
    <defs>
      <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}" stop-opacity=".26"/>
        <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridVals.map((v) => `
      <line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="chgrid"/>
      <text x="${padL - 7}" y="${Y(v) + 4}" text-anchor="end" class="chaxis">${v}%</text>`).join('')}
    <line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" class="chaxis-line"/>
    <path d="${line} L${lx},${H - padB} L${X(t0).toFixed(1)},${H - padB} Z" fill="url(#area)" stroke="none"/>
    <line x1="${padL}" x2="${W - padR}" y1="${ly}" y2="${ly}" stroke="${col}" stroke-width="1" stroke-dasharray="4 6" opacity=".3"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="7" fill="${col}" opacity=".18"/>
    <circle cx="${lx}" cy="${ly}" r="3.4" fill="${col}" stroke="var(--panel)" stroke-width="1.6"/>
  </svg>`;
}

function wireChartHover() {
  const wrap = $('#chartwrap');
  const svg = $('#mainchart');
  if (!wrap || !svg || !state.chartData || !state.chartData.length) return;
  const tip = $('#chart-tip');
  const cross = $('#chart-cross');
  const data = state.chartData;
  wrap.onmousemove = (e) => {
    if (!svg || !state.chartData || !state.chartData.length) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const W = 760, H = 240, padL = 34, padR = 12, padT = 14, padB = 26;
    let lo = Math.min(...data.map((p) => p[1])), hi = Math.max(...data.map((p) => p[1]));
    lo = Math.max(0, lo - 4); hi = Math.min(100, hi + 4);
    if (hi - lo < 8) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 5); hi = Math.min(100, mid + 5); }
    const idx = Math.round(ratio * (data.length - 1));
    const t0 = data[0][0], t1 = data[data.length - 1][0];
    const x = padL + ((data[idx][0] - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
    const y = padT + (1 - (data[idx][1] - lo) / (hi - lo)) * (H - padT - padB);
    const leftPct = (x / W) * 100, topPct = (y / H) * 100;
    cross.style.display = 'block';
    cross.style.left = leftPct + '%';
    tip.style.display = 'block';
    tip.style.left = leftPct + '%';
    tip.style.top = topPct + '%';
    if (leftPct < 18) tip.style.transform = 'translate(10px, -50%)';
    else if (leftPct > 82) tip.style.transform = 'translate(calc(-100% - 10px), -50%)';
    else if (topPct < 25) tip.style.transform = 'translate(-50%, 15px)';
    else tip.style.transform = 'translate(-50%, -125%)';
    tip.innerHTML = `
      <div style="font-size:12.5px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:6px">
        <span>${Math.round(data[idx][1])}% chance</span>
        <span class="muted" style="font-size:11px;font-weight:600">(${fmtPrice(data[idx][1])})</span>
      </div>
      <div style="font-size:10.5px;color:var(--muted);font-weight:500;margin-top:2px">${fmtClock(data[idx][0])}</div>`;
  };
  wrap.onmouseleave = () => { tip.style.display = 'none'; cross.style.display = 'none'; };
}

/* ----- Kalshi strike ladder (multi-outcome events) ----- */
function strikeLadderHTML(d) {
  if (!d.multi || !d.outcomes || d.outcomes.length < 2) return '';
  const rows = d.outcomes.map((o) => {
    const isSel = o.idx === state.selOutcome;
    const last = o.last ?? 50;
    const yesPrice = o.last ?? (o.ask ?? 50);
    const noPrice = 100 - yesPrice;
    const pct = Math.max(0, Math.min(100, last));
    return `
      <tr class="strike-row ${isSel ? 'selected' : ''}" data-opt="${o.idx}">
        <td class="strike-title">
          <span class="opt-dot"></span>
          <b>${esc(o.label)}</b>
        </td>
        <td class="strike-prob">
          <div class="strike-bar-wrap">
            <div class="strike-bar-fill" style="width:${pct}%"></div>
            <span class="strike-bar-text">${fmtPct(last)}</span>
          </div>
        </td>
        <td class="strike-action num">
          <button type="button" class="strike-btn yes" data-opt="${o.idx}" data-side="yes" title="Trade YES on ${esc(o.label)}">
            <small>YES</small> <b>${fmtPrice(yesPrice)}</b>
          </button>
        </td>
        <td class="strike-action num">
          <button type="button" class="strike-btn no" data-opt="${o.idx}" data-side="no" title="Trade NO on ${esc(o.label)}">
            <small>NO</small> <b>${fmtPrice(noPrice)}</b>
          </button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="card card-pad section strike-card" id="strike-card">
      <div class="bookhead">
        <h3 style="margin:0">${ic('layers', 16)} Kalshi Strike Ladder <span class="muted small">— all outcomes &amp; live prices</span></h3>
      </div>
      <div class="tablewrap">
        <table class="strike-table">
          <thead>
            <tr>
              <th>Outcome / Strike</th>
              <th style="min-width:140px">Implied probability</th>
              <th class="num" style="width:115px">Buy YES</th>
              <th class="num" style="width:115px">Buy NO</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ----- Kalshi profit & returns simulator ----- */
function profitCalcHTML(d) {
  const curPrice = (d.multi && d.outcomes && d.outcomes[state.selOutcome]) ? (d.outcomes[state.selOutcome].last ?? 50) : (d.last ?? 50);
  const exitInit = Math.min(99, Math.max(1, curPrice + 15));
  return `
    <div class="card card-pad section calc-card" id="calc-card">
      <div class="bookhead">
        <h3 style="margin:0">${ic('trendingUp', 16)} Kalshi Profit &amp; Returns Simulator <span class="muted small">— simulate payoff before close</span></h3>
      </div>
      <div class="calc-body">
        <div class="calc-row">
          <div class="calc-col calc-col-entry">
            <label>Entry price (prob)</label>
            <div class="calc-val" id="calc-in-price">${fmtPrice(curPrice)} <small class="muted">(${curPrice}%)</small></div>
          </div>
          <div class="calc-col calc-col-slider">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <label>Target exit probability</label>
              <b id="calc-slider-val" class="calc-slider-badge">${fmtPrice(exitInit)} (${exitInit}%)</b>
            </div>
            <input type="range" id="calc-slider" min="1" max="99" value="${exitInit}" class="calc-range" />
          </div>
          <div class="calc-col calc-col-qty">
            <label>Contracts</label>
            <input type="number" id="calc-qty" class="input" style="padding:7px 10px;font-size:13px" min="1" max="5000" value="50" />
          </div>
        </div>
        <div class="calc-metrics" id="calc-metrics"></div>
      </div>
    </div>`;
}

function wireProfitCalc(d) {
  const slider = $('#calc-slider'), qtyIn = $('#calc-qty'), metrics = $('#calc-metrics'), sval = $('#calc-slider-val');
  if (!slider || !qtyIn || !metrics) return;
  const curPrice = (d.multi && d.outcomes && d.outcomes[state.selOutcome]) ? (d.outcomes[state.selOutcome].last ?? 50) : (d.last ?? 50);

  function recalc() {
    const exitPrice = +slider.value;
    const q = Math.max(1, Math.floor(+qtyIn.value || 1));
    if (sval) sval.textContent = `${fmtPrice(exitPrice)} (${exitPrice}%)`;
    const cost = q * curPrice;
    const earlyValue = q * exitPrice;
    const earlyProfit = earlyValue - cost;
    const earlyRoi = cost > 0 ? Math.round((earlyProfit / cost) * 100) : 0;
    const holdPayout = q * 100;
    const holdProfit = holdPayout - cost;
    const holdRoi = cost > 0 ? Math.round((holdProfit / cost) * 100) : 0;

    metrics.innerHTML = `
      <div class="calc-met">
        <div class="m-lbl">Initial investment</div>
        <div class="m-val">${fmtMoney(cost)}</div>
        <div class="sub">${q} contracts @ ${fmtPrice(curPrice)}</div>
      </div>
      <div class="calc-met">
        <div class="m-lbl">Early exit profit</div>
        <div class="m-val ${earlyProfit >= 0 ? 'up' : 'down'}">${earlyProfit >= 0 ? '+' : ''}${fmtMoney(earlyProfit)}</div>
        <div class="sub">${earlyProfit >= 0 ? '+' : ''}${earlyRoi}% ROI at ${exitPrice}¢</div>
      </div>
      <div class="calc-met">
        <div class="m-lbl">Payout if held to YES</div>
        <div class="m-val up">${fmtMoney(holdPayout)}</div>
        <div class="sub">+${fmtMoney(holdProfit)} (+${holdRoi}% ROI)</div>
      </div>`;
  }
  slider.oninput = recalc;
  qtyIn.oninput = recalc;
  recalc();
}

/* ----- real-time market intelligence & analytics ----- */
function marketAnalyticsHTML(d) {
  const b = state.book || { bids: [], asks: [] };
  const totalBids = (b.bids || []).reduce((s, x) => s + x.qty, 0);
  const totalAsks = (b.asks || []).reduce((s, x) => s + x.qty, 0);
  const totalDepth = totalBids + totalAsks;
  const buyPct = totalDepth > 0 ? Math.round((totalBids / totalDepth) * 100) : 50;
  const sellPct = 100 - buyPct;
  const imbalance = buyPct - sellPct;

  const trades = d.trades || [];
  let vol = 0, val = 0;
  trades.forEach((t) => {
    const q = t.qty || 0;
    vol += q;
    val += (t.price || 50) * q;
  });
  const vwap = vol > 0 ? Math.round(val / vol) : (d.last || 50);
  const lastPrice = d.last || 50;
  const diff = lastPrice - vwap;

  let sentScore = 50 + Math.round(imbalance * 0.25) + Math.round((d.change || 0) * 0.5);
  sentScore = Math.max(5, Math.min(95, sentScore));
  let sentClass = 'Neutral';
  if (sentScore >= 72) sentClass = 'Strongly Bullish';
  else if (sentScore >= 56) sentClass = 'Moderately Bullish';
  else if (sentScore <= 28) sentClass = 'Strongly Bearish';
  else if (sentScore <= 44) sentClass = 'Moderately Bearish';

  const whales = trades.filter((t) => (t.qty || 0) >= 40 || ((t.price || 0) * (t.qty || 0)) >= 2000).slice(0, 5);

  return `
    <div class="card card-pad section market-analytics-card" id="market-analytics-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <h3 style="margin:0">${ic('activity', 18)} Real-Time Market Intelligence</h3>
          <span class="an-live-indicator"><span class="an-pulse-dot"></span>LIVE ORDER FLOW</span>
        </div>
        <div class="analytics-sentiment-pill" style="font-size:12px;font-weight:700">
          Sentiment: <b style="color:${sentScore >= 50 ? 'var(--up)' : 'var(--down)'}">${sentClass}</b>
          <span class="muted small">(${sentScore}/100)</span>
        </div>
      </div>

      <div class="analytics-metrics-grid">
        <div class="an-metric-box">
          <div class="an-metric-head">
            <span class="an-lbl">Order Flow Imbalance</span>
            <span class="an-badge ${imbalance >= 0 ? 'bull' : 'bear'}" id="an-imbalance-lbl">${imbalance >= 0 ? '+' : ''}${imbalance}%</span>
          </div>
          <div class="imbalance-bar-wrap" style="margin-top:8px">
            <div class="imbalance-fill-buy" id="an-imbalance-buy" style="width:${buyPct}%" title="${buyPct}% Bids"></div>
            <div class="imbalance-fill-sell" id="an-imbalance-sell" style="width:${sellPct}%" title="${sellPct}% Asks"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-top:6px;font-weight:700">
            <span style="color:var(--up)" id="an-bids-depth">${buyPct}% Bids (${totalBids})</span>
            <span style="color:var(--down)" id="an-asks-depth">${sellPct}% Asks (${totalAsks})</span>
          </div>
        </div>

        <div class="an-metric-box">
          <div class="an-metric-head">
            <span class="an-lbl">24h VWAP Benchmark</span>
            <span class="an-badge flat">Fair Value</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-top:4px">
            <span style="font-size:22px;font-weight:800" id="an-vwap-val">${fmtPrice(vwap)}</span>
            <span class="small muted">VWAP</span>
            <span class="chgpill ${diff >= 0 ? 'up' : 'down'}" style="margin-left:auto" id="an-vwap-diff">
              ${diff >= 0 ? '▲ +' : '▼ −'}${(Math.abs(diff) / 100).toFixed(2)}
            </span>
          </div>
          <div class="small muted" style="margin-top:6px" id="an-vwap-text">
            ${diff > 0 ? 'Trading at premium over volume average' : diff < 0 ? 'Trading at discount below volume average' : 'Trading at volume average'}
          </div>
        </div>

        <div class="an-metric-box">
          <div class="an-metric-head">
            <span class="an-lbl">Order Book Liquidity</span>
            <span class="an-badge bull">Grade ${totalDepth >= 200 ? 'A' : totalDepth >= 50 ? 'B' : 'C'}</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-top:4px">
            <span style="font-size:22px;font-weight:800">${fmtQty(totalDepth)}</span>
            <span class="small muted">contracts live</span>
          </div>
          <div class="small muted" style="margin-top:6px">
            Tightest market maker spread &amp; continuous depth
          </div>
        </div>
      </div>

      ${whales.length ? `
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <div style="font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">
          🐋 Recent Block Executions (Whale Tape)
        </div>
        <div class="whale-tape-mini">
          ${whales.map((w) => `
            <div class="whale-mini-item">
              <span class="tag-side ${w.side || (w.price >= 50 ? 'yes' : 'no')}">${(w.side || (w.price >= 50 ? 'yes' : 'no')).toUpperCase()}</span>
              <b>${fmtQty(w.qty)} contracts</b>
              <span>@ ${fmtPrice(w.price)}</span>
              <span class="whale-val-pill">+$${((w.price * w.qty) / 100).toFixed(2)}</span>
              <span class="muted small" style="margin-left:auto">${timeAgo(w.ts || w.time || Date.now())}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
}

/* ----- order book (stacked & side-by-side split, YES/NO switchable) ----- */
function bookHTML(book) {
  const noView = state.bookSide === 'no';
  const fx = (p) => (noView ? 100 - p : p);
  const bids = (book.bids || []).slice(0, 9);
  const asks = (book.asks || []).slice(0, 9).slice().reverse(); // best ask nearest the spread
  const maxCum = Math.max(1, ...bids.map((b) => b.cum), ...asks.map((a) => a.cum));
  const row = (o, cls) => `
    <div class="book-row ${cls}" data-p="${o.price}" title="Click to load ${noView ? 'Buy NO @ ' + fmtPrice(fx(o.price)) : 'Buy YES @ ' + fmtPrice(fx(o.price))} into the trade panel">
      <span class="depth" style="width:${Math.max(6, (o.cum / maxCum) * 100)}%"></span>
      <span class="p ${cls}-p">${fmtPrice(fx(o.price))}</span>
      <span class="q">${fmtQty(o.qty)}</span>
      <span class="c">${fmtQty(o.cum)}</span>
      <span class="tag ${o.isBot ? 'bot' : ''}" title="${o.isBot ? 'Market maker' : 'Trader'} order">${o.isBot ? 'MM' : '·'}</span>
    </div>`;
  const bestBid = (book.bids || [])[0];
  const bestAsk = (book.asks || [])[0];
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;
  const mid = bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : null;
  const spreadRow = `
    <div class="book-spread">
      <span>${spread !== null ? 'Spread ' + fmtPrice(spread) : 'Spread —'}</span>
      <b>${mid !== null ? 'Mid ' + fmtPrice(noView ? Math.round(100 - mid) : mid) : 'No quotes yet'}</b>
      <span class="muted small">${noView ? 'NO view' : 'YES view'}</span>
    </div>`;
  const head = `<div class="book-cols2"><span>Price</span><span>Shares</span><span>Total</span><span></span></div>`;
  if (!bids.length && !asks.length) return `<div class="book-empty" style="padding:22px 0">Book is empty — market makers are quoting…</div>${head}${spreadRow}`;

  if (state.bookMode === 'split') {
    const sbsHead = `<div class="book-sbs-head"><span>Price</span><span>Contracts</span><span>Value</span></div>`;
    const sbsRow = (o, cls) => `
      <div class="book-row ${cls}" data-p="${o.price}" title="Click to trade @ ${fmtPrice(fx(o.price))}">
        <span class="depth" style="width:${Math.max(6, (o.cum / maxCum) * 100)}%"></span>
        <span class="p ${cls}-p">${fmtPrice(fx(o.price))}</span>
        <span class="q">${fmtQty(o.qty)}</span>
        <span class="c">${fmtMoney(Math.round(o.qty * fx(o.price)))}</span>
      </div>`;
    return `
      <div class="book-side-by-side">
        <div class="book-sbs-col">
          <div class="book-col-title bid-c">Bids (${bids.length})</div>
          ${sbsHead}
          <div class="book-stack">${bids.length ? bids.map((o) => sbsRow(o, 'bid')).join('') : '<div class="book-empty">no bids</div>'}</div>
        </div>
        <div class="book-sbs-col">
          <div class="book-col-title ask-c">Asks (${asks.length})</div>
          ${sbsHead}
          <div class="book-stack">${asks.length ? asks.map((o) => sbsRow(o, 'ask')).join('') : '<div class="book-empty">no asks</div>'}</div>
        </div>
      </div>
      ${spreadRow}`;
  }

  return `
    <div class="book-stack">
      <div class="book-aside">
        ${head}
        ${asks.length ? asks.map((o) => row(o, 'ask')).join('') : '<div class="book-empty">no asks</div>'}
      </div>
      ${spreadRow}
      <div class="book-bside">
        ${bids.length ? bids.map((o) => row(o, 'bid')).join('') : '<div class="book-empty">no bids</div>'}
      </div>
    </div>`;
}
function wireBookClicks() {
  $$('#bookbox .book-row').forEach((r) => r.onclick = () => {
    const p = +r.dataset.p; // YES-space price of that level
    if (state.bookSide === 'no') {
      refreshOrderPanel({ outcome: 'no', side: 'buy', type: 'limit', price: 100 - p });
    } else {
      refreshOrderPanel({ outcome: 'yes', side: 'buy', type: 'limit', price: p });
    }
  });
}

/* ----- live market stats (computed from the real order book) ----- */
function computeBookStats(book) {
  const bids = (book && book.bids) || [];
  const asks = (book && book.asks) || [];
  const bestBid = bids.length ? bids[0].price : null;
  const bestAsk = asks.length ? asks[0].price : null;
  const spread = (bestBid !== null && bestAsk !== null) ? bestAsk - bestBid : null;
  const mid = (bestBid !== null && bestAsk !== null) ? (bestBid + bestAsk) / 2 : (bestBid !== null ? bestBid : bestAsk);
  let liquidity = 0, shares = 0;
  for (const o of bids) { liquidity += o.price * o.qty; shares += o.qty; }
  for (const o of asks) { liquidity += (100 - o.price) * o.qty; shares += o.qty; }
  return { bestBid, bestAsk, spread, mid, liquidity, shares };
}
function updateMarketStats() {
  const d = state.detail;
  if (!d) return;
  const m = state.byslug.get(d.slug) || d;
  const multi = d.multi;
  const noView = state.bookSide === 'no';
  const st = computeBookStats(state.book);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  if (noView) { // NO quotes are the YES book mirrored: NO best bid = 100 − YES best ask
    set('#st-bid', st.bestAsk === null ? '—' : fmtPrice(100 - st.bestAsk));
    set('#st-ask', st.bestBid === null ? '—' : fmtPrice(100 - st.bestBid));
  } else {
    set('#st-bid', st.bestBid === null ? '—' : fmtPrice(st.bestBid));
    set('#st-ask', st.bestAsk === null ? '—' : fmtPrice(st.bestAsk));
  }
  set('#st-spread', st.spread === null ? '—' : fmtPrice(st.spread));
  if (st.mid === null || st.mid === undefined) set('#st-mid', '—');
  else {
    const mv = Math.round(st.mid * 10) / 10;
    set('#st-mid', (noView ? fmtPrice(Math.round(1000 - mv * 10) / 10) : fmtPrice(mv)) + ' · ' + Math.round(noView ? 100 - mv : mv) + '%');
  }
  const tape = (d.trades || []).find((t) => (!multi || (t.outcomeIdx || 0) === state.selOutcome));
  const lastPx = tape ? tape.price : (multi ? (((m.outcomes || [])[state.selOutcome] || {}).last ?? null) : (m.last ?? null));
  set('#st-last', lastPx === null || lastPx === undefined ? '—' : fmtPrice(lastPx));
  set('#st-last-t', tape ? timeAgo(tape.ts) : '');
  set('#st-vol', fmtQty(m.vol24 || 0));
  if (!multi && m.low24 !== null && m.low24 !== undefined && m.high24 !== null && m.high24 !== undefined) {
    set('#st-range', fmtPrice(m.low24) + ' – ' + fmtPrice(m.high24));
  }
  set('#st-liq', st.liquidity ? fmtMoney0(st.liquidity) : '—');
  set('#st-liq-s', st.shares ? fmtQty(st.shares) + ' shares listed' : '');

  // update live order flow imbalance bar
  const bks = state.book || { bids: [], asks: [] };
  const tBids = (bks.bids || []).reduce((s, x) => s + x.qty, 0);
  const tAsks = (bks.asks || []).reduce((s, x) => s + x.qty, 0);
  const tDepth = tBids + tAsks;
  const bPct = tDepth > 0 ? Math.round((tBids / tDepth) * 100) : 50;
  const sPct = 100 - bPct;
  const imb = bPct - sPct;

  const imbLbl = $('#an-imbalance-lbl');
  if (imbLbl) {
    imbLbl.textContent = (imb >= 0 ? '+' : '') + imb + '%';
    imbLbl.className = 'an-badge ' + (imb >= 0 ? 'bull' : 'bear');
  }
  const fillB = $('#an-imbalance-buy'); if (fillB) fillB.style.width = bPct + '%';
  const fillS = $('#an-imbalance-sell'); if (fillS) fillS.style.width = sPct + '%';
  const txtB = $('#an-bids-depth'); if (txtB) txtB.textContent = `${bPct}% Bids (${tBids})`;
  const txtS = $('#an-asks-depth'); if (txtS) txtS.textContent = `${sPct}% Asks (${tAsks})`;
}

/* ----- trades ----- */
const kindLabel = { BY: 'Buy YES', BN: 'Buy NO', SY: 'Sell YES', SN: 'Sell NO' };
function tradesHTML(trades) {
  if (!trades.length) return '<div class="empty">No trades yet.</div>';
  return `<table class="trades-table">
    <thead><tr><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th>Time</th><th>Traders</th></tr></thead>
    <tbody>${trades.slice(0, 50).map((t) => `
      <tr>
        <td><span class="t-side ${t.takerKind === 'BY' || t.takerKind === 'BN' ? 'buy' : 'sell'}">${kindLabel[t.takerKind] || t.takerKind}</span></td>
        <td class="num"><b>${fmtPrice(t.price)}</b></td>
        <td class="num">${fmtQty(t.qty)}</td>
        <td class="muted">${timeAgo(t.ts)}</td>
        <td class="muted small">${esc(t.taker)} ↔ ${esc(t.maker)}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

function marketActivityHTML(d, tab = state.marketActivityTab || 'market') {
  const allMyOrders = [...(d.myOrders || []), ...(d.myPastOrders || [])];
  const myTrades = d.myTrades || [];

  return `
    <div class="card card-pad" id="activity-card">
      <div class="bookhead" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="ranges" id="activity-tabs">
          <button data-mat="market" class="${tab === 'market' ? 'active' : ''}">Market Trades (${(d.trades || []).length})</button>
          <button data-mat="my-orders" class="${tab === 'my-orders' ? 'active' : ''}">My Orders (${allMyOrders.length})</button>
          <button data-mat="my-trades" class="${tab === 'my-trades' ? 'active' : ''}">My Trades (${myTrades.length})</button>
        </div>
      </div>
      <div id="activity-content">
        ${tab === 'market' ? `
          <div class="tablewrap trades-scroll" id="tradesbox">${tradesHTML(d.trades || [])}</div>
        ` : tab === 'my-orders' ? `
          ${!state.me ? `<div class="empty" style="padding:24px 0"><a href="#/login">Log in</a> to view your bids &amp; orders on this market.</div>`
          : allMyOrders.length ? `
            <div class="tablewrap trades-scroll">
              <table class="tbl">
                <thead><tr><th>Side</th><th class="num">Price</th><th class="num">Filled</th><th>Status</th><th>When</th><th></th></tr></thead>
                <tbody>${allMyOrders.map((o) => `
                  <tr>
                    <td><span class="tag-side ${o.outcome}">${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.outcome.toUpperCase()}</span></td>
                    <td class="num">${o.type === 'limit' && o.price !== null ? fmtPrice(o.price) : 'Market'}</td>
                    <td class="num">${o.origQty ? `${fmtQty(o.filled)}/${fmtQty(o.origQty)}` : fmtQty(o.filled)}</td>
                    <td><span class="ord-status ${o.status === 'open' ? 'open' : (o.status === 'filled' ? 'filled' : 'canceled')}">${esc(o.statusText || o.status)}</span></td>
                    <td class="muted small">${timeAgo(o.updatedAt || o.createdAt)}</td>
                    <td>${o.status === 'open' ? `<button class="mini-btn" data-cancel="${o.id}">Cancel</button>` : ''}</td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>` : `<div class="empty" style="padding:24px 0">No orders placed on this market yet.</div>`}
        ` : `
          ${!state.me ? `<div class="empty" style="padding:24px 0"><a href="#/login">Log in</a> to view your trade executions.</div>`
          : myTrades.length ? `
            <div class="tablewrap trades-scroll">
              <table class="tbl">
                <thead><tr><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th><th>When</th></tr></thead>
                <tbody>${myTrades.map((t) => `
                  <tr>
                    <td><span class="tag-side ${t.outcome}">${t.side === 'buy' ? 'Buy' : 'Sell'} ${t.outcome.toUpperCase()}</span></td>
                    <td class="num"><b>${fmtPrice(t.price)}</b></td>
                    <td class="num">${fmtQty(t.qty)}</td>
                    <td class="num">${fmtMoney(t.price * t.qty)}</td>
                    <td class="muted small">${timeAgo(t.ts)}</td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>` : `<div class="empty" style="padding:24px 0">No trades executed on this market yet.</div>`}
        `}
      </div>
    </div>`;
}

function wireActivityTabs(d) {
  $$('#activity-tabs button').forEach((btn) => {
    btn.onclick = () => {
      state.marketActivityTab = btn.dataset.mat;
      const card = $('#activity-card');
      if (card) {
        card.outerHTML = marketActivityHTML(d, state.marketActivityTab);
        wireActivityTabs(d);
        wireCancelButtons();
      }
    };
  });
}

/* ----- order panel ----- */
let orderSel = { outcome: 'yes', side: 'buy', type: 'limit', price: null, qty: 25, dollarAmount: 25, mode: 'shares', tif: 'GTC' };
function refreshOrderPanel(sel) {
  if (sel) orderSel = { ...orderSel, ...sel };
  const d = state.detail;
  if (!d || d.status !== 'open') return;
  const panel = $('#orderpanel');
  if (!panel) return;
  panel.innerHTML = orderPanelHTML(d);
  wireOrderForm(d);
}
function orderPanelHTML(d) {
  const s = orderSel;
  if (d.multi) {
    // multi markets trade the selected option: buys are YES on that option, sells need holdings
    s.outcome = 'yes';
    s.price = (d.outcomes[state.selOutcome].last ?? d.ask ?? 50);
  }
  const isBuy = s.side === 'buy';
  if (s.price === null) {
    if (isBuy) {
      s.price = s.outcome === 'yes'
        ? (d.ask ?? d.last ?? 50)
        : (d.bid !== null ? 100 - d.bid : (d.last !== null ? 100 - d.last : 50));
    } else {
      s.price = s.outcome === 'yes'
        ? (d.bid ?? d.last ?? 50)
        : (d.ask !== null ? 100 - d.ask : (d.last !== null ? 100 - d.last : 50));
    }
  }
  s.price = Math.max(1, Math.min(99, Math.round(s.price || 50)));

  const isDollars = isBuy && s.mode === 'dollars';
  const refPrice = s.outcome === 'yes' ? (d.ask ?? d.last ?? 99) : (d.bid !== null ? 100 - d.bid : 99);
  const effectivePrice = s.type === 'limit' ? s.price : refPrice;

  // Exact prediction market math:
  const calculatedContracts = isDollars
    ? Math.max(0, Math.floor(((s.dollarAmount || 0) * 100) / Math.max(1, effectivePrice)))
    : (s.qty || 0);
  const qty = isDollars ? calculatedContracts : (s.qty || 0);
  const est = s.type === 'limit' ? effectivePrice * qty : Math.round(refPrice * qty);
  const payout = qty * 100;
  const pos = (state.snapshot && state.snapshot.positions || []).find((p) => p.marketId === d.id && (p.outcomeIdx || 0) === (d.multi ? state.selOutcome : 0));
  const freeQty = pos ? (s.outcome === 'yes' ? pos.yesFree : pos.noFree) : 0;

  const avail = (state.snapshot && state.snapshot.wallet ? state.snapshot.wallet.available : 0) || 0;
  const maxPossible = isBuy
    ? Math.min(5000, Math.floor(avail / Math.max(1, effectivePrice)))
    : freeQty;

  let slippageInfo = '';
  if (s.type === 'market' && qty > 0) {
    const book = state.book || { bids: [], asks: [] };
    let levels = [];
    if (isBuy) {
      levels = (s.outcome === 'yes' ? (book.asks || []).map((a) => ({ p: a.price, q: a.qty }))
                                    : (book.bids || []).map((b) => ({ p: 100 - b.price, q: b.qty })));
    } else {
      levels = (s.outcome === 'yes' ? (book.bids || []).map((b) => ({ p: b.price, q: b.qty }))
                                    : (book.asks || []).map((a) => ({ p: 100 - a.price, q: a.qty })));
    }
    let rem = qty, filled = 0, cost = 0, lvls = 0;
    for (const l of levels) {
      if (rem <= 0) break;
      const take = Math.min(rem, l.q);
      cost += take * l.p;
      filled += take;
      rem -= take;
      lvls++;
    }
    if (filled > 0) {
      const vwap = Math.round(cost / filled);
      slippageInfo = `
        <div class="slippage-note ${rem === 0 ? 'good' : 'warn'}">
          ${ic('info', 12)} Est. avg fill: <b>${fmtPrice(vwap)}</b> across ${lvls} level${lvls === 1 ? '' : 's'}${rem > 0 ? ` · <span class="down">${rem} unfilled</span>` : ''}
        </div>`;
    }
  }

  let priceField = '';
  if (s.type === 'limit') {
    priceField = `
    <div class="field">
      <label style="display:flex;justify-content:space-between;align-items:center">
        <span>Limit Price — ${s.outcome === 'yes' ? 'YES' : 'NO'} (${fmtPrice(s.price)}/contract)</span>
        <span class="muted small">${s.price}¢ · ${s.price}% implied</span>
      </label>
      <div class="price-row">
        <div class="stepper" style="flex:1">
          <button type="button" id="p-minus" aria-label="decrease">−</button>
          <input id="f-price" type="number" min="1" max="99" step="1" value="${s.price}" />
          <button type="button" id="p-plus" aria-label="increase">+</button>
        </div>
        <button type="button" class="mini-btn" id="p-best" style="align-self:stretch">Best Quote</button>
      </div>
    </div>`;
  } else {
    priceField = `
      <div class="order-note" style="margin:0 0 6px;text-align:left">${ic('bolt', 13)} Market order — fills immediately at best available price (book: ${fmtPrice(d.bid)} / ${fmtPrice(d.ask)}).</div>
      ${slippageInfo}`;
  }

  let sumBlock;
  if (isBuy) {
    const profit = payout - est;
    const affordable = est <= avail;
    const roi = (qty > 0 && est > 0 && profit > 0) ? Math.round((profit / est) * 100) : 0;
    const roiBadge = roi > 0 ? `<span class="roi-badge">+${roi}% Return</span>` : '';
    sumBlock = `
    <div class="row"><span>Price × contracts</span><b>${s.type === 'limit' ? fmtPrice(s.price) : 'market (' + fmtPrice(refPrice) + ')'} × ${fmtQty(qty)}</b></div>
    <div class="row big"><span>Total cost</span><b id="sum-cost">${fmtMoney(est)}</b></div>
    <div class="row"><span>Potential payout <span class="muted small">($1.00/contract)</span></span><b>${fmtMoney(payout)}</b></div>
    <div class="row"><span>Potential profit ${roiBadge}</span><b class="up">${profit > 0 ? '+' : ''}${fmtMoney(profit)}</b></div>
    <div class="row"><span>Max loss</span><b class="down">−${fmtMoney(est)}</b></div>
    ${qty > 0 ? `<div class="row ${affordable ? '' : 'warn'}"><span>Your balance</span><b>${fmtMoney(avail)}${affordable ? ' → ' + fmtMoney(avail - est) + ' after' : ' — insufficient'}</b></div>` : ''}`;
  } else {
    const avg = pos ? (s.outcome === 'yes' ? pos.yesAvg : pos.noAvg) : 0;
    const realized = est - avg * qty;
    sumBlock = `
    <div class="row"><span>Price × contracts</span><b>${s.type === 'limit' ? fmtPrice(s.price) : 'market'} × ${fmtQty(qty)}</b></div>
    <div class="row big"><span>Proceeds if sold</span><b id="sum-cost">${fmtMoney(est)}</b></div>
    <div class="row"><span>You own (free)</span><b>${freeQty} ${d.multi ? esc((d.outcomes[state.selOutcome] || {}).label || '') : s.outcome.toUpperCase()}</b></div>
    <div class="row"><span>Avg cost basis</span><b>${avg ? fmtPrice(avg) : '—'}</b></div>
    <div class="row"><span>Est. realized P&amp;L</span><b class="${realized >= 0 ? 'up' : 'down'}">${sgn(realized)}</b></div>
    <div class="order-note" style="text-align:left;margin:4px 0 0">Sale proceeds are yours immediately — the outcome no longer affects these contracts.</div>`;
  }

  let quickChips = '';
  if (isBuy) {
    if (isDollars) {
      quickChips = [10, 25, 50, 100].map((n) => `<button type="button" class="qchip" data-qd="${n}">$${n}</button>`).join('')
        + `<button type="button" class="qchip qchip-max" data-q="max" title="Invest all available cash (${fmtMoney(avail)})">Max (${fmtMoney(avail)})</button>`;
    } else {
      quickChips = [10, 25, 50, 100].map((n) => `<button type="button" class="qchip" data-q="${n}">+${n}</button>`).join('')
        + `<button type="button" class="qchip qchip-max" data-q="max" title="Buy maximum affordable contracts with your cash balance (${fmtMoney(avail)})">Max${maxPossible > 0 ? ' (' + fmtQty(maxPossible) + ')' : ''}</button>`;
    }
  } else {
    quickChips = [0.25, 0.50, 0.75].map((pct) => `<button type="button" class="qchip" data-qpct="${pct}">${Math.round(pct * 100)}%</button>`).join('')
      + `<button type="button" class="qchip qchip-max" data-q="max" title="Sell all free contracts">All ${freeQty > 0 ? '(' + fmtQty(freeQty) + ')' : ''}</button>`;
  }

  const tif = s.tif || 'GTC';
  const isPostOnly = tif === 'POST_ONLY';
  const advDrawer = `
    <div class="adv-controls">
      <button type="button" class="adv-toggle" id="adv-toggle">
        <span>${ic('sliders', 12)} Advanced execution</span>
        <span class="adv-pill">${tif}</span>
      </button>
      <div class="adv-drawer ${state.advOpen ? 'open' : ''}" id="adv-drawer">
        <div class="adv-field">
          <label>Time-In-Force</label>
          <div class="tif-pills">
            <button type="button" class="tif-pill ${tif === 'GTC' ? 'active' : ''}" data-tif="GTC" title="Good 'Til Canceled — rests until filled or canceled">GTC</button>
            <button type="button" class="tif-pill ${tif === 'IOC' ? 'active' : ''}" data-tif="IOC" title="Immediate or Cancel — fills available quantity now, cancels rest">IOC</button>
            <button type="button" class="tif-pill ${tif === 'FOK' ? 'active' : ''}" data-tif="FOK" title="Fill or Kill — must fill completely immediately or kills entirely">FOK</button>
          </div>
        </div>
        ${s.type === 'limit' ? `
        <div class="adv-field">
          <label class="postonly-label">
            <input type="checkbox" id="f-postonly" ${isPostOnly ? 'checked' : ''} />
            <span><b>Post-Only (Maker)</b><br><small class="muted">Never take liquidity; reject if it crosses spread</small></span>
          </label>
        </div>` : ''}
      </div>
    </div>`;

  const btnEnabled = qty > 0 && (s.type === 'market' || (s.price >= 1 && s.price <= 99));
  const btnLabel = (isBuy ? 'Buy' : 'Sell') + (qty > 0 ? ' ' + fmtQty(qty) : '') + ' ' + (s.outcome === 'yes' ? 'YES' : 'NO') + (s.type === 'limit' && qty > 0 ? ' @ ' + fmtPrice(s.price) : '');

  return `
    <div class="type-row pm-type-toggle">
      <button type="button" class="type-toggle ${s.side === 'buy' ? 'active' : ''}" data-s="buy">Buy</button>
      <button type="button" class="type-toggle ${s.side === 'sell' ? 'active' : ''}" data-s="sell">Sell</button>
    </div>
    <div class="side-tabs">
      <button type="button" class="side-tab yes ${s.outcome === 'yes' ? 'active' : ''}" data-o="yes">
        <div class="pm-out-top">
          <span class="pm-out-title">Yes</span>
          <span class="pm-out-check">${ic('check', 14)}</span>
        </div>
        <div class="pm-out-prob">${d.last !== null ? Math.round(d.last) + '%' : '50%'}</div>
        <div class="pm-out-price">${fmtPrice(d.last)}</div>
      </button>
      <button type="button" class="side-tab no ${s.outcome === 'no' ? 'active' : ''}" data-o="no">
        <div class="pm-out-top">
          <span class="pm-out-title">No</span>
          <span class="pm-out-check">${ic('check', 14)}</span>
        </div>
        <div class="pm-out-prob">${d.last !== null ? Math.round(100 - d.last) + '%' : '50%'}</div>
        <div class="pm-out-price">${fmtPrice(d.last === null ? null : 100 - d.last)}</div>
      </button>
    </div>
    <div class="type-row">
      <button type="button" class="type-toggle ${s.type === 'limit' ? 'active' : ''}" data-t="limit">Limit</button>
      <button type="button" class="type-toggle ${s.type === 'market' ? 'active' : ''}" data-t="market">Market</button>
    </div>
    ${priceField}
    <div class="field">
      <label style="display:flex;justify-content:space-between;align-items:center">
        <span>${isDollars ? 'Investment Amount' : 'Contracts'}</span>
        ${isBuy ? `
        <span class="type-row" style="margin:0;gap:4px">
          <button type="button" class="type-toggle ${!isDollars ? 'active' : ''}" data-m="shares" style="padding:3px 10px;font-size:11.5px">Contracts</button>
          <button type="button" class="type-toggle ${isDollars ? 'active' : ''}" data-m="dollars" style="padding:3px 10px;font-size:11.5px">Dollars ($)</button>
        </span>` : ''}
      </label>
      <div class="price-row">
        <div class="stepper" style="flex:1">
          <button type="button" id="q-minus" aria-label="decrease">−</button>
          <input id="f-qty" type="number" min="1" step="${isDollars ? '5' : '1'}" value="${isDollars ? (s.dollarAmount || '') : (s.qty || '')}" placeholder="${isDollars ? '$0' : '0'}" autocomplete="off" />
          <button type="button" id="q-plus" aria-label="increase">+</button>
        </div>
      </div>
      ${isDollars ? `<div class="order-note" style="text-align:left;margin:6px 0 0">${ic('info', 12)} Buying <b>${fmtQty(calculatedContracts)}</b> contracts @ ${fmtPrice(effectivePrice)} each (Total: ${fmtMoney(est)})</div>` : ''}
      <div class="quick-chips">${quickChips}</div>
      ${advDrawer}
    </div>
    <div class="ord-sum">
      ${sumBlock}
      <div class="row"><span>Exchange fee</span><b>$0.00 (Free)</b></div>
    </div>
    ${isBuy && qty > 0 && est > avail ? `
      <div class="insufficient-balance-box">
        <div class="title">${ic('alert', 14)} Insufficient Available Balance</div>
        <div class="sub">You have <b>${fmtMoney(avail)}</b> available, but this trade costs <b>${fmtMoney(est)}</b>. Quick deposit <b>${fmtMoney(est - avail)}</b> to complete it.</div>
        <button type="button" class="btn-quick-deposit" id="btn-trade-deposit">
          ${ic('bolt', 13)} Quick Deposit ${fmtMoney(est - avail)} &amp; Trade
        </button>
      </div>` : ''}
    <button type="button" class="place-btn ${s.side} ${s.outcome}" id="place-btn" ${btnEnabled ? '' : 'disabled'}>${btnLabel}</button>
    <div class="order-note">${ic('gamepad', 13)} Play money · limit orders rest on the book · every winning share pays $1.00.</div>
    <div class="form-error" id="ord-err"></div>`;
}
function wireOrderForm(d) {
  const s = orderSel;
  const setSel = (patch) => refreshOrderPanel(patch);
  const btd = $('#btn-trade-deposit');
  if (btd) {
    btd.onclick = () => {
      const avail = (state.snapshot && state.snapshot.wallet ? state.snapshot.wallet.available : 0) || 0;
      const refPrice = s.outcome === 'yes' ? (d.ask ?? d.last ?? 99) : (d.bid !== null ? 100 - d.bid : 99);
      const effectivePrice = s.type === 'limit' ? (s.price || 50) : refPrice;
      const isDollars = s.side === 'buy' && s.mode === 'dollars';
      const qty = isDollars ? Math.max(0, Math.floor(((s.dollarAmount || 0) * 100) / Math.max(1, effectivePrice))) : (s.qty || 0);
      const est = s.type === 'limit' ? effectivePrice * qty : Math.round(refPrice * qty);
      const needed = Math.max(500, est - avail);
      openDepositModal(needed, () => {
        refreshMe().then(() => {
          if (state.detail) viewMarket(state.detail.slug);
        });
      });
    };
  }
  $$('#orderpanel .side-tab').forEach((b) => b.onclick = () => {
    const o = b.dataset.o;
    if (s.side === 'sell') {
      const pos = (state.snapshot && state.snapshot.positions || []).find((p) => p.marketId === d.id);
      const free = pos ? (o === 'yes' ? pos.yesFree : pos.noFree) : 0;
      if (free <= 0) showOrderErr(`You don't own any ${o.toUpperCase()} shares to sell. Switch to Buy.`);
    }
    setSel({ outcome: o, price: null });
  });
  $$('#orderpanel .type-toggle').forEach((b) => b.onclick = () => {
    if (b.dataset.s) setSel({ side: b.dataset.s, price: null });
    if (b.dataset.t) setSel({ type: b.dataset.t });
    if (b.dataset.m) setSel({ mode: b.dataset.m });
  });
  const pm = $('#p-minus'), pp = $('#p-plus'), pb = $('#p-best'), fp = $('#f-price');
  const qm = $('#q-minus'), qp = $('#q-plus'), fq = $('#f-qty');

  if (pm) pm.onclick = () => setSel({ price: Math.max(1, (orderSel.price || 50) - 1) });
  if (pp) pp.onclick = () => setSel({ price: Math.min(99, (orderSel.price || 50) + 1) });
  if (pb) pb.onclick = () => {
    let p;
    if (orderSel.side === 'buy') {
      p = orderSel.outcome === 'yes' ? (d.ask ?? d.last ?? 50) : (d.bid !== null ? 100 - d.bid : 100 - (d.last ?? 50));
    } else {
      p = orderSel.outcome === 'yes' ? (d.bid ?? d.last ?? 50) : (d.ask !== null ? 100 - d.ask : 100 - (d.last ?? 50));
    }
    setSel({ price: Math.max(1, Math.min(99, Math.round(p))) });
  };
  if (fp) fp.onchange = () => {
    let val = parseFloat(fp.value);
    if (val > 0 && val < 1) val = Math.round(val * 100);
    setSel({ price: Math.max(1, Math.min(99, Math.round(val) || 1)) });
  };

  if (qm) qm.onclick = () => {
    if (orderSel.side === 'buy' && orderSel.mode === 'dollars') {
      setSel({ dollarAmount: Math.max(1, (orderSel.dollarAmount || 25) - 5) });
    } else {
      setSel({ qty: Math.max(1, (orderSel.qty || 10) - 5) });
    }
  };
  if (qp) qp.onclick = () => {
    if (orderSel.side === 'buy' && orderSel.mode === 'dollars') {
      setSel({ dollarAmount: Math.min(50000, (orderSel.dollarAmount || 0) + 10) });
    } else {
      setSel({ qty: Math.min(5000, (orderSel.qty || 0) + 10) });
    }
  };
  if (fq) fq.onchange = () => {
    const val = Math.max(0, Math.floor(+fq.value || 0));
    if (orderSel.side === 'buy' && orderSel.mode === 'dollars') {
      setSel({ dollarAmount: val });
    } else {
      setSel({ qty: Math.min(5000, val) });
    }
  };

  $$('#orderpanel [data-qd]').forEach((b) => b.onclick = () => {
    setSel({ dollarAmount: +b.dataset.qd });
  });
  $$('#orderpanel [data-qpct]').forEach((b) => b.onclick = () => {
    const pct = +b.dataset.qpct;
    const pos = (state.snapshot && state.snapshot.positions || []).find((p) => p.marketId === d.id && (p.outcomeIdx || 0) === (d.multi ? state.selOutcome : 0));
    const free = pos ? (orderSel.outcome === 'yes' ? pos.yesFree : pos.noFree) : 0;
    setSel({ qty: Math.max(1, Math.floor(free * pct)) });
  });

  $$('#orderpanel .qchip').forEach((b) => {
    if (b.dataset.q === 'max') {
      b.onclick = () => {
        const isBuy = orderSel.side === 'buy';
        if (isBuy) {
          const w = (state.snapshot && state.snapshot.wallet) ? state.snapshot.wallet.available : 0;
          if (orderSel.mode === 'dollars') {
            if (w <= 0) {
              toast('Your available balance is $0.00', true);
              setSel({ dollarAmount: 0 });
            } else {
              setSel({ dollarAmount: Math.floor(w / 100) });
            }
          } else {
            const per = orderSel.type === 'limit' ? (orderSel.price || 50)
              : (orderSel.outcome === 'yes' ? (d.ask ?? d.last ?? 50) : (d.bid !== null ? 100 - d.bid : 100 - (d.last ?? 50)));
            const maxAffordable = Math.floor(w / Math.max(1, per));
            if (maxAffordable <= 0) {
              toast(`Balance of ${fmtMoney(w)} is insufficient for 1 contract at ${fmtPrice(per)}`, true);
              setSel({ qty: 0 });
            } else {
              const chosen = Math.min(5000, maxAffordable);
              toast(`Max calculated: ${fmtQty(chosen)} contracts for ${fmtMoney(chosen * per)}`);
              setSel({ qty: chosen });
            }
          }
        } else {
          const pos = (state.snapshot && state.snapshot.positions || []).find((p) => p.marketId === d.id && (p.outcomeIdx || 0) === (d.multi ? state.selOutcome : 0));
          const free = pos ? (orderSel.outcome === 'yes' ? pos.yesFree : pos.noFree) : 0;
          if (free <= 0) {
            toast(`No free ${orderSel.outcome.toUpperCase()} contracts to sell`, true);
            setSel({ qty: 0 });
          } else {
            toast(`Selected all ${fmtQty(free)} owned ${orderSel.outcome.toUpperCase()} contracts`);
            setSel({ qty: free });
          }
        }
      };
    } else if (b.dataset.q && !b.dataset.qd && !b.dataset.qpct) {
      b.onclick = () => {
        const add = +b.dataset.q;
        setSel({ qty: Math.min(5000, (orderSel.qty || 0) + add) });
      };
    }
  });

  const advBtn = $('#adv-toggle');
  if (advBtn) advBtn.onclick = () => {
    state.advOpen = !state.advOpen;
    const drw = $('#adv-drawer');
    if (drw) drw.classList.toggle('open', state.advOpen);
  };
  $$('#orderpanel .tif-pill').forEach((b) => b.onclick = () => {
    setSel({ tif: b.dataset.tif });
  });
  const poBox = $('#f-postonly');
  if (poBox) poBox.onchange = () => {
    setSel({ tif: poBox.checked ? 'POST_ONLY' : 'GTC' });
  };

  const cashOutBtn = $('#btn-cashout');
  if (cashOutBtn) cashOutBtn.onclick = () => {
    const o = cashOutBtn.dataset.o;
    const q = +cashOutBtn.dataset.q;
    setSel({ side: 'sell', outcome: o, qty: q, type: 'market' });
    toast(`Prepared cash out: Sell ${q} ${o.toUpperCase()} contracts at market.`);
  };

  const btn = $('#place-btn');
  if (btn) btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Placing…';
    try {
      const isDollars = s.side === 'buy' && s.mode === 'dollars';
      const refPrice = s.outcome === 'yes' ? (d.ask ?? d.last ?? 99) : (d.bid !== null ? 100 - d.bid : 99);
      const effectivePrice = s.type === 'limit' ? s.price : refPrice;
      const calculatedContracts = isDollars
        ? Math.max(0, Math.floor(((s.dollarAmount || 0) * 100) / Math.max(1, effectivePrice)))
        : s.qty;
      const qtyToSubmit = isDollars ? calculatedContracts : s.qty;
      if (!qtyToSubmit || qtyToSubmit <= 0) {
        showOrderErr(isDollars ? `Amount must be at least ${fmtPrice(effectivePrice)} to purchase 1 contract.` : 'Quantity must be at least 1 contract.');
        btn.disabled = false;
        btn.textContent = btnLabel;
        return;
      }
      const body = {
        market: d.slug,
        marketId: d.id,
        side: s.side,
        outcome: s.outcome,
        type: s.type,
        qty: qtyToSubmit,
        idemKey: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'k' + Date.now() + '-' + Math.random().toString(36).slice(2)
      };
      if (d.multi) body.outcomeIdx = state.selOutcome;
      if (s.type === 'limit') {
        body.price = s.price;
        if (s.tif) body.tif = s.tif;
      }
      const r = await api('/api/orders', { method: 'POST', body });
      const o = r.order;
      if (o.status === 'filled') toast(`Filled: ${s.side === 'buy' ? 'Bought' : 'Sold'} ${o.filled} ${s.outcome.toUpperCase()}${s.type === 'limit' ? ' @ ' + fmtPrice(o.avgFill || s.price) : ''}`);
      else if (o.status === 'open') toast(`Order resting on the book: ${o.qty} remaining (${o.tif || 'GTC'})`);
      else toast(`Order ${o.status}${o.note ? ' — ' + o.note : ''}`, true);
      if (s.mode === 'dollars') setSel({ dollarAmount: 0 });
      else setSel({ qty: 0 });
      refreshMe();
      setTimeout(() => viewMarket(d.slug), 250);
    } catch (e) {
      showOrderErr(e.message);
      btn.disabled = false;
      btn.textContent = btnLabel;
    }
  };
}
function showOrderErr(msg) {
  const el = $('#ord-err');
  if (el) { el.textContent = msg; el.classList.add('show'); }
  toast(msg, true);
}

/* ----- position & my orders (market page) ----- */
function positionHTML(d) {
  const pos = (state.snapshot && state.snapshot.positions || []).find((p) => p.marketId === d.id && (p.outcomeIdx || 0) === (d.multi ? state.selOutcome : 0));
  if (!pos || (pos.yesQty <= 0 && pos.noQty <= 0)) return '';
  const rows = [];
  const hasYes = pos.yesQty > 0;
  const hasNo = pos.noQty > 0;
  if (hasYes) rows.push(`
    <div class="pos-line"><span class="side-lbl yes-lbl">YES contracts</span><span>${fmtQty(pos.yesQty)} @ avg ${fmtPrice(pos.yesAvg)}</span></div>
    <div class="pos-line"><span class="muted">Max payout if YES</span><b>${fmtMoney(pos.maxPayoutYes)}</b></div>`);
  if (hasNo) rows.push(`
    <div class="pos-line"><span class="side-lbl no-lbl">NO contracts</span><span>${fmtQty(pos.noQty)} @ avg ${fmtPrice(pos.noAvg)}</span></div>
    <div class="pos-line"><span class="muted">Max payout if NO</span><b>${fmtMoney(pos.maxPayoutNo)}</b></div>`);
  const unreal = pos.unrealized;
  const costBasis = (pos.yesCost || 0) + (pos.noCost || 0);
  const pnlPct = (unreal !== null && costBasis > 0) ? Math.round((unreal / costBasis) * 100) : null;
  const unrealRow = unreal !== null
    ? `<div class="pos-line"><span class="muted">Unrealized P&amp;L</span><span class="pnl ${unreal >= 0 ? 'up' : 'down'}">${sgn(unreal)}${pnlPct !== null ? ' (' + (pnlPct >= 0 ? '+' : '') + pnlPct + '%)' : ''}</span></div>` : '';

  const free = pos.yesFree > 0 ? pos.yesFree : (pos.noFree > 0 ? pos.noFree : 0);
  const sideToSell = pos.yesFree > 0 ? 'yes' : 'no';
  const cashOutBtn = (free > 0 && d.status === 'open') ? `
    <button type="button" class="btn-cashout" id="btn-cashout" data-o="${sideToSell}" data-q="${free}" title="Quickly exit your position at market">
      ${ic('arrowDownRight', 14)} 1-Click Cash Out (${free} ${sideToSell.toUpperCase()})
    </button>` : '';

  return `<div class="card card-pad pos-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0">Your position</h3>
      <span class="badge ${unreal >= 0 ? 'live' : 'halted'}">${unreal >= 0 ? 'In Profit' : 'Open'}</span>
    </div>
    <div class="pos-rows">${rows.join('')}${unrealRow}</div>
    ${cashOutBtn}
  </div>`;
}
function myOrdersHTML(d) {
  const orders = (state.snapshot && state.snapshot.orders || []).filter((o) => o.marketId === d.id);
  if (!orders.length) return '';
  return `<div class="card card-pad pos-card">
    <h3>Your open orders</h3>
    ${orders.map((o) => `
      <div class="pos-line" style="margin-bottom:7px">
        <span><span class="tag-side ${o.outcome}">${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.outcome.toUpperCase()}</span>
          ${o.type === 'limit' ? '@ ' + fmtPrice(o.price) : 'market'} · ${fmtQty(o.qty)}</span>
        <button class="mini-btn" data-cancel="${o.id}">Cancel</button>
      </div>`).join('')}
  </div>`;
}
/* ================= WALLET & PAYMENTS ================= */
async function viewWallet(routeQuery) {
  if (!state.me) { location.hash = '#/login'; return; }
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading wallet &amp; payments…</p></div>`;

  let d;
  try {
    d = await api('/api/wallet');
  } catch (e) {
    app().innerHTML = errorScreen(e.message, '#/');
    return;
  }

  const wallet = d.wallet || { available: 0, reserved: 0, total: 0, withdrawable: 0, withdrawReserved: 0 };
  const cumDeposits = d.cumulativeDeposits || d.totalDeposited || 0;
  const withdrawals = d.withdrawals || [];
  const ledger = d.ledger || [];

  let activeTab = (routeQuery && routeQuery.tab) || 'deposit';
  let activeMethod = 'card';
  let selectedDepositCents = 10000; // $100 default

  function render() {
    app().innerHTML = `
      <div class="page-head">
        <div>
          <h2 class="page-title" style="display:flex;align-items:center;gap:10px">
            ${ic('creditCard', 24)} Payments &amp; Wallet
          </h2>
          <p class="page-sub">Fund your trading account, withdraw winnings, and view audited ledger statements.</p>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn-primary" id="w-quick-deposit-top" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;font-size:13.5px">
            ${ic('plus', 15)} Quick Deposit
          </button>
          <button class="mini-btn" id="w-refresh-btn" style="padding:8px 12px" title="Refresh balances">
            ${ic('repeat', 14)} Refresh
          </button>
        </div>
      </div>

      <!-- Wallet Balance Hero & Metrics -->
      <div class="wallet-hero">
        <div class="wallet-balance-main">
          <div class="wallet-balance-label">Total Account Balance</div>
          <div class="wallet-balance-val">${fmtMoney(wallet.total)}</div>
          <div class="wallet-balance-sub">
            <span class="dot-live" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px"></span>
            Real-time balance · Instant settlement
          </div>
        </div>
        <div class="wallet-metrics">
          <div class="wallet-metric-item">
            <div class="k">Available to Trade</div>
            <div class="v" style="color:var(--green)">${fmtMoney(wallet.available)}</div>
            <div class="sub">Cash ready for orders</div>
          </div>
          <div class="wallet-metric-item">
            <div class="k">Reserved in Orders</div>
            <div class="v">${fmtMoney(wallet.reserved)}</div>
            <div class="sub">Held in open limit bids</div>
          </div>
          <div class="wallet-metric-item">
            <div class="k">Withdrawable Cash</div>
            <div class="v">${fmtMoney(wallet.withdrawable)}</div>
            <div class="sub">Ready for payout</div>
          </div>
          <div class="wallet-metric-item">
            <div class="k">Lifetime Funded</div>
            <div class="v">${fmtMoney(cumDeposits)}</div>
            <div class="sub">Total cumulative deposits</div>
          </div>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="pay-tabs">
        <button class="pay-tab ${activeTab === 'deposit' ? 'active' : ''}" data-wtab="deposit">
          ${ic('arrowDown', 15)} Deposit Funds
        </button>
        <button class="pay-tab ${activeTab === 'withdraw' ? 'active' : ''}" data-wtab="withdraw">
          ${ic('arrowUpRight', 15)} Withdraw Funds
        </button>
        <button class="pay-tab ${activeTab === 'history' ? 'active' : ''}" data-wtab="history">
          ${ic('clock', 15)} Statements &amp; Ledger (${ledger.length})
        </button>
      </div>

      <!-- Tab Content Area -->
      <div id="wallet-tab-content">
        ${renderTabContent()}
      </div>
    `;

    attachEvents();
  }

  function renderTabContent() {
    if (activeTab === 'deposit') return renderDepositTab();
    if (activeTab === 'withdraw') return renderWithdrawTab();
    return renderHistoryTab();
  }

  function renderDepositTab() {
    return `
      <div class="card card-pad" style="max-width:960px;margin:0 auto">
        <h3 style="margin-top:0;margin-bottom:6px">Select Payment Method</h3>
        <p class="muted small" style="margin-bottom:18px">Choose how you'd like to fund your Predix account. All deposits credit your available cash balance instantly.</p>

        <div class="pay-method-grid">
          <div class="pay-method-btn ${activeMethod === 'card' ? 'active' : ''}" data-pm="card">
            <div class="pay-icon-box">${ic('creditCard', 22)}</div>
            <div class="pay-info">
              <div class="pay-title">Credit / Debit Card <span class="badge" style="background:rgba(16,185,129,0.15);color:var(--green);font-size:10.5px">INSTANT</span></div>
              <div class="pay-desc">Visa, Mastercard, Amex · $0 processing fee</div>
            </div>
          </div>

          <div class="pay-method-btn ${activeMethod === 'bank' ? 'active' : ''}" data-pm="bank">
            <div class="pay-icon-box">${ic('building', 22)}</div>
            <div class="pay-info">
              <div class="pay-title">ACH Bank Direct Link <span class="badge" style="background:rgba(59,130,246,0.15);color:#3b82f6;font-size:10.5px">HIGH LIMITS</span></div>
              <div class="pay-desc">Instant link via Chase, BofA, Wells Fargo, Citi</div>
            </div>
          </div>

          <div class="pay-method-btn ${activeMethod === 'crypto' ? 'active' : ''}" data-pm="crypto">
            <div class="pay-icon-box">${ic('qrCode', 22)}</div>
            <div class="pay-info">
              <div class="pay-title">USDC Crypto Deposit <span class="badge" style="background:rgba(147,51,234,0.15);color:#a855f7;font-size:10.5px">WEB3</span></div>
              <div class="pay-desc">Polygon, Base, Ethereum &amp; Solana stablecoins</div>
            </div>
          </div>

          <div class="pay-method-btn ${activeMethod === 'promo' ? 'active' : ''}" data-pm="promo">
            <div class="pay-icon-box">${ic('gift', 22)}</div>
            <div class="pay-info">
              <div class="pay-title">Promo Voucher / Bonus</div>
              <div class="pay-desc">Redeem trading credit coupons &amp; signup vouchers</div>
            </div>
          </div>
        </div>

        <div id="method-panel" style="margin-top:24px;border-top:1px solid var(--border);padding-top:22px">
          ${renderMethodPanel()}
        </div>
      </div>
    `;
  }

  function renderMethodPanel() {
    if (activeMethod === 'card') {
      const dollars = selectedDepositCents / 100;
      return `
        <div class="pay-form-cols">
          <div>
            <label style="display:block;font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:8px">Select Deposit Amount (USD)</label>
            <div class="amount-presets" style="margin-bottom:12px">
              ${[25, 50, 100, 250, 500, 1000].map(amt => `
                <button type="button" class="amount-chip ${selectedDepositCents === amt * 100 ? 'active' : ''}" data-amt="${amt * 100}">
                  $${amt}
                </button>
              `).join('')}
            </div>
            <div style="position:relative;margin-bottom:16px">
              <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-weight:700;color:var(--muted);font-size:16px">$</span>
              <input id="deposit-custom-amt" class="input" type="number" min="5" max="100000" step="1"
                value="${dollars}" style="padding-left:28px;font-size:16px;font-weight:700" placeholder="Custom amount" />
            </div>

            <div class="auth-field">
              <label>Name on Card</label>
              <input id="card-name" class="input" value="${esc(state.me.username.toUpperCase())} TRADER" />
            </div>
            <div class="auth-field">
              <label>Card Number</label>
              <input id="card-number" class="input" value="•••• •••• •••• 4242" placeholder="4000 1234 5678 9010" />
            </div>
            <div class="card-split-fields">
              <div class="auth-field">
                <label>Expiry (MM/YY)</label>
                <input id="card-exp" class="input" value="12/28" placeholder="MM/YY" />
              </div>
              <div class="auth-field">
                <label>CVC / CVV</label>
                <input id="card-cvc" class="input" value="888" placeholder="123" />
              </div>
            </div>

            <div class="form-error" id="deposit-err"></div>
            <button class="btn-primary" id="deposit-card-btn" style="width:100%;margin-top:14px;padding:12px;font-size:15px;font-weight:700">
              ${ic('lock', 15)} Pay ${fmtMoney(selectedDepositCents)} &amp; Fund Account
            </button>
            <div class="order-note" style="text-align:center;margin-top:10px">
              🔒 256-Bit SSL Encrypted. Simulated instant payment rail for demo trading.
            </div>
          </div>

          <div>
            <div class="card-preview">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
                <span style="font-weight:800;letter-spacing:1px;font-size:14px">PREDIX TRADING</span>
                <span style="font-weight:800;font-size:16px;font-style:italic">VISA</span>
              </div>
              <div style="font-family:monospace;font-size:17px;letter-spacing:2px;margin-bottom:20px">
                •••• •••• •••• 4242
              </div>
              <div style="display:flex;justify-content:space-between;align-items:flex-end">
                <div>
                  <div style="font-size:9.5px;opacity:0.75;text-transform:uppercase">Card Holder</div>
                  <div style="font-size:12.5px;font-weight:600">${esc(state.me.username.toUpperCase())}</div>
                </div>
                <div>
                  <div style="font-size:9.5px;opacity:0.75;text-transform:uppercase">Expires</div>
                  <div style="font-size:12.5px;font-weight:600">12/28</div>
                </div>
              </div>
            </div>

            <div class="card card-pad" style="margin-top:16px;background:var(--bg-2);border-color:var(--border)">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="color:var(--green)">${ic('check', 16)}</span>
                <b style="font-size:13px">Instant Settlement</b>
              </div>
              <p class="muted small" style="margin:0;line-height:1.5">
                Funds are credited directly to your trading account with zero delay. Minimum deposit is $5.00, maximum $100,000.
              </p>
            </div>
          </div>
        </div>
      `;
    }

    if (activeMethod === 'bank') {
      const dollars = selectedDepositCents / 100;
      return `
        <div style="max-width:640px">
          <label style="display:block;font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:8px">Deposit Amount (USD)</label>
          <div class="amount-presets" style="margin-bottom:12px">
            ${[50, 100, 250, 500, 1000, 2500].map(amt => `
              <button type="button" class="amount-chip ${selectedDepositCents === amt * 100 ? 'active' : ''}" data-amt="${amt * 100}">
                $${amt}
              </button>
            `).join('')}
          </div>
          <div style="position:relative;margin-bottom:18px">
            <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-weight:700;color:var(--muted);font-size:16px">$</span>
            <input id="deposit-custom-amt" class="input" type="number" min="5" max="100000" step="1"
              value="${dollars}" style="padding-left:28px;font-size:16px;font-weight:700" placeholder="Amount" />
          </div>

          <div class="auth-field">
            <label>Select Your Bank</label>
            <select id="bank-select" class="input" style="padding:10px">
              <option value="chase">JPMorgan Chase Bank (Checking •• 7192)</option>
              <option value="bofa">Bank of America (Checking •• 4021)</option>
              <option value="wells">Wells Fargo (Savings •• 8840)</option>
              <option value="citi">Citibank N.A. (Checking •• 1309)</option>
              <option value="capitalone">Capital One 360 (Checking •• 9412)</option>
            </select>
          </div>

          <div class="auth-field">
            <label>Account Holder</label>
            <input class="input" value="${esc(state.me.username)} (Verified KYC)" disabled style="background:var(--bg-2);color:var(--ink-2)" />
          </div>

          <div class="form-error" id="deposit-err"></div>
          <button class="btn-primary" id="deposit-bank-btn" style="width:100%;margin-top:14px;padding:12px;font-size:15px;font-weight:700">
            ${ic('building', 15)} Transfer ${fmtMoney(selectedDepositCents)} via ACH
          </button>
          <div class="order-note" style="text-align:center;margin-top:10px">
            FDIC Insured partner accounts. Plaid-linked instant transfer simulator.
          </div>
        </div>
      `;
    }

    if (activeMethod === 'crypto') {
      const depositAddress = '0x71C8A51f28F421D87EaE6297316A74d89Eb9372B';
      const qrSvg = generateQrSvg(depositAddress, 180);
      return `
        <div class="pay-form-cols">
          <div>
            <div class="auth-field">
              <label>Select Stablecoin &amp; Network</label>
              <select id="crypto-network" class="input" style="padding:10px">
                <option value="polygon">USD Coin (USDC) — Polygon PoS (Fast &amp; Low Gas)</option>
                <option value="base">USD Coin (USDC) — Base L2</option>
                <option value="eth">USD Coin (USDC) — Ethereum Mainnet (ERC-20)</option>
                <option value="sol">USD Coin (USDC) — Solana Network</option>
              </select>
            </div>

            <div class="crypto-deposit-box" style="margin-top:16px">
              <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
                Your Unique Deposit Address
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <input id="crypto-addr-in" class="input" value="${depositAddress}" readonly style="font-family:monospace;font-size:12px;background:var(--bg)" />
                <button class="mini-btn" id="copy-crypto-addr" style="display:flex;align-items:center;gap:5px;white-space:nowrap;padding:9px 12px">
                  ${ic('copy', 13)} Copy
                </button>
              </div>
              <div style="margin-top:8px;font-size:12px;color:var(--muted)">
                Send only <b>USDC</b> to this address. Credits after 1 network confirmation.
              </div>
            </div>

            <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:16px">
              <div style="font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:6px">Interactive Simulation:</div>
              <p class="muted small" style="margin-bottom:12px">Simulate an on-chain transfer detection to fund your balance immediately.</p>
              
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <input id="crypto-sim-amt" class="input" type="number" min="10" max="10000" step="10" value="100" style="width:130px" placeholder="Amount" />
                <button class="btn-primary" id="crypto-sim-btn" style="flex:1;margin:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:180px">
                  ${ic('zap', 14)} Simulate On-Chain Transfer
                </button>
              </div>
              <div class="form-error" id="deposit-err"></div>
            </div>
          </div>

          <div style="text-align:center">
            <div class="crypto-qr">
              ${qrSvg}
            </div>
            <div style="margin-top:12px;font-size:12px;color:var(--muted)">
              Scan with MetaMask, Coinbase Wallet, or Phantom
            </div>
          </div>
        </div>
      `;
    }

    // Promo tab
    return `
      <div style="max-width:540px">
        <label style="display:block;font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:8px">Enter Promo Voucher or Coupon Code</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input id="promo-code-in" class="input" style="text-transform:uppercase;font-weight:700;letter-spacing:1px" placeholder="e.g. WELCOME25, TOPUP50" />
          <button class="btn-primary" id="promo-submit-btn" style="margin:0;white-space:nowrap;padding:10px 20px">
            Redeem Code
          </button>
        </div>
        <div class="form-error" id="deposit-err"></div>

        <div style="margin-top:24px;padding:16px;border:1px dashed var(--border);border-radius:var(--radius);background:var(--bg-2)">
          <div style="font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:6px">Available Sample Codes:</div>
          <ul style="margin:0;padding-left:20px;font-size:12.5px;color:var(--muted);line-height:1.7">
            <li><code style="color:var(--ink);font-weight:700">TOPUP25</code> — $25.00 Welcome Booster</li>
            <li><code style="color:var(--ink);font-weight:700">TRADER50</code> — $50.00 Liquidity Grant</li>
            <li><code style="color:var(--ink);font-weight:700">ALPHA100</code> — $100.00 VIP Trading Credit</li>
          </ul>
        </div>
      </div>
    `;
  }

  function renderWithdrawTab() {
    return `
      <div class="card card-pad" style="max-width:960px;margin:0 auto">
        <div class="wdraw-head">
          <h3 style="margin:0;display:flex;align-items:center;gap:8px">
            ${ic('arrowUpRight', 18)} Request Payout / Withdrawal
          </h3>
          <span class="badge wdemo">${ic('gamepad', 13)} Simulation sandbox · Audited ledger</span>
        </div>

        <div class="wdraw-grid" style="margin-top:18px">
          <div>
            <div class="wdrow"><span>Available to withdraw</span><b>${fmtMoney(wallet.withdrawable)}</b></div>
            <div class="wdrow muted-row"><span>Reserved in open orders <small>(held in bids)</small></span><b>${fmtMoney(wallet.reserved)}</b></div>
            
            <div class="auth-field" style="margin-top:16px">
              <label>Withdrawal Method</label>
              <select id="wd-method-sel" class="input" style="padding:10px">
                <option value="ach">ACH Direct Bank Deposit (1-2 business days)</option>
                <option value="card">Instant Debit Card Push (15-30 minutes)</option>
                <option value="usdc">USDC Wallet Transfer (Polygon / Ethereum)</option>
              </select>
            </div>

            <div class="auth-field">
              <label>Destination Account / Address</label>
              <input id="wd-dest" class="input" placeholder="Bank routing / account or 0x address" value="Chase Checking •• 7192" />
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;margin-bottom:6px">
              <label style="font-size:12px;font-weight:700;color:var(--ink-2)">Amount (USD)</label>
              <button type="button" class="mini-btn" id="wd-max-btn" style="font-size:11px;padding:2px 8px">Max ($${(wallet.withdrawable / 100).toFixed(2)})</button>
            </div>
            <input id="wd-amt-in" class="input" type="number" min="1" step="0.01" placeholder="e.g. 50.00" />
            <div class="form-error" id="wd-tab-err"></div>

            <button class="btn-primary" id="wd-tab-submit" style="width:100%;margin-top:14px;padding:11px;font-size:14.5px;font-weight:700">
              Submit Withdrawal Request
            </button>
            <div class="order-note" style="text-align:left;margin-top:10px">
              Withdrawal requests are processed with ledger safety assertions. Funds are immediately reserved from available cash to prevent double-spending.
            </div>
          </div>

          <div>
            <h4 class="wd-hist-title" style="margin-top:0">Withdrawal History &amp; Status</h4>
            ${withdrawals.length ? `
              <div class="tablewrap"><table class="tbl">
                <thead><tr><th>Amount</th><th>Status</th><th>Requested</th><th>Action</th></tr></thead>
                <tbody>${withdrawals.map(w => `
                  <tr>
                    <td class="num"><b>${fmtMoney(w.amount)}</b></td>
                    <td><span class="wst ${w.status}">${w.status.toUpperCase()}</span></td>
                    <td class="muted small" title="${fmtClock(w.requestedAt)}">${timeAgo(w.requestedAt)}</td>
                    <td>${w.status === 'pending' ? `<button class="act-btn danger" data-wtab-cancel="${w.id}">Cancel</button>` : '—'}</td>
                  </tr>
                `).join('')}</tbody>
              </table></div>
            ` : '<div class="empty">No past withdrawal requests.</div>'}
          </div>
        </div>
      </div>
    `;
  }

  function renderHistoryTab() {
    return `
      <div class="card card-pad" style="max-width:1040px;margin:0 auto">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div>
            <h3 style="margin:0;display:flex;align-items:center;gap:8px">
              ${ic('layers', 18)} Audited Ledger Statement
            </h3>
            <p class="muted small" style="margin:2px 0 0">Immutable double-entry book for user #${state.me.id} (${esc(state.me.username)})</p>
          </div>
          <button class="mini-btn" id="w-export-csv" style="display:inline-flex;align-items:center;gap:6px;border-color:var(--ink);color:var(--ink)">
            ${ic('download', 14)} Export Statement CSV
          </button>
        </div>

        ${ledger.length ? `
          <div class="tablewrap"><table class="tbl">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Type</th>
                <th class="num">Amount</th>
                <th class="num">Running Balance</th>
                <th>Description / Memo</th>
                <th>Transaction ID</th>
              </tr>
            </thead>
            <tbody>${ledger.map(l => {
              const isCredit = l.amount > 0;
              const sign = isCredit ? '+' : '';
              return `
                <tr>
                  <td class="muted small" title="${fmtClock(l.createdAt)}">${new Date(l.createdAt).toLocaleDateString()} ${new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td><span class="tag-side ${isCredit ? 'yes' : 'no'}" style="font-size:10.5px;text-transform:uppercase">${esc(l.type || l.kind)}</span></td>
                  <td class="num ${isCredit ? 'up' : 'down'}" style="font-weight:700">${sign}${fmtMoney(l.amount)}</td>
                  <td class="num" style="font-family:monospace">${fmtMoney(l.balance)}</td>
                  <td class="small" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.memo || '')}">${esc(l.memo || '—')}</td>
                  <td class="muted small mono" style="font-size:11px">${esc((l.txId || 'tx_' + l.id).slice(0, 14))}…</td>
                </tr>
              `;
            }).join('')}</tbody>
          </table></div>
        ` : '<div class="empty">No ledger transactions recorded yet.</div>'}
      </div>
    `;
  }

  function attachEvents() {
    const qtop = $('#w-quick-deposit-top');
    if (qtop) qtop.onclick = () => openDepositModal(10000, () => viewWallet({ tab: 'deposit' }));

    const rbtn = $('#w-refresh-btn');
    if (rbtn) rbtn.onclick = () => viewWallet({ tab: activeTab });

    $$('[data-wtab]').forEach(b => {
      b.onclick = () => {
        activeTab = b.dataset.wtab;
        history.replaceState(null, '', `#/wallet?tab=${activeTab}`);
        render();
      };
    });

    $$('[data-pm]').forEach(b => {
      b.onclick = () => {
        activeMethod = b.dataset.pm;
        const panel = $('#method-panel');
        if (panel) {
          $$('[data-pm]').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          panel.innerHTML = renderMethodPanel();
          attachMethodEvents();
        }
      };
    });

    attachMethodEvents();
    attachWithdrawEvents();
    attachHistoryEvents();
  }

  function attachMethodEvents() {
    $$('.amount-chip').forEach(c => {
      c.onclick = () => {
        $$('.amount-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        selectedDepositCents = Number(c.dataset.amt);
        const inEl = $('#deposit-custom-amt');
        if (inEl) inEl.value = (selectedDepositCents / 100).toString();
        const cardBtn = $('#deposit-card-btn');
        if (cardBtn) cardBtn.innerHTML = `${ic('lock', 15)} Pay ${fmtMoney(selectedDepositCents)} &amp; Fund Account`;
        const bankBtn = $('#deposit-bank-btn');
        if (bankBtn) bankBtn.innerHTML = `${ic('building', 15)} Transfer ${fmtMoney(selectedDepositCents)} via ACH`;
      };
    });

    const custIn = $('#deposit-custom-amt');
    if (custIn) {
      custIn.oninput = () => {
        const val = parseFloat(custIn.value);
        if (Number.isFinite(val) && val > 0) {
          selectedDepositCents = Math.round(val * 100);
          $$('.amount-chip').forEach(x => {
            x.classList.toggle('active', Number(x.dataset.amt) === selectedDepositCents);
          });
          const cardBtn = $('#deposit-card-btn');
          if (cardBtn) cardBtn.innerHTML = `${ic('lock', 15)} Pay ${fmtMoney(selectedDepositCents)} &amp; Fund Account`;
          const bankBtn = $('#deposit-bank-btn');
          if (bankBtn) bankBtn.innerHTML = `${ic('building', 15)} Transfer ${fmtMoney(selectedDepositCents)} via ACH`;
        }
      };
    }

    const cardBtn = $('#deposit-card-btn');
    if (cardBtn) {
      cardBtn.onclick = async () => {
        const errEl = $('#deposit-err');
        if (errEl) errEl.classList.remove('show');
        if (selectedDepositCents < 500) {
          if (errEl) { errEl.textContent = 'Minimum deposit is $5.00'; errEl.classList.add('show'); }
          return;
        }
        cardBtn.disabled = true;
        cardBtn.textContent = 'Processing payment…';
        try {
          const r = await api('/api/deposit', {
            method: 'POST',
            body: {
              amountCents: selectedDepositCents,
              method: 'card',
              memo: 'Instant Card Deposit'
            }
          });
          toast(`Deposit confirmed! ${fmtMoney(r.depositedCents)} added to your available cash.`);
          await refreshMe();
          viewWallet({ tab: 'deposit' });
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.classList.add('show'); }
          cardBtn.disabled = false;
          cardBtn.innerHTML = `${ic('lock', 15)} Pay ${fmtMoney(selectedDepositCents)} &amp; Fund Account`;
        }
      };
    }

    const bankBtn = $('#deposit-bank-btn');
    if (bankBtn) {
      bankBtn.onclick = async () => {
        const errEl = $('#deposit-err');
        if (errEl) errEl.classList.remove('show');
        if (selectedDepositCents < 500) {
          if (errEl) { errEl.textContent = 'Minimum ACH deposit is $5.00'; errEl.classList.add('show'); }
          return;
        }
        bankBtn.disabled = true;
        bankBtn.textContent = 'Linking & Transferring…';
        try {
          const r = await api('/api/deposit', {
            method: 'POST',
            body: {
              amountCents: selectedDepositCents,
              method: 'ach',
              memo: 'ACH Direct Transfer'
            }
          });
          toast(`ACH Transfer initiated! ${fmtMoney(r.depositedCents)} credited.`);
          await refreshMe();
          viewWallet({ tab: 'deposit' });
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.classList.add('show'); }
          bankBtn.disabled = false;
          bankBtn.innerHTML = `${ic('building', 15)} Transfer ${fmtMoney(selectedDepositCents)} via ACH`;
        }
      };
    }

    const copyAddrBtn = $('#copy-crypto-addr');
    if (copyAddrBtn) {
      copyAddrBtn.onclick = () => {
        const addrIn = $('#crypto-addr-in');
        if (addrIn) {
          try {
            navigator.clipboard.writeText(addrIn.value).then(
              () => toast('Deposit address copied!'),
              () => toast('Address: ' + addrIn.value)
            );
          } catch { toast('Address: ' + addrIn.value); }
        }
      };
    }

    const simCryptoBtn = $('#crypto-sim-btn');
    if (simCryptoBtn) {
      simCryptoBtn.onclick = async () => {
        const errEl = $('#deposit-err');
        if (errEl) errEl.classList.remove('show');
        const simAmtEl = $('#crypto-sim-amt');
        const dollars = simAmtEl ? parseFloat(simAmtEl.value) : 100;
        if (!dollars || dollars < 5) {
          if (errEl) { errEl.textContent = 'Enter at least $5 USDC.'; errEl.classList.add('show'); }
          return;
        }
        const cents = Math.round(dollars * 100);
        simCryptoBtn.disabled = true;
        simCryptoBtn.textContent = 'Detecting on-chain transfer…';
        try {
          const net = ($('#crypto-network') && $('#crypto-network').value) || 'polygon';
          const r = await api('/api/deposit', {
            method: 'POST',
            body: {
              amountCents: cents,
              method: 'crypto',
              memo: `USDC Deposit (${net.toUpperCase()})`
            }
          });
          toast(`Blockchain transaction confirmed! ${fmtMoney(r.depositedCents)} credited to wallet.`);
          await refreshMe();
          viewWallet({ tab: 'deposit' });
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.classList.add('show'); }
          simCryptoBtn.disabled = false;
          simCryptoBtn.innerHTML = `${ic('zap', 14)} Simulate On-Chain Transfer`;
        }
      };
    }

    const promoBtn = $('#promo-submit-btn');
    if (promoBtn) {
      promoBtn.onclick = async () => {
        const codeIn = $('#promo-code-in');
        const errEl = $('#deposit-err');
        if (errEl) errEl.classList.remove('show');
        const code = codeIn ? codeIn.value.trim().toUpperCase() : '';
        if (!code) {
          if (errEl) { errEl.textContent = 'Please enter a promo code.'; errEl.classList.add('show'); }
          return;
        }
        promoBtn.disabled = true;
        promoBtn.textContent = 'Redeeming…';
        try {
          const r = await api('/api/promo/redeem', { method: 'POST', body: { code } });
          toast(`Voucher ${r.code} redeemed! ${fmtMoney(r.amount)} added.`);
          await refreshMe();
          viewWallet({ tab: 'deposit' });
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.classList.add('show'); }
          promoBtn.disabled = false;
          promoBtn.textContent = 'Redeem Code';
        }
      };
    }
  }

  function attachWithdrawEvents() {
    const maxBtn = $('#wd-max-btn');
    const amtIn = $('#wd-amt-in');
    if (maxBtn && amtIn) {
      maxBtn.onclick = () => {
        amtIn.value = (wallet.withdrawable / 100).toFixed(2);
      };
    }

    const wdSubmit = $('#wd-tab-submit');
    if (wdSubmit && amtIn) {
      wdSubmit.onclick = async () => {
        const errEl = $('#wd-tab-err');
        if (errEl) errEl.classList.remove('show');
        const dollars = parseFloat(amtIn.value);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          if (errEl) { errEl.textContent = 'Enter an amount greater than $0.'; errEl.classList.add('show'); }
          return;
        }
        const cents = Math.round(dollars * 100);
        if (cents > wallet.withdrawable) {
          if (errEl) { errEl.textContent = `Maximum withdrawable is ${fmtMoney(wallet.withdrawable)}.`; errEl.classList.add('show'); }
          return;
        }
        wdSubmit.disabled = true;
        wdSubmit.textContent = 'Submitting request…';
        try {
          await api('/api/withdrawals', {
            method: 'POST',
            body: {
              amountCents: cents,
              idemKey: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'wd_' + Date.now()
            }
          });
          toast('Withdrawal request submitted for review!');
          await refreshMe();
          viewWallet({ tab: 'withdraw' });
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.classList.add('show'); }
          wdSubmit.disabled = false;
          wdSubmit.textContent = 'Submit Withdrawal Request';
        }
      };
    }

    $$('[data-wtab-cancel]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Cancel this pending withdrawal and restore funds to your available balance?')) return;
        b.disabled = true;
        try {
          await api('/api/withdrawals/' + b.dataset.wtabCancel + '/cancel', { method: 'POST' });
          toast('Withdrawal cancelled — funds returned.');
          await refreshMe();
          viewWallet({ tab: 'withdraw' });
        } catch (e) {
          toast(e.message, true);
          b.disabled = false;
        }
      };
    });
  }

  function attachHistoryEvents() {
    const csvBtn = $('#w-export-csv');
    if (csvBtn) {
      csvBtn.onclick = () => {
        const rows = [['timestamp', 'tx_id', 'type', 'kind', 'amount_cents', 'balance_cents', 'memo']];
        for (const l of ledger) {
          rows.push([
            new Date(l.createdAt).toISOString(),
            `"${(l.txId || '').replace(/"/g, '""')}"`,
            l.type || l.kind,
            l.kind || '',
            l.amount,
            l.balance,
            `"${(l.memo || '').replace(/"/g, '""')}"`
          ].join(','));
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `predix-statement-${Date.now()}.csv`;
        a.click();
        toast('Statement CSV exported.');
      };
    }
  }

  render();
}

/* ================= PORTFOLIO ================= */
async function viewPortfolio() {
  if (!state.me) { location.hash = '#/login'; return; }
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading portfolio…</p></div>`;
  let d;
  try { d = await api('/api/portfolio'); }
  catch (e) { app().innerHTML = errorScreen(e.message, '#/'); return; }
  state.snapshot = { wallet: d.wallet, orders: d.orders, positions: d.positions };
  state.rewards = d.rewards;
  renderHeader();

  if (!state.markets.length) {
    try {
      const r = await api('/api/markets');
      state.markets = r.markets;
      state.markets.forEach((m) => { upsertMarket(m); if (m.spark) state.sparks.set(m.slug, m.spark); });
    } catch {}
  }

  const deposits = d.ledger.filter((l) => l.type === 'promo' || l.type === 'deposit' || l.kind === 'deposit').reduce((s, l) => s + l.amount, 0);
  const posValue = d.positions.reduce((s, p) => s + (p.value || 0), 0);
  const equity = d.wallet.total + posValue;
  const pnl = equity - deposits;
  const unreal = d.positions.reduce((s, p) => s + (p.unrealized || 0), 0);
  const rw = d.rewards || { tier: 'Bronze', points: 0, nextAt: 1000, next: 'Silver', perk: 'Standard trading' };
  const nextPts = rw.nextAt ? rw.nextAt - rw.points : null;
  const pct = rw.nextAt ? Math.min(100, Math.round(100 * rw.points / rw.nextAt)) : 100;

  const pastOrders = d.orderHistory || [];
  const curTab = state.pastOrderTab || 'all';
  const filteredPastOrders = pastOrders.filter((o) => {
    if (curTab === 'filled') return o.status === 'filled' || (o.filled > 0 && o.status !== 'canceled');
    if (curTab === 'canceled') return o.status === 'canceled' || o.status === 'rejected';
    return true;
  });

  app().innerHTML = `
    <div class="page-head">
      <div>
        <h2 class="page-title">Portfolio</h2>
        <p class="page-sub">${esc(state.me.username)} · member since ${new Date(state.me.createdAt).toLocaleDateString()}</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn-primary" id="port-deposit-btn" style="padding:8px 16px;font-size:13.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px">
          ${ic('creditCard', 15)} + Deposit Funds
        </button>
        <a href="#/wallet?tab=withdraw" class="mini-btn" style="padding:8px 14px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;text-decoration:none">
          ${ic('arrowUpRight', 14)} Withdraw
        </a>
        <a href="#/wallet" class="mini-btn" style="padding:8px 14px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;text-decoration:none">
          ${ic('layers', 14)} Wallet &amp; Statements
        </a>
      </div>
    </div>

    <div class="stat-cards">
      <div class="card stat-card"><div class="lbl">Total equity</div><div class="val">${fmtMoney(equity)}</div><div class="sub">cash + positions at market</div></div>
      <div class="card stat-card"><div class="lbl">Cash available</div><div class="val">${fmtMoney(d.wallet.available)}</div><div class="sub">${fmtMoney(d.wallet.reserved)} reserved for orders</div></div>
      <div class="card stat-card"><div class="lbl">Positions value</div><div class="val">${fmtMoney(posValue)}</div><div class="sub">${d.positions.length} open</div></div>
      <div class="card stat-card"><div class="lbl">Total P&amp;L</div><div class="val ${pnl >= 0 ? 'up' : 'down'}">${sgn(pnl)}</div><div class="sub">vs ${fmtMoney(deposits)} deposits</div></div>
      <div class="card stat-card"><div class="lbl">Unrealized P&amp;L</div><div class="val ${unreal >= 0 ? 'up' : 'down'}">${sgn(unreal)}</div><div class="sub">if closed at market now</div></div>
    </div>

    <div class="card card-pad section" id="wdraw-card">
      <div class="loading-block" style="padding:26px 0"><div class="spinner"></div><p>Loading withdrawals…</p></div>
    </div>

    <div class="two-col section">
      <div class="card card-pad reward-card">
        <h3>${ic('medal', 17)} Predix Rewards</h3>
        <div class="tier-badge"><span class="gem">${ic('medal', 15)}</span>${rw.tier} tier</div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="reward-sub">${fmtQty(rw.points)} reward points ${rw.nextAt ? `· ${fmtQty(Math.max(0, nextPts))} to ${rw.next}` : '· top tier reached'}</div>
        <ul class="perk-list">
          <li>${ic('check', 12)} ${esc(rw.perk)}</li>
          <li>${ic('check', 12)} 1 point per $1 traded — earned automatically</li>
          <li>${ic('check', 12)} Points never expire</li>
        </ul>
      </div>
      <div class="card card-pad reward-card">
        <h3>${ic('handshake', 17)} Referrals</h3>
        <div style="font-size:13.5px;color:var(--ink-2);line-height:1.6">
          Share your code — you both get <b style="color:var(--green)">$10</b> when they sign up.
        </div>
        <div class="ref-row">
          <span style="font-size:12px;color:var(--muted)">Your code</span>
          <code id="ref-code">${esc(state.me.username.toUpperCase())}</code>
          <button class="copybtn" id="copy-ref">Copy link</button>
        </div>
        <div class="reward-sub" style="margin-top:10px">${d.referralCount} referral bonus${d.referralCount === 1 ? '' : 'es'} received so far</div>
      </div>
    </div>

    <div class="card card-pad section" id="stats-card">
      <h3>${ic('chart', 17)} Trading statistics</h3>
      <div id="stats-body" class="muted small">Loading stats…</div>
    </div>

    <div class="card card-pad section">
      <h3>Positions <button class="mini-btn" id="csv-btn" style="float:right;border-color:var(--ink);color:var(--ink)">${ic('download', 13)} Export trades CSV</button></h3>
      ${d.positions.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Market</th><th>Side</th><th class="num">Qty</th><th class="num">Avg</th><th class="num">Mark</th><th class="num">Value</th><th class="num">Unrealized</th><th class="num">Max payout</th><th>Action</th></tr></thead>
        <tbody>${d.positions.map((p) => {
          const free = p.yesFree > 0 ? p.yesFree : (p.noFree > 0 ? p.noFree : 0);
          const sideToSell = p.yesFree > 0 ? 'yes' : 'no';
          const canCashOut = free > 0 && p.market && p.market.status === 'open';
          return `
          <tr>
            <td><a href="#/market/${p.market ? p.market.slug : ''}">${p.market ? catIcon(p.market.category, 15) + ' ' + esc(p.market.title) : '?'}</a>${p.market && p.market.optionLabel ? ' <span class="badge cat">' + esc(p.market.optionLabel) + '</span>' : ''}</td>
            <td>${p.yesQty > 0 ? `<span class="tag-side yes">${p.market && p.market.multi ? esc(p.market.optionLabel || 'YES') : 'YES'} ×${fmtQty(p.yesQty)}</span>` : ''}${p.noQty > 0 ? ` <span class="tag-side no">NO ×${fmtQty(p.noQty)}</span>` : ''}</td>
            <td class="num">${fmtQty(p.yesQty + p.noQty)}</td>
            <td class="num">${p.yesQty > 0 ? fmtPrice(p.yesAvg) : fmtPrice(p.noAvg)}</td>
            <td class="num">${p.mark === null ? '—' : fmtPrice(p.mark)}</td>
            <td class="num">${p.value === null ? '—' : fmtMoney(p.value)}</td>
            <td class="num ${p.unrealized >= 0 ? 'up' : 'down'}">${p.unrealized === null ? '—' : sgn(p.unrealized)}</td>
            <td class="num">${fmtMoney(p.maxPayoutYes + p.maxPayoutNo)}</td>
            <td>
              ${canCashOut ? `
                <button class="mini-btn good" data-port-cashout data-mid="${p.marketId}" data-slug="${p.market.slug}" data-out="${sideToSell}" data-qty="${free}" title="Quickly exit at market price">
                  Cash Out
                </button>
              ` : (p.market && p.market.status !== 'open' ? `<span class="muted small">${p.market.status}</span>` : `<span class="muted small">—</span>`)}
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">No open positions — browse markets to start trading.</div>'}
    </div>

    <div class="card card-pad section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <h3 style="margin:0">${ic('layers', 17)} Open orders (Active bids &amp; asks)</h3>
        <span class="muted small">${d.orders.length} resting order${d.orders.length === 1 ? '' : 's'}</span>
      </div>
      ${d.orders.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Market</th><th>Order</th><th class="num">Price</th><th class="num">Filled</th><th class="num">Remaining</th><th></th></tr></thead>
        <tbody>${d.orders.map((o) => `
          <tr data-ordrow="${o.id}">
            <td class="small">${marketLinkFor(o.marketId)}</td>
            <td><span class="tag-side ${o.outcome}">${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.outcome.toUpperCase()}</span> <span class="muted small">${o.type}</span></td>
            <td class="num">${o.type === 'limit' && o.price !== null ? fmtPrice(o.price) : 'Market'}</td>
            <td class="num">${fmtQty(o.filled)}</td>
            <td class="num">${fmtQty(o.qty)}</td>
            <td><button class="mini-btn" data-cancel="${o.id}">Cancel</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No active open orders or resting bids.</div>'}
    </div>

    <!-- Dedicated Section: Past Bids & Order History -->
    <div class="card card-pad section" id="past-orders-section">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <h3 style="margin:0">${ic('clock', 17)} Past Bids &amp; Order History</h3>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div class="ranges" id="past-orders-tabs">
            <button data-pot="all" class="${curTab === 'all' ? 'active' : ''}">All (${pastOrders.length})</button>
            <button data-pot="filled" class="${curTab === 'filled' ? 'active' : ''}">Filled (${pastOrders.filter((o) => o.status === 'filled').length})</button>
            <button data-pot="canceled" class="${curTab === 'canceled' ? 'active' : ''}">Canceled (${pastOrders.filter((o) => o.status === 'canceled' || o.status === 'rejected').length})</button>
          </div>
        </div>
      </div>
      ${filteredPastOrders.length ? `<div class="tablewrap"><table class="tbl">
        <thead>
          <tr>
            <th>Market</th>
            <th>Side</th>
            <th>Type</th>
            <th class="num">Order Price</th>
            <th class="num">Filled</th>
            <th class="num">Avg Fill</th>
            <th>Status</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>${filteredPastOrders.map((o) => {
          const statusCls = o.status === 'filled' ? 'filled'
            : (o.status === 'canceled' ? 'canceled' : (o.status === 'rejected' ? 'rejected' : 'partially_filled'));
          const fillDisplay = o.origQty ? `${fmtQty(o.filled)} / ${fmtQty(o.origQty)}` : `${fmtQty(o.filled)}`;
          const avgPrice = o.avgFill ? fmtPrice(o.avgFill) : (o.filled > 0 && o.price ? fmtPrice(o.price) : '—');
          return `<tr>
            <td class="small">${marketLinkFor(o.marketId)}</td>
            <td><span class="tag-side ${o.outcome}">${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.outcome.toUpperCase()}</span></td>
            <td><span class="muted small">${esc(o.type || 'limit')}</span></td>
            <td class="num">${o.type === 'limit' && o.price !== null ? fmtPrice(o.price) : 'Market'}</td>
            <td class="num">${fillDisplay}</td>
            <td class="num">${avgPrice}</td>
            <td>
              <span class="ord-status ${statusCls}">${esc(o.statusText || o.status)}</span>
              ${o.note ? `<div class="muted small" style="margin-top:2px;font-size:11px">${esc(o.note)}</div>` : ''}
            </td>
            <td class="muted small" title="${fmtClock(o.updatedAt || o.createdAt)}">${timeAgo(o.updatedAt || o.createdAt)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="empty">No ${curTab === 'all' ? 'past bids or order history' : curTab + ' orders'}.</div>`}
    </div>

    <!-- Dedicated Section: Executed Trade History & Cash Ledger -->
    <div class="two-col section">
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">${ic('repeat', 16)} Trade history</h3>
          <span class="muted small">${d.trades.length ? `${d.trades.length} executed` : ''}</span>
        </div>
        <div class="tablewrap">${d.trades.length ? `<table class="tbl">
          <thead><tr><th>Market</th><th>Side</th><th class="num">Price</th><th class="num">Qty</th><th>When</th></tr></thead>
          <tbody>${d.trades.map((t) => `
            <tr>
              <td class="small">${marketLinkFor(t.marketId)}</td>
              <td><span class="t-side ${t.takerKind === 'BY' || t.takerKind === 'BN' ? 'buy' : 'sell'}">${kindLabel[t.takerKind] || ''}</span></td>
              <td class="num"><b>${fmtPrice(t.price)}</b></td>
              <td class="num">${fmtQty(t.qty)}</td>
              <td class="muted small" title="${fmtClock(t.ts)}">${timeAgo(t.ts)}</td>
            </tr>`).join('')}
          </tbody></table>` : '<div class="empty">No executed trades yet.</div>'}</div>
      </div>
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">${ic('layers', 16)} Cash ledger</h3>
          <span class="muted small">${d.ledger.length ? `${d.ledger.length} entries` : ''}</span>
        </div>
        <div class="tablewrap">${d.ledger.length ? `<table class="tbl">
          <thead><tr><th>Type</th><th class="num">Amount</th><th class="num">Balance</th><th>Details</th></tr></thead>
          <tbody>${d.ledger.map((l) => `
            <tr><td><span class="status-pill ${l.type === 'promo' || l.type === 'referral' ? 'filled' : 'open'}">${l.type.replace('_', ' ')}</span></td>
            <td class="num ${l.amount >= 0 ? 'up' : 'down'}">${sgn(l.amount)}</td>
            <td class="num">${fmtMoney(l.balanceAfter)}</td>
            <td class="muted small">${esc(l.memo || '')}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">No ledger entries yet.</div>'}</div>
      </div>
    </div>`;

  $$('#past-orders-tabs button').forEach((b) => {
    b.onclick = () => {
      state.pastOrderTab = b.dataset.pot;
      viewPortfolio();
    };
  });

  const portDepBtn = $('#port-deposit-btn');
  if (portDepBtn) portDepBtn.onclick = () => openDepositModal(10000, () => viewPortfolio());

  const promoBtn = $('#promo-btn');
  if (promoBtn) promoBtn.onclick = async () => {
    const pIn = $('#promo-in');
    const code = pIn ? pIn.value.trim() : '';
    if (!code) return;
    try {
      const r = await api('/api/promo/redeem', { method: 'POST', body: { code } });
      toast(`Promo ${r.code} applied — ${fmtMoney(r.amount)} added!`);
      viewPortfolio();
    } catch (e) { toast(e.message, true); }
  };
  $('#copy-ref').onclick = () => {
    const link = location.origin + '/#/signup?ref=' + state.me.username.toUpperCase();
    const full = location.origin.includes('e2b') ? link : link; // same thing; keep simple
    try {
      navigator.clipboard.writeText(full).then(
        () => toast('Referral link copied to clipboard!'),
        () => toast('Code: ' + state.me.username.toUpperCase())
      );
    } catch { toast('Share this code at signup: ' + state.me.username.toUpperCase()); }
  };
  $$('[data-cancel]').forEach((b) => b.onclick = async () => {
    try { await api('/api/orders/' + b.dataset.cancel + '/cancel', { method: 'POST' }); toast('Order canceled.'); viewPortfolio(); }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-port-cashout]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Closing…';
      try {
        const body = {
          market: b.dataset.slug,
          marketId: Number(b.dataset.mid),
          side: 'sell',
          outcome: b.dataset.out,
          type: 'market',
          qty: Number(b.dataset.qty),
          idemKey: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'co' + Date.now() + '-' + Math.random().toString(36).slice(2)
        };
        const r = await api('/api/orders', { method: 'POST', body });
        const o = r.order;
        if (o.status === 'filled') toast(`Position cashed out: Sold ${o.filled} ${b.dataset.out.toUpperCase()} at market!`);
        else toast(`Cash out order placed: ${o.status}`);
        refreshMe();
        viewPortfolio();
      } catch (e) {
        toast(`Cash out failed: ${e.message}`, true);
        b.disabled = false;
        b.textContent = 'Cash Out';
      }
    };
  });
  loadWithdrawCard();

  // trading stats dashboard
  try {
    const { stats: st } = await api('/api/me/stats');
    const bodyEl = $('#stats-body');
    if (bodyEl) {
      const bars = st.series.length > 1 ? miniArea(st.series) : '';
      bodyEl.innerHTML = `
      <div class="stats-grid">
        <div><div class="lbl">Trades</div><div class="v">${fmtQty(st.tradeCount)}</div><div class="sub">${st.buys} buys · ${st.sells} sells</div></div>
        <div><div class="lbl">Volume</div><div class="v">${fmtMoney0(st.volume)}</div><div class="sub">notional traded</div></div>
        <div><div class="lbl">Markets won</div><div class="v">${st.winRate === null ? '—' : st.winRate + '%'}</div><div class="sub">${st.winCount}/${st.settledCount} settled</div></div>
        <div><div class="lbl">Realized P&L</div><div class="v ${st.realized >= 0 ? 'up' : 'down'}">${sgn(st.realized)}</div><div class="sub">from trades + settlements</div></div>
        <div><div class="lbl">Streak</div><div class="v">${st.streak > 0 ? st.streak + 'W' : '—'}</div><div class="sub">consecutive wins</div></div>
        <div><div class="lbl">Best win</div><div class="v up">${st.bestWin ? sgn(st.bestWin.net) : '—'}</div><div class="sub">${st.bestWin ? esc(shortTitle(st.bestWin.title, 28)) : 'no settlements yet'}</div></div>
      </div>
      ${bars ? `<div class="muted small" style="margin:12px 0 4px">Realized P&L over time</div>${bars}` : ''}`;
    }
  } catch {}

  // CSV export
  const csvBtn = $('#csv-btn');
  if (csvBtn) csvBtn.onclick = () => {
    const rows = [['time', 'market', 'side', 'price_cents', 'qty']];
    for (const t of d.trades) {
      const m = [...state.byslug.values()].find((x) => x.id === t.marketId);
      rows.push([new Date(t.ts).toISOString(), m ? '"' + m.title.replace(/"/g, '""') + '"' : 'Market #' + t.marketId,
        kindLabel[t.takerKind] || t.takerKind, t.price, t.qty].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'predix-trades.csv';
    a.click();
    toast('CSV exported');
  };
}
function miniArea(series) {
  const pts = series.map((s) => s.cum);
  const W = 640, H = 90;
  const lo = Math.min(0, ...pts), hi = Math.max(1, ...pts);
  const X = (i) => (i / (pts.length - 1)) * W;
  const Y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const col = pts[pts.length - 1] >= 0 ? 'var(--chart-up)' : 'var(--chart-down)';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:90px">
    <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--grid-line)" stroke-dasharray="3 3"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function marketTitleFor(id) {
  const m = [...state.byslug.values()].find((x) => x.id === id);
  return m ? esc(m.title) : 'Market #' + id;
}
function marketLinkFor(id) {
  const m = [...state.byslug.values()].find((x) => x.id === id);
  if (!m) return 'Market #' + id;
  return `<a href="#/market/${m.slug}" style="text-decoration:none;font-weight:600;color:inherit">${catIcon(m.category, 14)} ${esc(m.title)}</a>`;
}

/* ================= PROFILE ================= */
async function viewProfile() {
  if (!state.me) { location.hash = '#/login'; return; }
  let d;
  try { d = await api('/api/portfolio'); }
  catch (e) { return app().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  const rw = d.rewards || { tier: 'Bronze', points: 0, nextAt: 1000, next: 'Silver', perk: 'Standard trading' };
  const pct = rw.nextAt ? Math.min(100, Math.round(100 * rw.points / rw.nextAt)) : 100;

  app().innerHTML = `
    <div class="page-head"><div>
      <h2 class="page-title">Profile &amp; rewards</h2>
      <p class="page-sub">Account, security, rewards tier and referrals</p>
    </div></div>
    <div class="profile-grid">
      <div class="card card-pad" style="grid-column: 1 / -1; background: linear-gradient(135deg, var(--card) 0%, var(--bg-2) 100%);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px">
          <div>
            <h3 style="margin:0;display:flex;align-items:center;gap:8px">${ic('creditCard', 18)} Wallet &amp; Payment Methods</h3>
            <p class="muted small" style="margin:2px 0 0">Manage your deposits, instant payouts, and financial records</p>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn-primary" id="prof-deposit-btn" style="padding:8px 16px;font-size:13.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px">
              ${ic('plus', 14)} Deposit Funds
            </button>
            <a href="#/wallet?tab=withdraw" class="mini-btn" style="padding:8px 14px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;text-decoration:none">
              ${ic('arrowUpRight', 14)} Withdraw
            </a>
            <a href="#/wallet" class="mini-btn" style="padding:8px 14px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;text-decoration:none">
              ${ic('layers', 14)} Full Wallet &amp; Statements &rarr;
            </a>
          </div>
        </div>
        <div class="wallet-metrics" style="margin-top:0">
          <div class="wallet-metric-item">
            <div class="k">Available Cash</div>
            <div class="v" style="color:var(--green)">${fmtMoney(d.wallet.available)}</div>
            <div class="sub">Instant trading liquidity</div>
          </div>
          <div class="wallet-metric-item">
            <div class="k">Reserved in Orders</div>
            <div class="v">${fmtMoney(d.wallet.reserved)}</div>
            <div class="sub">Committed in bids</div>
          </div>
          <div class="wallet-metric-item">
            <div class="k">Total Account Equity</div>
            <div class="v">${fmtMoney(d.wallet.total)}</div>
            <div class="sub">Cash reserves</div>
          </div>
        </div>
      </div>
      <div class="card card-pad">
        <h3>${ic('user', 17)} Account</h3>
        <div class="kv-row"><span class="k">Username</span><b>${esc(state.me.username)}</b></div>
        <div class="kv-row"><span class="k">Email</span><b>${esc(state.me.email)}</b></div>
        <div class="kv-row"><span class="k">Role</span><b style="text-transform:capitalize">${esc(state.me.role)}</b></div>
        <div class="kv-row"><span class="k">Member since</span><b>${state.me.createdAt ? new Date(state.me.createdAt).toLocaleDateString() : '—'}</b></div>
        <div class="kv-row"><span class="k">Referral code</span><b class="mono">${esc(state.me.username.toUpperCase())}</b></div>
      </div>
      <div class="card card-pad">
        <h3>${ic('lock', 17)} Change password</h3>
        <div class="form-error" id="pw-err"></div>
        <div class="auth-field"><label>Current password</label><input id="pw-cur" class="input" type="password" autocomplete="current-password" /></div>
        <div class="auth-field"><label>New password (min 8 chars)</label><input id="pw-new" class="input" type="password" autocomplete="new-password" /></div>
        <button class="btn-primary" id="pw-go" style="margin:0">Update password</button>
      </div>
      <div class="card card-pad" style="grid-column:1/-1">
        <h3>${ic('medal', 17)} Achievements <span class="muted small">— <span id="ach-count">…</span> earned</span></h3>
        <div class="ach-grid" id="ach-grid"><span class="muted small">Loading…</span></div>
      </div>
      <div class="card card-pad" style="grid-column:1/-1">
        <h3>${ic('bell', 18)} Your price alerts</h3>
        <div id="alerts-grid"><span class="muted small">Loading…</span></div>
      </div>
      <div class="card card-pad reward-card" style="grid-column:1/-1">
        <h3>${ic('medal', 17)} Predix Rewards</h3>
        <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">
          <div class="tier-badge"><span class="gem">${ic('medal', 15)}</span>${rw.tier} tier</div>
          <div style="min-width:0;flex:1 1 220px">
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="reward-sub">${fmtQty(rw.points)} points ${rw.nextAt ? `· ${fmtQty(Math.max(0, rw.nextAt - rw.points))} more to reach ${rw.next}` : '· top tier'}</div>
          </div>
          <ul class="perk-list" style="margin:0">
            <li>${ic('check', 12)} ${esc(rw.perk)}</li>
            <li>${ic('check', 12)} Earn 1 point per $1 traded</li>
          </ul>
        </div>
      </div>
    </div>`;

  const profDepBtn = $('#prof-deposit-btn');
  if (profDepBtn) profDepBtn.onclick = () => openDepositModal(10000, () => viewProfile());

  $('#pw-go').onclick = async () => {
    const err = $('#pw-err');
    try {
      await api('/api/me/password', { method: 'POST', body: { current: $('#pw-cur').value, next: $('#pw-new').value } });
      toast('Password updated.');
      $('#pw-cur').value = ''; $('#pw-new').value = '';
    } catch (e) { err.textContent = e.message; err.classList.add('show'); }
  };

  // achievements grid
  try {
    const { achievements } = await api('/api/me/achievements');
    const cnt = $('#ach-count');
    if (cnt) cnt.textContent = achievements.filter((a) => a.earned).length + '/' + achievements.length;
    const grid = $('#ach-grid');
    if (grid) grid.innerHTML = achievements.map((a) => `
      <div class="ach-chip ${a.earned ? '' : 'locked'}" title="${esc(a.desc)}">
        <span class="ach-ic">${a.icon}</span>
        <div><b>${esc(a.name)}</b><div class="muted small">${esc(a.desc)}</div></div>
      </div>`).join('');
  } catch {}

  // alerts list
  try {
    const { alerts } = await api('/api/me/alerts');
    const grid = $('#alerts-grid');
    if (grid) grid.innerHTML = alerts.length ? alerts.map((a) => `
      <div class="pos-line" style="padding:7px 0;border-bottom:1px solid var(--line)">
        <span><a href="#/market/${a.slug}" style="color:inherit;font-weight:700">${esc(shortTitle(a.title, 44))}</a>
          ${a.optionLabel ? '<span class="badge cat">' + esc(a.optionLabel) + '</span>' : ''}
          <span class="muted small">${a.dir} ${fmtPrice(a.price)} · ${a.status}</span></span>
        ${a.status === 'active' ? `<button class="mini-btn" data-delalert2="${a.id}">Remove</button>` : '<span class="badge cat">done</span>'}
      </div>`).join('') : '<div class="empty">No alerts — set one from any market page.</div>';
    $$('[data-delalert2]').forEach((b) => b.onclick = async () => {
      try { await api('/api/me/alerts/' + b.dataset.delalert2, { method: 'DELETE' }); toast('Alert removed.'); viewProfile(); }
      catch (e) { toast(e.message, true); }
    });
  } catch {}
}

/* ================= LEADERBOARD ================= */
async function viewLeaderboard() {
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading leaderboard…</p></div>`;
  let d;
  try { d = await api('/api/leaderboard?window=' + state.lbWindow); }
  catch (e) { app().innerHTML = errorScreen(e.message); return; }
  const volMode = d.metric === 'volume';
  app().innerHTML = `
    <div class="page-head"><div>
      <h2 class="page-title">${ic('trophy', 22)} Leaderboard</h2>
      <p class="page-sub">${volMode ? 'Ranked by volume traded in window' : 'Ranked by total equity'} · play money · market makers excluded</p>
    </div></div>
    <div class="chips" style="margin-bottom:14px">
      ${[['all', 'All time'], ['week', 'This week'], ['today', 'Today']].map(([k, l]) =>
        `<button class="chip ${state.lbWindow === k ? 'active' : ''}" data-lbw="${k}">${l}</button>`).join('')}
    </div>
    <div class="card card-pad"><div class="tablewrap"><table class="tbl">
      <thead><tr><th>#</th><th>Trader</th>
        ${volMode ? '<th class="num">Volume (window)</th>' : '<th class="num">Equity</th><th class="num">Deposited</th><th class="num">P&L</th><th class="num">Return</th>'}
      </tr></thead>
      <tbody>${d.leaderboard.map((r, i) => `
        <tr>
          <td><b class="lb-rank r${Math.min(i + 1, 4)}">${i + 1}</b></td>
          <td><a href="#/trader/${esc(r.username)}" style="color:inherit;font-weight:700"><span class="avatar" style="width:24px;height:24px;font-size:11px;margin-right:8px;display:inline-flex">${esc(r.username[0].toUpperCase())}</span>${esc(r.username)}</a>${state.me && r.username === state.me.username ? ' <span class="badge cat">you</span>' : ''}</td>
          ${volMode
            ? `<td class="num"><b>${fmtMoney0(r.windowVolume || 0)}</b></td>`
            : `<td class="num"><b>${fmtMoney(r.equity)}</b></td>
               <td class="num">${fmtMoney(r.deposits)}</td>
               <td class="num ${r.pnl >= 0 ? 'up' : 'down'}">${sgn(r.pnl)}</td>
               <td class="num ${r.pnl >= 0 ? 'up' : 'down'}">${r.pnlPct === null ? '—' : (r.pnlPct >= 0 ? '+' : '') + r.pnlPct + '%'}</td>`}
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No traders yet — be the first!</td></tr>'}
      </tbody></table></div></div>`;
  $$('[data-lbw]').forEach((b) => b.onclick = () => { state.lbWindow = b.dataset.lbw; viewLeaderboard(); });
}

/* ================= PUBLIC TRADER PROFILE ================= */
async function viewTrader(username) {
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading trader…</p></div>`;
  let d;
  try { d = await api('/api/traders/' + username); }
  catch (e) { app().innerHTML = errorScreen(e.message, '#/leaderboard'); return; }
  const t = d.trader;
  const s = t.stats;
  app().innerHTML = `
    <div class="page-head">
      <div style="display:flex;gap:14px;align-items:center">
        <span class="avatar" style="width:52px;height:52px;font-size:22px">${esc(t.username[0].toUpperCase())}</span>
        <div>
          <h2 class="page-title" style="margin:0">@${esc(t.username)}</h2>
          <p class="page-sub">Trader since ${new Date(t.createdAt).toLocaleDateString()} · ${t.rewards.tier} tier</p>
        </div>
      </div>
    </div>
    <div class="stat-cards">
      <div class="card stat-card"><div class="lbl">Equity</div><div class="val">${fmtMoney(t.equity)}</div></div>
      <div class="card stat-card"><div class="lbl">Total P&L</div><div class="val ${t.pnl >= 0 ? 'up' : 'down'}">${sgn(t.pnl)}</div></div>
      <div class="card stat-card"><div class="lbl">Win rate</div><div class="val">${s.winRate === null ? '—' : s.winRate + '%'}</div><div class="sub">${s.winCount}/${s.settledCount} markets won</div></div>
      <div class="card stat-card"><div class="lbl">Volume traded</div><div class="val">${fmtMoney0(s.volume)}</div><div class="sub">${fmtQty(s.tradeCount)} trades</div></div>
      <div class="card stat-card"><div class="lbl">Current streak</div><div class="val">${s.streak > 0 ? s.streak + 'W' : '—'}</div></div>
    </div>
    <div class="card card-pad section">
      <h3>${ic('medal', 17)} Achievements (${t.achievements.length})</h3>
      <div class="ach-grid">${t.achievements.length
        ? t.achievements.map((a) => `<div class="ach-chip"><span class="ach-ic">${a.icon}</span><div><b>${esc(a.name)}</b><div class="muted small">${esc(a.desc)}</div></div></div>`).join('')
        : '<div class="empty">No achievements yet.</div>'}</div>
    </div>
    <div class="card card-pad section">
      <h3>Open positions</h3>
      ${t.positions.length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>Market</th><th class="num">YES qty</th><th class="num">NO qty</th><th class="num">Mark</th></tr></thead>
        <tbody>${t.positions.map((p) => `
          <tr><td><a href="#/market/${p.slug}">${catIcon(p.category, 15)} ${esc(p.title)}${p.optionLabel ? ' <span class="badge cat">' + esc(p.optionLabel) + '</span>' : ''}</a></td>
          <td class="num">${fmtQty(p.yesQty)}</td><td class="num">${fmtQty(p.noQty)}</td><td class="num">${p.mark === null ? '—' : fmtPrice(p.mark)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No open positions.</div>'}
    </div>`;
}

/* ================= REAL-TIME ANALYTICS HUB ================= */
async function viewAnalytics() {
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Connecting to real-time analytics engine…</p></div>`;
  let d;
  try { d = await api('/api/analytics'); }
  catch (e) { app().innerHTML = errorScreen(e.message, '#/'); return; }

  const totalSent = (d.bullishMarkets || 0) + (d.bearishMarkets || 0) + (d.neutralMarkets || 0) || 1;
  const bullPct = Math.round(((d.bullishMarkets || 0) / totalSent) * 100);
  const bearPct = Math.round(((d.bearishMarkets || 0) / totalSent) * 100);
  const neutPct = Math.max(0, 100 - bullPct - bearPct);

  app().innerHTML = `
    <div class="page-head" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;width:100%">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <h2 class="page-title" style="margin:0">Real-Time Market Intelligence</h2>
            <span class="an-live-indicator"><span class="an-pulse-dot"></span>LIVE STREAM</span>
          </div>
          <p class="page-sub" style="margin-top:4px">Institutional order flow imbalance, algorithmic sentiment, and live platform trade tape</p>
        </div>
        <div class="analytics-clock" id="an-clock">${new Date().toLocaleTimeString()}</div>
      </div>
    </div>

    <div class="stat-cards" style="margin-bottom:20px">
      <div class="card stat-card">
        <div class="lbl">Active Markets Monitored</div>
        <div class="val">${d.totalActiveMarkets}</div>
        <div class="sub">100% real-time order matching</div>
      </div>
      <div class="card stat-card">
        <div class="lbl">Market Sentiment Radar</div>
        <div class="val" style="font-size:20px">${bullPct}% Bullish</div>
        <div class="imbalance-bar-wrap" style="margin-top:6px;height:7px">
          <div class="imbalance-fill-buy" style="width:${bullPct}%" title="${bullPct}% Bullish"></div>
          <div style="background:var(--muted);width:${neutPct}%" title="${neutPct}% Neutral"></div>
          <div class="imbalance-fill-sell" style="width:${bearPct}%" title="${bearPct}% Bearish"></div>
        </div>
        <div class="sub" style="margin-top:4px">${d.bullishMarkets} Bull · ${d.neutralMarkets} Neutral · ${d.bearishMarkets} Bear</div>
      </div>
      <div class="card stat-card">
        <div class="lbl">Live Imbalance Extremes</div>
        <div class="val" style="color:var(--up);font-size:20px">${(d.highImbalance || []).length} High Skew</div>
        <div class="sub">Significant buying / selling pressure</div>
      </div>
      <div class="card stat-card">
        <div class="lbl">Whale Executions</div>
        <div class="val" style="color:#f5b04d;font-size:20px">${(d.recentWhales || []).length} Detected</div>
        <div class="sub">Orders ≥ 40 shares or ≥ $20</div>
      </div>
    </div>

    <div class="two-col section analytics-two-col">
      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">${ic('chart', 18)} Market Scanner</h3>
          <div class="ranges" id="an-scanner-tabs">
            <button data-tab="movers" class="active">Top Movers</button>
            <button data-tab="imbalance">Order Flow Skew</button>
            <button data-tab="liquidity">Deepest Books</button>
          </div>
        </div>

        <div id="an-scanner-content">
          ${renderScannerMovers(d.topMovers)}
        </div>
      </div>

      <div class="card card-pad">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="margin:0">${ic('trendingUp', 18)} Live Platform Tape</h3>
          <span class="badge" style="background:rgba(45,212,189,.15);color:var(--accent);font-size:10.5px"><span class="dot"></span>STREAMING</span>
        </div>
        <div class="live-tape-container" id="live-tape-list">
          ${(d.recentWhales && d.recentWhales.length)
            ? d.recentWhales.map((w) => `
              <div class="live-tape-row whale-row">
                <span class="whale-icon" title="Institutional trade">🐋</span>
                <div style="min-width:0;flex:1">
                  <div class="live-tape-market"><a href="#/market/${w.slug}">${esc(w.marketTitle)}</a></div>
                  <div class="live-tape-sub">
                    <span class="tag-side ${w.side}">${w.side.toUpperCase()}</span>
                    <span><b>${w.qty}</b> shares @ ${fmtPrice(w.price)}</span>
                    <span class="whale-val-pill">+$${w.totalValue}</span>
                  </div>
                </div>
                <div class="live-tape-time">${timeAgo(w.time)}</div>
              </div>`).join('')
            : '<div class="empty" style="padding:20px">Listening for incoming live trades…</div>'}
        </div>
      </div>
    </div>
  `;

  // Wire scanner tabs
  $$('#an-scanner-tabs button').forEach((b) => b.onclick = () => {
    $$('#an-scanner-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    const tab = b.dataset.tab;
    const cont = $('#an-scanner-content');
    if (!cont) return;
    if (tab === 'movers') cont.innerHTML = renderScannerMovers(d.topMovers);
    else if (tab === 'imbalance') cont.innerHTML = renderScannerImbalance(d.highImbalance);
    else if (tab === 'liquidity') cont.innerHTML = renderScannerLiquidity(d.mostLiquid);
  });
}

function renderScannerMovers(movers) {
  if (!movers || !movers.length) return '<div class="empty">No movers data available.</div>';
  return `<div class="tablewrap"><table class="tbl">
    <thead><tr><th>Market</th><th class="num">Last Price</th><th class="num">24h Velocity</th><th class="num">Action</th></tr></thead>
    <tbody>${movers.map((m) => `
      <tr>
        <td><a href="#/market/${m.slug}"><b>${esc(m.title)}</b></a></td>
        <td class="num"><b>${fmtPrice(m.lastPrice || 50)}</b></td>
        <td class="num"><span class="chgpill ${m.change >= 0 ? 'up' : 'down'}">${m.change >= 0 ? '▲ +' : '▼ −'}${(Math.abs(m.change) / 100).toFixed(2)}</span></td>
        <td class="num"><a class="mini-btn" href="#/market/${m.slug}">Trade →</a></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderScannerImbalance(imbalances) {
  if (!imbalances || !imbalances.length) return '<div class="empty">No imbalance data available.</div>';
  return `<div class="tablewrap"><table class="tbl">
    <thead><tr><th>Market</th><th class="num">Imbalance</th><th style="min-width:110px">Buy / Sell Pressure</th><th class="num">Action</th></tr></thead>
    <tbody>${imbalances.map((m) => `
      <tr>
        <td><a href="#/market/${m.slug}"><b>${esc(m.title)}</b></a></td>
        <td class="num"><span class="badge ${m.imbalance >= 0 ? 'live' : 'halted'}">${m.imbalance >= 0 ? '+' : ''}${m.imbalance}% ${m.imbalance >= 0 ? 'Bids' : 'Asks'}</span></td>
        <td>
          <div class="imbalance-bar-wrap" style="height:6px">
            <div class="imbalance-fill-buy" style="width:${m.buyPressurePct}%"></div>
            <div class="imbalance-fill-sell" style="width:${m.sellPressurePct}%"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:2px;font-weight:700">
            <span style="color:var(--up)">${m.buyPressurePct}%</span>
            <span style="color:var(--down)">${m.sellPressurePct}%</span>
          </div>
        </td>
        <td class="num"><a class="mini-btn" href="#/market/${m.slug}">Trade →</a></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function renderScannerLiquidity(liquid) {
  if (!liquid || !liquid.length) return '<div class="empty">No liquidity data available.</div>';
  return `<div class="tablewrap"><table class="tbl">
    <thead><tr><th>Market</th><th class="num">Rating</th><th class="num">Resting Depth</th><th class="num">Spread</th><th class="num">Action</th></tr></thead>
    <tbody>${liquid.map((m) => `
      <tr>
        <td><a href="#/market/${m.slug}"><b>${esc(m.title)}</b></a></td>
        <td class="num"><span class="badge cat" style="color:var(--accent)">Grade ${m.liquidityGrade}</span></td>
        <td class="num"><b>${fmtQty(m.totalDepth)}</b> shares</td>
        <td class="num">${m.spread !== null ? fmtPrice(m.spread) : '—'}</td>
        <td class="num"><a class="mini-btn" href="#/market/${m.slug}">Trade →</a></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

/* ================= LEARN / FAQ ================= */
function viewLearn() {
  app().innerHTML = `
    <div class="page-head"><div>
      <h2 class="page-title">How Predix works</h2>
      <p class="page-sub">Prediction markets in 60 seconds</p>
    </div></div>
    <div class="two-col section">
      <div class="card card-pad">
        <h3>${ic('book', 17)} The basics</h3>
        <div class="kv-row"><span class="k">What is a market?</span><b>A real-world question with a deadline</b></div>
        <div class="kv-row"><span class="k">What is a contract?</span><b>Pays $1.00 if your side is right</b></div>
        <div class="kv-row"><span class="k">What does the price mean?</span><b>Contract probability in dollars ($0.45 = 45% probability)</b></div>
        <div class="kv-row"><span class="k">Buy YES or NO?</span><b>Think it happens → YES. Doesn't → NO</b></div>
        <div class="kv-row"><span class="k">How do I profit?</span><b>Win $1.00/contract, or sell earlier at a better price</b></div>
      </div>
      <div class="card card-pad">
        <h3>${ic('settings', 16)} Order mechanics</h3>
        <div class="src-box" style="margin-bottom:10px"><b>Limit order</b> — trades only at your price or better; otherwise it rests on the order book until someone takes it.</div>
        <div class="src-box" style="margin-bottom:10px"><b>Market order</b> — fills immediately at the best available price. Partial fills are possible; remainders cancel.</div>
        <div class="src-box"><b>Multi-outcome markets</b> — each option (e.g. each team) has its own book. Buy the option you believe in; the winning option pays $1.</div>
      </div>
    </div>
    <div class="card card-pad section">
      <h3>${ic('helpCircle', 16)} FAQ</h3>
      <div class="faq"><b>Is this real money?</b><span>No — Predix is 100% play money. New accounts get $100 with code WELCOME100; top up with TOPUP25 / CRYPTO50 and referrals ($10 both sides).</span></div>
      <div class="faq"><b>What happens when a market resolves?</b><span>Winning shares pay $1.00 each automatically; losing shares settle at $0. Open orders are canceled and reserved funds released.</span></div>
      <div class="faq"><b>Why did my market order only partially fill?</b><span>There wasn't enough liquidity at your price. The filled part stands; the remainder is canceled — you can place another order.</span></div>
      <div class="faq"><b>How do rewards work?</b><span>You earn 1 point per $1 traded. Points climb you through Bronze → Silver → Gold → Platinum tiers with better perk rates.</span></div>
      <div class="faq"><b>Who are "MM" in the order book?</b><span>Market-maker bots that provide liquidity so the book is never empty. They trade under the same rules as everyone else.</span></div>
      <div class="faq"><b>Can I sell before resolution?</b><span>Yes — place a sell order any time while trading is open. Your P&L is locked in when it fills.</span></div>
    </div>`;
}

/* ================= AUTH ================= */
function authShell(inner) { return `<div class="auth-wrap"><div class="card auth-card">${inner}</div></div>`; }

function viewLogin() {
  app().innerHTML = authShell(`
    <h2>Welcome back</h2>
    <p class="sub">Log in to trade on Predix.</p>
    <div class="form-error" id="ferr"></div>
    <div class="auth-field"><label>Username or email</label><input id="a-id" class="input" autocomplete="username" placeholder="you@example.com" /></div>
    <div class="auth-field"><label>Password</label><input id="a-pw" class="input" type="password" autocomplete="current-password" placeholder="••••••••" /></div>
    <button class="btn-primary" id="go">Log in</button>
    <div class="auth-alt">New here? <a href="#/signup">Create an account → get $100 with promo <b>WELCOME100</b></a></div>`);
  $('#go').onclick = doLogin;
  ['#a-id', '#a-pw'].forEach((id) => { const el = $(id); el.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); }; });
  async function doLogin() {
    const ferr = $('#ferr');
    const btn = $('#go');
    if (btn.disabled) return; // no duplicate submissions
    ferr.classList.remove('show');
    if (!$('#a-id').value.trim() || !$('#a-pw').value) { ferr.textContent = 'Enter your username/email and password.'; ferr.classList.add('show'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Logging in…';
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { identifier: $('#a-id').value.trim(), password: $('#a-pw').value } });
      state.me = r.user; state.snapshot = r.snapshot;
      await refreshMe();
      toast(`Welcome back, ${r.user.username}!`);
      location.hash = '#/';
    } catch (e) {
      ferr.textContent = e.message; ferr.classList.add('show');
      btn.disabled = false; btn.textContent = old; // re-enable for retry
    }
  }
}

function viewSignup(ref) {
  const refHint = ref || '';
  app().innerHTML = authShell(`
    <h2>Create your account</h2>
    <p class="sub">Join Predix and start trading with play money.</p>
    <div class="form-error" id="ferr"></div>
    <div class="auth-field"><label>Username</label><input id="a-user" class="input" autocomplete="username" placeholder="3–24 chars: letters, numbers, _" /></div>
    <div class="auth-field"><label>Email</label><input id="a-email" class="input" type="email" autocomplete="email" placeholder="you@example.com" /></div>
    <div class="auth-field"><label>Password</label><input id="a-pw" class="input" type="password" autocomplete="new-password" placeholder="at least 8 characters" /></div>
    <div class="auth-field">
      <label>Promo code</label>
      <input id="a-promo" class="input" placeholder="WELCOME100" value="WELCOME100" />
      <div class="promo-hint">
        <span>New accounts get <b>$100.00</b> with code</span>
        <button class="apply-hint" id="apply-promo">WELCOME100</button>
      </div>
    </div>
    <div class="auth-field">
      <label>Referral code (optional)</label>
      <input id="a-ref" class="input" placeholder="Friend's username — you both get $10" value="${esc(refHint)}" />
    </div>
    <button class="btn-primary" id="go">Sign up &amp; claim bonus</button>
    <div class="auth-alt">Already have an account? <a href="#/login">Log in</a></div>`);
  $('#apply-promo').onclick = () => { $('#a-promo').value = 'WELCOME100'; };
  $('#go').onclick = doSignup;
  ['#a-user', '#a-email', '#a-pw', '#a-promo', '#a-ref'].forEach((id) => { const el = $(id); if (el) el.onkeydown = (e) => { if (e.key === 'Enter') doSignup(); }; });
  async function doSignup() {
    const ferr = $('#ferr');
    const btn = $('#go');
    if (btn.disabled) return; // no duplicate submissions (retry shows 'username taken' otherwise)
    ferr.classList.remove('show');
    if (!$('#a-user').value.trim() || !$('#a-email').value.trim() || $('#a-pw').value.length < 8) {
      ferr.textContent = 'Username and email required; password must be at least 8 characters.';
      ferr.classList.add('show'); return;
    }
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Creating account…';
    try {
      const r = await api('/api/auth/signup', {
        method: 'POST',
        body: {
          username: $('#a-user').value.trim(),
          email: $('#a-email').value.trim(),
          password: $('#a-pw').value,
          promo: $('#a-promo').value.trim(),
          ref: $('#a-ref').value.trim(),
        },
      });
      const l = await api('/api/auth/login', { method: 'POST', body: { identifier: r.user.username, password: $('#a-pw').value } });
      state.me = l.user; state.snapshot = l.snapshot;
      await refreshMe();
      let msg = 'Account created.';
      if (r.promoApplied) msg = `Welcome! $${(r.promoApplied.amount / 100).toFixed(2)} bonus applied.`;
      if (r.referral) msg += ` Referral bonus +$${(r.referral.amount / 100).toFixed(2)}.`;
      if (!r.promoApplied) msg += ' (No valid promo — redeem one in Portfolio.)';
      toast(msg);
      location.hash = '#/';
    } catch (e) {
      ferr.textContent = e.message; ferr.classList.add('show');
      const btn = $('#go'); btn.disabled = false; btn.textContent = 'Create account'; // re-enable for retry
    }
  }
}

/* ================= ADMIN ================= */
async function loadWithdrawCard() {
  const card = $('#wdraw-card');
  if (!card) return;
  let d;
  try { d = await api('/api/withdrawals'); }
  catch (e) { card.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const rows = d.withdrawals || [];
  const stPill = (s) => `<span class="wst ${s}">${s.toUpperCase()}</span>`;
  card.innerHTML = `
    <div class="wdraw-head">
      <h3 style="margin:0">${ic('banknote', 18)} Withdraw funds</h3>
      <span class="badge wdemo">${ic('gamepad', 13)} Play-money withdrawal for demonstration purposes</span>
    </div>
    <div class="wdraw-grid">
      <div>
        <div class="wdrow"><span>Available to withdraw</span><b>${fmtMoney(d.wallet.withdrawable)}</b></div>
        <div class="wdrow muted-row"><span>Reserved in open orders <small>(not withdrawable)</small></span><b>${fmtMoney(d.wallet.reserved)}</b></div>
        <div class="wdrow muted-row"><span>Held in pending withdrawals</span><b>${fmtMoney(d.wallet.withdrawReserved)}</b></div>
        <label style="display:block;margin:14px 0 6px;font-size:12px;font-weight:700;color:var(--ink-2)">Amount (USD, play money)</label>
        <input id="wd-amt" class="input" type="number" min="1" step="0.01" placeholder="e.g. 25.00" inputmode="decimal" />
        <div class="form-error" id="wd-err"></div>
        <button class="btn-primary" id="wd-go" style="width:100%;margin-top:10px">Request withdrawal</button>
        <div class="order-note" style="text-align:left">Requests are reviewed by the (simulated) admin desk. You can cancel while PENDING. No real money, UPI, bank or crypto rails are involved — this is a demo.</div>
      </div>
      <div>
        <h4 class="wd-hist-title">Withdrawal history</h4>
        ${rows.length ? `<div class="tablewrap"><table class="tbl">
          <thead><tr><th>Amount</th><th>Status</th><th>Requested</th><th>Processed</th><th></th></tr></thead>
          <tbody>${rows.map((w) => `
            <tr>
              <td class="num"><b>${fmtMoney(w.amount)}</b></td>
              <td>${stPill(w.status)}</td>
              <td>${timeAgo(w.requestedAt)}</td>
              <td>${w.processedAt ? timeAgo(w.processedAt) : '—'}${w.processedBy ? ` <span class="muted small">by ${esc(w.processedBy)}</span>` : ''}</td>
              <td>${w.status === 'pending' ? `<button class="act-btn danger" data-wdcancel="${w.id}">Cancel</button>` : ''}</td>
            </tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No withdrawals yet — your requests will appear here.</div>'}
      </div>
    </div>`;
  const err = (m) => { const el = $('#wd-err'); el.textContent = m; el.classList.add('show'); };
  const go = $('#wd-go'), amt = $('#wd-amt');
  if (!go || !amt) return; // a concurrent re-render replaced this card; the newer invocation owns it now
  go.onclick = async () => {
    const btn = go;
    const ferr = $('#wd-err'); if (ferr) ferr.classList.remove('show');
    if (btn.disabled) return;
    const dollars = parseFloat(amt.value);
    if (!Number.isFinite(dollars) || dollars <= 0) { err('Enter an amount greater than $0.'); return; }
    const cents = Math.round(dollars * 100);
    if (cents > d.wallet.withdrawable) { err(`You can withdraw up to ${fmtMoney(d.wallet.withdrawable)} (reserved trading funds are not withdrawable).`); return; }
    btn.disabled = true; btn.textContent = 'Requesting…';
    try {
      await api('/api/withdrawals', { method: 'POST', body: { amountCents: cents, idemKey: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'wd' + Date.now() } });
      toast('Withdrawal requested — pending review.');
      loadWithdrawCard(); refreshMe();
    } catch (e) {
      err(e.message);
      btn.disabled = false; btn.textContent = 'Request withdrawal';
    }
  };
  amt.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
  $$('[data-wdcancel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Cancel this pending withdrawal? Funds return to your available balance.')) return;
    try { await api('/api/withdrawals/' + b.dataset.wdcancel + '/cancel', { method: 'POST' }); toast('Withdrawal cancelled — funds returned.'); loadWithdrawCard(); refreshMe(); }
    catch (e) { toast(e.message, true); }
  });
}

async function viewAdmin() {
  if (!state.me) { location.hash = '#/login'; return; }
  if (state.me.role !== 'admin') { app().innerHTML = '<div class="empty">Admins only.</div>'; return; }
  app().innerHTML = `<div class="loading-block"><div class="spinner"></div><p>Loading admin…</p></div>`;
  let stats, markets, wds;
  try { [stats, markets, wds] = await Promise.all([api('/api/admin/stats'), api('/api/markets?sort=newest'), api('/api/admin/withdrawals')]); }
  catch (e) { app().innerHTML = errorScreen(e.message); return; }
  markets = markets.markets;

  app().innerHTML = `
    <div class="page-head"><div>
      <h2 class="page-title">${ic('settings', 22)} Admin</h2>
      <p class="page-sub">Create markets (YES/NO or multi-outcome), halt trading, resolve &amp; settle.</p>
    </div></div>

    <div class="stat-cards section">
      <div class="card stat-card"><div class="lbl">Traders</div><div class="val">${stats.users}</div></div>
      <div class="card stat-card"><div class="lbl">Markets</div><div class="val">${stats.markets}</div><div class="sub">${stats.openMarkets} open</div></div>
      <div class="card stat-card"><div class="lbl">Open orders</div><div class="val">${stats.openOrders}</div></div>
      <div class="card stat-card"><div class="lbl">Trades (all time)</div><div class="val">${fmtQty(stats.trades)}</div></div>
      <div class="card stat-card"><div class="lbl">24h volume</div><div class="val">${fmtQty(stats.vol24)}</div><div class="sub">shares</div></div>
      <div class="card stat-card"><div class="lbl">Cash in system</div><div class="val">${fmtMoney0(stats.cashInSystem)}</div></div>
    </div>

    <div class="card card-pad section">
      <h3>Create market</h3>
      <div class="form-grid">
        <div class="wide"><label>Title (question)</label><input id="nm-title" class="input" placeholder="Will X happen by Y?" /></div>
        <div><label>Emoji (legacy — lists use category icons)</label><input id="nm-emoji" class="input" value="" maxlength="4" /></div>
        <div><label>Category</label><select id="nm-cat" class="input">${['Politics', 'Economics', 'Crypto', 'Sports', 'Tech', 'Entertainment', 'Science', 'Weather'].map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div><label>Closing date &amp; time</label><input id="nm-close" class="input" type="datetime-local" /></div>
        <div><label>Starting probability % <span class="muted">(YES/NO markets)</span></label><input id="nm-base" class="input" type="number" min="5" max="95" value="50" /></div>
        <div class="wide"><label>Options <span class="muted">(empty = YES/NO · or 3–8 comma-separated options for multi-outcome)</span></label><input id="nm-opts" class="input" placeholder="e.g. Mumbai Indians, CSK, RCB, Another team" /></div>
        <div class="wide"><label>Description</label><textarea id="nm-desc" class="input"></textarea></div>
        <div class="wide"><label>Resolution source</label><input id="nm-src" class="input" placeholder="e.g. Official FOMC statement" /></div>
        <div class="wide"><label>Resolution rules</label><textarea id="nm-rules" class="input" placeholder="Unambiguous rules…"></textarea></div>
        <div class="wide" style="border-top:1px solid var(--line);padding-top:12px">
          <label>Data feed <span class="muted">(optional — external reference data + resolution proposal)</span></label>
          <select id="nm-fp" class="input" style="max-width:340px">
            <option value="">None — resolve manually</option>
            <option value="coingecko">CoinGecko · crypto price (BTC / ETH)</option>
            <option value="open-meteo">Open-Meteo · weather (temperature / precipitation)</option>
          </select>
          <div id="nm-feed-crypto" style="display:none;margin-top:8px">
            <select id="nm-fa" class="input" style="max-width:280px">
              <option value="bitcoin">₿ Bitcoin (BTC)</option>
              <option value="ethereum">Ξ Ethereum (ETH)</option>
            </select>
          </div>
          <div id="nm-feed-weather" style="display:none;margin-top:8px">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="nm-wloc" class="input" placeholder="City / location label (e.g. Pune)" style="flex:2;min-width:150px" />
              <input id="nm-wlat" class="input" type="number" step="any" min="-90" max="90" placeholder="Latitude (e.g. 18.52)" style="flex:1;min-width:140px" />
              <input id="nm-wlon" class="input" type="number" step="any" min="-180" max="180" placeholder="Longitude (e.g. 73.86)" style="flex:1;min-width:140px" />
              <select id="nm-wmetric" class="input" style="max-width:180px">
                <option value="temperature">Temperature</option>
                <option value="precipitation">Precipitation</option>
              </select>
              <select id="nm-wunit" class="input" style="max-width:110px"></select>
            </div>
          </div>
          <div id="nm-feed-common" style="display:none;margin-top:8px">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <select id="nm-fop" class="input" style="max-width:84px" title="Comparison operator">
                <option value=">=">≥</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option>
              </select>
              <input id="nm-ftv" class="input" type="number" step="any" placeholder="Target value (e.g. 100000 or 25)" style="flex:1;min-width:160px" />
            </div>
          </div>
          <div class="muted small" style="margin-top:6px" id="nm-feed-note">If set, the market shows live external data + a LIVE/STALE badge and, at resolution time, generates a proposal from it. Admin confirmation is still required before settlement; probabilities always come from trading.</div>
        </div>
        <div class="wide"><button class="btn-primary" id="nm-go" style="margin:0">Create market</button></div>
      </div>
    </div>

    <div class="card card-pad section">
      <h3>Markets</h3>
      <div class="tablewrap"><table class="tbl">
        <thead><tr><th>Market</th><th>Status</th><th class="num">Last</th><th class="num">Vol 24h</th><th>Actions</th></tr></thead>
        <tbody>${markets.map((m) => `
          <tr>
            <td><a href="#/market/${m.slug}">${esc(m.title)}</a>${m.multi ? ` <span class="badge cat">${m.outcomes.length} options</span>` : ''}${m.feed ? ` <span class="badge cat feed-chip" title="${esc(m.feed.kind === 'weather' ? (m.feed.location ? m.feed.location + ' · ' : '') + m.feed.latLonText : m.feed.label + ' price feed')}">${m.feed.kind === 'weather' ? `${ic(m.feed.metric === 'precipitation' ? 'cloudRain' : 'thermometer', 13)} ${m.feed.metricLabel} ${m.feed.operatorText} ${m.feed.targetText}` : `${ic('bitcoin', 13)} ${m.feed.symbol} ${m.feed.operatorText} ${m.feed.targetText || ('$' + Number(m.feed.targetValue).toLocaleString('en-US'))}`}</span>${m.feedProposal && m.feedProposal.state === 'ready' ? ` <span class="badge resolved-yes">${m.feedProposal.outcome === 'yes' ? 'YES' : 'NO'} @ ${m.feedProposal.valueText || ('$' + Number(m.feedProposal.value).toLocaleString('en-US'))}</span>` : m.feedProposal && m.feedProposal.state === 'blocked' ? ' <span class="badge cat" style="color:var(--red)">blocked (' + esc(m.feedProposal.reason) + ')</span>' : ''}` : ''}<div class="muted small">closes ${fmtClock(m.closeTime)}</div></td>
            <td><span class="status-pill ${m.status}">${m.status}</span>${m.status === 'resolved' && m.multi ? ` <b>#${(m.winnerIdx + 1)} wins</b>` : (m.outcome ? ` <b class="${m.outcome === 'yes' ? 'up' : 'down'}">${m.outcome.toUpperCase()}</b>` : '')}</td>
            <td class="num">${fmtCents(m.last)}</td>
            <td class="num">${fmtQty(m.vol24 || 0)}</td>
            <td>
              <div class="act-row">
                ${m.status === 'open' ? `<button class="act-btn danger" data-halt="${m.id}">Halt</button>` : ''}
                ${m.status === 'halted' ? `<button class="act-btn" data-open="${m.id}">Reopen</button>` : ''}
                ${m.feed && m.status !== 'resolved' ? `<button class="act-btn" data-feedrf="${m.id}" title="Force-refresh the CoinGecko price + proposal">↻ Feed</button>` : ''}
                ${m.feed && m.status !== 'resolved' ? `<button class="act-btn resolve-yes" data-resfeed="${m.id}">Resolve per feed</button>` : ''}
                ${m.status !== 'resolved' ? (m.multi
                  ? `<button class="act-btn resolve-yes" data-res="${m.id}" data-multi="1">Resolve (pick winner)</button>`
                  : `<button class="act-btn resolve-yes" data-res="${m.id}" data-o="yes">Resolve YES</button>
                     <button class="act-btn resolve-no" data-res="${m.id}" data-o="no">Resolve NO</button>`) : `<span class="muted small">settled ${ic('check', 11)}</span>`}
              </div>
            </td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>

    <div class="card card-pad section">
      <h3>${ic('banknote', 18)} Withdrawal desk</h3>
      <p class="muted small" style="margin-top:-6px">Play-money withdrawal requests — approve then complete to pay out, or reject to refund. <b>Simulated only</b>; no real payments are ever made.</p>
      <div class="wdraw-admin-counts">${['pending', 'approved', 'completed', 'rejected', 'cancelled'].map((s) => `<span class="badge wst-badge ${s}">${s} ${(wds.counts || {})[s] || 0}</span>`).join('')}</div>
      ${(wds.withdrawals || []).length ? `<div class="tablewrap"><table class="tbl">
        <thead><tr><th>#</th><th>Trader</th><th class="num">Amount</th><th>Status</th><th>Requested</th><th>Actions</th></tr></thead>
        <tbody>${wds.withdrawals.map((w) => `
          <tr>
            <td class="muted">${w.id}</td>
            <td><b>${esc(w.username)}</b></td>
            <td class="num"><b>${fmtMoney(w.amount)}</b></td>
            <td><span class="wst ${w.status}">${w.statusText}</span>${w.note ? `<div class="muted small">“${esc(w.note)}”</div>` : ''}</td>
            <td>${timeAgo(w.requestedAt)}</td>
            <td>
              <div class="act-row">
                ${w.status === 'pending' ? `<button class="act-btn resolve-yes" data-wda="approve" data-wd="${w.id}">Approve</button>
                   <button class="act-btn resolve-no" data-wda="reject" data-wd="${w.id}">Reject</button>` : ''}
                ${w.status === 'approved' ? `<button class="act-btn resolve-yes" data-wda="complete" data-wd="${w.id}">Mark paid</button>
                   <button class="act-btn resolve-no" data-wda="reject" data-wd="${w.id}">Reject</button>` : ''}
                ${w.status === 'completed' ? `<span class="muted small">paid ${ic('check', 11)}</span>` : ''}
                ${(w.status === 'rejected' || w.status === 'cancelled') ? `<span class="muted small">refunded ${ic('check', 11)}</span>` : ''}
              </div>
            </td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No withdrawal requests yet.</div>'}
    </div>`;

  $$('[data-wda]').forEach((b) => b.onclick = async () => {
    const act = b.dataset.wda;
    let note = '';
    if (act === 'reject') { note = prompt('Reason for rejection (shown to the trader, optional):') || ''; }
    if (act === 'approve' && !confirm('Approve this withdrawal?')) return;
    if (act === 'complete' && !confirm('Mark as PAID? This finalizes the payout through the ledger (play money).')) return;
    try { await api('/api/admin/withdrawals/' + b.dataset.wd + '/' + act, { method: 'POST', body: { note } }); toast('Withdrawal ' + (act === 'approve' ? 'approved' : act === 'reject' ? 'rejected & refunded' : 'completed') + '.'); viewAdmin(); }
    catch (e) { toast(e.message, true); }
  });

  // data-feed section toggling (CoinGecko / Open-Meteo)
  const WX_UNITS = { temperature: [['celsius', '°C'], ['fahrenheit', '°F']], precipitation: [['mm', 'mm'], ['inch', 'in']] };
  const syncFeedForm = () => {
    const prov = $('#nm-fp').value;
    $('#nm-feed-crypto').style.display = prov === 'coingecko' ? '' : 'none';
    $('#nm-feed-weather').style.display = prov === 'open-meteo' ? '' : 'none';
    $('#nm-feed-common').style.display = prov ? '' : 'none';
    if (prov === 'coingecko') $('#nm-ftv').placeholder = 'Target $ (e.g. 100000)';
    else if (prov === 'open-meteo') $('#nm-ftv').placeholder = $('#nm-wmetric').value === 'temperature' ? 'Target ° (e.g. 25)' : 'Target mm (e.g. 5)';
  };
  const syncWxUnits = () => {
    const m = $('#nm-wmetric').value;
    $('#nm-wunit').innerHTML = WX_UNITS[m].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    syncFeedForm();
  };
  $('#nm-fp').onchange = syncFeedForm;
  $('#nm-wmetric').onchange = syncWxUnits;
  syncWxUnits();

  $('#nm-go').onclick = async () => {
    const closeRaw = $('#nm-close').value;
    const closeTime = closeRaw ? new Date(closeRaw).getTime() : NaN;
    const optsRaw = $('#nm-opts').value.trim();
    const outcomes = optsRaw ? optsRaw.split(',').map((s) => s.trim()).filter(Boolean) : null;
    if (outcomes && outcomes.length < 3) { toast('Multi-outcome markets need at least 3 options (or leave empty for YES/NO).', true); return; }
    const fProv = $('#nm-fp') ? $('#nm-fp').value : '';
    let feed;
    if (fProv === 'coingecko') {
      feed = { assetId: $('#nm-fa').value, currency: 'usd', operator: $('#nm-fop').value, targetValue: parseFloat($('#nm-ftv').value) };
      if (!feed.assetId) { toast('Feed: pick a crypto asset.', true); return; }
      if (!(feed.targetValue > 0)) { toast('Feed: enter a positive target price (e.g. 100000).', true); return; }
    } else if (fProv === 'open-meteo') {
      feed = {
        provider: 'open-meteo',
        location: $('#nm-wloc').value.trim(),
        latitude: parseFloat($('#nm-wlat').value), longitude: parseFloat($('#nm-wlon').value),
        metric: $('#nm-wmetric').value, unit: $('#nm-wunit').value,
        operator: $('#nm-fop').value, targetValue: parseFloat($('#nm-ftv').value),
      };
      if (!Number.isFinite(feed.latitude) || feed.latitude < -90 || feed.latitude > 90) { toast('Feed: latitude must be between -90 and 90.', true); return; }
      if (!Number.isFinite(feed.longitude) || feed.longitude < -180 || feed.longitude > 180) { toast('Feed: longitude must be between -180 and 180.', true); return; }
      if (!Number.isFinite(feed.targetValue) || (feed.metric === 'precipitation' && feed.targetValue < 0)) { toast('Feed: enter a valid target value.', true); return; }
    }
    try {
      await api('/api/admin/markets', {
        method: 'POST',
        body: {
          title: $('#nm-title').value, emoji: $('#nm-emoji').value, category: $('#nm-cat').value,
          closeTime, baseProb: +$('#nm-base').value, description: $('#nm-desc').value,
          outcomes: outcomes && outcomes.length >= 3 ? outcomes : undefined,
          resolutionSource: $('#nm-src').value, resolutionRules: $('#nm-rules').value,
          feed,
        },
      });
      toast('Market created — market makers will quote it shortly.');
      viewAdmin();
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-halt]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/admin/markets/${b.dataset.halt}/halt`, { method: 'POST', body: { action: 'halt' } }); toast('Trading halted.'); viewAdmin(); }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-open]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/admin/markets/${b.dataset.open}/open`, { method: 'POST', body: { action: 'open' } }); toast('Market reopened.'); viewAdmin(); }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-res]').forEach((b) => b.onclick = async () => {
    const isMulti = b.dataset.multi === '1';
    let body;
    if (isMulti) {
      const n = prompt('Multi-outcome market. Enter the WINNING option number (1 = first option, 2 = second, …):');
      if (n === null) return;
      const idx = Number(n) - 1;
      if (!Number.isInteger(idx) || idx < 0) { toast('Enter a valid option number.', true); return; }
      body = { outcomeIdx: idx };
    } else {
      if (!confirm(`Propose resolving this market as ${b.dataset.o.toUpperCase()}? You'll confirm with a payout preview next.`)) return;
      body = { outcome: b.dataset.o };
    }
    const ev = prompt('Evidence / reference justifying this outcome (required — stored publicly and hashed):');
    if (ev === null || !ev.trim()) { toast('Evidence is required to resolve a market.', true); return; }
    body.evidence = ev.trim();
    const nt = prompt('Optional notes for the resolution record:');
    if (nt !== null && nt.trim()) body.notes = nt.trim();
    const url = `/api/admin/markets/${b.dataset.res}/resolve`;
    const call = (extra) => api(url, { method: 'POST', body: { ...body, ...extra } });
    try {
      let prev;
      try { prev = await call({ confirm: false }); }
      catch (e) {
        if (/force/.test(e.message) && confirm('Market is still trading. Force an EMERGENCY resolution?')) {
          prev = await call({ confirm: false, force: true });
        } else throw e;
      }
      if (prev.confirmationRequired) {
        const p = prev.proposal.preview;
        const go = confirm(`CONFIRM RESOLUTION\n\nOutcome: ${prev.proposal.outcome}\nWinning shares: ${p.winningQty}\nTotal payout: $${(p.payout / 100).toFixed(2)}\nHolders: ${p.holders}\nEvidence: ${body.evidence.slice(0, 90)}\n\nThis is final, publicly auditable, and settles immediately.`);
        if (!go) { toast('Resolution canceled — nothing was written.'); return; }
        await call({ confirm: true, force: prev.proposal.force || undefined });
      }
      toast('Resolved — settlement complete & audit record stored.'); viewAdmin();
    }
    catch (e) { toast(e.message, true); }
  });
  $$('[data-feedrf]').forEach((b) => b.onclick = async () => {
    try {
      const r = await api(`/api/admin/markets/${b.dataset.feedrf}/feed-refresh`, { method: 'POST', body: {} });
      const p = r.feedProposal;
      toast(p && p.state === 'ready'
        ? `Feed: ${p.outcome.toUpperCase()} proposal — ${p.valueText || ('$' + Number(p.value).toLocaleString('en-US'))} ${p.operatorText} ${p.targetText || ('$' + Number(p.targetValue).toLocaleString('en-US'))}`
        : p && p.state === 'blocked' ? `Feed proposal BLOCKED — ${p.reason}. Auto-resolution stays blocked.` : 'Feed refreshed — proposal generates at resolution time.');
      viewAdmin();
    } catch (e) { toast(e.message, true); }
  });
  $$('[data-resfeed]').forEach((b) => b.onclick = async () => {
    let r;
    try { r = await api(`/api/admin/markets/${b.dataset.resfeed}/feed-refresh`, { method: 'POST', body: {} }); }
    catch (e) { toast(e.message, true); return; }
    const p = r.feedProposal;
    if (!p || p.state !== 'ready') {
      toast(p && p.state === 'blocked'
        ? `Feed proposal blocked: ${p.reason} — auto-resolution stays blocked until fresh data is available.`
        : 'Feed proposal not ready yet (resolution time not reached).', true);
      return;
    }
    if (!confirm(`Resolve per external feed (${p.source})?\n\nOutcome: ${p.outcome.toUpperCase()}\n${p.valueText || ('$' + Number(p.value).toLocaleString('en-US'))} ${p.operatorText} ${p.targetText || ('$' + Number(p.targetValue).toLocaleString('en-US'))}\nEvidence will be stored: ${p.evidence.slice(0, 120)}…\n\nYou'll confirm with a payout preview next.`)) return;
    const body = { outcome: p.outcome, evidence: p.evidence, notes: `Resolved per ${p.source || 'external'} feed proposal (evidence auto-generated: source, value, timestamp).` };
    const url = `/api/admin/markets/${b.dataset.resfeed}/resolve`;
    const call = (extra) => api(url, { method: 'POST', body: { ...body, ...extra } });
    try {
      let prev;
      try { prev = await call({ confirm: false }); }
      catch (e) {
        if (/force/.test(e.message) && confirm('Market is still trading. Force an EMERGENCY resolution?')) prev = await call({ confirm: false, force: true });
        else throw e;
      }
      if (prev.confirmationRequired) {
        const pv = prev.proposal.preview;
        const go = confirm(`CONFIRM RESOLUTION\n\nOutcome: ${prev.proposal.outcome}\nWinning shares: ${pv.winningQty}\nTotal payout: $${(pv.payout / 100).toFixed(2)}\nHolders: ${pv.holders}\nEvidence: ${p.evidence.slice(0, 110)}\n\nThis is final, publicly auditable, and settles immediately.`);
        if (!go) { toast('Resolution canceled — nothing was written.'); return; }
        await call({ confirm: true, force: prev.proposal.force || undefined });
      }
      toast('Resolved per feed — settlement complete & audit record stored.');
      viewAdmin();
    } catch (e) { toast(e.message, true); }
  });
}

/* ================= live updates (SSE) ================= */
function connectSSE() {
  if (state.es) { state.es.close(); }
  const es = new EventSource('/api/events');
  state.es = es;

  es.addEventListener('init', (ev) => {
    const d = JSON.parse(ev.data);
    if (d.me) { state.me = d.me; state.snapshot = d.snapshot; }
    (d.markets || []).forEach((m) => upsertMarket(m));
    renderHeader();
    buildTicker();
  });
  es.addEventListener('mkt', (ev) => {
    const m = JSON.parse(ev.data);
    upsertMarket(m);
    const h = location.hash.split('?')[0];
    if (h === '#/' || h === '' || h === '#/trending' || h === '#/new' || h === '#/closing' || h.startsWith('#/c/')) refreshHomeCards();
    if (h.startsWith('#/market/') && state.detail && state.detail.slug === m.slug) refreshMarketHeader(m);
  });
  es.addEventListener('book', (ev) => {
    const b = JSON.parse(ev.data);
    if (location.hash.startsWith('#/market/') && state.detail && state.detail.slug === b.slug
        && (!state.detail.multi || (b.outcomeIdx || 0) === state.selOutcome)) {
      state.book = { bids: b.bids, asks: b.asks };
      const box = $('#bookbox');
      if (box) { box.innerHTML = bookHTML(state.book); wireBookClicks(); }
      updateMarketStats();
    }
  });
  es.addEventListener('trade', (ev) => {
    const t = JSON.parse(ev.data);
    const sp = state.sparks.get(t.slug);
    if (sp) { sp.push(t.price); if (sp.length > 72) sp.shift(); }
    const isMulti = state.detail && state.detail.slug === t.slug && state.detail.multi;
    const hk = isMulti ? t.slug + ':' + (t.outcomeIdx || 0) : t.slug;
    const h = state.hist.get(hk);
    if (h) { h.push([t.ts, t.price]); if (h.length > 4200) h.splice(0, h.length - 4200); }
    if (location.hash.startsWith('#/market/') && state.detail && state.detail.slug === t.slug
        && (!isMulti || (t.outcomeIdx || 0) === state.selOutcome)) {
      const box = $('#tradesbox');
      if (box && state.detail) {
        state.detail.trades = [{ id: 'live' + t.ts, price: t.price, qty: t.qty, ts: t.ts, takerKind: t.takerKind, outcomeIdx: t.outcomeIdx || 0, taker: t.taker, maker: t.maker }, ...(state.detail.trades || [])].slice(0, 50);
        const prevScroll = box.scrollTop;
        box.innerHTML = tradesHTML(state.detail.trades);
        if (prevScroll > 15) box.scrollTop = prevScroll;
        const cnt = $('#trades-count');
        if (cnt) cnt.textContent = `${state.detail.trades.length} trades`;
      }
      updateMarketStats();
      const wrap = $('#chartwrap');
      if (wrap) {
        wrap.querySelector('svg') && wrap.querySelector('svg').remove();
        wrap.insertAdjacentHTML('afterbegin', priceChart(state.hist.get(hk) || [], state.chartRange));
        wireChartHover();
      }
    }

    // append to live analytics tape if active
    if (location.hash === '#/analytics') {
      const tape = $('#live-tape-list');
      if (tape) {
        const isWhale = (t.qty || 0) >= 40 || ((t.price || 0) * (t.qty || 0)) >= 2000;
        const row = document.createElement('div');
        row.className = 'live-tape-row' + (isWhale ? ' whale-row' : '');
        row.innerHTML = `
          <span class="whale-icon">${isWhale ? '🐋' : '⚡'}</span>
          <div style="min-width:0;flex:1">
            <div class="live-tape-market"><a href="#/market/${t.slug}">${esc(t.marketTitle || t.slug)}</a></div>
            <div class="live-tape-sub">
              <span class="tag-side ${t.price >= 50 ? 'yes' : 'no'}">${t.price >= 50 ? 'YES' : 'NO'}</span>
              <span><b>${t.qty}</b> shares @ ${fmtPrice(t.price)}</span>
              <span class="whale-val-pill">+$${((t.price * t.qty) / 100).toFixed(2)}</span>
            </div>
          </div>
          <div class="live-tape-time">just now</div>`;
        tape.insertBefore(row, tape.firstChild);
        const rows = tape.querySelectorAll('.live-tape-row');
        if (rows.length > 25) rows[rows.length - 1].remove();
      }
    }
  });
  es.addEventListener('comment', (ev) => {
    const c = JSON.parse(ev.data);
    if (location.hash.startsWith('#/market/') && state.detail && state.detail.slug === c.slug) {
      state.comments = [c.comment, ...state.comments];
      const list = $('#comment-list');
      if (list) list.innerHTML = commentsHTML();
    }
  });
  es.addEventListener('user', (ev) => {
    const d = JSON.parse(ev.data);
    state.snapshot = d;
    renderHeader();
    const h = location.hash.split('?')[0];
    if (h === '#/portfolio') viewPortfolio();
    if (h.startsWith('#/market/') && state.detail) {
      const pb = $('#posbox'); if (pb) pb.innerHTML = positionHTML(state.detail);
      const ob = $('#myordersbox'); if (ob) ob.innerHTML = myOrdersHTML(state.detail);
      const ac = $('#activity-card');
      if (ac) {
        ac.outerHTML = marketActivityHTML(state.detail, state.marketActivityTab);
        wireActivityTabs(state.detail);
      }
      wireCancelButtons();
    }
  });
  es.addEventListener('notify', (ev) => {
    const n = JSON.parse(ev.data);
    state.unread++;
    renderHeader();
    toast(n.title);
  });
}

function refreshHomeCards() {
  if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) return;
  const statusFilter = state.statusFilter || 'active';
  const openMarkets = state.markets.filter((m) => m.status === 'open');
  const resolvedMarkets = state.markets.filter((m) => m.status === 'resolved');

  const grid = $('#grid');
  if (grid) {
    let displayOpen = openMarkets;
    if (statusFilter === 'resolved') displayOpen = [];
    grid.innerHTML = displayOpen.map((m) => marketCard(state.byslug.get(m.slug) || m)).join('')
      || (statusFilter === 'active' ? '<div class="empty">No active markets match your criteria.</div>' : '');
  }

  const resSec = $('#resolved-section');
  if (resSec) {
    const resGrid = resSec.querySelector('.grid-markets');
    if (resGrid) {
      resGrid.innerHTML = resolvedMarkets.map((m) => marketCard(state.byslug.get(m.slug) || m)).join('');
    }
  }

  const mgrid = $('#mgrid');
  if (mgrid) {
    mgrid.innerHTML = state.markets.map((m) => marketCard(state.byslug.get(m.slug) || m)).join('')
      || '<div class="empty">No markets match your search.</div>';
  }
  wireStars();
}

window.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    const s = $('#search');
    if (s) { e.preventDefault(); s.focus(); }
  }
});

function refreshMarketHeader(m) {
  const multi = state.detail && state.detail.multi;
  const last = $('#mk-last');
  const opt = multi && m.outcomes ? m.outcomes[state.selOutcome] : null;
  if (last) {
    if (!multi) last.innerHTML = `${m.last === null ? '—' : fmtPrice(m.last)} <small>YES · ${fmtPct(m.last)}</small>`;
    else if (opt) last.innerHTML = `${opt.last === null || opt.last === undefined ? '—' : fmtPrice(opt.last)} <small>${esc(opt.label)} · ${fmtPct(opt.last)}</small>`;
  }
  updateMarketStats();
}

function wireCancelButtons() {
  $$('[data-cancel]').forEach((b) => b.onclick = async () => {
    try {
      await api('/api/orders/' + b.dataset.cancel + '/cancel', { method: 'POST' });
      toast('Order canceled.');
      if (location.hash.startsWith('#/market/') && state.detail) {
        viewMarket(state.detail.slug);
      } else if (location.hash === '#/portfolio') {
        viewPortfolio();
      } else {
        refreshMe();
      }
    } catch (e) {
      toast(e.message, true);
    }
  });
}

async function refreshMe() {
  try {
    const r = await api('/api/me');
    state.me = r.user;
    if (r.snapshot) state.snapshot = r.snapshot;
    state.rewards = r.rewards || null;
    state.unread = r.unread || 0;
    state.watching = r.watching || 0;
    if (state.me) {
      try {
        const w = await api('/api/watchlist');
        state.watchSet = new Set(w.markets.map((m) => m.id));
      } catch { state.watchSet = new Set(); }
    }
    renderHeader();
  } catch {}
}

/* ---------- theme (dark mode) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('predix-theme', t); } catch {}
  const btn = $('#theme-btn');
  if (btn) btn.innerHTML = t === 'dark' ? ic('sun', 17) : ic('moon', 17);
}
function toggleTheme() {
  applyTheme((document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark');
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('predix-theme'); } catch {}
  if (!t) t = 'dark'; // deep-navy dark is the primary Predix experience
  applyTheme(t);
})();

/* ---------- global chrome wiring ---------- */
if ($('#theme-btn')) $('#theme-btn').onclick = toggleTheme;
if ($('#drawer-theme-btn')) $('#drawer-theme-btn').onclick = toggleTheme;

const toggleSidebar = () => {
  $('#sidebar')?.classList.toggle('open');
  $('#sidebar-backdrop')?.classList.toggle('show');
};
if ($('#hamburger')) $('#hamburger').onclick = toggleSidebar;
if ($('#mobile-menu-btn')) $('#mobile-menu-btn').onclick = toggleSidebar;

const sbd = $('#sidebar-backdrop');
if (sbd) sbd.onclick = () => {
  $('#sidebar')?.classList.remove('open');
  $('#sidebar-backdrop')?.classList.remove('show');
};

const mobSearchToggle = $('#mobile-search-toggle');
if (mobSearchToggle) {
  mobSearchToggle.onclick = () => {
    const sw = $('.searchwrap');
    if (sw) {
      sw.classList.toggle('mobile-open');
      if (sw.classList.contains('mobile-open')) {
        const inp = $('#search');
        if (inp) { inp.focus(); }
      }
    }
  };
}
document.addEventListener('click', (e) => {
  const panel = $('#notif-panel');
  if (panel && panel.classList.contains('open') && !panel.contains(e.target) && e.target.id !== 'bell-btn' && !$('#bell-btn')?.contains(e.target)) {
    closeNotifPanel();
  }
  const sw = $('.searchwrap');
  const mobToggle = $('#mobile-search-toggle');
  if (sw && sw.classList.contains('mobile-open')) {
    if (!sw.contains(e.target) && e.target.id !== 'mobile-search-toggle' && !mobToggle?.contains(e.target)) {
      sw.classList.remove('mobile-open');
    }
  }
});

/* ---------- search ---------- */
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    const h = location.hash.split('?')[0];
    const homeHashes = ['#/', '', '#/trending', '#/new', '#/closing'];
    if (!homeHashes.includes(h) && !h.startsWith('#/c/')) location.hash = '#/';
    else viewHome(h.startsWith('#/c/') ? 'category' : 'home', h.startsWith('#/c/') ? decodeURIComponent(h.slice(4)) : undefined);
  }, 250);
});

/* ---------- boot ---------- */
(function boot() {
  let firstAuth = true;
  route();                       // paint the UI immediately…
  refreshMe().catch(() => {}).then(() => {
    renderHeader();
    if (firstAuth && (location.hash === '#/' || location.hash === '' || location.hash === '#/watchlist')) route();
    firstAuth = false;
  });
  connectSSE();
  startTicker();
  window.addEventListener('online', () => { if (/trouble loading/i.test($('#app').textContent || '')) location.reload(); });
})();
