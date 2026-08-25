//! Durable email delivery worker.
//!
//! Follows the night-audit scheduler pattern: a spawned loop that polls the
//! `email_deliveries` outbox, claims due rows under a database lease, and
//! sends them through the configured [`Transport`]. Crash recovery is
//! structural: a row stuck in 'sending' past its lease expiry is reclaimed by
//! the next tick (on this or any other instance). Consent and suppression are
//! rechecked immediately before every send, so a late unsubscribe still
//! prevents delivery of queued mail.

use std::time::Duration;

use chrono::Utc;

use super::repository::CommunicationsRepository as Repo;
use super::transport::{OutgoingEmail, Transport};
use super::validation;
use crate::core::db::{DbPool, generate_uuid};
use crate::core::error::ApiError;

const DEFAULT_INTERVAL_SECS: u64 = 15;
const DEFAULT_BATCH: i64 = 10;
const MAX_BACKOFF_MINUTES: i64 = 60;

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Exponential backoff: 2^attempts minutes, capped.
fn backoff_minutes(attempts: i32) -> i64 {
    let attempts = attempts.clamp(1, 30) as u32;
    (2_i64.saturating_pow(attempts)).min(MAX_BACKOFF_MINUTES)
}

/// Spawn the delivery worker. Inert (never spawns the loop) when SMTP is not
/// configured — queued rows simply wait until a configured process starts.
pub fn spawn(pool: DbPool) {
    let transport = match Transport::from_env() {
        Ok(Some(t)) => t,
        Ok(None) => {
            log::info!(
                "Email delivery worker idle: SMTP not configured (set SMTP_HOST / SMTP_FROM_EMAIL)"
            );
            return;
        }
        Err(e) => {
            log::error!("Email delivery worker disabled: {e}");
            return;
        }
    };
    let interval =
        Duration::from_secs(env_u64("EMAIL_WORKER_INTERVAL_SECS", DEFAULT_INTERVAL_SECS));
    let batch = env_u64("EMAIL_WORKER_BATCH", DEFAULT_BATCH as u64) as i64;
    let worker_id = format!("worker-{}", generate_uuid());
    tokio::spawn(async move {
        log::info!(
            "Email delivery worker started ({worker_id}, every {}s, batch {batch})",
            interval.as_secs()
        );
        loop {
            tokio::time::sleep(interval).await;
            if let Err(e) = tick(&pool, &transport, &worker_id, batch).await {
                log::warn!("Email delivery worker tick failed: {e}");
            }
        }
    });
}

/// One worker iteration. Also directly callable from tests with a fake
/// transport.
pub async fn tick(
    pool: &DbPool,
    transport: &Transport,
    worker_id: &str,
    batch: i64,
) -> Result<usize, ApiError> {
    let claimed = Repo::claim_due_deliveries(pool, worker_id, batch).await?;
    if claimed.is_empty() {
        return Ok(0);
    }
    let mut campaigns_touched: Vec<i64> = Vec::new();
    let count = claimed.len();
    for delivery in claimed {
        if let Some(campaign_id) = delivery.campaign_id
            && !campaigns_touched.contains(&campaign_id)
        {
            campaigns_touched.push(campaign_id);
        }
        if let Err(e) = process_delivery(pool, transport, &delivery).await {
            // Persisting the outcome failed; the lease will expire and the
            // row will be reclaimed. Log without recipient details.
            log::warn!("Delivery {} outcome persistence failed: {e}", delivery.id);
        }
    }
    for campaign_id in campaigns_touched {
        if Repo::complete_campaign_if_done(pool, campaign_id).await? {
            log::info!("Campaign {campaign_id} completed");
        }
    }
    Ok(count)
}

async fn process_delivery(
    pool: &DbPool,
    transport: &Transport,
    delivery: &super::models::EmailDelivery,
) -> Result<(), ApiError> {
    // Campaign cancelled after enqueue → drop the remaining sends.
    if let Some(campaign_id) = delivery.campaign_id
        && let Some(campaign) = Repo::get_campaign(pool, campaign_id).await?
        && campaign.status == "cancelled"
    {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        Repo::mark_delivery_skipped_tx(&mut tx, delivery.id, "cancelled", "campaign cancelled")
            .await?;
        tx.commit().await.map_err(ApiError::from)?;
        return Ok(());
    }

    // Last-moment consent + suppression recheck. Transactional kinds are part
    // of the service: they need only an active guest (hard suppressions below
    // still apply), while marketing kinds additionally require a live
    // per-topic subscription.
    let suppressed = Repo::is_email_suppressed(pool, &delivery.recipient_email).await?;
    let transactional =
        !validation::requires_topic_subscription(&delivery.kind);
    let deliverable = if transactional {
        Repo::is_guest_active(pool, delivery.guest_id).await?
    } else {
        Repo::is_guest_deliverable(pool, delivery.guest_id, &delivery.topic).await?
    };
    if suppressed || !deliverable {
        let reason = if suppressed {
            "recipient suppressed"
        } else if transactional {
            "guest inactive"
        } else {
            "subscription revoked or guest inactive"
        };
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        Repo::mark_delivery_skipped_tx(&mut tx, delivery.id, "suppressed", reason).await?;
        tx.commit().await.map_err(ApiError::from)?;
        return Ok(());
    }

    let outcome = transport
        .send(&OutgoingEmail {
            to: delivery.recipient_email.clone(),
            subject: delivery.subject.clone(),
            body_html: delivery.body_html.clone(),
            body_text: delivery.body_text.clone(),
        })
        .await;

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    match outcome {
        Ok(provider_message_id) => {
            Repo::mark_delivery_sent_tx(&mut tx, delivery.id, provider_message_id.as_deref())
                .await?;
            if let Some(campaign_id) = delivery.campaign_id {
                Repo::add_campaign_counts_tx(&mut tx, campaign_id, 1, 0).await?;
            }
        }
        Err(error) => {
            let error = error.chars().take(500).collect::<String>();
            if delivery.attempts >= delivery.max_attempts {
                Repo::mark_delivery_failed_tx(&mut tx, delivery.id, &error, None).await?;
                if let Some(campaign_id) = delivery.campaign_id {
                    Repo::add_campaign_counts_tx(&mut tx, campaign_id, 0, 1).await?;
                }
                log::warn!(
                    "Delivery {} permanently failed after {} attempts",
                    delivery.id,
                    delivery.attempts
                );
            } else {
                let retry_at =
                    Utc::now() + chrono::Duration::minutes(backoff_minutes(delivery.attempts));
                Repo::mark_delivery_failed_tx(&mut tx, delivery.id, &error, Some(retry_at)).await?;
            }
        }
    }
    tx.commit().await.map_err(ApiError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::backoff_minutes;

    #[test]
    fn backoff_is_exponential_and_capped() {
        assert_eq!(backoff_minutes(1), 2);
        assert_eq!(backoff_minutes(2), 4);
        assert_eq!(backoff_minutes(4), 16);
        assert_eq!(backoff_minutes(10), 60);
        assert_eq!(backoff_minutes(30), 60);
    }
}
