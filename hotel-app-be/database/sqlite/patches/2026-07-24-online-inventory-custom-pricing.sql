-- Patch: daily custom online room prices (SQLite)
-- Date: 2026-07-24
--
-- Purpose: allows the online inventory control to set a nightly price per
-- room type and stay date. A NULL custom_price continues to use the normal
-- room type / rate-plan price.
--
--   sqlite3 "$DATABASE_PATH" < database/sqlite/patches/2026-07-24-online-inventory-custom-pricing.sql
--
-- This patch is not re-runnable because SQLite does not support ADD COLUMN IF
-- NOT EXISTS. Run it once for each already-initialized V1 SQLite database.

ALTER TABLE online_inventory_allocations
    ADD COLUMN custom_price NUMERIC CHECK(custom_price IS NULL OR custom_price > 0);
