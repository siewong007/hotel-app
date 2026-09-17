-- Adds the shared rate-limit bucket store used by the distributed
-- (multi-replica) rate limiter. Fresh installs already carry the table from
-- the V1 baseline; this patch creates it on installed databases and refuses
-- to converge onto a same-named table with a different shape.
DO $rate_limit_buckets$
DECLARE
    pk_def text;
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
    END IF;
END
$rate_limit_buckets$;
