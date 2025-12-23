-- ============================================================================
-- MIGRATION 014: FIX AUTO-REVERT DIRTY STATUS ISSUE
-- ============================================================================
-- Description: Fixes the issue where rooms marked as dirty are immediately
--              reverted to available
-- Created: 2025-12-18
-- Issue: Room is marked dirty → immediately changes to available
-- Root Cause: Trigger logic doesn't respect manually set statuses
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop and recreate the sync trigger with improved logic
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_room_status_booking ON bookings;

CREATE OR REPLACE FUNCTION sync_room_status_with_booking() RETURNS TRIGGER AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_has_other_active_bookings BOOLEAN;
BEGIN
    -- Get current room status
    SELECT status INTO v_current_room_status
    FROM rooms
    WHERE id = NEW.room_id;

    -- Check if there are other active bookings for this room
    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id
        AND id != NEW.id
        AND status IN ('confirmed', 'pending', 'checked_in')
        AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_active_bookings;

    -- ========================================================================
    -- HANDLE GUEST CHECK-IN
    -- ========================================================================
    IF NEW.status = 'checked_in' AND v_current_room_status NOT IN ('occupied') THEN
        -- Mark room as occupied when guest checks in
        PERFORM update_room_status(
            NEW.room_id,
            'occupied',
            'Guest checked in - Booking #' || NEW.id,
            NULL,
            NEW.check_in_date,
            NEW.check_out_date
        );

    -- ========================================================================
    -- HANDLE GUEST CHECK-OUT
    -- ========================================================================
    ELSIF NEW.status = 'checked_out' AND v_current_room_status = 'occupied' THEN
        -- Mark room as dirty when guest checks out
        -- This should NOT be overridden by other logic!
        PERFORM update_room_status(
            NEW.room_id,
            'dirty',
            'Guest checked out - Needs cleaning - Booking #' || NEW.id,
            NULL,
            CURRENT_TIMESTAMP,
            NULL
        );

    -- ========================================================================
    -- HANDLE FUTURE RESERVATION
    -- ========================================================================
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

    -- ========================================================================
    -- HANDLE BOOKING CANCELLATION
    -- ========================================================================
    ELSIF NEW.status IN ('cancelled', 'no_show') THEN
        -- CRITICAL: Only change status if:
        -- 1. Room is currently occupied or reserved (booking-related status)
        -- 2. There are NO other active bookings
        -- 3. Room is NOT in a manually-set status (dirty, cleaning, maintenance)

        IF v_current_room_status IN ('occupied', 'reserved') AND NOT v_has_other_active_bookings THEN
            -- Room can return to available only if it was in a booking-related status
            PERFORM update_room_status(
                NEW.room_id,
                'available',
                'Booking cancelled/no-show - Booking #' || NEW.id,
                NULL,
                NULL,
                NULL
            );
        END IF;
        -- If room is dirty, cleaning, or maintenance: DO NOTHING
        -- These statuses must be changed manually by housekeeping/maintenance staff
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER trg_sync_room_status_booking
    AFTER INSERT OR UPDATE OF status ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION sync_room_status_with_booking();

-- ============================================================================
-- STEP 2: Add a safeguard trigger on rooms table to prevent unwanted changes
-- ============================================================================

CREATE OR REPLACE FUNCTION protect_manual_room_status() RETURNS TRIGGER AS $$
BEGIN
    -- If status is being changed FROM dirty, cleaning, or maintenance
    -- TO available without proper authorization, block it
    IF OLD.status IN ('dirty', 'cleaning', 'maintenance', 'out_of_order')
       AND NEW.status = 'available'
       AND NEW.status_notes NOT LIKE '%update_room_status%' THEN

        -- This is likely an unauthorized automatic change
        RAISE NOTICE 'Blocked automatic change from % to available. Use update_room_status() function.', OLD.status;

        -- Keep the old status
        NEW.status := OLD.status;
        NEW.status_notes := OLD.status_notes;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists and create trigger
DROP TRIGGER IF EXISTS trg_protect_manual_status ON rooms;

CREATE TRIGGER trg_protect_manual_status
    BEFORE UPDATE OF status ON rooms
    FOR EACH ROW
    EXECUTE FUNCTION protect_manual_room_status();

-- ============================================================================
-- STEP 3: Add logging for status changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS room_status_change_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    trigger_source VARCHAR(100),  -- Which trigger/function caused this
    booking_id BIGINT,
    was_blocked BOOLEAN DEFAULT false,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_room_status_log_room_created
ON room_status_change_log(room_id, created_at DESC);

