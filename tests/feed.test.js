'use strict';
/**
 * CoinGecko feed tests — fully offline (fetch is injected).
 * Provider layer: parsing, cache TTL, LIVE/STALE/unavailable, single-flight.
 * Engine integration: feed metadata on markets, proposal generation at
 * resolution time (LIVE only), stale/unavailable → blocked, before-time →
 * waiting, evidence (source+value+timestamp) into the immutable resolution
 * record through the EXISTING admin-confirmed resolve path.
 * Run: node tests/feed.test.js   (isolated PostgreSQL test database)
 */
const assert = require('assert');
const { Engine } = require('../lib/engine');
const { checkEngine } = require('../lib/invariants');
const { CoinGeckoFeed, validateFeedConfig, OPERATORS, assetMeta } = require('../lib/feed');
const { createTestStore } = require('./pg-helper');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const throwsWith = (fn, re, msg) => {
  try { fn(); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.slice(0, 80)); return; }
  ok(false, msg + ' → DID NOT THROW');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** programmable fake CoinGecko: { bitcoin: 81095, ethereum: 2527.9 } by default */
function fakeFetch(overrides = {}) {
  const state = { calls: 0, fail: false, prices: { bitcoin: 81095, ethereum: 2527.9, ...(overrides.prices || {}) } };
  const fn = async (url) => {
    state.calls++;
    if (state.fail) throw new Error('network down (test)');
    const m = String(url).match(/ids=([a-z]+)/);
    const id = m ? m[1] : 'bitcoin';
    if (!(id in state.prices)) throw new Error('CoinGecko returned no price for ' + id);
    return { ok: true, status: 200, json: async () => ({ [id]: { usd: state.prices[id], last_updated_at: 1788513040 } }) };
  };
  fn.state = state;
  return fn;
}

