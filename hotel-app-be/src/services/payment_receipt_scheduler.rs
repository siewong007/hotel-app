//! Reject bank-transfer claims when a requested receipt is not supplied within a day.

use std::time::Duration;

use crate::core::db::DbPool;
use crate::services::payments;

const POLL_INTERVAL: Duration = Duration::from_secs(15 * 60);

pub fn spawn(pool: DbPool) {
    tokio::spawn(async move {
        log::info!(
            "Payment receipt scheduler started (polling every {}s)",
            POLL_INTERVAL.as_secs()
        );
        loop {
            if let Err(error) = tick(&pool).await {
                log::warn!("Payment receipt scheduler tick failed: {error}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

async fn tick(pool: &DbPool) -> Result<(), crate::core::error::ApiError> {
    let rejected = payments::reject_expired_receipt_requests(pool).await?;
    if rejected > 0 {
        log::info!(
            "Automatically rejected {rejected} payment claim(s) with overdue receipt requests"
        );
    }
    Ok(())
}
