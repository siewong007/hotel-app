//! Anonymous guest bookings (new coverage — staging.sql had none). Guests
//! 801051-801053 from `core` carry the anonymous shape (first name + email,
//! last_name NULL, no password). These bookings add `portal_request_id` (the
//! app's idempotency key for anonymous creates) and `pre_checkin_token` —
//! the hashed, booking-scoped access token the guest portal authenticates
//! with. Token value is `sha256:<hex>` exactly as `persist_booking_access_token`
//! writes it, and the raw token is deterministic:
//! `stg-anon-token-201` unlocks booking 802201, `stg-anon-token-203` → 802203.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
INSERT INTO public.bookings (
    id, booking_number, guest_id, guest_name, guest_email,
    room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, currency,
    status, payment_status, payment_method,
    portal_request_id, pre_checkin_token, pre_checkin_token_expires_at,
    cancelled_at, cancelled_by, cancellation_reason,
    source, channel, booking_channel_id, created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT * FROM (VALUES
    -- Anonymous booking awaiting payment (pending_payment hold, token issued
    -- at create time; the PayPal order in webhook_fixtures can settle it).
    (802201,'B-STG-0201',801051,'Anonymous','anon.a@staging.hotel-app.test',800301,
        (SELECT today+30 FROM staging_ref),(SELECT today+32 FROM staging_ref),1,0,
        800501,90.00,180.00,14.40,194.40,'USD',
        'pending_payment','unpaid',NULL,
        'stg-req-anon-201','sha256:' || encode(sha256('stg-anon-token-201'::bytea),'hex'),
        (SELECT today+32 FROM staging_ref)::timestamptz,
        NULL,NULL::bigint,NULL,
        'website','Direct Website',(SELECT id FROM booking_channels WHERE name='Direct Website'),
        800003,CURRENT_TIMESTAMP-interval '3 hours'),
    -- Same anonymous guest, second stay — "guest with multiple bookings" and
    -- proves (guest_id, portal_request_id) idempotency scoping.
    (802202,'B-STG-0202',801051,'Anonymous','anon.a@staging.hotel-app.test',800304,
        (SELECT today+40 FROM staging_ref),(SELECT today+42 FROM staging_ref),1,0,
        800501,90.00,180.00,14.40,194.40,'USD',
        'confirmed','paid','online_payment',
        'stg-req-anon-202','sha256:' || encode(sha256('stg-anon-token-202'::bytea),'hex'),
        (SELECT today+42 FROM staging_ref)::timestamptz,
        NULL,NULL,NULL,
        'website','Direct Website',(SELECT id FROM booking_channels WHERE name='Direct Website'),
        800003,CURRENT_TIMESTAMP-interval '2 days'),
    -- Anonymous confirmed booking with secure guest access (the canonical
    -- "returning via access token" fixture — raw token stg-anon-token-203).
    (802203,'B-STG-0203',801052,'Anonymous','anon.b@staging.hotel-app.test',800303,
        (SELECT today+33 FROM staging_ref),(SELECT today+35 FROM staging_ref),1,0,
        800501,90.00,180.00,14.40,194.40,'USD',
        'confirmed','paid','online_payment',
        'stg-req-anon-203','sha256:' || encode(sha256('stg-anon-token-203'::bytea),'hex'),
        (SELECT today+35 FROM staging_ref)::timestamptz,
        NULL,NULL,NULL,
        'website','Direct Website',(SELECT id FROM booking_channels WHERE name='Direct Website'),
        800003,CURRENT_TIMESTAMP-interval '1 day'),
    -- Cancelled anonymous booking ('voided' is the supported cancel status).
    (802204,'B-STG-0204',801053,'Anonymous','anon.c@staging.hotel-app.test',800306,
        (SELECT today+44 FROM staging_ref),(SELECT today+46 FROM staging_ref),1,0,
        800501,90.00,180.00,14.40,194.40,'USD',
        'voided','unpaid',NULL,
        'stg-req-anon-204',NULL,NULL,
        (SELECT today-1 FROM staging_ref)::timestamptz,NULL,'Guest cancelled via booking-reference link',
        'website','Direct Website',(SELECT id FROM booking_channels WHERE name='Direct Website'),
        800003,CURRENT_TIMESTAMP-interval '6 days')
) AS v(
    id, booking_number, guest_id, guest_name, guest_email,
    room_id, check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, currency,
    status, payment_status, payment_method,
    portal_request_id, pre_checkin_token, pre_checkin_token_expires_at,
    cancelled_at, cancelled_by, cancellation_reason,
    source, channel, booking_channel_id, created_by, created_at
);
"#;
