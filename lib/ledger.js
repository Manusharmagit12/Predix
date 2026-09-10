'use strict';
/**
 * Ledger — immutable double-entry financial ledger.
 *
 * Every money-moving engine event posts a transaction (ltx) with entries
 * (lent) that MUST balance: total debits == total credits. Accounts:
 *   avail:<userId>                 user spendable cash
 *   rsvd:<userId>                 user cash reserved for resting buy orders
 *   wdraw:<userId>                cash escrowed in pending/approved withdrawals
 *   equity:withdraw               sink for completed (simulated) payouts
 *   collat:<marketId>:<idx>        market collateral pool ($1 per outstanding pair)
 *   equity:promo / botfunding      issuance sources (go negative)
 *   equity:opening                 balances adopted when the ledger activates
 *
 * Guarantees:
 *   • post() refuses unbalanced transactions synchronously (the engine op aborts)
 *   • PostgreSQL refuses to COMMIT an unbalanced transaction (deferred trigger)
 *   • ltx/lent are append-only (JS store guard + DB triggers)
 *   • reconcile() proves wallets + reserves + collateral pools match the ledger
 *
 * All amounts are integer BIGINT cents. Fees (none today) would simply be
 * additional balanced legs.
 */

const VALID_KINDS = new Set(['credit', 'botfunding', 'reserve', 'release', 'trade', 'mint', 'burn', 'settlement', 'opening', 'wdraw_request', 'wdraw_return', 'wdraw_complete']);

class Ledger {
  constructor(store) {
    this.db = store;
    this.enabled = true;
  }

  /**
   * post(kind, entries, refs)
   *   entries: [{ a: account, d: cents } | { a: account, c: cents }]
   *   refs:    { marketId, orderId, tradeId, userId, settlementId, memo }
   * Throws (aborting the surrounding engine transaction) if debits != credits.
   */
  post(kind, entries, refs = {}) {
    if (!this.enabled) return null;
    if (!VALID_KINDS.has(kind)) throw new Error(`ledger: unknown transaction kind '${kind}'`);
    let dr = 0, cr = 0;
    for (const e of entries) {
      if (!e.a || typeof e.a !== 'string') throw new Error('ledger: entry missing account');
      if ((e.d === undefined) === (e.c === undefined)) throw new Error(`ledger: entry '${e.a}' needs exactly one of d/c`);
      const amt = e.d !== undefined ? e.d : e.c;
      if (!Number.isInteger(amt) || amt <= 0) throw new Error(`ledger: entry '${e.a}' amount must be a positive integer (got ${amt})`);
      if (e.d !== undefined) dr += e.d; else cr += e.c;
    }
    if (dr !== cr) throw new Error(`ledger: ${kind} transaction does not balance (debits=${dr}, credits=${cr}) — refused`);
    const ts = Date.now();
    const tx = this.db.insert('ltx', {
      kind, ts,
      marketId: refs.marketId ?? null, orderId: refs.orderId ?? null, tradeId: refs.tradeId ?? null,
      userId: refs.userId ?? null, settlementId: refs.settlementId ?? null,
      memo: refs.memo || '',
    });
    for (const e of entries) {
      this.db.insert('lent', {
        txId: tx.id, account: e.a, direction: e.d !== undefined ? 'D' : 'C',
        amount: e.d !== undefined ? e.d : e.c, ts,
      });
    }
    return tx;
  }

  /* account balances computed purely from ledger rows */
  accountBalances() {
    const acct = new Map();
    for (const e of this.db.all('lent')) {
      acct.set(e.account, (acct.get(e.account) || 0) + (e.direction === 'C' ? e.amount : -e.amount));
    }
    return acct;
  }

  /**
   * reconcile() — wallets + reserves + collateral pools must match the ledger
   * exactly, every stored transaction must balance, and the whole ledger must
   * be zero-sum. Returns { violations, accounts }.
   */
  reconcile() {
    const v = [];

    // 1. every stored transaction balances (read from the rows themselves)
    const txSum = new Map();
    for (const e of this.db.all('lent')) {
      txSum.set(e.txId, (txSum.get(e.txId) || 0) + (e.direction === 'D' ? e.amount : -e.amount));
    }
    for (const [id, s] of txSum) if (s !== 0) v.push(`ledger tx ${id} unbalanced by ${s}`);

    // 2. account balances from rows
    const acct = this.accountBalances();

    // 3. double-entry closure: the ledger is zero-sum across ALL accounts
    let total = 0;
    for (const b of acct.values()) total += b;
    if (total !== 0) v.push(`ledger not zero-sum: net ${total} cents`);

    // 4. wallet.available / reserved / withdraw escrow == ledger balances
    for (const w of this.db.all('wallets')) {
      const av = acct.get(`avail:${w.userId}`) || 0;
      const rv = acct.get(`rsvd:${w.userId}`) || 0;
      const wd = acct.get(`wdraw:${w.userId}`) || 0;
      if (av !== w.available) v.push(`wallet ${w.userId}: available=${w.available} but ledger says ${av}`);
      if (rv !== w.reserved) v.push(`wallet ${w.userId}: reserved=${w.reserved} but ledger says ${rv}`);
      if (wd !== (w.withdrawReserved || 0)) v.push(`wallet ${w.userId}: withdrawReserved=${w.withdrawReserved || 0} but ledger says ${wd}`);
    }

    // 5. collateral pools == $1 × outstanding YES supply, per market+outcome
    const supply = new Map();
    for (const p of this.db.all('positions')) {
      const k = `collat:${p.marketId}:${p.outcomeIdx || 0}`;
      supply.set(k, (supply.get(k) || 0) + (p.yesQty || 0));
    }
    const pools = new Map();
    for (const [a, b] of acct) if (a.startsWith('collat:')) pools.set(a, b);
    for (const [a, y] of supply) {
      const bal = pools.get(a) || 0;
      if (bal !== 100 * y) v.push(`pool ${a}: holds ${bal}¢ but outstanding pairs need ${100 * y}¢`);
      pools.delete(a);
    }
    for (const [a, bal] of pools) if (bal !== 0) v.push(`pool ${a}: leftover ${bal}¢ with zero outstanding supply`);

    return { violations: v, accounts: acct, txCount: this.db.all('ltx').length, entryCount: this.db.all('lent').length };
  }

  /**
   * bootstrap() — adopt pre-ledger state exactly once: when the ledger is
   * empty but balances/supply exist (fresh import or first activation), post
   * an 'opening' transaction crediting every wallet and collateral pool from
   * equity:opening. No engine balances change.
   */
  bootstrap() {
    if ((this.db.all('ltx') || []).length) return false;
    const entries = [];
    for (const w of this.db.all('wallets')) {
      if (w.available) entries.push({ a: 'equity:opening', d: w.available }, { a: `avail:${w.userId}`, c: w.available });
      if (w.reserved) entries.push({ a: 'equity:opening', d: w.reserved }, { a: `rsvd:${w.userId}`, c: w.reserved });
    }
    const pools = new Map();
    for (const p of this.db.all('positions')) {
      const k = `collat:${p.marketId}:${p.outcomeIdx || 0}`;
      pools.set(k, (pools.get(k) || 0) + 100 * (p.yesQty || 0));
    }
    for (const [a, amt] of pools) if (amt) entries.push({ a: 'equity:opening', d: amt }, { a, c: amt });
    if (!entries.length) return false;
    this.post('opening', entries, { memo: 'balances adopted at ledger activation' });
    return true;
  }
}

module.exports = { Ledger };
