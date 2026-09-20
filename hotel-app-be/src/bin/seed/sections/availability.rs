//! Availability shaping (new coverage). The matrix already supplies adjacent
//! and disjoint same-room windows; this module adds the date-level inventory
//! story on the six ECO rooms (800301-800306):
//!   * ref+60 — all six ECO rooms confirmed => Economy sold out that night
//!   * ref+62 — five of six confirmed      => exactly one room left that night
//!   * ref+64 — no ECO bookings            => fully available contrast date
//!
//! The other availability signals live in rooms_state (online_inventory
//! allocations incl. the online_booking_enabled=false date) and rooms_state's
//! maintenance/out_of_order rooms (booked-but-offline via 802128/802129).

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
INSERT INTO public.bookings (
    id, booking_number, guest_id, guest_name, room_id,
    check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, currency,
    status, payment_status, source, channel, booking_channel_id,
    created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT 802400 + n,
       'B-STG-04' || lpad(n::text, 2, '0'),
       801060 + n,
       g.nick_name,
       800300 + n,
       (SELECT today+60 FROM staging_ref),
       (SELECT today+61 FROM staging_ref),
       1, 0,
       800501, 90.00, 90.00, 7.20, 97.20, 'USD',
       'confirmed', 'unpaid',
       'website', 'Direct Website',
       (SELECT id FROM booking_channels WHERE name='Direct Website'),
       800003, CURRENT_TIMESTAMP - interval '12 hours'
FROM generate_series(1, 6) AS n
JOIN public.guests g ON g.id = 801060 + n;

INSERT INTO public.bookings (
    id, booking_number, guest_id, guest_name, room_id,
    check_in_date, check_out_date, adults, children,
    rate_plan_id, room_rate, subtotal, tax_amount, total_amount, currency,
    status, payment_status, source, channel, booking_channel_id,
    created_by, created_at
)
OVERRIDING SYSTEM VALUE
SELECT 802410 + n,
       'B-STG-041' || n::text,
       801070 + n,
       g.nick_name,
       800300 + n,
       (SELECT today+62 FROM staging_ref),
       (SELECT today+63 FROM staging_ref),
       1, 0,
       800501, 90.00, 90.00, 7.20, 97.20, 'USD',
       'confirmed', 'unpaid',
       'website', 'Direct Website',
       (SELECT id FROM booking_channels WHERE name='Direct Website'),
       800003, CURRENT_TIMESTAMP - interval '12 hours'
FROM generate_series(1, 5) AS n
JOIN public.guests g ON g.id = 801070 + n;
"#;
