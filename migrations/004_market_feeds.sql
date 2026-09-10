-- Predix — CoinGecko market feeds (v4). PLAY-MONEY platform.
-- Crypto price markets (Bitcoin / Ethereum) carry their data-provider config
-- directly on the market row. The external price is used ONLY to display a
-- live reference price and to generate a resolution PROPOSAL; the prediction
-- probability always comes from Predix trading, and settlement always goes
-- through the existing audited admin-confirmed resolution flow.

ALTER TABLE markets ADD COLUMN provider TEXT;              -- 'coingecko' (data provider)
ALTER TABLE markets ADD COLUMN asset_id TEXT;              -- 'bitcoin' | 'ethereum' (CoinGecko asset id)
ALTER TABLE markets ADD COLUMN currency TEXT;              -- quote currency ('usd')
ALTER TABLE markets ADD COLUMN operator TEXT;              -- comparison for resolution: >= > <= <
ALTER TABLE markets ADD COLUMN target_value DOUBLE PRECISION; -- threshold the price is compared against
ALTER TABLE markets ADD COLUMN feed_resolution_time BIGINT;   -- when the price snapshot for resolution is taken (defaults to close_time)
