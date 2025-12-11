-- ============================================================================
-- HOTEL MANAGEMENT SYSTEM - BOOKING & RESERVATION DATA SCHEMA
-- ============================================================================
-- Description: Rooms, bookings, reservations, payments, and invoicing
-- Version: 2.0
-- Created: 2025-01-29
-- ============================================================================

-- ============================================================================
-- SEQUENCES
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS room_types_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS amenities_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS rooms_id_seq START WITH 100;
CREATE SEQUENCE IF NOT EXISTS bookings_id_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS booking_guests_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS rate_plans_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS room_rates_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS payments_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS invoices_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS services_id_seq START WITH 1;

-- ============================================================================
-- ROOM MANAGEMENT
-- ============================================================================

-- Room types (Standard, Deluxe, Suite, etc.)
CREATE TABLE IF NOT EXISTS room_types (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_types_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL, -- STD, DLX, SUI, etc.
    description TEXT,
    base_occupancy INTEGER NOT NULL DEFAULT 2,
    max_occupancy INTEGER NOT NULL DEFAULT 4,
    base_price DECIMAL(10,2) NOT NULL,
    size_sqm DECIMAL(8,2), -- Room size in square meters
    bed_type VARCHAR(50), -- King, Queen, Twin, etc.
    view_type VARCHAR(50), -- City, Ocean, Garden, etc.
    floor_preference VARCHAR(50), -- Low, High, Any
    smoking_allowed BOOLEAN DEFAULT false,
    image_urls JSONB, -- Array of image URLs
    features JSONB, -- Array of features
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Amenities catalog
CREATE TABLE IF NOT EXISTS amenities (
    id BIGINT PRIMARY KEY DEFAULT nextval('amenities_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'room', 'bathroom', 'entertainment', 'service'
    icon VARCHAR(50), -- Icon name/identifier
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Room type amenities mapping
CREATE TABLE IF NOT EXISTS room_type_amenities (
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    amenity_id BIGINT NOT NULL REFERENCES amenities(id) ON DELETE CASCADE,
    is_standard BOOLEAN DEFAULT true, -- Standard vs. premium amenity
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_type_id, amenity_id)
);

-- Individual rooms
CREATE TABLE IF NOT EXISTS rooms (
    id BIGINT PRIMARY KEY DEFAULT nextval('rooms_id_seq'),
    room_number VARCHAR(20) UNIQUE NOT NULL,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id),
    floor INTEGER NOT NULL,
    building VARCHAR(50),

    -- Status
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance', 'out_of_order', 'reserved', 'cleaning')),

    -- Override room type defaults
    custom_price DECIMAL(10,2), -- Override base price
    is_accessible BOOLEAN DEFAULT false, -- ADA/wheelchair accessible

    -- Maintenance
    last_maintenance_date DATE,
    next_maintenance_date DATE,
    maintenance_notes TEXT,

    -- Custom features for this specific room
    special_features JSONB, -- Room-specific features beyond room type
    notes TEXT,

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Room availability calendar
CREATE TABLE IF NOT EXISTS room_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'booked', 'blocked', 'maintenance')),
    price DECIMAL(10,2), -- Daily rate (can vary by season/demand)
    notes TEXT,
    blocked_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (room_id, date)
);

-- ============================================================================
-- RATE MANAGEMENT
-- ============================================================================

