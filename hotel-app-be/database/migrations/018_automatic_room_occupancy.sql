-- Migration: Automatic Room Occupancy
-- Description: Enhance system to derive occupancy automatically from bookings
-- No manual occupancy input required - all calculated from active bookings

-- Create view for real-time room occupancy (derived from active bookings)
DROP VIEW IF EXISTS room_current_occupancy CASCADE;
CREATE OR REPLACE VIEW room_current_occupancy AS
SELECT
    r.id AS room_id,
    r.room_number,
    r.room_type_id,
    rt.name AS room_type_name,
    rt.max_occupancy,
    r.status AS room_status,
    -- Current occupancy from active checked-in booking
    COALESCE(b.adults, 0) AS current_adults,
    COALESCE(b.children, 0) AS current_children,
    COALESCE(b.infants, 0) AS current_infants,
    COALESCE(b.adults, 0) + COALESCE(b.children, 0) + COALESCE(b.infants, 0) AS current_total_guests,
    -- Occupancy percentage
    CASE
        WHEN rt.max_occupancy > 0 THEN
            ROUND(
                (COALESCE(b.adults, 0) + COALESCE(b.children, 0))::numeric /
                rt.max_occupancy * 100,
                1
            )
        ELSE 0
    END AS occupancy_percentage,
    -- Booking info for current occupancy
    b.id AS current_booking_id,
    b.booking_number AS current_booking_number,
    b.guest_id AS current_guest_id,
    b.check_in_date,
    b.check_out_date,
    -- Is room occupied?
    CASE WHEN b.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_occupied
FROM rooms r
LEFT JOIN room_types rt ON r.room_type_id = rt.id
LEFT JOIN bookings b ON r.id = b.room_id
    AND b.status = 'checked_in'
    AND CURRENT_DATE >= b.check_in_date
    AND CURRENT_DATE <= b.check_out_date
WHERE r.is_active = TRUE;

-- Create view for hotel-wide occupancy summary
DROP VIEW IF EXISTS hotel_occupancy_summary CASCADE;
CREATE OR REPLACE VIEW hotel_occupancy_summary AS
SELECT
    COUNT(*) AS total_rooms,
    COUNT(*) FILTER (WHERE is_occupied = TRUE) AS occupied_rooms,
    COUNT(*) FILTER (WHERE is_occupied = FALSE) AS available_rooms,
    ROUND(
        COUNT(*) FILTER (WHERE is_occupied = TRUE)::numeric /
        NULLIF(COUNT(*), 0) * 100,
        1
    ) AS occupancy_rate,
    -- Guest counts
    COALESCE(SUM(current_adults), 0) AS total_adults,
    COALESCE(SUM(current_children), 0) AS total_children,
    COALESCE(SUM(current_infants), 0) AS total_infants,
    COALESCE(SUM(current_total_guests), 0) AS total_guests,
    -- By room type breakdown
    COALESCE(SUM(max_occupancy), 0) AS total_capacity,
    CASE
        WHEN COALESCE(SUM(max_occupancy), 0) > 0 THEN
            ROUND(
                COALESCE(SUM(current_total_guests), 0)::numeric /
                SUM(max_occupancy) * 100,
                1
            )
        ELSE 0
    END AS guest_occupancy_rate
FROM room_current_occupancy;

-- Create view for occupancy by room type
DROP VIEW IF EXISTS occupancy_by_room_type CASCADE;
CREATE OR REPLACE VIEW occupancy_by_room_type AS
SELECT
    room_type_id,
    room_type_name,
    max_occupancy AS capacity_per_room,
    COUNT(*) AS total_rooms,
    COUNT(*) FILTER (WHERE is_occupied = TRUE) AS occupied_rooms,
    ROUND(
        COUNT(*) FILTER (WHERE is_occupied = TRUE)::numeric /
        NULLIF(COUNT(*), 0) * 100,
        1
    ) AS room_occupancy_rate,
    COALESCE(SUM(current_total_guests), 0) AS total_guests,
    COUNT(*) * max_occupancy AS total_capacity,
    CASE
        WHEN COUNT(*) * max_occupancy > 0 THEN
            ROUND(
                COALESCE(SUM(current_total_guests), 0)::numeric /
                (COUNT(*) * max_occupancy) * 100,
                1
            )
        ELSE 0
    END AS guest_occupancy_rate
