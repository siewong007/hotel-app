//! Arrival-day room holds.
//!
//! A reservation holds its room from its arrival day only: the room reads
//! `reserved` (or `reserved_dirty` while it still needs cleaning) on the day
//! its guest arrives, never earlier. Future stays live on the room timeline.
//!
//! Booking and housekeeping writes already apply that rule to the room they
//! touch. This sweep covers the rooms nobody touched: once per hotel-local day,
//! when the hotel clock reaches `new_reservation_visible_time` (the same clock
//! the dashboard's New reservations strip and the room grid use), every active
//! room is reconciled through `reconcile_room_holds()` — today's arrivals flip
//! `available` -> `reserved` and `dirty` -> `reserved_dirty`, and a hold left
//! without an arrival today is released. The sweep is idempotent, so a missed
//! run (restart, leader failover) simply catches up on the next tick after the
//! time, and running it twice changes nothing.

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;

use super::queries as rq;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::modules::bookings::new_reservations::appearance_time;
use crate::modules::settings::service::{
    DEFAULT_NEW_RESERVATION_VISIBLE_TIME, NEW_RESERVATION_VISIBLE_TIME_KEY,
};

/// What one tick did, recorded in `job_runs`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ArrivalHoldSweep {
    /// Whether the daily sweep ran on this tick.
    pub swept: bool,
    /// Rooms whose hold changed.
    pub changed: usize,
}

/// Whether the daily sweep is due: the hotel clock has reached the visibility
/// time and the sweep has not yet run for today's business day.
pub fn sweep_due(
    now_local: NaiveDateTime,
    visible_from: NaiveTime,
    last_run: Option<NaiveDate>,
) -> bool {
    last_run != Some(now_local.date()) && now_local.time() >= visible_from
}

/// One scheduler tick. Cheap when the sweep is not due (one settings-cache read
/// and one `LOCALTIMESTAMP`).
pub async fn tick(
    pool: &DbPool,
    last_run: &mut Option<NaiveDate>,
) -> Result<ArrivalHoldSweep, ApiError> {
    let configured = settings_cache::get_string(
        pool,
        NEW_RESERVATION_VISIBLE_TIME_KEY,
        DEFAULT_NEW_RESERVATION_VISIBLE_TIME,
    )
    .await;
    let visible_from = appearance_time(&configured);
    // Each pooled connection runs in the hotel timezone, so LOCALTIMESTAMP is
    // the hotel's wall clock.
    let now_local: NaiveDateTime = sqlx::query_scalar("SELECT LOCALTIMESTAMP")
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !sweep_due(now_local, visible_from, *last_run) {
        return Ok(ArrivalHoldSweep {
            swept: false,
            changed: 0,
        });
    }

    let changes = rq::reconcile_room_holds(pool, None).await?;
    for change in &changes {
        log::info!(
            "Arrival-day hold: room {} {} -> {}",
            change.room_number,
            change.old_status,
            change.new_status
        );
    }
    if !changes.is_empty()
        && let Some(hub) = crate::modules::realtime::hub::DataChangeHub::for_fanout(pool.clone())
    {
        hub.publish_data_changed("rooms");
    }
    *last_run = Some(now_local.date());
    Ok(ArrivalHoldSweep {
        swept: true,
        changed: changes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 11).unwrap()
    }

    fn at(hour: u32, minute: u32) -> NaiveDateTime {
        day().and_hms_opt(hour, minute, 0).unwrap()
    }

    fn seven() -> NaiveTime {
        NaiveTime::from_hms_opt(7, 0, 0).unwrap()
    }

    #[test]
    fn not_due_before_the_visibility_time() {
        assert!(!sweep_due(at(6, 59), seven(), None));
    }

    #[test]
    fn due_at_and_after_the_visibility_time() {
        assert!(sweep_due(at(7, 0), seven(), None));
        assert!(sweep_due(at(10, 48), seven(), None));
    }

    #[test]
    fn runs_once_per_business_day() {
        assert!(!sweep_due(at(9, 0), seven(), Some(day())));
        let yesterday = day().pred_opt().unwrap();
        assert!(sweep_due(at(9, 0), seven(), Some(yesterday)));
    }

    #[test]
    fn a_missed_run_catches_up_later_that_day() {
        // A restart at 15:30 (no run recorded in this process) still sweeps.
        assert!(sweep_due(at(15, 30), seven(), None));
    }

    #[test]
    fn follows_a_customised_time() {
        let fourteen = NaiveTime::from_hms_opt(14, 0, 0).unwrap();
        assert!(!sweep_due(at(13, 59), fourteen, None));
        assert!(sweep_due(at(14, 0), fourteen, None));
    }
}
