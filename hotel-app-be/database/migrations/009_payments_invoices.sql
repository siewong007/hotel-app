-- ============================================================================
-- MIGRATION 009: PAYMENTS, INVOICES & SERVICES
-- ============================================================================
-- Description: Payment processing, invoicing, and additional services
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS payments_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS invoices_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS services_id_seq START WITH 1;

-- ============================================================================
-- PAYMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id BIGINT PRIMARY KEY DEFAULT nextval('payments_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method VARCHAR(50) NOT NULL,
    payment_type VARCHAR(20) DEFAULT 'booking' CHECK (payment_type IN ('booking', 'deposit', 'service', 'damage', 'refund')),
    transaction_id VARCHAR(255),
    card_last_four VARCHAR(4),
    card_brand VARCHAR(20),
    payment_gateway VARCHAR(50) DEFAULT 'stripe',
    gateway_customer_id VARCHAR(255),
    gateway_payment_intent_id VARCHAR(255),
    gateway_charge_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled')),
    failure_reason TEXT,
    refund_amount DECIMAL(12,2),
    refunded_at TIMESTAMP WITH TIME ZONE,
    refund_reason TEXT,
    gateway_refund_id VARCHAR(255),
    metadata JSONB,
    notes TEXT,
    receipt_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- INVOICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id BIGINT PRIMARY KEY DEFAULT nextval('invoices_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    bill_to_guest_id BIGINT REFERENCES guests(id),
    bill_to_corporate_id UUID REFERENCES corporate_accounts(id),
    billing_name VARCHAR(255) NOT NULL,
    billing_address TEXT,
    billing_email VARCHAR(255),
    tax_id VARCHAR(100),
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance_due DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    currency VARCHAR(3) DEFAULT 'USD',
    line_items JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'cancelled', 'refunded')),
    pdf_url TEXT,
    invoice_type VARCHAR(50) DEFAULT 'booking',
    payment_terms TEXT,
    room_charges DECIMAL(12,2) DEFAULT 0,
    service_charges DECIMAL(12,2) DEFAULT 0,
    additional_charges DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    terms TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- SERVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS services (
    id BIGINT PRIMARY KEY DEFAULT nextval('services_id_seq'),
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    unit_price DECIMAL(10,2) NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'item',
    tax_rate DECIMAL(5,2) DEFAULT 0,
    is_taxable BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- BOOKING SERVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    service_id BIGINT NOT NULL REFERENCES services(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    service_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    notes TEXT,
    delivered_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_gateway_payment_intent ON payments(gateway_payment_intent_id) WHERE gateway_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_guest ON invoices(bill_to_guest_id);
CREATE INDEX IF NOT EXISTS idx_invoices_corporate ON invoices(bill_to_corporate_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_services_booking ON booking_services(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_service ON booking_services(service_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_date ON booking_services(service_date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE payments IS 'Payment transactions';
COMMENT ON TABLE invoices IS 'Guest invoices and billing';
COMMENT ON TABLE services IS 'Additional service catalog';
COMMENT ON TABLE booking_services IS 'Services ordered by guests';
COMMENT ON COLUMN payments.payment_gateway IS 'Payment gateway used (stripe, paypal, etc.)';
COMMENT ON COLUMN invoices.line_items IS 'Invoice line items as JSON array';
