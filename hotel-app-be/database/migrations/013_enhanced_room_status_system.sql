-- ============================================================================
-- MIGRATION 013: ENHANCED ROOM STATUS SYSTEM
-- ============================================================================
-- Description: Comprehensive room status management with state machine logic
-- Created: 2025-12-18
-- Purpose: Add 'dirty' status and implement proper status synchronization
-- ============================================================================

-- ============================================================================
-- STEP 1: Update room status enum to include 'dirty'
-- ============================================================================

-- Drop existing constraint
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;

-- Add new constraint with 'dirty' status
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check
    CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning', 'dirty', 'maintenance', 'out_of_order'));

-- ============================================================================
-- STEP 2: Create room status state machine table
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_transitions (
    from_status VARCHAR(20) NOT NULL,
    to_status VARCHAR(20) NOT NULL,
    is_allowed BOOLEAN DEFAULT true,
    requires_permission VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (from_status, to_status)
);

-- Define allowed status transitions
INSERT INTO room_status_transitions (from_status, to_status, is_allowed, requires_permission, notes) VALUES
    -- From AVAILABLE
    ('available', 'reserved', true, NULL, 'Guest reservation created'),
    ('available', 'occupied', true, NULL, 'Guest checked in'),
    ('available', 'cleaning', true, 'housekeeping', 'Scheduled cleaning'),
    ('available', 'dirty', true, 'housekeeping', 'Room marked as dirty'),
    ('available', 'maintenance', true, 'maintenance:write', 'Maintenance required'),
    ('available', 'out_of_order', true, 'rooms:write', 'Room out of service'),

    -- From RESERVED
    ('reserved', 'occupied', true, NULL, 'Guest checked in'),
    ('reserved', 'available', true, NULL, 'Reservation cancelled'),
    ('reserved', 'dirty', true, 'housekeeping', 'Previous guest left early, room dirty'),

    -- From OCCUPIED
    ('occupied', 'dirty', true, NULL, 'Guest checked out, room needs cleaning'),
    ('occupied', 'cleaning', true, 'housekeeping', 'Guest checked out, cleaning started'),
    ('occupied', 'available', true, NULL, 'Express checkout, room already clean'),
    ('occupied', 'maintenance', true, 'maintenance:write', 'Issue found during stay'),

    -- From DIRTY
    ('dirty', 'cleaning', true, 'housekeeping', 'Cleaning started'),
    ('dirty', 'available', true, 'housekeeping', 'Quick clean completed'),
    ('dirty', 'maintenance', true, 'maintenance:write', 'Issue found during inspection'),

    -- From CLEANING
    ('cleaning', 'available', true, 'housekeeping', 'Cleaning completed'),
    ('cleaning', 'dirty', true, 'housekeeping', 'Cleaning failed inspection'),
    ('cleaning', 'maintenance', true, 'maintenance:write', 'Issue found during cleaning'),

    -- From MAINTENANCE
    ('maintenance', 'available', true, 'maintenance:write', 'Maintenance completed'),
    ('maintenance', 'cleaning', true, 'maintenance:write', 'Maintenance done, needs cleaning'),
    ('maintenance', 'dirty', true, 'maintenance:write', 'Maintenance done, room is dirty'),
    ('maintenance', 'out_of_order', true, 'rooms:write', 'Severe issue found'),

    -- From OUT_OF_ORDER
    ('out_of_order', 'maintenance', true, 'rooms:write', 'Repairs starting'),
    ('out_of_order', 'available', true, 'rooms:write', 'Room restored to service')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ============================================================================
