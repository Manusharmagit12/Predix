-- Predix — immutable double-entry financial ledger (v2)
-- Every money-moving event posts balanced entries (total debits = total credits)
-- across accounts: avail:<uid>, rsvd:<uid>, collat:<marketId>:<idx>,
-- equity:promo / equity:botfunding / equity:opening. Integer BIGINT cents only.

CREATE TABLE ltx (
  id            BIGINT PRIMARY KEY,
  kind          TEXT NOT NULL,   -- credit | botfunding | reserve | release | trade | mint | burn | settlement | opening
  ts            BIGINT NOT NULL,
  market_id     BIGINT,
  order_id      BIGINT,
  trade_id      BIGINT,
  user_id       BIGINT,
  settlement_id BIGINT,
  data          JSONB NOT NULL
);
CREATE INDEX idx_ltx_kind ON ltx(kind);
CREATE INDEX idx_ltx_market ON ltx(market_id);
CREATE INDEX idx_ltx_trade ON ltx(trade_id);
CREATE INDEX idx_ltx_user ON ltx(user_id);

CREATE TABLE lent (
  id        BIGINT PRIMARY KEY,
  tx_id     BIGINT NOT NULL REFERENCES ltx(id),
  account   TEXT NOT NULL,
  direction CHAR(1) NOT NULL CHECK (direction IN ('D', 'C')),
  amount    BIGINT NOT NULL CHECK (amount > 0),
  ts        BIGINT,
  data      JSONB NOT NULL
);
CREATE INDEX idx_lent_account ON lent(account);
CREATE INDEX idx_lent_tx ON lent(tx_id);

-- append-only protection at the database level
CREATE OR REPLACE FUNCTION predix_block_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (immutable double-entry ledger)', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ltx_immutable ON ltx;
CREATE TRIGGER ltx_immutable BEFORE UPDATE OR DELETE ON ltx
  FOR EACH ROW EXECUTE FUNCTION predix_block_ledger_mutation();

DROP TRIGGER IF EXISTS lent_immutable ON lent;
CREATE TRIGGER lent_immutable BEFORE UPDATE OR DELETE ON lent
  FOR EACH ROW EXECUTE FUNCTION predix_block_ledger_mutation();

-- the double-entry guarantee, enforced at COMMIT time: every ledger
-- transaction must satisfy total debits = total credits, or the whole
-- SQL transaction (financial mutation included) is refused.
CREATE OR REPLACE FUNCTION predix_ledger_tx_must_balance() RETURNS trigger AS $$
DECLARE delta BIGINT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN e.direction = 'D' THEN e.amount ELSE -e.amount END), 0)
    INTO delta FROM lent e WHERE e.tx_id = NEW.tx_id;
  IF delta <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (debits - credits = %)', NEW.tx_id, delta;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_balance_check ON lent;
CREATE CONSTRAINT TRIGGER ledger_balance_check
  AFTER INSERT ON lent
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION predix_ledger_tx_must_balance();
