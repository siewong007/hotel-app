-- Migration: Customer Ledgers
-- Description: Create customer_ledgers table to track company expenses and payments

-- Create customer_ledgers table
CREATE TABLE IF NOT EXISTS customer_ledgers (
    id BIGSERIAL PRIMARY KEY,

    -- Company/Customer Information
    company_name VARCHAR(255) NOT NULL,
    company_registration_number VARCHAR(100),
    contact_person VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),

    -- Billing Address
    billing_address_line1 VARCHAR(255),
    billing_city VARCHAR(100),
    billing_state VARCHAR(100),
    billing_postal_code VARCHAR(20),
    billing_country VARCHAR(100) DEFAULT 'Malaysia',

    -- Ledger Details
    description TEXT NOT NULL,
    expense_type VARCHAR(100) NOT NULL, -- e.g., 'accommodation', 'food_beverage', 'conference', 'other'
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'MYR',

    -- Payment Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'partial', 'paid', 'overdue'
    paid_amount DECIMAL(10, 2) DEFAULT 0.00,
    balance_due DECIMAL(10, 2) GENERATED ALWAYS AS (amount - paid_amount) STORED,

    -- Payment Information (when paid)
    payment_method VARCHAR(50), -- 'bank_transfer', 'credit_card', 'cash', 'cheque'
    payment_reference VARCHAR(255),
    payment_date TIMESTAMP,

    -- Related Entities (optional)
    booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
    guest_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

    -- Invoice Details
    invoice_number VARCHAR(100) UNIQUE,
    invoice_date DATE,
    due_date DATE,

    -- Notes
    notes TEXT,
    internal_notes TEXT, -- Staff-only notes

    -- Audit fields
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT valid_paid_amount CHECK (paid_amount >= 0 AND paid_amount <= amount),
    CONSTRAINT valid_status CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'cancelled'))
);

-- Create customer_ledger_payments table for payment history
CREATE TABLE IF NOT EXISTS customer_ledger_payments (
    id BIGSERIAL PRIMARY KEY,
    ledger_id BIGINT NOT NULL REFERENCES customer_ledgers(id) ON DELETE CASCADE,

    -- Payment Details
    payment_amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_reference VARCHAR(255),
    payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Payment Proof
    receipt_number VARCHAR(100),
    receipt_file_url VARCHAR(500),

    -- Notes
    notes TEXT,

    -- Audit fields
    processed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT positive_payment CHECK (payment_amount > 0)
);

-- Create indexes for performance
CREATE INDEX idx_customer_ledgers_company ON customer_ledgers(company_name);
CREATE INDEX idx_customer_ledgers_status ON customer_ledgers(status);
CREATE INDEX idx_customer_ledgers_booking ON customer_ledgers(booking_id);
CREATE INDEX idx_customer_ledgers_guest ON customer_ledgers(guest_id);
CREATE INDEX idx_customer_ledgers_due_date ON customer_ledgers(due_date);
CREATE INDEX idx_customer_ledgers_invoice ON customer_ledgers(invoice_number);
CREATE INDEX idx_customer_ledger_payments_ledger ON customer_ledger_payments(ledger_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_customer_ledger_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_customer_ledger_timestamp
    BEFORE UPDATE ON customer_ledgers
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_ledger_timestamp();

-- Auto-generate invoice number if not provided
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invoice_number IS NULL THEN
        NEW.invoice_number := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_invoice_number
    BEFORE INSERT ON customer_ledgers
    FOR EACH ROW
    EXECUTE FUNCTION generate_invoice_number();

-- Comments
COMMENT ON TABLE customer_ledgers IS 'Tracks company expenses and customer ledger accounts';
COMMENT ON TABLE customer_ledger_payments IS 'Tracks payment history for customer ledgers';
COMMENT ON COLUMN customer_ledgers.balance_due IS 'Auto-calculated as amount - paid_amount';
COMMENT ON COLUMN customer_ledgers.status IS 'pending: not paid, partial: partially paid, paid: fully paid, overdue: past due date, cancelled: cancelled';
