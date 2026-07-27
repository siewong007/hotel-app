--
-- Adds Google guest sign-in support to an EXISTING V1 PostgreSQL database.
--
-- Fresh installs do not need this file: the column and index are part of
-- database/postgres/migrations/0001_v1_baseline.sql. Apply this patch only to a
-- database that was initialized from a baseline predating 2026-07-28.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f database/postgres/patches/2026-07-28-users-google-subject.sql
--
-- Idempotent: re-applying it is a no-op. It is additive only — no existing
-- column, index, or row is modified, so it is safe to run against a live
-- database without downtime.
--

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_subject character varying(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_subject
    ON public.users USING btree (google_subject)
    WHERE (google_subject IS NOT NULL);
