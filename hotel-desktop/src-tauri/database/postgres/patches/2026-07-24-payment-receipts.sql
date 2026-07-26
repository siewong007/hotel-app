-- Patch: guest bank-transfer receipt requests (PostgreSQL)
-- Date: 2026-07-24
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/migrations/0001_v1_baseline.sql, which now creates
-- payment_receipt_requests. Without the table, the payment receipt endpoints
-- fail at runtime with "relation payment_receipt_requests does not exist".
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-24-payment-receipts.sql

-- Guest bank-transfer receipt request and upload metadata.
CREATE TABLE IF NOT EXISTS payment_receipt_requests (
    payment_id BIGINT PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
    requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    request_message TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_at TIMESTAMPTZ,
    receipt_path TEXT,
    receipt_content_type VARCHAR(100)
);

COMMENT ON TABLE payment_receipt_requests IS 'Guest receipt upload requests raised against a payment';
