DO $booking_status_vocabulary$
DECLARE
    found_definition text;
    current_definition constant text :=
        'CHECK (((status)::text = ANY ((ARRAY[''pending''::character varying, ''pending_payment''::character varying, ''pending_confirmation''::character varying, ''confirmed''::character varying, ''checked_in''::character varying, ''auto_checked_in''::character varying, ''checked_out''::character varying, ''no_show''::character varying, ''completed''::character varying, ''comp_void''::character varying, ''partial_complimentary''::character varying, ''fully_complimentary''::character varying, ''voided''::character varying])::text[])))';
    old_definition constant text :=
        'CHECK (((status)::text = ANY ((ARRAY[''pending''::character varying, ''confirmed''::character varying, ''checked_in''::character varying, ''auto_checked_in''::character varying, ''checked_out''::character varying, ''no_show''::character varying, ''completed''::character varying, ''comp_void''::character varying, ''partial_complimentary''::character varying, ''fully_complimentary''::character varying, ''voided''::character varying])::text[])))';
BEGIN
    SELECT pg_get_constraintdef(constraint_row.oid)
    INTO found_definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace AS schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = 'public'
      AND table_row.relname = 'bookings'
      AND constraint_row.conname = 'bookings_status_check';

    IF found_definition IS NULL THEN
        RAISE EXCEPTION 'bookings_status_check has incompatible definition: <missing>';
    ELSIF found_definition = old_definition THEN
        EXECUTE 'ALTER TABLE public.bookings DROP CONSTRAINT bookings_status_check';
        EXECUTE $current_constraint$
            ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_status_check CHECK (
                status::text = ANY (
                    ARRAY[
                        'pending'::character varying,
                        'pending_payment'::character varying,
                        'pending_confirmation'::character varying,
                        'confirmed'::character varying,
                        'checked_in'::character varying,
                        'auto_checked_in'::character varying,
                        'checked_out'::character varying,
                        'no_show'::character varying,
                        'completed'::character varying,
                        'comp_void'::character varying,
                        'partial_complimentary'::character varying,
                        'fully_complimentary'::character varying,
                        'voided'::character varying
                    ]::text[]
                )
            )
        $current_constraint$;
    ELSIF found_definition <> current_definition THEN
        RAISE EXCEPTION 'bookings_status_check has incompatible definition: %', found_definition;
    END IF;
END;
$booking_status_vocabulary$;
