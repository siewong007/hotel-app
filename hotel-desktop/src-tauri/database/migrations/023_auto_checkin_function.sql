-- Migration: 022_auto_checkin_function.sql
-- Description: Create a database function to auto-check-in confirmed reservations
--              that have passed their check-in date. This provides the server-side
--              implementation for the 'auto_checked_in' booking status, which is
--              already referenced throughout queries (rooms_queries, bookings,
--              analytics, night_audit) but was only partially implemented in the
--              application-level handler (process_auto_checkin_checkout_handler).
--
-- The 'auto_checked_in' status distinguishes guests who were automatically
-- checked in (e.g., by night audit or a scheduled task) from those who were
-- manually checked in at the front desk. All existing queries already treat
-- 'auto_checked_in' identically to 'checked_in'.
--
-- Usage:
--   SELECT auto_check_in_reservations(CURRENT_DATE);
--   -- Can be called from night audit, a cron job, or the application handler.

CREATE OR REPLACE FUNCTION auto_check_in_reservations(p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER;
    v_booking RECORD;
BEGIN
    v_count := 0;

    -- Find all confirmed bookings whose check-in date has arrived or passed
    FOR v_booking IN
        SELECT b.id, b.room_id
        FROM bookings b
        WHERE b.status = 'confirmed'
          AND b.check_in_date <= p_date
          AND b.check_out_date > p_date
    LOOP
        -- Update booking status to auto_checked_in
        UPDATE bookings
        SET status = 'auto_checked_in',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_booking.id;

        -- Update the corresponding room to occupied
        UPDATE rooms
        SET status = 'occupied'
        WHERE id = v_booking.room_id;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION auto_check_in_reservations(DATE) IS
    'Auto-checks-in confirmed reservations whose check-in date is on or before '
    'the given date (and check-out date is still in the future). Updates booking '
    'status to auto_checked_in and room status to occupied. Returns the number '
    'of bookings processed. Intended to be called by night audit or a scheduled task.';
