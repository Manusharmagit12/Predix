'use strict';
/**
 * External data-provider layer (Predix market feeds).
 *
 * PLAY-MONEY platform: external values fetched here are ONLY used for
 *   • displaying live reference data in the market UI, and
 *   • generating a resolution PROPOSAL at resolution time.
 * The prediction probability always comes from Predix trading (order book),
 * never from these values. Settlement always requires admin confirmation
 * over the existing audited two-step resolution flow.
 *
 * Providers (backend-only fetching; the client never calls out):
 *   • CoinGeckoFeed  — crypto prices (bitcoin / ethereum, USD)
 *   • OpenMeteoFeed  — weather (temperature / precipitation) by lat/lon
 *
 * Shared framework (BaseCachingFeed):
 *   • Per-key in-memory cache with a short TTL and a staleness window:
 *       fetched < TTL ago      → served from cache, no HTTP call
 *       fetched < STALE_AFTER  → LIVE
 *       fetched ≥ STALE_AFTER  → STALE (last known value kept, flagged)
 *   • Single-flight: concurrent quote() calls share one HTTP request.
 *   • Never throws: network/API errors degrade to the last cached quote
 *     (or an 'unavailable' entry with no value). STALE/unavailable data can
 *     never produce a resolution proposal.
 *   • Zero dependencies: Node ≥18 global fetch + AbortController timeout.
 *   • fetchImpl is injectable so tests run fully offline.
 * No sports or stock feeds (yet) — the curated registry below is deliberate.
 */

const CG_ASSETS = {
  bitcoin: { label: 'Bitcoin', symbol: 'BTC', emoji: '₿' },
  ethereum: { label: 'Ethereum', symbol: 'ETH', emoji: 'Ξ' },
};
const CG_CURRENCIES = ['usd'];

const WX_METRICS = {
  temperature: { label: 'Temperature', param: 'temperature_2m', emoji: '🌡️', defaultUnit: 'celsius' },
  precipitation: { label: 'Precipitation', param: 'precipitation', emoji: '🌧️', defaultUnit: 'mm' },
};
const WX_UNITS = {
  celsius: { metric: 'temperature', label: '°C' },
  fahrenheit: { metric: 'temperature', label: '°F' },
  mm: { metric: 'precipitation', label: 'mm' },
  inch: { metric: 'precipitation', label: 'in' },
};

const OPERATORS = {
  '>=': (v, t) => v >= t,
  '>': (v, t) => v > t,
  '<=': (v, t) => v <= t,
  '<': (v, t) => v < t,
};
const OPERATOR_TEXT = { '>=': '≥', '>': '>', '<=': '≤', '<': '<' };

/* ==================== shared caching framework ==================== */

class BaseCachingFeed {
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs != null ? opts.ttlMs : 60 * 1000; // re-fetch window
    this.staleMs = opts.staleMs != null ? opts.staleMs : 10 * 60 * 1000; // LIVE → STALE window
    this.timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 6000;
    this._fetch = opts.fetchImpl || ((...a) => fetch(...a)); // injectable for tests
    this.cache = new Map(); // quoteKey → { value, remoteUpdatedAt, fetchedAt, error }
    this.inFlight = new Map(); // single-flight refresh guards
    this.requestCount = 0; // observability (tests)
  }

  _statusOf(entry, now = Date.now()) {
    if (!entry || entry.value == null) return 'unavailable';
    return now - entry.fetchedAt > this.staleMs ? 'stale' : 'live';
  }

  /** shared cache+single-flight core: key, refresher() → { value, remoteUpdatedAt } */
  async _cached(key, refresher, { force = false } = {}) {
    const now = Date.now();
    const entry = this.cache.get(key);
    const needsRefresh = force || !entry || (now - entry.fetchedAt) > this.ttlMs;
    if (needsRefresh) {
      let p = this.inFlight.get(key);
      if (!p) {
        p = Promise.resolve()
          .then(refresher)
          .then((fresh) => {
            const e = { value: fresh.value, remoteUpdatedAt: fresh.remoteUpdatedAt, fetchedAt: Date.now(), error: null };
            this.cache.set(key, e);
            return e;
          })
          .catch((err) => {
            // keep the last known value; mark the failure on the entry
            const e = entry || { value: null, remoteUpdatedAt: null, fetchedAt: entry ? entry.fetchedAt : Date.now() };
            e.error = String(err && err.message || err);
            if (!entry) this.cache.set(key, e);
            return e;
          })
          .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, p);
      }
      await p;
    }
    return this.cache.get(key) || entry || { value: null, remoteUpdatedAt: null, fetchedAt: null, error: 'never fetched' };
  }

  _quoteShape(key, cur) {
    const [provider, ...rest] = key.split('|');
    return {
      provider,
      value: cur.value != null ? cur.value : null,
      status: cur.value != null ? this._statusOf(cur) : 'unavailable',
      fetchedAt: cur.fetchedAt,
      remoteUpdatedAt: cur.remoteUpdatedAt,
      error: cur.error || null,
      _key: rest.join('|'),
    };
  }

  /** fetch JSON with timeout; throws on HTTP/network failure */
  async _fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      this.requestCount++;
      const res = await this._fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ==================== CoinGecko (crypto) ==================== */

