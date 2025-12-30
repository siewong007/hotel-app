-- ============================================================================
-- MIGRATION 008: BOOKINGS & RESERVATIONS
-- ============================================================================
-- Description: Bookings, booking guests, modifications, tourism tax, pre-check-in
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
    folio_number VARCHAR(50),

    -- Guest information
    guest_id BIGINT NOT NULL REFERENCES guests(id),
    guest_name VARCHAR(255),
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
    discount_percentage DECIMAL(5,2) DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',

    -- Rate overrides
    rate_override_weekday DECIMAL(10,2),
    rate_override_weekend DECIMAL(10,2),

    -- Tourism and extra charges
    is_tourist BOOLEAN DEFAULT false,
    tourism_tax_amount DECIMAL(10,2) DEFAULT 0,
    extra_bed_count INTEGER DEFAULT 0,
    extra_bed_charge DECIMAL(10,2) DEFAULT 0,
    room_card_deposit DECIMAL(10,2) DEFAULT 0,
    late_checkout_penalty DECIMAL(10,2) DEFAULT 0,
    is_complimentary BOOLEAN DEFAULT false,
    complimentary_reason TEXT,
    complimentary_start_date DATE,
    complimentary_end_date DATE,
    original_total_amount DECIMAL(12,2),
    complimentary_nights INTEGER DEFAULT 0,

    -- Deposit tracking
    deposit_paid BOOLEAN DEFAULT false,
    deposit_amount DECIMAL(10,2) DEFAULT 0,
    deposit_paid_at TIMESTAMP WITH TIME ZONE,

    -- Status
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
        'pending', 'confirmed', 'checked_in', 'checked_out',
        'cancelled', 'no_show', 'completed', 'complimentary', 'partial_complimentary'
    )),
    payment_status VARCHAR(30) DEFAULT 'unpaid' CHECK (payment_status IN (
        'unpaid', 'unpaid_deposit', 'paid'
    )),
    payment_method VARCHAR(100),
    market_code VARCHAR(50),

    -- Check-in/out times and tracking
    check_in_time TIME DEFAULT '15:00:00',
    check_out_time TIME DEFAULT '11:00:00',
    actual_check_in TIMESTAMP WITH TIME ZONE,
    actual_check_out TIMESTAMP WITH TIME ZONE,
    early_check_in BOOLEAN DEFAULT false,
    late_check_out BOOLEAN DEFAULT false,

    -- Pre-check-in (guest portal)
    pre_checkin_completed BOOLEAN DEFAULT FALSE,
    pre_checkin_completed_at TIMESTAMP WITH TIME ZONE,
    pre_checkin_token VARCHAR(255),
    pre_checkin_token_expires_at TIMESTAMP WITH TIME ZONE,

    -- Special requests and notes
    special_requests TEXT,
    internal_notes TEXT,
    remarks TEXT,

    -- Booking source and type
    source VARCHAR(50) DEFAULT 'direct',
    post_type VARCHAR(50) DEFAULT 'normal_stay',
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
    CONSTRAINT valid_occupancy CHECK (adults + children + infants > 0),
    CONSTRAINT valid_complimentary_dates CHECK (
        (complimentary_start_date IS NULL AND complimentary_end_date IS NULL) OR
        (complimentary_start_date IS NOT NULL AND complimentary_end_date IS NOT NULL AND
         complimentary_start_date >= check_in_date AND
         complimentary_end_date <= check_out_date AND
         complimentary_start_date < complimentary_end_date)
    )
);

-- Indexes for bookings
CREATE INDEX IF NOT EXISTS idx_bookings_complimentary_status
    ON bookings(status) WHERE status IN ('partial_complimentary', 'fully_complimentary');

-- Add foreign key for guest_complimentary_credits
ALTER TABLE guest_complimentary_credits ADD CONSTRAINT fk_guest_credits_room_type
    FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE;

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
-- BOOKING HISTORY
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

