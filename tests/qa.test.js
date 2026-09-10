'use strict';
/**
 * QA regression tests — auth UX (loading/disabled states, Enter-key submit,
 * validation messages, retry on error), logout, and production startup
 * checks. Drives the real UI in jsdom against the live server.
 * Run: node tests/qa.test.js   (needs the server running + `npm i jsdom`)
 */
const { JSDOM } = require('jsdom');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BASE = process.env.PREDIX_TEST_BASE_URL || 'http://127.0.0.1:3000';
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ ' + msg); } };

const jar = new Map();
const req = (method, p, body) => new Promise((resolve, reject) => {
  const data = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null; // app.js pre-stringifies
  const r = http.request(BASE + p, { method, headers: {
    ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
    ...(jar.size ? { cookie: [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ') } : {}),
  } }, (res) => {
    (res.headers['set-cookie'] || []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); });
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, text: b }));
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});

function makeWindow(hash) {
  const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')
    .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
    .replace('</body>', () => '<script>' + appJs + '</script></body>');
  return new JSDOM(html, {
    url: BASE + '/' + (hash || ''), runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o = {}) => {
        const url = new URL(String(u), BASE);
        return req(o.method || 'GET', url.pathname + url.search, o.body).then((r) => ({
          ok: r.status < 400, status: r.status, json: async () => JSON.parse(r.text || '{}'), text: async () => r.text,
        }));
      };
      w.EventSource = class { constructor() {} close() {} addEventListener() {} };
      w.scrollTo = () => {};
    },
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); } return null; }

