-- ============================================================================
-- MIGRATION 009: BOOKINGS & RESERVATIONS
-- ============================================================================
-- Description: Bookings, booking guests, and booking modifications
-- Created: 2025-01-29
-- ============================================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS bookings_id_seq START WITH 1000;
CREATE SEQUENCE IF NOT EXISTS booking_guests_id_seq START WITH 1;

-- ============================================================================
-- BOOKINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS bookings (
    id BIGINT PRIMARY KEY DEFAULT nextval('bookings_id_seq'),
    uuid UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    booking_number VARCHAR(50) UNIQUE NOT NULL,

    -- Guest information
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    guest_name VARCHAR(255), -- Cached for performance
    guest_email VARCHAR(255),
    guest_phone VARCHAR(20),
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
    room_rate DECIMAL(10,2) NOT NULL,
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
    internal_notes TEXT,
    remarks TEXT, -- From migration 011

    -- Booking source
    source VARCHAR(50) DEFAULT 'direct',
    channel VARCHAR(50),
    commission_rate DECIMAL(5,2),

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

-- Add foreign key reference from reward_redemptions
ALTER TABLE reward_redemptions ADD CONSTRAINT fk_reward_redemptions_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- Add foreign key reference from guest_reviews
ALTER TABLE guest_reviews ADD CONSTRAINT fk_guest_reviews_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- ============================================================================
-- BOOKING GUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_guests (
    id BIGINT PRIMARY KEY DEFAULT nextval('booking_guests_id_seq'),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    guest_id BIGINT REFERENCES guests(id),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    age_group VARCHAR(20) CHECK (age_group IN ('adult', 'child', 'infant')),
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- BOOKING MODIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_modifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    modification_type VARCHAR(50) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    price_adjustment DECIMAL(10,2) DEFAULT 0,
    modified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    modified_by BIGINT NOT NULL REFERENCES users(id)
);

-- ============================================================================
-- BOOKING HISTORY (from migration 002)
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_by BIGINT REFERENCES users(id),
    change_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

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
CREATE INDEX IF NOT EXISTS idx_booking_guests_booking ON booking_guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_guest ON booking_guests(guest_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_booking ON booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_date ON booking_modifications(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_history_created_at ON booking_history(created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

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

-- Daily arrivals
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

-- Daily departures
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

COMMENT ON TABLE bookings IS 'Guest reservations and bookings';
COMMENT ON TABLE booking_guests IS 'Additional guests in a booking';
COMMENT ON TABLE booking_modifications IS 'History of booking changes';
COMMENT ON TABLE booking_history IS 'Audit trail of booking status changes';
