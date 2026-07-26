-- Patch: PostgreSQL 19 native physical design (PostgreSQL)
-- Date: 2026-07-26
--
-- Purpose: bring an ALREADY-INITIALIZED V1 PostgreSQL database up to date with
-- the PG19-native rewrite of migrations/0001_v1_baseline.sql:
--   * every serial-style bigint id column (68) becomes GENERATED ALWAYS AS
--     IDENTITY, keeping its original sequence name, START value and position;
--   * the dead public.corporate_accounts_id_seq orphan is dropped;
--   * bookings.nights, bookings.total_guests, customer_ledgers.balance_due and
--     invoices.balance_due become virtual generated columns (drop + re-add;
--     they move to the end of the column list, matching fresh installs);
--   * the 7 customer_ledger* timestamp-without-time-zone columns become
--     timestamptz; existing values are interpreted in the hotel timezone from
--     system_settings (key 'timezone', 'UTC' fallback).
--
-- data.sql is a one-time, guarded install and must NOT be re-run against an
-- existing V1 DB (it RAISEs on re-run) — apply this patch instead. The patch
-- is idempotent: re-running it is a no-op.
--
-- DEPLOYMENT ORDER: apply this patch BEFORE starting a backend built from this
-- commit. The updated backend decodes the ledger columns as timestamptz; on an
-- unpatched database those reads fail (or fall back to epoch defaults).

\set ON_ERROR_STOP on

BEGIN;

-- The ALTERs below take ACCESS EXCLUSIVE locks; fail fast instead of waiting
-- forever behind a lingering connection (e.g. an orphaned backend process).
SET LOCAL lock_timeout = '30s';

-- Guard: V1 must be installed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.hotel_schema_revisions
        WHERE generation = 1 AND version = 1
    ) THEN
        RAISE EXCEPTION 'pg19-native-physical-design requires an initialized V1 database';
    END IF;
END;
$$;

-- 1) Serial-style bigint columns -> GENERATED ALWAYS AS IDENTITY.
--    The original sequence is renamed aside, an identity sequence is created
--    under the original name (preserving START), positioned from the old
--    sequence, and the renamed original is dropped.
--    (Recipe precedent: upgrade/pg18_4_to_v1.sql audit_logs conversion.)
DO $$
DECLARE
    rec record;
    v_last bigint;
    v_called boolean;
    v_start bigint;
    v_converted integer := 0;
BEGIN
    FOR rec IN
        SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col,
               sn.nspname AS seq_sch, sc.relname AS seq, sc.oid AS seq_oid
        FROM pg_attrdef d
        JOIN pg_class c ON c.oid = d.adrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        CROSS JOIN LATERAL (
            SELECT substring(pg_get_expr(d.adbin, d.adrelid)
                     FROM 'nextval\(''([^'']+)''::regclass\)') AS seqref
        ) x
        JOIN pg_class sc ON sc.oid = x.seqref::regclass
        JOIN pg_namespace sn ON sn.oid = sc.relnamespace
        WHERE x.seqref IS NOT NULL
          AND n.nspname IN ('public', 'app')
          AND a.attidentity = ''
          AND NOT a.attisdropped
          AND a.atttypid = 'bigint'::regtype
        ORDER BY n.nspname, c.relname, a.attname
    LOOP
        SELECT seqstart INTO v_start FROM pg_sequence WHERE seqrelid = rec.seq_oid;
        EXECUTE format('SELECT last_value, is_called FROM %I.%I', rec.seq_sch, rec.seq)
            INTO v_last, v_called;
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
                       rec.sch, rec.tbl, rec.col);
        EXECUTE format('ALTER SEQUENCE %I.%I RENAME TO %I',
                       rec.seq_sch, rec.seq, rec.seq || '_legacy');
        EXECUTE format(
            'ALTER TABLE %I.%I ALTER COLUMN %I ADD GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME %I.%I START WITH %s)',
            rec.sch, rec.tbl, rec.col, rec.seq_sch, rec.seq, v_start);
        PERFORM setval(format('%I.%I', rec.seq_sch, rec.seq)::regclass, v_last, v_called);
        EXECUTE format('DROP SEQUENCE %I.%I', rec.seq_sch, rec.seq || '_legacy');
        v_converted := v_converted + 1;
    END LOOP;
    RAISE NOTICE 'identity conversions applied: %', v_converted;
END;
$$;

-- 2) Dead orphan sequence (corporate_accounts has a uuid primary key; nothing
--    in the application, seeds or tests references this sequence).
DROP SEQUENCE IF EXISTS public.corporate_accounts_id_seq;

-- 3) STORED -> virtual generated columns. PostgreSQL cannot convert in place;
--    drop + re-add lands them at the end of the column list, which the
--    rewritten baseline matches by construction.
DROP VIEW IF EXISTS public.booking_summary;  -- depends on bookings.nights; recreated below

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.bookings'::regclass
                 AND attname = 'nights' AND attgenerated = 's') THEN
        ALTER TABLE public.bookings DROP COLUMN nights;
        ALTER TABLE public.bookings
            ADD COLUMN nights integer GENERATED ALWAYS AS ((check_out_date - check_in_date));
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.bookings'::regclass
                 AND attname = 'total_guests' AND attgenerated = 's') THEN
        ALTER TABLE public.bookings DROP COLUMN total_guests;
        ALTER TABLE public.bookings
            ADD COLUMN total_guests integer GENERATED ALWAYS AS (((adults + children) + infants));
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customer_ledgers'::regclass
                 AND attname = 'balance_due' AND attgenerated = 's') THEN
        ALTER TABLE public.customer_ledgers DROP COLUMN balance_due;
        ALTER TABLE public.customer_ledgers
            ADD COLUMN balance_due numeric(10,2) GENERATED ALWAYS AS ((amount - paid_amount));
        COMMENT ON COLUMN public.customer_ledgers.balance_due IS 'Auto-calculated as amount - paid_amount';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.invoices'::regclass
                 AND attname = 'balance_due' AND attgenerated = 's') THEN
        ALTER TABLE public.invoices DROP COLUMN balance_due;
        ALTER TABLE public.invoices
            ADD COLUMN balance_due numeric(12,2) GENERATED ALWAYS AS ((total_amount - paid_amount));
    END IF;
