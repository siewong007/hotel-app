-- ============================================================================
-- MIGRATION 018: SWITCH UUID DEFAULTS TO gen_uuidv7()
-- ============================================================================
-- Description:
--   Updates every UUID column that defaults to uuid_generate_v4() so that
--   new inserts use gen_uuidv7() instead. gen_uuidv7() prefers PostgreSQL
--   18's native uuidv7() and falls back to gen_random_uuid() on older
--   clusters (see migration 015).
--
--   Existing rows keep their random v4 UUIDs — only future inserts get the
--   time-ordered v7 IDs. Mixed v4/v7 values in one column is harmless: both
--   are 128-bit and the value type is identical.
--
--   The benefit lands on the high-write tables — booking_history,
--   booking_modifications, refresh_tokens, payments, passkey_challenges —
--   because v7's monotonic prefix keeps btree pages sequential.
--
-- Postgres-only.
-- ============================================================================

-- UUID PRIMARY KEYs
ALTER TABLE refresh_tokens         ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE passkeys               ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE passkey_challenges     ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE corporate_accounts     ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE room_status_change_log ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE booking_modifications  ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE booking_history        ALTER COLUMN id SET DEFAULT gen_uuidv7();
ALTER TABLE booking_services       ALTER COLUMN id SET DEFAULT gen_uuidv7();

-- Side UUID columns (BIGINT PK + UUID UNIQUE) — same benefit on the unique
-- btree, and these columns are heavily filtered by the API surface.
ALTER TABLE users         ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE guests        ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE bookings      ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE user_sessions ALTER COLUMN session_id SET DEFAULT gen_uuidv7();
ALTER TABLE payments      ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
ALTER TABLE invoices      ALTER COLUMN uuid       SET DEFAULT gen_uuidv7();
