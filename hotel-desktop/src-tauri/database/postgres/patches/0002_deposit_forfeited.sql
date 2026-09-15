-- Adds 'deposit_forfeited' to the payments.payment_type vocabulary and keeps it
-- out of the bill-settling money that sync_booking_payment_status() sums.
--
-- A deposit_forfeited row is a completed payment the hotel kept when a held
-- deposit was forfeited (no-show, policy violation): it is neither collateral
-- still owed back to the guest nor money applied to the booking's bill. The
-- widened CHECK admits the new type; the trigger exclusion keeps those rows
-- from marking the booking's charges 'paid' or 'partial', matching
-- PaymentRepository::recompute_booking_payment_status.
--
-- Fresh installs already carry both current definitions from the V1 baseline;
-- this patch converges installed databases onto exactly those definitions.
--
-- Both replacements are driven from the recorded current definition text rather
-- than from hand-written DDL, so a patched database reproduces the baseline
-- rendering byte for byte instead of drifting on spelling. The constants are
-- exact pg_get_constraintdef / pg_get_functiondef output, including the trailing
-- newline pg_get_functiondef emits, because the guards compare them literally.

DO $payment_type$
DECLARE
    found_definition text;
    current_definition constant text := $payment_type_current$CHECK (((payment_type)::text = ANY (ARRAY[('booking'::character varying)::text, ('deposit'::character varying)::text, ('service'::character varying)::text, ('damage'::character varying)::text, ('refund'::character varying)::text, ('deposit_forfeited'::character varying)::text])))$payment_type_current$;
    old_definition constant text := $payment_type_old$CHECK (((payment_type)::text = ANY (ARRAY[('booking'::character varying)::text, ('deposit'::character varying)::text, ('service'::character varying)::text, ('damage'::character varying)::text, ('refund'::character varying)::text])))$payment_type_old$;
BEGIN
    SELECT pg_get_constraintdef(constraint_row.oid)
    INTO found_definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'payments'
      AND constraint_row.conname = 'payments_payment_type_check';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'payments_payment_type_check has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE 'ALTER TABLE public.payments DROP CONSTRAINT payments_payment_type_check';
        EXECUTE 'ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check '
            || current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'payments_payment_type_check has incompatible definition: %', found_definition;
    END IF;
END;
$payment_type$;

DO $payment_sync$
DECLARE
    found_definition text;
    current_definition constant text := $fn_current$CREATE OR REPLACE FUNCTION public.sync_booking_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_booking_id INTEGER;
    v_settled NUMERIC;
    v_new_status TEXT;
BEGIN
    -- Determine the affected booking_id (NEW for INSERT/UPDATE, OLD for DELETE)
    v_booking_id := COALESCE(NEW.booking_id, OLD.booking_id);

    -- Money that settles the booking's charges: completed payments excluding
    -- refunds and deposits. A held deposit is collateral, not a room payment;
    -- a forfeited deposit is money the hotel kept, not a bill settlement.
    -- Mirrors PaymentRepository::recompute_booking_payment_status.
    SELECT COALESCE(SUM(amount), 0)
      INTO v_settled
      FROM payments
     WHERE booking_id = v_booking_id
       AND status = 'completed'
       AND COALESCE(payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited');

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
$function$
$fn_current$;
    old_definition constant text := $fn_old$CREATE OR REPLACE FUNCTION public.sync_booking_payment_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
$fn_old$;
BEGIN
    SELECT pg_get_functiondef(routine_row.oid)
    INTO found_definition
    FROM pg_proc AS routine_row
    JOIN pg_namespace AS schema_row ON schema_row.oid = routine_row.pronamespace
    WHERE schema_row.nspname = 'public'
      AND routine_row.proname = 'sync_booking_payment_status'
      AND routine_row.pronargs = 0;

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'sync_booking_payment_status() has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE current_definition;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'sync_booking_payment_status() has incompatible definition: %', found_definition;
    END IF;
END;
$payment_sync$;