-- Rate plans (Standard, Weekend, Holiday, Corporate, etc.)
CREATE TABLE IF NOT EXISTS rate_plans (
    id BIGINT PRIMARY KEY DEFAULT nextval('rate_plans_id_seq'),
    name VARCHAR(100) UNIQUE NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    plan_type VARCHAR(50) DEFAULT 'standard' CHECK (plan_type IN ('standard', 'seasonal', 'promotional', 'corporate', 'group', 'package')),

    -- Pricing adjustments
    adjustment_type VARCHAR(20) DEFAULT 'percentage' CHECK (adjustment_type IN ('percentage', 'fixed', 'override')),
    adjustment_value DECIMAL(10,2), -- Percentage or fixed amount

    -- Date range
    valid_from DATE,
    valid_to DATE,

    -- Day of week applicability
    applies_monday BOOLEAN DEFAULT true,
    applies_tuesday BOOLEAN DEFAULT true,
    applies_wednesday BOOLEAN DEFAULT true,
    applies_thursday BOOLEAN DEFAULT true,
    applies_friday BOOLEAN DEFAULT true,
    applies_saturday BOOLEAN DEFAULT true,
    applies_sunday BOOLEAN DEFAULT true,

    -- Booking constraints
    min_nights INTEGER DEFAULT 1,
    max_nights INTEGER,
    min_advance_booking INTEGER DEFAULT 0, -- Days
    max_advance_booking INTEGER, -- Days

    -- Restrictions
    blackout_dates JSONB, -- Array of dates when plan doesn't apply

    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0, -- Higher priority plans take precedence
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Room rates (specific prices for room types under rate plans)
CREATE TABLE IF NOT EXISTS room_rates (
    id BIGINT PRIMARY KEY DEFAULT nextval('room_rates_id_seq'),
    rate_plan_id BIGINT NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
    room_type_id BIGINT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
    price DECIMAL(10,2) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rate_plan_id, room_type_id, effective_from)
);

-- ============================================================================
-- BOOKINGS & RESERVATIONS
-- ============================================================================

-- Main bookings table
CREATE TABLE IF NOT EXISTS bookings (
    id BIGINT PRIMARY KEY DEFAULT nextval('bookings_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    booking_number VARCHAR(50) UNIQUE NOT NULL, -- BK-20250129-0001

    -- Guest information
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    corporate_account_id UUID REFERENCES corporate_accounts(id),

    -- Room and dates
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    nights INTEGER GENERATED ALWAYS AS (check_out_date - check_in_date) STORED,

    -- Occupancy
    adults INTEGER NOT NULL DEFAULT 1,
    children INTEGER DEFAULT 0,
    infants INTEGER DEFAULT 0,
    total_guests INTEGER GENERATED ALWAYS AS (adults + children + infants) STORED,

    -- Pricing
    rate_plan_id BIGINT REFERENCES rate_plans(id),
    room_rate DECIMAL(10,2) NOT NULL, -- Rate per night
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',

    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
        'pending', 'confirmed', 'checked_in', 'checked_out',
        'cancelled', 'no_show', 'completed'
    )),
    payment_status VARCHAR(20) DEFAULT 'unpaid' CHECK (payment_status IN (
        'unpaid', 'partial', 'paid', 'refunded', 'cancelled'
    )),

    -- Check-in/out tracking
    actual_check_in TIMESTAMP WITH TIME ZONE,
    actual_check_out TIMESTAMP WITH TIME ZONE,
    early_check_in BOOLEAN DEFAULT false,
    late_check_out BOOLEAN DEFAULT false,

    -- Special requests
    special_requests TEXT,
    internal_notes TEXT, -- Staff notes

    -- Booking source
    source VARCHAR(50) DEFAULT 'direct', -- 'direct', 'phone', 'booking_com', 'expedia', etc.
    channel VARCHAR(50), -- More specific channel info
    commission_rate DECIMAL(5,2), -- Commission % for OTA bookings

    -- Cancellation
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancelled_by BIGINT REFERENCES users(id),
    cancellation_reason TEXT,
    cancellation_fee DECIMAL(10,2),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by BIGINT REFERENCES users(id),

    CONSTRAINT valid_dates CHECK (check_out_date > check_in_date),
    CONSTRAINT valid_occupancy CHECK (total_guests > 0)
);

-- Additional guests in a booking
CREATE TABLE IF NOT EXISTS booking_guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('booking_guests_id_seq'),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    guest_id BIGINT REFERENCES guests(id), -- Null for walk-in additional guests
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    age_group VARCHAR(20) CHECK (age_group IN ('adult', 'child', 'infant')),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Booking modifications/changes log
CREATE TABLE IF NOT EXISTS booking_modifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    modification_type VARCHAR(50) NOT NULL, -- 'date_change', 'room_change', 'guest_change', 'rate_change'
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    price_adjustment DECIMAL(10,2) DEFAULT 0,
    modified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    modified_by BIGINT NOT NULL REFERENCES users(id)
);

