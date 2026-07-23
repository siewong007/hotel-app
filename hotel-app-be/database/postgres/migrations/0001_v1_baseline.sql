-- Hotel App PostgreSQL generation 1 / version 1 baseline.
-- Fresh databases only. Generated from the converged PostgreSQL 19 schema.
\set ON_ERROR_STOP on

BEGIN;
DO $$
DECLARE
    server_version_num integer := current_setting('server_version_num')::integer;
BEGIN
    IF server_version_num < 190000 THEN
        RAISE EXCEPTION
            'Hotel App requires PostgreSQL 19 or newer; connected server_version_num is %',
            server_version_num;
    END IF;
END;
$$;

SET check_function_bodies = false;
--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: guest_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.guest_type AS ENUM (
    'member',
    'non_member'
);


--
-- Name: identificationtype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.identificationtype AS ENUM (
    'passport',
    'drivers_license',
    'national_id',
    'other'
);


--
-- Name: tourism_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tourism_type AS ENUM (
    'local',
    'foreign'
);


--
-- Name: usertype; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.usertype AS ENUM (
    'staff',
    'guest'
);


--
-- Name: auto_check_in_reservations(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_check_in_reservations(p_date date) RETURNS integer
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


--
-- Name: FUNCTION auto_check_in_reservations(p_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.auto_check_in_reservations(p_date date) IS 'Auto-checks-in confirmed reservations whose check-in date is on or before the given date (and check-out date is still in the future). Updates booking status to auto_checked_in and room status to occupied. Returns the number of bookings processed. Intended to be called by night audit or a scheduled task.';


--
-- Name: calculate_booking_total(numeric, integer, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_booking_total(p_room_rate numeric, p_nights integer, p_tax_rate numeric DEFAULT 0.10, p_discount numeric DEFAULT 0) RETURNS TABLE(subtotal numeric, tax numeric, total numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        (p_room_rate * p_nights) - p_discount as subtotal,
        ((p_room_rate * p_nights) - p_discount) * p_tax_rate as tax,
        ((p_room_rate * p_nights) - p_discount) * (1 + p_tax_rate) as total;
END;
$$;


--
-- Name: calculate_booking_total_extended(numeric, integer, numeric, numeric, numeric, boolean, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_booking_total_extended(p_room_rate numeric, p_nights integer, p_tax_rate numeric DEFAULT 0.10, p_discount numeric DEFAULT 0, p_tourism_tax_per_night numeric DEFAULT 0, p_is_tourist boolean DEFAULT false, p_extra_bed_charge numeric DEFAULT 0, p_late_checkout_penalty numeric DEFAULT 0) RETURNS TABLE(subtotal numeric, service_tax numeric, tourism_tax numeric, extra_bed_total numeric, penalty_total numeric, total numeric)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: cleanup_expired_challenges(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_challenges() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM passkey_challenges WHERE expires_at < CURRENT_TIMESTAMP;
END;
$$;


--
-- Name: cleanup_expired_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_sessions() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE user_sessions
    SET is_active = false
    WHERE expires_at < CURRENT_TIMESTAMP AND is_active = true;

    DELETE FROM refresh_tokens
    WHERE expires_at < CURRENT_TIMESTAMP AND is_revoked = false;
END;
$$;


--
-- Name: enforce_booking_tourism_tax(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_booking_tourism_tax() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_is_tourist BOOLEAN := false;
    v_tourism_tax_rate NUMERIC := 10;
    v_billable_nights INTEGER := 1;
BEGIN
    SELECT COALESCE(
        (
            SELECT CASE
                WHEN trim(value) ~ '^[0-9]+(\.[0-9]+)?$' AND trim(value)::numeric > 0
                    THEN trim(value)::numeric
                ELSE NULL
            END
            FROM system_settings
            WHERE key = 'tourism_tax_rate'
            LIMIT 1
        ),
        10
    )
    INTO v_tourism_tax_rate;

    SELECT COALESCE(g.tourism_type::text = 'foreign', false)
    INTO v_is_tourist
    FROM guests g
    WHERE g.id = NEW.guest_id;

    v_billable_nights := GREATEST((NEW.check_out_date - NEW.check_in_date), 1);

    NEW.is_tourist := COALESCE(v_is_tourist, false);
    NEW.tourism_tax_amount := CASE
        WHEN NEW.is_tourist THEN v_tourism_tax_rate * v_billable_nights
        ELSE 0
    END;

    RETURN NEW;
END;
$_$;


--
-- Name: ensure_audit_logs_partition(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_audit_logs_partition(p_month date) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
    start_date date := date_trunc('month', p_month)::date;
    end_date   date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
    part_name  text := format('audit_logs_%s', to_char(start_date, 'YYYY_MM'));
BEGIN
    -- Schema-qualify the DDL: the pinned search_path puts pg_catalog first, so
    -- an unqualified CREATE TABLE would (illegally) target the system catalog.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = part_name AND relnamespace = 'public'::regnamespace
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM public.audit_logs_default
            WHERE created_at >= start_date::timestamptz
              AND created_at < end_date::timestamptz
            LIMIT 1
        ) THEN
            -- PostgreSQL 19 can split the DEFAULT partition in place. Unlike a
            -- late CREATE/ATTACH, this moves already-arrived rows into the new
            -- month while copying the parent's indexes and triggers.
            EXECUTE format(
                'ALTER TABLE public.audit_logs SPLIT PARTITION audit_logs_default INTO (PARTITION public.%I FOR VALUES FROM (%L) TO (%L), PARTITION public.audit_logs_default DEFAULT)',
                part_name, start_date, end_date
            );
        ELSE
            EXECUTE format(
                'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
                part_name, start_date, end_date
            );
        END IF;
    END IF;
END;
$$;


--
-- Name: FUNCTION ensure_audit_logs_partition(p_month date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.ensure_audit_logs_partition(p_month date) IS 'Idempotently creates the monthly audit_logs partition covering the given month. PostgreSQL 19 SPLIT PARTITION moves matching rows out of the DEFAULT partition when a month is created late. Pre-create months during maintenance because splitting takes exclusive locks and can move data.';


--
-- Name: gen_uuidv7(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gen_uuidv7() RETURNS uuid
    LANGUAGE sql
    SET search_path TO 'pg_catalog', 'public'
    AS $$SELECT pg_catalog.uuidv7()$$;


--
-- Name: FUNCTION gen_uuidv7(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.gen_uuidv7() IS 'Time-ordered native UUIDv7 for the PostgreSQL 19 baseline. Prefer this for new UUID defaults so writes land sequentially in btree pages.';


--
-- Name: generate_folio_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_folio_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.folio_number IS NULL THEN
        NEW.folio_number := CASE NEW.folio_type
            WHEN 'guest_folio' THEN 'GF-'
            WHEN 'master_folio' THEN 'MF-'
            WHEN 'city_ledger' THEN 'CL-'
            WHEN 'group_folio' THEN 'GP-'
            WHEN 'ar_ledger' THEN 'AR-'
            ELSE 'TX-'
        END || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(NEW.id::TEXT, 6, '0');
    END IF;
    IF NEW.net_amount IS NULL THEN
        NEW.net_amount := NEW.amount - COALESCE(NEW.tax_amount, 0) - COALESCE(NEW.service_charge, 0);
    END IF;
    IF NEW.is_posted = TRUE AND NEW.posted_at IS NULL THEN
        NEW.posted_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: generate_invoice_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_invoice_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_prefix TEXT;
    v_next_seq INTEGER;
BEGIN
    IF NEW.invoice_number IS NULL THEN
        v_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-';

        SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 12) AS INTEGER)), 0)
          INTO v_next_seq
          FROM (
              SELECT invoice_number FROM invoices
               WHERE invoice_number LIKE v_prefix || '%'
              UNION ALL
              SELECT invoice_number FROM customer_ledgers
               WHERE invoice_number LIKE v_prefix || '%'
          ) combined;

        NEW.invoice_number := v_prefix || LPAD((v_next_seq + 1)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: get_unposted_bookings(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_unposted_bookings(p_audit_date date) RETURNS TABLE(booking_id bigint, booking_number character varying, guest_name text, room_number character varying, check_in_date date, check_out_date date, status character varying, total_amount numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id as booking_id,
        b.booking_number,
        g.first_name || ' ' || g.last_name as guest_name,
        r.room_number,
        b.check_in_date,
        b.check_out_date,
        b.status,
        b.total_amount
    FROM bookings b
    JOIN guests g ON b.guest_id = g.id
    JOIN rooms r ON b.room_id = r.id
    WHERE b.is_posted = FALSE
    AND (
        (b.check_in_date <= p_audit_date AND b.check_out_date > p_audit_date)
        OR (b.check_out_date = p_audit_date AND b.status = 'checked_out')
        OR (DATE(b.created_at) = p_audit_date OR DATE(b.updated_at) = p_audit_date)
    )
    AND b.status NOT IN ('voided', 'no_show', 'confirmed', 'pending')
    ORDER BY b.check_in_date;
END;
$$;


--
-- Name: increment_failed_login(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_failed_login(user_email character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        is_locked = CASE
            WHEN failed_login_attempts >= 4 THEN true
            ELSE false
        END,
        locked_until = CASE
            WHEN failed_login_attempts >= 4 THEN CURRENT_TIMESTAMP + INTERVAL '30 minutes'
            ELSE NULL
        END
    WHERE email = user_email;
END;
$$;


--
-- Name: reset_failed_login(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_failed_login(user_email character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE users
    SET failed_login_attempts = 0,
        is_locked = false,
        locked_until = NULL,
        last_login_at = CURRENT_TIMESTAMP
    WHERE email = user_email;
END;
$$;


--
-- Name: run_night_audit(date, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_night_audit(p_audit_date date, p_user_id bigint) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
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
        WHERE b.status NOT IN ('pending', 'confirmed', 'no_show', 'voided')
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
        COUNT(*) FILTER (WHERE status IN ('dirty', 'cleaning', 'reserved_dirty'))
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
$$;


--
-- Name: sync_booking_payment_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_booking_payment_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION sync_booking_payment_status(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_booking_payment_status() IS 'Trigger function that recalculates and updates bookings.payment_status based on the sum of completed payments whenever a payment is inserted, updated, or deleted.';


--
-- Name: sync_room_status_with_booking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_room_status_with_booking() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_current_room_status VARCHAR(20);
    v_next_status VARCHAR(20);
    v_has_other_current_stay BOOLEAN;
BEGIN
    -- Skip room status changes for back-dated stays that have already ended.
    IF NEW.check_out_date < CURRENT_DATE
       AND NEW.status IN ('checked_in', 'auto_checked_in', 'checked_out', 'completed') THEN
        RETURN NEW;
    END IF;

    SELECT status INTO v_current_room_status FROM rooms WHERE id = NEW.room_id;

    SELECT EXISTS (
        SELECT 1 FROM bookings
        WHERE room_id = NEW.room_id
          AND id != NEW.id
          AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
          AND check_in_date <= CURRENT_DATE
          AND check_out_date >= CURRENT_DATE
    ) INTO v_has_other_current_stay;

    IF NEW.status IN ('checked_in', 'auto_checked_in', 'late_checkout')
       AND v_current_room_status != 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'occupied',
            'Guest checked in - Booking #' || NEW.id, NULL,
            NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('checked_out', 'completed')
          AND v_current_room_status = 'occupied' THEN
        PERFORM update_room_status(NEW.room_id, 'dirty',
            'Guest checked out - Needs cleaning - Booking #' || NEW.id,
            NULL, CURRENT_TIMESTAMP, NULL);

    ELSIF NEW.status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
          AND NOT v_has_other_current_stay
          AND v_current_room_status NOT IN ('maintenance', 'out_of_order', 'dirty', 'cleaning', 'reserved_dirty') THEN
        PERFORM update_room_status(NEW.room_id, 'reserved',
            CASE
                WHEN NEW.check_in_date::date = CURRENT_DATE
                    THEN 'Same-day reservation - Booking #' || NEW.id
                ELSE 'Future reservation - Booking #' || NEW.id
            END,
            NULL, NEW.check_in_date, NEW.check_out_date);

    ELSIF NEW.status IN ('no_show', 'voided')
          AND v_current_room_status IN ('occupied', 'reserved') THEN
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('checked_in', 'auto_checked_in', 'late_checkout')
                  AND check_in_date <= CURRENT_DATE
                  AND check_out_date >= CURRENT_DATE
            ) THEN 'occupied'
            WHEN EXISTS (
                SELECT 1 FROM bookings
                WHERE room_id = NEW.room_id
                  AND id != NEW.id
                  AND status IN ('confirmed', 'pending', 'pending_payment', 'pending_confirmation')
                  AND check_out_date > CURRENT_DATE
            ) THEN 'reserved'
            ELSE 'available'
        END INTO v_next_status;

        PERFORM update_room_status(NEW.room_id, v_next_status,
            'Booking no-show/voided - Booking #' || NEW.id, NULL, NULL, NULL);
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: update_customer_ledger_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer_ledger_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_room_status(bigint, character varying, text, bigint, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_room_status(p_room_id bigint, p_new_status character varying, p_notes text DEFAULT NULL::text, p_user_id bigint DEFAULT NULL::bigint, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_old_status VARCHAR(20);
BEGIN
    SELECT status INTO v_old_status FROM rooms WHERE id = p_room_id;
    INSERT INTO room_status_change_log (room_id, from_status, to_status, trigger_source, reason)
    VALUES (p_room_id, v_old_status, p_new_status, 'update_room_status', p_notes);
    PERFORM validate_room_status_transition(p_room_id, p_new_status, p_user_id);
    UPDATE rooms SET status = p_new_status, status_notes = COALESCE(p_notes, '') || ' [via update_room_status]',
        updated_at = CURRENT_TIMESTAMP,
        reserved_start_date = CASE WHEN p_new_status = 'reserved' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        reserved_end_date = CASE WHEN p_new_status = 'reserved' THEN p_end_date ELSE NULL END,
        maintenance_start_date = CASE WHEN p_new_status = 'maintenance' THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        maintenance_end_date = CASE WHEN p_new_status = 'maintenance' THEN p_end_date ELSE NULL END,
        cleaning_start_date = CASE WHEN p_new_status IN ('cleaning', 'dirty', 'reserved_dirty') THEN COALESCE(p_start_date, CURRENT_TIMESTAMP) ELSE NULL END,
        cleaning_end_date = CASE WHEN p_new_status IN ('cleaning', 'dirty', 'reserved_dirty') THEN p_end_date ELSE NULL END
    WHERE id = p_room_id;
    INSERT INTO room_history (room_id, from_status, to_status, notes, start_date, end_date, changed_by, is_auto_generated)
    VALUES (p_room_id, v_old_status, p_new_status, p_notes, p_start_date, p_end_date, p_user_id, p_user_id IS NULL);
    IF p_new_status IN ('dirty', 'cleaning', 'reserved_dirty') THEN
        INSERT INTO housekeeping_tasks (room_id, task_type, priority, status, created_by, notes)
        VALUES (p_room_id, 'cleaning', 'normal', CASE WHEN p_new_status = 'cleaning' THEN 'in_progress' ELSE 'pending' END, p_user_id, p_notes)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: validate_booking_occupancy(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_booking_occupancy() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE v_max_occupancy INTEGER; v_total_guests INTEGER;
BEGIN
    SELECT rt.max_occupancy INTO v_max_occupancy FROM rooms r JOIN room_types rt ON r.room_type_id = rt.id WHERE r.id = NEW.room_id;
    v_total_guests := COALESCE(NEW.adults, 1) + COALESCE(NEW.children, 0);
    IF v_total_guests > v_max_occupancy THEN
        RAISE EXCEPTION 'Total guests (%) exceeds room maximum occupancy (%)', v_total_guests, v_max_occupancy;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: validate_room_status_transition(bigint, character varying, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_room_status_transition(p_room_id bigint, p_new_status character varying, p_user_id bigint DEFAULT NULL::bigint) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_current_status VARCHAR(20);
    v_is_allowed BOOLEAN;
    v_count INT;
BEGIN
    SELECT status INTO v_current_status FROM rooms WHERE id = p_room_id;
    IF v_current_status IS NULL THEN RAISE EXCEPTION 'Room % not found', p_room_id; END IF;
    IF v_current_status = p_new_status THEN RETURN true; END IF;

    -- Auto-seed transitions if table is empty
    SELECT COUNT(*) INTO v_count FROM room_status_transitions;
    IF v_count = 0 THEN
        INSERT INTO room_status_transitions (from_status, to_status, is_allowed) VALUES
        ('available', 'occupied', true), ('available', 'reserved', true),
        ('available', 'reserved_dirty', true),
        ('available', 'dirty', true), ('available', 'maintenance', true),
        ('available', 'out_of_order', true),
        ('occupied', 'available', true), ('occupied', 'dirty', true),
        ('occupied', 'maintenance', true), ('occupied', 'reserved', true),
        ('reserved', 'occupied', true), ('reserved', 'available', true),
        ('reserved', 'dirty', true), ('reserved', 'reserved_dirty', true),
        ('reserved', 'maintenance', true),
        ('dirty', 'available', true), ('dirty', 'maintenance', true),
        ('dirty', 'reserved', true), ('dirty', 'reserved_dirty', true),
        ('dirty', 'occupied', true),
        ('cleaning', 'available', true), ('cleaning', 'dirty', true),
        ('cleaning', 'reserved_dirty', true), ('cleaning', 'maintenance', true),
        ('reserved_dirty', 'reserved', true), ('reserved_dirty', 'dirty', true),
        ('reserved_dirty', 'maintenance', true),
        ('maintenance', 'available', true), ('maintenance', 'dirty', true),
        ('maintenance', 'out_of_order', true),
        ('out_of_order', 'available', true), ('out_of_order', 'maintenance', true),
        ('out_of_order', 'dirty', true)
        ON CONFLICT DO NOTHING;
    END IF;

    SELECT is_allowed INTO v_is_allowed FROM room_status_transitions
    WHERE from_status = v_current_status AND to_status = p_new_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transition from % to % is not defined', v_current_status, p_new_status; END IF;
    IF NOT v_is_allowed THEN RAISE EXCEPTION 'Transition from % to % is not allowed', v_current_status, p_new_status; END IF;
    RETURN true;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: invalid_data_quarantine; Type: TABLE; Schema: app; Owner: -
--

CREATE TABLE app.invalid_data_quarantine (
    quarantine_id bigint NOT NULL,
    source_table text NOT NULL,
    source_key text,
    invalid_reason text NOT NULL,
    original_data jsonb NOT NULL,
    quarantined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE invalid_data_quarantine; Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON TABLE app.invalid_data_quarantine IS 'Rows quarantined by bootstrap validation before invalid or obsolete seed-managed records are removed.';


--
-- Name: invalid_data_quarantine_quarantine_id_seq; Type: SEQUENCE; Schema: app; Owner: -
--

ALTER TABLE app.invalid_data_quarantine ALTER COLUMN quarantine_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME app.invalid_data_quarantine_quarantine_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: amenities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.amenities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: amenities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amenities (
    id bigint DEFAULT nextval('public.amenities_id_seq'::regclass) NOT NULL,
    name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    icon character varying(50),
    description text,
    is_paid boolean DEFAULT false,
    price numeric(10,2),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE amenities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.amenities IS 'Available amenities catalog';


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint CONSTRAINT audit_logs_id_not_null1 NOT NULL,
    user_id bigint,
    action character varying(100) CONSTRAINT audit_logs_action_not_null1 NOT NULL,
    resource_type character varying(50) CONSTRAINT audit_logs_resource_type_not_null1 NOT NULL,
    resource_id bigint,
    details jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)
PARTITION BY RANGE (created_at);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Comprehensive audit trail for all system actions. RANGE-partitioned by month on created_at (migration 020); use ensure_audit_logs_partition() to pre-create future months.';


--
-- Name: audit_logs_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs_default (
    id bigint CONSTRAINT audit_logs_id_not_null1 NOT NULL,
    user_id bigint,
    action character varying(100) CONSTRAINT audit_logs_action_not_null1 NOT NULL,
    resource_type character varying(50) CONSTRAINT audit_logs_resource_type_not_null1 NOT NULL,
    resource_id bigint,
    details jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT audit_logs_created_at_not_null NOT NULL
);


--
-- Name: audit_logs_id_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: booking_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.booking_channels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_channels (
    id bigint DEFAULT nextval('public.booking_channels_id_seq'::regclass) NOT NULL,
    name character varying(120) NOT NULL,
    channel_type character varying(30) DEFAULT 'ota'::character varying NOT NULL,
    default_commission_type character varying(30) DEFAULT 'none'::character varying NOT NULL,
    default_commission_value numeric(10,2) DEFAULT 0 NOT NULL,
    default_commission_scope character varying(20) DEFAULT 'per_booking'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT booking_channels_channel_type_check CHECK (((channel_type)::text = ANY ((ARRAY['direct'::character varying, 'ota'::character varying, 'corporate'::character varying, 'walk_in'::character varying, 'phone'::character varying, 'website'::character varying, 'channel_manager'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT booking_channels_default_commission_scope_check CHECK (((default_commission_scope)::text = ANY ((ARRAY['per_booking'::character varying, 'per_night'::character varying])::text[]))),
    CONSTRAINT booking_channels_default_commission_type_check CHECK (((default_commission_type)::text = ANY ((ARRAY['none'::character varying, 'percentage'::character varying, 'fixed_amount'::character varying])::text[]))),
    CONSTRAINT booking_channels_default_commission_value_check CHECK ((default_commission_value >= (0)::numeric)),
    CONSTRAINT booking_channels_percentage_range CHECK ((((default_commission_type)::text <> 'percentage'::text) OR ((default_commission_value >= (0)::numeric) AND (default_commission_value <= (100)::numeric))))
);


--
-- Name: booking_guests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.booking_guests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: booking_guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_guests (
    id bigint DEFAULT nextval('public.booking_guests_id_seq'::regclass) NOT NULL,
    booking_id bigint NOT NULL,
    guest_id bigint,
    first_name character varying(100),
    last_name character varying(100),
    age_group character varying(20),
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT booking_guests_age_group_check CHECK (((age_group)::text = ANY ((ARRAY['adult'::character varying, 'child'::character varying, 'infant'::character varying])::text[])))
);


--
-- Name: TABLE booking_guests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_guests IS 'Additional guests in a booking';


--
-- Name: booking_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_history (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    booking_id bigint NOT NULL,
    previous_status character varying(50),
    new_status character varying(50) NOT NULL,
    changed_by bigint,
    change_reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE booking_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_history IS 'Audit trail of booking status changes';


--
-- Name: booking_modifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_modifications (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    booking_id bigint NOT NULL,
    modification_type character varying(50) NOT NULL,
    old_value jsonb,
    new_value jsonb,
    reason text,
    price_adjustment numeric(10,2) DEFAULT 0,
    modified_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    modified_by bigint NOT NULL
);


--
-- Name: TABLE booking_modifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_modifications IS 'History of booking changes';


--
-- Name: booking_services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_services (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    booking_id bigint NOT NULL,
    service_id bigint NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    service_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'pending'::character varying,
    notes text,
    delivered_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    CONSTRAINT booking_services_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'void'::character varying])::text[])))
);


--
-- Name: TABLE booking_services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_services IS 'Services ordered by guests';


--
-- Name: bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bookings_id_seq
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id bigint DEFAULT nextval('public.bookings_id_seq'::regclass) NOT NULL,
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL,
    booking_number character varying(50) NOT NULL,
    folio_number character varying(50),
    guest_id bigint NOT NULL,
    guest_name character varying(255),
    guest_email character varying(255),
    guest_phone character varying(20),
    corporate_account_id uuid,
    room_id bigint NOT NULL,
    check_in_date date NOT NULL,
    check_out_date date NOT NULL,
    nights integer GENERATED ALWAYS AS ((check_out_date - check_in_date)) STORED,
    adults integer DEFAULT 1 NOT NULL,
    children integer DEFAULT 0,
    infants integer DEFAULT 0,
    total_guests integer GENERATED ALWAYS AS (((adults + children) + infants)) STORED,
    rate_plan_id bigint,
    room_rate numeric(10,2) NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0,
    discount_amount numeric(12,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0.00,
    total_amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying,
    rate_override_weekday numeric(10,2),
    rate_override_weekend numeric(10,2),
    daily_rates jsonb,
    is_tourist boolean DEFAULT false,
    tourism_tax_amount numeric(10,2) DEFAULT 0,
    extra_bed_count integer DEFAULT 0,
    extra_bed_charge numeric(10,2) DEFAULT 0,
    room_card_deposit numeric(10,2) DEFAULT 0,
    late_checkout_penalty numeric(10,2) DEFAULT 0,
    is_complimentary boolean DEFAULT false,
    complimentary_reason text,
    complimentary_start_date date,
    complimentary_end_date date,
    original_total_amount numeric(12,2),
    complimentary_nights integer DEFAULT 0,
    deposit_paid boolean DEFAULT false,
    deposit_amount numeric(10,2) DEFAULT 0,
    deposit_paid_at timestamp with time zone,
    status character varying(30) DEFAULT 'pending'::character varying,
    payment_status character varying(30) DEFAULT 'unpaid'::character varying,
    payment_method character varying(100),
    payment_note text,
    market_code character varying(50),
    company_id bigint,
    company_name character varying(255),
    check_in_time time without time zone DEFAULT '15:00:00'::time without time zone,
    check_out_time time without time zone DEFAULT '11:00:00'::time without time zone,
    actual_check_in timestamp with time zone,
    actual_check_out timestamp with time zone,
    early_check_in boolean DEFAULT false,
    late_check_out boolean DEFAULT false,
    pre_checkin_completed boolean DEFAULT false,
    pre_checkin_completed_at timestamp with time zone,
    pre_checkin_token character varying(255),
    pre_checkin_token_expires_at timestamp with time zone,
    special_requests text,
    internal_notes text,
    remarks text,
    source character varying(50) DEFAULT 'direct'::character varying,
    post_type character varying(50) DEFAULT 'normal_stay'::character varying,
    channel character varying(50),
    commission_rate numeric(5,2),
    cancelled_at timestamp with time zone,
    cancelled_by bigint,
    cancellation_reason text,
    cancellation_fee numeric(10,2),
    is_posted boolean DEFAULT false,
    posted_date date,
    posted_at timestamp with time zone,
    posted_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by bigint,
    tourism_billable_amount numeric(10,2) GENERATED ALWAYS AS (
CASE
    WHEN is_tourist THEN COALESCE(tourism_tax_amount, (0)::numeric)
    ELSE (0)::numeric
END),
    cleaning_preference boolean,
    booking_channel_id bigint,
    ota_reference character varying(100),
    commission_type_override character varying(30),
    commission_value_override numeric(10,2),
    commission_scope_override character varying(20),
    commission_amount numeric(12,2),
    net_revenue numeric(12,2),
    portal_request_id character varying(128),
    CONSTRAINT bookings_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['unpaid'::character varying, 'unpaid_deposit'::character varying, 'paid_rate'::character varying, 'partial'::character varying, 'paid'::character varying, 'refunded'::character varying, 'void'::character varying])::text[]))),
    CONSTRAINT bookings_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'pending_payment'::character varying, 'pending_confirmation'::character varying, 'confirmed'::character varying, 'checked_in'::character varying, 'auto_checked_in'::character varying, 'checked_out'::character varying, 'no_show'::character varying, 'completed'::character varying, 'comp_void'::character varying, 'partial_complimentary'::character varying, 'fully_complimentary'::character varying, 'voided'::character varying])::text[]))),
    CONSTRAINT valid_complimentary_dates CHECK ((((complimentary_start_date IS NULL) AND (complimentary_end_date IS NULL)) OR ((complimentary_start_date IS NOT NULL) AND (complimentary_end_date IS NOT NULL) AND (complimentary_start_date >= check_in_date) AND (complimentary_end_date <= check_out_date) AND (complimentary_start_date < complimentary_end_date)))),
    CONSTRAINT valid_dates CHECK ((check_out_date >= check_in_date)),
    CONSTRAINT valid_occupancy CHECK ((((adults + children) + infants) > 0))
);


--
-- Name: TABLE bookings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bookings IS 'Guest reservations and bookings';


--
-- Name: COLUMN bookings.is_tourist; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.is_tourist IS 'Derived from guests.tourism_type. Foreign guests are charged tourism tax.';


--
-- Name: COLUMN bookings.tourism_tax_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.tourism_tax_amount IS 'Total tourism tax for the booking, derived from configured per-night rate times billable nights for foreign guests.';


--
-- Name: COLUMN bookings.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.status IS 'Booking status: pending_payment, pending_confirmation, confirmed, checked_in, checked_out, voided, no_show, completed, comp_void, partial_complimentary, fully_complimentary';


--
-- Name: COLUMN bookings.payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.payment_method IS 'Payment method: cash, credit_card, debit_card, bank_transfer, company_billing, online_payment, ewallet';


--
-- Name: COLUMN bookings.payment_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.payment_note IS 'Note or remarks about payment status changes';


--
-- Name: COLUMN bookings.company_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.company_id IS 'Reference to company for direct billing';


--
-- Name: COLUMN bookings.company_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.company_name IS 'Denormalized company name for display';


--
-- Name: COLUMN bookings.pre_checkin_completed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.pre_checkin_completed IS 'Guest completed pre-check-in via portal';


--
-- Name: COLUMN bookings.is_posted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.is_posted IS 'Whether this booking has been included in a night audit';


--
-- Name: COLUMN bookings.posted_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.posted_date IS 'The business date when this booking was posted';


--
-- Name: COLUMN bookings.tourism_billable_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.tourism_billable_amount IS 'Virtual generated column (PostgreSQL 19 baseline): tourism_tax_amount when is_tourist, else 0. Computed on read; no storage overhead. Replaces repeated CASE expressions in reporting queries.';


--
-- Name: guests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guests (
    id bigint DEFAULT nextval('public.guests_id_seq'::regclass) NOT NULL,
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL,
    full_name character varying(255) NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    email character varying(255),
    phone character varying(20),
    title character varying(20),
    alt_phone character varying(20),
    date_of_birth date,
    nationality character varying(100),
    ic_number character varying(50),
    address_line_1 character varying(255),
    address_line_2 character varying(255),
    city character varying(100),
    state character varying(100),
    postal_code character varying(20),
    country character varying(100),
    id_type public.identificationtype,
    id_number character varying(100),
    id_expiry date,
    id_country character varying(100),
    language_preference character varying(10) DEFAULT 'en'::character varying,
    communication_preference character varying(50) DEFAULT 'email'::character varying,
    marketing_opt_in boolean DEFAULT false,
    vip_status character varying(20),
    company_name character varying(255),
    job_title character varying(100),
    notes text,
    special_requests text,
    tags text[],
    total_stays integer DEFAULT 0,
    total_spend numeric(12,2) DEFAULT 0,
    average_rating numeric(3,2),
    complimentary_nights_credit integer DEFAULT 0,
    is_blacklisted boolean DEFAULT false,
    blacklist_reason text,
    is_active boolean DEFAULT true NOT NULL,
    guest_type public.guest_type DEFAULT 'non_member'::public.guest_type NOT NULL,
    discount_percentage integer DEFAULT 0 NOT NULL,
    tourism_type public.tourism_type,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by bigint,
    deleted_at timestamp with time zone,
    CONSTRAINT guests_discount_percentage_check CHECK (((discount_percentage >= 0) AND (discount_percentage <= 100))),
    CONSTRAINT valid_email_format CHECK (((email IS NULL) OR ((email)::text ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'::text)))
);


--
-- Name: TABLE guests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guests IS 'Guest profiles with personal information and preferences';


--
-- Name: COLUMN guests.nationality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guests.nationality IS 'Guest nationality/citizenship';


--
-- Name: COLUMN guests.ic_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guests.ic_number IS 'Identity card or passport number';


--
-- Name: COLUMN guests.guest_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guests.guest_type IS 'Guest membership type: member (discounted rates) or non_member (standard rates)';


--
-- Name: COLUMN guests.discount_percentage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guests.discount_percentage IS 'Discount percentage for members (0-100). Only applicable when guest_type is member.';


--
-- Name: COLUMN guests.tourism_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.guests.tourism_type IS 'Tourism type: local (no tourism tax) or foreign (tourism tax applies). NULL means not specified.';


--
-- Name: room_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.room_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: room_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_types (
    id bigint DEFAULT nextval('public.room_types_id_seq'::regclass) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    base_price numeric(10,2) NOT NULL,
    weekday_rate numeric(10,2),
    weekend_rate numeric(10,2),
    max_occupancy integer DEFAULT 2,
    bed_type character varying(50),
    bed_count integer DEFAULT 1,
    allows_extra_bed boolean DEFAULT false,
    max_extra_beds integer DEFAULT 0,
    extra_bed_charge numeric(10,2) DEFAULT 0,
    keycard_deposit_amount numeric(10,2) DEFAULT 0,
    service_charge_percentage numeric(5,2) DEFAULT 0,
    size_sqm numeric(6,2),
    size_sqft numeric(6,2),
    floor_range character varying(20),
    images jsonb,
    features jsonb,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT room_types_extra_bed_charge_check CHECK ((extra_bed_charge >= (0)::numeric)),
    CONSTRAINT room_types_max_extra_beds_check CHECK ((max_extra_beds >= 0))
);


--
-- Name: TABLE room_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.room_types IS 'Room type definitions with pricing';


--
-- Name: COLUMN room_types.allows_extra_bed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_types.allows_extra_bed IS 'Whether this room type allows extra beds';


--
-- Name: COLUMN room_types.max_extra_beds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_types.max_extra_beds IS 'Maximum number of extra beds allowed';


--
-- Name: COLUMN room_types.extra_bed_charge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_types.extra_bed_charge IS 'Charge per extra bed per night';


--
-- Name: rooms_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rooms_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id bigint DEFAULT nextval('public.rooms_id_seq'::regclass) NOT NULL,
    room_number character varying(20) NOT NULL,
    room_type_id bigint NOT NULL,
    floor integer,
    building character varying(50),
    custom_price numeric(10,2),
    status character varying(20) DEFAULT 'available'::character varying,
    status_notes text,
    reserved_start_date timestamp with time zone,
    reserved_end_date timestamp with time zone,
    maintenance_start_date timestamp with time zone,
    maintenance_end_date timestamp with time zone,
    cleaning_start_date timestamp with time zone,
    cleaning_end_date timestamp with time zone,
    current_occupancy integer DEFAULT 0,
    last_cleaned_at timestamp with time zone,
    last_inspected_at timestamp with time zone,
    inspected_by bigint,
    is_smoking boolean DEFAULT false,
    is_accessible boolean DEFAULT false,
    has_view boolean DEFAULT false,
    view_type character varying(50),
    connecting_room_id bigint,
    notes text,
    is_active boolean DEFAULT true,
    last_posted_status character varying(50),
    last_posted_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rooms_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'occupied'::character varying, 'reserved'::character varying, 'reserved_dirty'::character varying, 'cleaning'::character varying, 'dirty'::character varying, 'maintenance'::character varying, 'out_of_order'::character varying])::text[])))
);


--
-- Name: TABLE rooms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rooms IS 'Individual room inventory';


--
-- Name: booking_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.booking_summary AS
 SELECT b.id,
    b.uuid,
    b.booking_number,
    b.status,
    b.payment_status,
    g.full_name AS guest_name,
    g.email AS guest_email,
    g.phone AS guest_phone,
    r.room_number,
    rt.name AS room_type,
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
            WHEN ((b.status)::text = 'checked_in'::text) THEN 'In House'::text
            WHEN (b.check_in_date = CURRENT_DATE) THEN 'Arriving Today'::text
            WHEN (b.check_out_date = CURRENT_DATE) THEN 'Departing Today'::text
            WHEN (b.check_in_date > CURRENT_DATE) THEN 'Future'::text
            ELSE 'Past'::text
        END AS booking_category
   FROM (((public.bookings b
     JOIN public.guests g ON ((b.guest_id = g.id)))
     JOIN public.rooms r ON ((b.room_id = r.id)))
     JOIN public.room_types rt ON ((r.room_type_id = rt.id)));


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id bigint NOT NULL,
    company_name character varying(255) NOT NULL,
    registration_number character varying(100),
    contact_person character varying(255),
    contact_email character varying(255),
    contact_phone character varying(50),
    billing_address text,
    billing_city character varying(100),
    billing_state character varying(100),
    billing_postal_code character varying(20),
    billing_country character varying(100),
    is_active boolean DEFAULT true,
    credit_limit numeric(12,2),
    payment_terms_days integer DEFAULT 30,
    notes text,
    created_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE companies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.companies IS 'Companies for direct billing and corporate accounts';


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: corporate_account_contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.corporate_account_contacts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: corporate_account_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_account_contacts (
    id bigint DEFAULT nextval('public.corporate_account_contacts_id_seq'::regclass) NOT NULL,
    corporate_account_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(20),
    role character varying(100),
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: corporate_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_accounts (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    name character varying(255) NOT NULL,
    company_registration character varying(100),
    tax_id character varying(100),
    industry character varying(100),
    billing_address text,
    billing_email character varying(255),
    billing_phone character varying(20),
    credit_limit numeric(12,2) DEFAULT 0,
    credit_balance numeric(12,2) DEFAULT 0,
    payment_terms character varying(50) DEFAULT 'Net 30'::character varying,
    discount_percentage numeric(5,2) DEFAULT 0,
    contract_start date,
    contract_end date,
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE corporate_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.corporate_accounts IS 'Corporate accounts for business clients';


--
-- Name: corporate_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.corporate_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_ledger_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_ledger_payments (
    id bigint NOT NULL,
    ledger_id bigint NOT NULL,
    payment_amount numeric(10,2) NOT NULL,
    payment_method character varying(50) NOT NULL,
    payment_reference character varying(255),
    payment_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    receipt_number character varying(100),
    receipt_file_url character varying(500),
    notes text,
    processed_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT positive_payment CHECK ((payment_amount > (0)::numeric))
);


--
-- Name: TABLE customer_ledger_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_ledger_payments IS 'Tracks payment history for customer ledgers';


--
-- Name: customer_ledger_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_ledger_payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_ledger_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_ledger_payments_id_seq OWNED BY public.customer_ledger_payments.id;


--
-- Name: customer_ledgers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_ledgers (
    id bigint NOT NULL,
    company_name character varying(255) NOT NULL,
    company_registration_number character varying(100),
    contact_person character varying(255),
    contact_email character varying(255),
    contact_phone character varying(50),
    billing_address_line1 character varying(255),
    billing_city character varying(100),
    billing_state character varying(100),
    billing_postal_code character varying(20),
    billing_country character varying(100) DEFAULT 'Malaysia'::character varying,
    description text NOT NULL,
    expense_type character varying(100) NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'MYR'::character varying,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    paid_amount numeric(10,2) DEFAULT 0.00,
    balance_due numeric(10,2) GENERATED ALWAYS AS ((amount - paid_amount)) STORED,
    payment_method character varying(50),
    payment_reference character varying(255),
    payment_date timestamp without time zone,
    booking_id bigint,
    guest_id bigint,
    invoice_number character varying(100),
    invoice_date date,
    due_date date,
    notes text,
    internal_notes text,
    folio_number character varying(50),
    folio_type character varying(50) DEFAULT 'city_ledger'::character varying,
    transaction_type character varying(20) DEFAULT 'debit'::character varying,
    post_type character varying(50),
    department_code character varying(20),
    transaction_code character varying(20),
    room_number character varying(20),
    posting_date date DEFAULT CURRENT_DATE,
    transaction_date date DEFAULT CURRENT_DATE,
    reference_number character varying(100),
    cashier_id bigint,
    is_reversal boolean DEFAULT false,
    original_transaction_id bigint,
    reversal_reason text,
    tax_amount numeric(10,2) DEFAULT 0.00,
    service_charge numeric(10,2) DEFAULT 0.00,
    net_amount numeric(10,2),
    is_posted boolean DEFAULT true,
    posted_at timestamp without time zone,
    void_at timestamp without time zone,
    void_by bigint,
    void_reason text,
    created_by bigint,
    updated_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT positive_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT valid_folio_type CHECK (((folio_type)::text = ANY ((ARRAY['guest_folio'::character varying, 'master_folio'::character varying, 'city_ledger'::character varying, 'group_folio'::character varying, 'ar_ledger'::character varying])::text[]))),
    CONSTRAINT valid_paid_amount CHECK (((paid_amount >= (0)::numeric) AND (paid_amount <= amount))),
    CONSTRAINT valid_post_type CHECK (((post_type IS NULL) OR ((post_type)::text = ANY ((ARRAY['room_charge'::character varying, 'room_tax'::character varying, 'service_charge'::character varying, 'tourism_tax'::character varying, 'fnb_restaurant'::character varying, 'fnb_room_service'::character varying, 'fnb_minibar'::character varying, 'fnb_banquet'::character varying, 'laundry'::character varying, 'telephone'::character varying, 'internet'::character varying, 'parking'::character varying, 'spa'::character varying, 'gym'::character varying, 'transportation'::character varying, 'miscellaneous'::character varying, 'advance_deposit'::character varying, 'payment'::character varying, 'adjustment'::character varying, 'rebate'::character varying, 'discount'::character varying, 'commission'::character varying, 'refund'::character varying, 'transfer_in'::character varying, 'transfer_out'::character varying, 'city_ledger_transfer'::character varying])::text[])))),
    CONSTRAINT valid_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'partial'::character varying, 'paid'::character varying, 'overdue'::character varying, 'void'::character varying])::text[]))),
    CONSTRAINT valid_transaction_type CHECK (((transaction_type)::text = ANY ((ARRAY['debit'::character varying, 'credit'::character varying])::text[])))
);


--
-- Name: TABLE customer_ledgers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_ledgers IS 'Tracks company expenses and customer ledger accounts';


--
-- Name: COLUMN customer_ledgers.balance_due; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_ledgers.balance_due IS 'Auto-calculated as amount - paid_amount';


--
-- Name: COLUMN customer_ledgers.folio_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_ledgers.folio_number IS 'Ledger folio number (auto-generated based on folio_type)';


--
-- Name: COLUMN customer_ledgers.folio_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customer_ledgers.folio_type IS 'Type: guest_folio, master_folio, city_ledger, group_folio, ar_ledger';


--
-- Name: customer_ledgers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_ledgers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_ledgers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_ledgers_id_seq OWNED BY public.customer_ledgers.id;


--
-- Name: daily_arrivals; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.daily_arrivals AS
 SELECT check_in_date AS date,
    count(*) AS total_arrivals,
    sum((adults + children)) AS total_guests,
    array_agg(booking_number ORDER BY check_in_date) AS booking_numbers
   FROM public.bookings b
  WHERE (((status)::text = ANY ((ARRAY['confirmed'::character varying, 'checked_in'::character varying])::text[])) AND (check_in_date >= CURRENT_DATE))
  GROUP BY check_in_date
  ORDER BY check_in_date;


--
-- Name: daily_departures; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.daily_departures AS
 SELECT check_out_date AS date,
    count(*) AS total_departures,
    sum((adults + children)) AS total_guests,
    array_agg(booking_number ORDER BY check_out_date) AS booking_numbers
   FROM public.bookings b
  WHERE (((status)::text = ANY ((ARRAY['confirmed'::character varying, 'checked_in'::character varying])::text[])) AND (check_out_date >= CURRENT_DATE))
  GROUP BY check_out_date
  ORDER BY check_out_date;


--
-- Name: ekyc_access_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ekyc_access_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_access_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_access_events (
    id bigint DEFAULT nextval('public.ekyc_access_events_id_seq'::regclass) NOT NULL,
    application_id bigint,
    actor_id bigint NOT NULL,
    action character varying(100) NOT NULL,
    details jsonb,
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ekyc_decision_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ekyc_decision_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_decision_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_decision_history (
    id bigint DEFAULT nextval('public.ekyc_decision_history_id_seq'::regclass) NOT NULL,
    application_id bigint NOT NULL,
    actor_id bigint,
    action character varying(100) NOT NULL,
    from_status character varying(50),
    to_status character varying(50),
    reason_code character varying(80),
    reason text,
    details jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ekyc_idempotency_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ekyc_idempotency_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_idempotency_keys (
    id bigint DEFAULT nextval('public.ekyc_idempotency_keys_id_seq'::regclass) NOT NULL,
    application_id bigint NOT NULL,
    actor_id bigint NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    action character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ekyc_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ekyc_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_notes (
    id bigint DEFAULT nextval('public.ekyc_notes_id_seq'::regclass) NOT NULL,
    application_id bigint NOT NULL,
    note_type character varying(40) DEFAULT 'internal'::character varying NOT NULL,
    body text NOT NULL,
    customer_visible boolean DEFAULT false NOT NULL,
    created_by bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ekyc_reason_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_reason_codes (
    code character varying(80) NOT NULL,
    label character varying(160) NOT NULL,
    category character varying(80) NOT NULL,
    requires_details boolean DEFAULT false NOT NULL,
    customer_message_template text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ekyc_sensitive_reveals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ekyc_sensitive_reveals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_sensitive_reveals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_sensitive_reveals (
    id bigint DEFAULT nextval('public.ekyc_sensitive_reveals_id_seq'::regclass) NOT NULL,
    application_id bigint NOT NULL,
    actor_id bigint NOT NULL,
    field_name character varying(80) NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: ekyc_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ekyc_verifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ekyc_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ekyc_verifications (
    id bigint DEFAULT nextval('public.ekyc_verifications_id_seq'::regclass) NOT NULL,
    uuid uuid DEFAULT uuidv7() NOT NULL,
    user_id bigint NOT NULL,
    guest_id bigint,
    status character varying(50) DEFAULT 'submitted'::character varying NOT NULL,
    assigned_reviewer_id bigint,
    reviewer_claimed_at timestamp with time zone,
    full_name character varying(255),
    date_of_birth date,
    nationality character varying(100),
    phone character varying(50),
    email character varying(255),
    current_address text,
    id_type character varying(80),
    id_number character varying(255),
    id_issuing_country character varying(100),
    id_issue_date date,
    id_expiry_date date,
    id_front_image_path text,
    id_back_image_path text,
    selfie_image_path text,
    proof_of_address_path text,
    provider_name character varying(100),
    provider_verification_result character varying(80),
    provider_raw_response jsonb,
    ocr_data jsonb,
    user_entered_data jsonb,
    document_authenticity_result character varying(80),
    face_match_score double precision,
    face_match_passed boolean DEFAULT false,
    liveness_score double precision,
    liveness_passed boolean DEFAULT false,
    duplicate_check_result character varying(80),
    watchlist_result character varying(80),
    ip_address character varying(64),
    device_fingerprint character varying(255),
    geolocation character varying(255),
    submission_metadata jsonb,
    auto_verified boolean DEFAULT false,
    auto_verification_details jsonb,
    manual_review_required boolean DEFAULT true,
    risk_level character varying(30) DEFAULT 'medium'::character varying,
    risk_score integer DEFAULT 0,
    risk_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommended_action character varying(100),
    potential_duplicate boolean DEFAULT false,
    fraud_suspected boolean DEFAULT false,
    verification_notes text,
    customer_message text,
    decision_reason_code character varying(80),
    decision_reason text,
    verified_by bigint,
    verified_at timestamp with time zone,
    self_checkin_enabled boolean DEFAULT false,
    self_checkin_activated_at timestamp with time zone,
    submitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_ekyc_risk_level CHECK (((risk_level IS NULL) OR ((risk_level)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[])))),
    CONSTRAINT valid_ekyc_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'submitted'::character varying, 'automated_review'::character varying, 'pending_manual_review'::character varying, 'in_review'::character varying, 'additional_information_required'::character varying, 'approved'::character varying, 'rejected'::character varying, 'escalated'::character varying, 'expired'::character varying, 'void'::character varying, 'on_hold'::character varying, 'pending'::character varying, 'under_review'::character varying, 'verified'::character varying])::text[])))
);


--
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns (
    id bigint NOT NULL,
    name character varying(160) NOT NULL,
    campaign_type character varying(16) NOT NULL,
    topic character varying(32) NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    subject character varying(255) NOT NULL,
    body_html text NOT NULL,
    body_text text,
    template_id bigint,
    promotion_id bigint,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    total_recipients integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    error text,
    created_by bigint,
    cancelled_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT email_campaigns_campaign_type_check CHECK (((campaign_type)::text = ANY ((ARRAY['announcement'::character varying, 'promotion'::character varying])::text[]))),
    CONSTRAINT email_campaigns_promotion_required CHECK ((((campaign_type)::text <> 'promotion'::text) OR (promotion_id IS NOT NULL))),
    CONSTRAINT email_campaigns_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'scheduled'::character varying, 'running'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT email_campaigns_subject_not_blank CHECK ((length(TRIM(BOTH FROM subject)) > 0)),
    CONSTRAINT email_campaigns_topic_check CHECK (((topic)::text = ANY ((ARRAY['announcement'::character varying, 'promotion'::character varying])::text[])))
);


--
-- Name: email_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_campaigns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_campaigns_id_seq OWNED BY public.email_campaigns.id;


--
-- Name: email_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_deliveries (
    id bigint NOT NULL,
    campaign_id bigint,
    kind character varying(20) NOT NULL,
    guest_id bigint NOT NULL,
    topic character varying(32) NOT NULL,
    recipient_email character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    body_html text NOT NULL,
    body_text text,
    voucher_id bigint,
    status character varying(16) DEFAULT 'queued'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    provider_message_id character varying(255),
    idempotency_key character varying(160) NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT email_deliveries_attempts_valid CHECK (((attempts >= 0) AND (max_attempts >= 1))),
    CONSTRAINT email_deliveries_kind_campaign_link CHECK (((((kind)::text = 'campaign'::text) AND (campaign_id IS NOT NULL)) OR (((kind)::text = ANY ((ARRAY['birthday_voucher'::character varying, 'booking_confirmation'::character varying])::text[])) AND (campaign_id IS NULL)))),
    CONSTRAINT email_deliveries_kind_check CHECK (((kind)::text = ANY ((ARRAY['campaign'::character varying, 'birthday_voucher'::character varying, 'booking_confirmation'::character varying])::text[]))),
    CONSTRAINT email_deliveries_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'sending'::character varying, 'sent'::character varying, 'failed'::character varying, 'suppressed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT email_deliveries_topic_check CHECK (((topic)::text = ANY ((ARRAY['announcement'::character varying, 'promotion'::character varying, 'birthday_voucher'::character varying, 'booking_confirmation'::character varying])::text[])))
);


--
-- Name: email_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_deliveries_id_seq OWNED BY public.email_deliveries.id;


--
-- Name: email_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_suppressions (
    id bigint NOT NULL,
    email character varying(255) NOT NULL,
    reason character varying(16) NOT NULL,
    source character varying(64),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT email_suppressions_email_lower CHECK (((email)::text = lower((email)::text))),
    CONSTRAINT email_suppressions_reason_check CHECK (((reason)::text = ANY ((ARRAY['unsubscribe'::character varying, 'bounce'::character varying, 'complaint'::character varying, 'manual'::character varying])::text[])))
);


--
-- Name: email_suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_suppressions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_suppressions_id_seq OWNED BY public.email_suppressions.id;


--
-- Name: email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id bigint DEFAULT nextval('public.email_templates_id_seq'::regclass) NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    subject character varying(255) NOT NULL,
    body_html text NOT NULL,
    body_text text,
    variables jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE email_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_templates IS 'Transactional email templates with variable support';


--
-- Name: guest_complimentary_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_complimentary_credits (
    id bigint NOT NULL,
    guest_id bigint NOT NULL,
    room_type_id bigint NOT NULL,
    nights_available integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE guest_complimentary_credits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_complimentary_credits IS 'Room-type specific complimentary night credits for guests';


--
-- Name: guest_complimentary_credits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_complimentary_credits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_complimentary_credits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guest_complimentary_credits_id_seq OWNED BY public.guest_complimentary_credits.id;


--
-- Name: guest_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_documents (
    id bigint DEFAULT nextval('public.guest_documents_id_seq'::regclass) NOT NULL,
    guest_id bigint NOT NULL,
    document_type character varying(50) NOT NULL,
    document_number character varying(100),
    file_url text,
    is_verified boolean DEFAULT false,
    verified_at timestamp with time zone,
    verified_by bigint,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE guest_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_documents IS 'Identity documents and files attached to guests';


--
-- Name: guest_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_notes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_notes (
    id bigint DEFAULT nextval('public.guest_notes_id_seq'::regclass) NOT NULL,
    guest_id bigint NOT NULL,
    note_type character varying(50) DEFAULT 'general'::character varying,
    content text NOT NULL,
    is_alert boolean DEFAULT false,
    is_private boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE guest_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_notes IS 'Staff notes and alerts about guests';


--
-- Name: guest_portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_portal_sessions (
    id bigint NOT NULL,
    guest_id bigint NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: TABLE guest_portal_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_portal_sessions IS 'Bearer-token sessions for the self-service guest portal (stores token hashes only)';


--
-- Name: guest_portal_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_portal_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_portal_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.guest_portal_sessions_id_seq OWNED BY public.guest_portal_sessions.id;


--
-- Name: guest_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_preferences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_preferences (
    id bigint DEFAULT nextval('public.guest_preferences_id_seq'::regclass) NOT NULL,
    guest_id bigint NOT NULL,
    category character varying(50) NOT NULL,
    preference_key character varying(100) NOT NULL,
    preference_value text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE guest_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_preferences IS 'Guest preferences organized by category';


--
-- Name: guest_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.guest_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: guest_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_reviews (
    id bigint DEFAULT nextval('public.guest_reviews_id_seq'::regclass) NOT NULL,
    guest_id bigint NOT NULL,
    booking_id bigint,
    overall_rating numeric(3,2) NOT NULL,
    cleanliness_rating numeric(3,2),
    service_rating numeric(3,2),
    comfort_rating numeric(3,2),
    location_rating numeric(3,2),
    value_rating numeric(3,2),
    title character varying(255),
    content text,
    pros text,
    cons text,
    response text,
    response_at timestamp with time zone,
    response_by bigint,
    is_published boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT guest_reviews_cleanliness_rating_check CHECK (((cleanliness_rating >= (1)::numeric) AND (cleanliness_rating <= (5)::numeric))),
    CONSTRAINT guest_reviews_comfort_rating_check CHECK (((comfort_rating >= (1)::numeric) AND (comfort_rating <= (5)::numeric))),
    CONSTRAINT guest_reviews_location_rating_check CHECK (((location_rating >= (1)::numeric) AND (location_rating <= (5)::numeric))),
    CONSTRAINT guest_reviews_overall_rating_check CHECK (((overall_rating >= (1)::numeric) AND (overall_rating <= (5)::numeric))),
    CONSTRAINT guest_reviews_service_rating_check CHECK (((service_rating >= (1)::numeric) AND (service_rating <= (5)::numeric))),
    CONSTRAINT guest_reviews_value_rating_check CHECK (((value_rating >= (1)::numeric) AND (value_rating <= (5)::numeric)))
);


--
-- Name: TABLE guest_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.guest_reviews IS 'Guest reviews and feedback';


--
-- Name: room_current_occupancy; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.room_current_occupancy AS
 SELECT r.id AS room_id,
    r.room_number,
    r.room_type_id,
    rt.name AS room_type_name,
    rt.max_occupancy,
    r.status AS room_status,
    COALESCE(b.adults, 0) AS current_adults,
    COALESCE(b.children, 0) AS current_children,
    COALESCE(b.infants, 0) AS current_infants,
    ((COALESCE(b.adults, 0) + COALESCE(b.children, 0)) + COALESCE(b.infants, 0)) AS current_total_guests,
        CASE
            WHEN (rt.max_occupancy > 0) THEN round((((((COALESCE(b.adults, 0) + COALESCE(b.children, 0)) + COALESCE(b.infants, 0)))::numeric / (rt.max_occupancy)::numeric) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS occupancy_percentage,
    b.id AS current_booking_id,
    b.booking_number AS current_booking_number,
    b.guest_id AS current_guest_id,
    b.check_in_date,
    b.check_out_date,
        CASE
            WHEN (b.id IS NOT NULL) THEN true
            ELSE false
        END AS is_occupied
   FROM ((public.rooms r
     LEFT JOIN public.room_types rt ON ((r.room_type_id = rt.id)))
     LEFT JOIN public.bookings b ON (((r.id = b.room_id) AND ((b.status)::text = 'checked_in'::text) AND (CURRENT_DATE >= b.check_in_date) AND (CURRENT_DATE <= b.check_out_date))))
  WHERE (r.is_active = true);


--
-- Name: hotel_occupancy_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.hotel_occupancy_summary AS
 SELECT count(*) AS total_rooms,
    count(*) FILTER (WHERE (is_occupied = true)) AS occupied_rooms,
    count(*) FILTER (WHERE (is_occupied = false)) AS available_rooms,
    round((((count(*) FILTER (WHERE (is_occupied = true)))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 1) AS occupancy_rate,
    COALESCE(sum(current_adults), (0)::bigint) AS total_adults,
    COALESCE(sum(current_children), (0)::bigint) AS total_children,
    COALESCE(sum(current_infants), (0)::bigint) AS total_infants,
    COALESCE(sum(current_total_guests), (0)::bigint) AS total_guests,
    COALESCE(sum(max_occupancy), (0)::bigint) AS total_capacity,
        CASE
            WHEN (sum(max_occupancy) > 0) THEN round((((COALESCE(sum(current_total_guests), (0)::bigint))::numeric / (NULLIF(sum(max_occupancy), 0))::numeric) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS guest_occupancy_rate
   FROM public.room_current_occupancy;


--
-- Name: housekeeping_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.housekeeping_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: housekeeping_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.housekeeping_tasks (
    id bigint DEFAULT nextval('public.housekeeping_tasks_id_seq'::regclass) NOT NULL,
    room_id bigint NOT NULL,
    task_type character varying(50) DEFAULT 'cleaning'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'normal'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying,
    assigned_to bigint,
    scheduled_date date,
    task_date date DEFAULT CURRENT_DATE,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    notes text,
    inspection_notes text,
    items_used jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT housekeeping_tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT housekeeping_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'void'::character varying])::text[])))
);


--
-- Name: TABLE housekeeping_tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.housekeeping_tasks IS 'Housekeeping task assignments';


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id bigint DEFAULT nextval('public.invoices_id_seq'::regclass) NOT NULL,
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL,
    invoice_number character varying(50) NOT NULL,
    booking_id bigint NOT NULL,
    bill_to_guest_id bigint,
    bill_to_corporate_id uuid,
    billing_name character varying(255) NOT NULL,
    billing_address text,
    billing_email character varying(255),
    tax_id character varying(100),
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    subtotal numeric(12,2) NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0,
    discount_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0,
    balance_due numeric(12,2) GENERATED ALWAYS AS ((total_amount - paid_amount)) STORED,
    currency character varying(3) DEFAULT 'USD'::character varying,
    line_items jsonb NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying,
    pdf_url text,
    invoice_type character varying(50) DEFAULT 'booking'::character varying,
    payment_terms text,
    room_charges numeric(12,2) DEFAULT 0,
    service_charges numeric(12,2) DEFAULT 0,
    additional_charges numeric(12,2) DEFAULT 0,
    notes text,
    terms text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    sent_at timestamp with time zone,
    paid_at timestamp with time zone,
    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'issued'::character varying, 'paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'refunded'::character varying])::text[])))
);


--
-- Name: TABLE invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invoices IS 'Guest invoices and billing';


--
-- Name: COLUMN invoices.line_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invoices.line_items IS 'Invoice line items as JSON array';


--
-- Name: loyalty_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_accounts (
    id bigint DEFAULT nextval('public.loyalty_accounts_id_seq'::regclass) NOT NULL,
    member_id bigint NOT NULL,
    current_tier_id bigint NOT NULL,
    lifetime_points integer DEFAULT 0 NOT NULL,
    qualifying_points integer DEFAULT 0 NOT NULL,
    qualifying_nights integer DEFAULT 0 NOT NULL,
    qualifying_spend numeric(12,2) DEFAULT 0 NOT NULL,
    tier_evaluation_year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: loyalty_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_members (
    id bigint DEFAULT nextval('public.loyalty_members_id_seq'::regclass) NOT NULL,
    guest_id bigint NOT NULL,
    member_number character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    enrolled_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loyalty_members_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: loyalty_memberships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_memberships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_memberships (
    id bigint DEFAULT nextval('public.loyalty_memberships_id_seq'::regclass) NOT NULL,
    guest_id bigint NOT NULL,
    program_id bigint NOT NULL,
    tier_id bigint,
    member_number character varying(50) NOT NULL,
    points_balance integer DEFAULT 0,
    lifetime_points integer DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    enrolled_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone,
    last_activity_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loyalty_memberships_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'suspended'::character varying])::text[])))
);


--
-- Name: TABLE loyalty_memberships; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loyalty_memberships IS 'Guest memberships in loyalty programs';


--
-- Name: loyalty_program_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_program_rules (
    id bigint NOT NULL,
    points_per_currency_unit numeric(10,4) DEFAULT 1 NOT NULL,
    tier_qualification_metric character varying(20) DEFAULT 'points'::character varying NOT NULL,
    point_expiry_months integer,
    redemption_approval_required boolean DEFAULT true NOT NULL,
    earning_enabled boolean DEFAULT true NOT NULL,
    min_eligible_amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loyalty_program_rules_id_check CHECK ((id = 1)),
    CONSTRAINT loyalty_program_rules_tier_qualification_metric_check CHECK (((tier_qualification_metric)::text = ANY ((ARRAY['points'::character varying, 'nights'::character varying, 'spend'::character varying])::text[])))
);


--
-- Name: loyalty_programs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_programs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_programs (
    id bigint DEFAULT nextval('public.loyalty_programs_id_seq'::regclass) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    points_per_dollar numeric(10,4) DEFAULT 1.0,
    currency character varying(3) DEFAULT 'USD'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE loyalty_programs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loyalty_programs IS 'Loyalty program definitions';


--
-- Name: loyalty_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_redemptions (
    id bigint DEFAULT nextval('public.loyalty_redemptions_id_seq'::regclass) NOT NULL,
    member_id bigint NOT NULL,
    reward_id bigint NOT NULL,
    transaction_id bigint,
    points_spent integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    requested_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loyalty_redemptions_points_spent_check CHECK ((points_spent > 0)),
    CONSTRAINT loyalty_redemptions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'fulfilled'::character varying])::text[])))
);


--
-- Name: loyalty_rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_rewards_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_rewards (
    id bigint DEFAULT nextval('public.loyalty_rewards_id_seq'::regclass) NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    category character varying(50) NOT NULL,
    points_cost integer NOT NULL,
    minimum_tier_id bigint,
    requires_approval boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    inventory_count integer,
    valid_from date,
    valid_to date,
    terms_conditions text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT loyalty_rewards_points_cost_check CHECK ((points_cost > 0))
);


--
-- Name: loyalty_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_tiers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_tiers (
    id bigint DEFAULT nextval('public.loyalty_tiers_id_seq'::regclass) NOT NULL,
    program_id bigint NOT NULL,
    name character varying(50) NOT NULL,
    min_points integer DEFAULT 0 NOT NULL,
    max_points integer,
    benefits jsonb,
    discount_percentage numeric(5,2) DEFAULT 0,
    points_multiplier numeric(4,2) DEFAULT 1.0,
    color character varying(7),
    icon character varying(100),
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    code character varying(50),
    min_nights integer DEFAULT 0 NOT NULL,
    min_spend numeric(12,2) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE loyalty_tiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loyalty_tiers IS 'Tier levels within loyalty programs';


--
-- Name: loyalty_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_transactions (
    id bigint DEFAULT nextval('public.loyalty_transactions_id_seq'::regclass) NOT NULL,
    member_id bigint NOT NULL,
    account_id bigint NOT NULL,
    transaction_type character varying(20) NOT NULL,
    points_delta integer NOT NULL,
    available_delta integer NOT NULL,
    balance_after integer NOT NULL,
    source_type character varying(50),
    source_id bigint,
    booking_id bigint,
    payment_id bigint,
    invoice_id bigint,
    related_transaction_id bigint,
    description text,
    metadata text,
    actor_user_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT loyalty_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['pending'::character varying, 'earned'::character varying, 'redeemed'::character varying, 'expired'::character varying, 'adjusted'::character varying, 'reversed'::character varying])::text[])))
);