CREATE OR REPLACE FUNCTION calculate_booking_total_extended(
    p_room_rate DECIMAL, p_nights INTEGER, p_tax_rate DECIMAL DEFAULT 0.10,
    p_discount DECIMAL DEFAULT 0, p_tourism_tax_per_night DECIMAL DEFAULT 0,
    p_is_tourist BOOLEAN DEFAULT false, p_extra_bed_charge DECIMAL DEFAULT 0,
    p_late_checkout_penalty DECIMAL DEFAULT 0
)
RETURNS TABLE(subtotal DECIMAL, service_tax DECIMAL, tourism_tax DECIMAL, extra_bed_total DECIMAL, penalty_total DECIMAL, total DECIMAL) AS $$
DECLARE
    v_room_subtotal DECIMAL;
    v_service_tax DECIMAL;
    v_tourism_tax DECIMAL;
BEGIN
    v_room_subtotal := (p_room_rate * p_nights) - p_discount;
    v_service_tax := v_room_subtotal * p_tax_rate;
    v_tourism_tax := CASE WHEN p_is_tourist THEN p_tourism_tax_per_night * p_nights ELSE 0 END;
    RETURN QUERY SELECT v_room_subtotal, v_service_tax, v_tourism_tax, p_extra_bed_charge, p_late_checkout_penalty,
        v_room_subtotal + v_service_tax + v_tourism_tax + p_extra_bed_charge + p_late_checkout_penalty;
END;
$$ LANGUAGE plpgsql;

-- Trigger to sync room status with booking
CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_has_other_active_bookings BOOLEAN;
BEGIN
    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;
    SELECT EXISTS (SELECT 1 FROM bookings WHERE room_id = NEW.room_id AND id != NEW.id
        AND status IN ('confirmed', 'pending', 'checked_in') AND check_out_date >= CURRENT_DATE) INTO v_has_other_active_bookings;

    IF NEW.status = 'checked_in' AND v_current_room_status NOT IN ('occupied') THEN
        PERFORM update_room_status(NEW.room_id, 'occupied', 'Guest checked in - Booking #' || NEW.id, NULL, NEW.check_in_date, NEW.check_out_date);
    ELSIF NEW.status = 'checked_out' AND v_current_room_status = 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'dirty', 'Guest checked out - Needs cleaning - Booking #' || NEW.id, NULL, CURRENT_TIMESTAMP, NULL);
    ELSIF NEW.status IN ('confirmed', 'pending') AND v_current_room_status = 'available' AND NEW.check_in_date::date > CURRENT_DATE THEN
        PERFORM update_room_status(NEW.room_id, 'reserved', 'Future reservation - Booking #' || NEW.id, NULL, NEW.check_in_date, NEW.check_out_date);
    ELSIF NEW.status IN ('cancelled', 'no_show') AND v_current_room_status IN ('occupied', 'reserved') AND NOT v_has_other_active_bookings THEN
        PERFORM update_room_status(NEW.room_id, 'available', 'Booking cancelled/no-show - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;
CREATE TRIGGER trg_sync_room_status_booking AFTER INSERT OR UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION sync_room_status_with_booking();

-- Validate occupancy
CREATE OR REPLACE FUNCTION validate_booking_occupancy() RETURNS TRIGGER AS $$
DECLARE v_max_occupancy INTEGER; v_total_guests INTEGER;
BEGIN
    SELECT rt.max_occupancy INTO v_max_occupancy FROM rooms r JOIN room_types rt ON r.room_type_id = rt.id WHERE r.id = NEW.room_id;
    v_total_guests := COALESCE(NEW.adults, 1) + COALESCE(NEW.children, 0);
    IF v_total_guests > v_max_occupancy THEN
        RAISE EXCEPTION 'Total guests (%) exceeds room maximum occupancy (%)', v_total_guests, v_max_occupancy;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_booking_occupancy ON bookings;
CREATE TRIGGER trigger_validate_booking_occupancy BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION validate_booking_occupancy();

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW booking_summary AS
SELECT b.id, b.uuid, b.booking_number, b.status, b.payment_status,
    g.full_name as guest_name, g.email as guest_email, g.phone as guest_phone,
    r.room_number, rt.name as room_type, b.check_in_date, b.check_out_date, b.nights,
    b.adults, b.children, b.total_amount, b.currency, b.source,
    b.is_tourist, b.tourism_tax_amount, b.extra_bed_count, b.extra_bed_charge,
    b.room_card_deposit, b.late_checkout_penalty, b.payment_method, b.created_at,
    CASE WHEN b.status = 'checked_in' THEN 'In House'
        WHEN b.check_in_date = CURRENT_DATE THEN 'Arriving Today'
        WHEN b.check_out_date = CURRENT_DATE THEN 'Departing Today'
        WHEN b.check_in_date > CURRENT_DATE THEN 'Future' ELSE 'Past' END as booking_category
FROM bookings b
JOIN guests g ON b.guest_id = g.id
JOIN rooms r ON b.room_id = r.id
JOIN room_types rt ON r.room_type_id = rt.id;

CREATE OR REPLACE VIEW daily_arrivals AS
SELECT b.check_in_date as date, COUNT(*) as total_arrivals, SUM(b.adults + b.children) as total_guests,
    array_agg(b.booking_number ORDER BY b.check_in_date) as booking_numbers
FROM bookings b WHERE b.status IN ('confirmed', 'checked_in') AND b.check_in_date >= CURRENT_DATE
GROUP BY b.check_in_date ORDER BY b.check_in_date;

CREATE OR REPLACE VIEW daily_departures AS
SELECT b.check_out_date as date, COUNT(*) as total_departures, SUM(b.adults + b.children) as total_guests,
    array_agg(b.booking_number ORDER BY b.check_out_date) as booking_numbers
FROM bookings b WHERE b.status IN ('confirmed', 'checked_in') AND b.check_out_date >= CURRENT_DATE
GROUP BY b.check_out_date ORDER BY b.check_out_date;

CREATE OR REPLACE VIEW occupancy_stats AS
SELECT date_trunc('day', CURRENT_TIMESTAMP) as date, COUNT(DISTINCT r.id) as total_rooms,
    COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN r.id END) as occupied_rooms,
    COUNT(DISTINCT CASE WHEN r.status = 'available' THEN r.id END) as available_rooms,
    ROUND(COUNT(DISTINCT CASE WHEN b.status = 'checked_in' THEN r.id END)::numeric / NULLIF(COUNT(DISTINCT r.id), 0) * 100, 2) as occupancy_percentage
