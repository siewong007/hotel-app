-- Patch: room_types keycard deposit + service charge columns (PostgreSQL)
-- Date: 2026-07-22
--
-- Purpose: bring an ALREADY-INITIALIZED V1 PostgreSQL database up to date with
-- two columns the payments/invoices code has always queried
-- (rt.keycard_deposit_amount, rt.service_charge_percentage) but that were
-- never actually part of the room_types table in any baseline — every call to
-- POST /payments, GET /payments/calculate, POST /invoices/generate, and
-- GET /invoices/preview failed at this lookup with "column does not exist".
-- data.sql is a one-time, guarded install and must NOT be re-run against an
-- existing V1 DB, so apply this standalone script instead.
--
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-22-room-types-pricing-columns.sql
--
-- Both columns default to 0 (no business value invented here) — set real
-- per-room-type figures afterward via whatever room-type management flow
-- applies. NOT safely re-runnable (ADD COLUMN IF NOT EXISTS makes it
-- idempotent on PostgreSQL 9.6+, so it IS safe to run more than once).

BEGIN;

ALTER TABLE public.room_types
    ADD COLUMN IF NOT EXISTS keycard_deposit_amount numeric(10,2) DEFAULT 0;

ALTER TABLE public.room_types
    ADD COLUMN IF NOT EXISTS service_charge_percentage numeric(5,2) DEFAULT 0;

COMMIT;
