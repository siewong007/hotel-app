-- Patch: remove the retired 'ekyc:verify' permission (PostgreSQL)
-- Date: 2026-07-27
--
-- Purpose: bring an already-initialized V1 database in line with
-- database/postgres/data.sql, which no longer seeds the 'ekyc:verify'
-- permission (removed from both the permissions INSERT and the
-- expected_system_permissions checklist).
--
-- Context: 'ekyc:verify' gated exactly one endpoint,
-- PATCH /ekyc/verifications/{id}. That endpoint was a legacy second path to
-- approve/reject an identity verification: it reached the same repository
-- entry point as the modern POST /ekyc/admin/applications/{id}/actions but
-- skipped validate_transition and validate_reason, and it wrote no audit_logs
-- row at all. The whole chain has been deleted (route, handler,
-- service::update_ekyc, EkycRepository::update_verification_legacy, the
-- EkycVerificationUpdate model, the frontend service method and its unused
-- useUpdateEkycVerification hook), so no code reads this permission anymore.
--
-- Deliberate divergence from data.sql's quarantine-AND-retain philosophy:
-- data.sql quarantines obsolete system permissions but never deletes them
-- ("intentionally retained so the one important database never loses
-- authorization history"). Retaining this one would leave an assignable
-- toggle in Access Control that reads "Legacy eKYC approve or reject
-- permission" while granting nothing -- misleading on a compliance-facing
-- screen. This patch therefore deletes it, but only AFTER copying the
-- permission row and every per-role and per-user grant into
-- app.invalid_data_quarantine. The authorization history is preserved in
-- queryable JSONB; only the live catalogue entry goes away.
--
-- permissions.id is the target of two ON DELETE CASCADE foreign keys --
-- role_permissions.permission_id (0001_v1_baseline.sql:9103) and
-- user_permissions.permission_id (0001_v1_baseline.sql:9423) -- so the DELETE
-- below removes the grant rows as a side effect. That is why they are
-- quarantined first, in the same transaction.
--
-- The 'verify' entry in the valid_action allowlists is intentionally left
-- alone: it is a CHECK-constraint vocabulary asserted in several places, and
-- narrowing it is separate, riskier work with no user-visible benefit.
--
-- Safe to run more than once (after the first run the permission no longer
-- exists, so every statement below matches zero rows):
--   psql "$DATABASE_URL" -f database/postgres/patches/2026-07-27-remove-ekyc-verify-permission.sql

\set ON_ERROR_STOP on

BEGIN;

-- 1. Preserve the permission row itself.
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.permissions',
    p.id::TEXT,
    'Retired system permission ekyc:verify -- legacy PATCH /ekyc/verifications/{id} removed 2026-07-27',
    to_jsonb(p)
FROM permissions p
WHERE p.name = 'ekyc:verify';

-- 2. Preserve per-role grants (dropped by the cascade in step 4).
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.role_permissions',
    rp.role_id::TEXT || ':' || rp.permission_id::TEXT,
    'Grant of retired permission ekyc:verify -- removed by cascade 2026-07-27',
    to_jsonb(rp)
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'ekyc:verify';

-- 3. Preserve per-user grants (dropped by the cascade in step 4).
INSERT INTO app.invalid_data_quarantine (
    source_table,
    source_key,
    invalid_reason,
    original_data
)
SELECT
    'public.user_permissions',
    up.user_id::TEXT || ':' || up.permission_id::TEXT,
    'Grant of retired permission ekyc:verify -- removed by cascade 2026-07-27',
    to_jsonb(up)
FROM user_permissions up
JOIN permissions p ON p.id = up.permission_id
WHERE p.name = 'ekyc:verify';

-- 4. Remove the catalogue entry. Cascades to role_permissions and
--    user_permissions, both quarantined above.
DELETE FROM permissions
WHERE name = 'ekyc:verify';

COMMIT;
