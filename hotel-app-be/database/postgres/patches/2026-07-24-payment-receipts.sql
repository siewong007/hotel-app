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
