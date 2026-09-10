-- Predix — initial PostgreSQL schema (v1)
-- Design: every table keeps typed, constrained columns for the financially
-- critical fields (ids, money, quantities, prices, FKs) plus a `data` JSONB
-- column holding the canonical full row. Integer money everywhere (BIGINT
-- cents) — never floating point.

CREATE TABLE users (
  id          BIGINT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'user',
  created_at  BIGINT,
  data        JSONB NOT NULL
);

CREATE TABLE sessions (
  id          BIGINT PRIMARY KEY,
  token       TEXT NOT NULL,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  created_at  BIGINT,
  expires_at  BIGINT,
  data        JSONB NOT NULL
);
CREATE INDEX idx_sessions_token ON sessions(token);

CREATE TABLE wallets (
  id          BIGINT PRIMARY KEY,
  user_id     BIGINT NOT NULL UNIQUE REFERENCES users(id),
  available   BIGINT NOT NULL CHECK (available >= 0),
  reserved    BIGINT NOT NULL CHECK (reserved >= 0),
  data        JSONB NOT NULL
);

CREATE TABLE markets (
  id                BIGINT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL,
  close_time        BIGINT NOT NULL,
  created_at        BIGINT,
  resolved_at       BIGINT,
  settled_at        BIGINT,
  resolution_hash   TEXT,
  data              JSONB NOT NULL
);
CREATE INDEX idx_markets_status ON markets(status);

CREATE TABLE orders (
  id          BIGINT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  market_id   BIGINT NOT NULL REFERENCES markets(id),
  outcome_idx INT  NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL,
  type        TEXT NOT NULL,
  price       INT  CHECK (price IS NULL OR (price >= 1 AND price <= 99)),
  qty         INT  NOT NULL CHECK (qty >= 0),
  orig_qty    INT  NOT NULL CHECK (orig_qty > 0),
  filled      INT  NOT NULL DEFAULT 0 CHECK (filled >= 0 AND filled <= orig_qty),
  basis       INT  CHECK (basis IS NULL OR (basis >= 1 AND basis <= 99)),
  status      TEXT NOT NULL,
  tif         TEXT,
  stp         TEXT,
  idem_key    TEXT,
  created_at  BIGINT,
  data        JSONB NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_market ON orders(market_id, status);
CREATE INDEX idx_orders_idem ON orders(idem_key);

CREATE TABLE trades (
  id            BIGINT PRIMARY KEY,
  market_id     BIGINT NOT NULL REFERENCES markets(id),
  outcome_idx   INT NOT NULL DEFAULT 0,
  price         INT NOT NULL CHECK (price >= 1 AND price <= 99),
  qty           INT NOT NULL CHECK (qty > 0),
  ts            BIGINT NOT NULL,
  taker_user_id BIGINT,
  maker_user_id BIGINT,
  data          JSONB NOT NULL
);
CREATE INDEX idx_trades_market ON trades(market_id, ts);

CREATE TABLE positions (
  id            BIGINT PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  market_id     BIGINT NOT NULL REFERENCES markets(id),
  outcome_idx   INT NOT NULL DEFAULT 0,
  yes_qty       INT NOT NULL DEFAULT 0 CHECK (yes_qty >= 0),
  no_qty        INT NOT NULL DEFAULT 0 CHECK (no_qty >= 0),
  yes_reserved  INT NOT NULL DEFAULT 0 CHECK (yes_reserved >= 0 AND yes_reserved <= yes_qty),
  no_reserved   INT NOT NULL DEFAULT 0 CHECK (no_reserved >= 0 AND no_reserved <= no_qty),
  data          JSONB NOT NULL
);
CREATE UNIQUE INDEX idx_positions_identity ON positions(user_id, market_id, outcome_idx);

CREATE TABLE ledger (
  id            BIGINT PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  type          TEXT,
  amount        BIGINT,
  balance_after BIGINT,
  ts            BIGINT,
  data          JSONB NOT NULL
);
CREATE INDEX idx_ledger_user ON ledger(user_id, ts);

CREATE TABLE promos (
  id      BIGINT PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  amount  BIGINT,
  data    JSONB NOT NULL
);

CREATE TABLE redemptions (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  code      TEXT,
  amount    BIGINT,
  ts        BIGINT,
  data      JSONB NOT NULL
);
CREATE UNIQUE INDEX idx_redemptions_once ON redemptions(user_id, code);

CREATE TABLE watchlist (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  market_id BIGINT NOT NULL REFERENCES markets(id),
  ts        BIGINT,
  data      JSONB NOT NULL
);
CREATE UNIQUE INDEX idx_watchlist_unique ON watchlist(user_id, market_id);

CREATE TABLE notifications (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  type      TEXT,
  ts        BIGINT,
  read      BOOLEAN NOT NULL DEFAULT FALSE,
  data      JSONB NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, ts);

CREATE TABLE comments (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  market_id BIGINT NOT NULL REFERENCES markets(id),
  ts        BIGINT,
  data      JSONB NOT NULL
);
CREATE INDEX idx_comments_market ON comments(market_id, ts);

CREATE TABLE alerts (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  market_id BIGINT NOT NULL REFERENCES markets(id),
  status    TEXT,
  ts        BIGINT,
  data      JSONB NOT NULL
);
CREATE INDEX idx_alerts_user ON alerts(user_id, status);

CREATE TABLE achievements (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  code      TEXT,
  ts        BIGINT,
  data      JSONB NOT NULL
);
CREATE UNIQUE INDEX idx_achievements_once ON achievements(user_id, code);

CREATE TABLE settled (
  id          BIGINT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  market_id   BIGINT NOT NULL REFERENCES markets(id),
  outcome_idx INT NOT NULL DEFAULT 0,
  payout      BIGINT NOT NULL DEFAULT 0 CHECK (payout >= 0),
  ts          BIGINT,
  data        JSONB NOT NULL
);
CREATE INDEX idx_settled_user ON settled(user_id, ts);

-- idempotency keys: one in-flight/executed request per user+key, DB-enforced
CREATE TABLE idem (
  id        BIGINT PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id),
  key       TEXT NOT NULL,
  ts        BIGINT,
  data      JSONB NOT NULL,
  UNIQUE (user_id, key)
);

-- immutable, hash-chained resolution audit history
CREATE TABLE resolutions (
  id          BIGINT PRIMARY KEY,
  market_id   BIGINT NOT NULL REFERENCES markets(id),
  hash        TEXT NOT NULL UNIQUE,
  prev_hash   TEXT,
  resolved_at BIGINT NOT NULL,
  resolved_by JSONB,
  data        JSONB NOT NULL
);

-- database-level immutability: any UPDATE or DELETE on an audit row fails
CREATE OR REPLACE FUNCTION predix_block_resolution_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'resolutions is append-only (immutable audit history)';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS resolutions_immutable ON resolutions;
CREATE TRIGGER resolutions_immutable
  BEFORE UPDATE OR DELETE ON resolutions
  FOR EACH ROW EXECUTE FUNCTION predix_block_resolution_mutation();

-- price history (one row per (book, timestamp) sample)
CREATE TABLE market_hist (
  book_key TEXT NOT NULL,
  ts       BIGINT NOT NULL,
  price    INT  NOT NULL CHECK (price >= 0 AND price <= 100)
);
CREATE INDEX idx_market_hist ON market_hist(book_key, ts);