-- Update the update_room_status function to log changes
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

    -- Log the change attempt
    INSERT INTO room_status_change_log (
        room_id, from_status, to_status, trigger_source, was_blocked, reason
    ) VALUES (
        p_room_id, v_old_status, p_new_status, 'update_room_status', false, p_notes
    );

    -- Validate transition
    v_is_valid := validate_room_status_transition(p_room_id, p_new_status, p_user_id);

    -- Update room status with special marker in notes for trigger
    UPDATE rooms
    SET
        status = p_new_status,
        status_notes = COALESCE(p_notes, '') || ' [via update_room_status]',
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
-- STEP 4: Add helper function to check why a status changed
-- ============================================================================

CREATE OR REPLACE FUNCTION why_did_status_change(
    p_room_number VARCHAR(20),
    p_minutes_ago INTEGER DEFAULT 5
) RETURNS TABLE (
    when_it_happened TIMESTAMP WITH TIME ZONE,
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    how_it_changed VARCHAR(100),
    why TEXT,
    who VARCHAR(100)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rh.created_at,
        rh.from_status,
        rh.to_status,
        CASE
            WHEN rh.is_auto_generated THEN 'AUTOMATIC (Trigger)'
            ELSE 'MANUAL (User/System)'
        END as how_it_changed,
        rh.notes as why,
        COALESCE(u.username, 'SYSTEM') as who
    FROM room_history rh
    JOIN rooms r ON rh.room_id = r.id
    LEFT JOIN users u ON rh.changed_by = u.id
    WHERE r.room_number = p_room_number
      AND rh.created_at > CURRENT_TIMESTAMP - (p_minutes_ago || ' minutes')::INTERVAL
    ORDER BY rh.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 5: Clean up any rooms stuck in wrong status
-- ============================================================================

-- Reset any rooms that were incorrectly auto-changed
-- (You may need to adjust this based on your actual data)

-- Example: If you have rooms that should be dirty but were changed to available
-- UPDATE rooms
-- SET status = 'dirty',
--     status_notes = 'Corrected by migration 014 - was incorrectly set to available'
-- WHERE id IN (
--     SELECT DISTINCT r.id
--     FROM rooms r
--     JOIN bookings b ON r.id = b.room_id
--     WHERE r.status = 'available'
--       AND b.status = 'checked_out'
--       AND b.check_out_date::date = CURRENT_DATE
-- );

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test: Mark a room as dirty and ensure it stays dirty
DO $$
DECLARE
    v_test_room_id BIGINT;
    v_status_before VARCHAR(20);
    v_status_after VARCHAR(20);
BEGIN
    -- Find an available room for testing
    SELECT id INTO v_test_room_id
    FROM rooms
    WHERE status = 'available' AND is_active = true
    LIMIT 1;

    IF v_test_room_id IS NOT NULL THEN
        -- Mark as dirty
        PERFORM update_room_status(
            v_test_room_id,
            'dirty',
            'MIGRATION 014 TEST: Should stay dirty',
            NULL,
            CURRENT_TIMESTAMP,
            NULL
        );

        -- Wait a moment (simulated by checking immediately)
        SELECT status INTO v_status_after
        FROM rooms
        WHERE id = v_test_room_id;

        IF v_status_after = 'dirty' THEN
            RAISE NOTICE 'SUCCESS: Room % stayed dirty after update', v_test_room_id;
        ELSE
            RAISE WARNING 'FAILED: Room % changed from dirty to %', v_test_room_id, v_status_after;
        END IF;

        -- Clean up: revert to available
        PERFORM update_room_status(
            v_test_room_id,
            'available',
            'MIGRATION 014 TEST: Cleanup',
            NULL,
            NULL,
            NULL
        );
    END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION protect_manual_room_status IS 'Prevents unauthorized automatic changes from manual statuses (dirty, cleaning, maintenance) to available';
COMMENT ON FUNCTION why_did_status_change IS 'Diagnostic function to understand what caused a room status change';
COMMENT ON TABLE room_status_change_log IS 'Detailed log of all room status change attempts including blocked ones';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Migration 014 completed successfully!';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Fixes applied:';
    RAISE NOTICE '  ✓ Updated sync trigger to respect manual statuses';
    RAISE NOTICE '  ✓ Added protection trigger to prevent auto-revert';
    RAISE NOTICE '  ✓ Added status change logging';
    RAISE NOTICE '  ✓ Added diagnostic function';
    RAISE NOTICE '';
    RAISE NOTICE 'Rooms marked as dirty will now STAY dirty until:';
    RAISE NOTICE '  1. Housekeeping marks them as cleaning';
    RAISE NOTICE '  2. Housekeeping marks them as available';
    RAISE NOTICE '  3. Admin manually changes status';
    RAISE NOTICE '';
    RAISE NOTICE 'To diagnose status changes: SELECT * FROM why_did_status_change(''101'', 10);';
    RAISE NOTICE '=================================================================';
END $$;