FROM rooms r LEFT JOIN bookings b ON r.id = b.room_id AND b.status = 'checked_in' AND CURRENT_DATE BETWEEN b.check_in_date AND b.check_out_date
WHERE r.is_active = true;

CREATE OR REPLACE VIEW revenue_summary AS
SELECT date_trunc('month', b.check_in_date) as month, COUNT(*) as total_bookings,
    SUM(b.total_amount) as total_revenue, SUM(b.subtotal) as room_revenue, SUM(b.tax_amount) as tax_collected,
    AVG(b.total_amount) as average_booking_value,
    SUM(CASE WHEN b.payment_status = 'paid' THEN b.total_amount ELSE 0 END) as collected_revenue
FROM bookings b WHERE b.status NOT IN ('cancelled', 'no_show')
GROUP BY date_trunc('month', b.check_in_date) ORDER BY month DESC;

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
CREATE INDEX IF NOT EXISTS idx_bookings_pre_checkin_token ON bookings(pre_checkin_token) WHERE pre_checkin_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_market_code ON bookings(market_code) WHERE market_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_room_status_dates ON bookings(room_id, status, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_bookings_occupancy_lookup ON bookings(room_id, status, check_in_date, check_out_date) WHERE status = 'checked_in';
CREATE INDEX IF NOT EXISTS idx_booking_guests_booking ON booking_guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_guest ON booking_guests(guest_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_booking ON booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_mods_date ON booking_modifications(modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_history(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_history_created_at ON booking_history(created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE bookings IS 'Guest reservations and bookings';
COMMENT ON TABLE booking_guests IS 'Additional guests in a booking';
COMMENT ON TABLE booking_modifications IS 'History of booking changes';
COMMENT ON TABLE booking_history IS 'Audit trail of booking status changes';
COMMENT ON COLUMN bookings.status IS 'Booking status: pending, confirmed, checked_in, checked_out, cancelled, no_show, completed, complimentarise';
COMMENT ON COLUMN bookings.is_tourist IS 'Whether the guest is a tourist (affects tourism tax calculation)';
COMMENT ON COLUMN bookings.tourism_tax_amount IS 'Tourism tax charged (per night for tourists)';
COMMENT ON COLUMN bookings.pre_checkin_completed IS 'Guest completed pre-check-in via portal';

-- ============================================================================
-- ROOM OCCUPANCY VIEWS (requires bookings table to exist)
-- ============================================================================

CREATE OR REPLACE VIEW room_current_occupancy AS
SELECT r.id AS room_id, r.room_number, r.room_type_id, rt.name AS room_type_name, rt.max_occupancy, r.status AS room_status,
    COALESCE(b.adults, 0)::INTEGER AS current_adults,
    COALESCE(b.children, 0)::INTEGER AS current_children,
    COALESCE(b.infants, 0)::INTEGER AS current_infants,
    (COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0))::INTEGER AS current_total_guests,
    CASE WHEN rt.max_occupancy > 0 THEN
        ROUND((COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0))::NUMERIC / rt.max_occupancy * 100, 1)
    ELSE NULL END AS occupancy_percentage,
    b.id AS current_booking_id, b.booking_number AS current_booking_number, b.guest_id AS current_guest_id,
    b.check_in_date,
    b.check_out_date,
    CASE WHEN b.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_occupied
FROM rooms r LEFT JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN bookings b ON r.id = b.room_id AND b.status = 'checked_in' AND CURRENT_DATE >= b.check_in_date AND CURRENT_DATE <= b.check_out_date
WHERE r.is_active = TRUE;

CREATE OR REPLACE VIEW hotel_occupancy_summary AS
SELECT COUNT(*)::BIGINT AS total_rooms,
    COUNT(*) FILTER (WHERE is_occupied = TRUE)::BIGINT AS occupied_rooms,
    COUNT(*) FILTER (WHERE is_occupied = FALSE)::BIGINT AS available_rooms,
    ROUND(COUNT(*) FILTER (WHERE is_occupied = TRUE)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS occupancy_rate,
    COALESCE(SUM(current_adults), 0)::BIGINT AS total_adults,
    COALESCE(SUM(current_children), 0)::BIGINT AS total_children,
    COALESCE(SUM(current_infants), 0)::BIGINT AS total_infants,
    COALESCE(SUM(current_total_guests), 0)::BIGINT AS total_guests,
    COALESCE(SUM(max_occupancy), 0)::BIGINT AS total_capacity,
    CASE WHEN SUM(max_occupancy) > 0 THEN
        ROUND(COALESCE(SUM(current_total_guests), 0)::NUMERIC / NULLIF(SUM(max_occupancy), 0) * 100, 1)
    ELSE NULL END AS guest_occupancy_rate
FROM room_current_occupancy;

CREATE OR REPLACE VIEW occupancy_by_room_type AS
SELECT rt.id AS room_type_id, rt.name AS room_type_name, rt.max_occupancy AS capacity_per_room,
    COUNT(r.id)::BIGINT AS total_rooms,
    COUNT(r.id) FILTER (WHERE b.id IS NOT NULL)::BIGINT AS occupied_rooms,
    ROUND(COUNT(r.id) FILTER (WHERE b.id IS NOT NULL)::NUMERIC / NULLIF(COUNT(r.id), 0) * 100, 1) AS room_occupancy_rate,
    COALESCE(SUM(COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0)), 0)::BIGINT AS total_guests,
    (COUNT(r.id) * rt.max_occupancy)::BIGINT AS total_capacity,
    CASE WHEN COUNT(r.id) * rt.max_occupancy > 0 THEN
        ROUND(COALESCE(SUM(COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0)), 0)::NUMERIC
              / NULLIF(COUNT(r.id) * rt.max_occupancy, 0) * 100, 1)
    ELSE NULL END AS guest_occupancy_rate
FROM room_types rt
LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.is_active = TRUE
LEFT JOIN bookings b ON r.id = b.room_id AND b.status = 'checked_in' AND CURRENT_DATE >= b.check_in_date AND CURRENT_DATE <= b.check_out_date
WHERE rt.is_active = TRUE
GROUP BY rt.id, rt.name, rt.max_occupancy;
