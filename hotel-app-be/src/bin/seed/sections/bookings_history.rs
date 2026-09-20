//! Booking-side audit trail: status history, modifications, and a room move.
//! Ported from staging.sql §40 tail. Depends on bookings_ops + bookings_matrix
//! (history rows reference bookings owned by both).

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
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
"#;
