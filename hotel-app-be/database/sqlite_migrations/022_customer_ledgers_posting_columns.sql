-- customer_ledgers.net_amount/is_posted/posted_at exist in schema.sql
-- (PostgreSQL) but were never added to SQLite by 005's table recreation.
-- All three are read-only in repositories/ledger.rs (SELECT field lists
-- only; grepped for INSERT/UPDATE binds, found none), so plain columns
-- with schema.sql's defaults are sufficient -- no generated-column
-- semantics needed here (unlike balance_due, see migration 021).

ALTER TABLE customer_ledgers ADD COLUMN net_amount DECIMAL(10, 2);
ALTER TABLE customer_ledgers ADD COLUMN is_posted INTEGER DEFAULT 1;
ALTER TABLE customer_ledgers ADD COLUMN posted_at TIMESTAMP;
