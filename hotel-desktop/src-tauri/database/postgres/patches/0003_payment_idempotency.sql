DO $payment_idempotency_preflight$
DECLARE
    found_column record;
    found_relation regclass;
    found_index text;
    old_receipt_index constant text :=
        'CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''''::text))';
    current_receipt_index constant text :=
        'CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (ledger_id, lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''''::text))';
    current_ledger_idempotency_index constant text :=
        'CREATE UNIQUE INDEX uq_ledger_payments_ledger_idempotency ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (TRIM(BOTH FROM idempotency_key) <> ''''::text))';
    current_booking_idempotency_index constant text :=
        'CREATE UNIQUE INDEX uq_payments_booking_idempotency ON public.payments USING btree (booking_id, idempotency_key) WHERE ((idempotency_key IS NOT NULL) AND (TRIM(BOTH FROM idempotency_key) <> ''''::text))';
BEGIN
    FOR found_column IN
        SELECT expected.table_name,
               expected.column_name,
               expected.maximum_length,
               actual.data_type,
               actual.character_maximum_length,
               actual.is_nullable
        FROM (VALUES
            ('payments', 'idempotency_key', 160),
            ('payments', 'idempotency_fingerprint', 64),
            ('customer_ledger_payments', 'idempotency_key', 160),
            ('customer_ledger_payments', 'idempotency_fingerprint', 64)
        ) AS expected(table_name, column_name, maximum_length)
        JOIN information_schema.columns AS actual
          ON actual.table_schema = 'public'
         AND actual.table_name = expected.table_name
         AND actual.column_name = expected.column_name
    LOOP
        IF found_column.data_type <> 'character varying'
           OR found_column.character_maximum_length IS DISTINCT FROM found_column.maximum_length
           OR found_column.is_nullable <> 'YES' THEN
            RAISE EXCEPTION '%.% has incompatible shape: type %, length %, nullable %',
                found_column.table_name,
                found_column.column_name,
                found_column.data_type,
                found_column.character_maximum_length,
                found_column.is_nullable;
        END IF;
    END LOOP;

    found_relation := to_regclass('public.idx_customer_ledger_payments_receipt_unique');
    found_index := pg_get_indexdef(found_relation);
    IF found_relation IS NOT NULL AND
       (found_index IS NULL OR
        (found_index <> old_receipt_index AND found_index <> current_receipt_index)) THEN
        RAISE EXCEPTION 'idx_customer_ledger_payments_receipt_unique has incompatible definition: %',
            COALESCE(found_index, '<not an index>');
    END IF;

    found_relation := to_regclass('public.uq_ledger_payments_ledger_idempotency');
    found_index := pg_get_indexdef(found_relation);
    IF found_relation IS NOT NULL AND
       (found_index IS NULL OR found_index <> current_ledger_idempotency_index) THEN
        RAISE EXCEPTION 'uq_ledger_payments_ledger_idempotency has incompatible definition: %',
            COALESCE(found_index, '<not an index>');
    END IF;

    found_relation := to_regclass('public.uq_payments_booking_idempotency');
    found_index := pg_get_indexdef(found_relation);
    IF found_relation IS NOT NULL AND
       (found_index IS NULL OR found_index <> current_booking_idempotency_index) THEN
        RAISE EXCEPTION 'uq_payments_booking_idempotency has incompatible definition: %',
            COALESCE(found_index, '<not an index>');
    END IF;
END;
$payment_idempotency_preflight$;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS idempotency_key character varying(160),
    ADD COLUMN IF NOT EXISTS idempotency_fingerprint character varying(64);

ALTER TABLE public.customer_ledger_payments
    ADD COLUMN IF NOT EXISTS idempotency_key character varying(160),
    ADD COLUMN IF NOT EXISTS idempotency_fingerprint character varying(64);

DO $receipt_index_upgrade$
DECLARE
    found_index text := pg_get_indexdef(to_regclass('public.idx_customer_ledger_payments_receipt_unique'));
    old_index constant text :=
        'CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique ON public.customer_ledger_payments USING btree (lower(TRIM(BOTH FROM receipt_number))) WHERE ((receipt_number IS NOT NULL) AND (TRIM(BOTH FROM receipt_number) <> ''''::text))';
BEGIN
    IF found_index = old_index THEN
        EXECUTE 'DROP INDEX public.idx_customer_ledger_payments_receipt_unique';
    END IF;
END;
$receipt_index_upgrade$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_ledger_payments_receipt_unique
    ON public.customer_ledger_payments USING btree
    (ledger_id, lower(TRIM(BOTH FROM receipt_number)))
    WHERE receipt_number IS NOT NULL AND TRIM(BOTH FROM receipt_number) <> ''::text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_payments_ledger_idempotency
    ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> ''::text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_booking_idempotency
    ON public.payments USING btree (booking_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> ''::text;
