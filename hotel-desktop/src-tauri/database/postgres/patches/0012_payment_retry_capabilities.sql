-- Payment retry capabilities: a recovery path for a rejected payment.
--
-- When an anonymous booker's payment is rejected there is no account to log
-- back into, so the only way to recover the reservation is a link in the
-- outcome email. Reusing the booking-access token for that would widen one
-- narrow need into full portal access, so this is a separate, single-purpose
-- capability: it names one booking and one rejected payment, expires, and is
-- spent at most once.
--
-- Only the hash of the token is stored. A database copy therefore cannot yield
-- a working link, matching how booking-access tokens are persisted.
--
-- consumed_at is set when a replacement payment is created, never when the page
-- is merely viewed -- an email scanner that follows the link must not be able to
-- exhaust the guest's one attempt. replacement_payment_id makes a duplicate
-- submission resolve to the payment that already exists rather than create a
-- second one, and keeps an authorized PayPal order capturable afterwards.
--
-- The DDL below is byte-identical to the block added to the V1 baseline for
-- fresh installs, so `pg_dump --schema-only` of (baseline) and
-- (older baseline + this patch) must diff to nothing.
--
-- Every step is individually guarded, so re-running the patch on a database
-- that already has part of the table is a no-op rather than an error.
DO $payment_retry_capabilities$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'bookings'
    ) THEN
        RAISE EXCEPTION 'payment_retry_capabilities preflight failed: bookings is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'payments'
    ) THEN
        RAISE EXCEPTION 'payment_retry_capabilities preflight failed: payments is missing';
    END IF;

    IF to_regclass('public.payment_retry_capabilities') IS NULL THEN
        EXECUTE $ddl$CREATE TABLE public.payment_retry_capabilities (
    id bigint NOT NULL,
    booking_id bigint NOT NULL,
    payment_id bigint,
    token_hash character varying(80) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    replacement_payment_id bigint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)$ddl$;

        EXECUTE $ddl$COMMENT ON TABLE public.payment_retry_capabilities IS 'Short-lived capability letting a guest replace one rejected payment from an emailed link, with no guest-portal session. Only the token hash is stored, so a database copy cannot yield a working link, and the booking-access token stays separate.'$ddl$;

        EXECUTE $ddl$COMMENT ON COLUMN public.payment_retry_capabilities.token_hash IS 'SHA-256 of the emailed token, hex-encoded behind a sha256: prefix, matching the booking-access token scheme. The raw token exists only in the delivered mail.'$ddl$;

        EXECUTE $ddl$COMMENT ON COLUMN public.payment_retry_capabilities.consumed_at IS 'Set when the capability is spent creating a replacement payment. Viewing the recovery page deliberately leaves it NULL, so an email scanner following the link cannot exhaust the guest''s one attempt.'$ddl$;

        EXECUTE $ddl$COMMENT ON COLUMN public.payment_retry_capabilities.replacement_payment_id IS 'Payment created when this capability was consumed. A duplicate submission resolves to this row instead of creating a second payment, and it keeps an already-authorized PayPal order capturable after consumption.'$ddl$;
    END IF;

    -- Identity is added separately: a table restored by other means may exist
    -- without it, and ADD GENERATED on a column that already has it errors.
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.payment_retry_capabilities'::regclass
          AND attname = 'id'
          AND attidentity <> ''
    ) THEN
        EXECUTE $ddl$ALTER TABLE public.payment_retry_capabilities ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payment_retry_capabilities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
)$ddl$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_retry_capabilities_pkey'
          AND conrelid = 'public.payment_retry_capabilities'::regclass
    ) THEN
        EXECUTE $ddl$ALTER TABLE ONLY public.payment_retry_capabilities
    ADD CONSTRAINT payment_retry_capabilities_pkey PRIMARY KEY (id)$ddl$;
    END IF;

        IF to_regclass('public.idx_payment_retry_capabilities_booking') IS NULL THEN
            EXECUTE $ddl$CREATE INDEX idx_payment_retry_capabilities_booking ON public.payment_retry_capabilities USING btree (booking_id)$ddl$;
        END IF;

        IF to_regclass('public.idx_payment_retry_capabilities_token') IS NULL THEN
            EXECUTE $ddl$CREATE UNIQUE INDEX idx_payment_retry_capabilities_token ON public.payment_retry_capabilities USING btree (token_hash)$ddl$;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'payment_retry_capabilities_booking_id_fkey'
              AND conrelid = 'public.payment_retry_capabilities'::regclass
        ) THEN
            EXECUTE $ddl$ALTER TABLE ONLY public.payment_retry_capabilities
    ADD CONSTRAINT payment_retry_capabilities_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE$ddl$;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'payment_retry_capabilities_payment_id_fkey'
              AND conrelid = 'public.payment_retry_capabilities'::regclass
        ) THEN
            EXECUTE $ddl$ALTER TABLE ONLY public.payment_retry_capabilities
    ADD CONSTRAINT payment_retry_capabilities_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL$ddl$;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'payment_retry_capabilities_replacement_payment_id_fkey'
              AND conrelid = 'public.payment_retry_capabilities'::regclass
        ) THEN
            EXECUTE $ddl$ALTER TABLE ONLY public.payment_retry_capabilities
    ADD CONSTRAINT payment_retry_capabilities_replacement_payment_id_fkey FOREIGN KEY (replacement_payment_id) REFERENCES public.payments(id) ON DELETE SET NULL$ddl$;
        END IF;
END;
$payment_retry_capabilities$;
