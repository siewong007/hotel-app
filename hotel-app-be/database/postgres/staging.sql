-- ============================================================================
-- HOTEL APP — STAGING / DEMO DATASET (staging.sql)
-- ============================================================================
-- Purpose:
--   Populate an initialized V1 database with a comprehensive, deterministic
--   staging dataset covering every application module. Apply AFTER the
--   baseline lifecycle completes:
--
--       make db-baseline DATABASE_URL=...   # schema + system seed + patches
--       make db-seed     DATABASE_URL=...   # this file
--
-- Properties:
--   * Deterministic: every staging row lives in the fixed id band
--     800000–899999 (uuid-keyed rows use 80000000-… literals). The 999xxx band
--     is reserved for ad-hoc dev fixtures. No random(), no clock-dependent ids.
--   * Re-runnable: the transaction first deletes every band-scoped row in
--     foreign-key order, then reinserts, so a rerun yields identical counts.
--     audit_logs is append-only by trigger; its staging rows are id-guarded
--     (inserted only when the id is absent) and never reference staging users.
--   * Reference date: all stay/schedule dates derive from CURRENT_DATE so the
--     dataset never goes stale. Pin a date with:
--         PGOPTIONS='-c staging.ref_date=2026-01-15' psql "$DATABASE_URL" -f staging.sql
--   * Auth: every staging user shares the documented staging-only password
--     `HotelStaging2026!` (bcrypt hash below). Never reuse it outside staging.
--   * Never run against production: it inserts obviously-fake data under
--     @staging.hotel-app.test identities.
-- ============================================================================

\set ON_ERROR_STOP on
\echo '[staging] Applying staging dataset (id band 800000-899999)...'

BEGIN;

-- Serialize with any concurrent seed/patch runner.
SELECT pg_advisory_xact_lock(hashtext('hotel_app_staging_seed'));

-- Rerun cleanup deletes staging users, which fires the users->audit_logs
-- ON DELETE SET NULL enforcement update on an append-only table; the
-- statement-level guard raises even for 0-row updates. The documented fixture
-- escape hatch (used by the integration suite for the same reason) is required.
SET LOCAL app.allow_audit_mutation = 'on';

-- Guard: this dataset requires a completed V1 installation (schema + system
-- bootstrap + patch catalog all come from `make db-baseline`).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.hotel_schema_revisions
        WHERE generation = 1 AND version = 1
    ) THEN
        RAISE EXCEPTION 'staging.sql requires an initialized V1 database — run `make db-baseline` first';
    END IF;
END;
$$;

-- Reference date shared by every section. CURRENT_DATE is the hotel business
-- day because each connection inherits system_settings.timezone.
CREATE TEMP TABLE staging_ref ON COMMIT DROP AS
SELECT COALESCE(current_setting('staging.ref_date', true)::date, CURRENT_DATE) AS today;

-- ============================================================================
-- 05 — BAND-SCOPED CLEANUP (children before parents)
-- ============================================================================
-- Deletes only rows this file owns: the 800000–899999 id band plus generated-id
-- children of band parents. Trigger-created side rows (room_status_change_log,
-- room_history, auto housekeeping_tasks) carry sequence ids, so they are
-- removed by their room_id predicate instead. audit_logs is append-only and
-- intentionally absent — its inserts below are marker-guarded.

