'use strict';
/**
 * Invariants — reusable financial/runtime validator for the trading engine.
 *
 * Pure, read-only module: scans wallets, positions, orders, live books and
 * trades and returns every violation it finds. The engine calls it after
 * every mutating operation (place / cancel / credit / funding / settlement);
 * tests call it directly. Never mutates state, never talks to the network.
 *
 * Checks
 *   W1/W2  wallet.available >= 0 and wallet.reserved >= 0 (integer cents)
 *   W3     reserved cash EXACTLY equals Σ(basis × remaining qty) of the
 *          user's resting BUY orders (no stranded/phantom cash reserves)
 *   P1/P2  positions: qty >= 0 and 0 <= reserved <= owned for YES and NO
 *   P3     position cost fields >= 0
 *   P4     reserved shares EXACTLY equal Σ remaining qty of the user's
 *          resting SELL orders, per market+outcome (no stranded share locks)
 *   S1     per market+outcome: outstanding YES supply == outstanding NO
 *          supply (mints and burns are symmetric, transfers cancel out)
 *   C1     K = Σ(available + reserved) + 100 × Σ YES supply is constant
 *          across operations — i.e. every minted pair stays fully backed by
 *          $1 of real collateral and total system cash is conserved
 *   O1..O4 order ids unique; 0 <= filled <= origQty; qty + filled ==
 *          origQty; open orders have qty >= 1
 *   B1..B4 orderIndex, in-memory books and 'open' order rows agree — no
 *          ghosts, dupes or wrong-book placements
 *   T1     trade ids unique
 *   X1     (settlement ctx) payout never exceeds the collateral the market
 *          actually holds
 *
 * ctx (optional): { kExpected, payout, collateral } — kExpected enables the
 * C1 conservation check; payout/collateral enable the X1 settlement check.
 */
