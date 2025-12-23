-- ============================================================================
-- MIGRATION 011: ADD TOURISM TAX AND EXTRA BED FIELDS
-- ============================================================================
-- Description: Add fields for tourism tax, extra bed charges, and tourist status
-- Created: 2025-01-29
-- ============================================================================

-- Add tourism and extra bed related fields to bookings table
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS is_tourist BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tourism_tax_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS extra_bed_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS extra_bed_charge DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS room_card_deposit DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS late_checkout_penalty DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100);

-- Add comments
COMMENT ON COLUMN bookings.is_tourist IS 'Whether the guest is a tourist (affects tourism tax calculation)';
COMMENT ON COLUMN bookings.tourism_tax_amount IS 'Tourism tax charged (per night for tourists)';
COMMENT ON COLUMN bookings.extra_bed_count IS 'Number of extra beds requested';
COMMENT ON COLUMN bookings.extra_bed_charge IS 'Charge for extra beds';
COMMENT ON COLUMN bookings.room_card_deposit IS 'Deposit paid for room card (refundable)';
COMMENT ON COLUMN bookings.late_checkout_penalty IS 'Penalty charged for late checkout';
COMMENT ON COLUMN bookings.payment_method IS 'Payment method used for this booking';

-- ============================================================================
-- UPDATE VIEWS TO INCLUDE NEW FIELDS
-- ============================================================================

-- Drop and recreate booking_summary view to include new fields
DROP VIEW IF EXISTS booking_summary CASCADE;
CREATE VIEW booking_summary AS
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
    b.is_tourist,
    b.tourism_tax_amount,
    b.extra_bed_count,
    b.extra_bed_charge,
    b.room_card_deposit,
    b.late_checkout_penalty,
    b.payment_method,
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

-- ============================================================================
-- UPDATE CALCULATE TOTAL FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_booking_total_extended(
    p_room_rate DECIMAL,
    p_nights INTEGER,
    p_tax_rate DECIMAL DEFAULT 0.10,
    p_discount DECIMAL DEFAULT 0,
    p_tourism_tax_per_night DECIMAL DEFAULT 0,
    p_is_tourist BOOLEAN DEFAULT false,
    p_extra_bed_charge DECIMAL DEFAULT 0,
    p_late_checkout_penalty DECIMAL DEFAULT 0
)
RETURNS TABLE(
    subtotal DECIMAL,
    service_tax DECIMAL,
    tourism_tax DECIMAL,
    extra_bed_total DECIMAL,
    penalty_total DECIMAL,
    total DECIMAL
) AS $$
DECLARE
    v_room_subtotal DECIMAL;
    v_service_tax DECIMAL;
    v_tourism_tax DECIMAL;
    v_total DECIMAL;
BEGIN
    -- Calculate room subtotal
    v_room_subtotal := (p_room_rate * p_nights) - p_discount;

    -- Calculate service tax (on room charges only)
    v_service_tax := v_room_subtotal * p_tax_rate;

    -- Calculate tourism tax (only if guest is a tourist)
    v_tourism_tax := CASE
        WHEN p_is_tourist THEN p_tourism_tax_per_night * p_nights
        ELSE 0
    END;

    -- Calculate total
    v_total := v_room_subtotal + v_service_tax + v_tourism_tax + p_extra_bed_charge + p_late_checkout_penalty;

    RETURN QUERY
    SELECT
        v_room_subtotal as subtotal,
        v_service_tax as service_tax,
        v_tourism_tax as tourism_tax,
        p_extra_bed_charge as extra_bed_total,
        p_late_checkout_penalty as penalty_total,
        v_total as total;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_booking_total_extended IS 'Calculate booking total with tourism tax, extra bed charges, and penalties';
