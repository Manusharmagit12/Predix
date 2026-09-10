-- Predix — simulated withdrawals (v3). PLAY MONEY ONLY — no real payment rails.
-- Flow: PENDING (funds escrowed in wallets.withdraw_reserved) → admin APPROVED
-- → COMPLETED (paid out through the double-entry ledger) — or CANCELLED (by the
-- user) / REJECTED (by admin), both of which refund the escrow.

ALTER TABLE wallets ADD COLUMN withdraw_reserved BIGINT NOT NULL DEFAULT 0 CHECK (withdraw_reserved >= 0);

CREATE TABLE withdrawals (
  id           BIGINT PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  amount       BIGINT NOT NULL CHECK (amount > 0),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  requested_at BIGINT NOT NULL,
  updated_at   BIGINT,
  processed_at BIGINT,
  processed_by TEXT,
  note         TEXT,
  idem_key     TEXT,
  data         JSONB NOT NULL
);
CREATE INDEX idx_withdrawals_user ON withdrawals(user_id, requested_at);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
-- one request per idempotency key per user (retry-safe duplicate protection)
CREATE UNIQUE INDEX idx_withdrawals_idem ON withdrawals(user_id, idem_key) WHERE idem_key IS NOT NULL;
