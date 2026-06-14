-- Prevent duplicate company room-charge postings per booking.
--
-- A booking's auto-posted city-ledger receivable (`post_type = 'room_charge'`)
-- must be unique. Previously this was only enforced by an application-level
-- EXISTS check, which is racy: two concurrent checkout requests could both
-- observe "no row" and both insert. This partial unique index makes the
-- duplicate structurally impossible so the second writer fails with a
-- constraint violation (which the app treats as an idempotent no-op).
--
-- NOTE: the SQLite `customer_ledgers` table predates the city-ledger feature
-- and does not carry the `is_reversal` column that the PostgreSQL schema uses,
-- so this predicate omits it. The PostgreSQL index (in `schema.sql`) also
-- excludes reversal rows. SQLite is a dev/offline target; production and the
-- desktop app run PostgreSQL.

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledgers_booking_room_charge
ON customer_ledgers (booking_id)
WHERE post_type = 'room_charge'
  AND booking_id IS NOT NULL;
