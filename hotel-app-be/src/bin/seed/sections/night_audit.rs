//! Night-audit history and background-job runs. Ported from staging.sql §60
//! tail. posted_nights/details reference the historical bookings
//! (802001-802045) owned by bookings_matrix.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
-- 14 nightly runs: 13 completed plus one failed for the audit-log view.
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
"#;