--
-- Name: maintenance_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.maintenance_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: maintenance_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_tickets (
    id bigint DEFAULT nextval('public.maintenance_tickets_id_seq'::regclass) NOT NULL,
    room_id bigint,
    ticket_number character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    category character varying(50) NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying,
    status character varying(20) DEFAULT 'open'::character varying,
    assigned_to bigint,
    reported_by bigint,
    estimated_cost numeric(10,2),
    actual_cost numeric(10,2),
    estimated_hours numeric(5,2),
    actual_hours numeric(5,2),
    scheduled_date timestamp with time zone,
    started_at timestamp with time zone,
    resolved_at timestamp with time zone,
    resolution_notes text,
    images jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT maintenance_tickets_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT maintenance_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'on_hold'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: TABLE maintenance_tickets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.maintenance_tickets IS 'Maintenance work orders';


--
-- Name: night_audit_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.night_audit_details (
    id bigint NOT NULL,
    audit_run_id bigint NOT NULL,
    booking_id bigint,
    room_id bigint,
    record_type character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE night_audit_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.night_audit_details IS 'Detailed records of what was posted in each audit';


--
-- Name: night_audit_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.night_audit_details_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: night_audit_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.night_audit_details_id_seq OWNED BY public.night_audit_details.id;


--
-- Name: night_audit_posted_nights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.night_audit_posted_nights (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    audit_date date NOT NULL,
    room_rate numeric(10,2) NOT NULL,
    room_charge numeric(10,2) NOT NULL,
    service_tax numeric(10,2) NOT NULL,
    tourism_tax numeric(10,2) DEFAULT 0 NOT NULL,
    extra_bed_charge numeric(10,2) DEFAULT 0 NOT NULL,
    extra_bed_tax numeric(10,2) DEFAULT 0 NOT NULL,
    total_posted numeric(10,2) NOT NULL,
    audit_run_id bigint,
    posted_at timestamp with time zone DEFAULT now() NOT NULL,
    posted_by bigint
);


--
-- Name: TABLE night_audit_posted_nights; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.night_audit_posted_nights IS 'Tracks per-night posting for each booking.';


--
-- Name: night_audit_posted_nights_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.night_audit_posted_nights_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: night_audit_posted_nights_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.night_audit_posted_nights_id_seq OWNED BY public.night_audit_posted_nights.id;


--
-- Name: night_audit_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.night_audit_runs (
    id bigint NOT NULL,
    audit_date date NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    run_by bigint,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    total_bookings_posted integer DEFAULT 0,
    total_checkins integer DEFAULT 0,
    total_checkouts integer DEFAULT 0,
    total_revenue numeric(12,2) DEFAULT 0,
    total_rooms_occupied integer DEFAULT 0,
    total_rooms_available integer DEFAULT 0,
    occupancy_rate numeric(5,2) DEFAULT 0,
    rooms_available integer DEFAULT 0,
    rooms_occupied integer DEFAULT 0,
    rooms_reserved integer DEFAULT 0,
    rooms_maintenance integer DEFAULT 0,
    rooms_dirty integer DEFAULT 0,
    payment_method_breakdown jsonb DEFAULT '{}'::jsonb,
    booking_channel_breakdown jsonb DEFAULT '{}'::jsonb,
    notes text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE night_audit_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.night_audit_runs IS 'Tracks each night audit run with statistics';


--
-- Name: night_audit_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.night_audit_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: night_audit_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.night_audit_runs_id_seq OWNED BY public.night_audit_runs.id;


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint DEFAULT nextval('public.users_id_seq'::regclass) NOT NULL,
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    full_name character varying(255),
    phone character varying(20),
    avatar_url text,
    user_type public.usertype DEFAULT 'staff'::public.usertype,
    guest_id bigint,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    is_locked boolean DEFAULT false,
    is_super_admin boolean DEFAULT false,
    email_verification_token character varying(255),
    email_token_expires_at timestamp with time zone,
    two_factor_enabled boolean DEFAULT false,
    two_factor_secret character varying(255),
    two_factor_recovery_codes text[],
    failed_login_attempts integer DEFAULT 0,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    last_login_ip inet,
    password_changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by bigint,
    deleted_at timestamp with time zone,
    CONSTRAINT users_email_check CHECK (((email)::text = lower((email)::text))),
    CONSTRAINT users_username_check CHECK (((username)::text = lower((username)::text))),
    CONSTRAINT valid_email CHECK (((email)::text ~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'::text)),
    CONSTRAINT valid_username CHECK (((username)::text ~ '^[a-z0-9][a-z0-9_-]{2,99}$'::text))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'Core user accounts for system authentication';


--
-- Name: night_audit_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.night_audit_summary AS
 SELECT nar.id,
    nar.audit_date,
    nar.run_at,
    u.username AS run_by_username,
    nar.status,
    nar.total_bookings_posted,
    nar.total_checkins,
    nar.total_checkouts,
    nar.total_revenue,
    nar.occupancy_rate,
    nar.rooms_available,
    nar.rooms_occupied,
    nar.rooms_reserved,
    nar.rooms_maintenance,
    nar.rooms_dirty,
    nar.notes,
    nar.created_at
   FROM (public.night_audit_runs nar
     LEFT JOIN public.users u ON ((nar.run_by = u.id)))
  ORDER BY nar.audit_date DESC;


--
-- Name: notification_consent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_consent_events (
    id bigint NOT NULL,
    guest_id bigint NOT NULL,
    channel character varying(16) DEFAULT 'email'::character varying NOT NULL,
    topic character varying(32) NOT NULL,
    action character varying(8) NOT NULL,
    source character varying(32) NOT NULL,
    policy_version character varying(32),
    actor_type character varying(8) DEFAULT 'guest'::character varying NOT NULL,
    actor_user_id bigint,
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT notification_consent_events_action_check CHECK (((action)::text = ANY ((ARRAY['opt_in'::character varying, 'opt_out'::character varying])::text[]))),
    CONSTRAINT notification_consent_events_actor_type_check CHECK (((actor_type)::text = ANY ((ARRAY['guest'::character varying, 'staff'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: notification_consent_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_consent_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_consent_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_consent_events_id_seq OWNED BY public.notification_consent_events.id;


--
-- Name: notification_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_subscriptions (
    id bigint NOT NULL,
    guest_id bigint NOT NULL,
    channel character varying(16) DEFAULT 'email'::character varying NOT NULL,
    topic character varying(32) NOT NULL,
    subscribed boolean DEFAULT false NOT NULL,
    source character varying(32),
    policy_version character varying(32),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT notification_subscriptions_channel_check CHECK (((channel)::text = 'email'::text)),
    CONSTRAINT notification_subscriptions_topic_check CHECK (((topic)::text = ANY ((ARRAY['announcement'::character varying, 'promotion'::character varying, 'birthday_voucher'::character varying])::text[])))
);


--
-- Name: notification_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_subscriptions_id_seq OWNED BY public.notification_subscriptions.id;


--
-- Name: occupancy_by_room_type; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.occupancy_by_room_type AS
 SELECT rt.id AS room_type_id,
    rt.name AS room_type_name,
    rt.max_occupancy AS capacity_per_room,
    count(r.id) AS total_rooms,
    count(r.id) FILTER (WHERE (b.id IS NOT NULL)) AS occupied_rooms,
    round((((count(r.id) FILTER (WHERE (b.id IS NOT NULL)))::numeric / (NULLIF(count(r.id), 0))::numeric) * (100)::numeric), 1) AS room_occupancy_rate,
    COALESCE(sum(((COALESCE(b.adults, 0) + COALESCE(b.children, 0)) + COALESCE(b.infants, 0))), (0)::bigint) AS total_guests,
    (count(r.id) * rt.max_occupancy) AS total_capacity,
        CASE
            WHEN ((count(r.id) * rt.max_occupancy) > 0) THEN round((((COALESCE(sum(((COALESCE(b.adults, 0) + COALESCE(b.children, 0)) + COALESCE(b.infants, 0))), (0)::bigint))::numeric / (NULLIF((count(r.id) * rt.max_occupancy), 0))::numeric) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS guest_occupancy_rate
   FROM ((public.room_types rt
     LEFT JOIN public.rooms r ON (((r.room_type_id = rt.id) AND (r.is_active = true))))
     LEFT JOIN public.bookings b ON (((r.id = b.room_id) AND ((b.status)::text = 'checked_in'::text) AND (CURRENT_DATE >= b.check_in_date) AND (CURRENT_DATE <= b.check_out_date))))
  WHERE (rt.is_active = true)
  GROUP BY rt.id, rt.name, rt.max_occupancy;


--
-- Name: occupancy_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.occupancy_stats AS
 SELECT date_trunc('day'::text, CURRENT_TIMESTAMP) AS date,
    count(DISTINCT r.id) AS total_rooms,
    count(DISTINCT
        CASE
            WHEN ((b.status)::text = 'checked_in'::text) THEN r.id
            ELSE NULL::bigint
        END) AS occupied_rooms,
    count(DISTINCT
        CASE
            WHEN ((r.status)::text = 'available'::text) THEN r.id
            ELSE NULL::bigint
        END) AS available_rooms,
    round((((count(DISTINCT
        CASE
            WHEN ((b.status)::text = 'checked_in'::text) THEN r.id
            ELSE NULL::bigint
        END))::numeric / (NULLIF(count(DISTINCT r.id), 0))::numeric) * (100)::numeric), 2) AS occupancy_percentage
   FROM (public.rooms r
     LEFT JOIN public.bookings b ON (((r.id = b.room_id) AND ((b.status)::text = 'checked_in'::text) AND ((CURRENT_DATE >= b.check_in_date) AND (CURRENT_DATE <= b.check_out_date)))))
  WHERE (r.is_active = true);


--
-- Name: online_inventory_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.online_inventory_allocations (
    room_type_id bigint NOT NULL,
    stay_date date NOT NULL,
    walk_in_reserved_rooms integer DEFAULT 0 NOT NULL,
    online_booking_enabled boolean DEFAULT true NOT NULL,
    custom_price numeric(10,2),
    updated_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT online_inventory_allocations_walk_in_reserved_rooms_check CHECK ((walk_in_reserved_rooms >= 0)),
    CONSTRAINT online_inventory_allocations_custom_price_check CHECK (((custom_price IS NULL) OR (custom_price > 0)))
);


--
-- Name: passkey_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkey_challenges (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    user_id bigint,
    challenge bytea NOT NULL,
    challenge_type character varying(20) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp with time zone,
    CONSTRAINT passkey_challenges_challenge_type_check CHECK (((challenge_type)::text = ANY ((ARRAY['registration'::character varying, 'authentication'::character varying])::text[])))
);


--
-- Name: passkeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passkeys (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    user_id bigint NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    counter bigint DEFAULT 0,
    transports text[],
    device_type character varying(50),
    device_name character varying(255),
    aaguid uuid,
    backup_eligible boolean DEFAULT false,
    backup_state boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_used_at timestamp with time zone,
    is_active boolean DEFAULT true
);


--
-- Name: TABLE passkeys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.passkeys IS 'WebAuthn passkey credentials for passwordless authentication';


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint DEFAULT nextval('public.payments_id_seq'::regclass) NOT NULL,
    uuid uuid DEFAULT public.gen_uuidv7() NOT NULL,
    booking_id bigint NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying,
    payment_method character varying(50) NOT NULL,
    payment_type character varying(20) DEFAULT 'booking'::character varying,
    transaction_id character varying(255),
    card_last_four character varying(4),
    card_brand character varying(20),
    payment_gateway character varying(50) DEFAULT 'stripe'::character varying,
    gateway_customer_id character varying(255),
    gateway_payment_intent_id character varying(255),
    gateway_charge_id character varying(255),
    status character varying(20) DEFAULT 'pending'::character varying,
    failure_reason text,
    refund_amount numeric(12,2),
    refunded_at timestamp with time zone,
    refund_reason text,
    gateway_refund_id character varying(255),
    metadata jsonb,
    notes text,
    receipt_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    processed_at timestamp with time zone,
    processed_by bigint,
    CONSTRAINT payments_payment_type_check CHECK (((payment_type)::text = ANY ((ARRAY['booking'::character varying, 'deposit'::character varying, 'service'::character varying, 'damage'::character varying, 'refund'::character varying])::text[]))),
    CONSTRAINT payments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'refunded'::character varying, 'void'::character varying])::text[])))
);


--
-- Name: TABLE payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payments IS 'Payment transactions';

--
-- Name: payment_receipt_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_receipt_requests (
    payment_id bigint NOT NULL,
    requested_by bigint,
    request_message text,
    requested_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    uploaded_at timestamp with time zone,
    receipt_path text,
    receipt_content_type character varying(100)
);


--
-- Name: TABLE payment_receipt_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_receipt_requests IS 'Guest receipt upload requests raised against a payment';



--
-- Name: COLUMN payments.payment_gateway; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.payment_gateway IS 'Payment gateway used (stripe, paypal, etc.)';


--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id bigint DEFAULT nextval('public.permissions_id_seq'::regclass) NOT NULL,
    name character varying(100) NOT NULL,
    resource character varying(50) NOT NULL,
    action character varying(20) NOT NULL,
    description text,
    is_system_permission boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT permissions_name_check CHECK (((name)::text = lower((name)::text))),
    CONSTRAINT valid_action CHECK (((action)::text = ANY ((ARRAY['create'::character varying, 'read'::character varying, 'update'::character varying, 'delete'::character varying, 'manage'::character varying, 'execute'::character varying, 'void'::character varying, 'refund'::character varying, 'write'::character varying, 'verify'::character varying, 'review'::character varying, 'assign'::character varying, 'approve'::character varying, 'reject'::character varying, 'escalate'::character varying, 'override'::character varying, 'export'::character varying, 'download'::character varying, 'reveal'::character varying, 'request_resubmission'::character varying, 'view_provider_raw'::character varying, 'manage_reason_codes'::character varying, 'manage_risk_rules'::character varying, 'compose'::character varying, 'send'::character varying])::text[]))),
    CONSTRAINT valid_permission_format CHECK (((name)::text ~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'::text))
);


--
-- Name: TABLE permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permissions IS 'Granular permissions for resources';


--
-- Name: points_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.points_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: points_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.points_transactions (
    id bigint DEFAULT nextval('public.points_transactions_id_seq'::regclass) NOT NULL,
    membership_id bigint NOT NULL,
    transaction_type character varying(20) NOT NULL,
    points integer NOT NULL,
    balance_after integer NOT NULL,
    reference_type character varying(50),
    reference_id bigint,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    CONSTRAINT points_transactions_transaction_type_check CHECK (((transaction_type)::text = ANY ((ARRAY['earn'::character varying, 'redeem'::character varying, 'adjust'::character varying, 'expire'::character varying, 'transfer'::character varying])::text[])))
);


--
-- Name: TABLE points_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.points_transactions IS 'Points earning and redemption history';


--
-- Name: promotion_room_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_room_types (
    promotion_id bigint NOT NULL,
    room_type_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id bigint NOT NULL,
    slug character varying(120) NOT NULL,
    name character varying(160) NOT NULL,
    description text,
    terms text,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    promotion_kind character varying(16) DEFAULT 'voucher'::character varying NOT NULL,
    discount_type character varying(24) NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    max_discount_amount numeric(12,2),
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    claim_starts_at timestamp with time zone,
    claim_ends_at timestamp with time zone,
    stay_starts_on date,
    stay_ends_on date,
    min_nights integer DEFAULT 1 NOT NULL,
    max_nights integer,
    min_subtotal numeric(12,2) DEFAULT 0 NOT NULL,
    claim_limit integer,
    claimed_count integer DEFAULT 0 NOT NULL,
    per_guest_limit integer DEFAULT 1 NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    is_cancellable boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by bigint,
    updated_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT promotions_claim_limit_valid CHECK (((claim_limit IS NULL) OR (claim_limit >= 0))),
    CONSTRAINT promotions_claim_window_valid CHECK (((claim_starts_at IS NULL) OR (claim_ends_at IS NULL) OR (claim_ends_at > claim_starts_at))),
    CONSTRAINT promotions_claimed_count_valid CHECK (((claimed_count >= 0) AND ((claim_limit IS NULL) OR (claimed_count <= claim_limit)))),
    CONSTRAINT promotions_currency_valid CHECK (((length((currency)::text) = 3) AND ((currency)::text = upper((currency)::text)))),
    CONSTRAINT promotions_discount_type_check CHECK (((discount_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed_amount'::character varying])::text[]))),
    CONSTRAINT promotions_discount_value_valid CHECK (((discount_value >= (0)::numeric) AND (((discount_type)::text <> 'percentage'::text) OR (discount_value <= (100)::numeric)))),
    CONSTRAINT promotions_max_discount_valid CHECK (((max_discount_amount IS NULL) OR (max_discount_amount >= (0)::numeric))),
    CONSTRAINT promotions_min_subtotal_valid CHECK ((min_subtotal >= (0)::numeric)),
    CONSTRAINT promotions_name_not_blank CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT promotions_nights_valid CHECK (((min_nights >= 1) AND ((max_nights IS NULL) OR (max_nights >= min_nights)))),
    CONSTRAINT promotions_per_guest_limit_valid CHECK ((per_guest_limit >= 1)),
    CONSTRAINT promotions_promotion_kind_check CHECK (((promotion_kind)::text = ANY ((ARRAY['deal'::character varying, 'voucher'::character varying])::text[]))),
    CONSTRAINT promotions_slug_not_blank CHECK ((length(TRIM(BOTH FROM slug)) > 0)),
    CONSTRAINT promotions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'paused'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT promotions_stay_window_valid CHECK (((stay_starts_on IS NULL) OR (stay_ends_on IS NULL) OR (stay_ends_on >= stay_starts_on))),
    CONSTRAINT promotions_version_valid CHECK ((version >= 1))
);


--
-- Name: promotions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.promotions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promotions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.promotions_id_seq OWNED BY public.promotions.id;


--
-- Name: rate_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_plans (
    id bigint DEFAULT nextval('public.rate_plans_id_seq'::regclass) NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(20) NOT NULL,
    description text,
    plan_type character varying(50) DEFAULT 'standard'::character varying,
    adjustment_type character varying(20) DEFAULT 'percentage'::character varying,
    adjustment_value numeric(10,2),
    valid_from date,
    valid_to date,
    applies_monday boolean DEFAULT true,
    applies_tuesday boolean DEFAULT true,
    applies_wednesday boolean DEFAULT true,
    applies_thursday boolean DEFAULT true,
    applies_friday boolean DEFAULT true,
    applies_saturday boolean DEFAULT true,
    applies_sunday boolean DEFAULT true,
    min_nights integer DEFAULT 1,
    max_nights integer,
    min_advance_booking integer DEFAULT 0,
    max_advance_booking integer,
    blackout_dates jsonb,
    is_active boolean DEFAULT true,
    priority integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rate_plans_adjustment_type_check CHECK (((adjustment_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed'::character varying, 'override'::character varying])::text[]))),
    CONSTRAINT rate_plans_plan_type_check CHECK (((plan_type)::text = ANY ((ARRAY['standard'::character varying, 'seasonal'::character varying, 'promotional'::character varying, 'corporate'::character varying, 'group'::character varying, 'package'::character varying])::text[])))
);


--
-- Name: TABLE rate_plans; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rate_plans IS 'Rate plan definitions for pricing strategies';


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    user_id bigint NOT NULL,
    token_hash character varying(255) NOT NULL,
    device_info jsonb,
    ip_address inet,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    is_revoked boolean DEFAULT false,
    revoked_at timestamp with time zone,
    revoked_by bigint
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refresh_tokens IS 'JWT refresh tokens for session management';


--
-- Name: revenue_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.revenue_summary AS
 SELECT date_trunc('month'::text, (check_in_date)::timestamp with time zone) AS month,
    count(*) AS total_bookings,
    sum(total_amount) AS total_revenue,
    sum(subtotal) AS room_revenue,
    sum(tax_amount) AS tax_collected,
    avg(total_amount) AS average_booking_value,
    sum(
        CASE
            WHEN ((payment_status)::text = 'paid'::text) THEN total_amount
            ELSE (0)::numeric
        END) AS collected_revenue
   FROM public.bookings b
  WHERE ((status)::text <> ALL ((ARRAY['voided'::character varying, 'no_show'::character varying])::text[]))
  GROUP BY (date_trunc('month'::text, (check_in_date)::timestamp with time zone))
  ORDER BY (date_trunc('month'::text, (check_in_date)::timestamp with time zone)) DESC;


--
-- Name: reward_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reward_catalog_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reward_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_catalog (
    id bigint DEFAULT nextval('public.reward_catalog_id_seq'::regclass) NOT NULL,
    program_id bigint NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    category character varying(50) NOT NULL,
    points_required integer NOT NULL,
    quantity_available integer,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    is_active boolean DEFAULT true,
    terms_conditions text,
    image_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE reward_catalog; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reward_catalog IS 'Available rewards for redemption';


--
-- Name: reward_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reward_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reward_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reward_redemptions (
    id bigint DEFAULT nextval('public.reward_redemptions_id_seq'::regclass) NOT NULL,
    membership_id bigint NOT NULL,
    reward_id bigint NOT NULL,
    booking_id bigint,
    points_spent integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    redemption_code character varying(50),
    redeemed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    used_at timestamp with time zone,
    expires_at timestamp with time zone,
    notes text,
    CONSTRAINT reward_redemptions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'confirmed'::character varying, 'used'::character varying, 'void'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: TABLE reward_redemptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reward_redemptions IS 'Reward redemption records';


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id bigint NOT NULL,
    permission_id bigint NOT NULL,
    granted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    granted_by bigint
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id bigint DEFAULT nextval('public.roles_id_seq'::regclass) NOT NULL,
    name character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    is_system_role boolean DEFAULT false,
    priority integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT roles_name_check CHECK (((name)::text = lower((name)::text))),
    CONSTRAINT valid_role_name CHECK (((name)::text ~ '^[a-z][a-z0-9_]*$'::text))
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'Role definitions for role-based access control';


--
-- Name: room_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.room_changes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: room_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_changes (
    id bigint DEFAULT nextval('public.room_changes_id_seq'::regclass) NOT NULL,
    booking_id bigint NOT NULL,
    from_room_id bigint NOT NULL,
    to_room_id bigint NOT NULL,
    guest_id bigint,
    reason text,
    changed_by bigint,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE room_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.room_changes IS 'Tracks room changes during guest stays';


--
-- Name: COLUMN room_changes.booking_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_changes.booking_id IS 'The booking that had the room change';


--
-- Name: COLUMN room_changes.from_room_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_changes.from_room_id IS 'Original room the guest was in';


--
-- Name: COLUMN room_changes.to_room_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_changes.to_room_id IS 'New room the guest moved to';


--
-- Name: COLUMN room_changes.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_changes.reason IS 'Reason for the room change';


--
-- Name: COLUMN room_changes.changed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.room_changes.changed_by IS 'Staff member who processed the change';


--
-- Name: room_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.room_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: room_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_events (
    id bigint DEFAULT nextval('public.room_events_id_seq'::regclass) NOT NULL,
    room_id bigint NOT NULL,
    event_type character varying(50) DEFAULT 'status_change'::character varying NOT NULL,
    status character varying(20),
    priority character varying(20) DEFAULT 'normal'::character varying,
    notes text,
    scheduled_date timestamp with time zone,
    created_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: room_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.room_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: room_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_history (
    id bigint DEFAULT nextval('public.room_history_id_seq'::regclass) NOT NULL,
    room_id bigint NOT NULL,
    from_status character varying(20),
    to_status character varying(20) NOT NULL,
    notes text,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    changed_by bigint,
    is_auto_generated boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE room_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.room_history IS 'History of room status changes';


--
-- Name: room_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.room_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: room_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_rates (
    id bigint DEFAULT nextval('public.room_rates_id_seq'::regclass) NOT NULL,
    rate_plan_id bigint NOT NULL,
    room_type_id bigint NOT NULL,
    price numeric(10,2) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE room_rates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.room_rates IS 'Specific prices for room types under rate plans';


--
-- Name: room_status_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_status_change_log (
    id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    room_id bigint NOT NULL,
    from_status character varying(20),
    to_status character varying(20),
    trigger_source character varying(100),
    booking_id bigint,
    was_blocked boolean DEFAULT false,
    reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: room_status_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.room_status_summary AS
 SELECT status,
    count(*) AS count,
    round((((count(*))::numeric * 100.0) / sum(count(*)) OVER ()), 2) AS percentage,
    json_agg(json_build_object('id', id, 'room_number', room_number, 'floor', floor) ORDER BY room_number) AS rooms
   FROM public.rooms r
  WHERE (is_active = true)
  GROUP BY status;


--
-- Name: room_status_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_status_transitions (
    from_status character varying(20) NOT NULL,
    to_status character varying(20) NOT NULL,
    is_allowed boolean DEFAULT true,
    requires_permission character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE room_status_transitions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.room_status_transitions IS 'Defines valid room status transitions';


--
-- Name: room_type_amenities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_type_amenities (
    room_type_id bigint NOT NULL,
    amenity_id bigint NOT NULL,
    is_complimentary boolean DEFAULT true
);


--
-- Name: route_access_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_access_policies (
    route_id character varying(100) NOT NULL,
    path character varying(255) NOT NULL,
    nav_label character varying(100),
    nav_group character varying(50),
    required_permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    required_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    excluded_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    nav_permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    nav_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    nav_excluded_roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_navigation boolean DEFAULT false NOT NULL,
    is_system_policy boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_route_access_policy_arrays CHECK (((jsonb_typeof(required_permissions) = 'array'::text) AND (jsonb_typeof(required_roles) = 'array'::text) AND (jsonb_typeof(excluded_roles) = 'array'::text) AND (jsonb_typeof(nav_permissions) = 'array'::text) AND (jsonb_typeof(nav_roles) = 'array'::text) AND (jsonb_typeof(nav_excluded_roles) = 'array'::text))),
    CONSTRAINT valid_route_access_policy_id CHECK (((route_id)::text ~ '^[a-z][a-z0-9_-]*$'::text))
);


--
-- Name: self_checkin_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.self_checkin_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: self_checkin_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.self_checkin_events (
    id bigint DEFAULT nextval('public.self_checkin_events_id_seq'::regclass) NOT NULL,
    booking_id bigint NOT NULL,
    guest_id bigint,
    ekyc_verification_id bigint,
    user_id bigint,
    checked_in_at timestamp with time zone,
    room_key_issued boolean DEFAULT false,
    digital_key_sent boolean DEFAULT false,
    device_type character varying(100),
    checkin_location character varying(255),
    event_type character varying(100),
    source character varying(100),
    event_data text,
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.services_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id bigint DEFAULT nextval('public.services_id_seq'::regclass) NOT NULL,
    name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    description text,
    unit_price numeric(10,2) NOT NULL,
    unit_type character varying(20) DEFAULT 'item'::character varying,
    tax_rate numeric(5,2) DEFAULT 0,
    is_taxable boolean DEFAULT true,
    is_active boolean DEFAULT true,
    image_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.services IS 'Additional service catalog';


--
-- Name: support_action_idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_action_idempotency_keys (
    id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    actor_user_id bigint NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    action character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: support_action_idempotency_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_action_idempotency_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_action_idempotency_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_action_idempotency_keys_id_seq OWNED BY public.support_action_idempotency_keys.id;


--
-- Name: support_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_conversations (
    id bigint NOT NULL,
    conversation_number character varying(40) NOT NULL,
    guest_id bigint NOT NULL,
    booking_id bigint,
    subject character varying(160) NOT NULL,
    category character varying(32) NOT NULL,
    status character varying(32) DEFAULT 'waiting_for_staff'::character varying NOT NULL,
    priority character varying(16) DEFAULT 'normal'::character varying NOT NULL,
    assigned_team character varying(64) DEFAULT 'front_desk'::character varying NOT NULL,
    assigned_to_user_id bigint,
    escalation_level smallint DEFAULT 0 NOT NULL,
    escalated_at timestamp with time zone,
    first_response_due_at timestamp with time zone,
    resolution_due_at timestamp with time zone,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    resolution_code character varying(64),
    resolution_summary text,
    reopen_count integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    last_activity_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT support_conversations_category_check CHECK (((category)::text = ANY ((ARRAY['booking'::character varying, 'stay'::character varying, 'billing'::character varying, 'loyalty'::character varying, 'technical'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT support_conversations_escalation_level_check CHECK (((escalation_level >= 0) AND (escalation_level <= 3))),
    CONSTRAINT support_conversations_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT support_conversations_reopen_count_check CHECK ((reopen_count >= 0)),
    CONSTRAINT support_conversations_status_check CHECK (((status)::text = ANY ((ARRAY['waiting_for_staff'::character varying, 'waiting_for_guest'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[]))),
    CONSTRAINT support_conversations_version_check CHECK ((version >= 1))
);


--
-- Name: support_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_conversations_id_seq OWNED BY public.support_conversations.id;


--
-- Name: support_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_events (
    id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    actor_guest_id bigint,
    actor_user_id bigint,
    event_type character varying(64) NOT NULL,
    from_status character varying(32),
    to_status character varying(32),
    details jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: support_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_events_id_seq OWNED BY public.support_events.id;


--
-- Name: support_guest_request_idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_guest_request_idempotency_keys (
    guest_id bigint NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    conversation_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    author_type character varying(16) NOT NULL,
    author_guest_id bigint,
    author_user_id bigint,
    body text NOT NULL,
    client_message_id character varying(128),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT support_messages_author_type_check CHECK (((author_type)::text = ANY ((ARRAY['guest'::character varying, 'staff'::character varying, 'system'::character varying])::text[])))
);


--
-- Name: support_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_messages_id_seq OWNED BY public.support_messages.id;


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id bigint DEFAULT nextval('public.system_settings_id_seq'::regclass) NOT NULL,
    key character varying(100) NOT NULL,
    value text NOT NULL,
    value_type character varying(20) DEFAULT 'string'::character varying,
    category character varying(50) DEFAULT 'general'::character varying,
    description text,
    is_public boolean DEFAULT false,
    is_encrypted boolean DEFAULT false,
    validation_pattern character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by bigint,
    CONSTRAINT system_settings_value_type_check CHECK (((value_type)::text = ANY ((ARRAY['string'::character varying, 'number'::character varying, 'boolean'::character varying, 'json'::character varying])::text[])))
);


--
-- Name: TABLE system_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_settings IS 'System-wide configuration settings including tax rates';


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id bigint NOT NULL,
    role_id bigint NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    assigned_by bigint,
    expires_at timestamp with time zone
);


--
-- Name: user_complete; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_complete AS
 SELECT u.id,
    u.uuid,
    u.username,
    u.email,
    u.full_name,
    u.user_type,
    u.is_active,
    u.is_verified,
    u.is_super_admin,
    u.last_login_at,
    array_agg(DISTINCT r.name) FILTER (WHERE (r.name IS NOT NULL)) AS roles,
    array_agg(DISTINCT p.name) FILTER (WHERE (p.name IS NOT NULL)) AS permissions
   FROM ((((public.users u
     LEFT JOIN public.user_roles ur ON ((u.id = ur.user_id)))
     LEFT JOIN public.roles r ON ((ur.role_id = r.id)))
     LEFT JOIN public.role_permissions rp ON ((r.id = rp.role_id)))
     LEFT JOIN public.permissions p ON ((rp.permission_id = p.id)))
  WHERE (u.deleted_at IS NULL)
  GROUP BY u.id, u.uuid, u.username, u.email, u.full_name, u.user_type, u.is_active, u.is_verified, u.is_super_admin, u.last_login_at;


--
-- Name: user_guests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_guests (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    guest_id bigint NOT NULL,
    relationship_type character varying(50) DEFAULT 'family'::character varying,
    can_book_for boolean DEFAULT true,
    can_view_bookings boolean DEFAULT true,
    can_modify boolean DEFAULT false,
    notes text,
    linked_by bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE user_guests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_guests IS 'Links users to guests they can book/manage on behalf of';


--
-- Name: user_guests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_guests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_guests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_guests_id_seq OWNED BY public.user_guests.id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    user_id bigint NOT NULL,
    permission_id bigint NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    assigned_by bigint
);


--
-- Name: user_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id bigint DEFAULT nextval('public.user_sessions_id_seq'::regclass) NOT NULL,
    session_id uuid DEFAULT public.gen_uuidv7() NOT NULL,
    user_id bigint NOT NULL,
    ip_address inet,
    user_agent text,
    device_info jsonb,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_activity_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: TABLE user_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_sessions IS 'Active user sessions for tracking';


--
-- Name: voucher_redemption_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voucher_redemption_allocations (
    id bigint NOT NULL,
    redemption_id bigint NOT NULL,
    booking_id bigint NOT NULL,
    stay_date date NOT NULL,
    gross_amount numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) NOT NULL,
    net_amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT voucher_redemption_allocations_check CHECK (((discount_amount >= (0)::numeric) AND (discount_amount <= gross_amount))),
    CONSTRAINT voucher_redemption_allocations_check1 CHECK (((net_amount >= (0)::numeric) AND (net_amount = (gross_amount - discount_amount)))),
    CONSTRAINT voucher_redemption_allocations_gross_amount_check CHECK ((gross_amount >= (0)::numeric))
);


--
-- Name: voucher_redemption_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voucher_redemption_allocations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voucher_redemption_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voucher_redemption_allocations_id_seq OWNED BY public.voucher_redemption_allocations.id;


--
-- Name: voucher_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voucher_redemptions (
    id bigint NOT NULL,
    voucher_id bigint NOT NULL,
    promotion_id bigint NOT NULL,
    booking_id bigint NOT NULL,
    guest_id bigint NOT NULL,
    status character varying(16) DEFAULT 'applied'::character varying NOT NULL,
    gross_subtotal numeric(12,2) NOT NULL,
    discount_type character varying(24) NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) NOT NULL,
    net_total numeric(12,2) NOT NULL,
    applied_by bigint,
    applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reversed_by bigint,
    reversed_at timestamp with time zone,
    reversal_reason text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT voucher_redemptions_check CHECK (((discount_value >= (0)::numeric) AND (((discount_type)::text <> 'percentage'::text) OR (discount_value <= (100)::numeric)))),
    CONSTRAINT voucher_redemptions_check1 CHECK (((discount_amount >= (0)::numeric) AND (discount_amount <= gross_subtotal))),
    CONSTRAINT voucher_redemptions_check2 CHECK (((net_total >= (0)::numeric) AND (net_total = (gross_subtotal - discount_amount)))),
    CONSTRAINT voucher_redemptions_discount_type_check CHECK (((discount_type)::text = ANY ((ARRAY['percentage'::character varying, 'fixed_amount'::character varying])::text[]))),
    CONSTRAINT voucher_redemptions_gross_subtotal_check CHECK ((gross_subtotal >= (0)::numeric)),
    CONSTRAINT voucher_redemptions_status_check CHECK (((status)::text = ANY ((ARRAY['applied'::character varying, 'reversed'::character varying])::text[])))
);


--
-- Name: voucher_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voucher_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voucher_redemptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voucher_redemptions_id_seq OWNED BY public.voucher_redemptions.id;


--
-- Name: vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vouchers (
    id bigint NOT NULL,
    promotion_id bigint NOT NULL,
    guest_id bigint NOT NULL,
    code character varying(64) NOT NULL,
    status character varying(16) DEFAULT 'available'::character varying NOT NULL,
    source character varying(16) NOT NULL,
    expires_at timestamp with time zone,
    redeemed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by bigint,
    revocation_reason text,
    issued_by bigint,
    claimed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_reference character varying(64),
    CONSTRAINT vouchers_code_not_blank CHECK ((length(TRIM(BOTH FROM code)) > 0)),
    CONSTRAINT vouchers_source_check CHECK (((source)::text = ANY ((ARRAY['guest_claim'::character varying, 'admin_issue'::character varying])::text[]))),
    CONSTRAINT vouchers_status_check CHECK (((status)::text = ANY ((ARRAY['available'::character varying, 'redeemed'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: vouchers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vouchers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vouchers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vouchers_id_seq OWNED BY public.vouchers.id;


--
-- Name: audit_logs_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ATTACH PARTITION public.audit_logs_default DEFAULT;


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: customer_ledger_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledger_payments ALTER COLUMN id SET DEFAULT nextval('public.customer_ledger_payments_id_seq'::regclass);


--
-- Name: customer_ledgers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers ALTER COLUMN id SET DEFAULT nextval('public.customer_ledgers_id_seq'::regclass);


--
-- Name: email_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns ALTER COLUMN id SET DEFAULT nextval('public.email_campaigns_id_seq'::regclass);


--
-- Name: email_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries ALTER COLUMN id SET DEFAULT nextval('public.email_deliveries_id_seq'::regclass);


--
-- Name: email_suppressions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions ALTER COLUMN id SET DEFAULT nextval('public.email_suppressions_id_seq'::regclass);


--
-- Name: guest_complimentary_credits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_complimentary_credits ALTER COLUMN id SET DEFAULT nextval('public.guest_complimentary_credits_id_seq'::regclass);


--
-- Name: guest_portal_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_portal_sessions ALTER COLUMN id SET DEFAULT nextval('public.guest_portal_sessions_id_seq'::regclass);


--
-- Name: night_audit_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_details ALTER COLUMN id SET DEFAULT nextval('public.night_audit_details_id_seq'::regclass);


--
-- Name: night_audit_posted_nights id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_posted_nights ALTER COLUMN id SET DEFAULT nextval('public.night_audit_posted_nights_id_seq'::regclass);


--
-- Name: night_audit_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_runs ALTER COLUMN id SET DEFAULT nextval('public.night_audit_runs_id_seq'::regclass);


--
-- Name: notification_consent_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_consent_events ALTER COLUMN id SET DEFAULT nextval('public.notification_consent_events_id_seq'::regclass);


--
-- Name: notification_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.notification_subscriptions_id_seq'::regclass);


--
-- Name: promotions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions ALTER COLUMN id SET DEFAULT nextval('public.promotions_id_seq'::regclass);


--
-- Name: support_action_idempotency_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_action_idempotency_keys ALTER COLUMN id SET DEFAULT nextval('public.support_action_idempotency_keys_id_seq'::regclass);


--
-- Name: support_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations ALTER COLUMN id SET DEFAULT nextval('public.support_conversations_id_seq'::regclass);


--
-- Name: support_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events ALTER COLUMN id SET DEFAULT nextval('public.support_events_id_seq'::regclass);


--
-- Name: support_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages ALTER COLUMN id SET DEFAULT nextval('public.support_messages_id_seq'::regclass);


--
-- Name: user_guests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_guests ALTER COLUMN id SET DEFAULT nextval('public.user_guests_id_seq'::regclass);


--
-- Name: voucher_redemption_allocations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemption_allocations ALTER COLUMN id SET DEFAULT nextval('public.voucher_redemption_allocations_id_seq'::regclass);


--
-- Name: voucher_redemptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions ALTER COLUMN id SET DEFAULT nextval('public.voucher_redemptions_id_seq'::regclass);


--
-- Name: vouchers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers ALTER COLUMN id SET DEFAULT nextval('public.vouchers_id_seq'::regclass);


--
-- Name: invalid_data_quarantine invalid_data_quarantine_pkey; Type: CONSTRAINT; Schema: app; Owner: -
--

ALTER TABLE ONLY app.invalid_data_quarantine
    ADD CONSTRAINT invalid_data_quarantine_pkey PRIMARY KEY (quarantine_id);


--
-- Name: amenities amenities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amenities
    ADD CONSTRAINT amenities_name_key UNIQUE (name);


--
-- Name: amenities amenities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amenities
    ADD CONSTRAINT amenities_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey1 PRIMARY KEY (id, created_at);


--
-- Name: audit_logs_default audit_logs_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs_default
    ADD CONSTRAINT audit_logs_default_pkey PRIMARY KEY (id, created_at);


--
-- Name: booking_channels booking_channels_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_channels
    ADD CONSTRAINT booking_channels_name_key UNIQUE (name);


--
-- Name: booking_channels booking_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_channels
    ADD CONSTRAINT booking_channels_pkey PRIMARY KEY (id);


--
-- Name: booking_guests booking_guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_guests
    ADD CONSTRAINT booking_guests_pkey PRIMARY KEY (id);


--
-- Name: booking_history booking_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_history
    ADD CONSTRAINT booking_history_pkey PRIMARY KEY (id);


--
-- Name: booking_modifications booking_modifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_modifications
    ADD CONSTRAINT booking_modifications_pkey PRIMARY KEY (id);


--
-- Name: booking_services booking_services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_booking_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booking_number_key UNIQUE (booking_number);


--
-- Name: bookings bookings_no_room_date_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_no_room_date_overlap EXCLUDE USING gist (room_id WITH =, daterange(check_in_date, check_out_date, '[)'::text) WITH &&) WHERE (((status)::text = ANY ((ARRAY['pending'::character varying, 'pending_payment'::character varying, 'pending_confirmation'::character varying, 'confirmed'::character varying, 'checked_in'::character varying, 'auto_checked_in'::character varying])::text[])));


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_uuid_key UNIQUE (uuid);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: corporate_account_contacts corporate_account_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_account_contacts
    ADD CONSTRAINT corporate_account_contacts_pkey PRIMARY KEY (id);


--
-- Name: corporate_accounts corporate_accounts_company_registration_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_company_registration_key UNIQUE (company_registration);


--
-- Name: corporate_accounts corporate_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_pkey PRIMARY KEY (id);


--
-- Name: customer_ledger_payments customer_ledger_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledger_payments
    ADD CONSTRAINT customer_ledger_payments_pkey PRIMARY KEY (id);


--
-- Name: customer_ledgers customer_ledgers_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_invoice_number_key UNIQUE (invoice_number);


--
-- Name: customer_ledgers customer_ledgers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_pkey PRIMARY KEY (id);


--
-- Name: ekyc_access_events ekyc_access_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_access_events
    ADD CONSTRAINT ekyc_access_events_pkey PRIMARY KEY (id);


--
-- Name: ekyc_decision_history ekyc_decision_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_decision_history
    ADD CONSTRAINT ekyc_decision_history_pkey PRIMARY KEY (id);


--
-- Name: ekyc_idempotency_keys ekyc_idempotency_keys_application_id_actor_id_idempotency_k_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_idempotency_keys
    ADD CONSTRAINT ekyc_idempotency_keys_application_id_actor_id_idempotency_k_key UNIQUE (application_id, actor_id, idempotency_key);


--
-- Name: ekyc_idempotency_keys ekyc_idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_idempotency_keys
    ADD CONSTRAINT ekyc_idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: ekyc_notes ekyc_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_notes
    ADD CONSTRAINT ekyc_notes_pkey PRIMARY KEY (id);


--
-- Name: ekyc_reason_codes ekyc_reason_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_reason_codes
    ADD CONSTRAINT ekyc_reason_codes_pkey PRIMARY KEY (code);


--
-- Name: ekyc_sensitive_reveals ekyc_sensitive_reveals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_sensitive_reveals
    ADD CONSTRAINT ekyc_sensitive_reveals_pkey PRIMARY KEY (id);


--
-- Name: ekyc_verifications ekyc_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_verifications
    ADD CONSTRAINT ekyc_verifications_pkey PRIMARY KEY (id);


--
-- Name: ekyc_verifications ekyc_verifications_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_verifications
    ADD CONSTRAINT ekyc_verifications_uuid_key UNIQUE (uuid);


--
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);


--
-- Name: email_deliveries email_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY (id);


--
-- Name: email_suppressions email_suppressions_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_email_key UNIQUE (email);


--
-- Name: email_suppressions email_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_code_key UNIQUE (code);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: guest_complimentary_credits guest_complimentary_credits_guest_id_room_type_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_complimentary_credits
    ADD CONSTRAINT guest_complimentary_credits_guest_id_room_type_id_key UNIQUE (guest_id, room_type_id);


--
-- Name: guest_complimentary_credits guest_complimentary_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_complimentary_credits
    ADD CONSTRAINT guest_complimentary_credits_pkey PRIMARY KEY (id);


--
-- Name: guest_documents guest_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_documents
    ADD CONSTRAINT guest_documents_pkey PRIMARY KEY (id);


--
-- Name: guest_notes guest_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_notes
    ADD CONSTRAINT guest_notes_pkey PRIMARY KEY (id);


--
-- Name: guest_portal_sessions guest_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_portal_sessions
    ADD CONSTRAINT guest_portal_sessions_pkey PRIMARY KEY (id);


--
-- Name: guest_portal_sessions guest_portal_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_portal_sessions
    ADD CONSTRAINT guest_portal_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: guest_preferences guest_preferences_guest_id_category_preference_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_preferences
    ADD CONSTRAINT guest_preferences_guest_id_category_preference_key_key UNIQUE (guest_id, category, preference_key);


--
-- Name: guest_preferences guest_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_preferences
    ADD CONSTRAINT guest_preferences_pkey PRIMARY KEY (id);


--
-- Name: guest_reviews guest_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_reviews
    ADD CONSTRAINT guest_reviews_pkey PRIMARY KEY (id);


--
-- Name: guests guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_pkey PRIMARY KEY (id);


--
-- Name: guests guests_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_uuid_key UNIQUE (uuid);


--
-- Name: housekeeping_tasks housekeeping_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.housekeeping_tasks
    ADD CONSTRAINT housekeeping_tasks_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_uuid_key UNIQUE (uuid);


--
-- Name: loyalty_accounts loyalty_accounts_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_member_id_key UNIQUE (member_id);


--
-- Name: loyalty_accounts loyalty_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_pkey PRIMARY KEY (id);


--
-- Name: loyalty_members loyalty_members_guest_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_members
    ADD CONSTRAINT loyalty_members_guest_id_key UNIQUE (guest_id);


--
-- Name: loyalty_members loyalty_members_member_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_members
    ADD CONSTRAINT loyalty_members_member_number_key UNIQUE (member_number);


--
-- Name: loyalty_members loyalty_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_members
    ADD CONSTRAINT loyalty_members_pkey PRIMARY KEY (id);


--
-- Name: loyalty_memberships loyalty_memberships_guest_id_program_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_memberships
    ADD CONSTRAINT loyalty_memberships_guest_id_program_id_key UNIQUE (guest_id, program_id);


--
-- Name: loyalty_memberships loyalty_memberships_member_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_memberships
    ADD CONSTRAINT loyalty_memberships_member_number_key UNIQUE (member_number);


--
-- Name: loyalty_memberships loyalty_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_memberships
    ADD CONSTRAINT loyalty_memberships_pkey PRIMARY KEY (id);


--
-- Name: loyalty_program_rules loyalty_program_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_program_rules
    ADD CONSTRAINT loyalty_program_rules_pkey PRIMARY KEY (id);


--
-- Name: loyalty_programs loyalty_programs_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_programs
    ADD CONSTRAINT loyalty_programs_name_key UNIQUE (name);


--
-- Name: loyalty_programs loyalty_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_programs
    ADD CONSTRAINT loyalty_programs_pkey PRIMARY KEY (id);


--
-- Name: loyalty_redemptions loyalty_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_redemptions
    ADD CONSTRAINT loyalty_redemptions_pkey PRIMARY KEY (id);


--
-- Name: loyalty_rewards loyalty_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rewards
    ADD CONSTRAINT loyalty_rewards_pkey PRIMARY KEY (id);


--
-- Name: loyalty_tiers loyalty_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_pkey PRIMARY KEY (id);


--
-- Name: loyalty_tiers loyalty_tiers_program_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_program_id_name_key UNIQUE (program_id, name);


--
-- Name: loyalty_transactions loyalty_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id);


--
-- Name: maintenance_tickets maintenance_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_pkey PRIMARY KEY (id);


--
-- Name: maintenance_tickets maintenance_tickets_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_ticket_number_key UNIQUE (ticket_number);


--
-- Name: night_audit_details night_audit_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_details
    ADD CONSTRAINT night_audit_details_pkey PRIMARY KEY (id);


--
-- Name: night_audit_posted_nights night_audit_posted_nights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_posted_nights
    ADD CONSTRAINT night_audit_posted_nights_pkey PRIMARY KEY (id);


--
-- Name: night_audit_runs night_audit_runs_audit_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_runs
    ADD CONSTRAINT night_audit_runs_audit_date_key UNIQUE (audit_date);


--
-- Name: night_audit_runs night_audit_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_runs
    ADD CONSTRAINT night_audit_runs_pkey PRIMARY KEY (id);


--
-- Name: notification_consent_events notification_consent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_consent_events
    ADD CONSTRAINT notification_consent_events_pkey PRIMARY KEY (id);


--
-- Name: notification_subscriptions notification_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_subscriptions
    ADD CONSTRAINT notification_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: online_inventory_allocations online_inventory_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_inventory_allocations
    ADD CONSTRAINT online_inventory_allocations_pkey PRIMARY KEY (room_type_id, stay_date);


--
-- Name: passkey_challenges passkey_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_challenges
    ADD CONSTRAINT passkey_challenges_pkey PRIMARY KEY (id);


--
-- Name: passkeys passkeys_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_credential_id_key UNIQUE (credential_id);


--
-- Name: passkeys passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_pkey PRIMARY KEY (id);


--
-- Name: payment_receipt_requests payment_receipt_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_requests
    ADD CONSTRAINT payment_receipt_requests_pkey PRIMARY KEY (payment_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_uuid_key UNIQUE (uuid);


--
-- Name: permissions permissions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_name_key UNIQUE (name);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: points_transactions points_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_pkey PRIMARY KEY (id);


--
-- Name: promotion_room_types promotion_room_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_room_types
    ADD CONSTRAINT promotion_room_types_pkey PRIMARY KEY (promotion_id, room_type_id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_slug_key UNIQUE (slug);


--
-- Name: rate_plans rate_plans_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_plans
    ADD CONSTRAINT rate_plans_code_key UNIQUE (code);


--
-- Name: rate_plans rate_plans_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_plans
    ADD CONSTRAINT rate_plans_name_key UNIQUE (name);


--
-- Name: rate_plans rate_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_plans
    ADD CONSTRAINT rate_plans_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: reward_catalog reward_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_catalog
    ADD CONSTRAINT reward_catalog_pkey PRIMARY KEY (id);


--
-- Name: reward_redemptions reward_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_pkey PRIMARY KEY (id);


--
-- Name: reward_redemptions reward_redemptions_redemption_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_redemption_code_key UNIQUE (redemption_code);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: room_changes room_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT room_changes_pkey PRIMARY KEY (id);


--
-- Name: room_events room_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_events
    ADD CONSTRAINT room_events_pkey PRIMARY KEY (id);


--
-- Name: room_history room_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_history
    ADD CONSTRAINT room_history_pkey PRIMARY KEY (id);


--
-- Name: room_rates room_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_rates
    ADD CONSTRAINT room_rates_pkey PRIMARY KEY (id);


--
-- Name: room_rates room_rates_rate_plan_id_room_type_id_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_rates
    ADD CONSTRAINT room_rates_rate_plan_id_room_type_id_effective_from_key UNIQUE (rate_plan_id, room_type_id, effective_from);


--
-- Name: room_status_change_log room_status_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_status_change_log
    ADD CONSTRAINT room_status_change_log_pkey PRIMARY KEY (id);


--
-- Name: room_status_transitions room_status_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_status_transitions
    ADD CONSTRAINT room_status_transitions_pkey PRIMARY KEY (from_status, to_status);


--
-- Name: room_type_amenities room_type_amenities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_type_amenities
    ADD CONSTRAINT room_type_amenities_pkey PRIMARY KEY (room_type_id, amenity_id);


--
-- Name: room_types room_types_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_types
    ADD CONSTRAINT room_types_code_key UNIQUE (code);


--
-- Name: room_types room_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_types
    ADD CONSTRAINT room_types_name_key UNIQUE (name);


--
-- Name: room_types room_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_types
    ADD CONSTRAINT room_types_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_room_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_room_number_key UNIQUE (room_number);


--
-- Name: route_access_policies route_access_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_access_policies
    ADD CONSTRAINT route_access_policies_pkey PRIMARY KEY (route_id);


--
-- Name: self_checkin_events self_checkin_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_checkin_events
    ADD CONSTRAINT self_checkin_events_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: support_action_idempotency_keys support_action_idempotency_ke_conversation_id_actor_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_action_idempotency_keys
    ADD CONSTRAINT support_action_idempotency_ke_conversation_id_actor_user_id_key UNIQUE (conversation_id, actor_user_id, idempotency_key);


--
-- Name: support_action_idempotency_keys support_action_idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_action_idempotency_keys
    ADD CONSTRAINT support_action_idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: support_conversations support_conversations_conversation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_conversation_number_key UNIQUE (conversation_number);


--
-- Name: support_conversations support_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_pkey PRIMARY KEY (id);


--
-- Name: support_events support_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_pkey PRIMARY KEY (id);


--
-- Name: support_guest_request_idempotency_keys support_guest_request_idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_guest_request_idempotency_keys
    ADD CONSTRAINT support_guest_request_idempotency_keys_pkey PRIMARY KEY (guest_id, idempotency_key);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_key_key UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: night_audit_posted_nights unique_booking_night; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_posted_nights
    ADD CONSTRAINT unique_booking_night UNIQUE (booking_id, audit_date);


--
-- Name: email_deliveries uq_email_deliveries_idempotency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT uq_email_deliveries_idempotency UNIQUE (idempotency_key);


--
-- Name: notification_subscriptions uq_notification_subscriptions_guest_channel_topic; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_subscriptions
    ADD CONSTRAINT uq_notification_subscriptions_guest_channel_topic UNIQUE (guest_id, channel, topic);


--
-- Name: user_guests user_guests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_guests
    ADD CONSTRAINT user_guests_pkey PRIMARY KEY (id);


--
-- Name: user_guests user_guests_user_id_guest_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_guests
    ADD CONSTRAINT user_guests_user_id_guest_id_key UNIQUE (user_id, guest_id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, permission_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_session_id_key UNIQUE (session_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: users users_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_uuid_key UNIQUE (uuid);


--
-- Name: voucher_redemption_allocations voucher_redemption_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemption_allocations
    ADD CONSTRAINT voucher_redemption_allocations_pkey PRIMARY KEY (id);


--
-- Name: voucher_redemption_allocations voucher_redemption_allocations_redemption_id_stay_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemption_allocations
    ADD CONSTRAINT voucher_redemption_allocations_redemption_id_stay_date_key UNIQUE (redemption_id, stay_date);


--
-- Name: voucher_redemptions voucher_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_pkey PRIMARY KEY (id);


--
-- Name: vouchers vouchers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_code_key UNIQUE (code);


--
-- Name: vouchers vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_pkey PRIMARY KEY (id);


--
-- Name: idx_invalid_data_quarantine_source; Type: INDEX; Schema: app; Owner: -
--

CREATE INDEX idx_invalid_data_quarantine_source ON app.invalid_data_quarantine USING btree (source_table, quarantined_at DESC);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON ONLY public.audit_logs USING btree (action);


--
-- Name: audit_logs_default_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_default_action_idx ON public.audit_logs_default USING btree (action);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON ONLY public.audit_logs USING btree (created_at DESC);


--
-- Name: audit_logs_default_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_default_created_at_idx ON public.audit_logs_default USING btree (created_at DESC);


--
-- Name: idx_audit_logs_created_at_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at_brin ON ONLY public.audit_logs USING brin (created_at);


--
-- Name: audit_logs_default_created_at_idx1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_default_created_at_idx1 ON public.audit_logs_default USING brin (created_at);


--
-- Name: idx_audit_logs_details_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_details_trgm ON ONLY public.audit_logs USING gin (((details)::text) public.gin_trgm_ops);


--
-- Name: audit_logs_default_details_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_default_details_idx ON public.audit_logs_default USING gin (((details)::text) public.gin_trgm_ops);


--
-- Name: idx_audit_logs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_resource ON ONLY public.audit_logs USING btree (resource_type, resource_id);


--
-- Name: audit_logs_default_resource_type_resource_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_default_resource_type_resource_id_idx ON public.audit_logs_default USING btree (resource_type, resource_id);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON ONLY public.audit_logs USING btree (user_id);


--
-- Name: audit_logs_default_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_default_user_id_idx ON public.audit_logs_default USING btree (user_id);


--
-- Name: idx_booking_channels_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_channels_active ON public.booking_channels USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_booking_channels_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_channels_type ON public.booking_channels USING btree (channel_type);


--
-- Name: idx_booking_guests_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_guests_booking ON public.booking_guests USING btree (booking_id);


--
-- Name: idx_booking_guests_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_guests_guest ON public.booking_guests USING btree (guest_id);


--
-- Name: idx_booking_history_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_history_booking ON public.booking_history USING btree (booking_id);


--
-- Name: idx_booking_history_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_history_created_at ON public.booking_history USING btree (created_at DESC);


--
-- Name: idx_booking_mods_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_mods_booking ON public.booking_modifications USING btree (booking_id);


--
-- Name: idx_booking_mods_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_mods_date ON public.booking_modifications USING btree (modified_at DESC);


--
-- Name: idx_booking_services_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_services_booking ON public.booking_services USING btree (booking_id);


--
-- Name: idx_booking_services_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_services_date ON public.booking_services USING btree (service_date);


--
-- Name: idx_booking_services_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_services_service ON public.booking_services USING btree (service_id);


--
-- Name: idx_bookings_booking_channel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_booking_channel_id ON public.bookings USING btree (booking_channel_id);


--
-- Name: idx_bookings_booking_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_booking_number_trgm ON public.bookings USING gin (booking_number public.gin_trgm_ops);


--
-- Name: idx_bookings_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_company_id ON public.bookings USING btree (company_id) WHERE (company_id IS NOT NULL);


--
-- Name: idx_bookings_complimentary_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_complimentary_status ON public.bookings USING btree (status) WHERE ((status)::text = ANY ((ARRAY['partial_complimentary'::character varying, 'fully_complimentary'::character varying])::text[]));


--
-- Name: idx_bookings_corporate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_corporate ON public.bookings USING btree (corporate_account_id) WHERE (corporate_account_id IS NOT NULL);


--
-- Name: idx_bookings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_created_at ON public.bookings USING btree (created_at DESC);


--
-- Name: idx_bookings_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_dates ON public.bookings USING btree (check_in_date, check_out_date);


--
-- Name: idx_bookings_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_guest ON public.bookings USING btree (guest_id);


--
-- Name: idx_bookings_is_posted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_is_posted ON public.bookings USING btree (is_posted);


--
-- Name: idx_bookings_market_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_market_code ON public.bookings USING btree (market_code) WHERE (market_code IS NOT NULL);


--
-- Name: idx_bookings_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_payment_status ON public.bookings USING btree (payment_status);


--
-- Name: idx_bookings_posted_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_posted_date ON public.bookings USING btree (posted_date);


--
-- Name: idx_bookings_pre_checkin_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_pre_checkin_token ON public.bookings USING btree (pre_checkin_token) WHERE (pre_checkin_token IS NOT NULL);


--
-- Name: idx_bookings_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_room ON public.bookings USING btree (room_id);


--
-- Name: idx_bookings_room_status_covering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_room_status_covering ON public.bookings USING btree (room_id, status) INCLUDE (check_in_date, check_out_date, total_amount);


--
-- Name: idx_bookings_room_status_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_room_status_dates ON public.bookings USING btree (room_id, status, check_in_date, check_out_date);


--
-- Name: idx_bookings_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_source ON public.bookings USING btree (source);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_companies_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_active ON public.companies USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_companies_company_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_company_name_trgm ON public.companies USING gin (company_name public.gin_trgm_ops);


--
-- Name: idx_companies_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_companies_name_unique ON public.companies USING btree (lower((company_name)::text));


--
-- Name: idx_corporate_account_contacts_corp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_account_contacts_corp ON public.corporate_account_contacts USING btree (corporate_account_id);


--
-- Name: idx_corporate_accounts_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_accounts_name ON public.corporate_accounts USING btree (name);


--
-- Name: idx_customer_ledger_payments_ledger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledger_payments_ledger ON public.customer_ledger_payments USING btree (ledger_id);


--
-- Name: idx_customer_ledger_payments_receipt_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''::text));


--
-- Name: idx_customer_ledgers_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_booking ON public.customer_ledgers USING btree (booking_id);


--
-- Name: idx_customer_ledgers_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_company ON public.customer_ledgers USING btree (company_name);


--
-- Name: idx_customer_ledgers_department_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_department_code ON public.customer_ledgers USING btree (department_code);


--
-- Name: idx_customer_ledgers_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_due_date ON public.customer_ledgers USING btree (due_date);


--
-- Name: idx_customer_ledgers_folio_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_folio_number ON public.customer_ledgers USING btree (folio_number);


--
-- Name: idx_customer_ledgers_folio_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_folio_type ON public.customer_ledgers USING btree (folio_type);


--
-- Name: idx_customer_ledgers_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_guest ON public.customer_ledgers USING btree (guest_id);


--
-- Name: idx_customer_ledgers_posting_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_posting_date ON public.customer_ledgers USING btree (posting_date);


--
-- Name: idx_customer_ledgers_room_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_room_number ON public.customer_ledgers USING btree (room_number);


--
-- Name: idx_customer_ledgers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_status ON public.customer_ledgers USING btree (status);


--
-- Name: idx_customer_ledgers_transaction_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_ledgers_transaction_code ON public.customer_ledgers USING btree (transaction_code);


--
-- Name: idx_ekyc_access_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_access_application ON public.ekyc_access_events USING btree (application_id, created_at DESC);


--
-- Name: idx_ekyc_assigned_reviewer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_assigned_reviewer ON public.ekyc_verifications USING btree (assigned_reviewer_id);


--
-- Name: idx_ekyc_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_email ON public.ekyc_verifications USING btree (email);


--
-- Name: idx_ekyc_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_guest ON public.ekyc_verifications USING btree (guest_id);


--
-- Name: idx_ekyc_guest_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_guest_latest ON public.ekyc_verifications USING btree (guest_id, submitted_at DESC, updated_at DESC, id DESC);


--
-- Name: idx_ekyc_history_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_history_application ON public.ekyc_decision_history USING btree (application_id, created_at DESC);


--
-- Name: idx_ekyc_id_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_id_number ON public.ekyc_verifications USING btree (id_number);


--
-- Name: idx_ekyc_manual_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_manual_review ON public.ekyc_verifications USING btree (manual_review_required);


--
-- Name: idx_ekyc_notes_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_notes_application ON public.ekyc_notes USING btree (application_id, created_at DESC);


--
-- Name: idx_ekyc_reveals_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_reveals_application ON public.ekyc_sensitive_reveals USING btree (application_id, created_at DESC);


--
-- Name: idx_ekyc_risk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_risk ON public.ekyc_verifications USING btree (risk_level, risk_score DESC);


--
-- Name: idx_ekyc_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_status ON public.ekyc_verifications USING btree (status);


--
-- Name: idx_ekyc_submitted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_submitted_at ON public.ekyc_verifications USING btree (submitted_at DESC);


--
-- Name: idx_ekyc_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ekyc_user ON public.ekyc_verifications USING btree (user_id);


--
-- Name: idx_email_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_campaigns_status ON public.email_campaigns USING btree (status, scheduled_at);


--
-- Name: idx_email_deliveries_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_deliveries_campaign ON public.email_deliveries USING btree (campaign_id);


--
-- Name: idx_email_deliveries_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_deliveries_claim ON public.email_deliveries USING btree (status, next_attempt_at);


--
-- Name: idx_email_deliveries_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_deliveries_guest ON public.email_deliveries USING btree (guest_id, created_at DESC);


--
-- Name: idx_guest_credits_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_credits_guest_id ON public.guest_complimentary_credits USING btree (guest_id);


--
-- Name: idx_guest_credits_room_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_credits_room_type ON public.guest_complimentary_credits USING btree (room_type_id);


--
-- Name: idx_guest_documents_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_documents_guest_id ON public.guest_documents USING btree (guest_id);


--
-- Name: idx_guest_notes_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_notes_alert ON public.guest_notes USING btree (guest_id, is_alert) WHERE (is_alert = true);


--
-- Name: idx_guest_notes_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_notes_guest_id ON public.guest_notes USING btree (guest_id);


--
-- Name: idx_guest_portal_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_portal_sessions_expires_at ON public.guest_portal_sessions USING btree (expires_at);


--
-- Name: idx_guest_portal_sessions_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_portal_sessions_guest_id ON public.guest_portal_sessions USING btree (guest_id);


--
-- Name: idx_guest_preferences_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_preferences_guest_id ON public.guest_preferences USING btree (guest_id);


--
-- Name: idx_guest_reviews_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_reviews_guest_id ON public.guest_reviews USING btree (guest_id);


--
-- Name: idx_guest_reviews_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_reviews_published ON public.guest_reviews USING btree (is_published) WHERE (is_published = true);


--
-- Name: idx_guest_reviews_rating; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guest_reviews_rating ON public.guest_reviews USING btree (overall_rating);


--
-- Name: idx_guests_blacklist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_blacklist ON public.guests USING btree (is_blacklisted) WHERE (is_blacklisted = true);


--
-- Name: idx_guests_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_company ON public.guests USING btree (company_name) WHERE (company_name IS NOT NULL);


--
-- Name: idx_guests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_created_at ON public.guests USING btree (created_at DESC);


--
-- Name: idx_guests_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_email ON public.guests USING btree (email) WHERE (deleted_at IS NULL);


--
-- Name: idx_guests_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_email_trgm ON public.guests USING gin (email public.gin_trgm_ops) WHERE ((deleted_at IS NULL) AND (email IS NOT NULL));


--
-- Name: idx_guests_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_full_name ON public.guests USING btree (full_name);


--
-- Name: idx_guests_full_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_full_name_trgm ON public.guests USING gin (full_name public.gin_trgm_ops) WHERE (deleted_at IS NULL);


--
-- Name: idx_guests_full_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_guests_full_name_unique ON public.guests USING btree (lower(TRIM(BOTH FROM full_name))) WHERE (deleted_at IS NULL);


--
-- Name: idx_guests_guest_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_guest_type ON public.guests USING btree (guest_type);


--
-- Name: idx_guests_ic_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_ic_number ON public.guests USING btree (ic_number);


--
-- Name: idx_guests_member_discount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_member_discount ON public.guests USING btree (guest_type, discount_percentage) WHERE (guest_type = 'member'::public.guest_type);


--
-- Name: idx_guests_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_phone ON public.guests USING btree (phone) WHERE (deleted_at IS NULL);


--
-- Name: idx_guests_tourism_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_tourism_type ON public.guests USING btree (tourism_type) WHERE (tourism_type IS NOT NULL);


--
-- Name: idx_guests_vip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guests_vip ON public.guests USING btree (vip_status) WHERE (vip_status IS NOT NULL);


--
-- Name: idx_housekeeping_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_housekeeping_assigned ON public.housekeeping_tasks USING btree (assigned_to);


--
-- Name: idx_housekeeping_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_housekeeping_date ON public.housekeeping_tasks USING btree (scheduled_date);


--
-- Name: idx_housekeeping_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_housekeeping_room ON public.housekeeping_tasks USING btree (room_id);


--
-- Name: idx_housekeeping_room_date_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_housekeeping_room_date_status ON public.housekeeping_tasks USING btree (room_id, task_date, status);


--
-- Name: idx_housekeeping_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_housekeeping_status ON public.housekeeping_tasks USING btree (status);


--
-- Name: idx_invoices_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_booking ON public.invoices USING btree (booking_id);


--
-- Name: idx_invoices_corporate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_corporate ON public.invoices USING btree (bill_to_corporate_id);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_guest ON public.invoices USING btree (bill_to_guest_id);


--
-- Name: idx_invoices_issue_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_issue_date ON public.invoices USING btree (issue_date DESC);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_loyalty_members_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_members_status ON public.loyalty_members USING btree (status);


--
-- Name: idx_loyalty_memberships_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_memberships_guest ON public.loyalty_memberships USING btree (guest_id);


--
-- Name: idx_loyalty_memberships_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_memberships_program ON public.loyalty_memberships USING btree (program_id);


--
-- Name: idx_loyalty_redemptions_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_redemptions_member ON public.loyalty_redemptions USING btree (member_id, requested_at DESC);


--
-- Name: idx_loyalty_redemptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_redemptions_status ON public.loyalty_redemptions USING btree (status, requested_at DESC);


--
-- Name: idx_loyalty_rewards_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_rewards_status ON public.loyalty_rewards USING btree (is_active, category);


--
-- Name: idx_loyalty_tiers_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_tiers_program ON public.loyalty_tiers USING btree (program_id);


--
-- Name: idx_loyalty_transactions_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_booking ON public.loyalty_transactions USING btree (booking_id);


--
-- Name: idx_loyalty_transactions_member_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_member_created ON public.loyalty_transactions USING btree (member_id, created_at DESC);


--
-- Name: idx_loyalty_transactions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_source ON public.loyalty_transactions USING btree (source_type, source_id);


--
-- Name: idx_maintenance_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_assigned ON public.maintenance_tickets USING btree (assigned_to);


--
-- Name: idx_maintenance_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_priority ON public.maintenance_tickets USING btree (priority);


--
-- Name: idx_maintenance_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_room ON public.maintenance_tickets USING btree (room_id);


--
-- Name: idx_maintenance_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_status ON public.maintenance_tickets USING btree (status);


--
-- Name: idx_night_audit_details_audit_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_night_audit_details_audit_run_id ON public.night_audit_details USING btree (audit_run_id);


--
-- Name: idx_night_audit_details_booking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_night_audit_details_booking_id ON public.night_audit_details USING btree (booking_id);


--
-- Name: idx_night_audit_posted_nights_date_brin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_night_audit_posted_nights_date_brin ON public.night_audit_posted_nights USING brin (audit_date);


--
-- Name: idx_notification_consent_events_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_consent_events_guest ON public.notification_consent_events USING btree (guest_id, created_at DESC);


--
-- Name: idx_notification_subscriptions_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_subscriptions_topic ON public.notification_subscriptions USING btree (channel, topic, subscribed);


--
-- Name: idx_online_inventory_allocations_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_inventory_allocations_date ON public.online_inventory_allocations USING btree (stay_date, room_type_id);


--
-- Name: idx_passkey_challenges_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkey_challenges_expires ON public.passkey_challenges USING btree (expires_at);


--
-- Name: idx_passkeys_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkeys_user_id ON public.passkeys USING btree (user_id) WHERE (is_active = true);


--
-- Name: idx_payments_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking ON public.payments USING btree (booking_id);


--
-- Name: idx_payments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_created_at ON public.payments USING btree (created_at DESC);


--
-- Name: idx_payments_gateway_payment_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_gateway_payment_intent ON public.payments USING btree (gateway_payment_intent_id) WHERE (gateway_payment_intent_id IS NOT NULL);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_transaction ON public.payments USING btree (transaction_id) WHERE (transaction_id IS NOT NULL);


--
-- Name: idx_points_transactions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_created ON public.points_transactions USING btree (created_at DESC);


--
-- Name: idx_points_transactions_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_membership ON public.points_transactions USING btree (membership_id);


--
-- Name: idx_points_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_points_transactions_type ON public.points_transactions USING btree (transaction_type);


--
-- Name: idx_posted_nights_audit_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posted_nights_audit_run ON public.night_audit_posted_nights USING btree (audit_run_id);


--
-- Name: idx_posted_nights_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posted_nights_booking ON public.night_audit_posted_nights USING btree (booking_id);


--
-- Name: idx_posted_nights_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posted_nights_date ON public.night_audit_posted_nights USING btree (audit_date);


--
-- Name: idx_promotion_room_types_room_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotion_room_types_room_type ON public.promotion_room_types USING btree (room_type_id, promotion_id);


--
-- Name: idx_promotions_public_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promotions_public_window ON public.promotions USING btree (status, is_public, claim_starts_at, claim_ends_at);


--
-- Name: idx_rate_plans_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_plans_active ON public.rate_plans USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_rate_plans_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_plans_dates ON public.rate_plans USING btree (valid_from, valid_to);


--
-- Name: idx_rate_plans_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_plans_type ON public.rate_plans USING btree (plan_type);


--
-- Name: idx_refresh_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_expires ON public.refresh_tokens USING btree (expires_at) WHERE (is_revoked = false);


--
-- Name: idx_refresh_tokens_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_token_hash ON public.refresh_tokens USING btree (token_hash) WHERE (is_revoked = false);


--
-- Name: idx_refresh_tokens_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user_id ON public.refresh_tokens USING btree (user_id) WHERE (is_revoked = false);


--
-- Name: idx_reward_catalog_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_catalog_active ON public.reward_catalog USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_reward_catalog_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_catalog_category ON public.reward_catalog USING btree (category);


--
-- Name: idx_reward_catalog_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_catalog_program ON public.reward_catalog USING btree (program_id);


--
-- Name: idx_reward_redemptions_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_redemptions_membership ON public.reward_redemptions USING btree (membership_id);


--
-- Name: idx_reward_redemptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reward_redemptions_status ON public.reward_redemptions USING btree (status);


--
-- Name: idx_role_permissions_permission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions USING btree (permission_id);


--
-- Name: idx_role_permissions_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_role_id ON public.role_permissions USING btree (role_id);


--
-- Name: idx_room_changes_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_changes_booking ON public.room_changes USING btree (booking_id);


--
-- Name: idx_room_changes_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_changes_changed_at ON public.room_changes USING btree (changed_at DESC);


--
-- Name: idx_room_changes_from_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_changes_from_room ON public.room_changes USING btree (from_room_id);


--
-- Name: idx_room_changes_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_changes_guest ON public.room_changes USING btree (guest_id);


--
-- Name: idx_room_changes_to_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_changes_to_room ON public.room_changes USING btree (to_room_id);


--
-- Name: idx_room_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_events_created ON public.room_events USING btree (created_at DESC);


--
-- Name: idx_room_events_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_events_room ON public.room_events USING btree (room_id);


--
-- Name: idx_room_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_history_created ON public.room_history USING btree (created_at DESC);


--
-- Name: idx_room_history_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_history_room ON public.room_history USING btree (room_id);


--
-- Name: idx_room_rates_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_rates_dates ON public.room_rates USING btree (effective_from, effective_to);


--
-- Name: idx_room_rates_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_rates_plan ON public.room_rates USING btree (rate_plan_id);


--
-- Name: idx_room_rates_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_rates_type ON public.room_rates USING btree (room_type_id);


--
-- Name: idx_room_status_log_room_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_status_log_room_created ON public.room_status_change_log USING btree (room_id, created_at DESC);


--
-- Name: idx_room_type_amenities_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_type_amenities_type ON public.room_type_amenities USING btree (room_type_id);


--
-- Name: idx_rooms_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_active ON public.rooms USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_rooms_floor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_floor ON public.rooms USING btree (floor);


--
-- Name: idx_rooms_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_status ON public.rooms USING btree (status);


--
-- Name: idx_rooms_status_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_status_active ON public.rooms USING btree (status, is_active) WHERE (is_active = true);


--
-- Name: idx_rooms_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_type ON public.rooms USING btree (room_type_id);


--
-- Name: idx_self_checkin_events_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_checkin_events_guest ON public.self_checkin_events USING btree (guest_id);


--
-- Name: idx_self_checkin_events_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_checkin_events_source ON public.self_checkin_events USING btree (source);


--
-- Name: idx_services_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_active ON public.services USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_services_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_category ON public.services USING btree (category);


--
-- Name: idx_support_conversations_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_conversations_assignee ON public.support_conversations USING btree (assigned_to_user_id, status, last_activity_at DESC) WHERE (assigned_to_user_id IS NOT NULL);


--
-- Name: idx_support_conversations_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_conversations_booking ON public.support_conversations USING btree (booking_id) WHERE (booking_id IS NOT NULL);


--
-- Name: idx_support_conversations_guest_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_conversations_guest_activity ON public.support_conversations USING btree (guest_id, last_activity_at DESC);


--
-- Name: idx_support_conversations_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_conversations_queue ON public.support_conversations USING btree (status, priority DESC, first_response_due_at, last_activity_at);


--
-- Name: idx_support_events_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_events_conversation_created ON public.support_events USING btree (conversation_id, created_at, id);


--
-- Name: idx_support_guest_request_idempotency_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_guest_request_idempotency_conversation ON public.support_guest_request_idempotency_keys USING btree (conversation_id);


--
-- Name: idx_support_messages_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_conversation_created ON public.support_messages USING btree (conversation_id, created_at, id);


--
-- Name: idx_system_settings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_category ON public.system_settings USING btree (category);


--
-- Name: idx_system_settings_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_public ON public.system_settings USING btree (is_public) WHERE (is_public = true);


--
-- Name: idx_user_guests_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_guests_guest_id ON public.user_guests USING btree (guest_id);


--
-- Name: idx_user_guests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_guests_user_id ON public.user_guests USING btree (user_id);


--
-- Name: idx_user_permissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_permissions_user_id ON public.user_permissions USING btree (user_id);


--
-- Name: idx_user_roles_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role_id ON public.user_roles USING btree (role_id);


--
-- Name: idx_user_roles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user_id ON public.user_roles USING btree (user_id);


--
-- Name: idx_user_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_expires ON public.user_sessions USING btree (expires_at);


--
-- Name: idx_user_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id) WHERE (is_active = true);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (is_active) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_guest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_guest_id ON public.users USING btree (guest_id) WHERE (guest_id IS NOT NULL);


--
-- Name: idx_users_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_user_type ON public.users USING btree (user_type);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_username_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username_trgm ON public.users USING gin (username public.gin_trgm_ops) WHERE (deleted_at IS NULL);


--
-- Name: idx_voucher_redemption_allocations_booking_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voucher_redemption_allocations_booking_date ON public.voucher_redemption_allocations USING btree (booking_id, stay_date);


--
-- Name: idx_voucher_redemptions_guest_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voucher_redemptions_guest_applied ON public.voucher_redemptions USING btree (guest_id, applied_at DESC);


--
-- Name: idx_vouchers_guest_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vouchers_guest_status ON public.vouchers USING btree (guest_id, status, expires_at);


--
-- Name: idx_vouchers_promotion_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vouchers_promotion_guest ON public.vouchers USING btree (promotion_id, guest_id, status);


--
-- Name: uq_bookings_guest_portal_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bookings_guest_portal_request ON public.bookings USING btree (guest_id, portal_request_id) WHERE (portal_request_id IS NOT NULL);


--
-- Name: uq_customer_ledgers_booking_room_charge; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_customer_ledgers_booking_room_charge ON public.customer_ledgers USING btree (booking_id) WHERE (((post_type)::text = 'room_charge'::text) AND (COALESCE(is_reversal, false) = false) AND (booking_id IS NOT NULL));


--
-- Name: uq_support_messages_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_support_messages_client_id ON public.support_messages USING btree (conversation_id, author_type, client_message_id) WHERE (client_message_id IS NOT NULL);


--
-- Name: uq_voucher_redemptions_active_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_voucher_redemptions_active_booking ON public.voucher_redemptions USING btree (booking_id) WHERE ((status)::text = 'applied'::text);


--
-- Name: uq_voucher_redemptions_active_voucher; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_voucher_redemptions_active_voucher ON public.voucher_redemptions USING btree (voucher_id) WHERE ((status)::text = 'applied'::text);


--
-- Name: uq_vouchers_promotion_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vouchers_promotion_guest ON public.vouchers USING btree (promotion_id, guest_id);


--
-- Name: uq_vouchers_source_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vouchers_source_reference ON public.vouchers USING btree (guest_id, source_reference) WHERE (source_reference IS NOT NULL);


--
-- Name: ux_loyalty_earned_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_loyalty_earned_source ON public.loyalty_transactions USING btree (member_id, source_type, source_id, transaction_type) WHERE ((source_type IS NOT NULL) AND (source_id IS NOT NULL) AND ((transaction_type)::text = 'earned'::text));


--
-- Name: ux_loyalty_reversal_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_loyalty_reversal_once ON public.loyalty_transactions USING btree (related_transaction_id, transaction_type) WHERE ((related_transaction_id IS NOT NULL) AND ((transaction_type)::text = 'reversed'::text));


--
-- Name: ux_loyalty_tiers_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_loyalty_tiers_code ON public.loyalty_tiers USING btree (code) WHERE (code IS NOT NULL);


--
-- Name: audit_logs_default_action_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_logs_action ATTACH PARTITION public.audit_logs_default_action_idx;


--
-- Name: audit_logs_default_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_logs_created_at ATTACH PARTITION public.audit_logs_default_created_at_idx;


--
-- Name: audit_logs_default_created_at_idx1; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_logs_created_at_brin ATTACH PARTITION public.audit_logs_default_created_at_idx1;


--
-- Name: audit_logs_default_details_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_logs_details_trgm ATTACH PARTITION public.audit_logs_default_details_idx;


--
-- Name: audit_logs_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.audit_logs_pkey1 ATTACH PARTITION public.audit_logs_default_pkey;


--
-- Name: audit_logs_default_resource_type_resource_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_logs_resource ATTACH PARTITION public.audit_logs_default_resource_type_resource_id_idx;


--
-- Name: audit_logs_default_user_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_logs_user_id ATTACH PARTITION public.audit_logs_default_user_id_idx;


--
-- Name: bookings trg_enforce_booking_tourism_tax; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_booking_tourism_tax BEFORE INSERT OR UPDATE OF guest_id, check_in_date, check_out_date, is_tourist, tourism_tax_amount ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_tourism_tax();


--
-- Name: payments trg_sync_booking_payment_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_booking_payment_status AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.sync_booking_payment_status();


--
-- Name: bookings trg_sync_room_status_booking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_room_status_booking AFTER INSERT OR UPDATE OF status, check_in_date ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.sync_room_status_with_booking();


--
-- Name: customer_ledgers trigger_generate_folio_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_generate_folio_number BEFORE INSERT ON public.customer_ledgers FOR EACH ROW EXECUTE FUNCTION public.generate_folio_number();


--
-- Name: customer_ledgers trigger_generate_invoice_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_generate_invoice_number BEFORE INSERT ON public.customer_ledgers FOR EACH ROW EXECUTE FUNCTION public.generate_invoice_number();


--
-- Name: customer_ledgers trigger_update_customer_ledger_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_customer_ledger_timestamp BEFORE UPDATE ON public.customer_ledgers FOR EACH ROW EXECUTE FUNCTION public.update_customer_ledger_timestamp();


--
-- Name: bookings trigger_validate_booking_occupancy; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_validate_booking_occupancy BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.validate_booking_occupancy();


--
-- Name: booking_channels update_booking_channels_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_booking_channels_updated_at BEFORE UPDATE ON public.booking_channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: bookings update_bookings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: corporate_accounts update_corporate_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_corporate_accounts_updated_at BEFORE UPDATE ON public.corporate_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: email_campaigns update_email_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_email_campaigns_updated_at BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: email_deliveries update_email_deliveries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_email_deliveries_updated_at BEFORE UPDATE ON public.email_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: email_templates update_email_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: guest_notes update_guest_notes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_guest_notes_updated_at BEFORE UPDATE ON public.guest_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: guest_preferences update_guest_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_guest_preferences_updated_at BEFORE UPDATE ON public.guest_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: guest_reviews update_guest_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_guest_reviews_updated_at BEFORE UPDATE ON public.guest_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: guests update_guests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_guests_updated_at BEFORE UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: housekeeping_tasks update_housekeeping_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_housekeeping_updated_at BEFORE UPDATE ON public.housekeeping_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: invoices update_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: loyalty_accounts update_loyalty_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_loyalty_accounts_updated_at BEFORE UPDATE ON public.loyalty_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: loyalty_members update_loyalty_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_loyalty_members_updated_at BEFORE UPDATE ON public.loyalty_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: loyalty_memberships update_loyalty_memberships_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_loyalty_memberships_updated_at BEFORE UPDATE ON public.loyalty_memberships FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: loyalty_programs update_loyalty_programs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_loyalty_programs_updated_at BEFORE UPDATE ON public.loyalty_programs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: loyalty_rewards update_loyalty_rewards_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_loyalty_rewards_updated_at BEFORE UPDATE ON public.loyalty_rewards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: maintenance_tickets update_maintenance_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_maintenance_updated_at BEFORE UPDATE ON public.maintenance_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: notification_subscriptions update_notification_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_notification_subscriptions_updated_at BEFORE UPDATE ON public.notification_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: promotions update_promotions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: rate_plans update_rate_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_rate_plans_updated_at BEFORE UPDATE ON public.rate_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reward_catalog update_reward_catalog_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reward_catalog_updated_at BEFORE UPDATE ON public.reward_catalog FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: roles update_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: room_types update_room_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_room_types_updated_at BEFORE UPDATE ON public.room_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: rooms update_rooms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: route_access_policies update_route_access_policies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_route_access_policies_updated_at BEFORE UPDATE ON public.route_access_policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: services update_services_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: support_conversations update_support_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_support_conversations_updated_at BEFORE UPDATE ON public.support_conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: system_settings update_system_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_guests update_user_guests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_guests_updated_at BEFORE UPDATE ON public.user_guests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: voucher_redemptions update_voucher_redemptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_voucher_redemptions_updated_at BEFORE UPDATE ON public.voucher_redemptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: vouchers update_vouchers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_vouchers_updated_at BEFORE UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_logs audit_logs_user_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: booking_guests booking_guests_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_guests
    ADD CONSTRAINT booking_guests_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_guests booking_guests_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_guests
    ADD CONSTRAINT booking_guests_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: booking_history booking_history_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_history
    ADD CONSTRAINT booking_history_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_history booking_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_history
    ADD CONSTRAINT booking_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: booking_modifications booking_modifications_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_modifications
    ADD CONSTRAINT booking_modifications_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_modifications booking_modifications_modified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_modifications
    ADD CONSTRAINT booking_modifications_modified_by_fkey FOREIGN KEY (modified_by) REFERENCES public.users(id);


--
-- Name: booking_services booking_services_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_services booking_services_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: booking_services booking_services_delivered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_delivered_by_fkey FOREIGN KEY (delivered_by) REFERENCES public.users(id);


--
-- Name: booking_services booking_services_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_services
    ADD CONSTRAINT booking_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: bookings bookings_booking_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booking_channel_id_fkey FOREIGN KEY (booking_channel_id) REFERENCES public.booking_channels(id);


--
-- Name: bookings bookings_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: bookings bookings_corporate_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES public.corporate_accounts(id);


--
-- Name: bookings bookings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_posted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_rate_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_rate_plan_id_fkey FOREIGN KEY (rate_plan_id) REFERENCES public.rate_plans(id);


--
-- Name: bookings bookings_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: bookings bookings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: companies companies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: corporate_account_contacts corporate_account_contacts_corporate_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_account_contacts
    ADD CONSTRAINT corporate_account_contacts_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES public.corporate_accounts(id) ON DELETE CASCADE;


--
-- Name: corporate_accounts corporate_accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_accounts
    ADD CONSTRAINT corporate_accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: customer_ledger_payments customer_ledger_payments_ledger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledger_payments
    ADD CONSTRAINT customer_ledger_payments_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES public.customer_ledgers(id) ON DELETE CASCADE;


--
-- Name: customer_ledger_payments customer_ledger_payments_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledger_payments
    ADD CONSTRAINT customer_ledger_payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_original_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_original_transaction_id_fkey FOREIGN KEY (original_transaction_id) REFERENCES public.customer_ledgers(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: customer_ledgers customer_ledgers_void_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_ledgers
    ADD CONSTRAINT customer_ledgers_void_by_fkey FOREIGN KEY (void_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ekyc_access_events ekyc_access_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_access_events
    ADD CONSTRAINT ekyc_access_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: ekyc_access_events ekyc_access_events_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_access_events
    ADD CONSTRAINT ekyc_access_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.ekyc_verifications(id) ON DELETE CASCADE;


--
-- Name: ekyc_decision_history ekyc_decision_history_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_decision_history
    ADD CONSTRAINT ekyc_decision_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ekyc_decision_history ekyc_decision_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_decision_history
    ADD CONSTRAINT ekyc_decision_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.ekyc_verifications(id) ON DELETE CASCADE;


--
-- Name: ekyc_idempotency_keys ekyc_idempotency_keys_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_idempotency_keys
    ADD CONSTRAINT ekyc_idempotency_keys_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ekyc_idempotency_keys ekyc_idempotency_keys_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_idempotency_keys
    ADD CONSTRAINT ekyc_idempotency_keys_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.ekyc_verifications(id) ON DELETE CASCADE;


--
-- Name: ekyc_notes ekyc_notes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_notes
    ADD CONSTRAINT ekyc_notes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.ekyc_verifications(id) ON DELETE CASCADE;


--
-- Name: ekyc_notes ekyc_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_notes
    ADD CONSTRAINT ekyc_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: ekyc_sensitive_reveals ekyc_sensitive_reveals_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_sensitive_reveals
    ADD CONSTRAINT ekyc_sensitive_reveals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: ekyc_sensitive_reveals ekyc_sensitive_reveals_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_sensitive_reveals
    ADD CONSTRAINT ekyc_sensitive_reveals_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.ekyc_verifications(id) ON DELETE CASCADE;


--
-- Name: ekyc_verifications ekyc_verifications_assigned_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_verifications
    ADD CONSTRAINT ekyc_verifications_assigned_reviewer_id_fkey FOREIGN KEY (assigned_reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ekyc_verifications ekyc_verifications_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_verifications
    ADD CONSTRAINT ekyc_verifications_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: ekyc_verifications ekyc_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_verifications
    ADD CONSTRAINT ekyc_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ekyc_verifications ekyc_verifications_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ekyc_verifications
    ADD CONSTRAINT ekyc_verifications_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_campaigns email_campaigns_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_campaigns email_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_campaigns email_campaigns_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE RESTRICT;


--
-- Name: email_campaigns email_campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE SET NULL;


--
-- Name: email_deliveries email_deliveries_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;


--
-- Name: email_deliveries email_deliveries_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: email_deliveries email_deliveries_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_deliveries
    ADD CONSTRAINT email_deliveries_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.vouchers(id) ON DELETE SET NULL;


--
-- Name: guest_complimentary_credits fk_guest_credits_room_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_complimentary_credits
    ADD CONSTRAINT fk_guest_credits_room_type FOREIGN KEY (room_type_id) REFERENCES public.room_types(id) ON DELETE CASCADE;


--
-- Name: guest_reviews fk_guest_reviews_booking; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_reviews
    ADD CONSTRAINT fk_guest_reviews_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: reward_redemptions fk_reward_redemptions_booking; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT fk_reward_redemptions_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: room_changes fk_room_changes_booking; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT fk_room_changes_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: room_changes fk_room_changes_guest; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT fk_room_changes_guest FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: room_changes fk_room_changes_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT fk_room_changes_user FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: users fk_users_guest; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_guest FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: guest_complimentary_credits guest_complimentary_credits_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_complimentary_credits
    ADD CONSTRAINT guest_complimentary_credits_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: guest_documents guest_documents_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_documents
    ADD CONSTRAINT guest_documents_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: guest_documents guest_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_documents
    ADD CONSTRAINT guest_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id);


--
-- Name: guest_notes guest_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_notes
    ADD CONSTRAINT guest_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: guest_notes guest_notes_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_notes
    ADD CONSTRAINT guest_notes_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: guest_portal_sessions guest_portal_sessions_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_portal_sessions
    ADD CONSTRAINT guest_portal_sessions_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: guest_preferences guest_preferences_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_preferences
    ADD CONSTRAINT guest_preferences_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: guest_reviews guest_reviews_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_reviews
    ADD CONSTRAINT guest_reviews_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: guest_reviews guest_reviews_response_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_reviews
    ADD CONSTRAINT guest_reviews_response_by_fkey FOREIGN KEY (response_by) REFERENCES public.users(id);


--
-- Name: guests guests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: guests guests_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guests
    ADD CONSTRAINT guests_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: housekeeping_tasks housekeeping_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.housekeeping_tasks
    ADD CONSTRAINT housekeeping_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: housekeeping_tasks housekeeping_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.housekeeping_tasks
    ADD CONSTRAINT housekeeping_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: housekeeping_tasks housekeeping_tasks_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.housekeeping_tasks
    ADD CONSTRAINT housekeeping_tasks_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_bill_to_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_bill_to_corporate_id_fkey FOREIGN KEY (bill_to_corporate_id) REFERENCES public.corporate_accounts(id);


--
-- Name: invoices invoices_bill_to_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_bill_to_guest_id_fkey FOREIGN KEY (bill_to_guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: loyalty_accounts loyalty_accounts_current_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_current_tier_id_fkey FOREIGN KEY (current_tier_id) REFERENCES public.loyalty_tiers(id);


--
-- Name: loyalty_accounts loyalty_accounts_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_accounts
    ADD CONSTRAINT loyalty_accounts_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.loyalty_members(id) ON DELETE CASCADE;


--
-- Name: loyalty_members loyalty_members_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_members
    ADD CONSTRAINT loyalty_members_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: loyalty_memberships loyalty_memberships_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_memberships
    ADD CONSTRAINT loyalty_memberships_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: loyalty_memberships loyalty_memberships_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_memberships
    ADD CONSTRAINT loyalty_memberships_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.loyalty_programs(id) ON DELETE CASCADE;


--
-- Name: loyalty_memberships loyalty_memberships_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_memberships
    ADD CONSTRAINT loyalty_memberships_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.loyalty_tiers(id);


--
-- Name: loyalty_redemptions loyalty_redemptions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_redemptions
    ADD CONSTRAINT loyalty_redemptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.loyalty_members(id) ON DELETE CASCADE;


--
-- Name: loyalty_redemptions loyalty_redemptions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_redemptions
    ADD CONSTRAINT loyalty_redemptions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: loyalty_redemptions loyalty_redemptions_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_redemptions
    ADD CONSTRAINT loyalty_redemptions_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES public.loyalty_rewards(id);


--
-- Name: loyalty_redemptions loyalty_redemptions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_redemptions
    ADD CONSTRAINT loyalty_redemptions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.loyalty_transactions(id);


--
-- Name: loyalty_rewards loyalty_rewards_minimum_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_rewards
    ADD CONSTRAINT loyalty_rewards_minimum_tier_id_fkey FOREIGN KEY (minimum_tier_id) REFERENCES public.loyalty_tiers(id);


--
-- Name: loyalty_tiers loyalty_tiers_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.loyalty_programs(id) ON DELETE CASCADE;


--
-- Name: loyalty_transactions loyalty_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.loyalty_accounts(id) ON DELETE CASCADE;


--
-- Name: loyalty_transactions loyalty_transactions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: loyalty_transactions loyalty_transactions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: loyalty_transactions loyalty_transactions_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: loyalty_transactions loyalty_transactions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.loyalty_members(id) ON DELETE CASCADE;


--
-- Name: loyalty_transactions loyalty_transactions_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: loyalty_transactions loyalty_transactions_related_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_related_transaction_id_fkey FOREIGN KEY (related_transaction_id) REFERENCES public.loyalty_transactions(id);


--
-- Name: maintenance_tickets maintenance_tickets_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: maintenance_tickets maintenance_tickets_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id);


--
-- Name: maintenance_tickets maintenance_tickets_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;


--
-- Name: night_audit_details night_audit_details_audit_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_details
    ADD CONSTRAINT night_audit_details_audit_run_id_fkey FOREIGN KEY (audit_run_id) REFERENCES public.night_audit_runs(id) ON DELETE CASCADE;


--
-- Name: night_audit_posted_nights night_audit_posted_nights_audit_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_posted_nights
    ADD CONSTRAINT night_audit_posted_nights_audit_run_id_fkey FOREIGN KEY (audit_run_id) REFERENCES public.night_audit_runs(id) ON DELETE SET NULL;


--
-- Name: night_audit_posted_nights night_audit_posted_nights_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_posted_nights
    ADD CONSTRAINT night_audit_posted_nights_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: night_audit_runs night_audit_runs_run_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.night_audit_runs
    ADD CONSTRAINT night_audit_runs_run_by_fkey FOREIGN KEY (run_by) REFERENCES public.users(id);


--
-- Name: notification_consent_events notification_consent_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_consent_events
    ADD CONSTRAINT notification_consent_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notification_consent_events notification_consent_events_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_consent_events
    ADD CONSTRAINT notification_consent_events_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: notification_subscriptions notification_subscriptions_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_subscriptions
    ADD CONSTRAINT notification_subscriptions_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: online_inventory_allocations online_inventory_allocations_room_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_inventory_allocations
    ADD CONSTRAINT online_inventory_allocations_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES public.room_types(id) ON DELETE CASCADE;


--
-- Name: online_inventory_allocations online_inventory_allocations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_inventory_allocations
    ADD CONSTRAINT online_inventory_allocations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: passkey_challenges passkey_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkey_challenges
    ADD CONSTRAINT passkey_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: passkeys passkeys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passkeys
    ADD CONSTRAINT passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payment_receipt_requests payment_receipt_requests_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_requests
    ADD CONSTRAINT payment_receipt_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- Name: payment_receipt_requests payment_receipt_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_requests
    ADD CONSTRAINT payment_receipt_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payments payments_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: points_transactions points_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: points_transactions points_transactions_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.points_transactions
    ADD CONSTRAINT points_transactions_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.loyalty_memberships(id) ON DELETE CASCADE;


--
-- Name: promotion_room_types promotion_room_types_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_room_types
    ADD CONSTRAINT promotion_room_types_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;


--
-- Name: promotion_room_types promotion_room_types_room_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_room_types
    ADD CONSTRAINT promotion_room_types_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES public.room_types(id) ON DELETE RESTRICT;


--
-- Name: promotions promotions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: promotions promotions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: rate_plans rate_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_plans
    ADD CONSTRAINT rate_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: refresh_tokens refresh_tokens_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reward_catalog reward_catalog_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_catalog
    ADD CONSTRAINT reward_catalog_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.loyalty_programs(id) ON DELETE CASCADE;


--
-- Name: reward_redemptions reward_redemptions_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.loyalty_memberships(id) ON DELETE CASCADE;


--
-- Name: reward_redemptions reward_redemptions_reward_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reward_redemptions
    ADD CONSTRAINT reward_redemptions_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES public.reward_catalog(id);


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: room_changes room_changes_from_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT room_changes_from_room_id_fkey FOREIGN KEY (from_room_id) REFERENCES public.rooms(id);


--
-- Name: room_changes room_changes_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT room_changes_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: room_changes room_changes_to_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_changes
    ADD CONSTRAINT room_changes_to_room_id_fkey FOREIGN KEY (to_room_id) REFERENCES public.rooms(id);


--
-- Name: room_events room_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_events
    ADD CONSTRAINT room_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: room_events room_events_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_events
    ADD CONSTRAINT room_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_history room_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_history
    ADD CONSTRAINT room_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: room_history room_history_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_history
    ADD CONSTRAINT room_history_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_rates room_rates_rate_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_rates
    ADD CONSTRAINT room_rates_rate_plan_id_fkey FOREIGN KEY (rate_plan_id) REFERENCES public.rate_plans(id) ON DELETE CASCADE;


--
-- Name: room_rates room_rates_room_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_rates
    ADD CONSTRAINT room_rates_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES public.room_types(id) ON DELETE CASCADE;


--
-- Name: room_status_change_log room_status_change_log_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_status_change_log
    ADD CONSTRAINT room_status_change_log_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: room_type_amenities room_type_amenities_amenity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_type_amenities
    ADD CONSTRAINT room_type_amenities_amenity_id_fkey FOREIGN KEY (amenity_id) REFERENCES public.amenities(id) ON DELETE CASCADE;


--
-- Name: room_type_amenities room_type_amenities_room_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_type_amenities
    ADD CONSTRAINT room_type_amenities_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES public.room_types(id) ON DELETE CASCADE;


--
-- Name: rooms rooms_connecting_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_connecting_room_id_fkey FOREIGN KEY (connecting_room_id) REFERENCES public.rooms(id);


--
-- Name: rooms rooms_inspected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_inspected_by_fkey FOREIGN KEY (inspected_by) REFERENCES public.users(id);


--
-- Name: rooms rooms_room_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_room_type_id_fkey FOREIGN KEY (room_type_id) REFERENCES public.room_types(id);


--
-- Name: self_checkin_events self_checkin_events_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_checkin_events
    ADD CONSTRAINT self_checkin_events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: self_checkin_events self_checkin_events_ekyc_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_checkin_events
    ADD CONSTRAINT self_checkin_events_ekyc_verification_id_fkey FOREIGN KEY (ekyc_verification_id) REFERENCES public.ekyc_verifications(id) ON DELETE SET NULL;


--
-- Name: self_checkin_events self_checkin_events_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_checkin_events
    ADD CONSTRAINT self_checkin_events_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: self_checkin_events self_checkin_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_checkin_events
    ADD CONSTRAINT self_checkin_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_action_idempotency_keys support_action_idempotency_keys_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_action_idempotency_keys
    ADD CONSTRAINT support_action_idempotency_keys_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_action_idempotency_keys support_action_idempotency_keys_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_action_idempotency_keys
    ADD CONSTRAINT support_action_idempotency_keys_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_conversations support_conversations_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_conversations support_conversations_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: support_conversations support_conversations_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: support_events support_events_actor_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_actor_guest_id_fkey FOREIGN KEY (actor_guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: support_events support_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_events support_events_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_events
    ADD CONSTRAINT support_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_guest_request_idempotency_keys support_guest_request_idempotency_keys_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_guest_request_idempotency_keys
    ADD CONSTRAINT support_guest_request_idempotency_keys_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: support_guest_request_idempotency_keys support_guest_request_idempotency_keys_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_guest_request_idempotency_keys
    ADD CONSTRAINT support_guest_request_idempotency_keys_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_author_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_author_guest_id_fkey FOREIGN KEY (author_guest_id) REFERENCES public.guests(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: user_guests user_guests_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_guests
    ADD CONSTRAINT user_guests_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE;


--
-- Name: user_guests user_guests_linked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_guests
    ADD CONSTRAINT user_guests_linked_by_fkey FOREIGN KEY (linked_by) REFERENCES public.users(id);


--
-- Name: user_guests user_guests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_guests
    ADD CONSTRAINT user_guests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_permissions user_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: users users_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: voucher_redemption_allocations voucher_redemption_allocations_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemption_allocations
    ADD CONSTRAINT voucher_redemption_allocations_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: voucher_redemption_allocations voucher_redemption_allocations_redemption_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemption_allocations
    ADD CONSTRAINT voucher_redemption_allocations_redemption_id_fkey FOREIGN KEY (redemption_id) REFERENCES public.voucher_redemptions(id) ON DELETE CASCADE;


--
-- Name: voucher_redemptions voucher_redemptions_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: voucher_redemptions voucher_redemptions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: voucher_redemptions voucher_redemptions_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: voucher_redemptions voucher_redemptions_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE RESTRICT;


--
-- Name: voucher_redemptions voucher_redemptions_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: voucher_redemptions voucher_redemptions_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.vouchers(id) ON DELETE RESTRICT;


--
-- Name: vouchers vouchers_guest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE RESTRICT;


--
-- Name: vouchers vouchers_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vouchers vouchers_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE RESTRICT;


--
-- Name: vouchers vouchers_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id) ON DELETE SET NULL;



-- The partition function is defined above. Pre-create this month plus the next 11.
DO $$
DECLARE
    base_month date := date_trunc('month', CURRENT_DATE)::date;
    offset_month integer;
BEGIN
    FOR offset_month IN 0..11 LOOP
        PERFORM public.ensure_audit_logs_partition(
            (base_month + make_interval(months => offset_month))::date
        );
    END LOOP;
END;
$$;

CREATE TABLE public.hotel_schema_revisions (
    generation integer NOT NULL CHECK (generation > 0),
    version integer NOT NULL CHECK (version > 0),
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    app_build text,
    PRIMARY KEY (generation, version)
);

COMMIT;
