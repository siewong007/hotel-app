-- Reception may void payments again — with a reason, an audit row and a
-- closed-day reversing entry (patch 0019) — and approve guest bank-transfer
-- claims.
--
-- Patch 0019 took `payments:delete` away from the receptionist role. The
-- owner reversed that decision: front desk staff void payments themselves
-- (posted booking payments, deposit cancel and restore), but they still do
-- NOT get `payments:manage`, which would also unlock approving bank
-- transfers, reverting refunds and un-forfeiting deposits. Since 0020 the
-- backend gates every void on `payments:delete` alone, so the permission is
-- relabelled "Void payments" — a row is never hard-deleted.
--
-- The owner also gave reception `payments:approve`: approve / reject a
-- guest's bank-transfer claim and request a receipt. The approver is stamped
-- on the payment (processed_by/processed_at) and in the payment_approved
-- audit row, and shown on the folio. Fresh installs get the same grants and
-- label from seed.sql. Idempotent.

UPDATE public.permissions
SET description = 'Void payments (reason required; the record is kept and audited)'
WHERE name = 'payments:delete'
  AND description IS DISTINCT FROM 'Void payments (reason required; the record is kept and audited)';

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name = 'receptionist'
  AND p.name IN ('payments:delete', 'payments:approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;
