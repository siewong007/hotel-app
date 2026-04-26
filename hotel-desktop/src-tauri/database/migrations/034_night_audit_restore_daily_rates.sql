-- Migration: 034_night_audit_restore_daily_rates.sql
-- Description: Restore daily_rates support in run_night_audit. Migration 028
--              originally added per-night rate lookup, but 031 (tourism tax)
--              and 032 (extra bed) regenerated the function and silently
--              dropped that branch, causing the audit to post b.room_rate even
--              when b.daily_rates['<audit_date>'] held a different value.
--              Also reconciles posted_nights rows that disagree with daily_rates.

CREATE OR REPLACE FUNCTION run_night_audit(
    p_audit_date DATE,
    p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_audit_run_id BIGINT;
    v_bookings_posted INTEGER := 0;
    v_checkins INTEGER := 0;
    v_checkouts INTEGER := 0;
    v_revenue DECIMAL(12, 2) := 0;
    v_rooms_occupied INTEGER := 0;
    v_rooms_available INTEGER := 0;
    v_rooms_reserved INTEGER := 0;
    v_rooms_maintenance INTEGER := 0;
    v_rooms_dirty INTEGER := 0;
    v_total_rooms INTEGER := 0;
    v_occupancy_rate DECIMAL(5, 2) := 0;
    v_booking RECORD;
    v_tax_rate DECIMAL(5, 4) := 0.08;
    v_night_rate DECIMAL(10, 2);
    v_room_charge DECIMAL(10, 2);
    v_service_tax DECIMAL(10, 2);
    v_tourism_tax_per_night DECIMAL(10, 2);
    v_nights INTEGER;
    v_extra_bed_charge_per_night DECIMAL(10, 2);
    v_extra_bed_tax DECIMAL(10, 2);
    v_night_total DECIMAL(10, 2);
BEGIN
    IF EXISTS (SELECT 1 FROM night_audit_runs WHERE audit_date = p_audit_date AND status = 'completed') THEN
        RAISE EXCEPTION 'Night audit already completed for date %', p_audit_date;
    END IF;

    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    INSERT INTO night_audit_runs (audit_date, run_by, status)
    VALUES (p_audit_date, p_user_id, 'in_progress')
    RETURNING id INTO v_audit_run_id;

    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               b.daily_rates,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status NOT IN ('pending', 'confirmed', 'cancelled', 'no_show', 'voided')
        AND b.check_in_date <= p_audit_date
        AND b.check_out_date > p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        IF v_booking.daily_rates IS NOT NULL
           AND v_booking.daily_rates ? p_audit_date::TEXT THEN
            v_night_rate := (v_booking.daily_rates ->> p_audit_date::TEXT)::DECIMAL;
        ELSE
            v_night_rate := v_booking.room_rate;
        END IF;

        v_room_charge := ROUND(v_night_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_night_rate - v_room_charge;

        v_tourism_tax_per_night := 0;
        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_nights := GREATEST((v_booking.check_out_date - v_booking.check_in_date), 1);
            v_tourism_tax_per_night := ROUND(v_booking.tourism_tax_amount / v_nights, 2);
        END IF;

        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;
        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        v_night_total := v_night_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_night_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_rate', v_night_rate,
                'has_daily_rates', (v_booking.daily_rates IS NOT NULL),
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
    END LOOP;

    -- Same-day checkout (hourly stays)
    FOR v_booking IN
        SELECT b.id, b.booking_number, b.status, b.room_rate, b.total_amount,
               b.check_in_date, b.check_out_date, b.guest_id, b.room_id,
               b.daily_rates,
               COALESCE(b.is_tourist, false) as is_tourist,
               COALESCE(b.tourism_tax_amount, 0) as tourism_tax_amount,
               COALESCE(b.extra_bed_charge, 0) as extra_bed_charge
        FROM bookings b
        WHERE b.status = 'checked_out'
        AND b.check_in_date = p_audit_date
        AND b.check_out_date = p_audit_date
        AND NOT EXISTS (
            SELECT 1 FROM night_audit_posted_nights napn
            WHERE napn.booking_id = b.id AND napn.audit_date = p_audit_date
        )
    LOOP
        IF v_booking.daily_rates IS NOT NULL
           AND v_booking.daily_rates ? p_audit_date::TEXT THEN
            v_night_rate := (v_booking.daily_rates ->> p_audit_date::TEXT)::DECIMAL;
        ELSE
            v_night_rate := v_booking.room_rate;
        END IF;

        v_room_charge := ROUND(v_night_rate / (1 + v_tax_rate), 2);
        v_service_tax := v_night_rate - v_room_charge;

        v_tourism_tax_per_night := 0;
        IF v_booking.is_tourist AND v_booking.tourism_tax_amount > 0 THEN
            v_tourism_tax_per_night := v_booking.tourism_tax_amount;
        END IF;

        v_extra_bed_charge_per_night := 0;
        v_extra_bed_tax := 0;
        IF v_booking.extra_bed_charge > 0 THEN
            v_extra_bed_charge_per_night := ROUND(v_booking.extra_bed_charge / (1 + v_tax_rate), 2);
            v_extra_bed_tax := v_booking.extra_bed_charge - v_extra_bed_charge_per_night;
        END IF;

        v_night_total := v_night_rate + v_booking.extra_bed_charge + v_tourism_tax_per_night;

        INSERT INTO night_audit_posted_nights
            (booking_id, audit_date, room_rate, room_charge, service_tax, tourism_tax,
             extra_bed_charge, extra_bed_tax, total_posted, audit_run_id, posted_by)
        VALUES
            (v_booking.id, p_audit_date, v_night_rate, v_room_charge, v_service_tax,
             v_tourism_tax_per_night, v_extra_bed_charge_per_night, v_extra_bed_tax,
             v_night_total, v_audit_run_id, p_user_id);

        INSERT INTO night_audit_details (audit_run_id, booking_id, record_type, action, data)
        VALUES (v_audit_run_id, v_booking.id, 'booking', 'night_posted',
            jsonb_build_object(
                'status', v_booking.status,
                'room_rate', v_booking.room_rate,
                'night_rate', v_night_rate,
                'has_daily_rates', (v_booking.daily_rates IS NOT NULL),
                'night_date', p_audit_date,
                'room_charge', v_room_charge,
                'service_tax', v_service_tax,
                'tourism_tax', v_tourism_tax_per_night,
                'extra_bed_charge', v_extra_bed_charge_per_night,
                'extra_bed_tax', v_extra_bed_tax,
                'check_in_date', v_booking.check_in_date,
                'check_out_date', v_booking.check_out_date
            )
        );

        v_bookings_posted := v_bookings_posted + 1;
        v_revenue := v_revenue + v_night_total;
        v_checkouts := v_checkouts + 1;
    END LOOP;

    SELECT COUNT(*) INTO v_checkins FROM bookings
    WHERE status IN ('checked_in', 'auto_checked_in') AND check_in_date = p_audit_date;

    SELECT COUNT(*) INTO v_checkouts FROM bookings
    WHERE status = 'checked_out'
    AND COALESCE((actual_check_out AT TIME ZONE COALESCE((SELECT value FROM system_settings WHERE key = 'timezone'), 'UTC'))::date, check_out_date) = p_audit_date;

    SELECT COUNT(*) INTO v_total_rooms FROM rooms;

    SELECT
        COUNT(*) FILTER (WHERE status = 'available' OR status = 'clean'),
        COUNT(*) FILTER (WHERE status = 'occupied'),
        COUNT(*) FILTER (WHERE status = 'reserved'),
        COUNT(*) FILTER (WHERE status IN ('maintenance', 'out_of_order')),
        COUNT(*) FILTER (WHERE status = 'dirty' OR status = 'cleaning')
    INTO v_rooms_available, v_rooms_occupied, v_rooms_reserved, v_rooms_maintenance, v_rooms_dirty
    FROM rooms;

    SELECT COUNT(DISTINCT r.id) INTO v_rooms_occupied
    FROM rooms r
    JOIN bookings b ON r.id = b.room_id
    WHERE b.status IN ('checked_in', 'auto_checked_in')
    AND b.check_in_date <= p_audit_date
    AND b.check_out_date > p_audit_date;

    IF v_total_rooms > 0 THEN
        v_occupancy_rate := ROUND((v_rooms_occupied::DECIMAL / v_total_rooms) * 100, 2);
    END IF;

    UPDATE rooms
    SET last_posted_status = status, last_posted_date = p_audit_date;

    UPDATE night_audit_runs
    SET status = 'completed',
        total_bookings_posted = v_bookings_posted,
        total_checkins = v_checkins,
        total_checkouts = v_checkouts,
        total_revenue = v_revenue,
        total_rooms_occupied = v_rooms_occupied,
        total_rooms_available = v_rooms_available,
        occupancy_rate = v_occupancy_rate,
        rooms_available = v_rooms_available,
        rooms_occupied = v_rooms_occupied,
        rooms_reserved = v_rooms_reserved,
        rooms_maintenance = v_rooms_maintenance,
        rooms_dirty = v_rooms_dirty,
        run_at = NOW()
    WHERE id = v_audit_run_id;

    RETURN v_audit_run_id;
END;
$$ LANGUAGE plpgsql;

-- Reconcile already-posted nights whose daily_rates entry disagrees with the
-- frozen room_rate (regression introduced by 031/032). Idempotent: no-op once
-- posted rows match daily_rates.
DO $$
DECLARE
    v_tax_rate DECIMAL(5, 4) := 0.08;
    r RECORD;
    v_new_rate DECIMAL(10, 2);
    v_new_room_charge DECIMAL(10, 2);
    v_new_service_tax DECIMAL(10, 2);
    v_new_total DECIMAL(10, 2);
    v_delta DECIMAL(10, 2);
BEGIN
    BEGIN
        SELECT CAST(value AS DECIMAL) / 100.0 INTO v_tax_rate
        FROM system_settings WHERE key = 'service_tax_rate';
    EXCEPTION WHEN OTHERS THEN
        v_tax_rate := 0.08;
    END;

    FOR r IN
        SELECT napn.id AS posted_id,
               napn.audit_run_id,
               napn.tourism_tax,
               napn.extra_bed_charge,
               (b.daily_rates ->> napn.audit_date::text)::DECIMAL AS expected_rate,
               napn.total_posted AS old_total
        FROM night_audit_posted_nights napn
        JOIN bookings b ON b.id = napn.booking_id
        WHERE b.daily_rates IS NOT NULL
          AND b.daily_rates ? napn.audit_date::text
          AND (b.daily_rates ->> napn.audit_date::text)::DECIMAL <> napn.room_rate
    LOOP
        v_new_rate := r.expected_rate;
        v_new_room_charge := ROUND(v_new_rate / (1 + v_tax_rate), 2);
        v_new_service_tax := v_new_rate - v_new_room_charge;
        v_new_total := v_new_rate + r.extra_bed_charge + r.tourism_tax;
        v_delta := v_new_total - r.old_total;

        UPDATE night_audit_posted_nights
        SET room_rate = v_new_rate,
            room_charge = v_new_room_charge,
            service_tax = v_new_service_tax,
            total_posted = v_new_total
        WHERE id = r.posted_id;

        IF r.audit_run_id IS NOT NULL AND v_delta <> 0 THEN
            UPDATE night_audit_runs
            SET total_revenue = COALESCE(total_revenue, 0) + v_delta
            WHERE id = r.audit_run_id;
        END IF;
    END LOOP;
END;
$$;
