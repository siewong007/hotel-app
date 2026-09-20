//! Core foundation: staff users + RBAC + teams, room inventory + rates, and
//! the guest/CRM base every other section references. Ported from staging.sql
//! §10/§20/§30, plus two users staging lacked: `admin_stg` and `super_stg` —
//! the bootstrap admin/superadmin accounts ship a non-recoverable placeholder
//! password, so a dev login for those roles has to come from here.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL_USERS).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_INVENTORY).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_GUESTS).execute(&mut **tx).await?;
    sqlx::raw_sql(SQL_CRM).execute(&mut **tx).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Organization & access — every user shares the development-only password
// `HotelStaging2026!` (bcrypt, cost 12). Never reuse outside dev.
// ---------------------------------------------------------------------------
const SQL_USERS: &str = r#"
INSERT INTO public.users (
    id, username, email, password_hash, full_name, phone,
    user_type, is_active, is_verified, is_locked, failed_login_attempts,
    is_super_admin, last_login_at, created_at
)
OVERRIDING SYSTEM VALUE
VALUES
    (800001, 'manager_stg',    'manager.stg@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Maya Krishnan',   '+60-12-555-0101', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '2 hours',   CURRENT_TIMESTAMP - interval '90 days'),
    (800002, 'frontdesk_amy',  'frontdesk.amy@staging.hotel-app.test',  '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Amy Tan',         '+60-12-555-0102', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '30 minutes', CURRENT_TIMESTAMP - interval '88 days'),
    (800003, 'frontdesk_bala', 'frontdesk.bala@staging.hotel-app.test', '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Bala Subramaniam','+60-12-555-0103', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '1 day',      CURRENT_TIMESTAMP - interval '88 days'),
    (800004, 'hk_siti',        'hk.siti@staging.hotel-app.test',        '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Siti Rahayu',     '+60-12-555-0104', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '4 hours',    CURRENT_TIMESTAMP - interval '80 days'),
    (800005, 'hk_kumar',       'hk.kumar@staging.hotel-app.test',       '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Kumar Velu',      '+60-12-555-0105', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '1 day',      CURRENT_TIMESTAMP - interval '80 days'),
    (800006, 'finance_mei',    'finance.mei@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Mei Lin Chong',   '+60-12-555-0106', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '3 hours',    CURRENT_TIMESTAMP - interval '75 days'),
    (800007, 'marketing_nadia','marketing.nadia@staging.hotel-app.test','$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Nadia Hassan',    '+60-12-555-0107', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '5 hours',    CURRENT_TIMESTAMP - interval '70 days'),
    (800008, 'staff_razak',    'staff.razak@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Razak Ibrahim',   '+60-12-555-0108', 'staff', true,  true, false, 0, false, NULL,                                     CURRENT_TIMESTAMP - interval '60 days'),
    (800009, 'support_viewer', 'support.viewer@staging.hotel-app.test', '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Vikram Nair',     '+60-12-555-0109', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '2 days',     CURRENT_TIMESTAMP - interval '55 days'),
    (800010, 'ekyc_reviewer',  'ekyc.reviewer@staging.hotel-app.test',  '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Farah Aziz',      '+60-12-555-0110', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '6 hours',    CURRENT_TIMESTAMP - interval '50 days'),
    -- Inactive account: cannot log in, still appears in admin user lists.
    (800011, 'inactive_former','inactive.former@staging.hotel-app.test','$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Former Employee', '+60-12-555-0111', 'staff', false, true, false, 0, false, CURRENT_TIMESTAMP - interval '30 days',    CURRENT_TIMESTAMP - interval '200 days'),
    -- Locked account: exercises the lockout path in admin + auth flows.
    (800012, 'locked_desk',    'locked.desk@staging.hotel-app.test',    '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Locked Reception','+60-12-555-0112', 'staff', true,  true, true,  5, false, CURRENT_TIMESTAMP - interval '12 hours',   CURRENT_TIMESTAMP - interval '40 days'),
    -- Guest-portal login (user_type 'guest'); linked to guest 801020 below.
    (800013, 'guest_portal',   'guest.portal@staging.hotel-app.test',   '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Portal Guest',    NULL,             'guest', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '8 hours',    CURRENT_TIMESTAMP - interval '45 days'),
    -- Unverified staff account (registered, never confirmed email).
    (800014, 'newhire_unverified','newhire.unverified@staging.hotel-app.test','$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK','New Hire', NULL,'staff', true,  false, false, 0, false, NULL, CURRENT_TIMESTAMP - interval '1 day'),
    -- Voucher-scope audit pair: 800015 holds promotions:read + vouchers:read
    -- only (see user_permissions below); 800016 has no voucher permissions at
    -- all. Together they exercise read-only vs forbidden voucher views.
    (800015, 'voucher_audit',  'voucher.audit@staging.hotel-app.test',   '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Voucher Auditor','+60-12-555-0113', 'staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '2 days',     CURRENT_TIMESTAMP - interval '30 days'),
    (800016, 'voucher_noperm', 'voucher.noperm@staging.hotel-app.test',  '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'No Voucher Perms','+60-12-555-0114','staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '2 days',     CURRENT_TIMESTAMP - interval '30 days'),
    -- Role-complete admin pair: the bootstrap admin/superadmin rows carry a
    -- non-recoverable placeholder password, so these are the dev logins.
    (800017, 'admin_stg',      'admin.stg@staging.hotel-app.test',       '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Admin Seed',     '+60-12-555-0115','staff', true,  true, false, 0, false, CURRENT_TIMESTAMP - interval '1 hour',     CURRENT_TIMESTAMP - interval '90 days'),
    (800018, 'super_stg',      'super.stg@staging.hotel-app.test',       '$2b$12$pR0XOo.29MgsqNnNI4GP7OG6nY8u76Wg6Ee84Pqc6g1qzZeVxoUPK', 'Super Seed',     '+60-12-555-0116','staff', true,  true, false, 0, true,  CURRENT_TIMESTAMP - interval '1 hour',     CURRENT_TIMESTAMP - interval '90 days');

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
    (800016, 'staff'),
    (800017, 'admin'),
    (800018, 'super_admin')
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

-- Staff the seeded starter teams (codes come from the seed.sql bootstrap).
INSERT INTO public.team_members (team_id, user_id, is_lead, added_by)
SELECT t.id, m.user_id, m.is_lead, 1000
FROM (VALUES
    ('front_desk',  800002, false), ('front_desk',  800003, false), ('front_desk',  800001, true),
    ('housekeeping',800004, false), ('housekeeping',800005, true),
    ('maintenance', 800008, false), ('maintenance', 800001, true)
) AS m(team_code, user_id, is_lead)
JOIN public.teams t ON t.code = m.team_code;
"#;

// ---------------------------------------------------------------------------
// Room inventory: amenities, room types, rooms (all start 'available' — the
// status spread lives in rooms_state), rate plans, room rates. Adds to the
// bootstrap catalog (STD/DLX/STE/FAM + rooms 101-403), never replaces it.
// ---------------------------------------------------------------------------
const SQL_INVENTORY: &str = r#"
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

-- 24 seed rooms: floors 5-8. All enter as 'available'; bookings and the
-- explicit status calls in rooms_state produce the occupied/reserved/dirty/
-- maintenance spread with real transition history.
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
    -- 506 enters as 'cleaning' in rooms_state (no available->cleaning transition exists)
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

-- The bootstrap ships no rate plans; seed adds a working rate grid.
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
"#;

// ---------------------------------------------------------------------------
// Guests & corporate accounts — ~55 fictional guests. tourism_type drives the
// booking trigger's tourism tax (foreign => 10/night). Emails live on the
// @staging.hotel-app.test dev domain; phones are +60-…-555/600 ranges.
// ---------------------------------------------------------------------------
const SQL_GUESTS: &str = r#"
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
    -- Loyalty members (member guests get loyalty rows in the loyalty module).
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
    (801019,'Dup Test B','Daniel','Leigh','daniel.leigh@staging.hotel-app.test','+60-16-600-1019','Mr','1986-06-06','Malaysia','Malaysia','Ipoh','Perak','national_id','STG-IC-880119','en','email',false,NULL,'non_member','local',0,0,0.00,NULL,NULL,'Distinct from 801018 — search/dedup test.',NULL,false,NULL,800003),
    (801020,'Portal Guest','Portal','Guest','guest.portal@staging.hotel-app.test','+60-12-600-1020','Mr','1990-01-01','Malaysian','Malaysia','Kuala Lumpur','WP','national_id','STG-IC-880120','en','email',true,NULL,'member','local',0,2,1240.00,NULL,NULL,'Account used by the guest-portal login 800013.',NULL,false,NULL,800001),
    -- Anonymous-booking guests: first name + email only; last_name stays NULL
    -- (validate_anonymous_guest discards it so the pair cannot occupy the
    -- unique name). The anonymous module hangs bookings off these.
    (801051,'Anon A','Anonymous',NULL, 'anon.a@staging.hotel-app.test',NULL,NULL,NULL,'Malaysian','Malaysia',NULL,NULL,NULL,NULL,'en',NULL,false,NULL,'non_member','local',0,0,0.00,NULL,NULL,NULL,NULL,false,NULL,800003),
    (801052,'Anon B','Anonymous',NULL, 'anon.b@staging.hotel-app.test','+60-12-600-1052',NULL,NULL,NULL,'Malaysia',NULL,NULL,NULL,NULL,'en',NULL,false,NULL,'non_member','local',0,0,0.00,NULL,NULL,NULL,NULL,false,NULL,800003),
    (801053,'Anon C','Anonymous',NULL, 'anon.c@staging.hotel-app.test',NULL,NULL,NULL,NULL,'Malaysia',NULL,NULL,NULL,NULL,'en',NULL,false,NULL,'non_member','foreign',0,0,0.00,NULL,NULL,NULL,NULL,false,NULL,800003)
) AS g(id, nick, first_name, last_name, email, phone, title, dob, nationality,
       country, city, state, id_type, id_number, lang, comm_pref, mkt, vip,
       gtype, ttype, discount, stays, spend, rating, tags, notes, requests,
       blacklisted, blacklist_reason, created_by);

-- Bulk filler for pagination/search coverage: 30 more guests, deterministic
-- mix of local/foreign, member/non-member, with realistic name rotation.
INSERT INTO public.guests (
    id, nick_name, first_name, last_name, email, phone,
    nationality, country, id_type, id_number,
    marketing_opt_in, guest_type, tourism_type, total_stays, total_spend,
    is_active, created_by
)
OVERRIDING SYSTEM VALUE
SELECT 801060 + n,
       names.fn || ' ' || names.ln || ' ' || n::text,
       names.fn, names.ln,
       lower(regexp_replace(names.fn, '\s+', '', 'g') || '.' || names.ln || n || '@staging.hotel-app.test'),
       '+60-1' || (n % 10) || '-600-' || lpad((2000 + n)::text, 4, '0'),
       names.nats, names.cnts,
       CASE WHEN names.nats = 'Malaysian' THEN 'national_id' ELSE 'passport' END::public.identificationtype,
       'STG-ID-' || lpad((801060 + n)::text, 6, '0'),
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
"#;

// ---------------------------------------------------------------------------
// CRM detail rows, segments, portal linkage, marketing subscription/consent.
// ---------------------------------------------------------------------------
const SQL_CRM: &str = r#"
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
"#;