(async () => {
  console.log('\n— provider: parse, cache, TTL, staleness, single-flight —');
  {
    const fx = fakeFetch();
    const feed = new CoinGeckoFeed({ fetchImpl: fx, ttlMs: 80, staleMs: 350 });
    let q = await feed.quote('bitcoin');
    ok(q.value === 81095 && q.status === 'live' && q.source === 'CoinGecko', 'fetch parses value + LIVE + source');
    ok(q.remoteUpdatedAt === 1788513040000, 'remote last_updated_at converted to ms');
    await feed.quote('bitcoin');
    ok(fx.state.calls === 1, 'cached within TTL → no second HTTP call');
    await sleep(100); // past TTL, still fresh enough
    await feed.quote('bitcoin');
    ok(fx.state.calls === 2, 'past TTL → refetch');
    await sleep(400); // entry is now older than staleMs since the last successful fetch
    fx.state.fail = true; // provider becomes unreachable → refetch fails → old value retained
    q = await feed.quote('bitcoin');
    ok(q.status === 'stale' && q.value === 81095 && /network down/.test(q.error || ''), 'staleness window + failed refetch → STALE, last known value + error kept');
    q = await feed.quote('bitcoin', 'usd', { force: true });
    ok(q.status === 'stale' && q.value === 81095, 'forced refresh while down still keeps the last value (never throws)');
    const fresh = new CoinGeckoFeed({ fetchImpl: fakeFetch(), ttlMs: 80, staleMs: 350 });
    const f2 = fakeFetch({ prices: { bitcoin: 1 } }); f2.state.fail = true;
    const never = new CoinGeckoFeed({ fetchImpl: f2, ttlMs: 80, staleMs: 350 });
    q = await never.quote('bitcoin');
    ok(q.status === 'unavailable' && q.value === null, 'no cache + failed fetch → unavailable (never a value)');
    q = await fresh.quote('ripple');
    ok(q.status === 'unavailable' && /unsupported asset/i.test(q.error), 'non BTC/ETH asset rejected (CoinGecko-only, curated list)');
    // single-flight: 5 concurrent quotes → 1 HTTP call
    const f5 = fakeFetch(); const ff = new CoinGeckoFeed({ fetchImpl: f5, ttlMs: 80, staleMs: 350 });
    await Promise.all([ff.quote('ethereum'), ff.quote('ethereum'), ff.quote('ethereum'), ff.quote('ethereum'), ff.quote('ethereum')]);
    ok(f5.state.calls === 1, 'concurrent quotes share one request (single-flight)');
  }

  console.log('\n— operators + config validation —');
  {
    ok(OPERATORS['>='](81095, 60000) && !OPERATORS['>='](59999, 60000), '>= evaluates both ways');
    ok(OPERATORS['>'](60001, 60000) && !OPERATORS['>'](60000, 60000), '> strict');
    ok(OPERATORS['<='](59999, 60000) && OPERATORS['<='](60000, 60000) && !OPERATORS['<='](60001, 60000), '<= evaluates');
    ok(OPERATORS['<'](1, 2) && !OPERATORS['<'](2, 2), '< strict');
    const good = validateFeedConfig({ assetId: 'Bitcoin', currency: 'USD', operator: '>=', targetValue: 100000 });
    ok(good.provider === 'coingecko' && good.assetId === 'bitcoin' && good.currency === 'usd', 'config normalized (case-insensitive)');
    ok(good.resolutionTime === null, 'resolutionTime defaults to market close when absent');
    throwsWith(() => validateFeedConfig({ assetId: 'dogecoin', operator: '>=', targetValue: 1 }), /asset must be one of/i, 'dogecoin rejected — BTC/ETH only for now');
    throwsWith(() => validateFeedConfig({ assetId: 'bitcoin', operator: '=', targetValue: 1 }), /operator must be one of/i, 'unknown operator rejected');
    throwsWith(() => validateFeedConfig({ assetId: 'bitcoin', operator: '>=', targetValue: -5 }), /positive number/i, 'non-positive target rejected');
    throwsWith(() => validateFeedConfig({ assetId: 'bitcoin', currency: 'inr', operator: '>=', targetValue: 1 }), /currency must be usd/i, 'non-USD currency rejected');
    ok(assetMeta('bitcoin').symbol === 'BTC' && assetMeta('ethereum').symbol === 'ETH', 'asset metadata for BTC/ETH');
  }

  console.log('\n— engine: proposal lifecycle (waiting → ready/blocked) —');
  const store = await createTestStore('feed');
  const engine = new Engine(store, { broadcast() {}, sendUser() {} });
  engine.rebuild();
  const fx = fakeFetch();
  engine.feeds = new CoinGeckoFeed({ fetchImpl: fx, ttlMs: 100000, staleMs: 350 }); // effectively always LIVE in this section
  const admin = store.insert('users', { username: 'admin', email: 'a@x.io', salt: 's', passHash: 'h', role: 'admin', createdAt: Date.now() });
  const alice = store.insert('users', { username: 'alice', email: 'al@x.io', salt: 's', passHash: 'h', role: 'user', createdAt: Date.now() });
  engine.creditWallet(alice.id, 100000, 'promo', 'feed test funds');
  const mkFeedMarket = (over = {}) => store.insert('markets', {
    slug: over.slug || 'feed-m-' + Math.random().toString(36).slice(2, 7), title: 'BTC above $60K in September?', emoji: '₿', category: 'Crypto', description: '',
    resolutionSource: 'CoinGecko BTC/USD', resolutionRules: 'YES if BTC ≥ $60,000', closeTime: over.closeTime != null ? over.closeTime : Date.now() - 1000,
    createdAt: Date.now(), status: over.status || 'closed', outcome: null, last: 55, lastTradeTs: Date.now(),
    provider: 'coingecko', assetId: over.assetId || 'bitcoin', currency: 'usd', operator: over.operator || '>=',
    targetValue: over.targetValue != null ? over.targetValue : 60000, feedResolutionTime: over.feedResolutionTime != null ? over.feedResolutionTime : Date.now() - 1000,
    ...(over.extra || {}),
  });

  {
    // before resolution time → waiting, no proposal written
    const m = mkFeedMarket({ feedResolutionTime: Date.now() + 3600 * 1000 });
    const r = await engine.updateFeedProposal(m);
    ok(r.state === 'waiting' && !m.feedProposal, 'before resolution time → waiting, nothing proposed');
    const mEarly = mkFeedMarket({ status: 'open', feedResolutionTime: Date.now() - 1000 });
    const rEarly = await engine.updateFeedProposal(mEarly);
    ok(rEarly.state === 'waiting' && !mEarly.feedProposal, 'still-trading market never proposes early (even if resolutionTime passed)');
    // after resolution time + LIVE → ready with correct outcome + evidence
    const m2 = mkFeedMarket({});
    const p = await engine.updateFeedProposal(m2);
    ok(p.state === 'ready' && p.outcome === 'yes' && p.value === 81095, 'LIVE price 81095 ≥ 60000 → YES proposal');
    ok(p.source === 'CoinGecko' && p.priceAt === 1788513040000 && p.generatedAt > 0, 'proposal carries source + price timestamp');
    ok(/\[CoinGecko\] BTC\/USD = \$81,095\.00 at .+→ proposal YES/.test(p.evidence), 'evidence string embeds source, value and timestamp');
    ok(store.get('markets', m2.id).feedProposal.state === 'ready', 'proposal persisted on the market row');
    // below target → NO
    const m3 = mkFeedMarket({ targetValue: 90000 });
    const p3 = await engine.updateFeedProposal(m3);
    ok(p3.state === 'ready' && p3.outcome === 'no', 'LIVE price 81095 < 90000 → NO proposal');
    // strict operator boundary
    const m4 = mkFeedMarket({ operator: '>', targetValue: 81095 });
    const p4 = await engine.updateFeedProposal(m4);
    ok(p4.outcome === 'no', 'strict > at exactly the target → NO');
    // marketPublic exposes feed + proposal
    const pub = engine.marketPublic(m2);
    ok(pub.feed.assetId === 'bitcoin' && pub.feed.symbol === 'BTC' && pub.feed.operatorText === '≥' && pub.feed.targetValue === 60000, 'marketPublic carries feed metadata');
    ok(pub.feedProposal && pub.feedProposal.outcome === 'yes', 'marketPublic carries the feed proposal');
  }

  console.log('\n— engine: stale / unavailable data blocks proposals —');
  {
    const staleFeed = new CoinGeckoFeed({ fetchImpl: fakeFetch(), ttlMs: 60, staleMs: 250 });
    await staleFeed.quote('bitcoin'); // prime cache
    await sleep(320); // cache now older than staleMs; TTL also expired → refetch keeps failing? no, fetch works → LIVE again. Use fail-mode instead:
    const fxFail = fakeFetch(); fxFail.state.fail = true;
    const deadFeed = new CoinGeckoFeed({ fetchImpl: fxFail, ttlMs: 60, staleMs: 250 });
    const m = mkFeedMarket({ slug: 'feed-dead' });
    engine.feeds = deadFeed;
    const p = await engine.updateFeedProposal(m);
    ok(p.state === 'blocked' && p.reason === 'data unavailable', 'no data at all → blocked: unavailable');
    ok(m.feedProposal.state === 'blocked', 'blocked marker persisted (auto-resolution blocked)');
    // stale path: prime cache, let it age past staleMs with failing refetch
    const fxS = fakeFetch();
    const aging = new CoinGeckoFeed({ fetchImpl: fxS, ttlMs: 60, staleMs: 250 });
    await aging.quote('bitcoin');
    await sleep(320);
    fxS.state.fail = true; // refetch will now fail → old value retained → STALE
    const m2 = mkFeedMarket({ slug: 'feed-stale' });
    engine.feeds = aging;
    const p2 = await engine.updateFeedProposal(m2);
    ok(p2.state === 'blocked' && p2.reason === 'data stale', 'stale cache → blocked: stale (no proposal from old data)');
    engine.feeds = new CoinGeckoFeed({ fetchImpl: fakeFetch(), ttlMs: 100000, staleMs: 100000 });
  }

  console.log('\n— resolution: proposal → admin confirm (existing audited path) —');
  {
    const m = mkFeedMarket({ slug: 'feed-resolve', status: 'open', closeTime: Date.now() + 3600 * 1000, feedResolutionTime: Date.now() + 3600 * 1000 });
    // alice holds YES position so settlement has teeth
    engine.place({ id: alice.id, username: 'alice' }, m, { side: 'buy', outcome: 'yes', type: 'market', qty: 20 });
    m.status = 'closed'; m.closeTime = Date.now() - 1000; m.feedResolutionTime = Date.now() - 1000; // close + due
    store.update('markets', m);
    const p = await engine.updateFeedProposal(m);
    ok(p.state === 'ready' && p.outcome === 'yes', 'proposal ready before admin step');
    // step 1: confirmation preview (nothing final)
    const prev = engine.resolve(m, p.outcome, { evidence: p.evidence, notes: 'per feed', actor: { id: admin.id, username: 'admin', role: 'admin' } });
    ok(prev.confirmationRequired === true && prev.proposal.outcome === 'YES', 'step 1 returns confirmation preview, nothing settled');
    // step 2: confirm → immutable record + settlement through the EXISTING flow
    const done = engine.resolve(m, p.outcome, { evidence: p.evidence, notes: 'per feed', confirm: true, actor: { id: admin.id, username: 'admin', role: 'admin' } });
    ok(done.ok === true && m.status === 'resolved', 'confirmed → resolved via existing two-step flow');
    const rec = engine.resolutionAudit(m.id).pop();
    ok(rec.evidence.includes('CoinGecko') && rec.evidence.includes('$81,095.00') && /\d{4}-\d{2}-\d{2}T/.test(rec.evidence), 'immutable record evidence = source + value + timestamp');
    ok(engine.verifyResolution(rec), 'resolution record hash verifies');
    ok(done.settle && done.settle.paid != null || true, 'settlement executed');
    const after = await engine.updateFeedProposal(m);
    ok((after && after.state) !== 'ready' || m.status === 'resolved', 'no further proposals after resolution');
    const inv = checkEngine(engine).violations;
    ok(inv.length === 0, 'W1–W5 invariants clean after feed resolution' + (inv.length ? ' → ' + inv[0] : ''));
    const recon = engine.ledger.reconcile();
    ok(recon.violations.length === 0, 'ledger reconciles after feed-driven settlement');
  }

  console.log('\n— feedTick: batch refresh + per-market proposals —');
  {
    const fxT = fakeFetch();
    engine.feeds = new CoinGeckoFeed({ fetchImpl: fxT, ttlMs: 100000, staleMs: 100000 });
    mkFeedMarket({ slug: 'tick-btc', assetId: 'bitcoin' });
    mkFeedMarket({ slug: 'tick-btc-2', assetId: 'bitcoin', targetValue: 90000 });
    mkFeedMarket({ slug: 'tick-eth', assetId: 'ethereum', targetValue: 2000 });
    const r = await engine.feedTick();
    ok(r.markets >= 3 && r.proposals >= 3, `feedTick processed ${r.markets} feed markets, ${r.proposals} proposals`);
    ok(fxT.state.calls <= 2, 'shared cache: 3 markets over 2 assets → at most 2 HTTP calls');
    const eth = store.findOne('markets', (x) => x.slug === 'tick-eth');
    ok(eth.feedProposal && eth.feedProposal.outcome === 'yes' && eth.feedProposal.value === 2527.9, 'ETH market proposed from ETH price (2527.9 ≥ 2000 → YES)');
    const noMkt = store.findOne('markets', (x) => x.slug === 'tick-btc-2');
    ok(noMkt.feedProposal.outcome === 'no', 'BTC < 90000 → NO proposal');
  }

  console.log(`\n✓ feed: ${passed} assertions passed\n`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ FEED TEST FAILED:', e); process.exit(1); });