END;
$$;

-- 4) Ledger timestamps -> timestamptz, interpreting stored values in the hotel
--    timezone (the backend sets every connection's timezone from
--    system_settings, so naive values were written as hotel-local wall time).
DO $$
DECLARE
    v_tz text;
BEGIN
    SELECT value INTO v_tz FROM public.system_settings WHERE key = 'timezone';
    IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
        v_tz := 'UTC';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'customer_ledgers'
                 AND column_name = 'payment_date'
                 AND data_type = 'timestamp without time zone') THEN
        EXECUTE format(
            'ALTER TABLE public.customer_ledgers
                 ALTER COLUMN payment_date TYPE timestamp with time zone USING payment_date AT TIME ZONE %L,
                 ALTER COLUMN posted_at    TYPE timestamp with time zone USING posted_at    AT TIME ZONE %L,
                 ALTER COLUMN void_at      TYPE timestamp with time zone USING void_at      AT TIME ZONE %L,
                 ALTER COLUMN created_at   TYPE timestamp with time zone USING created_at   AT TIME ZONE %L,
                 ALTER COLUMN updated_at   TYPE timestamp with time zone USING updated_at   AT TIME ZONE %L',
            v_tz, v_tz, v_tz, v_tz, v_tz);
        ALTER TABLE public.customer_ledgers ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE public.customer_ledgers ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
        RAISE NOTICE 'customer_ledgers timestamps converted using time zone %', v_tz;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'customer_ledger_payments'
                 AND column_name = 'payment_date'
                 AND data_type = 'timestamp without time zone') THEN
        EXECUTE format(
            'ALTER TABLE public.customer_ledger_payments
                 ALTER COLUMN payment_date TYPE timestamp with time zone USING payment_date AT TIME ZONE %L,
                 ALTER COLUMN created_at   TYPE timestamp with time zone USING created_at   AT TIME ZONE %L',
            v_tz, v_tz);
        ALTER TABLE public.customer_ledger_payments ALTER COLUMN payment_date SET DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE public.customer_ledger_payments ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        RAISE NOTICE 'customer_ledger_payments timestamps converted using time zone %', v_tz;
    END IF;
END;
$$;

-- 5) Recreate booking_summary exactly as the rewritten baseline defines it.
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

-- 6) Native SQL/PGQ property graph over the core operational entities
--    (PostgreSQL 19). Purely additive query surface (GRAPH_TABLE); dropped and
--    recreated so the definition always matches the baseline.
DROP PROPERTY GRAPH IF EXISTS public.hotel_graph;

CREATE PROPERTY GRAPH public.hotel_graph
    VERTEX TABLES (
        public.companies KEY (id) LABEL company PROPERTIES (company_name, id),
        public.guests KEY (id) LABEL guest PROPERTIES (email, full_name, id),
        public.rooms KEY (id) LABEL room PROPERTIES (id, room_number),
        public.users KEY (id) LABEL staff PROPERTIES (id, username)
    )
    EDGE TABLES (
        public.bookings KEY (id) SOURCE KEY (guest_id) REFERENCES guests (id) DESTINATION KEY (room_id) REFERENCES rooms (id) LABEL stayed_in PROPERTIES (check_in_date, check_out_date, id, status),
        public.user_guests KEY (id) SOURCE KEY (user_id) REFERENCES users (id) DESTINATION KEY (guest_id) REFERENCES guests (id) LABEL manages PROPERTIES (id, relationship_type)
    );

-- 7) Validation: fail loudly if the database did not converge.
DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad
    FROM pg_attrdef d
    JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'app')
      AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%';
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'pg19 patch did not converge: % nextval defaults remain', v_bad;
    END IF;

    IF (SELECT attidentity FROM pg_attribute
        WHERE attrelid = 'public.bookings'::regclass AND attname = 'id') <> 'a' THEN
        RAISE EXCEPTION 'pg19 patch did not converge: bookings.id is not GENERATED ALWAYS identity';
    END IF;

    IF (SELECT attgenerated FROM pg_attribute
        WHERE attrelid = 'public.customer_ledgers'::regclass AND attname = 'balance_due') <> 'v' THEN
        RAISE EXCEPTION 'pg19 patch did not converge: customer_ledgers.balance_due is not virtual';
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customer_ledger_payments'
          AND column_name = 'payment_date') <> 'timestamp with time zone' THEN
        RAISE EXCEPTION 'pg19 patch did not converge: customer_ledger_payments.payment_date is not timestamptz';
    END IF;

    IF to_regclass('public.corporate_accounts_id_seq') IS NOT NULL THEN
        RAISE EXCEPTION 'pg19 patch did not converge: corporate_accounts_id_seq still exists';
    END IF;

    IF to_regclass('public.booking_summary') IS NULL THEN
        RAISE EXCEPTION 'pg19 patch did not converge: booking_summary view is missing';
    END IF;

    IF to_regclass('public.hotel_graph') IS NULL THEN
        RAISE EXCEPTION 'pg19 patch did not converge: hotel_graph property graph is missing';
    END IF;

    IF (SELECT last_value FROM public.users_id_seq) < 1000 THEN
        RAISE EXCEPTION 'pg19 patch did not converge: users_id_seq lost its position';
    END IF;
END;
$$;

COMMIT;
