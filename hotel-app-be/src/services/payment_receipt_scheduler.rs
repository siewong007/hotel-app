//! Reject overdue bank-transfer receipts and unstarted PayPal attempts.

use std::time::Duration;

use crate::core::db::DbPool;
use crate::services::payments;

const POLL_INTERVAL: Duration = Duration::from_secs(60);

pub fn spawn(pool: DbPool) {
    tokio::spawn(async move {
        log::info!(
            "Payment receipt scheduler started (polling every {}s)",
            POLL_INTERVAL.as_secs()
        );
        loop {
            let started = std::time::Instant::now();
            let outcome = tick(&pool).await;
            crate::core::job_runs::record_outcome(
                &pool,
                "payment_receipts",
                &outcome,
                started.elapsed(),
            )
            .await;
            if let Err(error) = &outcome {
                log::warn!("Payment receipt scheduler tick failed: {error}");
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

async fn tick(pool: &DbPool) -> Result<serde_json::Value, crate::core::error::ApiError> {
    let rejected = payments::reject_expired_receipt_requests(pool).await?;
    if rejected > 0 {
        log::info!(
            "Automatically rejected {rejected} payment claim(s) with overdue receipt requests"
        );
    }
    let expired_paypal = payments::reject_expired_paypal_attempts(pool).await?;
    if expired_paypal > 0 {
        log::info!("Automatically released {expired_paypal} stale PayPal payment attempt(s)");
    }
    Ok(serde_json::json!({
        "rejected_receipts": rejected,
        "expired_paypal_attempts": expired_paypal,
    }))
}
