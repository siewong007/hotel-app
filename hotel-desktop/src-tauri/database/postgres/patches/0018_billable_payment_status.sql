-- Aligns the payments-write trigger's bookings.payment_status derivation with
-- the application-layer recompute (PaymentRepository::recompute_booking_payment_status)
-- and the bookings-list queries, which already derive status live:
--
--   * 'paid' now requires the full billable total — bookings.total_amount +
--     tourism_tax_amount + extra_bed_charge — not just the room total, so a
--     booking with ancillary charges outstanding no longer reports 'paid'.
--   * The settled sum now counts completed payments excluding 'refund' AND
--     'deposit' rows: a held keycard deposit is collateral, not a charge
--     payment, and must not mark charges as settled.
--   * Voided and complimentary bookings get the same CASE the Rust recompute
--     already produces (the old trigger lacked both branches), and the row's
--     updated_at advances like the Rust path's.
--
-- The old trigger's 'refunded' outcome is dropped: the Rust recompute never
-- produces it, so app-written rows already land on 'unpaid' once every
-- charge payment is refunded. 'refunded' stays in the CHECK vocabulary for
-- legacy rows.
--
-- Idempotent by construction (CREATE OR REPLACE FUNCTION).
CREATE OR REPLACE FUNCTION public.sync_booking_payment_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_booking_id INTEGER;
    v_settled NUMERIC;
    v_new_status TEXT;
BEGIN
    -- Determine the affected booking_id (NEW for INSERT/UPDATE, OLD for DELETE)
    v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);

    -- Money that settles the booking's charges: completed payments excluding
    -- refunds and held deposits (a keycard deposit is collateral, not a room
    -- payment). Mirrors PaymentRepository::recompute_booking_payment_status.
    SELECT COALESCE(SUM(amount), 0)
      INTO v_settled
      FROM payments
     WHERE booking_id = v_booking_id
       AND status = 'completed'
       AND COALESCE(payment_type, 'booking') NOT IN ('refund', 'deposit');

    SELECT CASE
        WHEN b.status = 'voided' THEN 'void'
        WHEN COALESCE(b.is_complimentary, false) THEN COALESCE(b.payment_status, 'paid')
        WHEN (b.total_amount + COALESCE(b.tourism_tax_amount, 0)
                + COALESCE(b.extra_bed_charge, 0)) <= 0 THEN 'paid'
        WHEN v_settled >= (b.total_amount + COALESCE(b.tourism_tax_amount, 0)
                + COALESCE(b.extra_bed_charge, 0)) THEN 'paid'
        WHEN v_settled > 0 THEN 'partial'
        ELSE 'unpaid'
    END INTO v_new_status
    FROM bookings b
    WHERE b.id = v_booking_id;

    UPDATE bookings
       SET payment_status = v_new_status,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = v_booking_id;

    RETURN COALESCE(NEW, OLD);
END;
$$;
