-- Keep the SQLite guest list contract aligned with the PostgreSQL guest schema
-- fields used by membership, tourist, missing-info, and credit filters.
ALTER TABLE guests ADD COLUMN deleted_at TEXT;
ALTER TABLE guests ADD COLUMN discount_percentage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guests ADD COLUMN tourism_type TEXT;
ALTER TABLE guests ADD COLUMN complimentary_nights_credit INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_guests_deleted_at ON guests(deleted_at);
CREATE INDEX IF NOT EXISTS idx_guests_guest_type ON guests(guest_type);
CREATE INDEX IF NOT EXISTS idx_guests_tourism_type ON guests(tourism_type);