-- ============================================================================
-- ADDITIONAL SERVICES
-- ============================================================================

-- Service catalog (room service, laundry, spa, etc.)
CREATE TABLE IF NOT EXISTS services (
    id BIGINT PRIMARY KEY DEFAULT nextval('services_id_seq'),
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'room_service', 'laundry', 'spa', 'transport', etc.
    description TEXT,
    unit_price DECIMAL(10,2) NOT NULL,
    unit_type VARCHAR(20) DEFAULT 'item', -- 'item', 'hour', 'person'
    tax_rate DECIMAL(5,2) DEFAULT 0,
    is_taxable BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Services ordered by guests
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
-- PAYMENTS & INVOICING
-- ============================================================================

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id BIGINT PRIMARY KEY DEFAULT nextval('payments_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,

    -- Payment details
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method VARCHAR(50) NOT NULL, -- 'credit_card', 'cash', 'bank_transfer', 'paypal', etc.
    payment_type VARCHAR(20) DEFAULT 'booking' CHECK (payment_type IN ('booking', 'deposit', 'service', 'damage', 'refund')),

    -- Card/Transaction details
    transaction_id VARCHAR(255), -- External payment processor ID
    card_last_four VARCHAR(4),
    card_brand VARCHAR(20), -- Visa, Mastercard, etc.

    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled')),

    -- Refund tracking
    refund_amount DECIMAL(12,2),
    refunded_at TIMESTAMP WITH TIME ZONE,
    refund_reason TEXT,

    -- Metadata
    notes TEXT,
    receipt_url TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_by BIGINT REFERENCES users(id)
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id BIGINT PRIMARY KEY DEFAULT nextval('invoices_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL, -- INV-20250129-0001
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,

    -- Billing information
    bill_to_guest_id BIGINT REFERENCES guests(id),
    bill_to_corporate_id UUID REFERENCES corporate_accounts(id),
    billing_name VARCHAR(255) NOT NULL,
    billing_address TEXT,
    billing_email VARCHAR(255),
    tax_id VARCHAR(100),

    -- Invoice details
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,

    -- Amounts
    subtotal DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance_due DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    currency VARCHAR(3) DEFAULT 'USD',

    -- Line items stored as JSONB
    line_items JSONB NOT NULL, -- Array of {description, quantity, unit_price, total}

    -- Status
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'cancelled', 'refunded')),

    -- PDF generation
    pdf_url TEXT,

    -- Notes
    notes TEXT,
    terms TEXT, -- Payment terms and conditions

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- HOUSEKEEPING
-- ============================================================================

-- Housekeeping tasks
CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    task_date DATE NOT NULL DEFAULT CURRENT_DATE,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('cleaning', 'turndown', 'inspection', 'maintenance', 'deep_clean')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),

    -- Assignment
    assigned_to BIGINT REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,

    -- Completion
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,

    -- Quality
    inspection_passed BOOLEAN,
    inspected_by BIGINT REFERENCES users(id),
    inspected_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    issues_found TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Room type indexes
CREATE INDEX IF NOT EXISTS idx_room_types_active ON room_types(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_room_types_code ON room_types(code);

-- Room indexes
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);
CREATE INDEX IF NOT EXISTS idx_rooms_number ON rooms(room_number);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active) WHERE is_active = true;

-- Availability indexes
CREATE INDEX IF NOT EXISTS idx_room_availability_room_date ON room_availability(room_id, date);
CREATE INDEX IF NOT EXISTS idx_room_availability_date ON room_availability(date);
CREATE INDEX IF NOT EXISTS idx_room_availability_status ON room_availability(status);

