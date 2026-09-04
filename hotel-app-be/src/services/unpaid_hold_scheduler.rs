//! Release the rooms held by bookings that were never paid for.
//!
//! Off unless `unpaid_hold_release_hours` is set to a positive number of hours;
//! see `services::bookings::release_stale_unpaid_holds`, which owns the policy
//! and the per-booking safety checks. This module only decides how often to ask.

use std::time::Duration;

use crate::core::db::DbPool;
use crate::services::bookings;

/// The sweep is bounded by the configured hold window, which is measured in
/// hours, so polling more often than this buys nothing.
const POLL_INTERVAL: Duration = Duration::from_secs(15 * 60);

pub fn spawn(pool: DbPool) {
    tokio::spawn(async move {
        log::info!(
            "Unpaid hold scheduler started (polling every {}s)",
            POLL_INTERVAL.as_secs()
        );
        loop {
            if let Err(error) = tick(&pool).await {
                log::warn!("Unpaid hold scheduler tick failed: {error}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

async fn tick(pool: &DbPool) -> Result<(), crate::core::error::ApiError> {
    let released = bookings::release_stale_unpaid_holds(pool).await?;
    if released > 0 {
        log::info!("Automatically released {released} stale unpaid booking hold(s)");
    }
    Ok(())
}
