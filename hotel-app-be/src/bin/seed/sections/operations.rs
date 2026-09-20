//! Operations board: housekeeping tasks and maintenance tickets. Ported from
//! staging.sql §60. (room_events live in rooms_state; the dirty/cleaning rooms
//! there already auto-created two housekeeping rows via update_room_status —
//! these add the rest of the board.)

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
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
    (806103, 800318, 'MT-STG-0003', 'Aircon rattle', 'Guest-reported rattling fan coil in 706.', 'hvac', 'high', 'in_progress', 800008, 800004, 120.00, NULL, 1.50, NULL, (SELECT today FROM staging_ref)::timestamptz, (SELECT today FROM staging_ref)::timestamptz - interval '2 hours', NULL, NULL, (SELECT today-1 FROM staging_ref)::timestamptz),
    (806104, 800310, 'MT-STG-0004', 'Kettle replacement', 'Kettle failed PAT check.', 'electrical', 'low', 'resolved', 800008, 800004, 45.00, 42.50, 0.50, 0.50, (SELECT today-3 FROM staging_ref)::timestamptz, (SELECT today-3 FROM staging_ref)::timestamptz, (SELECT today-3 FROM staging_ref)::timestamptz + interval '1 hour', 'Replaced with stock unit; PAT passed.', (SELECT today-4 FROM staging_ref)::timestamptz),
    (806105, 800301, 'MT-STG-0005', 'Window latch loose', 'Latch loose; secure before next occupancy.', 'carpentry', 'medium', 'on_hold', 800008, 800003, 60.00, NULL, 1.00, NULL, (SELECT today+4 FROM staging_ref)::timestamptz, NULL, NULL, NULL, (SELECT today-5 FROM staging_ref)::timestamptz),
    (806106, NULL,   'MT-STG-0006', 'Lobby restroom tap', 'Gents lobby restroom tap dripping.', 'plumbing', 'low', 'closed', 800008, 800002, 30.00, 28.00, 0.50, 0.75, (SELECT today-6 FROM staging_ref)::timestamptz, (SELECT today-6 FROM staging_ref)::timestamptz, (SELECT today-6 FROM staging_ref)::timestamptz + interval '2 hours', 'Washer replaced.', (SELECT today-7 FROM staging_ref)::timestamptz);
"#;
