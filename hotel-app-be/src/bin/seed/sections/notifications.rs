//! Staff notifications + read markers. Ported from staging.sql §80.
//! subjects/bodies reference booking numbers and ticket numbers as text only —
//! no FKs beyond users.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
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
"#;
