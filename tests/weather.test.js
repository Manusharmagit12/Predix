'use strict';
/**
 * Open-Meteo weather feed tests — fully offline (fetch is injected).
 * Provider layer: parsing, URL construction (units), cache, staleness,
 * single-flight, lat/lon/metric/unit validation.
 * Engine integration: weather market proposals (waiting → ready/blocked),
 * stale/unavailable blocking, evidence (source + value + timestamp) through
 * the EXISTING admin-confirmed resolve path, feedTick with mixed providers.
 * Run: node tests/weather.test.js   (isolated PostgreSQL test database)
 */
const assert = require('assert');
const { Engine } = require('../lib/engine');
const { checkEngine } = require('../lib/invariants');
const { OpenMeteoFeed, validateFeedConfig, describeFeed } = require('../lib/feed');
const { createTestStore } = require('./pg-helper');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const throwsWith = (fn, re, msg) => {
  try { fn(); } catch (e) { ok(re.test(e.message), msg + ' → ' + e.message.slice(0, 80)); return; }
  ok(false, msg + ' → DID NOT THROW');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** programmable fake Open-Meteo */
function fakeOm(over = {}) {
  const state = { calls: 0, fail: false, temp: 26.4, precip: 0.1, urls: [] };
  const fn = async (url) => {
    state.calls++;
    state.urls.push(String(url));
    if (state.fail) throw new Error('network down (test)');
    const u = String(url);
    return {
      ok: true, status: 200,
      json: async () => ({
        latitude: 18.52, longitude: 73.86, timezone: 'GMT',
        current: { time: '2026-09-04T12:00', interval: 900, temperature_2m: state.temp, precipitation: state.precip },
      }),
    };
  };
  fn.state = state;
  return fn;
}

(async () => {
  console.log('\n— provider: parse, URL, cache, staleness, single-flight —');
  {
    const fx = fakeOm();
    const wx = new OpenMeteoFeed({ fetchImpl: fx, ttlMs: 80, staleMs: 350 });
    let q = await wx.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' });
    ok(q.value === 26.4 && q.status === 'live' && q.source === 'Open-Meteo', 'fetch parses temperature + LIVE + source');
    ok(q.remoteUpdatedAt === Date.parse('2026-09-04T12:00Z'), 'current.time parsed as UTC → remoteUpdatedAt');
    ok(/latitude=18\.52&longitude=73\.86/.test(fx.state.urls[0]) && /current=temperature_2m/.test(fx.state.urls[0]) && /timezone=UTC/.test(fx.state.urls[0]), 'URL carries lat/lon/current/timezone');
    await wx.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' });
    ok(fx.state.calls === 1, 'cached within TTL → no second HTTP call');
    await sleep(100);
    await wx.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' });
    ok(fx.state.calls === 2, 'past TTL → refetch');
    // fahrenheit + inch params
    await wx.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'fahrenheit' });
    ok(/temperature_unit=fahrenheit/.test(fx.state.urls[2]), 'fahrenheit unit parameter sent');
    await wx.quote({ latitude: 18.52, longitude: 73.86, metric: 'precipitation', unit: 'inch' });
    ok(/precipitation_unit=inch/.test(fx.state.urls[3]) && /current=precipitation/.test(fx.state.urls[3]), 'precipitation + inch parameters sent');
    // default units
    q = await wx.quote({ latitude: -33.87, longitude: 151.21, metric: 'precipitation' });
    ok(q.value === 0.1, 'precipitation parsed; unit defaults to mm');
    // staleness: age past window + failing refetch keeps last value flagged
    const aging = new OpenMeteoFeed({ fetchImpl: fakeOm(), ttlMs: 60, staleMs: 250 });
    await aging.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' });
    await sleep(320);
    const fxA = aging._fetch; // same injected fetch — flip it to failing
    fxA.state.fail = true;
    q = await aging.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' });
    ok(q.status === 'stale' && q.value === 26.4 && /network down/.test(q.error || ''), 'stale window + failed refetch → STALE, last value kept');
    // unavailable
    const fxD = fakeOm(); fxD.state.fail = true;
    const dead = new OpenMeteoFeed({ fetchImpl: fxD, ttlMs: 60, staleMs: 250 });
    q = await dead.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' });
    ok(q.status === 'unavailable' && q.value === null, 'no cache + failed fetch → unavailable (never a value)');
    // param validation (never throws, friendly errors)
    q = await dead.quote({ latitude: 95, longitude: 0, metric: 'temperature' });
    ok(q.status === 'unavailable' && /latitude/.test(q.error), 'latitude out of range rejected');
    q = await dead.quote({ latitude: 0, longitude: 200, metric: 'temperature' });
    ok(q.status === 'unavailable' && /longitude/.test(q.error), 'longitude out of range rejected');
    q = await dead.quote({ latitude: 0, longitude: 0, metric: 'windspeed' });
    ok(q.status === 'unavailable' && /metric must be one of/.test(q.error), 'windspeed rejected — temperature/precipitation only');
    q = await dead.quote({ latitude: 0, longitude: 0, metric: 'temperature', unit: 'mm' });
    ok(q.status === 'unavailable' && /unit must be/.test(q.error), 'wrong unit for metric rejected');
    // single-flight
    const f5 = fakeOm();
    const sf = new OpenMeteoFeed({ fetchImpl: f5, ttlMs: 80, staleMs: 350 });
    await Promise.all([1, 2, 3, 4, 5].map(() => sf.quote({ latitude: 51.51, longitude: -0.13, metric: 'temperature', unit: 'celsius' })));
    ok(f5.state.calls === 1, 'concurrent quotes share one request (single-flight — shared framework)');
  }

  console.log('\n— config validation + descriptors —');
  {
    const good = validateFeedConfig({ provider: 'open-meteo', latitude: '18.52349', longitude: -73.86, metric: 'Temperature', operator: '>=', targetValue: 25, location: '  Pune  ' });
    ok(good.provider === 'open-meteo' && good.latitude === 18.5235 && good.longitude === -73.86, 'weather config normalized (lat rounded to 4dp)');
    ok(good.metric === 'temperature' && good.unit === 'celsius' && good.location === 'Pune', 'defaults: celsius; location trimmed');
    ok(good.resolutionTime === null, 'resolutionTime defaults to market close');
    const p2 = validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 0, metric: 'precipitation', operator: '>', targetValue: 0 });
    ok(p2.unit === 'mm' && p2.targetValue === 0, 'precipitation target 0 allowed ("more than 0 mm" markets)');
    const neg = validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 0, metric: 'temperature', operator: '<=', targetValue: -10 });
    ok(neg.targetValue === -10, 'negative temperature targets allowed (below-freezing markets)');
    throwsWith(() => validateFeedConfig({ provider: 'open-meteo', latitude: 91, longitude: 0, metric: 'temperature', operator: '>=', targetValue: 1 }), /latitude/, 'bad latitude rejected');
    throwsWith(() => validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 999, metric: 'temperature', operator: '>=', targetValue: 1 }), /longitude/, 'bad longitude rejected');
    throwsWith(() => validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 0, metric: 'humidity', operator: '>=', targetValue: 1 }), /metric must be one of/i, 'humidity rejected — temperature/precipitation only');
    throwsWith(() => validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 0, metric: 'temperature', unit: 'mm', operator: '>=', targetValue: 1 }), /unit must be/i, 'mismatched unit rejected');
    throwsWith(() => validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 0, metric: 'precipitation', operator: '>=', targetValue: -1 }), /cannot be negative/i, 'negative precipitation target rejected');
    throwsWith(() => validateFeedConfig({ provider: 'open-meteo', latitude: 0, longitude: 0, metric: 'temperature', operator: '=', targetValue: 1 }), /operator must be one of/i, 'unknown operator rejected');
    // crypto path through the same validator (regression)
    const cg = validateFeedConfig({ assetId: 'bitcoin', operator: '>=', targetValue: 60000 });
    ok(cg.provider === 'coingecko' && cg.assetId === 'bitcoin', 'crypto configs still validate through the same entry point');
    // descriptors
    const fd = describeFeed({ provider: 'open-meteo', latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius', operator: '>=', targetValue: 25, location: 'Pune', closeTime: 123 });
    ok(fd.kind === 'weather' && fd.metricLabel === 'Temperature' && fd.unitLabel === '°C' && fd.targetText === '25°C', 'weather descriptor: labels + targetText');
    ok(fd.latLonText === '18.52°N, 73.86°E' && fd.location === 'Pune' && fd.resolutionTime === 123, 'descriptor: lat/lon text, location, resolutionTime');
    const fc = describeFeed({ provider: 'coingecko', assetId: 'bitcoin', currency: 'usd', operator: '>=', targetValue: 60000, closeTime: 5 });
    ok(fc.kind === 'crypto' && fc.symbol === 'BTC' && fc.targetText === '$60,000', 'crypto descriptor unchanged');
    ok(describeFeed({}) === null && describeFeed(null) === null, 'no provider → no descriptor');
  }

  console.log('\n— engine: weather proposal lifecycle —');
  const store = await createTestStore('weather');
  const engine = new Engine(store, { broadcast() {}, sendUser() {} });
  engine.rebuild();
  const fx = fakeOm();
  engine.weather = new OpenMeteoFeed({ fetchImpl: fx, ttlMs: 100000, staleMs: 100000 });
  engine.feeds._fetch = fx; // crypto engine not used here; keep isolated anyway
  const admin = store.insert('users', { username: 'admin', email: 'a@x.io', salt: 's', passHash: 'h', role: 'admin', createdAt: Date.now() });
  const mkWx = (over = {}) => store.insert('markets', {
    slug: over.slug || ('wx-' + Math.random().toString(36).slice(2, 8)), title: 'Pune hotter than 25°C today?', emoji: '🌡️', category: 'Weather', description: '',
    resolutionSource: 'Open-Meteo temperature, Pune', resolutionRules: 'YES if temperature ≥ 25°C', closeTime: over.closeTime != null ? over.closeTime : Date.now() - 1000,
    createdAt: Date.now(), status: over.status || 'closed', outcome: null, last: 60, lastTradeTs: Date.now(),
    provider: 'open-meteo', latitude: over.latitude != null ? over.latitude : 18.52, longitude: over.longitude != null ? over.longitude : 73.86,
    metric: over.metric || 'temperature', unit: over.unit || 'celsius', operator: over.operator || '>=',
    targetValue: over.targetValue != null ? over.targetValue : 25,
    feedResolutionTime: over.feedResolutionTime != null ? over.feedResolutionTime : Date.now() - 1000,
    ...(over.location ? { location: over.location } : {}),
  });

  {
    const m = mkWx({ status: 'open', feedResolutionTime: Date.now() - 1000 });
    const r = await engine.updateFeedProposal(m);
    ok(r.state === 'waiting' && !m.feedProposal, 'still-trading weather market → waiting, nothing proposed');
    const m2 = mkWx({ feedResolutionTime: Date.now() + 3600 * 1000 });
    ok((await engine.updateFeedProposal(m2)).state === 'waiting', 'before resolution time → waiting');
    const m3 = mkWx({ slug: 'wx-ready', location: 'Pune' });
    const p = await engine.updateFeedProposal(m3);
    ok(p.state === 'ready' && p.outcome === 'yes' && p.value === 26.4, 'LIVE 26.4°C ≥ 25°C → YES proposal');
    ok(p.source === 'Open-Meteo' && p.unitLabel === '°C' && p.valueText === '26.4°C' && p.targetText === '25°C', 'proposal carries unit-aware value/target text');
    ok(p.location === 'Pune' && p.latitude === 18.52 && p.longitude === 73.86, 'proposal carries location metadata');
    ok(/\[Open-Meteo\] Temperature @ Pune \(18\.52°N, 73\.86°E\) = 26\.4°C at \d{4}-\d{2}-\d{2}T.+→ proposal YES/.test(p.evidence), 'evidence = source + location + value + timestamp + rule');
    ok(store.get('markets', m3.id).feedProposal.state === 'ready', 'proposal persisted on the market row');
    const p2 = await engine.updateFeedProposal(mkWx({ targetValue: 30 }));
    ok(p2.outcome === 'no', '26.4°C < 30°C → NO proposal');
    const pub = engine.marketPublic(m3);
    ok(pub.feed.kind === 'weather' && pub.feed.metricLabel === 'Temperature' && pub.feed.latLonText === '18.52°N, 73.86°E', 'marketPublic exposes the weather descriptor');
    ok(pub.feed.targetText === '25°C' && pub.feedProposal.outcome === 'yes', 'marketPublic carries targetText + proposal');
    ok(/YES if Temperature ≥ 25°C at resolution time \(Open-Meteo · Pune 18\.52°N, 73\.86°E\)/.test(engine.feedRuleText(m3)), 'rule text reads naturally for weather');
    // precipitation market
    const mP = mkWx({ slug: 'wx-precip', metric: 'precipitation', unit: 'mm', targetValue: 0.05, operator: '>', location: 'Pune' });
    const pP = await engine.updateFeedProposal(mP);
    ok(pP.state === 'ready' && pP.outcome === 'yes' && pP.valueText === '0.1mm' && pP.unitLabel === 'mm', 'precipitation 0.1mm > 0.05mm strict → YES, value labeled in mm');
  }

  console.log('\n— engine: stale / unavailable weather blocks proposals —');
  {
    const fxD = fakeOm(); fxD.state.fail = true;
    engine.weather = new OpenMeteoFeed({ fetchImpl: fxD, ttlMs: 60, staleMs: 250 });
    const m = mkWx({ slug: 'wx-dead' });
    const p = await engine.updateFeedProposal(m);
    ok(p.state === 'blocked' && p.reason === 'data unavailable' && m.feedProposal.state === 'blocked', 'weather unavailable → blocked marker persisted');
    const fxS = fakeOm();
    engine.weather = new OpenMeteoFeed({ fetchImpl: fxS, ttlMs: 60, staleMs: 250 });
    const m2 = mkWx({ slug: 'wx-stale' });
    await engine.weather.quote({ latitude: 18.52, longitude: 73.86, metric: 'temperature', unit: 'celsius' }); // prime
    await sleep(320);
    fxS.state.fail = true; // refetch fails → cache ages past stale window
    const p2 = await engine.updateFeedProposal(m2);
    ok(p2.state === 'blocked' && p2.reason === 'data stale', 'stale weather reading → blocked (no proposal from old data)');
    engine.weather = new OpenMeteoFeed({ fetchImpl: fakeOm(), ttlMs: 100000, staleMs: 100000 });
  }

  console.log('\n— resolution: weather proposal → admin confirm (existing audited path) —');
  {
    const m = mkWx({ slug: 'wx-resolve', location: 'Pune' });
    const p = await engine.updateFeedProposal(m);
    ok(p.state === 'ready' && p.outcome === 'yes', 'proposal ready');
    const prev = engine.resolve(m, p.outcome, { evidence: p.evidence, notes: 'per weather feed', actor: { id: admin.id, username: 'admin', role: 'admin' } });
    ok(prev.confirmationRequired === true, 'step 1: confirmation preview, nothing settled');
    const done = engine.resolve(m, p.outcome, { evidence: p.evidence, notes: 'per weather feed', confirm: true, actor: { id: admin.id, username: 'admin', role: 'admin' } });
    ok(done.ok === true && m.status === 'resolved', 'step 2: confirmed → resolved via existing two-step flow');
    const rec = engine.resolutionAudit(m.id).pop();
    ok(/\[Open-Meteo\] .+ = 26\.4°C at \d{4}-\d{2}-\d{2}T/.test(rec.evidence), 'immutable record stores weather source + value + timestamp');
    ok(engine.verifyResolution(rec), 'resolution record hash verifies');
    const inv = checkEngine(engine).violations;
    ok(inv.length === 0, 'invariants clean after weather resolution' + (inv.length ? ' → ' + inv[0] : ''));
    ok(engine.ledger.reconcile().violations.length === 0, 'ledger reconciles after weather-driven settlement');
  }

  console.log('\n— feedTick: mixed providers, deduped fetches —');
  {
    const fxW = fakeOm();
    engine.weather = new OpenMeteoFeed({ fetchImpl: fxW, ttlMs: 100000, staleMs: 100000 });
    mkWx({ slug: 'tick-1', location: 'Pune' });
    mkWx({ slug: 'tick-2', location: 'Pune', targetValue: 30 }); // same location → shared fetch
    const r = await engine.feedTick();
    ok(r.markets >= 2 && r.proposals >= 2, `feedTick processed ${r.markets} weather markets, ${r.proposals} proposals`);
    ok(fxW.state.calls === 2, 'one HTTP call per distinct location+metric key (temperature + precipitation = 2 calls for all markets, same-location markets shared)');
    // crypto + weather coexist
    const cgFake = (async () => ({ ok: true, status: 200, json: async () => ({ bitcoin: { usd: 81095, last_updated_at: 1788513040 } }) }));
    engine.feeds._fetch = cgFake;
    store.insert('markets', {
      slug: 'tick-btc', title: 'BTC above 60K?', emoji: '₿', category: 'Crypto', description: '',
      resolutionSource: 'CoinGecko', resolutionRules: 'YES if BTC ≥ $60,000', closeTime: Date.now() - 1000,
      createdAt: Date.now(), status: 'closed', outcome: null, last: 60, lastTradeTs: Date.now(),
      provider: 'coingecko', assetId: 'bitcoin', currency: 'usd', operator: '>=', targetValue: 60000, feedResolutionTime: Date.now() - 1000,
    });
    const r2 = await engine.feedTick();
    ok(r2.markets >= 3 && r2.proposals >= 3, `mixed tick: ${r2.markets} markets, ${r2.proposals} proposals across both providers`);
    ok(fxW.state.calls === 2, 'second tick adds no weather calls (still cached); crypto went through its own provider');
  }

  console.log(`\n✓ weather: ${passed} assertions passed\n`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ WEATHER TEST FAILED:', e); process.exit(1); });
