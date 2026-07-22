-- Patch: room_types keycard deposit + service charge columns (SQLite)
-- Date: 2026-07-22
--
-- Purpose: bring an ALREADY-INITIALIZED V1 SQLite database up to date with two
-- columns the payments/invoices code has always queried
-- (rt.keycard_deposit_amount, rt.service_charge_percentage) but that were
-- never actually part of the room_types table in any baseline — every call to
-- POST /payments, GET /payments/calculate, POST /invoices/generate, and
-- GET /invoices/preview failed at this lookup with "no such column".
--
--   sqlite3 "$DATABASE_PATH" < database/sqlite/patches/2026-07-22-room-types-pricing-columns.sql
--
-- Both columns default to 0 (no business value invented here) — set real
-- per-room-type figures afterward via whatever room-type management flow
-- applies. UNLIKE the PostgreSQL sibling patch, this is NOT safely
-- re-runnable: SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS form, so
-- running this twice against the same database errors with "duplicate column
-- name". Run once per already-initialized database. A fresh database created
-- from the current baseline already has these columns and does not need this
-- patch at all.

ALTER TABLE room_types ADD COLUMN keycard_deposit_amount REAL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN service_charge_percentage REAL DEFAULT 0;
