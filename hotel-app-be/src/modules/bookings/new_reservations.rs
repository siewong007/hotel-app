//! New-reservations strip.
//!
//! Staff who want a short list of reservations that have just become
//! relevant see them here, and nowhere else. The room timeline, the room
//! grid, guest stays and the booking list are not filtered by this clock.
//!
//! A reservation is on the strip only when its check-in date is the hotel's
//! business day (the booking day) and it is still a room-holding reservation,
//! not an in-house stay. It appears once the hotel clock reaches
//! `new_reservation_visible_time`. A same-day booking created at or after
//! that time appears immediately.

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;

use crate::modules::settings::service::{
    DEFAULT_NEW_RESERVATION_VISIBLE_TIME, NEW_RESERVATION_VISIBLE_TIME_KEY, normalize_clock_time,
};

/// Statuses that hold a room and are not yet in house. In-house stays
/// (`checked_in`, `auto_checked_in`) are deliberately absent.
const NEW_RESERVATION_STATUSES: &[&str] = &[
    "pending",
    "pending_payment",
    "pending_confirmation",
    "confirmed",
];

#[derive(Debug, Clone, Serialize)]
pub struct NewReservationItem {
    pub id: i64,
    pub booking_number: Option<String>,
    pub guest_name: String,
    pub room_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NewReservationsResponse {
    /// Hotel-local HH:MM the strip starts showing today's new reservations.
    pub visible_from: String,
    pub reservations: Vec<NewReservationItem>,
}

#[derive(Debug, sqlx::FromRow)]
struct CandidateRow {
    id: i64,
    booking_number: Option<String>,
    guest_name: String,
    room_number: String,
    check_in_date: NaiveDate,
    check_out_date: NaiveDate,
    status: String,
    created_local: NaiveDateTime,
    now_local: NaiveDateTime,
}

/// Whether one reservation belongs on the new-reservations strip.
///
/// `check_in`, `created_local` and `now_local` are all hotel-local wall times.
/// `appearance` is the configured time of day.
pub fn visible_on_new_reservations_strip(
    status: &str,
    check_in: NaiveDate,
    created_local: NaiveDateTime,
    now_local: NaiveDateTime,
    appearance: NaiveTime,
) -> bool {
    if !NEW_RESERVATION_STATUSES.contains(&status) {
        return false;
    }
    let today = now_local.date();
    if check_in != today {
        return false;
    }
    let gate = today.and_time(appearance);
    // Created at or after the gate on the booking day: show immediately,
    // even when comparing clocks that have not yet been rounded.
    created_local >= gate || now_local >= gate
}

fn appearance_time(raw: &str) -> NaiveTime {
    let normalized = normalize_clock_time(raw)
        .unwrap_or_else(|_| DEFAULT_NEW_RESERVATION_VISIBLE_TIME.to_string());
    NaiveTime::parse_from_str(&normalized, "%H:%M")
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(7, 0, 0).expect("07:00"))
}

pub async fn list_new_reservations(pool: &DbPool) -> Result<NewReservationsResponse, ApiError> {
    let configured = settings_cache::get_string(
        pool,
        NEW_RESERVATION_VISIBLE_TIME_KEY,
        DEFAULT_NEW_RESERVATION_VISIBLE_TIME,
    )
    .await;
    let visible_from = normalize_clock_time(&configured)
        .unwrap_or_else(|_| DEFAULT_NEW_RESERVATION_VISIBLE_TIME.to_string());
    let appearance = appearance_time(&visible_from);

    // Today's arrivals only. Future stays stay off this strip; they remain on
    // the timeline, the room grid and the booking list.
    let rows = sqlx::query_as::<_, CandidateRow>(
        r#"
        SELECT
            b.id,
            b.booking_number,
            COALESCE(NULLIF(BTRIM(g.nick_name), ''), 'Guest') AS guest_name,
            COALESCE(r.room_number, '') AS room_number,
            b.check_in_date,
            b.check_out_date,
            b.status,
            (b.created_at AT TIME ZONE CURRENT_SETTING('TimeZone')) AS created_local,
            LOCALTIMESTAMP AS now_local
        FROM bookings b
        LEFT JOIN guests g ON g.id = b.guest_id
        LEFT JOIN rooms r ON r.id = b.room_id
        WHERE b.check_in_date = CURRENT_DATE
          AND b.status IN ('pending', 'pending_payment', 'pending_confirmation', 'confirmed')
        ORDER BY r.room_number, b.id
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|err| ApiError::Database(err.to_string()))?;

    let reservations = rows
        .into_iter()
        .filter(|row| {
            visible_on_new_reservations_strip(
                &row.status,
                row.check_in_date,
                row.created_local,
                row.now_local,
                appearance,
            )
        })
        .map(|row| NewReservationItem {
            id: row.id,
            booking_number: row.booking_number,
            guest_name: row.guest_name,
            room_number: row.room_number,
            check_in_date: row.check_in_date,
            check_out_date: row.check_out_date,
            status: row.status,
        })
        .collect();

    Ok(NewReservationsResponse {
        visible_from,
        reservations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 4).unwrap()
    }

    fn at(hour: u32, minute: u32) -> NaiveDateTime {
        day().and_hms_opt(hour, minute, 0).unwrap()
    }

    fn gate() -> NaiveTime {
        NaiveTime::from_hms_opt(7, 0, 0).unwrap()
    }

    #[test]
    fn hidden_before_the_appearance_time() {
        assert!(!visible_on_new_reservations_strip(
            "confirmed",
            day(),
            at(5, 0),
            at(6, 30),
            gate(),
        ));
    }

    #[test]
    fn visible_once_the_hotel_clock_reaches_the_appearance_time() {
        assert!(visible_on_new_reservations_strip(
            "confirmed",
            day(),
            at(9, 0),
            at(7, 0),
            gate(),
        ));
    }

    #[test]
    fn same_day_booking_created_after_the_time_is_visible_immediately() {
        assert!(visible_on_new_reservations_strip(
            "pending",
            day(),
            at(16, 5),
            at(16, 5),
            gate(),
        ));
    }

    #[test]
    fn a_future_check_in_stays_off_the_strip() {
        let tomorrow = day().succ_opt().unwrap();
        assert!(!visible_on_new_reservations_strip(
            "confirmed",
            tomorrow,
            at(16, 0),
            at(16, 0),
            gate(),
        ));
    }

    #[test]
    fn in_house_stays_are_not_on_the_strip() {
        for status in ["checked_in", "auto_checked_in", "checked_out", "voided"] {
            assert!(
                !visible_on_new_reservations_strip(status, day(), at(9, 0), at(15, 0), gate()),
                "{status}"
            );
        }
    }

    #[test]
    fn unpaid_and_awaiting_confirmation_holds_follow_the_same_clock() {
        assert!(!visible_on_new_reservations_strip(
            "pending_payment",
            day(),
            at(5, 0),
            at(6, 0),
            gate(),
        ));
        assert!(visible_on_new_reservations_strip(
            "pending_confirmation",
            day(),
            at(8, 0),
            at(7, 1),
            gate(),
        ));
    }
}
