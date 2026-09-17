-- Adds the shared rate-limit bucket store used by the distributed
-- (multi-replica) rate limiter. Fresh installs already carry the table from
-- the V1 baseline; this patch creates it on installed databases and refuses
-- to converge onto a same-named table with a different shape.
DO $rate_limit_buckets$
DECLARE
    pk_def text;
    column_defs text;
BEGIN
    IF to_regclass('public.rate_limit_buckets') IS NULL THEN
        CREATE TABLE public.rate_limit_buckets (
            bucket text NOT NULL,
            window_start timestamp with time zone NOT NULL,
            count integer NOT NULL,
            CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket, window_start)
        );
    ELSE
        SELECT pg_get_constraintdef(oid) INTO pk_def
        FROM pg_constraint
        WHERE conrelid = 'public.rate_limit_buckets'::regclass
          AND conname = 'rate_limit_buckets_pkey'
          AND contype = 'p';
        IF pk_def IS DISTINCT FROM 'PRIMARY KEY (bucket, window_start)' THEN
            RAISE EXCEPTION 'rate_limit_buckets exists with unexpected primary key: %',
                coalesce(pk_def, '<none>');
        END IF;
        -- The limiter decodes `count` as int and `window_start` as timestamptz;
        -- a same-named table with drifted column types would pass the PK
        -- check then fail every rate-limit query at runtime (fail-open would
        -- silently disable limiting).
        SELECT string_agg(attname || ':' || atttypid::regtype::text, ','
                          ORDER BY attnum)
        INTO column_defs
        FROM pg_attribute
        WHERE attrelid = 'public.rate_limit_buckets'::regclass
          AND attnum > 0 AND NOT attisdropped;
        IF column_defs IS DISTINCT FROM
           'bucket:text,window_start:timestamp with time zone,count:integer' THEN
            RAISE EXCEPTION 'rate_limit_buckets exists with unexpected columns: %',
                coalesce(column_defs, '<none>');
        END IF;
    END IF;
END
$rate_limit_buckets$;