FROM room_current_occupancy
GROUP BY room_type_id, room_type_name, max_occupancy
ORDER BY room_type_name;

-- Function to get room occupancy (callable from queries)
CREATE OR REPLACE FUNCTION get_room_occupancy(p_room_id BIGINT)
RETURNS TABLE(
    room_id BIGINT,
    room_number VARCHAR,
    is_occupied BOOLEAN,
    current_adults INTEGER,
    current_children INTEGER,
    current_infants INTEGER,
    current_total_guests INTEGER,
    max_occupancy INTEGER,
    occupancy_percentage NUMERIC,
    current_booking_id BIGINT,
    guest_id BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rco.room_id,
        rco.room_number,
        rco.is_occupied,
        rco.current_adults::INTEGER,
        rco.current_children::INTEGER,
        rco.current_infants::INTEGER,
        rco.current_total_guests::INTEGER,
        rco.max_occupancy,
        rco.occupancy_percentage,
        rco.current_booking_id,
        rco.current_guest_id
    FROM room_current_occupancy rco
    WHERE rco.room_id = p_room_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check if room can accommodate guests
CREATE OR REPLACE FUNCTION can_accommodate_guests(
    p_room_id BIGINT,
    p_adults INTEGER,
    p_children INTEGER DEFAULT 0
)
RETURNS BOOLEAN AS $$
DECLARE
    v_max_occupancy INTEGER;
    v_requested_guests INTEGER;
BEGIN
    -- Get room's max occupancy
    SELECT rt.max_occupancy INTO v_max_occupancy
    FROM rooms r
    JOIN room_types rt ON r.room_type_id = rt.id
    WHERE r.id = p_room_id;

    IF v_max_occupancy IS NULL THEN
        RETURN FALSE;
    END IF;

    v_requested_guests := p_adults + p_children;

    RETURN v_requested_guests <= v_max_occupancy;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate occupancy on booking insert/update
CREATE OR REPLACE FUNCTION validate_booking_occupancy()
RETURNS TRIGGER AS $$
DECLARE
    v_max_occupancy INTEGER;
    v_total_guests INTEGER;
BEGIN
    -- Get room's max occupancy
    SELECT rt.max_occupancy INTO v_max_occupancy
    FROM rooms r
    JOIN room_types rt ON r.room_type_id = rt.id
    WHERE r.id = NEW.room_id;

    -- Calculate total guests
    v_total_guests := COALESCE(NEW.adults, 1) + COALESCE(NEW.children, 0);

    -- Validate against max occupancy
    IF v_total_guests > v_max_occupancy THEN
        RAISE EXCEPTION 'Total guests (%) exceeds room maximum occupancy (%)',
            v_total_guests, v_max_occupancy;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop if exists first)
DROP TRIGGER IF EXISTS trigger_validate_booking_occupancy ON bookings;
CREATE TRIGGER trigger_validate_booking_occupancy
    BEFORE INSERT OR UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION validate_booking_occupancy();

-- Create index for faster occupancy queries
CREATE INDEX IF NOT EXISTS idx_bookings_occupancy_lookup
ON bookings(room_id, status, check_in_date, check_out_date)
WHERE status = 'checked_in';

-- Comments
COMMENT ON VIEW room_current_occupancy IS 'Real-time room occupancy derived from active bookings. No manual input required.';
COMMENT ON VIEW hotel_occupancy_summary IS 'Hotel-wide occupancy statistics calculated automatically from bookings.';
COMMENT ON VIEW occupancy_by_room_type IS 'Occupancy breakdown by room type.';
COMMENT ON FUNCTION get_room_occupancy IS 'Get current occupancy for a specific room.';
COMMENT ON FUNCTION can_accommodate_guests IS 'Check if a room can accommodate the requested number of guests.';
COMMENT ON FUNCTION validate_booking_occupancy IS 'Validates that booking guests do not exceed room capacity.';
