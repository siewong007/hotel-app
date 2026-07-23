-- Guest bank-transfer receipt request and upload metadata.
CREATE TABLE IF NOT EXISTS payment_receipt_requests (
    payment_id INTEGER PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
    requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    request_message TEXT,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_at TEXT,
    receipt_path TEXT,
    receipt_content_type TEXT
);
