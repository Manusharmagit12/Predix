/* Market Detail (pro trading UI) e2e — needs the server running on :3000 and `npm i jsdom`.
   Run:  node tests/md.test.js   */
const { JSDOM } = require('jsdom');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = process.env.PREDIX_TEST_BASE_URL || 'http://127.0.0.1:3000';
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const ok = (cond, name) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};

// ---- real HTTP client with cookie jar (backs the jsdom fetch shim) ----
const jar = new Map(); // name -> value
const cookieHeader = () => [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const r = http.request(BASE + p, {
      method,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
        ...(jar.size ? { cookie: cookieHeader() } : {}),
      },
    }, (res) => {
      (res.headers['set-cookie'] || []).forEach((c) => {
        const [kv] = c.split(';'); const i = kv.indexOf('=');
        jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
      });
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => resolve({ status: res.statusCode, text: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ---- build the jsdom window with shims (app.js runs as a REAL inline script so
//      its top-level consts persist in the global lexical env) ----
function makeWindow() {
  const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
    .replace('</body>', () => '<script>' + appJs + '</script></body>'); // fn: don't interpret $ patterns
  const dom = new JSDOM(html, {
    url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url, opts = {}) => {
        const u = new URL(String(url), BASE);
        return req(opts.method || 'GET', u.pathname + u.search, opts.body).then((r) => ({
          ok: r.status < 400, status: r.status,
          json: async () => JSON.parse(r.text), text: async () => r.text,
        }));
      };
      window.AbortController = AbortController;
      window.EventSource = class { constructor() {} close() {} addEventListener() {} };
      window.scrollTo = () => {};
      window.onerror = (msg) => { failed++; console.log('  ✗ JS error: ' + msg); };
    },
  });
  return { dom, w: dom.window };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000, step = 60) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
  return null;
}

(async () => {
  // ---- server up? ----
  let ping = null;
  try { ping = await req('GET', '/api/stats'); } catch { /* server down */ }
  if (!ping || ping.status !== 200) { console.log('SKIPPED — server not running on :3000 (start it with `npm start` to run this suite)'); process.exit(0); }

  // ---- provision a fresh trader (real API, real promo credit) ----
  const uname = 'md_test_' + Date.now();
  const su = await req('POST', '/api/auth/signup', { username: uname, email: uname + '@test.local', password: 'supersecret1', promo: 'WELCOME100' });
  ok(su.status === 201, 'signup ' + uname + ' + WELCOME100 credit via API');
  const login = await req('POST', '/api/auth/login', { identifier: uname, password: 'supersecret1' });
  ok(login.status === 200, 'login creates session (cookie in jar)');

  // ---- boot the app ----
  const { dom, w } = makeWindow();
  await waitFor(() => w.document.querySelectorAll('#grid .card, .mcard, #grid [class*=card]').length > 0);
  ok(w.document.body.innerHTML.length > 5000, 'app boots, home renders');

  // wait for /api/me (cookie already in jar → logged in)
  await waitFor(() => w.eval('typeof state !== "undefined" && !!state.me'));
  ok(!!w.eval('state.me'), 'session restored from cookie');

  // ---- pick a real open binary market with quotes ----
  const mkts = JSON.parse((await req('GET', '/api/markets')).text).markets;
  const binary = mkts.find((m) => !m.multi && m.status === 'open');
  ok(!!binary, 'seed has an open binary market: ' + (binary && binary.slug));

  const slug = binary.slug;
  const bookApi = JSON.parse((await req('GET', '/api/markets/' + slug)).text).book;
  const bestBid = bookApi.bids && bookApi.bids[0] ? bookApi.bids[0].price : null;
  const bestAsk = bookApi.asks && bookApi.asks[0] ? bookApi.asks[0].price : null;

  // ---- open the market page ----
  w.location.hash = '#/market/' + slug;
  await sleep(150);
  w.eval('typeof viewMarket === "function" && viewMarket(' + JSON.stringify(slug) + ')');
  await waitFor(() => w.document.querySelector('#stat-strip'));
  ok(!!w.document.querySelector('#stat-strip'), 'stat strip renders');

  await waitFor(() => /\d/.test(w.document.querySelector('#st-bid')?.textContent || ''));
  const bidTxt = w.document.querySelector('#st-bid').textContent;
  const askTxt = w.document.querySelector('#st-ask').textContent;
  const spreadTxt = w.document.querySelector('#st-spread').textContent;
  const midTxt = w.document.querySelector('#st-mid').textContent;
  const expBid = '$' + (bestBid / 100).toFixed(2);
  const expAsk = '$' + (bestAsk / 100).toFixed(2);
  const expSpread = '$' + ((bestAsk - bestBid) / 100).toFixed(2);
  ok(bidTxt === expBid || bidTxt === bestBid + '¢', `best bid matches book API (${bidTxt} vs ${expBid})`);
  ok(askTxt === expAsk || askTxt === bestAsk + '¢', `best ask matches book API (${askTxt} vs ${expAsk})`);
  ok(spreadTxt === expSpread || spreadTxt === (bestAsk - bestBid) + '¢', `spread computed (${spreadTxt})`);
  ok(/(?:\$0\.\d{2}|\d+¢) · \d+%/.test(midTxt), 'mid shows price + probability (' + midTxt + ')');
  ok(/\$|\d/.test(w.document.querySelector('#st-liq')?.textContent || ''), 'liquidity tile populated');

  // ---- stacked order book ----
  ok(!!w.document.querySelector('#bookbox .book-stack'), 'stacked book renders');
  ok(/Spread/.test(w.document.querySelector('.book-spread')?.textContent || ''), 'spread row between asks and bids');
  ok(w.document.querySelectorAll('#bookbox .book-row').length > 0, 'book rows present');
  ok(!!w.document.querySelector('#bookbox .book-row .q') && !!w.document.querySelector('#bookbox .book-row .c'), 'qty + cumulative columns');

  // ---- YES/NO toggle mirrors prices ----
  const bidYes = bidTxt;
  w.document.querySelector('#book-side button[data-bs="no"]').click();
  await sleep(120);
  const bidNo = w.document.querySelector('#st-bid').textContent;
  const expBidNo = '$' + ((100 - bestAsk) / 100).toFixed(2);
  ok(bidNo === expBidNo || bidNo === (100 - bestAsk) + '¢', `NO view mirrors prices (NO bid ${bidNo} = 100 − YES ask ${bestAsk})`);
  w.document.querySelector('#book-side button[data-bs="yes"]').click();
  await sleep(120);
  ok(w.document.querySelector('#st-bid').textContent === bidYes, 'YES view restores');

  // ---- resolution card ----
  ok(w.document.querySelectorAll('.res-timeline .res-step').length === 3, 'resolution timeline: 3 steps');
  ok(/Resolution source/.test(w.document.querySelector('#resolution-card')?.textContent || ''), 'resolution source + rules shown');

  // ---- pre-trade summary ----
  const asks = bookApi.asks || [];
  ok(asks.length > 0, 'book has asks to trade against');
  const lvl = asks[0].price;
  w.document.querySelector('#bookbox .book-row.ask') && (() => {
    // click the best ask row (reversed render: last ask row is the best)
    const rows = [...w.document.querySelectorAll('#bookbox .book-row.ask')];
    rows[rows.length - 1].click();
  })();
  await sleep(120);
  ok(+w.document.querySelector('#f-price').value === lvl, 'clicking book row loads price ' + lvl + '¢');
  const qtyInput = w.document.querySelector('#f-qty');
  qtyInput.value = '5';
  qtyInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(150);
  const sum = w.document.querySelector('.ord-sum')?.textContent || '';
  ok(/Total cost/.test(sum) && /Potential payout/.test(sum) && /Potential profit/.test(sum) && /Max loss/.test(sum), 'pre-trade summary rows (cost/payout/profit/max loss)');
  ok(new RegExp('\\$0\\.' + String(lvl * 5).replace('.', '\\.')).test(sum.replace(/,/g, '')) || sum.includes('$' + (lvl * 5 / 100).toFixed(2)), 'total cost = 5 × ' + lvl + '¢ = $' + (lvl * 5 / 100).toFixed(2));

  // ---- place a REAL trade (marketable limit → fills vs real book) ----
  const meBefore = JSON.parse((await req('GET', '/api/me')).text);
  const availBefore = meBefore.snapshot.wallet.available;
  w.document.querySelector('#place-btn').click();
  const done = await waitFor(() => /Filled|resting|rejected|error|insufficient/i.test(w.document.querySelector('#toasts')?.textContent || w.document.body.textContent.slice(-400)), 8000);
  const toasts = w.document.querySelector('#toasts')?.textContent || '';
  ok(/Filled/.test(toasts), 'real order placed and filled against live book');
  await sleep(700); // let refreshes land
  const meAfter = JSON.parse((await req('GET', '/api/me')).text);
  ok(meAfter.snapshot.wallet.available < availBefore, `cash debited (${availBefore} → ${meAfter.snapshot.wallet.available})`);
  const pos = (meAfter.snapshot.positions || []).find((p) => p.marketId === binary.id && (p.outcomeIdx || 0) === 0);
  ok(pos && pos.yesQty >= 5, 'YES position now ≥ 5 shares');

  // ---- multi-outcome market: option switch updates panel ----
  const multi = mkts.find((m) => m.multi && m.status === 'open');
  if (multi) {
    w.location.hash = '#/market/' + multi.slug + '?o=1';
    await waitFor(() => w.document.querySelector('#stat-strip') && w.eval('typeof state !== "undefined" && state.selOutcome') === 1);
    ok(w.eval('state.selOutcome') === 1, 'multi market: outcome tab ?o=1 selected');
    const sumM = w.document.querySelector('.ord-sum')?.textContent || w.document.querySelector('#orderpanel')?.textContent || '';
    ok(w.document.querySelector('#orderpanel') !== null, 'multi market order panel renders for option 1');
  } else ok(false, 'no open multi market found');

  // ---- smoke: other views still render (no regressions from the upgrade) ----
  for (const [hash, probe] of [
    ['#/markets', '#grid'],
    ['#/leaderboard', 'main'],
    ['#/learn', 'main'],
    ['#/portfolio', 'main'],
    ['#/', '#grid'],
  ]) {
    w.location.hash = hash;
    const el = await waitFor(() => {
      const m = w.document.querySelector('main');
      return (hash === '#/' || hash === '#/markets') ? w.document.querySelector('.mcard, #grid .card, #grid [class*=card]') : (m && m.innerHTML.length > 200 ? m : null);
    }, 5000);
    ok(!!el, 'view ' + hash + ' renders');
  }

  console.log('\n' + (failed ? 'MARKET-DETAIL TESTS: ' + failed + ' FAILED' : 'ALL MARKET-DETAIL TESTS PASSED ✅ (' + passed + ')'));
  dom.window.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
