-- (See 021_customer_ledgers_balance_due.sql for an unrelated, separately
-- discovered column gap in customer_ledgers.)
--
-- bookings.is_tourist/tourism_tax_amount/extra_bed_count/extra_bed_charge
-- exist on the bookings table in schema.sql (PostgreSQL) but were never
-- added to SQLite (a same-named extra_bed_charge column on a different
-- table in 001_initial_schema.sql masked this on a naive grep). Rust
-- already computes and binds all four on both insert and update paths
-- (repositories/bookings/lifecycle.rs) for both DB flavors -- only the
-- column definitions were missing here, surfaced by payment_record.rs
-- test failures.

ALTER TABLE bookings ADD COLUMN is_tourist INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN tourism_tax_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE bookings ADD COLUMN extra_bed_count INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN extra_bed_charge DECIMAL(10,2) DEFAULT 0;
