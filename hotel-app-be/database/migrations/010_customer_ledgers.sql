-- ============================================================================
-- MIGRATION 010: CUSTOMER LEDGERS
-- ============================================================================
-- Description: Customer ledgers and account receivable payments
-- ============================================================================

-- ============================================================================
-- CUSTOMER LEDGERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_ledgers (
    id BIGSERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    company_registration_number VARCHAR(100),
    contact_person VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    billing_address_line1 VARCHAR(255),
    billing_city VARCHAR(100),
    billing_state VARCHAR(100),
    billing_postal_code VARCHAR(20),
    billing_country VARCHAR(100) DEFAULT 'Malaysia',
    description TEXT NOT NULL,
    expense_type VARCHAR(100) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'MYR',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    paid_amount DECIMAL(10, 2) DEFAULT 0.00,
    balance_due DECIMAL(10, 2) GENERATED ALWAYS AS (amount - paid_amount) STORED,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    payment_date TIMESTAMP,
    booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
    guest_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100) UNIQUE,
    invoice_date DATE,
    due_date DATE,
    notes TEXT,
    internal_notes TEXT,

    -- Ledger accounting fields
    folio_number VARCHAR(50),
    folio_type VARCHAR(50) DEFAULT 'city_ledger',
    transaction_type VARCHAR(20) DEFAULT 'debit',
    post_type VARCHAR(50),
    department_code VARCHAR(20),
    transaction_code VARCHAR(20),
    room_number VARCHAR(20),
    posting_date DATE DEFAULT CURRENT_DATE,
    transaction_date DATE DEFAULT CURRENT_DATE,
    reference_number VARCHAR(100),
    cashier_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    is_reversal BOOLEAN DEFAULT FALSE,
    original_transaction_id BIGINT REFERENCES customer_ledgers(id) ON DELETE SET NULL,
    reversal_reason TEXT,
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,
    service_charge DECIMAL(10, 2) DEFAULT 0.00,
    net_amount DECIMAL(10, 2),
    is_posted BOOLEAN DEFAULT TRUE,
    posted_at TIMESTAMP,
    void_at TIMESTAMP,
    void_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    void_reason TEXT,

    -- Audit fields
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT valid_paid_amount CHECK (paid_amount >= 0 AND paid_amount <= amount),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled')),
    CONSTRAINT valid_folio_type CHECK (folio_type IN ('guest_folio', 'master_folio', 'city_ledger', 'group_folio', 'ar_ledger')),
    CONSTRAINT valid_transaction_type CHECK (transaction_type IN ('debit', 'credit')),
    CONSTRAINT valid_post_type CHECK (post_type IS NULL OR post_type IN (
        'room_charge', 'room_tax', 'service_charge', 'tourism_tax',
        'fnb_restaurant', 'fnb_room_service', 'fnb_minibar', 'fnb_banquet',
        'laundry', 'telephone', 'internet', 'parking', 'spa', 'gym',
        'transportation', 'miscellaneous', 'advance_deposit', 'payment',
        'adjustment', 'rebate', 'discount', 'commission', 'refund',
        'transfer_in', 'transfer_out', 'city_ledger_transfer'
    ))
);

-- ============================================================================
-- CUSTOMER LEDGER PAYMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_ledger_payments (
    id BIGSERIAL PRIMARY KEY,
    ledger_id BIGINT NOT NULL REFERENCES customer_ledgers(id) ON DELETE CASCADE,
    payment_amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_reference VARCHAR(255),
    payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    receipt_number VARCHAR(100),
    receipt_file_url VARCHAR(500),
    notes TEXT,
    processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_payment CHECK (payment_amount > 0)
);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_customer_ledger_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invoice_number IS NULL THEN
        NEW.invoice_number := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_folio_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.folio_number IS NULL THEN
        NEW.folio_number := CASE NEW.folio_type
            WHEN 'guest_folio' THEN 'GF-'
            WHEN 'master_folio' THEN 'MF-'
            WHEN 'city_ledger' THEN 'CL-'
            WHEN 'group_folio' THEN 'GP-'
            WHEN 'ar_ledger' THEN 'AR-'
            ELSE 'TX-'
        END || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;
    IF NEW.net_amount IS NULL THEN
        NEW.net_amount := NEW.amount - COALESCE(NEW.tax_amount, 0) - COALESCE(NEW.service_charge, 0);
    END IF;
    IF NEW.is_posted = TRUE AND NEW.posted_at IS NULL THEN
        NEW.posted_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER trigger_update_customer_ledger_timestamp
    BEFORE UPDATE ON customer_ledgers
    FOR EACH ROW EXECUTE FUNCTION update_customer_ledger_timestamp();

CREATE TRIGGER trigger_generate_invoice_number
    BEFORE INSERT ON customer_ledgers
    FOR EACH ROW EXECUTE FUNCTION generate_invoice_number();

DROP TRIGGER IF EXISTS trigger_generate_folio_number ON customer_ledgers;
CREATE TRIGGER trigger_generate_folio_number
    BEFORE INSERT ON customer_ledgers
    FOR EACH ROW EXECUTE FUNCTION generate_folio_number();

-- ============================================================================
-- INDEXES
-- ============================================================================

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
CREATE INDEX IF NOT EXISTS idx_customer_ledger_payments_ledger ON customer_ledger_payments(ledger_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE customer_ledgers IS 'Tracks company expenses and customer ledger accounts';
COMMENT ON TABLE customer_ledger_payments IS 'Tracks payment history for customer ledgers';
COMMENT ON COLUMN customer_ledgers.balance_due IS 'Auto-calculated as amount - paid_amount';
COMMENT ON COLUMN customer_ledgers.folio_number IS 'Ledger folio number (auto-generated based on folio_type)';
COMMENT ON COLUMN customer_ledgers.folio_type IS 'Type: guest_folio, master_folio, city_ledger, group_folio, ar_ledger';