class CoinGeckoFeed extends BaseCachingFeed {
  constructor(opts = {}) {
    super(opts);
    this.baseUrl = opts.baseUrl || 'https://api.coingecko.com/api/v3';
    this.source = 'CoinGecko';
  }

  _key(assetId, currency) { return 'coingecko|' + assetId + ':' + currency; }

  async _refresh(assetId, currency) {
    const url = `${this.baseUrl}/simple/price?ids=${encodeURIComponent(assetId)}`
      + `&vs_currencies=${encodeURIComponent(currency)}&include_last_updated_at=true`;
    const body = await this._fetchJson(url);
    const row = body && body[assetId];
    const value = row && row[currency];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('CoinGecko returned no price for ' + assetId);
    return { value, remoteUpdatedAt: typeof row.last_updated_at === 'number' ? row.last_updated_at * 1000 : null };
  }

  /**
   * quote(assetId, currency) → { assetId, currency, value, source, status,
   *                              fetchedAt, remoteUpdatedAt, error }
   * Cached, single-flight, never throws. `force` bypasses the TTL once.
   */
  async quote(assetId, currency = 'usd', { force = false } = {}) {
    assetId = String(assetId || '').toLowerCase();
    currency = String(currency || 'usd').toLowerCase();
    if (!CG_ASSETS[assetId]) return { assetId, currency, value: null, source: 'CoinGecko', status: 'unavailable', fetchedAt: null, remoteUpdatedAt: null, error: 'unsupported asset' };
    if (!CG_CURRENCIES.includes(currency)) return { assetId, currency, value: null, source: 'CoinGecko', status: 'unavailable', fetchedAt: null, remoteUpdatedAt: null, error: 'unsupported currency' };
    const cur = await this._cached(this._key(assetId, currency), () => this._refresh(assetId, currency), { force });
    return { ...this._quoteShape(this._key(assetId, currency), cur), assetId, currency, source: 'CoinGecko' };
  }
}

/* ==================== Open-Meteo (weather) ==================== */

class OpenMeteoFeed extends BaseCachingFeed {
  constructor(opts = {}) {
    super(opts);
    this.baseUrl = opts.baseUrl || 'https://api.open-meteo.com/v1';
    this.source = 'Open-Meteo';
  }

  _key(loc) { return 'open-meteo|' + loc.latitude + ':' + loc.longitude + ':' + loc.metric + ':' + loc.unit; }

  async _refresh(loc) {
    const metric = WX_METRICS[loc.metric];
    let url = `${this.baseUrl}/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}`
      + `&current=${metric.param}&timezone=UTC`;
    if (loc.metric === 'temperature' && loc.unit === 'fahrenheit') url += '&temperature_unit=fahrenheit';
    if (loc.metric === 'precipitation' && loc.unit === 'inch') url += '&precipitation_unit=inch';
    const body = await this._fetchJson(url);
    const cur = body && body.current;
    const value = cur && cur[loc.metric === 'temperature' ? 'temperature_2m' : 'precipitation'];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Open-Meteo returned no ' + loc.metric + ' reading');
    const ts = cur && cur.time ? Date.parse(String(cur.time) + (String(cur.time).endsWith('Z') ? '' : 'Z')) : NaN;
    return { value, remoteUpdatedAt: Number.isFinite(ts) ? ts : null };
  }

  /**
   * quote({ latitude, longitude, metric, unit }) → { latitude, longitude, metric, unit,
   *   value, source, status, fetchedAt, remoteUpdatedAt, error }. Never throws.
   */
  async quote(loc, { force = false } = {}) {
    const latitude = Number(loc && loc.latitude);
    const longitude = Number(loc && loc.longitude);
    const metric = String((loc && loc.metric) || '').toLowerCase();
    const norm = { latitude, longitude, metric, unit: String((loc && loc.unit) || '').toLowerCase() };
    const bad = (err) => ({ ...norm, value: null, source: 'Open-Meteo', status: 'unavailable', fetchedAt: null, remoteUpdatedAt: null, error: err });
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return bad('latitude must be a number between -90 and 90');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return bad('longitude must be a number between -180 and 180');
    if (!WX_METRICS[metric]) return bad('metric must be one of: ' + Object.keys(WX_METRICS).join(', ') + ' (temperature and precipitation only for now)');
    if (!norm.unit) norm.unit = WX_METRICS[metric].defaultUnit;
    const unitDef = WX_UNITS[norm.unit];
    if (!unitDef || unitDef.metric !== metric) return bad('unit must be ' + (metric === 'temperature' ? 'celsius or fahrenheit' : 'mm or inch') + ' for ' + metric);
    const key = this._key(norm);
    const cur = await this._cached(key, () => this._refresh(norm), { force });
    return { ...this._quoteShape(key, cur), ...norm, source: 'Open-Meteo' };
  }
}

/* ==================== config validation + descriptors ==================== */

