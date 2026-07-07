-- Guest queries select guests.is_active directly (repositories/guest.rs,
-- repositories/guest_portal.rs) but the column was never in either checked-in
-- schema; fresh databases failed with "no column found for name: is_active".
ALTER TABLE guests ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
