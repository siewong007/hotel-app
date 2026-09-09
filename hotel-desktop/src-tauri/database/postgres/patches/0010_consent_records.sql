-- Consent records: provable evidence of PDPA consent.
--
-- Malaysia's Personal Data Protection Act 2010 puts the burden on the data
-- controller to show that consent was given (s.6(2)), and the 2024 amendments
-- add duties around withdrawal and portability that are unanswerable without a
-- per-version history. A boolean on the guest row cannot do that: it cannot say
-- WHICH text was agreed to, WHEN, from where, or that consent was later
-- withdrawn. This table is therefore append-only -- a withdrawal is a new row
-- with granted = false, never an UPDATE of the original.
--
-- The DDL below is byte-identical to the block added to the V1 baseline for
-- fresh installs, so `pg_dump --schema-only` of (baseline) and
-- (older baseline + this patch) must diff to nothing.
--
-- Every step is individually guarded, so re-running the patch on a database
-- that already has part of the table is a no-op rather than an error.
DO $consent_records$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    ) THEN
        RAISE EXCEPTION 'consent_records preflight failed: users is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'guests'
    ) THEN
        RAISE EXCEPTION 'consent_records preflight failed: guests is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'bookings'
    ) THEN
        RAISE EXCEPTION 'consent_records preflight failed: bookings is missing';
    END IF;

    IF to_regclass('public.consent_records') IS NULL THEN
        EXECUTE $ddl$CREATE TABLE public.consent_records (
    id bigint NOT NULL,
    subject_type character varying(20) NOT NULL,
    user_id bigint,
    guest_id bigint,
    booking_id bigint,
    document_type character varying(40) NOT NULL,
    document_version character varying(40) NOT NULL,
    locale character varying(10) DEFAULT 'en'::character varying NOT NULL,
    granted boolean NOT NULL,
    source character varying(40) NOT NULL,
    ip_address inet,
    user_agent text,
    withdrawn_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT consent_records_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['terms_of_service'::character varying, 'privacy_notice'::character varying, 'payment_terms'::character varying, 'ekyc_biometric'::character varying])::text[]))),
    CONSTRAINT consent_records_locale_check CHECK (((locale)::text = ANY ((ARRAY['en'::character varying, 'ms'::character varying])::text[]))),
    CONSTRAINT consent_records_source_check CHECK (((source)::text = ANY ((ARRAY['registration'::character varying, 'online_booking'::character varying, 'payment'::character varying, 'ekyc'::character varying, 'guest_portal'::character varying, 'front_desk'::character varying])::text[]))),
    CONSTRAINT consent_records_subject_present_check CHECK (((user_id IS NOT NULL) OR (guest_id IS NOT NULL) OR (booking_id IS NOT NULL))),
    CONSTRAINT consent_records_subject_type_check CHECK (((subject_type)::text = ANY ((ARRAY['user'::character varying, 'guest'::character varying, 'anonymous'::character varying])::text[])))
)$ddl$;

        EXECUTE $ddl$COMMENT ON TABLE public.consent_records IS 'Append-only evidence of consent given or withdrawn under the Personal Data Protection Act 2010. One row per document per act of consent; a withdrawal is a new row with granted = false rather than an update, so the history stays provable.'$ddl$;

        EXECUTE $ddl$COMMENT ON COLUMN public.consent_records.document_version IS 'Version string of the document the subject actually saw, so a later reissue of the text cannot be mistaken for what was agreed to.'$ddl$;

        EXECUTE $ddl$COMMENT ON COLUMN public.consent_records.granted IS 'true when consent was given, false when it was refused or later withdrawn.'$ddl$;
    END IF;

    -- Identity is added separately: a table restored by other means may exist
    -- without it, and ADD GENERATED on a column that already has it errors.
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.consent_records'::regclass
          AND attname = 'id'
          AND attidentity <> ''
    ) THEN
        EXECUTE $ddl$ALTER TABLE public.consent_records ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consent_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_pkey'
          AND conrelid = 'public.consent_records'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id)$ddl$;
    END IF;

        IF to_regclass('public.idx_consent_records_booking') IS NULL THEN
            EXECUTE $ddl$CREATE INDEX idx_consent_records_booking ON public.consent_records USING btree (booking_id) WHERE (booking_id IS NOT NULL)$ddl$;
        END IF;

        IF to_regclass('public.idx_consent_records_document') IS NULL THEN
            EXECUTE $ddl$CREATE INDEX idx_consent_records_document ON public.consent_records USING btree (document_type, document_version)$ddl$;
        END IF;

        IF to_regclass('public.idx_consent_records_guest') IS NULL THEN
            EXECUTE $ddl$CREATE INDEX idx_consent_records_guest ON public.consent_records USING btree (guest_id) WHERE (guest_id IS NOT NULL)$ddl$;
        END IF;

        IF to_regclass('public.idx_consent_records_user') IS NULL THEN
            EXECUTE $ddl$CREATE INDEX idx_consent_records_user ON public.consent_records USING btree (user_id) WHERE (user_id IS NOT NULL)$ddl$;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_booking_id_fkey'
              AND conrelid = 'public.consent_records'::regclass
        ) THEN
            EXECUTE $ddl$ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE$ddl$;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_guest_id_fkey'
              AND conrelid = 'public.consent_records'::regclass
        ) THEN
            EXECUTE $ddl$ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES public.guests(id) ON DELETE CASCADE$ddl$;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_user_id_fkey'
              AND conrelid = 'public.consent_records'::regclass
        ) THEN
            EXECUTE $ddl$ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE$ddl$;
        END IF;
END;
$consent_records$;
