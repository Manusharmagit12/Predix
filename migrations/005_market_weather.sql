-- Predix — Open-Meteo weather feeds (v5). PLAY-MONEY platform.
-- Weather markets (temperature / precipitation by location) carry their data
-- provider config on the market row, alongside the CoinGecko columns from 004.
-- The external value is used ONLY to display live reference data and to
-- generate a resolution PROPOSAL; the prediction probability always comes
-- from Predix trading, and settlement always goes through the existing
-- audited admin-confirmed resolution flow. (operator / target_value /
-- feed_resolution_time are shared with 004.)

ALTER TABLE markets ADD COLUMN latitude DOUBLE PRECISION;  -- location latitude (-90..90)
ALTER TABLE markets ADD COLUMN longitude DOUBLE PRECISION; -- location longitude (-180..180)
ALTER TABLE markets ADD COLUMN metric TEXT;                -- 'temperature' | 'precipitation'
ALTER TABLE markets ADD COLUMN unit TEXT;                  -- 'celsius'|'fahrenheit' | 'mm'|'inch'
