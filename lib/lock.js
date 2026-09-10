'use strict';
/**
 * KeyedMutex — per-key async mutual exclusion for API-level operations.
 *
 * Financial handlers acquire the locks for the resources they touch (user
 * wallet + market) before running, so concurrent requests that share a wallet
 * or a market are strictly serialized, while UNRELATED users/markets run
 * concurrently (no global lock). Keys are acquired in sorted order, which
 * makes multi-key acquisition deadlock-free.
 */
class MutexMap {
  constructor() {
    this._locked = new Map();   // key -> true while held
    this._waiters = new Map();  // key -> [resolve] FIFO queue
  }

  _acquire(k) {
    if (!this._locked.get(k)) { this._locked.set(k, true); return Promise.resolve(); }
    const q = this._waiters.get(k) || [];
    this._waiters.set(k, q);
    return new Promise((resolve) => q.push(resolve));
  }

  _release(k) {
    const q = this._waiters.get(k);
    if (q && q.length) q.shift()(); // hand ownership straight to the next waiter
    else { this._locked.delete(k); this._waiters.delete(k); }
  }

  /** run(fn) holding all keys; keys normalized + sorted → no deadlock */
  async run(keys, fn) {
    const ks = [...new Set(keys)].sort();
    for (const k of ks) await this._acquire(k);
    try { return await fn(); } finally { for (const k of ks) this._release(k); }
  }
}

module.exports = { MutexMap };
