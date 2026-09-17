-- Adds the shared rate-limit bucket store used by the distributed
-- (multi-replica) rate limiter. Fresh installs already carry the table from
-- the V1 baseline; this patch creates it on installed databases and refuses
-- to converge onto a same-named table with a different shape.
DO $rate_limit_buckets$
BEGIN
    IF to_regclass('public.rate_limit_buckets') IS NULL THEN
        CREATE TABLE public.rate_limit_buckets (
            bucket text NOT NULL,
            window_start timestamp with time zone NOT NULL,
            count integer NOT NULL,
            CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket, window_start)
        );
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'rate_limit_buckets'
          AND constraint_name = 'rate_limit_buckets_pkey'
          AND constraint_type = 'PRIMARY KEY'
    ) THEN
        RAISE EXCEPTION 'rate_limit_buckets exists without expected primary key';
    END IF;
END
$rate_limit_buckets$;