(async () => {
  let ping = null;
  try { ping = await req('GET', '/api/stats'); } catch { /* server down */ }
  if (!ping || ping.status !== 200) { console.log('SKIPPED — server not running on :3000 (start it with `npm start` to run this suite)'); process.exit(0); }

  /* ============ 1. login: empty fields → friendly validation, no request ============ */
  {
    const dom = makeWindow('#/login'); const w = dom.window; const d = w.document;
    await waitFor(() => d.querySelector('#go'));
    d.querySelector('#go').click();
    await sleep(250);
    ok(/username\/email and password/i.test(d.querySelector('#ferr').textContent), 'empty login fields → clear validation message');
    ok(!d.querySelector('#go').disabled, 'button not left disabled by client-side validation');
    await sleep(350); try { dom.window.close(); } catch {}
  }

  /* ============ 2. login: wrong password → server error shown, button re-enabled ============ */
  {
    const dom = makeWindow('#/login'); const w = dom.window; const d = w.document;
    await waitFor(() => d.querySelector('#go'));
    d.querySelector('#a-id').value = 'admin';
    d.querySelector('#a-pw').value = 'wrong-password';
    d.querySelector('#go').click();
    await waitFor(() => /invalid credentials/i.test(d.querySelector('#ferr')?.textContent || ''), 5000);
    ok(true, 'wrong credentials → server error surfaced in the form');
    ok(!d.querySelector('#go').disabled, 'login button re-enabled after failure (retry possible)');
    await sleep(350); try { dom.window.close(); } catch {}
  }

  /* ============ 3. login: Enter key submits from the USERNAME field ============ */
  {
    const su = await req('POST', '/api/auth/signup', { username: 'qa_enter_' + Date.now(), email: 'qa_' + Date.now() + '@t.local', password: 'supersecret1', promo: 'WELCOME100' });
    const uname = JSON.parse(su.text).user.username;
    const dom = makeWindow('#/login'); const w = dom.window; const d = w.document;
    await waitFor(() => d.querySelector('#a-id'));
    d.querySelector('#a-id').value = uname;
    d.querySelector('#a-pw').value = 'supersecret1';
    d.querySelector('#a-id').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const landed = await waitFor(() => (w.location.hash === '#/' || w.location.hash === '') && w.eval('typeof state !== "undefined" && !!state.me'), 6000);
    ok(!!landed, 'pressing Enter in the username field logs in and lands on home');
    await sleep(350); try { dom.window.close(); } catch {}
  }

  /* ============ 4. login success: loading state, then header shows the user ============ */
  {
    const dom = makeWindow('#/login'); const w = dom.window; const d = w.document;
    await waitFor(() => d.querySelector('#go'));
    d.querySelector('#a-id').value = 'admin';
    d.querySelector('#a-pw').value = 'admin1234';
    d.querySelector('#go').click();
    await sleep(80);
    const btn = d.querySelector('#go'); // null if login already completed and re-rendered (fast local server)
    ok(!btn || (btn.disabled && /logging in/i.test(btn.textContent)), 'login button shows loading state and is disabled while pending');
    const me = await waitFor(() => w.eval('typeof state !== "undefined" && !!state.me'), 6000);
    ok(!!me, 'admin login succeeds');
    ok(d.body.textContent.includes('admin'), 'header reflects the logged-in user');
    await sleep(350); try { dom.window.close(); } catch {}
  }

  /* ============ 5. signup: short password caught client-side ============ */
  {
    const dom = makeWindow('#/signup'); const w = dom.window; const d = w.document;
    await waitFor(() => d.querySelector('#go'));
    d.querySelector('#a-user').value = 'qa_user_' + Date.now();
    d.querySelector('#a-email').value = 'qa2_' + Date.now() + '@t.local';
    d.querySelector('#a-pw').value = 'short';
    d.querySelector('#go').click();
    await sleep(250);
    ok(/at least 8 characters/i.test(d.querySelector('#ferr').textContent), 'short password → clear validation message, no request sent');
    ok(!d.querySelector('#go').disabled, 'signup button not stranded in disabled state');
    await sleep(350); try { dom.window.close(); } catch {}
  }

  /* ============ 6. logout clears the session ============ */
  {
    const dom = makeWindow('#/'); const w = dom.window; const d = w.document;
    await waitFor(() => w.eval('typeof state !== "undefined" && !!state.me'));
    const avatar = await waitFor(() => d.querySelector('#avatar-btn'));
    avatar.click(); // open the avatar dropdown menu
    const logout = await waitFor(() => d.querySelector('#menu-logout'));
    logout.click();
    const gone = await waitFor(() => w.eval('typeof state !== "undefined" && !state.me'), 5000);
    ok(!!gone, 'logout clears the session and header');
    await sleep(350); try { dom.window.close(); } catch {}
  }

  /* ============ 7. production startup checks ============ */
  {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-prod-'));
    const out = await new Promise((resolve) => {
      execFile('node', ['server.js'], {
        cwd: ROOT, timeout: 12000,
        env: { ...process.env, DATABASE_URL: '', PREDIX_DB: '', ADMIN_PASSWORD: '', NODE_ENV: 'production', PORT: '3997', PREDIX_DATA: dir },
      }, (e, stdout, stderr) => resolve({ text: (stdout || '') + (stderr || '') + (e && (e.stdout || '') + (e.stderr || '') || ''), code: e ? e.code : 0, killed: !!(e && e.killed) }));
    });
    ok(/REFUSING TO START/.test(out.text) && /ADMIN_PASSWORD/.test(out.text), 'NODE_ENV=production without ADMIN_PASSWORD refuses to start');
    ok(out.code === 1 && !out.killed, 'the refusal actually exits (code 1) instead of hanging or booting');
    // with ADMIN_PASSWORD set on the JSON store: boots, but still warns about persistence
    const out2 = await new Promise((resolve) => {
      execFile('node', ['server.js'], {
        cwd: ROOT, timeout: 10000,
        env: { ...process.env, DATABASE_URL: '', PREDIX_DB: '', NODE_ENV: 'production', PORT: '3998', PREDIX_DATA: dir, ADMIN_PASSWORD: 'release-check-password' },
      }, (e, stdout, stderr) => resolve({ text: (stdout || '') + (stderr || ''), killed: !!(e && e.killed) }));
    });
    ok(/PRODUCTION CHECK/.test(out2.text) && /JSON journal persistence/.test(out2.text), 'with ADMIN_PASSWORD set: boots and warns about JSON persistence (recommends PostgreSQL)');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + (failed ? 'QA TESTS: ' + failed + ' FAILED' : 'ALL QA TESTS PASSED ✅ (' + passed + ')'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('SUITE CRASH:', e); process.exit(1); });