function checkEngine(engine, ctx = {}) {
  const v = [];
  const db = engine.db;
  const isInt = (x) => Number.isInteger(x);

  /* ---------- wallets ---------- */
  let walletCash = 0;
  const walletsByUser = new Map();
  for (const w of db.all('wallets')) {
    walletsByUser.set(w.userId, w);
    walletCash += (w.available || 0) + (w.reserved || 0) + (w.withdrawReserved || 0);
    if (!isInt(w.available) || w.available < 0) v.push(`W1 wallet user ${w.userId}: available=${w.available}`);
    if (!isInt(w.reserved) || w.reserved < 0) v.push(`W2 wallet user ${w.userId}: reserved=${w.reserved}`);
    if (!isInt(w.withdrawReserved || 0) || w.withdrawReserved < 0) v.push(`W2 wallet user ${w.userId}: withdrawReserved=${w.withdrawReserved}`);
  }
  // W5: withdrawal escrow exactly matches pending+approved withdrawal rows
  const wdEscrow = new Map();
  for (const wd of (db.all('withdrawals') || [])) {
    if (wd.status === 'pending' || wd.status === 'approved') wdEscrow.set(wd.userId, (wdEscrow.get(wd.userId) || 0) + wd.amount);
  }
  for (const [uid, need] of wdEscrow) {
    const w = walletsByUser.get(uid);
    if (!w || (w.withdrawReserved || 0) !== need) v.push(`W5 user ${uid}: withdrawReserved=${(w && w.withdrawReserved) || 0} != escrowed withdrawals ${need}`);
  }

  /* ---------- orders (all statuses) ---------- */
  const orderIds = new Set();
  let dupOrders = 0;
  const buyReserve = new Map();     // userId -> cents that MUST be reserved
  const sellReserve = new Map();    // "uid|marketId|idx" -> {yes, no} share locks
  let openCount = 0;
  for (const o of db.all('orders')) {
    if (orderIds.has(o.id)) { dupOrders++; continue; }
    orderIds.add(o.id);
    if (!isInt(o.filled) || o.filled < 0 || o.filled > o.origQty) v.push(`O1 order ${o.id}: filled ${o.filled} > origQty ${o.origQty}`);
    if (o.qty + o.filled !== o.origQty) v.push(`O2 order ${o.id}: qty ${o.qty} + filled ${o.filled} != origQty ${o.origQty}`);
    if (o.qty < 0) v.push(`O3 order ${o.id}: negative remaining qty ${o.qty}`);
    if (o.status === 'open') {
      openCount++;
      if (o.qty < 1) v.push(`O4 order ${o.id}: open with qty ${o.qty}`);
      if (o.kind === 'BY' || o.kind === 'BN') {
        buyReserve.set(o.userId, (buyReserve.get(o.userId) || 0) + (o.basis || 0) * o.qty);
      } else {
        const k = `${o.userId}|${o.marketId}|${o.outcomeIdx || 0}`;
        const cur = sellReserve.get(k) || { yes: 0, no: 0 };
        if (o.kind === 'SY') cur.yes += o.qty; else cur.no += o.qty;
        sellReserve.set(k, cur);
      }
    }
  }
  if (dupOrders) v.push(`O1 ${dupOrders} duplicate order ids`);
  for (const [uid, w] of walletsByUser) {
    const want = buyReserve.get(uid) || 0;
    if ((w.reserved || 0) !== want) v.push(`W3 user ${uid}: wallet.reserved ${w.reserved} != resting buy reserve ${want}`);
  }

  /* ---------- positions & share locks ---------- */
  const supply = new Map(); // "marketId|idx" -> {yes, no}
  let yesSupplyAll = 0;
  for (const p of db.all('positions')) {
    const bk = `${p.marketId}|${p.outcomeIdx || 0}`;
    const s = supply.get(bk) || { yes: 0, no: 0 };
    s.yes += p.yesQty || 0; s.no += p.noQty || 0;
    supply.set(bk, s);
    yesSupplyAll += p.yesQty || 0;
    if (!isInt(p.yesQty) || p.yesQty < 0 || !isInt(p.noQty) || p.noQty < 0) v.push(`P1 position ${bk} user ${p.userId}: qty ${p.yesQty}/${p.noQty}`);
    if (!isInt(p.yesReserved) || p.yesReserved < 0 || p.yesReserved > p.yesQty) v.push(`P2 position ${bk} user ${p.userId}: yesReserved ${p.yesReserved} > owned ${p.yesQty}`);
    if (!isInt(p.noReserved) || p.noReserved < 0 || p.noReserved > p.noQty) v.push(`P2 position ${bk} user ${p.userId}: noReserved ${p.noReserved} > owned ${p.noQty}`);
    if (p.yesCost < 0 || p.noCost < 0) v.push(`P3 position ${bk} user ${p.userId}: negative cost basis`);
    const want = sellReserve.get(`${p.userId}|${bk}`) || { yes: 0, no: 0 };
    if (p.yesReserved !== want.yes) v.push(`P4 position ${bk} user ${p.userId}: yesReserved ${p.yesReserved} != resting sell lock ${want.yes}`);
    if (p.noReserved !== want.no) v.push(`P4 position ${bk} user ${p.userId}: noReserved ${p.noReserved} != resting sell lock ${want.no}`);
  }
  for (const [k, s] of supply) {
    if (s.yes !== s.no) v.push(`S1 supply mismatch ${k}: YES ${s.yes} != NO ${s.no}`);
  }

  /* ---------- live books vs index vs stored rows ---------- */
  const onBook = new Set();
  for (const [key, b] of engine.books) {
    for (const arr of [b.bids, b.asks]) {
      for (const o of arr) {
        if (onBook.has(o.id)) v.push(`B1 order ${o.id} appears on multiple book slots`);
        onBook.add(o.id);
        if (o.status !== 'open' || o.qty < 1) v.push(`B2 order ${o.id} (${o.status}, qty ${o.qty}) still on book ${key}`);
        if (String(key) !== engine.bookKeyOf(o)) v.push(`B3 order ${o.id} sits on book ${key}, belongs to ${engine.bookKeyOf(o)}`);
      }
    }
  }
  for (const o of engine.orderIndex.values()) {
    if (o.status !== 'open') v.push(`B4 orderIndex ghost: ${o.id} (${o.status})`);
    if (!onBook.has(o.id)) v.push(`B4 open order ${o.id} in index but not on any book`);
  }
  // open rows in the DB must be exactly the indexed ones
  const openRows = db.all('orders').filter((o) => o.status === 'open');
  for (const o of openRows) if (!engine.orderIndex.has(o.id)) v.push(`B4 open order ${o.id} on disk but missing from orderIndex`);

  /* ---------- trades ---------- */
  const tradeIds = new Set();
  let dupTrades = 0;
  for (const t of db.all('trades')) {
    if (tradeIds.has(t.id)) dupTrades++;
    else tradeIds.add(t.id);
  }
  if (dupTrades) v.push(`T1 ${dupTrades} duplicate trade ids`);

  /* ---------- conservation & settlement ---------- */
  const k = walletCash + 100 * yesSupplyAll;
  if (ctx.kExpected !== undefined && ctx.kExpected !== null && k !== ctx.kExpected) {
    v.push(`C1 cash/collateral NOT conserved: K=${k}, expected ${ctx.kExpected}`);
  }
  if (ctx.payout !== undefined && ctx.payout > ctx.collateral) {
    v.push(`X1 settlement paid ${ctx.payout}¢ but market only holds ${ctx.collateral}¢ collateral`);
  }

  return {
    violations: v,
    k,
    stats: { walletCash, yesSupply: yesSupplyAll, openOrders: openCount, pairs: yesSupplyAll, trades: tradeIds.size },
  };
}

module.exports = { checkEngine };
