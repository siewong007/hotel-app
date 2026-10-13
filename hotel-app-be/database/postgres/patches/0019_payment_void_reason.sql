-- Payment voids carry a reason, an actor and a time, and a void after the
-- night audit closed the payment's own day posts a reversing journal line.
--
-- `DELETE /payments/{id}` (and `POST /payments/{id}/void`) never removed a
-- row — it set status 'void' — but kept no reason, and voiding a payment from
-- a day the night audit had already closed silently rewrote that day's
-- journal. These columns record who voided the row, when and why, and
-- `void_reversal_date` names the business date the reversing line posts on
-- (NULL when the void happened while the payment's own day was still open).
-- The night-audit journal keeps the original line on its closed day and
-- posts the reversal on `void_reversal_date`.
--
-- Front-desk roles also stop voiding payments: `payments:delete` leaves the
-- receptionist role, so voids and deposit cancellations go to roles holding
-- `payments:manage` (manager, admin). Fresh installs get the same grant set
-- from seed.sql. Idempotent.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS voided_at timestamp with time zone;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS voided_by bigint;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS void_reversal_date date;

DO $payment_void_fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'payments_voided_by_fkey'
          AND conrelid = 'public.payments'::regclass
    ) THEN
        ALTER TABLE ONLY public.payments
            ADD CONSTRAINT payments_voided_by_fkey FOREIGN KEY (voided_by)
            REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END;
$payment_void_fk$;

CREATE INDEX IF NOT EXISTS idx_payments_void_reversal_date
    ON public.payments USING btree (void_reversal_date)
    WHERE (void_reversal_date IS NOT NULL);

COMMENT ON COLUMN public.payments.void_reversal_date IS 'Business date a reversing journal line posts on when a payment is voided after night audit closed its own day; NULL when the void simply removed it from an open day';

DELETE FROM public.role_permissions rp
USING public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name = 'receptionist'
  AND p.name = 'payments:delete';
