//! Audit trail markers. Ported from staging.sql §80 tail.
//!
//! audit_logs is append-only: rows can never be deleted or updated, and the
//! users delete in the wipe fires ON DELETE SET NULL against it. So audit rows
//! reference the bootstrap admin (which survives reruns) and are
//! marker-guarded by id so a rerun inserts nothing. The engine's
//! `SET LOCAL app.allow_audit_mutation = 'on'` covers the SET NULL.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
-- audit_logs is partitioned by month — ensure partitions exist first.
SELECT public.ensure_audit_logs_partition(date_trunc('month', (SELECT today FROM staging_ref))::date);
SELECT public.ensure_audit_logs_partition(date_trunc('month', (SELECT today FROM staging_ref) - interval '1 month')::date);

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
"#;
