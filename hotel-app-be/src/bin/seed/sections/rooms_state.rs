//! Room status spread + sellable-inventory grid. Ported from staging.sql §20
//! (status calls) and the online_inventory_allocations block, extended with a
//! `reserved_dirty` room — the one supported status staging never produced.
//!
//! Statuses go through `update_room_status()` so each change is validated
//! against room_status_transitions and journaled into room_status_change_log /
//! room_history exactly like an operator action. Bookings inserted later by
//! the booking sections drive the occupied/reserved/dirty states via the
//! `sync_room_status_with_booking` trigger (its guard preserves
//! maintenance/out_of_order on booked rooms).

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
-- States no booking can produce, applied through update_room_status():
--   806 maintenance (in progress), 805 out_of_order, 706 dirty (+auto HK task),
--   506 cleaning (+auto in-progress HK task), 302 reserved_dirty (booked for
--   arrival, still needs a clean — no active booking produces this state).
SELECT public.update_room_status(800324, 'maintenance', 'Scheduled elevator-shaft inspection — seed', 800008,
        (SELECT today FROM staging_ref)::timestamptz - interval '1 day',
        (SELECT today FROM staging_ref)::timestamptz + interval '3 days');
SELECT public.update_room_status(800323, 'out_of_order', 'Water leak behind vanity — awaiting parts', 800008,
        (SELECT today FROM staging_ref)::timestamptz - interval '2 days', NULL);
SELECT public.update_room_status(800318, 'dirty', 'Checkout cleaning pending', 800004,
        (SELECT today FROM staging_ref)::timestamptz - interval '3 hours', NULL);
UPDATE public.rooms SET status = 'cleaning' WHERE id = 800306;
-- 302 is booked by a pending arrival in three days (booking section) — mark it
-- reserved_dirty so the front desk sees "reserved, needs cleaning".
SELECT public.update_room_status(800302, 'reserved_dirty', 'Arrival due — checkout clean not yet done', 800004,
        (SELECT today FROM staging_ref)::timestamptz - interval '1 hour', NULL);

-- Room events feed the room-activity timeline.
INSERT INTO public.room_events (id, room_id, event_type, status, priority, notes, scheduled_date, created_by)
OVERRIDING SYSTEM VALUE VALUES
    (806801, 800324, 'maintenance', 'maintenance', 'high', 'Elevator-shaft inspection window', (SELECT today+1 FROM staging_ref)::timestamptz, 800008),
    (806802, 800323, 'maintenance', 'out_of_order', 'urgent', 'Out of order pending leak repair', (SELECT today+2 FROM staging_ref)::timestamptz, 800008),
    (806803, 800319, 'inspection', NULL, 'high', 'VIP pre-arrival inspection', (SELECT today FROM staging_ref)::timestamptz + interval '10 hours', 800001);

-- Sellable online inventory for the next two weeks, with a couple of
-- closed/walk-in-reserved dates for grid coverage. The availability section
-- adds the bookings that make some of these dates sold out.
INSERT INTO public.online_inventory_allocations (room_type_id, stay_date, walk_in_reserved_rooms, online_booking_enabled, custom_price, updated_by)
SELECT rt.id, (SELECT today FROM staging_ref) + d,
       CASE WHEN d IN (3, 10) AND rt.code = 'STD' THEN 1 ELSE 0 END,
       NOT (d = 7 AND rt.code IN ('DLX', 'PRE')),
       CASE WHEN d = 7 AND rt.code = 'STE' THEN 499.00 ELSE NULL END,
       800001
FROM public.room_types rt
CROSS JOIN generate_series(0, 13) AS d
WHERE rt.code IN ('STD', 'DLX', 'STE', 'ECO', 'PRE');
"#;
