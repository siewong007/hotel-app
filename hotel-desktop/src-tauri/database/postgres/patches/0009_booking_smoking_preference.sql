-- Adds bookings.smoking_preference: the guest's optional smoking /
-- non-smoking room preference captured by the guest portal booking form.
-- NULL means "no preference". The preference is soft — it steers room
-- allocation toward matching rooms (rooms.is_smoking) but never blocks a
-- booking when no matching room is free.
--
-- Fresh installs already carry the column and its CHECK from the V1 baseline;
-- this patch adds them on installed databases and refuses to converge onto a
-- same-named column or constraint with a different shape.
DO $booking_smoking_preference$
DECLARE
    column_type text;
    check_def text;
    -- Exact pg_get_constraintdef output for both the baseline definition and
    -- the ADD CONSTRAINT below (they deparse identically).
    expected_check constant text :=
        $expected$CHECK (((smoking_preference)::text = ANY (ARRAY[('smoking'::character varying)::text, ('non_smoking'::character varying)::text])))$expected$;
BEGIN
    SELECT format_type(atttypid, atttypmod) INTO column_type
    FROM pg_attribute
    WHERE attrelid = 'public.bookings'::regclass
      AND attname = 'smoking_preference'
      AND attnum > 0 AND NOT attisdropped;

    IF column_type IS NULL THEN
        ALTER TABLE public.bookings ADD COLUMN smoking_preference character varying(20);
    ELSIF column_type <> 'character varying(20)' THEN
        RAISE EXCEPTION 'bookings.smoking_preference exists with unexpected type: %', column_type;
    END IF;

    SELECT pg_get_constraintdef(oid) INTO check_def
    FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND conname = 'bookings_smoking_preference_check'
      AND contype = 'c';

    IF check_def IS NULL THEN
        ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_smoking_preference_check CHECK (
                (smoking_preference)::text = ANY (
                    (ARRAY['smoking'::character varying, 'non_smoking'::character varying])::text[]
                )
            );
    ELSIF check_def <> expected_check THEN
        RAISE EXCEPTION 'bookings_smoking_preference_check has unexpected definition: %', check_def;
    END IF;
END
$booking_smoking_preference$;

COMMENT ON COLUMN public.bookings.smoking_preference IS
    'Guest room smoking preference (smoking / non_smoking); NULL = no preference. Soft: steers allocation, never blocks.';
