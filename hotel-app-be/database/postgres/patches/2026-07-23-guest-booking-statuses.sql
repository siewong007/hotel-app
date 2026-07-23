-- Patch: guest portal booking statuses (PostgreSQL)
-- Date: 2026-07-23
--
-- Purpose: bring an already-initialized V1 database's booking status
-- constraint in line with the guest booking workflow. The portal creates a
-- booking in `pending_payment` and can then move it to
-- `pending_confirmation`; older databases permit neither value and return a
-- 500 error when the insert is attempted.
--
-- Safe to run more than once:
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-23-guest-booking-statuses.sql

BEGIN;

ALTER TABLE public.bookings
    DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN (
        'pending',
        'pending_payment',
        'pending_confirmation',
        'confirmed',
        'checked_in',
        'auto_checked_in',
        'checked_out',
        'no_show',
        'completed',
        'comp_void',
        'partial_complimentary',
        'fully_complimentary',
        'voided'
    ));

COMMIT;