-- STEP 3: Create function to validate status transitions
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_room_status_transition(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_user_id BIGINT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_status VARCHAR(20);
    v_is_allowed BOOLEAN;
    v_required_permission VARCHAR(100);
BEGIN
    -- Get current status
    SELECT status INTO v_current_status
    FROM rooms
    WHERE id = p_room_id;

    IF v_current_status IS NULL THEN
        RAISE EXCEPTION 'Room % not found', p_room_id;
    END IF;

    -- Same status is always allowed
    IF v_current_status = p_new_status THEN
        RETURN true;
    END IF;

    -- Check if transition is allowed
    SELECT is_allowed, requires_permission
    INTO v_is_allowed, v_required_permission
    FROM room_status_transitions
    WHERE from_status = v_current_status AND to_status = p_new_status;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transition from % to % is not defined', v_current_status, p_new_status;
    END IF;

    IF NOT v_is_allowed THEN
        RAISE EXCEPTION 'Transition from % to % is not allowed', v_current_status, p_new_status;
    END IF;

    -- TODO: Add permission check if p_user_id is provided and v_required_permission is not null

    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 4: Create function to update room status with validation
-- ============================================================================

CREATE OR REPLACE FUNCTION update_room_status(
    p_room_id BIGINT,
    p_new_status VARCHAR(20),
    p_notes TEXT DEFAULT NULL,
    p_user_id BIGINT DEFAULT NULL,
    p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_old_status VARCHAR(20);
    v_is_valid BOOLEAN;
BEGIN
    -- Get current status
    SELECT status INTO v_old_status
    FROM rooms
    WHERE id = p_room_id;

    -- Validate transition
    v_is_valid := validate_room_status_transition(p_room_id, p_new_status, p_user_id);

    -- Update room status
    UPDATE rooms
    SET
        status = p_new_status,
        status_notes = p_notes,
        updated_at = CURRENT_TIMESTAMP,
        -- Update status-specific timestamps
        reserved_start_date = CASE WHEN p_new_status = 'reserved' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        reserved_end_date = CASE WHEN p_new_status = 'reserved' THEN p_end_date ELSE NULL END,
        maintenance_start_date = CASE WHEN p_new_status = 'maintenance' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        maintenance_end_date = CASE WHEN p_new_status = 'maintenance' THEN p_end_date ELSE NULL END,
        cleaning_start_date = CASE WHEN p_new_status IN ('cleaning', 'dirty') THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        cleaning_end_date = CASE WHEN p_new_status IN ('cleaning', 'dirty') THEN p_end_date ELSE NULL END
    WHERE id = p_room_id;

    -- Record in history
    INSERT INTO room_history (
        room_id,
        from_status,
        to_status,
        notes,
        start_date,
        end_date,
        changed_by,
        is_auto_generated
    ) VALUES (
        p_room_id,
        v_old_status,
        p_new_status,
        p_notes,
        p_start_date,
        p_end_date,
        p_user_id,
        p_user_id IS NULL
    );

    -- Auto-create housekeeping task if status changed to dirty or cleaning
    IF p_new_status IN ('dirty', 'cleaning') THEN
        INSERT INTO housekeeping_tasks (
            room_id,
            task_type,
            priority,
            status,
            created_by,
            notes
        ) VALUES (
            p_room_id,
            'cleaning',
            'normal',
            CASE WHEN p_new_status = 'cleaning' THEN 'in_progress' ELSE 'pending' END,
            p_user_id,
            p_notes
        )
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 5: Create trigger to auto-update room status based on bookings
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
BEGIN
    -- Get current room status
    SELECT status INTO v_current_room_status
    FROM rooms
    WHERE id = NEW.room_id;

    -- Handle booking status changes
    IF NEW.status = 'checked_in' AND v_current_room_status != 'occupied' THEN
        -- Mark room as occupied when guest checks in
        PERFORM update_room_status(
            NEW.room_id,
            'occupied',
            'Guest checked in - Booking #' || NEW.id,
            NULL,
            NEW.check_in_date,
            NEW.check_out_date
        );
    ELSIF NEW.status = 'checked_out' THEN
        -- Mark room as dirty when guest checks out
        PERFORM update_room_status(
            NEW.room_id,
            'dirty',
            'Guest checked out - Needs cleaning - Booking #' || NEW.id,
            NULL,
            CURRENT_TIMESTAMP,
            NULL
        );
    ELSIF NEW.status IN ('confirmed', 'pending') AND v_current_room_status = 'available' THEN
        -- Mark room as reserved for future bookings
        IF NEW.check_in_date::date > CURRENT_DATE THEN
            PERFORM update_room_status(
                NEW.room_id,
                'reserved',
                'Future reservation - Booking #' || NEW.id,
                NULL,
                NEW.check_in_date,
                NEW.check_out_date
            );
        END IF;
    ELSIF NEW.status IN ('cancelled', 'no_show') AND v_current_room_status IN ('reserved', 'occupied') THEN
        -- Check if room should return to available
        -- Only if there are no other active bookings
        IF NOT EXISTS (
            SELECT 1 FROM bookings
            WHERE room_id = NEW.room_id
            AND id != NEW.id
            AND status IN ('confirmed', 'pending', 'checked_in')
            AND check_out_date >= CURRENT_DATE
        ) THEN
            PERFORM update_room_status(
                NEW.room_id,
                'available',
                'Booking cancelled/no-show - Booking #' || NEW.id,
                NULL,
                NULL,
                NULL
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;

-- Create trigger on bookings table
CREATE TRIGGER trg_sync_room_status_booking
    AFTER INSERT OR UPDATE OF status ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION sync_room_status_with_booking();

-- ============================================================================
-- STEP 6: Create view for room status summary
-- ============================================================================

CREATE OR REPLACE VIEW room_status_summary AS
SELECT
    r.status,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
    json_agg(json_build_object(
        'id', r.id,
        'room_number', r.room_number,
        'floor', r.floor,
        'status_notes', r.status_notes
    ) ORDER BY r.room_number) as rooms
FROM rooms r
WHERE r.is_active = true
GROUP BY r.status
ORDER BY
    CASE r.status
        WHEN 'available' THEN 1
        WHEN 'occupied' THEN 2
        WHEN 'reserved' THEN 3
        WHEN 'dirty' THEN 4
        WHEN 'cleaning' THEN 5
        WHEN 'maintenance' THEN 6
        WHEN 'out_of_order' THEN 7
        ELSE 99
    END;

-- ============================================================================
-- STEP 7: Create function to get computed room status
-- ============================================================================

CREATE OR REPLACE FUNCTION get_computed_room_status(
    p_room_id BIGINT,
    p_reference_date DATE DEFAULT CURRENT_DATE
) RETURNS VARCHAR(20) AS $$
DECLARE
    v_room_status VARCHAR(20);
    v_active_booking_status VARCHAR(50);
    v_check_in_date DATE;
    v_check_out_date DATE;
BEGIN
    -- Get room status from rooms table
    SELECT status INTO v_room_status
    FROM rooms
    WHERE id = p_room_id;

    -- Check for active bookings
    SELECT b.status, b.check_in_date::date, b.check_out_date::date
    INTO v_active_booking_status, v_check_in_date, v_check_out_date
    FROM bookings b
    WHERE b.room_id = p_room_id
      AND b.status IN ('checked_in', 'confirmed', 'pending')
      AND b.check_in_date::date <= p_reference_date
      AND b.check_out_date::date >= p_reference_date
    ORDER BY
        CASE b.status
            WHEN 'checked_in' THEN 1
            WHEN 'confirmed' THEN 2
            WHEN 'pending' THEN 3
        END
    LIMIT 1;

    -- Priority 1: If guest is checked in, room is occupied
    IF v_active_booking_status = 'checked_in' THEN
        RETURN 'occupied';
    END IF;

    -- Priority 2: If booking exists for today/future, room is reserved
    IF v_active_booking_status IN ('confirmed', 'pending') THEN
        RETURN 'reserved';
    END IF;

    -- Priority 3: Return actual room status for dirty, cleaning, maintenance, out_of_order
    IF v_room_status IN ('dirty', 'cleaning', 'maintenance', 'out_of_order') THEN
        RETURN v_room_status;
    END IF;

    -- Priority 4: Default to available
    RETURN 'available';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 8: Update existing dirty rooms (data migration)
-- ============================================================================

-- Any rooms that were previously set to an invalid status should be reset
-- You may need to manually identify rooms that should be marked as dirty

-- Example: Mark rooms as dirty if they were recently checked out
UPDATE rooms r
SET status = 'dirty',
    cleaning_start_date = CURRENT_TIMESTAMP,
    status_notes = 'Marked dirty during migration - needs cleaning'
WHERE r.id IN (
    SELECT DISTINCT b.room_id
    FROM bookings b
    WHERE b.status = 'checked_out'
      AND b.check_out_date::date = CURRENT_DATE
      AND NOT EXISTS (
          SELECT 1 FROM housekeeping_tasks h
          WHERE h.room_id = b.room_id
            AND h.task_date = CURRENT_DATE
            AND h.status = 'completed'
      )
)
AND r.status NOT IN ('occupied', 'reserved', 'maintenance', 'out_of_order');

-- ============================================================================
-- STEP 9: Create indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_rooms_status_active ON rooms(status, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bookings_room_status_dates ON bookings(room_id, status, check_in_date, check_out_date);
CREATE INDEX IF NOT EXISTS idx_housekeeping_room_date_status ON housekeeping_tasks(room_id, task_date, status);

-- ============================================================================
-- STEP 10: Add helpful comments
-- ============================================================================

COMMENT ON TABLE room_status_transitions IS 'Defines valid room status transitions with permission requirements';
COMMENT ON FUNCTION validate_room_status_transition IS 'Validates if a room status transition is allowed';
COMMENT ON FUNCTION update_room_status IS 'Updates room status with validation and history tracking';
COMMENT ON FUNCTION sync_room_status_with_booking IS 'Trigger function to auto-sync room status with booking changes';
COMMENT ON FUNCTION get_computed_room_status IS 'Returns the computed room status based on bookings and room table';
COMMENT ON VIEW room_status_summary IS 'Summary of room counts by status';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- View all room statuses
-- SELECT * FROM room_status_summary;

-- Check specific room status
-- SELECT id, room_number, status, get_computed_room_status(id) as computed_status FROM rooms WHERE room_number = '101';

-- View status transitions
-- SELECT * FROM room_status_transitions ORDER BY from_status, to_status;

-- View recent status changes
-- SELECT rh.*, r.room_number, u.username as changed_by_user
-- FROM room_history rh
-- JOIN rooms r ON rh.room_id = r.id
-- LEFT JOIN users u ON rh.changed_by = u.id
-- ORDER BY rh.created_at DESC
-- LIMIT 20;
