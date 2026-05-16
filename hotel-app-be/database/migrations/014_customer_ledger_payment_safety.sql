-- ============================================================================
-- MIGRATION 014: CUSTOMER LEDGER PAYMENT SAFETY
-- ============================================================================
-- Enforce unique receipt numbers for customer-ledger payments when provided.
-- Existing blank/null receipt numbers remain allowed.

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_ledger_payments_receipt_unique
ON customer_ledger_payments (LOWER(TRIM(receipt_number)))
WHERE receipt_number IS NOT NULL AND TRIM(receipt_number) <> '';
