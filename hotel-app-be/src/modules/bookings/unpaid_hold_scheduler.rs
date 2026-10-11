//! Release the rooms held by bookings that were never paid for, and hold rooms
//! for today's arrivals.
//!
//! Unpaid holds: off unless `unpaid_hold_release_hours` is set to a positive
//! number of hours; see `services::bookings::release_stale_unpaid_holds`, which
//! owns the policy and the per-booking safety checks. Swept every 15 minutes.
//!
//! Arrival-day holds: once per hotel-local day at `new_reservation_visible_time`
//! (with catch-up after a missed run), `rooms::arrival_holds` marks the rooms of
//! today's arrivals reserved / reserved_dirty and releases holds without an
//! arrival today. Folded into this loop rather than spawned as its own leader
//! so it does not pin another pooled connection (see the pool floor in
//! `main.rs`). This module only decides how often to ask.

use std::time::{Duration, Instant};

use chrono::NaiveDate;

use super::service as bookings;
use crate::core::db::DbPool;
use crate::modules::rooms::arrival_holds;

/// The unpaid sweep is bounded by the configured hold window, which is
/// measured in hours, so polling more often than this buys nothing.
const UNPAID_POLL_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Loop cadence: the arrival-day sweep fires within a minute of the hotel's
/// visibility time.
const TICK_INTERVAL: Duration = Duration::from_secs(60);

/// The scheduler loop. Never returns under normal operation; multi-replica
/// deployments drive it under `core::leader::spawn_exclusive`.
pub async fn run(pool: DbPool) {
    log::info!(
        "Unpaid hold / arrival-day hold scheduler started (unpaid every {}s, arrivals checked every {}s)",
        UNPAID_POLL_INTERVAL.as_secs(),
        TICK_INTERVAL.as_secs()
    );
    let mut next_unpaid_run = Instant::now();
    let mut last_arrival_sweep: Option<NaiveDate> = None;
    loop {
        if Instant::now() >= next_unpaid_run {
            let started = Instant::now();
            let outcome = tick(&pool).await;
            crate::core::job_runs::record_outcome(
                &pool,
                "unpaid_hold_release",
                &outcome,
                started.elapsed(),
            )
            .await;
            if let Err(error) = &outcome {
                log::warn!("Unpaid hold scheduler tick failed: {error}");
            }
            next_unpaid_run = Instant::now() + UNPAID_POLL_INTERVAL;
        }

        let started = Instant::now();
        let outcome = arrival_holds::tick(&pool, &mut last_arrival_sweep).await;
        crate::core::job_runs::record_outcome(
            &pool,
            "room_arrival_holds",
            &outcome,
            started.elapsed(),
        )
        .await;
        match &outcome {
            Ok(sweep) if sweep.swept => {
                log::info!("Arrival-day hold sweep updated {} room(s)", sweep.changed)
            }
            Ok(_) => {}
            Err(error) => log::warn!("Arrival-day hold sweep failed: {error}"),
        }

        tokio::time::sleep(TICK_INTERVAL).await;
    }
}

async fn tick(pool: &DbPool) -> Result<serde_json::Value, crate::core::error::ApiError> {
    let released = bookings::release_stale_unpaid_holds(pool).await?;
    if released > 0 {
        log::info!("Automatically released {released} stale unpaid booking hold(s)");
    }
    Ok(serde_json::json!({ "released": released }))
}