-- Rate plan indexes
CREATE INDEX IF NOT EXISTS idx_rate_plans_dates ON rate_plans(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_rate_plans_active ON rate_plans(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rate_plans_type ON rate_plans(plan_type);
CREATE INDEX IF NOT EXISTS idx_room_rates_plan ON room_rates(rate_plan_id);
CREATE INDEX IF NOT EXISTS idx_room_rates_type ON room_rates(room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_rates_dates ON room_rates(effective_from, effective_to);

-- Booking indexes
CREATE INDEX IF NOT EXISTS idx_bookings_guest ON bookings(guest_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room ON bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_check_in ON bookings(check_in_date);
CREATE INDEX IF NOT EXISTS idx_bookings_check_out ON bookings(check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_number ON bookings(booking_number);
CREATE INDEX IF NOT EXISTS idx_bookings_uuid ON bookings(uuid);
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings(source);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_corporate ON bookings(corporate_account_id) WHERE corporate_account_id IS NOT NULL;

-- Booking guests indexes
CREATE INDEX IF NOT EXISTS idx_booking_guests_booking ON booking_guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_guest ON booking_guests(guest_id);

-- Booking modifications indexes
CREATE INDEX IF NOT EXISTS idx_booking_mods_booking ON booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_date ON booking_modifications(modified_at DESC);

-- Service indexes
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_booking_services_booking ON booking_services(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_service ON booking_services(service_id);
CREATE INDEX IF NOT EXISTS idx_booking_services_date ON booking_services(service_date);

-- Payment indexes
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id) WHERE transaction_id IS NOT NULL;

-- Invoice indexes
CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_guest ON invoices(bill_to_guest_id);
CREATE INDEX IF NOT EXISTS idx_invoices_corporate ON invoices(bill_to_corporate_id);

-- Housekeeping indexes
CREATE INDEX IF NOT EXISTS idx_housekeeping_room ON housekeeping_tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_date ON housekeeping_tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON housekeeping_tasks(status);
CREATE INDEX IF NOT EXISTS idx_housekeeping_assigned ON housekeeping_tasks(assigned_to);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_room_types_updated_at
    BEFORE UPDATE ON room_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_plans_updated_at
    BEFORE UPDATE ON rate_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Available rooms view
CREATE OR REPLACE VIEW available_rooms AS
SELECT
    r.id,
    r.room_number,
    rt.name as room_type_name,
    rt.code as room_type_code,
    r.floor,
    r.status,
    COALESCE(r.custom_price, rt.base_price) as current_price,
    rt.base_occupancy,
    rt.max_occupancy,
    rt.bed_type,
    rt.view_type
FROM rooms r
JOIN room_types rt ON r.room_type_id = rt.id
WHERE r.is_active = true
  AND r.status IN ('available', 'cleaning')
  AND rt.is_active = true;

-- Booking summary view
CREATE OR REPLACE VIEW booking_summary AS
SELECT
    b.id,
    b.uuid,
    b.booking_number,
    b.status,
    b.payment_status,
    g.full_name as guest_name,
    g.email as guest_email,
    g.phone as guest_phone,
    r.room_number,
    rt.name as room_type,
    b.check_in_date,
    b.check_out_date,
    b.nights,
    b.adults,
    b.children,
    b.total_amount,
    b.currency,
    b.source,
    b.created_at,
    CASE
        WHEN b.status = 'checked_in' THEN 'In House'
        WHEN b.check_in_date = CURRENT_DATE THEN 'Arriving Today'
        WHEN b.check_out_date = CURRENT_DATE THEN 'Departing Today'
        WHEN b.check_in_date > CURRENT_DATE THEN 'Future'
        ELSE 'Past'
    END as booking_category
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id;

-- Daily arrivals view
CREATE OR REPLACE VIEW daily_arrivals AS
SELECT
    b.check_in_date as date,
    COUNT(*) as total_arrivals,
    SUM(b.adults + b.children) as total_guests,
    array_agg(b.booking_number ORDER BY b.check_in_date) as booking_numbers
FROM bookings b
WHERE b.status IN ('confirmed', 'checked_in')
  AND b.check_in_date >= CURRENT_DATE
GROUP BY b.check_in_date
ORDER BY b.check_in_date;

-- Daily departures view
CREATE OR REPLACE VIEW daily_departures AS
SELECT
    b.check_out_date as date,
    COUNT(*) as total_departures,
    SUM(b.adults + b.children) as total_guests,
    array_agg(b.booking_number ORDER BY b.check_out_date) as booking_numbers
FROM bookings b
WHERE b.status IN ('confirmed', 'checked_in')
  AND b.check_out_date >= CURRENT_DATE
GROUP BY b.check_out_date
ORDER BY b.check_out_date;

-- Occupancy statistics
CREATE OR REPLACE VIEW occupancy_stats AS
SELECT
    date_trunc('day', CURRENT_TIMESTAMP) as date,
    COUNT(DISTINCT r.id) as total_rooms,
    COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN r.id END) as occupied_rooms,
    COUNT(DISTINCT CASE WHEN r.status = 'available' THEN r.id END) as available_rooms,
    COUNT(DISTINCT CASE WHEN r.status = 'maintenance' THEN r.id END) as maintenance_rooms,
    ROUND(
        COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN r.id END)::numeric /
        NULLIF(COUNT(DISTINCT r.id), 0) * 100,
        2
    ) as occupancy_percentage
FROM rooms r
LEFT JOIN bookings b ON r.id = b.room_id
    AND b.status = 'checked_in'
    AND CURRENT_DATE BETWEEN b.check_in_date AND b.check_out_date
WHERE r.is_active = true;

-- Revenue summary
CREATE OR REPLACE VIEW revenue_summary AS
SELECT
    date_trunc('month', b.check_in_date) as month,
    COUNT(*) as total_bookings,
    SUM(b.total_amount) as total_revenue,
    SUM(b.subtotal) as room_revenue,
    SUM(b.tax_amount) as tax_collected,
    AVG(b.total_amount) as average_booking_value,
    SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END) as collected_revenue,
    SUM(CASE WHEN b.payment_status != 'paid' THEN b.total_amount ELSE 0 END) as outstanding_revenue
FROM bookings b
WHERE b.status NOT IN ('cancelled', 'no_show')
GROUP BY date_trunc('month', b.check_in_date)
ORDER BY month DESC;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to check room availability
CREATE OR REPLACE FUNCTION is_room_available(
    p_room_id BIGINT,
    p_check_in DATE,
    p_check_out DATE
)
RETURNS BOOLEAN AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM bookings
    WHERE room_id = p_room_id
      AND status NOT IN ('cancelled', 'no_show')
      AND (
          (check_in_date <= p_check_in AND check_out_date > p_check_in) OR
          (check_in_date < p_check_out AND check_out_date >= p_check_out) OR
          (check_in_date >= p_check_in AND check_out_date <= p_check_out)
      );

    RETURN v_count = 0;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate booking total
CREATE OR REPLACE FUNCTION calculate_booking_total(
    p_room_rate DECIMAL,
    p_nights INTEGER,
    p_tax_rate DECIMAL DEFAULT 0.10,
    p_discount DECIMAL DEFAULT 0
)
RETURNS TABLE(subtotal DECIMAL, tax DECIMAL, total DECIMAL) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (p_room_rate * p_nights) - p_discount as subtotal,
        ((p_room_rate * p_nights) - p_discount) * p_tax_rate as tax,
        ((p_room_rate * p_nights) - p_discount) * (1 + p_tax_rate) as total;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE room_types IS 'Room type definitions (Standard, Deluxe, Suite)';
COMMENT ON TABLE rooms IS 'Individual room inventory';
COMMENT ON TABLE bookings IS 'Guest reservations and bookings';
COMMENT ON TABLE payments IS 'Payment transactions';
COMMENT ON TABLE invoices IS 'Guest invoices and billing';
COMMENT ON TABLE services IS 'Additional service catalog';
COMMENT ON TABLE housekeeping_tasks IS 'Housekeeping and cleaning tasks';
