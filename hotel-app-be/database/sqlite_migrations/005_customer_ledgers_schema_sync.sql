-- Drop existing tables
DROP TABLE IF EXISTS customer_ledgers;

-- Recreate customer_ledgers matching postgres schema
CREATE TABLE IF NOT EXISTS customer_ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    company_registration_number TEXT,
    contact_person TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    billing_address_line1 TEXT,
    billing_city TEXT,
    billing_state TEXT,
    billing_postal_code TEXT,
    billing_country TEXT DEFAULT 'Malaysia',
    description TEXT NOT NULL,
    expense_type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'MYR',
    status TEXT NOT NULL DEFAULT 'pending',
    paid_amount REAL DEFAULT 0.00,
    -- SQLite does not support STORED generated columns in the same way, we can omit balance_due or use a view if necessary, but we can just use REAL DEFAULT 0.00 since it is not used in SQLite queries strictly or we can define it
    payment_method TEXT,
    payment_reference TEXT,
    payment_date TEXT,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    guest_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    invoice_number TEXT UNIQUE,
    invoice_date TEXT,
    due_date TEXT,
    notes TEXT,
    internal_notes TEXT,

    folio_number TEXT,
    folio_type TEXT DEFAULT 'city_ledger',
    transaction_type TEXT DEFAULT 'debit',
    post_type TEXT,
    department_code TEXT,
    transaction_code TEXT,
    room_number TEXT,
    posting_date TEXT DEFAULT (date('now')),
    transaction_date TEXT DEFAULT (date('now')),
    reference_number TEXT,
    cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_reversal INTEGER DEFAULT 0,
    original_transaction_id INTEGER REFERENCES customer_ledgers(id) ON DELETE SET NULL,
    reversal_reason TEXT,
    tax_amount REAL DEFAULT 0.00,
    service_charge REAL DEFAULT 0.00,

    void_at TEXT,
    void_by INTEGER REFERENCES users(id),
    void_reason TEXT,
    
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_ledger_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id INTEGER NOT NULL REFERENCES customer_ledgers(id) ON DELETE CASCADE,
    payment_amount REAL NOT NULL CHECK (payment_amount > 0),
    payment_method TEXT NOT NULL,
    payment_reference TEXT,
    payment_date TEXT NOT NULL DEFAULT (datetime('now')),
    receipt_number TEXT,
    receipt_file_url TEXT,
    notes TEXT,
    processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_ledgers_company ON customer_ledgers(company_name);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_status ON customer_ledgers(status);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_booking ON customer_ledgers(booking_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_guest ON customer_ledgers(guest_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_due_date ON customer_ledgers(due_date);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_invoice ON customer_ledgers(invoice_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_number ON customer_ledgers(folio_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_folio_type ON customer_ledgers(folio_type);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_room_number ON customer_ledgers(room_number);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_posting_date ON customer_ledgers(posting_date);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_transaction_code ON customer_ledgers(transaction_code);
CREATE INDEX IF NOT EXISTS idx_customer_ledgers_department_code ON customer_ledgers(department_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ledgers_booking_room_charge
ON customer_ledgers (booking_id)
WHERE post_type = 'room_charge'
  AND COALESCE(is_reversal, 0) = 0
  AND booking_id IS NOT NULL;