DELETE FROM public.voucher_redemption_allocations
 WHERE redemption_id IN (SELECT id FROM public.voucher_redemptions WHERE id BETWEEN 800000 AND 899999)
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.voucher_redemptions WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.payment_receipt_requests
 WHERE payment_id IN (SELECT id FROM public.payments WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.payment_retry_capabilities WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.customer_ledger_payments
 WHERE ledger_id IN (SELECT id FROM public.customer_ledgers WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.night_audit_posted_nights WHERE id BETWEEN 800000 AND 899999
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.night_audit_details WHERE id BETWEEN 800000 AND 899999
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.staff_notification_reads
 WHERE notification_id IN (SELECT id FROM public.staff_notifications WHERE id BETWEEN 800000 AND 899999)
    OR user_id BETWEEN 800000 AND 899999;
DELETE FROM public.support_messages
 WHERE conversation_id IN (SELECT id FROM public.support_conversations WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.support_events
 WHERE conversation_id IN (SELECT id FROM public.support_conversations WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.support_conversations WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.self_checkin_events WHERE id BETWEEN 800000 AND 899999
    OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.email_deliveries WHERE id BETWEEN 800000 AND 899999
    OR campaign_id IN (SELECT id FROM public.email_campaigns WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.loyalty_redemptions WHERE id BETWEEN 800000 AND 899999 OR member_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_transactions WHERE id BETWEEN 800000 AND 899999
    OR member_id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.reward_redemptions WHERE id BETWEEN 800000 AND 899999
    OR membership_id IN (SELECT id FROM public.loyalty_memberships WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.points_transactions WHERE id BETWEEN 800000 AND 899999
    OR membership_id IN (SELECT id FROM public.loyalty_memberships WHERE id BETWEEN 800000 AND 899999);
DELETE FROM public.loyalty_accounts WHERE id BETWEEN 800000 AND 899999 OR member_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_memberships WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_members WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.loyalty_rewards WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_notes WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_preferences WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_documents WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_reviews WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_portal_sessions WHERE id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_complimentary_credits WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.notification_subscriptions WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.notification_consent_events WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.consent_records WHERE id BETWEEN 800000 AND 899999
    OR guest_id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.user_guests WHERE id BETWEEN 800000 AND 899999
    OR user_id BETWEEN 800000 AND 899999 OR guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.invoices WHERE id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.customer_ledgers WHERE id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.payments WHERE id BETWEEN 800000 AND 899999 OR booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_guests WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_history WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_modifications WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.booking_services WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_changes WHERE booking_id BETWEEN 800000 AND 899999;
DELETE FROM public.bookings WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.housekeeping_tasks WHERE id BETWEEN 800000 AND 899999
    OR room_id BETWEEN 800000 AND 899999;
DELETE FROM public.maintenance_tickets WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.room_events WHERE room_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_history WHERE room_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_status_change_log WHERE room_id BETWEEN 800000 AND 899999;
-- Keyed by (room_type_id, stay_date), no id column; covers bootstrap types too.
DELETE FROM public.online_inventory_allocations
 WHERE room_type_id IN (SELECT id FROM public.room_types
                        WHERE id BETWEEN 800000 AND 899999 OR code IN ('STD','DLX','STE','FAM'));
DELETE FROM public.room_rates WHERE rate_plan_id BETWEEN 800000 AND 899999
    OR room_type_id BETWEEN 800000 AND 899999;
DELETE FROM public.rooms WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.promotion_channels WHERE promotion_id BETWEEN 800000 AND 899999;
DELETE FROM public.promotion_loyalty_tiers WHERE promotion_id BETWEEN 800000 AND 899999;
DELETE FROM public.promotion_room_types WHERE promotion_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_type_amenities WHERE room_type_id BETWEEN 800000 AND 899999;
DELETE FROM public.room_types WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.amenities WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.rate_plans WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.services WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.email_campaigns WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.email_templates WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.email_suppressions WHERE email LIKE '%@staging.hotel-app.test';
DELETE FROM public.vouchers WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.promotions WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.guest_segments WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.night_audit_runs WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.staff_notifications WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.job_runs WHERE detail->>'staging_seed' = 'v1';
-- users.guest_id -> guests is the last edge into the guest band; clear it so
-- guests can be removed before the users that created them (guests.created_by
-- legitimately points at staging staff users).
UPDATE public.users SET guest_id = NULL WHERE guest_id BETWEEN 800000 AND 899999;
DELETE FROM public.guests WHERE id BETWEEN 800000 AND 899999;
-- companies/corporate_accounts.created_by -> users, so these precede the users delete.
DELETE FROM public.corporate_account_contacts
 WHERE corporate_account_id IN (SELECT id FROM public.corporate_accounts WHERE id::text LIKE '80000000-%');
DELETE FROM public.corporate_accounts WHERE id::text LIKE '80000000-%';
DELETE FROM public.companies WHERE id BETWEEN 800000 AND 899999;
DELETE FROM public.user_permissions WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.user_roles WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.team_members WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.user_sessions WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.refresh_tokens WHERE user_id BETWEEN 800000 AND 899999;
DELETE FROM public.users WHERE id BETWEEN 800000 AND 899999;

\echo '[staging] 10 — users, access & teams...';
-- ============================================================================
-- 10 — ORGANIZATION & ACCESS
-- ============================================================================
-- All staging users share the staging-only password `HotelStaging2026!`
-- (bcrypt, cost 12). user_type is 'staff' unless noted; the guest-portal user
-- is linked to a guest via user_guests in section 30.

INSERT INTO public.users (
    id, username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_locked, failed_login_attempts,
    last_login_at, created_at
)
OVERRIDING SYSTEM VALUE
VALUES
    (800001, 'manager_stg',    'manager.stg@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Maya Krishnan',   '+60-12-555-0101', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '2 hours',   CURRENT_TIMESTAMP - interval '90 days'),
    (800002, 'frontdesk_amy',  'frontdesk.amy@staging.hotel-app.test',  '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Amy Tan',         '+60-12-555-0102', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '30 minutes', CURRENT_TIMESTAMP - interval '88 days'),
    (800003, 'frontdesk_bala', 'frontdesk.bala@staging.hotel-app.test', '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Bala Subramaniam','+60-12-555-0103', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '1 day',      CURRENT_TIMESTAMP - interval '88 days'),
    (800004, 'hk_siti',        'hk.siti@staging.hotel-app.test',        '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Siti Rahayu',     '+60-12-555-0104', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '4 hours',    CURRENT_TIMESTAMP - interval '80 days'),
    (800005, 'hk_kumar',       'hk.kumar@staging.hotel-app.test',       '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Kumar Velu',      '+60-12-555-0105', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '1 day',      CURRENT_TIMESTAMP - interval '80 days'),
    (800006, 'finance_mei',    'finance.mei@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Mei Lin Chong',   '+60-12-555-0106', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '3 hours',    CURRENT_TIMESTAMP - interval '75 days'),
    (800007, 'marketing_nadia','marketing.nadia@staging.hotel-app.test','$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Nadia Hassan',    '+60-12-555-0107', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '5 hours',    CURRENT_TIMESTAMP - interval '70 days'),
    (800008, 'staff_razak',    'staff.razak@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Razak Ibrahim',   '+60-12-555-0108', 'staff', true,  true, false, 0, NULL,                                     CURRENT_TIMESTAMP - interval '60 days'),
    (800009, 'support_viewer', 'support.viewer@staging.hotel-app.test', '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Vikram Nair',     '+60-12-555-0109', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '2 days',     CURRENT_TIMESTAMP - interval '55 days'),
    (800010, 'ekyc_reviewer',  'ekyc.reviewer@staging.hotel-app.test',  '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Farah Aziz',      '+60-12-555-0110', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '6 hours',    CURRENT_TIMESTAMP - interval '50 days'),
    -- Inactive account: cannot log in, still appears in admin user lists.
    (800011, 'inactive_former','inactive.former@staging.hotel-app.test','$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Former Employee', '+60-12-555-0111', 'staff', false, true, false, 0, CURRENT_TIMESTAMP - interval '30 days',    CURRENT_TIMESTAMP - interval '200 days'),
    -- Locked account: exercises the lockout path in admin + auth flows.
    (800012, 'locked_desk',    'locked.desk@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Locked Reception','+60-12-555-0112', 'staff', true,  true, true,  5, CURRENT_TIMESTAMP - interval '12 hours',   CURRENT_TIMESTAMP - interval '40 days'),
    -- Guest-portal login (user_type 'guest'); linked to guest 800210 below.
    (800013, 'guest_portal',   'guest.portal@staging.hotel-app.test',   '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Portal Guest',    NULL,             'guest', true,  true, false, 0, CURRENT_TIMESTAMP - interval '8 hours',    CURRENT_TIMESTAMP - interval '45 days'),
    -- Unverified staff account (registered, never confirmed email).
    (800014, 'newhire_unverified','newhire.unverified@staging.hotel-app.test','$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK','New Hire', NULL,'staff', true,  false, false, 0, NULL, CURRENT_TIMESTAMP - interval '1 day'),
    -- Voucher-scope audit pair: 800015 holds promotions:read + vouchers:read
    -- only (see user_permissions below); 800016 has no voucher permissions at
    -- all. Together they exercise read-only vs forbidden voucher views.
    (800015, 'voucher_audit',  'voucher.audit@staging.hotel-app.test',   '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Voucher Auditor','+60-12-555-0113', 'staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '2 days',     CURRENT_TIMESTAMP - interval '30 days'),
    (800016, 'voucher_noperm', 'voucher.noperm@staging.hotel-app.test',  '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'No Voucher Perms','+60-12-555-0114','staff', true,  true, false, 0, CURRENT_TIMESTAMP - interval '2 days',     CURRENT_TIMESTAMP - interval '30 days');

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES
    (800001, 'manager'),
    (800002, 'receptionist'),
    (800003, 'receptionist'),
    (800004, 'housekeeping'),
    (800005, 'housekeeping'),
    (800006, 'auditor'),
    (800007, 'staff'),
    (800008, 'staff'),
    (800009, 'support_readonly'),
    (800010, 'ekyc_reviewer'),
    (800011, 'staff'),
    (800012, 'receptionist'),
    (800013, 'guest'),
    (800014, 'staff'),
    (800015, 'staff'),
    (800016, 'staff')
) AS m(user_id, role_name)
JOIN public.users u ON u.id = m.user_id
JOIN public.roles r ON r.name = m.role_name;

-- Per-user permission grants layered on top of the role: the finance and
-- marketing accounts are `staff` with explicit operational permissions.
INSERT INTO public.user_permissions (user_id, permission_id, assigned_by)
SELECT 800006, p.id, 1000 FROM public.permissions p
WHERE p.name IN ('payments:read','payments:create','payments:refund','invoices:read','invoices:create','ledgers:read','ledgers:create','reports:read','revenue:read')
UNION ALL
SELECT 800007, p.id, 1000 FROM public.permissions p
WHERE p.name IN ('promotions:manage','promotions:read','communications:manage','communications:read','segments:read','segments:manage','guests:read','analytics:read','revenue:read')
UNION ALL
-- voucher_audit: read-only voucher/promotion scope, nothing else.
SELECT 800015, p.id, 1000 FROM public.permissions p
WHERE p.name IN ('promotions:read','vouchers:read');

-- Staff the seeded starter teams (codes come from seed.sql bootstrap).
INSERT INTO public.team_members (team_id, user_id, is_lead, added_by)
SELECT t.id, m.user_id, m.is_lead, 1000
FROM (VALUES
    ('front_desk',  800002, false), ('front_desk',  800003, false), ('front_desk',  800001, true),
    ('housekeeping',800004, false), ('housekeeping',800005, true),
    ('maintenance', 800008, false), ('maintenance', 800001, true)
) AS m(team_code, user_id, is_lead)
JOIN public.teams t ON t.code = m.team_code;

\echo '[staging] 20 — room inventory, amenities & rates...';
-- ============================================================================
-- 20 — ROOM INVENTORY
-- ============================================================================
-- Adds to (never replaces) the bootstrap catalog: 2 extra room types and 24
-- rooms on floors 5-8. Booking inserts in section 40 drive rooms into
-- reserved/occupied/dirty via the sync_room_status_with_booking trigger; a few
-- states that no booking can produce are set explicitly here so the status
-- transition is also recorded in room_status_change_log/room_history.

INSERT INTO public.amenities (id, name, category, icon, description, is_paid, price, is_active)
OVERRIDING SYSTEM VALUE VALUES
    (800101, 'High-Speed WiFi',   'connectivity', 'wifi',       'Complimentary fibre broadband',        false, NULL,  true),
    (800102, 'Infinity Pool',     'recreation',   'pool',       'Rooftop pool, 7am-9pm',                false, NULL,  true),
    (800103, 'Fitness Centre',    'recreation',   'gym',        '24-hour access',                       false, NULL,  true),
    (800104, 'Valet Parking',     'convenience',  'parking',    'Per-night valet service',              true,  15.00, true),
    (800105, 'Breakfast Buffet',  'dining',       'restaurant', 'Halal-certified buffet, 6.30-10.30am', true,  35.00, true),
    (800106, 'Spa Access',        'recreation',   'spa',        '2-hour thermal circuit',               true,  80.00, true),
    (800107, 'Minibar',           'in_room',      'minibar',    'Stocked daily, charges apply',         true,  NULL,  true),
    (800108, 'Airport Transfer',  'convenience',  'shuttle',    'KLIA/KLIA2 pickup on request',         true,  120.00,true),
    (800109, 'Bathtub',           'in_room',      'bathtub',    'Soaking tub',                          false, NULL,  true),
    (800110, 'Skyline View',      'in_room',      'view',       'High-floor city view',                 false, NULL,  true),
    (800111, 'Legacy Amenity',    'in_room',      'archive',    'Retired option kept for history',      false, NULL,  false);

INSERT INTO public.room_types (
    id, name, code, description, max_occupancy, base_price, size_sqm,
    bed_type, bed_count, allows_extra_bed, max_extra_beds, extra_bed_charge,
    keycard_deposit_amount, service_charge_percentage, sort_order
)
OVERRIDING SYSTEM VALUE VALUES
    (800201, 'Economy Single', 'ECO', 'Compact solo-traveller room', 1, 90.00, 18.0, 'Single', 1, false, 0, 0.00, 30.00, 10.00, 5),
    (800202, 'Premier Suite',  'PRE', 'Top-floor suite with lounge access', 4, 550.00, 68.0, 'King', 1, true, 1, 90.00, 50.00, 10.00, 0),
    -- Inactive type kept for filter/dropdown coverage.
    (800203, 'Retired Pod',    'POD', 'Former capsule pilot, offline', 1, 60.00, 10.0, 'Single', 1, false, 0, 0.00, 0.00, 0.00, 99);

UPDATE public.room_types SET is_active = false WHERE id = 800203;

INSERT INTO public.room_type_amenities (room_type_id, amenity_id, is_complimentary)
SELECT rt.id, a.id, a.is_paid IS DISTINCT FROM true
FROM public.room_types rt
JOIN public.amenities a ON a.id BETWEEN 800101 AND 800110
WHERE rt.id IN (800201, 800202)
   OR rt.code IN ('DLX', 'STE')
  AND a.id IN (800101, 800102, 800103, 800109, 800110);

-- 24 staging rooms: floors 5-8. All enter as 'available'; bookings and the
-- explicit status calls below produce the occupied/reserved/dirty/maintenance
-- spread with real transition history.
INSERT INTO public.rooms (id, room_number, room_type_id, floor, building, status, is_accessible, has_view, view_type, is_smoking)
OVERRIDING SYSTEM VALUE
SELECT 800300 + n, v.room_number, rt.id, v.floor, 'Main', 'available', v.accessible, v.has_view, v.view_type, v.smoking
FROM (VALUES
    (1, '501', 'ECO', 5, false, false, NULL,     false),
    (2, '502', 'ECO', 5, false, false, NULL,     false),
    (3, '503', 'ECO', 5, true,  false, NULL,     false),
    (4, '504', 'ECO', 5, false, false, NULL,     false),
    (5, '505', 'ECO', 5, false, false, NULL,     false),
    (6, '506', 'ECO', 5, false, false, NULL,     false),
    -- 506 enters as 'cleaning' below (no available->cleaning transition exists)
    (7, '601', 'STD', 6, false, false, NULL,     false),
    (8, '602', 'STD', 6, false, false, NULL,     true),
    (9, '603', 'STD', 6, false, false, NULL,     false),
    (10,'604', 'STD', 6, false, false, NULL,     false),
    (11,'605', 'STD', 6, false, true,  'city',   false),
    (12,'606', 'STD', 6, false, true,  'city',   false),
    (13,'701', 'DLX', 7, false, true,  'city',   false),
    (14,'702', 'DLX', 7, false, true,  'city',   false),
    (15,'703', 'DLX', 7, false, true,  'garden', false),
    (16,'704', 'DLX', 7, false, true,  'garden', false),
    (17,'705', 'DLX', 7, false, true,  'city',   false),
    (18,'706', 'DLX', 7, false, true,  'city',   false),
    (19,'801', 'PRE', 8, false, true,  'skyline',false),
    (20,'802', 'PRE', 8, false, true,  'skyline',false),
    (21,'803', 'PRE', 8, false, true,  'skyline',false),
    (22,'804', 'PRE', 8, false, true,  'skyline',false),
    (23,'805', 'STE', 8, false, true,  'skyline',false),
    (24,'806', 'STE', 8, false, true,  'skyline',false)
) AS v(n, room_number, type_code, floor, accessible, has_view, view_type, smoking)
JOIN public.room_types rt ON rt.code = v.type_code;

UPDATE public.rooms SET status = 'cleaning' WHERE id = 800306;

-- States no booking can produce, applied through update_room_status() so the
-- change is validated and journaled like an operator action:
--   806 maintenance (in progress), 805 out_of_order, 706 dirty (+auto HK task),
--   506 cleaning (+auto in-progress HK task).
SELECT public.update_room_status(800324, 'maintenance', 'Scheduled elevator-shaft inspection — staging', 800008,
        (SELECT today FROM staging_ref)::timestamptz - interval '1 day',
        (SELECT today FROM staging_ref)::timestamptz + interval '3 days');
SELECT public.update_room_status(800323, 'out_of_order', 'Water leak behind vanity — awaiting parts', 800008,
        (SELECT today FROM staging_ref)::timestamptz - interval '2 days', NULL);
SELECT public.update_room_status(800318, 'dirty', 'Checkout cleaning pending', 800004,
        (SELECT today FROM staging_ref)::timestamptz - interval '3 hours', NULL);
-- 506 is mid-clean: set directly (schema has no inbound 'cleaning' transition)
-- and pair it with an in-progress housekeeping task below.

-- ============================================================================
-- RATE PLANS & ROOM RATES
-- ============================================================================
-- seed.sql deliberately ships no rate plans; staging adds a working rate grid.

INSERT INTO public.rate_plans (
    id, name, code, description, plan_type, adjustment_type, adjustment_value,
    valid_from, valid_to, applies_saturday, applies_sunday,
    min_nights, min_advance_booking, is_active, priority, created_by
)
OVERRIDING SYSTEM VALUE VALUES
    (800501, 'Rack Rate',        'RACK',  'Standard unrestricted rate',                    'standard',    'override',   NULL,   NULL, NULL, true, true,  1, 0,  true, 100, 800001),
    (800502, 'Corporate Rate',   'CORP',  'Negotiated corporate rate, -10% off rack',      'corporate',   'percentage', -10.00, NULL, NULL, true, true,  1, 0,  true, 80,  800001),
    (800503, 'Weekend Getaway',  'WKND',  'Fri-Sun leisure rate, +15% premium',            'seasonal',    'percentage', 15.00,  NULL, NULL, true, true,  2, 2,  true, 60,  800007),
    (800504, 'Advance Purchase', 'ADV',   'Prepaid non-refundable style rate, -20%',       'promotional', 'percentage', -20.00, NULL, NULL, true, true,  1, 14, true, 70,  800007),
    (800505, 'Last Year Promo',  'OLD25', 'Expired campaign kept for history',             'promotional', 'percentage', -25.00,
            (SELECT today - 400 FROM staging_ref), (SELECT today - 370 FROM staging_ref), true, true, 1, 0, false, 10, 800007);

INSERT INTO public.room_rates (id, rate_plan_id, room_type_id, price, effective_from, effective_to)
OVERRIDING SYSTEM VALUE
SELECT 800600 + ROW_NUMBER() OVER (ORDER BY rp.id, rt.id),
       rp.id, rt.id,
       ROUND(rt.base_price * COALESCE(1 + rp.adjustment_value / 100, 1), 2),
       (SELECT today - 30 FROM staging_ref),
       NULL
FROM public.rate_plans rp
CROSS JOIN public.room_types rt
WHERE rp.id IN (800501, 800502, 800503, 800504)
  AND rt.code IN ('STD', 'DLX', 'STE', 'FAM', 'ECO', 'PRE')
  AND (rp.code <> 'WKND' OR rt.code NOT IN ('ECO'));

-- Sellable online inventory for the next two weeks, with a couple of
-- closed/walk-in-reserved dates for grid coverage.
INSERT INTO public.online_inventory_allocations (room_type_id, stay_date, walk_in_reserved_rooms, online_booking_enabled, custom_price, updated_by)
SELECT rt.id, (SELECT today FROM staging_ref) + d,
       CASE WHEN d IN (3, 10) AND rt.code = 'STD' THEN 1 ELSE 0 END,
       NOT (d = 7 AND rt.code IN ('DLX', 'PRE')),
       CASE WHEN d = 7 AND rt.code = 'STE' THEN 499.00 ELSE NULL END,
       800001
FROM public.room_types rt
CROSS JOIN generate_series(0, 13) AS d
WHERE rt.code IN ('STD', 'DLX', 'STE', 'ECO', 'PRE');

\echo '[staging] 30 — guests, companies & CRM...';
-- ============================================================================
-- 30 — GUESTS & CORPORATE ACCOUNTS
-- ============================================================================
-- ~50 fictional guests. tourism_type drives the booking trigger's tourism tax
-- (foreign => 10/night). vip_status/segments/loyalty feed CRM screens.

INSERT INTO public.guests (
    id, nick_name, first_name, last_name, email, phone, title,
    date_of_birth, nationality, country, city, state,
    id_type, id_number, language_preference, communication_preference,
    marketing_opt_in, vip_status, guest_type, tourism_type,
    discount_percentage, total_stays, total_spend, average_rating,
    tags, notes, special_requests, is_blacklisted, blacklist_reason,
    is_active, created_by
)
OVERRIDING SYSTEM VALUE
SELECT g.id, g.nick, g.first_name, g.last_name, g.email, g.phone, g.title,
       g.dob::date, g.nationality, g.country, g.city, g.state,
       g.id_type::public.identificationtype, g.id_number, g.lang, g.comm_pref,
       g.mkt, g.vip, g.gtype::public.guest_type, g.ttype::public.tourism_type,
       g.discount, g.stays, g.spend, g.rating, g.tags, g.notes, g.requests,
       g.blacklisted, g.blacklist_reason, true, g.created_by
FROM (VALUES
    -- Loyalty members (member guests get loyalty_members rows in section 80).
    (801001,'Aisha R.','Aisha','Rahman','aisha.rahman@staging.hotel-app.test','+60-12-600-1001','Ms','1988-03-14','Malaysian','Malaysia','Kuala Lumpur','WP','national_id','STG-IC-880101','en','email',true,'vip','member','local',5,14,18240.50,4.80,ARRAY['vip','repeat','quiet-room'],'Prefers high floor, away from lift.','Late arrival guaranteed',false,NULL,800001),
    (801002,'Marcus T.','Marcus','Tan','marcus.tan@staging.hotel-app.test','+60-12-600-1002','Mr','1979-11-02','Malaysian','Malaysia','Petaling Jaya','Selangor','drivers_license','STG-DL-770202','en','email',true,NULL,'member','local',0,9,9320.00,4.50,ARRAY['repeat','business'],NULL,'King bed only',false,NULL,800001),
    (801003,'Emily W.','Emily','Wilson','emily.wilson@staging.hotel-app.test','+44-7700-901003','Ms','1991-06-21','British','United Kingdom','London','London','passport','STG-PP-UK-3303','en','email',true,NULL,'member','foreign',0,6,14780.25,4.90,ARRAY['repeat','tourist'],NULL,'Vegetarian breakfast',false,NULL,800002),
    (801004,'Kenji T.','Kenji','Takahashi','kenji.takahashi@staging.hotel-app.test','+81-90-1234-0004','Mr','1985-01-30','Japanese','Japan','Osaka','Osaka','passport','STG-PP-JP-4404','en','email',false,NULL,'member','foreign',0,4,11200.00,NULL,ARRAY['tourist'],NULL,NULL,false,NULL,800002),
    (801005,'Priya N.','Priya','Nair','priya.nair@staging.hotel-app.test','+91-98-4500-0005','Ms','1993-09-09','Indian','India','Bengaluru','Karnataka','passport','STG-PP-IN-5505','en','email',true,NULL,'member','foreign',0,3,6210.75,4.20,ARRAY['tourist'],NULL,'Early check-in requested',false,NULL,800002),
    (801006,'Chen W.','Chen','Wei','chen.wei@staging.hotel-app.test','+86-138-0000-0006','Mr','1982-12-05','Chinese','China','Shanghai','Shanghai','passport','STG-PP-CN-6606','en','sms',false,'vip','member','foreign',10,11,32100.00,4.70,ARRAY['vip','corporate','repeat'],NULL,'Airport transfer on arrival',false,NULL,800001),
    (801007,'Fatimah A.','Fatimah','Abdullah','fatimah.abdullah@staging.hotel-app.test','+60-12-600-1007','Ms','1990-04-18','Malaysian','Malaysia','Penang','Penang','national_id','STG-IC-880107','ms','email',true,NULL,'member','local',0,7,8120.00,4.30,ARRAY['repeat','family'],NULL,'Connecting rooms preferred',false,NULL,800003),
    (801008,'James O.','James','O''Brien','james.obrien@staging.hotel-app.test','+353-87-000-0008','Mr','1975-08-25','Irish','Ireland','Dublin','Dublin','passport','STG-PP-IE-7708','en','email',true,NULL,'member','foreign',0,2,4450.00,NULL,ARRAY['tourist'],NULL,NULL,false,NULL,800002),
    -- Corporate liaison guests (linked to corporate accounts below).
    (801009,'Diana L.','Diana','Lim','diana.lim@staging.hotel-app.test','+60-12-600-1009','Ms','1987-02-11','Malaysian','Malaysia','Kuala Lumpur','WP','national_id','STG-IC-880109','en','email',true,NULL,'non_member','local',0,5,15600.00,NULL,ARRAY['corporate'],'Books for TechCorp regional team.',NULL,false,NULL,800002),
    (801010,'Harold S.','Harold','Sim','harold.sim@staging.hotel-app.test','+60-12-600-1010','Mr','1970-05-30','Malaysian','Malaysia','Johor Bahru','Johor','national_id','STG-IC-880110','en','email',false,NULL,'non_member','local',0,8,21400.00,4.10,ARRAY['corporate','repeat'],'Globex account manager travel.',NULL,false,NULL,800002),
    -- Walk-in / one-off / minimal-profile guests.
    (801011,'Ravi','Ravi',NULL,NULL,'+60-12-600-1011',NULL,NULL,NULL,'Malaysia',NULL,NULL,NULL,NULL,'en',NULL,false,NULL,'non_member','local',0,1,180.00,NULL,NULL,NULL,NULL,false,NULL,800003),
    (801012,'Sofia M.','Sofia','Mendoza','sofia.mendoza@staging.hotel-app.test',NULL,'Ms','1995-07-07','Filipino','Philippines','Manila','NCR','passport','STG-PP-PH-7712','en','email',true,NULL,'non_member','foreign',0,1,540.00,NULL,NULL,NULL,NULL,false,NULL,800003),
    (801013,'Tom H.','Tom','Hardy','tom.hardy@staging.hotel-app.test','+61-400-000-013','Mr','1968-10-10','Australian','Australia','Sydney','NSW','passport','STG-PP-AU-7713','en','email',true,NULL,'non_member','foreign',0,0,0.00,NULL,NULL,NULL,NULL,false,NULL,800002),
    (801014,'Lucy K.','Lucy','Kim','lucy.kim@staging.hotel-app.test','+82-10-0000-0014','Ms','1997-01-15','Korean','South Korea','Seoul','Seoul','passport','STG-PP-KR-7714','en','email',true,NULL,'non_member','foreign',0,0,0.00,NULL,NULL,NULL,'Honeymoon — flowers in room',false,NULL,800002),
    (801015,'Ahmad Z.','Ahmad','Zulkifli','ahmad.z@staging.hotel-app.test','+60-12-600-1015','Mr','1960-03-03','Malaysian','Malaysia','Kota Bharu','Kelantan','national_id','STG-IC-880115','ms','phone',false,NULL,'non_member','local',0,3,1440.00,3.90,NULL,NULL,'Smoking room if available',false,NULL,800003),
    -- Problem/edge-case guests.
    (801016,'Blacklisted G.','Gerald','Frost','gerald.frost@staging.hotel-app.test','+60-12-600-1016','Mr','1980-09-17','Malaysian','Malaysia','Kuala Lumpur','WP','national_id','STG-IC-880116','en','email',false,NULL,'non_member','local',0,2,2100.00,NULL,ARRAY['flagged'],NULL,NULL,true,'Room damage & abusive conduct, 2025-11 stay',800001),
    (801017,'Verylongnamesthatwon','Alexandra','Featherstonhaugh-Whitmore-Long','alex.fwlong@staging.hotel-app.test','+44-7700-901017','Ms','1992-12-01','British','United Kingdom','Manchester','Greater Manchester','passport','STG-PP-UK-8817','en','email',true,NULL,'non_member','foreign',0,1,890.00,NULL,NULL,'Longest-name fixture for layout tests.',NULL,false,NULL,800002),
    (801018,'Dup Test A','Daniel','Lee','daniel.lee@staging.hotel-app.test','+60-12-600-1018','Mr','1986-06-06','Malaysian','Malaysia','Kuala Lumpur','WP','national_id','STG-IC-880118','en','email',false,NULL,'non_member','local',0,1,300.00,NULL,NULL,NULL,NULL,false,NULL,800003),
    (801019,'Dup Test B','Daniel','Leigh','daniel.leigh@staging.hotel-app.test','+60-16-600-1019','Mr','1986-06-06','Malaysian','Malaysia','Ipoh','Perak','national_id','STG-IC-880119','en','email',false,NULL,'non_member','local',0,0,0.00,NULL,NULL,'Distinct from 801018 — search/dedup test.',NULL,false,NULL,800003),
    (801020,'Portal Guest','Portal','Guest','guest.portal@staging.hotel-app.test','+60-12-600-1020','Mr','1990-01-01','Malaysian','Malaysia','Kuala Lumpur','WP','national_id','STG-IC-880120','en','email',true,NULL,'member','local',0,2,1240.00,NULL,NULL,'Account used by the guest-portal login 800013.',NULL,false,NULL,800001)
) AS g(id, nick, first_name, last_name, email, phone, title, dob, nationality,
       country, city, state, id_type, id_number, lang, comm_pref, mkt, vip,
       gtype, ttype, discount, stays, spend, rating, tags, notes, requests,
       blacklisted, blacklist_reason, created_by);

-- Bulk filler for pagination/search coverage: 30 more guests, deterministic
-- mix of local/foreign, member/non-member, with realistic Malay/Chinese/Indian
-- name rotation.
INSERT INTO public.guests (
    id, nick_name, first_name, last_name, email, phone,
    nationality, country, id_type, id_number,
    marketing_opt_in, guest_type, tourism_type, total_stays, total_spend,
    is_active, created_by
)
OVERRIDING SYSTEM VALUE
SELECT 801020 + n,
       names.fn || ' ' || names.ln || ' ' || n::text,
       names.fn, names.ln,
       lower(regexp_replace(names.fn, '\s+', '', 'g') || '.' || names.ln || n || '@staging.hotel-app.test'),
       '+60-1' || (n % 10) || '-600-' || lpad((2000 + n)::text, 4, '0'),
       names.nats, names.cnts,
       CASE WHEN names.nats = 'Malaysian' THEN 'national_id' ELSE 'passport' END::public.identificationtype,
       'STG-ID-' || lpad((801020 + n)::text, 6, '0'),
       (n % 3) = 0,
       CASE WHEN n % 4 = 0 THEN 'member' ELSE 'non_member' END::public.guest_type,
       CASE WHEN names.nats = 'Malaysian' THEN 'local' ELSE 'foreign' END::public.tourism_type,
       n % 5, (n % 5) * 780.00,
       true, 800003
FROM generate_series(1, 30) AS n,
     LATERAL (SELECT (ARRAY['Nurul','Wei Ming','Arjun','Mei Ling','Hakim','Sarah','Rajesh','Siti'])[n % 8 + 1] AS fn,
                     (ARRAY['Hassan','Tan','Pillai','Wong','Ismail','Ong','Kaur','Lim'])[n % 8 + 1] AS ln,
                     (ARRAY['Malaysian','Malaysian','Indian','Malaysian','Malaysian','Singaporean','Indian','Malaysian'])[n % 8 + 1] AS nats,
                     (ARRAY['Malaysia','Malaysia','India','Malaysia','Malaysia','Singapore','India','Malaysia'])[n % 8 + 1] AS cnts) AS names;

-- Companies (direct-bill) and corporate accounts (contract rates).
INSERT INTO public.companies (id, company_name, registration_number, contact_person, contact_email, contact_phone, billing_address, billing_city, billing_state, billing_postal_code, billing_country, is_active, credit_limit, payment_terms_days, notes, created_by)
OVERRIDING SYSTEM VALUE VALUES
    (801101, 'TechCorp Solutions Sdn Bhd', 'SA-2011-00442', 'Diana Lim', 'ap@techcorp.staging.hotel-app.test', '+60-3-7000-1001', 'Level 10, Menara Axis', 'Kuala Lumpur', 'WP', '50200', 'Malaysia', true, 50000.00, 30, 'Preferred corporate account since 2023.', 800001),
    (801102, 'Globex (Malaysia) Sdn Bhd',  'SA-2009-00117', 'Harold Sim', 'travel@globex.staging.hotel-app.test', '+60-3-7000-1002', 'Suite 8, Wisma UOA', 'Kuala Lumpur', 'WP', '50450', 'Malaysia', true, 80000.00, 45, 'Quarterly billing review in March.', 800001),
    (801103, 'Dormant Trading Co',         'SA-1998-00091', NULL, NULL, NULL, NULL, 'Penang', 'Penang', '10000', 'Malaysia', false, 0.00, 30, 'Inactive — kept for filter tests.', 800001);

INSERT INTO public.corporate_accounts (id, name, company_registration, tax_id, industry, billing_address, billing_email, billing_phone, credit_limit, credit_balance, payment_terms, discount_percentage, contract_start, contract_end, is_active, notes, created_by)
OVERRIDING SYSTEM VALUE VALUES
    ('80000000-0000-4000-8000-000000000001', 'TechCorp Solutions Sdn Bhd', 'SA-2011-00442', 'C-TECH-442', 'Technology', 'Level 10, Menara Axis, Kuala Lumpur', 'ap@techcorp.staging.hotel-app.test', '+60-3-7000-1001', 50000.00, 12400.00, 'Net 30', 10.00, CURRENT_DATE - 400, CURRENT_DATE + 265, true, 'Direct-bill: invoices go to AP mailbox.', 800001),
    ('80000000-0000-4000-8000-000000000002', 'Globex (Malaysia) Sdn Bhd', 'SA-2009-00117', 'C-GLBX-117', 'Manufacturing', 'Suite 8, Wisma UOA, Kuala Lumpur', 'travel@globex.staging.hotel-app.test', '+60-3-7000-1002', 80000.00, 32750.00, 'Net 45', 12.50, CURRENT_DATE - 300, CURRENT_DATE + 65, true, 'Contract renewal due soon.', 800001),
    ('80000000-0000-4000-8000-000000000003', 'Initech Events', 'SA-2019-00788', 'C-INCH-788', 'Events', 'Bangsar South, Kuala Lumpur', 'events@initech.staging.hotel-app.test', NULL, 10000.00, 0.00, 'Net 14', 5.00, CURRENT_DATE - 120, CURRENT_DATE - 10, false, 'Expired contract — filter coverage.', 800001);

INSERT INTO public.corporate_account_contacts (id, corporate_account_id, name, email, phone, role, is_primary)
OVERRIDING SYSTEM VALUE VALUES
    (801201, '80000000-0000-4000-8000-000000000001', 'Diana Lim', 'diana.lim@staging.hotel-app.test', '+60-12-600-1009', 'Travel Coordinator', true),
    (801202, '80000000-0000-4000-8000-000000000001', 'Accounts Payable', 'ap@techcorp.staging.hotel-app.test', NULL, 'Finance', false),
    (801203, '80000000-0000-4000-8000-000000000002', 'Harold Sim', 'harold.sim@staging.hotel-app.test', '+60-12-600-1010', 'Admin Manager', true);

-- CRM detail rows.
INSERT INTO public.guest_preferences (guest_id, category, preference_key, preference_value) VALUES
    (801001, 'room', 'floor', 'high'),
    (801001, 'room', 'view', 'city'),
    (801001, 'dietary', 'breakfast', 'halal'),
    (801003, 'dietary', 'breakfast', 'vegetarian'),
    (801003, 'comfort', 'pillow', 'firm'),
    (801006, 'room', 'floor', 'top'),
    (801006, 'transport', 'airport_pickup', 'required'),
    (801007, 'room', 'connecting_rooms', 'preferred');

INSERT INTO public.guest_notes (id, guest_id, note_type, subject, content, is_alert, is_private, interaction_type, booking_id, follow_up_at, assigned_to, created_by)
OVERRIDING SYSTEM VALUE VALUES
    (809301, 801001, 'preference', 'VIP handling', 'Loyalty platinum-tier guest; pre-assign skyline suite when available.', true, false, 'note', NULL, NULL, 800002, 800001),
    (809302, 801016, 'incident', 'Blacklist reason', 'Room damage and abusive conduct during Nov 2025 stay. Do not rebook without manager sign-off.', true, false, 'note', NULL, NULL, 800001, 800001),
    (809303, 801014, 'request', 'Honeymoon setup', 'Flowers and card in room before arrival; arranged with housekeeping.', false, false, 'follow_up', NULL, (SELECT today FROM staging_ref)::timestamptz + interval '2 days', 800004, 800002),
    (809304, 801005, 'complaint', 'Slow room service', 'Waited 55 minutes for in-room dining on last stay; offered dessert voucher.', false, false, 'call', NULL, NULL, 800002, 800002),
    (809305, 801009, 'billing', 'PO required on invoices', 'TechCorp invoices must quote PO number TC-2026-Q3.', false, false, 'note', NULL, NULL, 800006, 800006),
    (809306, 801015, 'general', NULL, 'Prefers WhatsApp over phone calls.', false, true, 'note', NULL, NULL, NULL, 800003);

INSERT INTO public.guest_documents (id, guest_id, document_type, document_number, is_verified, verified_at, verified_by)
OVERRIDING SYSTEM VALUE VALUES
    (809501, 801003, 'passport', 'STG-PP-UK-3303', true, CURRENT_TIMESTAMP - interval '20 days', 800002),
    (809502, 801006, 'passport', 'STG-PP-CN-6606', true, CURRENT_TIMESTAMP - interval '15 days', 800002),
    (809503, 801012, 'passport', 'STG-PP-PH-7712', false, NULL, NULL);

INSERT INTO public.guest_reviews (id, guest_id, booking_id, overall_rating, cleanliness_rating, service_rating, comfort_rating, location_rating, value_rating, title, content, response, response_at, response_by, is_published)
OVERRIDING SYSTEM VALUE VALUES
    (809601, 801001, NULL, 5.00, 5.00, 5.00, 4.50, 5.00, 4.50, 'Consistently excellent', 'Third stay this year; the team remembered my preferences.', 'Thank you, Aisha — see you next visit.', CURRENT_TIMESTAMP - interval '30 days', 800001, true),
    (809602, 801005, NULL, 3.50, 4.00, 3.00, 4.00, 4.50, 3.00, 'Good room, slow dining', 'Room was spotless but room service took nearly an hour.', 'Apologies for the delay — we have briefed the F&B team.', CURRENT_TIMESTAMP - interval '18 days', 800001, true),
    (809603, 801013, NULL, 4.00, NULL, NULL, NULL, NULL, NULL, 'Short stay, smooth check-in', 'In and out for a conference. No complaints.', NULL, NULL, NULL, true),
    (809604, 801011, NULL, 2.50, 2.00, 3.00, 2.00, 4.00, 3.00, 'Aircon too loud', 'Unit in the economy room rattled all night.', NULL, NULL, NULL, false);

-- Guest segments used by campaigns and the segments module.
INSERT INTO public.guest_segments (id, name, slug, description, rules, is_active, created_by)
OVERRIDING SYSTEM VALUE VALUES
    (807401, 'VIP & High Spenders', 'vip-high-spenders', 'VIP-flagged guests or total spend over 10k', '{"any":[{"field":"vip_status","op":"is_not_null"},{"field":"total_spend","op":"gte","value":10000}]}'::jsonb, true, 800007),
    (807402, 'Foreign Tourists', 'foreign-tourists', 'Guests marked as foreign tourism_type', '{"all":[{"field":"tourism_type","op":"eq","value":"foreign"}]}'::jsonb, true, 800007),
    (807403, 'Corporate Travellers', 'corporate-travellers', 'Guests carrying the corporate tag', '{"all":[{"field":"tags","op":"contains","value":"corporate"}]}'::jsonb, true, 800007),
    (807404, 'Dormant Members', 'dormant-members', 'Members with no stay in 180+ days', '{"all":[{"field":"guest_type","op":"eq","value":"member"},{"field":"last_stay_days","op":"gte","value":180}]}'::jsonb, false, 800007);

-- Portal linkage: the guest-portal login user manages its own guest record.
INSERT INTO public.user_guests (id, user_id, guest_id, relationship_type, can_book_for, can_view_bookings, can_modify, linked_by)
OVERRIDING SYSTEM VALUE VALUES
    (898201, 800013, 801020, 'self', true, true, false, 800001);

UPDATE public.users SET guest_id = 801020 WHERE id = 800013;

-- Marketing subscription + consent state for a few guests.
INSERT INTO public.notification_subscriptions (id, guest_id, channel, topic, subscribed, source, policy_version)
OVERRIDING SYSTEM VALUE VALUES
    (809801, 801001, 'email', 'promotion', true, 'guest_portal', 'v1.2'),
    (809802, 801001, 'email', 'announcement', true, 'guest_portal', 'v1.2'),
    (809803, 801003, 'email', 'promotion', true, 'online_booking', 'v1.2'),
    (809804, 801007, 'email', 'birthday_voucher', true, 'front_desk', 'v1.2'),
    (809805, 801006, 'email', 'promotion', false, 'guest_portal', 'v1.2');

INSERT INTO public.notification_consent_events (id, guest_id, channel, topic, action, source, policy_version, actor_type, actor_user_id)
OVERRIDING SYSTEM VALUE VALUES
    (809901, 801001, 'email', 'promotion', 'opt_in', 'guest_portal', 'v1.2', 'guest', NULL),
    (809902, 801001, 'email', 'announcement', 'opt_in', 'guest_portal', 'v1.2', 'guest', NULL),
    (809903, 801006, 'email', 'promotion', 'opt_out', 'guest_portal', 'v1.2', 'guest', NULL),
    (809904, 801007, 'email', 'birthday_voucher', 'opt_in', 'front_desk', 'v1.2', 'staff', 800002);

INSERT INTO public.consent_records (id, subject_type, user_id, guest_id, document_type, document_version, locale, granted, source)
OVERRIDING SYSTEM VALUE VALUES
    (809851, 'guest', NULL, 801001, 'privacy_notice', '2025-06', 'en', true, 'registration'),
    (809852, 'guest', NULL, 801003, 'privacy_notice', '2025-06', 'en', true, 'online_booking'),
    (809853, 'guest', NULL, 801003, 'terms_of_service', '2025-06', 'en', true, 'online_booking'),
    (809854, 'guest', NULL, 801006, 'payment_terms', '2025-06', 'en', true, 'payment'),
    (809855, 'guest', NULL, 801014, 'privacy_notice', '2025-06', 'en', true, 'guest_portal'),
    (809856, 'user', 800013, NULL, 'privacy_notice', '2025-06', 'en', true, 'registration');

\echo '[staging] 40 — bookings & reservation history...';
-- ============================================================================
-- 40 — BOOKINGS
-- ============================================================================
-- Two populations:
--   * 802001-802045: deterministic completed history over the past ~4 months.
--     `completed`/`checked_out`/`no_show`/`voided` are outside the
--     bookings_no_room_date_overlap EXCLUDE predicate, so filler cannot
--     double-book a room.
--   * 802101+: the hand-authored scenario matrix (every status, edge cases).
--     Active-status rows get distinct rooms or disjoint windows to respect the
--     exclusion constraint — intentionally: overlapping stays in an active
--     status are DB-impossible and exercised by API tests, not fixtures.
--
-- Trigger behaviour on insert (verified against baseline):
--   * enforce_booking_tourism_tax derives is_tourist + tourism_tax_amount from
--     guests.tourism_type='foreign' x system_settings.tourism_tax_rate x nights.
--   * sync_room_status_with_booking drives rooms into occupied/reserved/dirty.
--   * validate_booking_occupancy enforces adults+children <= max_occupancy.
--   * payments inserted in section 50 then drive bookings.payment_status.

-- ---- Historical completed stays (dashboard/ADR/occupancy filler) -----------
INSERT INTO public.bookings (
    id, booking_number, guest_id, guest_name, room_id,
    check_in_date, check_out_date, adults, children,
    room_rate, subtotal, tax_amount, discount_amount, discount_percentage,
    total_amount, currency, status, payment_status,
    source, booking_channel_id, channel,
    actual_check_in, actual_check_out,
    is_posted, posted_date, posted_by,
    created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT
    802000 + n,
    'B-STG-' || lpad(n::text, 5, '0'),
    gst.id,
    gst.nick_name,
    rm.id,
    ci,
    ci + nights,
    v_adults,
    v_children,
    rt.base_price,
    ROUND(rt.base_price * nights, 2),
    ROUND(rt.base_price * nights * 0.08, 2),
    CASE WHEN gst.discount_percentage > 0
         THEN ROUND(rt.base_price * nights * gst.discount_percentage / 100, 2)
         ELSE 0 END,
    gst.discount_percentage,
    ROUND(rt.base_price * nights, 2)
        + ROUND(rt.base_price * nights * 0.08, 2)
        - CASE WHEN gst.discount_percentage > 0
               THEN ROUND(rt.base_price * nights * gst.discount_percentage / 100, 2)
               ELSE 0 END,
    'USD',
    'completed',
    'paid',
    (ARRAY['direct','website','ota','phone','walk_in'])[n % 5 + 1],
    bc.id,
    bc.name,
    (ci + interval '15 hours'),
    (ci + nights + interval '11 hours'),
    true, ci + nights, 800002,
    CASE WHEN n % 2 = 0 THEN 800002 ELSE 800003 END,
    (ci - (3 + n % 18))::timestamptz + interval '10 hours'
FROM generate_series(1, 45) AS n
JOIN LATERAL (
    SELECT 800300 + ((n - 1) % 20) + 1 AS room_id
) r ON true
JOIN public.rooms rm ON rm.id = r.room_id
JOIN public.room_types rt ON rt.id = rm.room_type_id
JOIN LATERAL (
    SELECT (SELECT today FROM staging_ref) - (140 - n * 3) AS ci,
           1 + (n % 3) AS nights
) d ON true
JOIN public.guests gst ON gst.id = 801000 + (n % 20) + 1
JOIN LATERAL (
    SELECT CASE WHEN rt.code = 'ECO' THEN 1 ELSE 1 + (n % 2) END AS v_adults,
           CASE WHEN rt.max_occupancy - (1 + (n % 2)) > 0 THEN n % 2 ELSE 0 END AS v_children
) occ ON true
LEFT JOIN public.booking_channels bc ON bc.channel_type =
    CASE (ARRAY['direct','website','ota','phone','walk_in'])[n % 5 + 1]
        WHEN 'direct' THEN 'direct' WHEN 'website' THEN 'website'
        WHEN 'ota' THEN 'ota' WHEN 'phone' THEN 'phone' ELSE 'walk_in' END
   AND bc.name = CASE (ARRAY['direct','website','ota','phone','walk_in'])[n % 5 + 1]
        WHEN 'ota' THEN 'Booking.com' WHEN 'website' THEN 'Direct Website'
        WHEN 'phone' THEN 'Phone' WHEN 'walk_in' THEN 'Walk-in' ELSE 'Direct' END;

-- ---- Explicit scenario matrix ---------------------------------------------
INSERT INTO public.bookings (
    id, booking_number, folio_number, guest_id, guest_name, guest_email, guest_phone,
    corporate_account_id, room_id, check_in_date, check_out_date,
    adults, children, infants, rate_plan_id, room_rate, subtotal, tax_amount,
    discount_amount, discount_percentage, total_amount, currency,
    extra_bed_count, extra_bed_charge, is_complimentary, complimentary_reason,
    complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at,
    status, payment_status, payment_method, market_code, company_id, company_name,
    actual_check_in, actual_check_out, early_check_in, late_check_out,
    special_requests, internal_notes, source, channel, booking_channel_id,
    ota_reference, commission_rate, commission_amount, net_revenue,
    cancelled_at, cancelled_by, cancellation_reason,
    is_posted, posted_date, created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT * FROM (VALUES
    -- In-house now (rooms go 'occupied' via trigger).
    (802101,'B-STG-1001',NULL,801001,'Aisha R.','aisha.rahman@staging.hotel-app.test','+60-12-600-1001',NULL::uuid,800321,
        (SELECT today-1 FROM staging_ref),(SELECT today+2 FROM staging_ref),2,0,0,800501,550.00,1650.00,132.00,82.50,5.00,1699.50,'USD',
        0,0.00,false,NULL,0,true,50.00,(SELECT today-1 FROM staging_ref)::timestamptz+interval '6 hours',
        'checked_in','partial','credit_card','LEISURE',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz+interval '15 hours',NULL,false,false,
        'Quiet room, late dinner arrival','VIP — skyline suite pre-assigned','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '30 days'),
    (802102,'B-STG-1002',NULL,801003,'Emily W.','emily.wilson@staging.hotel-app.test','+44-7700-901003',NULL::uuid,800322,
        (SELECT today-2 FROM staging_ref),(SELECT today+1 FROM staging_ref),2,0,0,800501,550.00,1650.00,132.00,0.00,0.00,1782.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_in','paid','online_payment','LEISURE',NULL,NULL,
        (SELECT today-2 FROM staging_ref)::timestamptz+interval '14 hours',NULL,true,false,
        'Vegetarian breakfast',NULL,'website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '10 days'),
    (802103,'B-STG-1003',NULL,801010,'Harold S.','harold.sim@staging.hotel-app.test','+60-12-600-1010','80000000-0000-4000-8000-000000000002'::uuid,800317,
        (SELECT today-3 FROM staging_ref),(SELECT today+1 FROM staging_ref),1,0,0,800502,225.00,900.00,72.00,112.50,12.50,859.50,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_in','unpaid','company_billing','CORP',801102,'Globex (Malaysia) Sdn Bhd',
        (SELECT today-3 FROM staging_ref)::timestamptz+interval '16 hours',NULL,false,false,
        NULL,'Direct-bill to Globex corporate account','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '14 days'),
    -- Departing today (rooms go 'dirty' via trigger).
    (802104,'B-STG-1004',NULL,801004,'Kenji T.','kenji.takahashi@staging.hotel-app.test','+81-90-1234-0004',NULL::uuid,800313,
        (SELECT today-2 FROM staging_ref),(SELECT today FROM staging_ref),1,0,0,800501,250.00,500.00,40.00,0.00,0.00,540.00,'USD',
        0,0.00,false,NULL,0,true,50.00,(SELECT today-2 FROM staging_ref)::timestamptz+interval '15 hours',
        'checked_out','paid','credit_card','LEISURE',NULL,NULL,
        (SELECT today-2 FROM staging_ref)::timestamptz+interval '15 hours',(SELECT today FROM staging_ref)::timestamptz+interval '10 hours',false,false,
        NULL,NULL,'ota','Booking.com',
        (SELECT id FROM booking_channels WHERE name='Booking.com'),'BDC-78381221',15.00,81.00,459.00,
        NULL,NULL,NULL,true,(SELECT today-1 FROM staging_ref),800002,CURRENT_TIMESTAMP-interval '12 days'),
    (802105,'B-STG-1005',NULL,801005,'Priya N.','priya.nair@staging.hotel-app.test','+91-98-4500-0005',NULL::uuid,800307,
        (SELECT today-1 FROM staging_ref),(SELECT today FROM staging_ref),1,0,0,800501,150.00,150.00,12.00,0.00,0.00,162.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_out','paid','ewallet','LEISURE',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz+interval '16 hours',(SELECT today FROM staging_ref)::timestamptz+interval '9 hours',false,false,
        'Early check-in requested','Early check-in granted 12:30','ota','Agoda',
        (SELECT id FROM booking_channels WHERE name='Agoda'),'AGD-5561209',18.00,29.16,132.84,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '6 days'),
    -- Arriving today (rooms go 'reserved').
    (802106,'B-STG-1006',NULL,801006,'Chen W.','chen.wei@staging.hotel-app.test','+86-138-0000-0006',NULL::uuid,800319,
        (SELECT today FROM staging_ref),(SELECT today+3 FROM staging_ref),2,0,0,800502,495.00,1485.00,118.80,185.63,12.50,1418.17,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','paid','company_billing','CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,'Airport transfer on arrival','VIP corporate — meet at lobby','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '20 days'),
    (802107,'B-STG-1007',NULL,801007,'Fatimah A.','fatimah.abdullah@staging.hotel-app.test','+60-12-600-1007',NULL::uuid,800315,
        (SELECT today FROM staging_ref),(SELECT today+2 FROM staging_ref),2,1,0,800501,250.00,500.00,40.00,0.00,0.00,540.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','partial','bank_transfer','LEISURE',NULL,NULL,
        NULL,NULL,false,false,'Connecting rooms preferred',NULL,'website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '3 days'),
    -- Future confirmed/pending spread.
    (802108,'B-STG-1008',NULL,801014,'Lucy K.','lucy.kim@staging.hotel-app.test','+82-10-0000-0014',NULL::uuid,800320,
        (SELECT today+5 FROM staging_ref),(SELECT today+8 FROM staging_ref),2,0,0,800503,632.50,1897.50,151.80,0.00,0.00,2049.30,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,'Honeymoon — flowers in room','Honeymoon setup arranged w/ HK','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '7 days'),
    (802109,'B-STG-1009',NULL,801008,'James O.','james.obrien@staging.hotel-app.test','+353-87-000-0008',NULL::uuid,800314,
        (SELECT today+10 FROM staging_ref),(SELECT today+17 FROM staging_ref),1,0,0,800504,200.00,1400.00,112.00,0.00,0.00,1512.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','paid','online_payment','LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Advance-purchase rate, prepaid','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '16 days'),
    (802110,'B-STG-1010',NULL,801011,'Ravi',NULL,'+60-12-600-1011',NULL::uuid,800301,
        (SELECT today FROM staging_ref),(SELECT today+1 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid','cash','WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'Walk-in, pays at check-in','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '2 hours'),
    (802111,'B-STG-1011',NULL,801012,'Sofia M.','sofia.mendoza@staging.hotel-app.test',NULL,NULL::uuid,800302,
        (SELECT today+3 FROM staging_ref),(SELECT today+4 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,NULL,'phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '1 day'),
    -- pending_payment: unpaid online hold (release scheduler watches these).
    (802112,'B-STG-1012',NULL,801013,'Tom H.','tom.hardy@staging.hotel-app.test','+61-400-000-013',NULL::uuid,800303,
        (SELECT today+2 FROM staging_ref),(SELECT today+5 FROM staging_ref),1,0,0,800501,90.00,270.00,21.60,0.00,0.00,291.60,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending_payment','unpaid',NULL,'OTA',NULL,NULL,
        NULL,NULL,false,false,NULL,'Online hold — awaiting first payment','ota','Booking.com',
        (SELECT id FROM booking_channels WHERE name='Booking.com'),'BDC-79011233',15.00,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '5 hours'),
    (802113,'B-STG-1013',NULL,801015,'Ahmad Z.','ahmad.z@staging.hotel-app.test','+60-12-600-1015',NULL::uuid,800308,
        (SELECT today+4 FROM staging_ref),(SELECT today+6 FROM staging_ref),2,0,0,800501,150.00,300.00,24.00,0.00,0.00,324.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending_confirmation','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,'Smoking room if available','Awaiting smoking-room confirmation','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '1 day'),
    -- Yesterday's no-show.
    (802114,'B-STG-1014',NULL,801018,'Daniel L.','daniel.lee@staging.hotel-app.test','+60-12-600-1018',NULL::uuid,800309,
        (SELECT today-2 FROM staging_ref),(SELECT today-1 FROM staging_ref),1,0,0,800501,150.00,150.00,12.00,0.00,0.00,162.00,'USD',
        0,0.00,false,NULL,0,true,50.00,(SELECT today-4 FROM staging_ref)::timestamptz,
        'no_show','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'No-show; deposit forfeited','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '4 days'),
    -- Voided with refund (payment + refund rows in section 50).
    (802115,'B-STG-1015',NULL,801003,'Emily W.','emily.wilson@staging.hotel-app.test','+44-7700-901003',NULL::uuid,800310,
        (SELECT today+6 FROM staging_ref),(SELECT today+9 FROM staging_ref),2,0,0,800501,150.00,450.00,36.00,0.00,0.00,486.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'voided','refunded','online_payment','LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Cancelled >48h out — full refund issued','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz,800001,'Guest requested cancellation — full refund',false,NULL,800002,CURRENT_TIMESTAMP-interval '9 days'),
    -- Recent posted stay.
    (802116,'B-STG-1016',NULL,801002,'Marcus T.','marcus.tan@staging.hotel-app.test','+60-12-600-1002',NULL::uuid,800311,
        (SELECT today-10 FROM staging_ref),(SELECT today-7 FROM staging_ref),2,0,0,800501,150.00,450.00,36.00,0.00,0.00,486.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'completed','paid','credit_card','CORP',NULL,NULL,
        (SELECT today-10 FROM staging_ref)::timestamptz+interval '15 hours',(SELECT today-7 FROM staging_ref)::timestamptz+interval '11 hours',false,false,
        'King bed only',NULL,'direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,true,(SELECT today-7 FROM staging_ref),800002,CURRENT_TIMESTAMP-interval '15 days'),
    -- Complimentary stay (payment_status stays 'paid' per trigger branch).
    (802117,'B-STG-1017',NULL,801006,'Chen W.','chen.wei@staging.hotel-app.test','+86-138-0000-0006',NULL::uuid,800316,
        (SELECT today+14 FROM staging_ref),(SELECT today+16 FROM staging_ref),2,0,0,800501,250.00,0.00,0.00,500.00,100.00,0.00,'USD',
        0,0.00,true,'VIP goodwill — service recovery',2,false,0.00,NULL,
        'fully_complimentary','paid',NULL,'CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,NULL,'Fully complimentary — GM approved','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '2 days'),
    -- Partial complimentary: 1 of 3 nights comped.
    (802118,'B-STG-1018',NULL,801001,'Aisha R.','aisha.rahman@staging.hotel-app.test','+60-12-600-1001',NULL::uuid,800317,
        (SELECT today+20 FROM staging_ref),(SELECT today+23 FROM staging_ref),2,0,0,800501,250.00,750.00,60.00,250.00,33.33,560.00,'USD',
        0,0.00,true,'Loyalty free-night redemption',1,false,0.00,NULL,
        'partial_complimentary','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'One night comped via loyalty reward','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '1 day'),
    -- Multi-guest family at capacity boundary (PRE max_occupancy = 4).
    (802119,'B-STG-1019',NULL,801007,'Fatimah A.','fatimah.abdullah@staging.hotel-app.test','+60-12-600-1007',NULL::uuid,800322,
        (SELECT today+12 FROM staging_ref),(SELECT today+15 FROM staging_ref),2,2,0,800501,550.00,1650.00,132.00,0.00,0.00,1782.00,'USD',
        1,180.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,'Extra bed + connecting room if available','Family of 4 at max occupancy','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '4 days'),
    -- OTA booking with commission math.
    (802120,'B-STG-1020',NULL,801009,'Diana L.','diana.lim@staging.hotel-app.test','+60-12-600-1009','80000000-0000-4000-8000-000000000001'::uuid,800312,
        (SELECT today+7 FROM staging_ref),(SELECT today+10 FROM staging_ref),2,0,0,800502,135.00,405.00,32.40,50.63,12.50,386.77,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid','company_billing','CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,NULL,'Bill to TechCorp; PO TC-2026-Q3 required','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '8 days'),
    (802121,'B-STG-1021',NULL,801013,'Tom H.','tom.hardy@staging.hotel-app.test','+61-400-000-013',NULL::uuid,800304,
        (SELECT today+8 FROM staging_ref),(SELECT today+11 FROM staging_ref),1,0,0,800501,90.00,270.00,21.60,0.00,0.00,291.60,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','paid','online_payment','OTA',NULL,NULL,
        NULL,NULL,false,false,NULL,NULL,'ota','Expedia',
        (SELECT id FROM booking_channels WHERE name='Expedia'),'EXP-9018271',18.00,52.49,239.11,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '11 days'),
    -- 30-night long stay (max-length coverage).
    (802122,'B-STG-1022',NULL,801008,'James O.','james.obrien@staging.hotel-app.test','+353-87-000-0008',NULL::uuid,800305,
        (SELECT today+20 FROM staging_ref),(SELECT today+50 FROM staging_ref),1,0,0,800504,72.00,2160.00,172.80,0.00,0.00,2332.80,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','partial','bank_transfer','CORP',NULL,NULL,
        NULL,NULL,false,false,'Long-stay rate agreed','30-night corporate long stay','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '25 days'),
    -- Same-room disjoint-window bookings (boundary adjacency, no overlap).
    (802123,'B-STG-1023',NULL,801012,'Sofia M.','sofia.mendoza@staging.hotel-app.test',NULL,NULL::uuid,800302,
        (SELECT today+10 FROM staging_ref),(SELECT today+11 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Adjacent to B-STG-1011 — same room, no overlap','phone','Phone',
        (SELECT id FROM booking_channels WHERE name='Phone'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '2 days'),
    -- Single-night minimum stay.
    (802124,'B-STG-1024',NULL,801018,'Daniel L.','daniel.lee@staging.hotel-app.test','+60-12-600-1018',NULL::uuid,800306,
        (SELECT today+1 FROM staging_ref),(SELECT today+2 FROM staging_ref),1,0,0,800501,90.00,90.00,7.20,0.00,0.00,97.20,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'Single-night minimum stay','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '6 hours'),
    -- High-value 10-night premier stay (large valid amount).
    (802125,'B-STG-1025',NULL,801006,'Chen W.','chen.wei@staging.hotel-app.test','+86-138-0000-0006','80000000-0000-4000-8000-000000000001'::uuid,800321,
        (SELECT today+15 FROM staging_ref),(SELECT today+25 FROM staging_ref),2,0,0,800502,495.00,4950.00,396.00,618.75,12.50,4727.25,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','partial','company_billing','CORP',801101,'TechCorp Solutions Sdn Bhd',
        NULL,NULL,false,false,NULL,'Large-amount fixture; partial prepayment received','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800001,CURRENT_TIMESTAMP-interval '18 days'),
    -- Zero-discount explicit and unpaid past stay (bad-debt coverage).
    (802126,'B-STG-1026',NULL,801011,'Ravi',NULL,'+60-12-600-1011',NULL::uuid,800307,
        (SELECT today+3 FROM staging_ref),(SELECT today+5 FROM staging_ref),1,0,0,800501,150.00,300.00,24.00,0.00,0.00,324.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'WKII',NULL,NULL,
        NULL,NULL,false,false,NULL,'Zero-discount fixture','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '1 day'),
    (802127,'B-STG-1027',NULL,801018,'Daniel L.','daniel.lee@staging.hotel-app.test','+60-12-600-1018',NULL::uuid,800310,
        (SELECT today-8 FROM staging_ref),(SELECT today-6 FROM staging_ref),1,0,0,800501,150.00,300.00,24.00,0.00,0.00,324.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'checked_out','unpaid',NULL,'WKII',NULL,NULL,
        (SELECT today-8 FROM staging_ref)::timestamptz+interval '16 hours',(SELECT today-6 FROM staging_ref)::timestamptz+interval '10 hours',false,false,
        NULL,'Left without settling — follow up for payment','walk_in','Walk-in',
        (SELECT id FROM booking_channels WHERE name='Walk-in'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '9 days'),
    -- Booking on the out-of-order / maintenance rooms (status preserved by the
    -- trigger's guard branch — realistic "booked but room offline" cases).
    (802128,'B-STG-1028',NULL,801004,'Kenji T.','kenji.takahashi@staging.hotel-app.test','+81-90-1234-0004',NULL::uuid,800324,
        (SELECT today+10 FROM staging_ref),(SELECT today+13 FROM staging_ref),2,0,0,800501,450.00,1350.00,108.00,0.00,0.00,1458.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Room under maintenance — relocate before arrival','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800002,CURRENT_TIMESTAMP-interval '2 days'),
    (802129,'B-STG-1029',NULL,801005,'Priya N.','priya.nair@staging.hotel-app.test','+91-98-4500-0005',NULL::uuid,800323,
        (SELECT today+15 FROM staging_ref),(SELECT today+18 FROM staging_ref),2,0,0,800501,450.00,1350.00,108.00,0.00,0.00,1458.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'confirmed','unpaid',NULL,'LEISURE',NULL,NULL,
        NULL,NULL,false,false,NULL,'Room out of order — engineering to confirm','ota','Agoda',
        (SELECT id FROM booking_channels WHERE name='Agoda'),'AGD-5577210',18.00,262.44,1195.56,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '3 days'),
    -- auto_checked_in (self check-in path) — in-house now.
    (802130,'B-STG-1030',NULL,801020,'Portal Guest','guest.portal@staging.hotel-app.test','+60-12-600-1020',NULL::uuid,800309,
        (SELECT today-1 FROM staging_ref),(SELECT today+2 FROM staging_ref),1,0,0,800501,150.00,450.00,36.00,0.00,0.00,486.00,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'auto_checked_in','paid','online_payment','DIRECT',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz+interval '9 hours',NULL,true,false,
        NULL,'Self check-in via portal; keycard dispensed','website','Direct Website',
        (SELECT id FROM booking_channels WHERE name='Direct Website'),NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800013,CURRENT_TIMESTAMP-interval '6 days'),
    -- Second pending_payment with an aging hold (created ~30h ago vs the 24h
    -- unpaid_hold_release_hours setting — the release scheduler candidate).
    (802131,'B-STG-1031',NULL,801019,'Daniel L.','daniel.leigh@staging.hotel-app.test','+60-16-600-1019',NULL::uuid,800305,
        (SELECT today+1 FROM staging_ref),(SELECT today+3 FROM staging_ref),1,0,0,800501,90.00,180.00,14.40,0.00,0.00,194.40,'USD',
        0,0.00,false,NULL,0,false,0.00,NULL,
        'pending_payment','unpaid',NULL,'OTA',NULL,NULL,
        NULL,NULL,false,false,NULL,'Aging unpaid hold — scheduler test candidate','ota','Trip.com',
        (SELECT id FROM booking_channels WHERE name='Trip.com'),'TRP-4488210',12.00,NULL,NULL,
        NULL,NULL,NULL,false,NULL,800003,CURRENT_TIMESTAMP-interval '30 hours'),
    -- Voided complimentary stay.
    (802132,'B-STG-1032',NULL,801001,'Aisha R.','aisha.rahman@staging.hotel-app.test','+60-12-600-1001',NULL::uuid,800316,
        (SELECT today+20 FROM staging_ref),(SELECT today+22 FROM staging_ref),2,0,0,800501,250.00,0.00,0.00,500.00,100.00,0.00,'USD',
        0,0.00,true,'Event sponsor comp',2,false,0.00,NULL,
        'comp_void','void',NULL,'EVENTS',NULL,NULL,
        NULL,NULL,false,false,NULL,'Sponsor pulled out — comp voided','direct','Direct',
        (SELECT id FROM booking_channels WHERE name='Direct'),NULL,NULL,NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz,800001,'Event cancelled by sponsor',false,NULL,800001,CURRENT_TIMESTAMP-interval '5 days')
) AS v(
    id, booking_number, folio_number, guest_id, guest_name, guest_email, guest_phone,
    corporate_account_id, room_id, check_in_date, check_out_date,
    adults, children, infants, rate_plan_id, room_rate, subtotal, tax_amount,
    discount_amount, discount_percentage, total_amount, currency,
    extra_bed_count, extra_bed_charge, is_complimentary, complimentary_reason,
    complimentary_nights, deposit_paid, deposit_amount, deposit_paid_at,
    status, payment_status, payment_method, market_code, company_id, company_name,
    actual_check_in, actual_check_out, early_check_in, late_check_out,
    special_requests, internal_notes, source, channel, booking_channel_id,
    ota_reference, commission_rate, commission_amount, net_revenue,
    cancelled_at, cancelled_by, cancellation_reason,
    is_posted, posted_date, created_by, created_at
);

-- Companion guests on the multi-guest family booking.
INSERT INTO public.booking_guests (id, booking_id, guest_id, first_name, last_name, age_group, is_primary)
OVERRIDING SYSTEM VALUE VALUES
    (803001, 802119, 801007, 'Fatimah', 'Abdullah', 'adult', true),
    (803002, 802119, NULL, 'Hassan', 'Abdullah', 'adult', false),
    (803003, 802119, NULL, 'Amira', 'Abdullah', 'child', false),
    (803004, 802119, NULL, 'Yusuf', 'Abdullah', 'child', false),
    (803005, 802101, 801001, 'Aisha', 'Rahman', 'adult', true);

-- Status trail for a representative slice of bookings.
INSERT INTO public.booking_history (booking_id, previous_status, new_status, changed_by, change_reason, metadata)
VALUES
    (802101, 'confirmed', 'checked_in', 800002, 'Front-desk check-in', '{"desk":"FD1"}'::jsonb),
    (802101, 'pending', 'confirmed', 800002, 'Deposit received', NULL),
    (802104, 'confirmed', 'checked_in', 800003, 'Front-desk check-in', NULL),
    (802104, 'checked_in', 'checked_out', 800002, 'Front-desk checkout', NULL),
    (802115, 'confirmed', 'voided', 800001, 'Guest requested cancellation — full refund', NULL),
    (802114, 'confirmed', 'no_show', 800003, 'Guest did not arrive', NULL),
    (802130, 'confirmed', 'auto_checked_in', NULL, 'Self check-in kiosk flow', '{"channel":"portal"}'::jsonb);

-- A date-change modification and a rate adjustment.
INSERT INTO public.booking_modifications (booking_id, modification_type, old_value, new_value, reason, price_adjustment, modified_by)
VALUES
    (802108, 'dates', '{"check_in":"+5","check_out":"+7"}'::jsonb, '{"check_in":"+5","check_out":"+8"}'::jsonb, 'Guest extended stay one night', 632.50, 800002),
    (802125, 'rate', '{"room_rate":550.00}'::jsonb, '{"room_rate":495.00}'::jsonb, 'Corporate rate applied after booking', -550.00, 800001);

-- One in-stay room move (guest 802101 was moved up a floor on arrival).
INSERT INTO public.room_changes (id, booking_id, from_room_id, to_room_id, guest_id, reason, changed_by)
OVERRIDING SYSTEM VALUE VALUES
    (806701, 802101, 800319, 800321, 801001, 'VIP upgrade to skyline corner suite', 800001);

-- ========================================================================
-- SERVICES CATALOG + booking services
-- ========================================================================
INSERT INTO public.services (id, name, category, description, unit_price, unit_type, tax_rate, is_taxable, is_active)
OVERRIDING SYSTEM VALUE VALUES
    (800401, 'Airport Transfer (KLIA)', 'transport', 'One-way sedan transfer to KLIA/KLIA2', 120.00, 'trip', 0.00, false, true),
    (800402, 'Breakfast Buffet',        'dining',    'Per-person halal buffet breakfast',     35.00,  'pax',  0.08, true,  true),
    (800403, 'Laundry — Wash & Fold',   'laundry',   'Per-bag same-day laundry',              25.00,  'bag',  0.08, true,  true),
    (800404, 'Minibar Restock',         'in_room',   'Premium minibar bundle',                60.00,  'item', 0.08, true,  true),
    (800405, 'Late Check-out (2pm)',    'front_desk','Extended checkout to 2pm',              50.00,  'item', 0.08, true,  true),
    (800406, 'Retired Service',         'legacy',    'Inactive catalog entry for filters',    10.00,  'item', 0.00, true,  false);

INSERT INTO public.booking_services (booking_id, service_id, quantity, unit_price, total_price, service_date, status, notes, created_by)
VALUES
    (802101, 800402, 2, 35.00, 70.00, (SELECT today FROM staging_ref)::timestamptz + interval '8 hours', 'completed', NULL, 800004),
    (802101, 800401, 1, 120.00, 120.00, (SELECT today + 2 FROM staging_ref)::timestamptz + interval '9 hours', 'pending', 'Departure transfer', 800002),
    (802102, 800402, 2, 35.00, 70.00, (SELECT today - 1 FROM staging_ref)::timestamptz + interval '8 hours', 'completed', 'Vegetarian covers', 800004),
    (802130, 800405, 1, 50.00, 50.00, (SELECT today + 2 FROM staging_ref)::timestamptz, 'pending', NULL, 800013),
    (802104, 800403, 2, 25.00, 50.00, (SELECT today - 1 FROM staging_ref)::timestamptz, 'completed', NULL, 800004),
    (802106, 800401, 1, 120.00, 120.00, (SELECT today FROM staging_ref)::timestamptz + interval '13 hours', 'in_progress', 'Arrival pickup — VIP', 800002);

\echo '[staging] 50 — payments, invoices, ledgers & vouchers...';
-- ============================================================================
-- 50 — FINANCE: PAYMENTS, INVOICES, CITY LEDGERS, VOUCHERS
-- ============================================================================
-- trg_sync_booking_payment_status recomputes bookings.payment_status on every
-- payment write: settled = completed payments of type booking/service/damage.
-- Amounts below therefore cover total_amount + tourism_tax + extra_bed_charge
-- exactly for 'paid' outcomes. 'refunded'/'unpaid_deposit' are app-set states
-- the trigger never emits, so those bookings get a final explicit UPDATE at the
-- end of this section (mirrors the refund flow, which writes payment_status
-- after recording the refund row).

-- ---- Bulk history payments: one completed payment per completed stay -------
INSERT INTO public.payments (
    id, booking_id, amount, currency, payment_method, payment_type,
    transaction_id, payment_gateway, status, processed_at, processed_by,
    idempotency_key, created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT
    804000 + (b.id - 802000),
    b.id,
    b.total_amount + b.tourism_tax_amount + COALESCE(b.extra_bed_charge, 0),
    'USD',
    (ARRAY['credit_card','cash','online_payment','ewallet','bank_transfer','debit_card'])[(b.id - 802000) % 6 + 1],
    'booking',
    'TXN-STG-' || lpad((b.id - 802000)::text, 5, '0'),
    'stripe',
    'completed',
    b.check_in_date::timestamptz - interval '2 days',
    800006,
    'stg-pay-' || lpad((b.id - 802000)::text, 5, '0'),
    800006,
    b.check_in_date::timestamptz - interval '2 days'
FROM public.bookings b
WHERE b.id BETWEEN 802001 AND 802045
ORDER BY b.id;

-- ---- Explicit payment scenarios --------------------------------------------
INSERT INTO public.payments (
    id, booking_id, amount, currency, payment_method, payment_type,
    transaction_id, card_last_four, card_brand, payment_gateway,
    status, failure_reason, refund_amount, refunded_at, refund_reason,
    gateway_refund_id, notes, processed_at, processed_by, idempotency_key,
    created_by, created_at
)
OVERRIDING SYSTEM VALUE VALUES
    -- 802101 in-house: keycard deposit (collateral — excluded from settlement)
    -- plus a partial room payment -> payment_status 'partial'.
    (804101, 802101, 50.00, 'USD', 'credit_card', 'deposit', 'TXN-STG-1010', '4242', 'visa', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Keycard deposit', (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours', 800002, 'stg-pay-dep-101', 800002, (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours'),
    (804102, 802101, 500.00, 'USD', 'credit_card', 'booking', 'TXN-STG-1011', '4242', 'visa', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Part payment at check-in', (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours', 800002, 'stg-pay-part-101', 800002, (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours'),
    -- 802102 in-house: fully settled online incl. tourism tax (30).
    (804103, 802102, 1812.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1012', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Full prepayment', (SELECT today-10 FROM staging_ref)::timestamptz, 800006, 'stg-pay-102', 800006, (SELECT today-10 FROM staging_ref)::timestamptz),
    -- 802104 checked out: room payment + keycard deposit + its refund row.
    (804104, 802104, 560.00, 'USD', 'credit_card', 'booking', 'TXN-STG-1013', '1005', 'mastercard', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-12 FROM staging_ref)::timestamptz, 800006, 'stg-pay-104', 800006, (SELECT today-12 FROM staging_ref)::timestamptz),
    (804105, 802104, 50.00, 'USD', 'credit_card', 'deposit', 'TXN-STG-1014', '1005', 'mastercard', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Keycard deposit', (SELECT today-2 FROM staging_ref)::timestamptz + interval '15 hours', 800002, 'stg-pay-dep-104', 800002, (SELECT today-2 FROM staging_ref)::timestamptz + interval '15 hours'),
    (804106, 802104, 50.00, 'USD', 'credit_card', 'refund', 'TXN-STG-1015', '1005', 'mastercard', 'stripe', 'refunded', NULL, NULL, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', NULL, 're_804106', 'Keycard deposit refund', (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', 800002, 'stg-pay-ref-104', 800002, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours'),
    -- 802105 checked out: ewallet settlement.
    (804107, 802105, 172.00, 'USD', 'ewallet', 'booking', 'TXN-STG-1016', NULL, NULL, 'ewallet_grabpay', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-6 FROM staging_ref)::timestamptz, 800006, 'stg-pay-105', 800006, (SELECT today-6 FROM staging_ref)::timestamptz),
    -- 802106 arriving today: corporate settlement.
    (804108, 802106, 1448.17, 'USD', 'company_billing', 'booking', 'PO-TC-2026-Q3-0001', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'TechCorp PO settlement', (SELECT today-2 FROM staging_ref)::timestamptz, 800006, 'stg-pay-106', 800006, (SELECT today-2 FROM staging_ref)::timestamptz),
    -- 802107 arriving today: part bank transfer.
    (804109, 802107, 270.00, 'USD', 'bank_transfer', 'booking', 'TT-STG-2201', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Half paid by transfer', (SELECT today-1 FROM staging_ref)::timestamptz, 800006, 'stg-pay-107', 800006, (SELECT today-1 FROM staging_ref)::timestamptz),
    -- 802109 future: fully prepaid advance-purchase.
    (804110, 802109, 1582.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1017', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Advance-purchase prepay', (SELECT today-16 FROM staging_ref)::timestamptz, 800006, 'stg-pay-109', 800006, (SELECT today-16 FROM staging_ref)::timestamptz),
    -- 802115 voided: original payment refunded in full.
    (804111, 802115, 516.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1018', NULL, NULL, 'stripe', 'refunded', NULL, 516.00, (SELECT today-1 FROM staging_ref)::timestamptz, 'Cancellation >48h — full refund', 're_804111', 'Full refund on void', (SELECT today-9 FROM staging_ref)::timestamptz, 800006, 'stg-pay-111', 800006, (SELECT today-9 FROM staging_ref)::timestamptz),
    -- 802116 completed: card settlement.
    (804112, 802116, 486.00, 'USD', 'credit_card', 'booking', 'TXN-STG-1019', '4343', 'visa', 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-11 FROM staging_ref)::timestamptz, 800006, 'stg-pay-112', 800006, (SELECT today-11 FROM staging_ref)::timestamptz),
    -- 802121 OTA paid online (incl. tourism tax 30).
    (804113, 802121, 321.60, 'USD', 'online_payment', 'booking', 'TXN-STG-1020', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, NULL, (SELECT today-11 FROM staging_ref)::timestamptz, 800006, 'stg-pay-113', 800006, (SELECT today-11 FROM staging_ref)::timestamptz),
    -- 802122 long stay: staged part payments (2 of 3 instalments).
    (804114, 802122, 1000.00, 'USD', 'bank_transfer', 'booking', 'TT-STG-2202', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Instalment 1 of 3', (SELECT today-20 FROM staging_ref)::timestamptz, 800006, 'stg-pay-114', 800006, (SELECT today-20 FROM staging_ref)::timestamptz),
    (804115, 802122, 700.00, 'USD', 'bank_transfer', 'booking', 'TT-STG-2203', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Instalment 2 of 3', (SELECT today-3 FROM staging_ref)::timestamptz, 800006, 'stg-pay-115', 800006, (SELECT today-3 FROM staging_ref)::timestamptz),
    -- 802125 high-value: partial company settlement.
    (804116, 802125, 2000.00, 'USD', 'company_billing', 'booking', 'PO-TC-2026-Q3-0002', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'TechCorp part settlement', (SELECT today-5 FROM staging_ref)::timestamptz, 800006, 'stg-pay-116', 800006, (SELECT today-5 FROM staging_ref)::timestamptz),
    -- 802130 portal stay: settled online.
    (804117, 802130, 486.00, 'USD', 'online_payment', 'booking', 'TXN-STG-1021', NULL, NULL, 'stripe', 'completed', NULL, NULL, NULL, NULL, NULL, 'Portal prepay', (SELECT today-6 FROM staging_ref)::timestamptz, 800006, 'stg-pay-117', 800006, (SELECT today-6 FROM staging_ref)::timestamptz),
    -- 802112 pending_payment hold: a failed card attempt (does not settle).
    (804118, 802112, 291.60, 'USD', 'online_payment', 'booking', 'TXN-STG-1022', '4002', 'visa', 'stripe', 'failed', 'card_declined', NULL, NULL, NULL, NULL, 'First attempt failed — retry link mailed', (SELECT today-4 FROM staging_ref)::timestamptz, NULL, 'stg-pay-118', 800006, (SELECT today-4 FROM staging_ref)::timestamptz),
    -- 802111 pending: gateway attempt still pending.
    (804119, 802111, 97.20, 'USD', 'online_payment', 'booking', 'TXN-STG-1023', NULL, NULL, 'stripe', 'pending', NULL, NULL, NULL, NULL, NULL, 'Awaiting gateway confirmation', CURRENT_TIMESTAMP - interval '2 hours', NULL, 'stg-pay-119', 800006, CURRENT_TIMESTAMP - interval '2 hours'),
    -- 802101 second partial payment scenario: service charge paid.
    (804120, 802101, 70.00, 'USD', 'cash', 'service', 'TXN-STG-1024', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Breakfast x2 settled at desk', (SELECT today FROM staging_ref)::timestamptz + interval '8 hours', 800002, 'stg-pay-120', 800002, (SELECT today FROM staging_ref)::timestamptz + interval '8 hours'),
    -- 802103 corporate in-house: partial direct-bill settlement.
    (804121, 802103, 400.00, 'USD', 'company_billing', 'booking', 'PO-GLX-0091', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Globex interim settlement', (SELECT today-1 FROM staging_ref)::timestamptz, 800006, 'stg-pay-121', 800006, (SELECT today-1 FROM staging_ref)::timestamptz),
    -- 802117 comp stay: guest settles the tourism tax only (foreign guest).
    (804122, 802117, 20.00, 'USD', 'cash', 'booking', 'TXN-STG-1025', NULL, NULL, NULL, 'completed', NULL, NULL, NULL, NULL, NULL, 'Tourism tax on comp stay', (SELECT today FROM staging_ref)::timestamptz - interval '1 day', 800002, 'stg-pay-122', 800002, (SELECT today FROM staging_ref)::timestamptz - interval '1 day');

-- Receipt-upload requests against two payments.
INSERT INTO public.payment_receipt_requests (payment_id, requested_by, request_message, requested_at, uploaded_at)
VALUES
    (804109, 800006, 'Please upload the bank transfer slip for reconciliation', (SELECT today-1 FROM staging_ref)::timestamptz, NULL),
    (804114, 800006, 'Receipt required for instalment 1', (SELECT today-19 FROM staging_ref)::timestamptz, (SELECT today-18 FROM staging_ref)::timestamptz);

-- One unconsumed retry capability for the failed payment on 802112.
INSERT INTO public.payment_retry_capabilities (id, booking_id, payment_id, token_hash, expires_at)
OVERRIDING SYSTEM VALUE VALUES
    (804301, 802112, 804118, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000001', (SELECT today+2 FROM staging_ref)::timestamptz);

-- ---- Invoices ---------------------------------------------------------------
INSERT INTO public.invoices (
    id, invoice_number, booking_id, bill_to_guest_id, bill_to_corporate_id,
    billing_name, billing_address, billing_email, tax_id,
    issue_date, due_date, subtotal, tax_amount, discount_amount, total_amount,
    paid_amount, currency, line_items, status, invoice_type,
    room_charges, service_charges, created_by, sent_at, paid_at, notes
)
OVERRIDING SYSTEM VALUE VALUES
    (804501, 'INV-2026-STG-001', 802101, 801001, NULL, 'Aisha Rahman', 'Kuala Lumpur', 'aisha.rahman@staging.hotel-app.test', NULL,
        (SELECT today-1 FROM staging_ref), (SELECT today+4 FROM staging_ref), 1720.00, 137.60, 82.50, 1775.10, 550.00, 'USD',
        '[{"description":"Premier Suite x 3 nights","quantity":3,"unit_price":550.00,"amount":1650.00},{"description":"Breakfast Buffet x2","quantity":2,"unit_price":35.00,"amount":70.00},{"description":"Service tax 8%","quantity":1,"unit_price":137.60,"amount":137.60},{"description":"Loyalty discount 5%","quantity":1,"unit_price":-82.50,"amount":-82.50}]'::jsonb,
        'issued', 'booking', 1650.00, 70.00, 800006, (SELECT today-1 FROM staging_ref)::timestamptz, NULL, 'Balance due at check-out'),
    (804502, 'INV-2026-STG-002', 802104, 801004, NULL, 'Kenji Takahashi', 'Osaka, Japan', 'kenji.takahashi@staging.hotel-app.test', NULL,
        (SELECT today-2 FROM staging_ref), (SELECT today FROM staging_ref), 590.00, 43.20, 0.00, 633.20, 633.20, 'USD',
        '[{"description":"Deluxe Room x 2 nights","quantity":2,"unit_price":250.00,"amount":500.00},{"description":"Laundry x2","quantity":2,"unit_price":25.00,"amount":50.00},{"description":"Service tax 8%","quantity":1,"unit_price":44.00,"amount":44.00},{"description":"Tourism tax x2 nights","quantity":2,"unit_price":10.00,"amount":20.00}]'::jsonb,
        'paid', 'booking', 500.00, 50.00, 800006, (SELECT today-2 FROM staging_ref)::timestamptz, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', NULL),
    (804503, 'INV-2026-STG-003', 802116, 801002, NULL, 'Marcus Tan', 'Petaling Jaya', 'marcus.tan@staging.hotel-app.test', NULL,
        (SELECT today-10 FROM staging_ref), (SELECT today-3 FROM staging_ref), 450.00, 36.00, 0.00, 486.00, 486.00, 'USD',
        '[{"description":"Standard Room x 3 nights","quantity":3,"unit_price":150.00,"amount":450.00},{"description":"Service tax 8%","quantity":1,"unit_price":36.00,"amount":36.00}]'::jsonb,
        'paid', 'booking', 450.00, 0.00, 800006, (SELECT today-10 FROM staging_ref)::timestamptz, (SELECT today-7 FROM staging_ref)::timestamptz, NULL),
    -- Overdue corporate invoice.
    (804504, 'INV-2026-STG-004', 802116, NULL, '80000000-0000-4000-8000-000000000002', 'Globex (Malaysia) Sdn Bhd', 'Suite 8, Wisma UOA, Kuala Lumpur', 'ap@globex.staging.hotel-app.test', 'C-GLBX-117',
        (SELECT today-40 FROM staging_ref), (SELECT today-10 FROM staging_ref), 2400.00, 192.00, 300.00, 2292.00, 0.00, 'USD',
        '[{"description":"Corporate stays — August block","quantity":8,"unit_price":300.00,"amount":2400.00},{"description":"Service tax 8%","quantity":1,"unit_price":192.00,"amount":192.00},{"description":"Contract discount 12.5%","quantity":1,"unit_price":-300.00,"amount":-300.00}]'::jsonb,
        'overdue', 'booking', 2400.00, 0.00, 800006, (SELECT today-40 FROM staging_ref)::timestamptz, NULL, 'Second reminder sent'),
    -- Draft invoice not yet issued.
    (804505, 'INV-2026-STG-005', 802103, NULL, '80000000-0000-4000-8000-000000000002', 'Globex (Malaysia) Sdn Bhd', 'Suite 8, Wisma UOA, Kuala Lumpur', 'ap@globex.staging.hotel-app.test', 'C-GLBX-117',
        (SELECT today FROM staging_ref), (SELECT today+30 FROM staging_ref), 900.00, 72.00, 112.50, 859.50, 0.00, 'USD',
        '[{"description":"Deluxe Room x 4 nights (corp rate)","quantity":4,"unit_price":225.00,"amount":900.00},{"description":"Service tax 8%","quantity":1,"unit_price":72.00,"amount":72.00},{"description":"Contract discount 12.5%","quantity":1,"unit_price":-112.50,"amount":-112.50}]'::jsonb,
        'draft', 'booking', 900.00, 0.00, 800006, NULL, NULL, 'Issue at checkout'),
    -- Voided invoice (raised in error then voided).
    (804506, 'INV-2026-STG-006', 802127, 801018, NULL, 'Daniel Lee', 'Kuala Lumpur', 'daniel.lee@staging.hotel-app.test', NULL,
        (SELECT today-6 FROM staging_ref), (SELECT today+1 FROM staging_ref), 300.00, 24.00, 0.00, 324.00, 0.00, 'USD',
        '[{"description":"Standard Room x 2 nights","quantity":2,"unit_price":150.00,"amount":300.00},{"description":"Service tax 8%","quantity":1,"unit_price":24.00,"amount":24.00}]'::jsonb,
        'void', 'booking', 300.00, 0.00, 800006, (SELECT today-6 FROM staging_ref)::timestamptz, NULL, 'Voided — rebilled under INV-2026-STG-007'),
    (804507, 'INV-2026-STG-007', 802127, 801018, NULL, 'Daniel Lee', 'Kuala Lumpur', 'daniel.lee@staging.hotel-app.test', NULL,
        (SELECT today-5 FROM staging_ref), (SELECT today+25 FROM staging_ref), 300.00, 24.00, 0.00, 324.00, 0.00, 'USD',
        '[{"description":"Standard Room x 2 nights","quantity":2,"unit_price":150.00,"amount":300.00},{"description":"Service tax 8%","quantity":1,"unit_price":24.00,"amount":24.00}]'::jsonb,
        'issued', 'booking', 300.00, 0.00, 800006, (SELECT today-5 FROM staging_ref)::timestamptz, NULL, 'Unpaid stay — collections follow-up'),
    -- Refunded invoice behind the voided booking.
    (804508, 'INV-2026-STG-008', 802115, 801003, NULL, 'Emily Wilson', 'London, UK', 'emily.wilson@staging.hotel-app.test', NULL,
        (SELECT today-9 FROM staging_ref), (SELECT today-2 FROM staging_ref), 450.00, 36.00, 0.00, 486.00, 486.00, 'USD',
        '[{"description":"Standard Room x 3 nights","quantity":3,"unit_price":150.00,"amount":450.00},{"description":"Service tax 8%","quantity":1,"unit_price":36.00,"amount":36.00}]'::jsonb,
        'refunded', 'booking', 450.00, 0.00, 800006, (SELECT today-9 FROM staging_ref)::timestamptz, (SELECT today-8 FROM staging_ref)::timestamptz, 'Fully refunded — booking voided');

-- ---- City ledgers (corporate direct-bill) -----------------------------------
-- folio_number / invoice_number are generated by ledger triggers when omitted.
INSERT INTO public.customer_ledgers (
    id, company_name, company_registration_number, contact_person, contact_email,
    description, expense_type, amount, currency, status, paid_amount,
    booking_id, guest_id, invoice_date, due_date, post_type, transaction_type,
    folio_type, posting_date, transaction_date, is_posted, posted_at, created_by
)
OVERRIDING SYSTEM VALUE VALUES
    (804801, 'TechCorp Solutions Sdn Bhd', 'SA-2011-00442', 'Diana Lim', 'ap@techcorp.staging.hotel-app.test',
        'Room charges — TechCorp September block', 'accommodation', 4800.00, 'MYR', 'partial', 2400.00,
        NULL, NULL, (SELECT today-20 FROM staging_ref), (SELECT today+10 FROM staging_ref), 'room_charge', 'debit',
        'city_ledger', (SELECT today-20 FROM staging_ref), (SELECT today-20 FROM staging_ref), true, (SELECT today-20 FROM staging_ref)::timestamptz + interval '23 hours', 800006),
    (804802, 'TechCorp Solutions Sdn Bhd', 'SA-2011-00442', 'Diana Lim', 'ap@techcorp.staging.hotel-app.test',
        'Payment received — TT TT-STG-3301', 'payment', 2400.00, 'MYR', 'paid', 2400.00,
        NULL, NULL, (SELECT today-8 FROM staging_ref), NULL, 'payment', 'credit',
        'city_ledger', (SELECT today-8 FROM staging_ref), (SELECT today-8 FROM staging_ref), true, (SELECT today-8 FROM staging_ref)::timestamptz, 800006),
    (804803, 'Globex (Malaysia) Sdn Bhd', 'SA-2009-00117', 'Harold Sim', 'travel@globex.staging.hotel-app.test',
        'Room charges — Globex August stays', 'accommodation', 6250.00, 'MYR', 'overdue', 0.00,
        NULL, NULL, (SELECT today-45 FROM staging_ref), (SELECT today-15 FROM staging_ref), 'room_charge', 'debit',
        'city_ledger', (SELECT today-45 FROM staging_ref), (SELECT today-45 FROM staging_ref), true, (SELECT today-45 FROM staging_ref)::timestamptz + interval '23 hours', 800006),
    (804804, 'Globex (Malaysia) Sdn Bhd', 'SA-2009-00117', 'Harold Sim', 'travel@globex.staging.hotel-app.test',
        'In-stay charges — B-STG-1003', 'accommodation', 859.50, 'MYR', 'pending', 0.00,
        802103, NULL,   (SELECT today FROM staging_ref), (SELECT today+45 FROM staging_ref), 'room_charge', 'debit',
        'city_ledger', (SELECT today FROM staging_ref), (SELECT today FROM staging_ref), false, NULL, 800006),
    -- One voided ledger entry (posted in error).
    (804805, 'Initech Events', 'SA-2019-00788', NULL, 'events@initech.staging.hotel-app.test',
        'Event deposit — voided duplicate', 'accommodation', 1500.00, 'MYR', 'void', 0.00,
        NULL, NULL, (SELECT today-30 FROM staging_ref), NULL, 'advance_deposit', 'debit',
        'city_ledger', (SELECT today-30 FROM staging_ref), (SELECT today-30 FROM staging_ref), false, NULL, 800006);

UPDATE public.customer_ledgers SET void_at = (SELECT today-29 FROM staging_ref)::timestamptz, void_by = 800006, void_reason = 'Duplicate posting' WHERE id = 804805;

INSERT INTO public.customer_ledger_payments (id, ledger_id, payment_amount, payment_method, payment_reference, payment_date, receipt_number, notes, processed_by)
OVERRIDING SYSTEM VALUE VALUES
    (804901, 804801, 2400.00, 'bank_transfer', 'TT-STG-3301', (SELECT today-8 FROM staging_ref)::timestamptz, 'RCP-STG-0001', 'Part settlement', 800006);

-- ---- Promotions the vouchers reference (marketing section adds campaigns) ---
INSERT INTO public.promotions (
    id, slug, name, description, terms, status, promotion_kind, discount_type,
    discount_value, max_discount_amount, currency, claim_starts_at, claim_ends_at,
    stay_starts_on, stay_ends_on, min_nights, max_nights, min_subtotal,
    claim_limit, claimed_count, per_guest_limit, is_public, is_cancellable,
    internal_code, objective, created_by, updated_by
)
OVERRIDING SYSTEM VALUE VALUES
    (807001, 'stg-weekend-15', 'Weekend Escape 15%', '15% off weekend stays (Fri-Sun).', 'Min 2 nights. Stays must start Fri or Sat.', 'published', 'deal', 'percentage', 15.00, 200.00, 'USD',
        (SELECT today-30 FROM staging_ref)::timestamptz, (SELECT today+60 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+90 FROM staging_ref), 2, 5, 200.00, 500, 37, 1, true, true, 'WKND15', 'occupancy', 800007, 800007),
    (807002, 'stg-member-voucher-20', 'Member Voucher RM20eq', 'Flat 20 off for loyalty members.', 'One per member. Public claimable.', 'published', 'voucher', 'fixed_amount', 20.00, NULL, 'USD',
        (SELECT today-15 FROM staging_ref)::timestamptz, (SELECT today+30 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+60 FROM staging_ref), 1, NULL, 50.00, 200, 12, 1, true, true, 'MBR20', 'loyalty', 800007, 800007),
    (807003, 'stg-corporate-10', 'Corporate Partner 10%', 'Corporate account partner rate.', 'Linked corporate accounts only.', 'published', 'deal', 'percentage', 10.00, NULL, 'USD',
        NULL, NULL, (SELECT today-90 FROM staging_ref), (SELECT today+180 FROM staging_ref), 1, NULL, 0.00, NULL, 64, 2, false, true, 'CORP10', 'retention', 800007, 800007),
    (807004, 'stg-merdeka-sale', 'Merdeka Flash Sale', 'Flash sale — ended.', 'Was live for 48h.', 'archived', 'deal', 'percentage', 30.00, 300.00, 'USD',
        (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-38 FROM staging_ref)::timestamptz,
        (SELECT today-30 FROM staging_ref), (SELECT today-10 FROM staging_ref), 1, 3, 100.00, 300, 300, 1, true, false, 'MDK30', 'acquisition', 800007, 800007),
    (807005, 'stg-paused-upsell', 'Suite Upsell Push', 'Paused pending rate review.', 'Internal only.', 'paused', 'deal', 'fixed_amount', 50.00, NULL, 'USD',
        (SELECT today-10 FROM staging_ref)::timestamptz, (SELECT today+20 FROM staging_ref)::timestamptz,
        (SELECT today+5 FROM staging_ref), (SELECT today+90 FROM staging_ref), 3, NULL, 800.00, 50, 3, 1, false, true, 'UPSL50', 'upsell', 800007, 800001),
    (807006, 'stg-cancelled-test', 'Cancelled Test Promo', 'Cancelled before launch.', NULL, 'cancelled', 'voucher', 'percentage', 25.00, NULL, 'USD',
        NULL, NULL, NULL, NULL, 1, NULL, 0.00, 10, 0, 1, false, true, 'CXL25', 'other', 800007, 800007),
    (807007, 'stg-draft-cny', 'CNY Early Bird (draft)', 'Draft — not yet published.', NULL, 'draft', 'deal', 'percentage', 18.00, 150.00, 'USD',
        NULL, NULL, (SELECT today+120 FROM staging_ref), (SELECT today+140 FROM staging_ref), 2, NULL, 300.00, 100, 0, 1, true, true, 'CNY18', 'occupancy', 800007, 800007),
    -- Edge states: published but claim window closed; published but claim
    -- limit reached; published voucher promo that is private (unclaimable by
    -- the public gallery but vouchers on it remain valid).
    (807008, 'stg-window-closed', 'Window Closed Voucher', 'Published but the claim window has closed.', 'Claim period ended.', 'published', 'voucher', 'percentage', 5.00, NULL, 'USD',
        (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-10 FROM staging_ref)::timestamptz,
        (SELECT today-30 FROM staging_ref), (SELECT today+30 FROM staging_ref), 1, NULL, 0.00, 100, 40, 1, true, true, 'WINC05', 'acquisition', 800007, 800007),
    (807009, 'stg-limit-reached', 'Limit Reached Voucher', 'Published but the claim limit is exhausted.', 'All claims taken.', 'published', 'voucher', 'fixed_amount', 10.00, NULL, 'USD',
        (SELECT today-20 FROM staging_ref)::timestamptz, (SELECT today+20 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+60 FROM staging_ref), 1, NULL, 0.00, 3, 3, 1, true, true, 'LIMT10', 'acquisition', 800007, 800007),
    (807010, 'stg-private-voucher', 'Private Voucher 20%', 'Published voucher promo hidden from the public gallery.', 'Invitation only.', 'published', 'voucher', 'percentage', 20.00, NULL, 'USD',
        (SELECT today-15 FROM staging_ref)::timestamptz, (SELECT today+45 FROM staging_ref)::timestamptz,
        (SELECT today FROM staging_ref), (SELECT today+90 FROM staging_ref), 1, NULL, 0.00, 50, 8, 1, false, true, 'PRIV20', 'retention', 800007, 800007);

INSERT INTO public.promotion_room_types (promotion_id, room_type_id) VALUES
    (807001, 800202), (807001, 800201),
    (807002, 800201),
    (807003, 800202), (807005, 800202),
    (807007, 800202), (807007, 800201);
INSERT INTO public.promotion_room_types (promotion_id, room_type_id)
SELECT 807001, id FROM public.room_types WHERE code IN ('DLX', 'STE');
INSERT INTO public.promotion_room_types (promotion_id, room_type_id)
SELECT 807002, id FROM public.room_types WHERE code IN ('STD', 'DLX');
INSERT INTO public.promotion_room_types (promotion_id, room_type_id)
SELECT 807003, id FROM public.room_types WHERE code IN ('DLX', 'STE');

INSERT INTO public.promotion_channels (promotion_id, booking_channel_id)
SELECT p.id, bc.id FROM public.promotions p CROSS JOIN public.booking_channels bc
WHERE p.id = 807001 AND bc.channel_type IN ('website', 'ota');
INSERT INTO public.promotion_channels (promotion_id, booking_channel_id)
SELECT 807002, id FROM public.booking_channels WHERE name IN ('Direct Website', 'Direct');

INSERT INTO public.promotion_loyalty_tiers (promotion_id, loyalty_tier_id)
SELECT 807002, t.id FROM public.loyalty_tiers t WHERE t.code IN ('gold', 'platinum');

-- ---- Vouchers & redemptions --------------------------------------------------
INSERT INTO public.vouchers (
    id, promotion_id, guest_id, code, status, source, expires_at,
    redeemed_at, revoked_at, revoked_by, revocation_reason, issued_by, claimed_at
)
OVERRIDING SYSTEM VALUE VALUES
    (805001, 807002, 801001, 'STG-VCH-0001', 'redeemed', 'guest_claim', (SELECT today+30 FROM staging_ref)::timestamptz,
        (SELECT today-10 FROM staging_ref)::timestamptz, NULL, NULL, NULL, NULL, (SELECT today-12 FROM staging_ref)::timestamptz),
    (805002, 807002, 801002, 'STG-VCH-0002', 'available', 'guest_claim', (SELECT today+30 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-5 FROM staging_ref)::timestamptz),
    (805003, 807002, 801003, 'STG-VCH-0003', 'available', 'admin_issue', (SELECT today+14 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, 800007, (SELECT today-3 FROM staging_ref)::timestamptz),
    (805004, 807002, 801016, 'STG-VCH-0004', 'revoked', 'admin_issue', (SELECT today+14 FROM staging_ref)::timestamptz,
        NULL, (SELECT today-2 FROM staging_ref)::timestamptz, 800001, 'Guest blacklisted — voucher revoked', 800007, (SELECT today-7 FROM staging_ref)::timestamptz),
    (805005, 807002, 801007, 'STG-VCH-0005', 'available', 'guest_claim', (SELECT today+2 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-30 FROM staging_ref)::timestamptz),
    -- Welcome voucher (seeded promotion) redeemed on a completed stay.
    (805006, (SELECT id FROM public.promotions WHERE slug = 'welcome-deluxe-10'), 801002, 'STG-WLC-0001', 'redeemed', 'guest_claim', (SELECT today-5 FROM staging_ref)::timestamptz,
        (SELECT today-11 FROM staging_ref)::timestamptz, NULL, NULL, NULL, NULL, (SELECT today-20 FROM staging_ref)::timestamptz),
    -- Claimed while the window was open; the promo's claim window has since
    -- closed (807008) — voucher itself remains valid.
    (805007, 807008, 801001, 'STG-VCH-0007', 'available', 'guest_claim', (SELECT today+20 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-25 FROM staging_ref)::timestamptz),
    -- Voucher on the private published promotion (807010).
    (805008, 807010, 801004, 'STG-VCH-0008', 'available', 'admin_issue', (SELECT today+30 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, 800007, (SELECT today-4 FROM staging_ref)::timestamptz),
    -- Claimed before the limit was hit on 807009.
    (805009, 807009, 801006, 'STG-VCH-0009', 'available', 'guest_claim', (SELECT today+15 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, NULL, (SELECT today-6 FROM staging_ref)::timestamptz),
    -- Status 'available' but expires_at already passed => derived "expired".
    (805010, 807002, 801005, 'STG-VCH-0010', 'available', 'admin_issue', (SELECT today-1 FROM staging_ref)::timestamptz,
        NULL, NULL, NULL, NULL, 800007, (SELECT today-15 FROM staging_ref)::timestamptz);

INSERT INTO public.voucher_redemptions (
    id, voucher_id, promotion_id, booking_id, guest_id, status,
    gross_subtotal, discount_type, discount_value, discount_amount, net_total,
    applied_by, applied_at
)
OVERRIDING SYSTEM VALUE VALUES
    (805101, 805001, 807002, 802116, 801002, 'applied',
        450.00, 'fixed_amount', 20.00, 20.00, 430.00, 800002, (SELECT today-11 FROM staging_ref)::timestamptz),
    (805102, 805006, (SELECT id FROM public.promotions WHERE slug = 'welcome-deluxe-10'), 802104, 801004, 'applied',
        500.00, 'percentage', 10.00, 50.00, 450.00, 800003, (SELECT today-11 FROM staging_ref)::timestamptz),
    -- Reversed redemption (guest rebooked, voucher returned).
    (805103, 805003, 807002, 802111, 801012, 'reversed',
        90.00, 'fixed_amount', 20.00, 20.00, 70.00, 800002, (SELECT today-2 FROM staging_ref)::timestamptz);

UPDATE public.voucher_redemptions
SET reversed_by = 800001, reversed_at = (SELECT today-1 FROM staging_ref)::timestamptz,
    reversal_reason = 'Booking dates changed — voucher released'
WHERE id = 805103;

INSERT INTO public.voucher_redemption_allocations (id, redemption_id, booking_id, stay_date, gross_amount, discount_amount, net_amount)
OVERRIDING SYSTEM VALUE VALUES
    (805201, 805102, 802104, (SELECT today-2 FROM staging_ref), 250.00, 25.00, 225.00),
    (805202, 805102, 802104, (SELECT today-1 FROM staging_ref), 250.00, 25.00, 225.00);

-- App-set payment statuses the trigger never emits.
UPDATE public.bookings SET payment_status = 'refunded' WHERE id = 802115;
UPDATE public.bookings SET payment_status = 'unpaid_deposit' WHERE id = 802114;

\echo '[staging] 60 — housekeeping, maintenance & night audit...';
-- ============================================================================
-- 60 — OPERATIONS
-- ============================================================================
-- Note: the dirty/cleaning rooms above already auto-created two housekeeping
-- rows via update_room_status(); these add the rest of the board.

INSERT INTO public.housekeeping_tasks (
    id, room_id, task_type, priority, status, assigned_to,
    scheduled_date, task_date, started_at, completed_at, notes, inspection_notes, created_by
)
OVERRIDING SYSTEM VALUE VALUES
    (806001, 800313, 'cleaning',   'high',   'in_progress', 800004, (SELECT today FROM staging_ref), (SELECT today FROM staging_ref), CURRENT_TIMESTAMP - interval '1 hour', NULL, 'Checkout clean — 701', NULL, 800005),
    (806002, 800307, 'cleaning',   'normal', 'pending',     800004, (SELECT today FROM staging_ref), (SELECT today FROM staging_ref), NULL, NULL, 'Checkout clean — 601', NULL, 800005),
    (806003, 800315, 'inspection', 'normal', 'pending',     NULL,     (SELECT today+1 FROM staging_ref), (SELECT today+1 FROM staging_ref), NULL, NULL, 'Pre-arrival inspection for 703 arrival', NULL, 800001),
    (806004, 800319, 'inspection', 'high',   'pending',     800005, (SELECT today FROM staging_ref), (SELECT today FROM staging_ref), NULL, NULL, 'VIP arrival inspection — 801', NULL, 800001),
    -- Overdue task: scheduled yesterday, still pending.
    (806005, 800304, 'cleaning',   'urgent', 'pending',     800005, (SELECT today-1 FROM staging_ref), (SELECT today-1 FROM staging_ref), NULL, NULL, 'Overdue — deep clean after long-stay checkout', NULL, 800005),
    (806006, 800310, 'cleaning',   'normal', 'completed',   800004, (SELECT today-2 FROM staging_ref), (SELECT today-2 FROM staging_ref), (SELECT today-2 FROM staging_ref)::timestamptz + interval '9 hours', (SELECT today-2 FROM staging_ref)::timestamptz + interval '10 hours', NULL, 'Inspected OK', 800005),
    (806007, 800321, 'turndown',   'normal', 'completed',   800004, (SELECT today-1 FROM staging_ref), (SELECT today-1 FROM staging_ref), (SELECT today-1 FROM staging_ref)::timestamptz + interval '19 hours', (SELECT today-1 FROM staging_ref)::timestamptz + interval '20 hours', 'Turndown for VIP in 801', NULL, 800005),
    (806008, 800306, 'inspection', 'low',    'void',        NULL,     (SELECT today-3 FROM staging_ref), (SELECT today-3 FROM staging_ref), NULL, NULL, 'Superseded by room move', NULL, 800001),
    (806009, 800306, 'cleaning',   'normal', 'in_progress', 800005, (SELECT today FROM staging_ref), (SELECT today FROM staging_ref), CURRENT_TIMESTAMP - interval '45 minutes', NULL, 'Mid-stay refresh — 506', NULL, 800005);

INSERT INTO public.maintenance_tickets (
    id, room_id, ticket_number, title, description, category, priority, status,
    assigned_to, reported_by, estimated_cost, actual_cost, estimated_hours, actual_hours,
    scheduled_date, started_at, resolved_at, resolution_notes, created_at
)
OVERRIDING SYSTEM VALUE VALUES
    (806101, 800324, 'MT-STG-0001', 'Elevator-shaft inspection (lift lobby)', 'Scheduled quarterly inspection affecting room 806.', 'preventive', 'medium', 'in_progress', 800008, 800001, 350.00, NULL, 6.00, NULL, (SELECT today+1 FROM staging_ref)::timestamptz, (SELECT today-1 FROM staging_ref)::timestamptz, NULL, NULL, (SELECT today-2 FROM staging_ref)::timestamptz),
    (806102, 800323, 'MT-STG-0002', 'Vanity water leak', 'Active leak behind vanity in 805; room out of order until parts arrive.', 'plumbing', 'critical', 'open', 800008, 800002, 480.00, NULL, 4.00, NULL, (SELECT today+2 FROM staging_ref)::timestamptz, NULL, NULL, NULL, (SELECT today-2 FROM staging_ref)::timestamptz),
    (806103, 800318, 'MT-STG-0003', 'Aircon rattle', 'Guest-reported rattling fan coil in 706 (see review 809604 context).', 'hvac', 'high', 'in_progress', 800008, 800004, 120.00, NULL, 1.50, NULL, (SELECT today FROM staging_ref)::timestamptz, (SELECT today FROM staging_ref)::timestamptz - interval '2 hours', NULL, NULL, (SELECT today-1 FROM staging_ref)::timestamptz),
    (806104, 800310, 'MT-STG-0004', 'Kettle replacement', 'Kettle failed PAT check.', 'electrical', 'low', 'resolved', 800008, 800004, 45.00, 42.50, 0.50, 0.50, (SELECT today-3 FROM staging_ref)::timestamptz, (SELECT today-3 FROM staging_ref)::timestamptz, (SELECT today-3 FROM staging_ref)::timestamptz + interval '1 hour', 'Replaced with stock unit; PAT passed.', (SELECT today-4 FROM staging_ref)::timestamptz),
    (806105, 800301, 'MT-STG-0005', 'Window latch loose', 'Latch loose; secure before next occupancy.', 'carpentry', 'medium', 'on_hold', 800008, 800003, 60.00, NULL, 1.00, NULL, (SELECT today+4 FROM staging_ref)::timestamptz, NULL, NULL, NULL, (SELECT today-5 FROM staging_ref)::timestamptz),
    (806106, NULL,   'MT-STG-0006', 'Lobby restroom tap', 'Gents lobby restroom tap dripping.', 'plumbing', 'low', 'closed', 800008, 800002, 30.00, 28.00, 0.50, 0.75, (SELECT today-6 FROM staging_ref)::timestamptz, (SELECT today-6 FROM staging_ref)::timestamptz, (SELECT today-6 FROM staging_ref)::timestamptz + interval '2 hours', 'Washer replaced.', (SELECT today-7 FROM staging_ref)::timestamptz);

-- Room events feed the room-activity timeline.
INSERT INTO public.room_events (id, room_id, event_type, status, priority, notes, scheduled_date, created_by)
OVERRIDING SYSTEM VALUE VALUES
    (806801, 800324, 'maintenance', 'maintenance', 'high', 'Elevator-shaft inspection window', (SELECT today+1 FROM staging_ref)::timestamptz, 800008),
    (806802, 800323, 'maintenance', 'out_of_order', 'urgent', 'Out of order pending leak repair', (SELECT today+2 FROM staging_ref)::timestamptz, 800008),
    (806803, 800319, 'inspection', NULL, 'high', 'VIP pre-arrival inspection', (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', 800001);

-- ---- Night audit history ----------------------------------------------------
-- 14 completed nightly runs plus one failed run for the audit log view.
INSERT INTO public.night_audit_runs (
    id, audit_date, run_at, run_by, status, total_bookings_posted,
    total_checkins, total_checkouts, total_revenue, total_rooms_occupied,
    total_rooms_available, occupancy_rate, rooms_available, rooms_occupied,
    rooms_reserved, rooms_maintenance, rooms_dirty,
    payment_method_breakdown, booking_channel_breakdown, notes
)
OVERRIDING SYSTEM VALUE
SELECT 806200 + d,
       (SELECT today FROM staging_ref) - d,
       ((SELECT today FROM staging_ref) - d)::timestamptz + interval '23 hours',
       800002,
       'completed',
       8 + (d % 4),
       4 + (d % 3),
       3 + (d % 5),
       5200.00 + (d % 7) * 640.25,
       12 + (d % 6),
       40, 62.50 + (d % 20),
       40 - 12 - (d % 6) - 4, 12 + (d % 6), 4, 2, 2,
       jsonb_build_object('credit_card', 2600 + (d % 7) * 300, 'cash', 1200 + (d % 5) * 150, 'online_payment', 800 + (d % 4) * 200, 'bank_transfer', 600 + (d % 3) * 120),
       jsonb_build_object('Direct', 4 + (d % 3), 'Booking.com', 3 + (d % 2), 'Direct Website', 2, 'Walk-in', 1 + (d % 2)),
       NULL
FROM generate_series(1, 13) AS d;

INSERT INTO public.night_audit_runs (
    id, audit_date, run_at, run_by, status, notes, error_message
)
OVERRIDING SYSTEM VALUE VALUES
    (806214, (SELECT today-14 FROM staging_ref), (SELECT today-14 FROM staging_ref)::timestamptz + interval '23 hours', 800002, 'failed', NULL, 'Transient failure — rerun manually via night audit tool');

-- Posted room nights for the most recent completed stays.
INSERT INTO public.night_audit_posted_nights (
    id, booking_id, audit_date, room_rate, room_charge, service_tax,
    tourism_tax, extra_bed_charge, total_posted, audit_run_id, posted_by
)
OVERRIDING SYSTEM VALUE
SELECT 806500 + ROW_NUMBER() OVER (ORDER BY b.id, n),
       b.id,
       b.check_in_date + n - 1,
       b.room_rate,
       b.room_rate,
       ROUND(b.room_rate * 0.08, 2),
       CASE WHEN b.is_tourist THEN 10.00 ELSE 0.00 END,
        0.00,
       b.room_rate + ROUND(b.room_rate * 0.08, 2) + CASE WHEN b.is_tourist THEN 10.00 ELSE 0.00 END,
       806200 + ((SELECT today FROM staging_ref) - (b.check_in_date + n - 1))::int,
       800002
FROM public.bookings b
CROSS JOIN LATERAL generate_series(1, b.nights) AS n
WHERE b.id BETWEEN 802001 AND 802045
  AND b.check_in_date + n - 1 < (SELECT today FROM staging_ref)
  AND b.check_in_date + n - 1 >= (SELECT today - 13 FROM staging_ref);

INSERT INTO public.night_audit_details (id, audit_run_id, booking_id, room_id, record_type, action, data)
OVERRIDING SYSTEM VALUE
SELECT 806300 + ROW_NUMBER() OVER (ORDER BY b.id),
       806200 + ((SELECT today FROM staging_ref) - b.check_out_date)::int,
       b.id, b.room_id, 'booking', 'posted',
       jsonb_build_object('booking_number', b.booking_number, 'total', b.total_amount)
FROM public.bookings b
WHERE b.id BETWEEN 802001 AND 802045
  AND b.check_out_date BETWEEN (SELECT today - 13 FROM staging_ref) AND (SELECT today - 1 FROM staging_ref);

-- Scheduler/background job history (marker-tagged for cleanup).
INSERT INTO public.job_runs (job_name, status, detail, duration_ms, created_at) VALUES
    ('night_audit', 'completed', '{"staging_seed":"v1","audit_date":"recent"}'::jsonb, 4210, (SELECT today-1 FROM staging_ref)::timestamptz + interval '23 hours'),
    ('unpaid_hold_release', 'completed', '{"staging_seed":"v1","released":0}'::jsonb, 180, (SELECT today FROM staging_ref)::timestamptz - interval '2 hours'),
    ('payment_receipts', 'completed', '{"staging_seed":"v1","sent":1}'::jsonb, 940, (SELECT today FROM staging_ref)::timestamptz - interval '3 hours');

\echo '[staging] 70 — marketing & communications...';
-- ============================================================================
-- 70 — MARKETING & COMMUNICATIONS
-- ============================================================================
-- (promotions + join tables were created in section 50 so vouchers could
-- reference them; this section adds the comms layer on top.)

INSERT INTO public.email_templates (
    id, code, name, subject, body_html, body_text, variables, is_active
)
OVERRIDING SYSTEM VALUE VALUES
    (807101, 'stg_booking_confirmation', 'Booking Confirmation', 'Your booking {{booking_number}} is confirmed', '<p>Dear {{guest_name}}, your stay at {{hotel_name}} is confirmed.</p>', 'Dear {{guest_name}}, your stay is confirmed.', '["guest_name","booking_number","hotel_name","check_in_date","check_out_date"]'::jsonb, true),
    (807102, 'stg_pre_arrival', 'Pre-Arrival Reminder', 'Your stay starts in 2 days — {{booking_number}}', '<p>We look forward to welcoming you, {{guest_name}}.</p>', 'We look forward to welcoming you, {{guest_name}}.', '["guest_name","booking_number","check_in_date"]'::jsonb, true),
    (807103, 'stg_checkout_receipt', 'Checkout Receipt', 'Receipt for booking {{booking_number}}', '<p>Thank you for staying with us.</p>', 'Thank you for staying with us.', '["guest_name","booking_number","total_amount"]'::jsonb, true),
    (807104, 'stg_retired_template', 'Retired Template', 'Legacy subject', '<p>Legacy</p>', 'Legacy', NULL, false);

INSERT INTO public.email_campaigns (
    id, name, campaign_type, topic, status, subject, body_html, body_text,
    template_id, promotion_id, segment_id, scheduled_at, started_at, completed_at,
    total_recipients, sent_count, failed_count, created_by
)
OVERRIDING SYSTEM VALUE VALUES
    -- Completed campaign that drove the voucher claims.
    (807201, 'Weekend Escape Launch', 'promotion', 'promotion', 'completed', 'This weekend only: 15% off', '<p>Book the Weekend Escape…</p>', 'Book the Weekend Escape…',
        807101, 807001, NULL, (SELECT today-25 FROM staging_ref)::timestamptz, (SELECT today-25 FROM staging_ref)::timestamptz, (SELECT today-25 FROM staging_ref)::timestamptz + interval '20 minutes', 84, 82, 2, 800007),
    -- Campaign with zero sends (no bookings / empty reach).
    (807202, 'Merdeka Flash Sale (ended)', 'promotion', 'promotion', 'completed', '48-hour flash sale', '<p>Flash sale…</p>', 'Flash sale…',
        NULL, 807004, NULL, (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-40 FROM staging_ref)::timestamptz, (SELECT today-40 FROM staging_ref)::timestamptz + interval '10 minutes', 0, 0, 0, 800007),
    -- Running campaign.
    (807203, 'Member Voucher Push', 'promotion', 'promotion', 'running', 'Your RM20 member voucher is here', '<p>Claim your voucher…</p>', 'Claim your voucher…',
        NULL, 807002, NULL, (SELECT today-15 FROM staging_ref)::timestamptz, (SELECT today-15 FROM staging_ref)::timestamptz, NULL, 120, 96, 4, 800007),
    -- Scheduled announcement.
    (807204, 'Pool Maintenance Notice', 'announcement', 'announcement', 'scheduled', 'Pool closed for maintenance — next week', '<p>Please note…</p>', 'Please note…',
        NULL, NULL, NULL, (SELECT today+3 FROM staging_ref)::timestamptz, NULL, NULL, 0, 0, 0, 800007),
    -- Draft.
    (807205, 'CNY Early Bird (draft)', 'promotion', 'promotion', 'draft', 'Celebrate CNY early', '<p>Draft…</p>', 'Draft…',
        NULL, 807007, NULL, NULL, NULL, NULL, 0, 0, 0, 800007),
    -- Failed campaign for the error view.
    (807206, 'Expedia Partner Blast', 'announcement', 'announcement', 'failed', 'Partner announcement', '<p>…</p>', '…',
        NULL, NULL, NULL, (SELECT today-8 FROM staging_ref)::timestamptz, (SELECT today-8 FROM staging_ref)::timestamptz, NULL, 0, 0, 0, 800007);
UPDATE public.email_campaigns SET error = 'SMTP provider rejected sender domain' WHERE id = 807206;

INSERT INTO public.email_deliveries (
    id, campaign_id, kind, guest_id, topic, recipient_email, subject, body_html,
    voucher_id, status, attempts, next_attempt_at, provider_message_id,
    idempotency_key, last_error, sent_at
)
OVERRIDING SYSTEM VALUE VALUES
    (807301, 807201, 'campaign', 801001, 'promotion', 'aisha.rahman@staging.hotel-app.test', 'This weekend only: 15% off', '<p>…</p>', NULL, 'sent', 1, (SELECT today-25 FROM staging_ref)::timestamptz, 'msg-stg-0001', 'stg-del-0001', NULL, (SELECT today-25 FROM staging_ref)::timestamptz + interval '1 minute'),
    (807302, 807201, 'campaign', 801002, 'promotion', 'marcus.tan@staging.hotel-app.test', 'This weekend only: 15% off', '<p>…</p>', NULL, 'sent', 1, (SELECT today-25 FROM staging_ref)::timestamptz, 'msg-stg-0002', 'stg-del-0002', NULL, (SELECT today-25 FROM staging_ref)::timestamptz + interval '1 minute'),
    (807303, 807201, 'campaign', 801018, 'promotion', 'daniel.lee@staging.hotel-app.test', 'This weekend only: 15% off', '<p>…</p>', NULL, 'failed', 5, (SELECT today-25 FROM staging_ref)::timestamptz + interval '1 hour', NULL, 'stg-del-0003', 'SMTP 550 mailbox unavailable', NULL),
    (807304, 807203, 'campaign', 801003, 'promotion', 'emily.wilson@staging.hotel-app.test', 'Your RM20 member voucher is here', '<p>…</p>', 805003, 'sent', 1, (SELECT today-15 FROM staging_ref)::timestamptz, 'msg-stg-0004', 'stg-del-0004', NULL, (SELECT today-15 FROM staging_ref)::timestamptz + interval '2 minutes'),
    (807305, 807203, 'campaign', 801016, 'promotion', 'alex.frost@staging.hotel-app.test', 'Your RM20 member voucher is here', '<p>…</p>', 805004, 'sent', 1, (SELECT today-15 FROM staging_ref)::timestamptz, 'msg-stg-0005', 'stg-del-0005', NULL, (SELECT today-15 FROM staging_ref)::timestamptz + interval '2 minutes'),
    (807306, NULL, 'booking_confirmation', 801006, 'booking_confirmation', 'chen.wei@staging.hotel-app.test', 'Your booking B-STG-1006 is confirmed', '<p>…</p>', NULL, 'sent', 1, (SELECT today-2 FROM staging_ref)::timestamptz, 'msg-stg-0006', 'stg-del-0006', NULL, (SELECT today-2 FROM staging_ref)::timestamptz + interval '1 minute'),
    (807307, NULL, 'pre_arrival_reminder', 801014, 'pre_arrival_reminder', 'lucy.kim@staging.hotel-app.test', 'Your stay starts in 2 days', '<p>…</p>', NULL, 'queued', 0, (SELECT today+3 FROM staging_ref)::timestamptz, NULL, 'stg-del-0007', NULL, NULL),
    (807308, NULL, 'checkout_receipt', 801004, 'checkout_receipt', 'kenji.takahashi@staging.hotel-app.test', 'Receipt for booking B-STG-1004', '<p>…</p>', NULL, 'sent', 1, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', 'msg-stg-0008', 'stg-del-0008', NULL, (SELECT today FROM staging_ref)::timestamptz + interval '10 hours'),
    -- Suppressed recipient (unsubscribed earlier — matches suppression row).
    (807309, 807203, 'campaign', 801019, 'promotion', 'daniel.leigh@staging.hotel-app.test', 'Your RM20 member voucher is here', '<p>…</p>', NULL, 'suppressed', 0, (SELECT today-15 FROM staging_ref)::timestamptz, NULL, 'stg-del-0009', 'Recipient suppressed', NULL);

INSERT INTO public.email_suppressions (id, email, reason, source, notes)
OVERRIDING SYSTEM VALUE VALUES
    (807401, 'daniel.leigh@staging.hotel-app.test', 'unsubscribe', 'guest_portal', 'Unsubscribed from marketing'),
    (807402, 'bounced.guest@staging.hotel-app.test', 'bounce', 'smtp_provider', 'Hard bounce 550'),
    (807403, 'complaint.guest@staging.hotel-app.test', 'complaint', 'smtp_provider', NULL);

\echo '[staging] 80 — loyalty, portal, notifications & audit...';
-- ============================================================================
-- 80 — LOYALTY, PORTAL, NOTIFICATIONS, AUDIT
-- ============================================================================

-- Members + accounts against the seeded loyalty program/tiers.
WITH prog AS (SELECT id FROM public.loyalty_programs ORDER BY id LIMIT 1),
     tier AS (SELECT id, code FROM public.loyalty_tiers)
INSERT INTO public.loyalty_members (id, guest_id, member_number, status, enrolled_at, closed_at)
OVERRIDING SYSTEM VALUE
SELECT 808000 + rn, guest_id, member_number, status, enrolled_at, closed_at FROM (VALUES
    (1, 801001, 'LM-STG-0001', 'active',    (SELECT today-200 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (2, 801002, 'LM-STG-0002', 'active',    (SELECT today-160 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (3, 801003, 'LM-STG-0003', 'active',    (SELECT today-120 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (4, 801006, 'LM-STG-0004', 'active',    (SELECT today-90  FROM staging_ref)::timestamptz, NULL::timestamptz),
    (5, 801009, 'LM-STG-0005', 'suspended', (SELECT today-300 FROM staging_ref)::timestamptz, NULL::timestamptz),
    (6, 801017, 'LM-STG-0006', 'closed',    (SELECT today-400 FROM staging_ref)::timestamptz, (SELECT today-30 FROM staging_ref)::timestamptz)
) v(rn, guest_id, member_number, status, enrolled_at, closed_at);

WITH tier AS (SELECT id, code FROM public.loyalty_tiers)
INSERT INTO public.loyalty_accounts (id, member_id, current_tier_id, lifetime_points, qualifying_points, qualifying_nights, qualifying_spend, tier_evaluation_year)
OVERRIDING SYSTEM VALUE
SELECT 808100 + v.rn, 808000 + v.rn, t.id, v.lifetime, v.qual_pts, v.qual_nights, v.qual_spend,
       EXTRACT(year FROM (SELECT today FROM staging_ref))::int
FROM (VALUES
    (1, 'gold',     12400, 6200, 18, 7400.00),
    (2, 'silver',    4300, 2100,  9, 2600.00),
    (3, 'platinum', 31200,14400, 34,18600.00),
    (4, 'gold',     18900, 8100, 22, 9800.00),
    (5, 'bronze',    1200,  400,  2,  520.00),
    (6, 'silver',    5600,    0, 14, 3900.00)
) v(rn, tier_code, lifetime, qual_pts, qual_nights, qual_spend)
JOIN tier t ON t.code = v.tier_code;

WITH prog AS (SELECT id FROM public.loyalty_programs ORDER BY id LIMIT 1),
     tier AS (SELECT id, code FROM public.loyalty_tiers)
INSERT INTO public.loyalty_memberships (id, guest_id, program_id, tier_id, member_number, points_balance, lifetime_points, status, enrolled_at, expires_at, last_activity_at)
OVERRIDING SYSTEM VALUE
SELECT 808200 + v.rn, v.guest_id, prog.id, t.id, v.member_number, v.balance, v.lifetime, v.status,
       v.enrolled_at, v.expires_at, v.last_activity_at
FROM (VALUES
    (1, 801001, 'LM-STG-0001', 1800, 12400, 'active',    (SELECT today-200 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-10 FROM staging_ref)::timestamptz, 'gold'::text),
    (2, 801002, 'LM-STG-0002',  640,  4300, 'active',    (SELECT today-160 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-11 FROM staging_ref)::timestamptz, 'silver'::text),
    (3, 801003, 'LM-STG-0003', 5200, 31200, 'active',    (SELECT today-120 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-2  FROM staging_ref)::timestamptz, 'platinum'::text),
    (4, 801006, 'LM-STG-0004', 2900, 18900, 'active',    (SELECT today-90  FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-1  FROM staging_ref)::timestamptz, 'gold'::text),
    (5, 801009, 'LM-STG-0005',  120,  1200, 'suspended', (SELECT today-300 FROM staging_ref)::timestamptz, NULL::timestamptz, (SELECT today-60 FROM staging_ref)::timestamptz, 'bronze'::text),
    (6, 801017, 'LM-STG-0006',    0,  5600, 'inactive',  (SELECT today-400 FROM staging_ref)::timestamptz, (SELECT today-30 FROM staging_ref)::timestamptz, (SELECT today-30 FROM staging_ref)::timestamptz, 'silver'::text)
) v(rn, guest_id, member_number, balance, lifetime, status, enrolled_at, expires_at, last_activity_at, tier_code)
CROSS JOIN prog
LEFT JOIN tier t ON t.code = v.tier_code;

-- Points ledger: earn on posted stays, a redemption, an adjustment, an expiry.
INSERT INTO public.loyalty_transactions (
    id, member_id, account_id, transaction_type, points_delta, available_delta,
    balance_after, source_type, source_id, booking_id, payment_id, invoice_id,
    description, actor_user_id, created_at
)
OVERRIDING SYSTEM VALUE VALUES
    (808301, 808001, 808101, 'earned',   486,  486,  486, 'booking', 802116, 802116, 804112, NULL, 'Points earned — B-STG-1016', NULL, (SELECT today-7 FROM staging_ref)::timestamptz),
    (808302, 808001, 808101, 'earned',   640,  640, 1126, 'booking', 802101, 802101, 804102, NULL, 'Points earned — B-STG-1001', NULL, (SELECT today-1 FROM staging_ref)::timestamptz),
    (808303, 808001, 808101, 'redeemed', -500, -500,  626, 'reward',  NULL, NULL,   NULL,   NULL, 'Redeemed — free-night voucher', 800002, (SELECT today-5 FROM staging_ref)::timestamptz),
    (808304, 808002, 808102, 'earned',   486,  486,  486, 'booking', 802116, 802116, 804112, 804503, 'Points earned — B-STG-1016', NULL, (SELECT today-7 FROM staging_ref)::timestamptz),
    (808305, 808002, 808102, 'adjusted',  154,  154,  640, 'manual',  NULL, NULL,   NULL,   NULL, 'Goodwill adjustment — service issue', 800001, (SELECT today-3 FROM staging_ref)::timestamptz),
    (808306, 808003, 808103, 'earned',  1720, 1720, 1720, 'booking', 802102, 802102, 804103, NULL, 'Points earned — B-STG-1002', NULL, (SELECT today-2 FROM staging_ref)::timestamptz),
    (808307, 808004, 808104, 'expired', -300, -300,  2600, 'expiry',  NULL, NULL,   NULL,   NULL, 'Points expired — 24-month rule', NULL, (SELECT today-10 FROM staging_ref)::timestamptz),
    (808308, 808006, 808106, 'reversed', -5600, -5600, 0, 'closure', NULL, NULL,   NULL,   NULL, 'Balance cleared on membership close', 800001, (SELECT today-30 FROM staging_ref)::timestamptz);

-- Reward catalog + redemptions (pending/approved/rejected).
INSERT INTO public.loyalty_rewards (id, name, description, category, points_cost, requires_approval, is_active)
OVERRIDING SYSTEM VALUE VALUES
    (808401, 'Free Night — Standard', 'One free night in a Standard room', 'free_night', 2000, true, true),
    (808402, 'RM50 F&B Voucher',     'Fifty ringgit food & beverage credit', 'voucher',   800, false, true),
    (808403, 'Suite Upgrade',        'One-category upgrade, subject to availability', 'upgrade', 1500, true, true);

INSERT INTO public.loyalty_redemptions (id, member_id, reward_id, transaction_id, points_spent, status, requested_at, reviewed_by, reviewed_at, rejection_reason)
OVERRIDING SYSTEM VALUE VALUES
    (808501, 808001, 808401, 808303, 500, 'approved', (SELECT today-6 FROM staging_ref)::timestamptz, 800001, (SELECT today-5 FROM staging_ref)::timestamptz, NULL),
    (808502, 808003, 808402, NULL,   800, 'pending',  (SELECT today-1 FROM staging_ref)::timestamptz, NULL, NULL, NULL),
    (808503, 808002, 808403, NULL,  1500, 'rejected', (SELECT today-9 FROM staging_ref)::timestamptz, 800001, (SELECT today-8 FROM staging_ref)::timestamptz, 'Insufficient qualifying nights for upgrade reward');

-- Complimentary-night credits on the guest profile.
INSERT INTO public.guest_complimentary_credits (id, guest_id, room_type_id, nights_available, notes)
OVERRIDING SYSTEM VALUE VALUES
    (808601, 801001, 800202, 2, 'VIP goodwill — two premier nights'),
    (808602, 801006, 800201, 1, 'Service recovery credit');

-- Guest-portal sessions (token hashes only, never raw tokens).
INSERT INTO public.guest_portal_sessions (id, guest_id, token_hash, expires_at, last_used_at)
OVERRIDING SYSTEM VALUE VALUES
    (808701, 801020, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000010', (SELECT today+7 FROM staging_ref)::timestamptz, (SELECT today-1 FROM staging_ref)::timestamptz + interval '9 hours'),
    (808702, 801014, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000011', (SELECT today+7 FROM staging_ref)::timestamptz, NULL),
    (808703, 801001, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000012', (SELECT today-3 FROM staging_ref)::timestamptz, (SELECT today-4 FROM staging_ref)::timestamptz),
    -- Known-token session for direct portal API checks: Bearer
    -- `stg-portal-token-a` (the hash below is its real sha256 digest).
    (808704, 801002, encode(sha256('stg-portal-token-a'::bytea), 'hex'), (SELECT today+1 FROM staging_ref)::timestamptz, NULL);

-- Staff notifications (+ read markers).
INSERT INTO public.staff_notifications (id, audience_permission, kind, subject, title, body, created_at)
OVERRIDING SYSTEM VALUE VALUES
    (808801, 'bookings:read', 'booking', 'B-STG-1012', 'Unpaid online hold aging', 'Booking B-STG-1012 has an unpaid hold approaching the 24h release window.', (SELECT today-4 FROM staging_ref)::timestamptz),
    (808802, 'housekeeping:read', 'housekeeping', NULL, 'Overdue housekeeping task', 'Deep clean of room 405 was due yesterday.', (SELECT today-1 FROM staging_ref)::timestamptz),
    (808803, 'maintenance:read', 'maintenance', 'MT-STG-0002', 'Critical ticket open: Vanity water leak', 'Room 805 is out of order pending leak repair.', (SELECT today-2 FROM staging_ref)::timestamptz),
    (808804, 'payments:read', 'payment', 'B-STG-1012', 'Payment failed — card declined', 'Guest was sent a retry link for booking B-STG-1012.', (SELECT today-4 FROM staging_ref)::timestamptz),
    (808805, 'bookings:read', 'booking', 'B-STG-1014', 'No-show recorded', 'Booking B-STG-1014 marked no-show; deposit forfeited.', (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours');

INSERT INTO public.staff_notification_reads (notification_id, user_id, read_at) VALUES
    (808801, 800002, (SELECT today-4 FROM staging_ref)::timestamptz + interval '30 minutes'),
    (808801, 800003, (SELECT today-4 FROM staging_ref)::timestamptz + interval '45 minutes'),
    (808802, 800004, (SELECT today-1 FROM staging_ref)::timestamptz + interval '2 hours'),
    (808804, 800006, (SELECT today-4 FROM staging_ref)::timestamptz + interval '1 hour');

-- Audit trail (partitioned by month — ensure partitions exist first).
SELECT public.ensure_audit_logs_partition(date_trunc('month', (SELECT today FROM staging_ref))::date);
SELECT public.ensure_audit_logs_partition(date_trunc('month', (SELECT today FROM staging_ref) - interval '1 month')::date);

-- audit_logs is append-only: rows can never be deleted or updated, and the
-- users delete in the cleanup section fires ON DELETE SET NULL against it.
-- So audit rows must reference the bootstrap admin (which survives reruns) and
-- are marker-guarded by id so a rerun inserts nothing.
INSERT INTO public.audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
OVERRIDING SYSTEM VALUE
SELECT v.* FROM (VALUES
    (808901, (SELECT id FROM users WHERE username='admin'), 'booking.update',    'booking', 802101, '{"staging_seed":"v1","actor":"manager_stg","field":"room","old":800319,"new":800321}'::jsonb, '203.0.113.10'::inet, 'hotel-web/staging', (SELECT today-1 FROM staging_ref)::timestamptz + interval '15 hours'),
    (808902, (SELECT id FROM users WHERE username='admin'), 'payment.create',    'payment', 804102, '{"staging_seed":"v1","actor":"frontdesk_amy","amount":500.00,"method":"credit_card"}'::jsonb, '203.0.113.11'::inet, 'hotel-web/staging', (SELECT today-1 FROM staging_ref)::timestamptz + interval '6 hours'),
    (808903, (SELECT id FROM users WHERE username='admin'), 'invoice.issue',     'invoice', 804501, '{"staging_seed":"v1","actor":"finance_mei","invoice_number":"INV-2026-STG-001"}'::jsonb, '203.0.113.12'::inet, 'hotel-web/staging', (SELECT today-1 FROM staging_ref)::timestamptz + interval '16 hours'),
    (808904, (SELECT id FROM users WHERE username='admin'), 'booking.void',      'booking', 802115, '{"staging_seed":"v1","actor":"manager_stg","reason":"Guest requested cancellation — full refund"}'::jsonb, '203.0.113.10'::inet, 'hotel-web/staging', (SELECT today-1 FROM staging_ref)::timestamptz),
    (808905, (SELECT id FROM users WHERE username='admin'), 'campaign.launch',   'campaign', 807203, '{"staging_seed":"v1","actor":"marketing_nadia","name":"Member Voucher Push"}'::jsonb, '203.0.113.13'::inet, 'hotel-web/staging', (SELECT today-15 FROM staging_ref)::timestamptz),
    (808906, (SELECT id FROM users WHERE username='admin'), 'guest.blacklist',   'guest',   801016, '{"staging_seed":"v1","actor":"manager_stg","reason":"Chargeback fraud attempt"}'::jsonb, '203.0.113.10'::inet, 'hotel-web/staging', (SELECT today-2 FROM staging_ref)::timestamptz),
    (808907, (SELECT id FROM users WHERE username='admin'), 'maintenance.update','maintenance', 806102, '{"staging_seed":"v1","actor":"staff_razak","status":"open"}'::jsonb, '203.0.113.14'::inet, 'hotel-web/staging', (SELECT today-2 FROM staging_ref)::timestamptz),
    (808908, (SELECT id FROM users WHERE username='admin'), 'auth.login',        'user',    800003, '{"staging_seed":"v1","actor":"frontdesk_bala","method":"password"}'::jsonb, '203.0.113.15'::inet, 'hotel-web/staging', (SELECT today FROM staging_ref)::timestamptz - interval '3 hours'),
    (808909, (SELECT id FROM users WHERE username='admin'), 'settings.update',   'system_settings', NULL, '{"staging_seed":"v1","actor":"manager_stg","key":"unpaid_hold_release_hours","old":36,"new":24}'::jsonb, '203.0.113.10'::inet, 'hotel-web/staging', (SELECT today-9 FROM staging_ref)::timestamptz),
    (808910, NULL, 'portal.self_checkin','booking', 802130, '{"staging_seed":"v1","actor":"guest_portal","channel":"portal"}'::jsonb, '198.51.100.20'::inet, 'guest-portal/staging', (SELECT today-1 FROM staging_ref)::timestamptz + interval '9 hours')
) AS v(id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
WHERE NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.id = v.id);

\echo '[staging] 90 — sequence resync + summary...';
-- ============================================================================
-- 90 — SEQUENCE RESYNC & SUMMARY
-- ============================================================================
-- Staging rows are inserted with OVERRIDING SYSTEM VALUE into GENERATED ALWAYS
-- identity columns, so the identity sequences never see them. Resync every
-- sequence we touched so the app can still INSERT at runtime. Sequences live
-- below the staging band (which starts at 800000), so max(seq, 800000) is safe.

SELECT pg_catalog.setval('public.users_id_seq', GREATEST((SELECT MAX(id) FROM public.users), 800000), true);
SELECT pg_catalog.setval('public.teams_id_seq', GREATEST((SELECT MAX(id) FROM public.teams), 800000), true);
SELECT pg_catalog.setval('public.room_types_id_seq', GREATEST((SELECT MAX(id) FROM public.room_types), 800000), true);
SELECT pg_catalog.setval('public.rooms_id_seq', GREATEST((SELECT MAX(id) FROM public.rooms), 800000), true);
SELECT pg_catalog.setval('public.rate_plans_id_seq', GREATEST((SELECT MAX(id) FROM public.rate_plans), 800000), true);
SELECT pg_catalog.setval('public.room_rates_id_seq', GREATEST((SELECT MAX(id) FROM public.room_rates), 800000), true);
SELECT pg_catalog.setval('public.guests_id_seq', GREATEST((SELECT MAX(id) FROM public.guests), 800000), true);
SELECT pg_catalog.setval('public.companies_id_seq', GREATEST((SELECT MAX(id) FROM public.companies), 800000), true);
SELECT pg_catalog.setval('public.corporate_account_contacts_id_seq', GREATEST((SELECT MAX(id) FROM public.corporate_account_contacts), 800000), true);
SELECT pg_catalog.setval('public.bookings_id_seq', GREATEST((SELECT MAX(id) FROM public.bookings), 800000), true);
SELECT pg_catalog.setval('public.booking_guests_id_seq', GREATEST((SELECT MAX(id) FROM public.booking_guests), 800000), true);
SELECT pg_catalog.setval('public.services_id_seq', GREATEST((SELECT MAX(id) FROM public.services), 800000), true);
SELECT pg_catalog.setval('public.payments_id_seq', GREATEST((SELECT MAX(id) FROM public.payments), 800000), true);
SELECT pg_catalog.setval('public.invoices_id_seq', GREATEST((SELECT MAX(id) FROM public.invoices), 800000), true);
SELECT pg_catalog.setval('public.customer_ledgers_id_seq', GREATEST((SELECT MAX(id) FROM public.customer_ledgers), 800000), true);
SELECT pg_catalog.setval('public.customer_ledger_payments_id_seq', GREATEST((SELECT MAX(id) FROM public.customer_ledger_payments), 800000), true);
SELECT pg_catalog.setval('public.promotions_id_seq', GREATEST((SELECT MAX(id) FROM public.promotions), 800000), true);
SELECT pg_catalog.setval('public.vouchers_id_seq', GREATEST((SELECT MAX(id) FROM public.vouchers), 800000), true);
SELECT pg_catalog.setval('public.voucher_redemptions_id_seq', GREATEST((SELECT MAX(id) FROM public.voucher_redemptions), 800000), true);
SELECT pg_catalog.setval('public.voucher_redemption_allocations_id_seq', GREATEST((SELECT MAX(id) FROM public.voucher_redemption_allocations), 800000), true);
SELECT pg_catalog.setval('public.housekeeping_tasks_id_seq', GREATEST((SELECT MAX(id) FROM public.housekeeping_tasks), 800000), true);
SELECT pg_catalog.setval('public.maintenance_tickets_id_seq', GREATEST((SELECT MAX(id) FROM public.maintenance_tickets), 800000), true);
SELECT pg_catalog.setval('public.room_events_id_seq', GREATEST((SELECT MAX(id) FROM public.room_events), 800000), true);
SELECT pg_catalog.setval('public.night_audit_runs_id_seq', GREATEST((SELECT MAX(id) FROM public.night_audit_runs), 800000), true);
SELECT pg_catalog.setval('public.night_audit_details_id_seq', GREATEST((SELECT MAX(id) FROM public.night_audit_details), 800000), true);
SELECT pg_catalog.setval('public.night_audit_posted_nights_id_seq', GREATEST((SELECT MAX(id) FROM public.night_audit_posted_nights), 800000), true);
SELECT pg_catalog.setval('public.email_templates_id_seq', GREATEST((SELECT MAX(id) FROM public.email_templates), 800000), true);
SELECT pg_catalog.setval('public.email_campaigns_id_seq', GREATEST((SELECT MAX(id) FROM public.email_campaigns), 800000), true);
SELECT pg_catalog.setval('public.email_deliveries_id_seq', GREATEST((SELECT MAX(id) FROM public.email_deliveries), 800000), true);
SELECT pg_catalog.setval('public.email_suppressions_id_seq', GREATEST((SELECT MAX(id) FROM public.email_suppressions), 800000), true);
SELECT pg_catalog.setval('public.loyalty_members_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_members), 800000), true);
SELECT pg_catalog.setval('public.loyalty_accounts_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_accounts), 800000), true);
SELECT pg_catalog.setval('public.loyalty_memberships_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_memberships), 800000), true);
SELECT pg_catalog.setval('public.loyalty_transactions_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_transactions), 800000), true);
SELECT pg_catalog.setval('public.loyalty_rewards_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_rewards), 800000), true);
SELECT pg_catalog.setval('public.loyalty_redemptions_id_seq', GREATEST((SELECT MAX(id) FROM public.loyalty_redemptions), 800000), true);
SELECT pg_catalog.setval('public.guest_complimentary_credits_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_complimentary_credits), 800000), true);
SELECT pg_catalog.setval('public.guest_portal_sessions_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_portal_sessions), 800000), true);
SELECT pg_catalog.setval('public.payment_retry_capabilities_id_seq', GREATEST((SELECT MAX(id) FROM public.payment_retry_capabilities), 800000), true);
SELECT pg_catalog.setval('public.room_changes_id_seq', GREATEST((SELECT MAX(id) FROM public.room_changes), 800000), true);
SELECT pg_catalog.setval('public.guest_notes_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_notes), 800000), true);
SELECT pg_catalog.setval('public.guest_documents_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_documents), 800000), true);
SELECT pg_catalog.setval('public.guest_reviews_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_reviews), 800000), true);
SELECT pg_catalog.setval('public.guest_segments_id_seq', GREATEST((SELECT MAX(id) FROM public.guest_segments), 800000), true);
SELECT pg_catalog.setval('public.user_guests_id_seq', GREATEST((SELECT MAX(id) FROM public.user_guests), 800000), true);
SELECT pg_catalog.setval('public.notification_subscriptions_id_seq', GREATEST((SELECT MAX(id) FROM public.notification_subscriptions), 800000), true);
SELECT pg_catalog.setval('public.notification_consent_events_id_seq', GREATEST((SELECT MAX(id) FROM public.notification_consent_events), 800000), true);
SELECT pg_catalog.setval('public.consent_records_id_seq', GREATEST((SELECT MAX(id) FROM public.consent_records), 800000), true);
SELECT pg_catalog.setval('public.staff_notifications_id_seq', GREATEST((SELECT MAX(id) FROM public.staff_notifications), 800000), true);
SELECT pg_catalog.setval('public.amenities_id_seq', GREATEST((SELECT MAX(id) FROM public.amenities), 800000), true);
SELECT pg_catalog.setval('public.audit_logs_id_seq1', GREATEST((SELECT MAX(id) FROM public.audit_logs), 800000), true);

-- ---- Final summary ---------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE 'staging seed complete — ref_date %', (SELECT today FROM staging_ref);
    FOR r IN
        SELECT 'users' AS label, COUNT(*)::text AS n FROM public.users WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'rooms',              COUNT(*)::text FROM public.rooms              WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'guests',             COUNT(*)::text FROM public.guests             WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'bookings',           COUNT(*)::text FROM public.bookings           WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'payments',           COUNT(*)::text FROM public.payments           WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'invoices',           COUNT(*)::text FROM public.invoices           WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'promotions',         COUNT(*)::text FROM public.promotions         WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'vouchers',           COUNT(*)::text FROM public.vouchers           WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'housekeeping_tasks', COUNT(*)::text FROM public.housekeeping_tasks WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'maintenance_tickets',COUNT(*)::text FROM public.maintenance_tickets WHERE id BETWEEN 800000 AND 899999
        UNION ALL SELECT 'loyalty_members',    COUNT(*)::text FROM public.loyalty_members    WHERE id BETWEEN 800000 AND 899999
    LOOP
        RAISE NOTICE '  %: %', rpad(r.label, 22), r.n;
    END LOOP;
END $$;

COMMIT;

\echo '[staging] done.';