/** Validate + normalize a feed config attached at market creation. Throws Error with a friendly message. */
function validateFeedConfig(cfg) {
  const c = cfg || {};
  const operator = String(c.operator || '');
  if (!OPERATORS[operator]) throw new Error('Feed operator must be one of: ' + Object.keys(OPERATORS).join(', ') + '.');
  const targetValue = Number(c.targetValue);
  let resolutionTime = Number(c.resolutionTime);
  if (!Number.isFinite(resolutionTime) || resolutionTime <= 0) resolutionTime = null; // defaults to market closeTime

  if (c.provider === 'open-meteo' || c.latitude !== undefined) {
    // ---- weather (Open-Meteo) ----
    const latitude = Number(c.latitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('Feed latitude must be a number between -90 and 90.');
    const longitude = Number(c.longitude);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Feed longitude must be a number between -180 and 180.');
    const metric = String(c.metric || '').toLowerCase();
    if (!WX_METRICS[metric]) throw new Error('Feed metric must be one of: ' + Object.keys(WX_METRICS).join(', ') + ' (temperature and precipitation only for now).');
    if (!Number.isFinite(targetValue)) throw new Error('Feed target value must be a number.');
    if (metric === 'precipitation' && targetValue < 0) throw new Error('Feed precipitation target cannot be negative.');
    let unit = String(c.unit || '').toLowerCase();
    if (!unit) unit = WX_METRICS[metric].defaultUnit;
    const unitDef = WX_UNITS[unit];
    if (!unitDef || unitDef.metric !== metric) throw new Error('Feed unit must be ' + (metric === 'temperature' ? 'celsius or fahrenheit' : 'mm or inch') + ' for ' + metric + '.');
    const location = String(c.location || '').trim().slice(0, 80);
    return {
      provider: 'open-meteo',
      latitude: Math.round(latitude * 10000) / 10000,
      longitude: Math.round(longitude * 10000) / 10000,
      metric, unit, operator, targetValue,
      ...(location ? { location } : {}),
      resolutionTime,
    };
  }

  // ---- crypto (CoinGecko, default for legacy configs) ----
  const assetId = String(c.assetId || '').toLowerCase();
  if (!CG_ASSETS[assetId]) throw new Error('Feed asset must be one of: ' + Object.keys(CG_ASSETS).join(', ') + '.');
  const currency = String(c.currency || 'usd').toLowerCase();
  if (!CG_CURRENCIES.includes(currency)) throw new Error('Feed currency must be usd.');
  if (!Number.isFinite(targetValue) || targetValue <= 0) throw new Error('Feed target value must be a positive number.');
  return { provider: 'coingecko', assetId, currency, operator, targetValue, resolutionTime };
}

/** normalized feed descriptor for a market row (null when the market has no feed) */
function describeFeed(m) {
  if (!m || !m.provider) return null;
  if (m.provider === 'open-meteo') {
    const met = WX_METRICS[m.metric] || { label: m.metric, emoji: '🌦️' };
    const unitLabel = (WX_UNITS[m.unit] && WX_UNITS[m.unit].metric === m.metric) ? WX_UNITS[m.unit].label : '';
    const latLon = formatLatLon(m.latitude, m.longitude);
    return {
      kind: 'weather', provider: 'open-meteo',
      latitude: m.latitude, longitude: m.longitude,
      location: m.location || null, latLonText: latLon,
      metric: m.metric, metricLabel: met.label, emoji: met.emoji,
      unit: m.unit, unitLabel,
      operator: m.operator, operatorText: OPERATOR_TEXT[m.operator] || m.operator,
      targetValue: m.targetValue,
      targetText: trimNum(m.targetValue) + unitLabel,
      resolutionTime: m.feedResolutionTime || m.closeTime,
    };
  }
  const meta = assetMeta(m.assetId);
  return {
    kind: 'crypto', provider: 'coingecko',
    assetId: m.assetId, label: meta.label, symbol: meta.symbol, emoji: meta.emoji,
    currency: (m.currency || 'usd').toUpperCase(),
    operator: m.operator, operatorText: OPERATOR_TEXT[m.operator] || m.operator,
    targetValue: m.targetValue,
    targetText: '$' + Number(m.targetValue).toLocaleString('en-US'),
    resolutionTime: m.feedResolutionTime || m.closeTime,
  };
}

function formatLatLon(lat, lon) {
  if (lat == null || lon == null) return '';
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}
function trimNum(v) {
  if (v == null || !Number.isFinite(Number(v))) return String(v);
  return String(Math.round(Number(v) * 100) / 100);
}
function assetMeta(assetId) { return CG_ASSETS[String(assetId || '').toLowerCase()] || { label: assetId, symbol: String(assetId || '').toUpperCase(), emoji: '🪙' }; }
function operatorText(op) { return OPERATOR_TEXT[op] || op; }

module.exports = {
  BaseCachingFeed, CoinGeckoFeed, OpenMeteoFeed,
  validateFeedConfig, describeFeed,
  SUPPORTED_ASSETS: CG_ASSETS, SUPPORTED_CURRENCIES: CG_CURRENCIES,
  WEATHER_METRICS: WX_METRICS, WEATHER_UNITS: WX_UNITS,
  OPERATORS, operatorText, assetMeta,
};
