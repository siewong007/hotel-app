-- Automatically sync bookings.payment_status when payments are inserted, updated, or deleted.

CREATE OR REPLACE FUNCTION sync_booking_payment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_booking_id INTEGER;
    v_total_paid NUMERIC;
    v_total_amount NUMERIC;
    v_has_refunded BOOLEAN;
    v_new_status TEXT;
BEGIN
    -- Determine the affected booking_id (NEW for INSERT/UPDATE, OLD for DELETE)
    v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);

    -- Sum all completed payments for this booking
    SELECT COALESCE(SUM(amount), 0)
      INTO v_total_paid
      FROM payments
     WHERE booking_id = v_booking_id
       AND status = 'completed';

    -- Get the booking's total_amount
    SELECT total_amount
      INTO v_total_amount
      FROM bookings
     WHERE id = v_booking_id;

    -- Check if any payment has been refunded and there are no completed payments
    SELECT EXISTS (
        SELECT 1
          FROM payments
         WHERE booking_id = v_booking_id
           AND status = 'refunded'
    ) INTO v_has_refunded;

    -- Determine the new payment status
    IF v_total_paid = 0 AND v_has_refunded THEN
        v_new_status := 'refunded';
    ELSIF v_total_paid >= v_total_amount THEN
        v_new_status := 'paid';
    ELSIF v_total_paid > 0 AND v_total_paid < v_total_amount THEN
        v_new_status := 'partial';
    ELSE
        v_new_status := 'unpaid';
    END IF;

    -- Update the booking's payment status
    UPDATE bookings
       SET payment_status = v_new_status
     WHERE id = v_booking_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_booking_payment_status()
    IS 'Trigger function that recalculates and updates bookings.payment_status based on the sum of completed payments whenever a payment is inserted, updated, or deleted.';

-- Drop the trigger first if it already exists to avoid errors on re-run
DROP TRIGGER IF EXISTS trg_sync_booking_payment_status ON payments;

CREATE TRIGGER trg_sync_booking_payment_status
    AFTER INSERT OR UPDATE OR DELETE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION sync_booking_payment_status();
