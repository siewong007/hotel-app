//! Integration tests for the durable email delivery outbox and worker.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use std::sync::{Arc, Mutex};

    use hotel_app_be::modules::communications::repository::CommunicationsRepository as Repo;
    use hotel_app_be::modules::communications::transport::{FakeMailer, Transport};
    use hotel_app_be::modules::communications::worker;
    use sqlx::Row;

    async fn seed_guest_campaign(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active) \
             VALUES (7001, 'Out', 'Box', 'Out Box', 'outbox@example.com', 1)",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO notification_subscriptions (guest_id, channel, topic, subscribed) \
             VALUES (7001, 'email', 'announcement', 1)",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO email_campaigns (id, name, campaign_type, topic, status, subject, body_html) \
             VALUES (71, 'Outbox Test', 'announcement', 'announcement', 'running', 'Hi', '<p>b</p>')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn enqueue(pool: &sqlx::SqlitePool, key: &str) -> Option<i64> {
        let mut tx = pool.begin().await.unwrap();
        let id = Repo::insert_delivery_tx(
            &mut tx,
            Some(71),
            "campaign",
            7001,
            "announcement",
            "outbox@example.com",
            "Hi",
            "<p>b</p>",
            None,
            None,
            key,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        id
    }

    async fn delivery_row(pool: &sqlx::SqlitePool, id: i64) -> (String, i64, Option<String>) {
        let row = sqlx::query(
            "SELECT status, attempts, provider_message_id FROM email_deliveries WHERE id = ?1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
        (
            row.get::<String, _>("status"),
            row.get::<i64, _>("attempts"),
            row.get::<Option<String>, _>("provider_message_id"),
        )
    }

    fn failing_transport(reason: &str) -> Transport {
        Transport::Fake(Arc::new(FakeMailer {
            sent: Mutex::new(Vec::new()),
            fail_with: Some(reason.to_string()),
        }))
    }

    #[tokio::test]
    async fn success_path_sends_counts_and_completes_campaign() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        let id = enqueue(&pool, "k-success")
            .await
            .expect("first enqueue inserts");

        let (transport, fake) = Transport::fake();
        let processed = worker::tick(&pool, &transport, "w-test", 10).await.unwrap();
        assert_eq!(processed, 1);
        assert_eq!(fake.sent.lock().unwrap().len(), 1);

        let (status, attempts, provider_id) = delivery_row(&pool, id).await;
        assert_eq!(status, "sent");
        assert_eq!(attempts, 1);
        assert!(provider_id.is_some());

        let row = sqlx::query("SELECT status, sent_count FROM email_campaigns WHERE id = 71")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("status"), "completed");
        assert_eq!(row.get::<i64, _>("sent_count"), 1);
    }

    #[tokio::test]
    async fn duplicate_idempotency_key_is_suppressed() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        assert!(enqueue(&pool, "k-dup").await.is_some());
        assert!(
            enqueue(&pool, "k-dup").await.is_none(),
            "duplicate key must return None"
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn failure_requeues_with_backoff_then_succeeds_on_retry() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        let id = enqueue(&pool, "k-retry").await.unwrap();

        let transport = failing_transport("smtp boom");
        worker::tick(&pool, &transport, "w-test", 10).await.unwrap();
        let (status, attempts, _) = delivery_row(&pool, id).await;
        assert_eq!(status, "queued", "non-terminal failure requeues");
        assert_eq!(attempts, 1);
        let future: i64 = sqlx::query_scalar(
            "SELECT datetime(next_attempt_at) > datetime('now') FROM email_deliveries WHERE id = ?1",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(future, 1, "next attempt must be in the future");

        // Not yet due → a tick claims nothing.
        let (transport_ok, fake) = Transport::fake();
        assert_eq!(
            worker::tick(&pool, &transport_ok, "w-test", 10)
                .await
                .unwrap(),
            0
        );

        // Force due, retry succeeds.
        sqlx::query(
            "UPDATE email_deliveries SET next_attempt_at = datetime('now', '-1 minute') WHERE id = ?1",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        worker::tick(&pool, &transport_ok, "w-test", 10)
            .await
            .unwrap();
        let (status, attempts, _) = delivery_row(&pool, id).await;
        assert_eq!(status, "sent");
        assert_eq!(attempts, 2);
        assert_eq!(fake.sent.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn exhausted_attempts_fail_terminally_and_count() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        let id = enqueue(&pool, "k-fail").await.unwrap();
        sqlx::query("UPDATE email_deliveries SET attempts = 4 WHERE id = ?1")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let transport = failing_transport("permanent boom");
        worker::tick(&pool, &transport, "w-test", 10).await.unwrap();
        let (status, attempts, _) = delivery_row(&pool, id).await;
        assert_eq!(status, "failed");
        assert_eq!(attempts, 5);
        let row = sqlx::query("SELECT status, failed_count FROM email_campaigns WHERE id = 71")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<i64, _>("failed_count"), 1);
        assert_eq!(
            row.get::<String, _>("status"),
            "completed",
            "campaign completes once nothing is in flight"
        );
    }

    #[tokio::test]
    async fn late_unsubscribe_and_suppression_block_queued_mail() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        let unsub_id = enqueue(&pool, "k-unsub").await.unwrap();

        // Guest revokes consent AFTER the delivery was queued.
        sqlx::query("UPDATE notification_subscriptions SET subscribed = 0 WHERE guest_id = 7001")
            .bind(unsub_id)
            .execute(&pool)
            .await
            .unwrap();
        let (transport, fake) = Transport::fake();
        worker::tick(&pool, &transport, "w-test", 10).await.unwrap();
        let (status, _, _) = delivery_row(&pool, unsub_id).await;
        assert_eq!(status, "suppressed");
        assert!(fake.sent.lock().unwrap().is_empty(), "nothing may be sent");

        // Re-subscribe, but the address lands on the suppression list.
        sqlx::query("UPDATE notification_subscriptions SET subscribed = 1 WHERE guest_id = 7001")
            .execute(&pool)
            .await
            .unwrap();
        let sup_id = enqueue(&pool, "k-suppressed").await.unwrap();
        sqlx::query(
            "INSERT INTO email_suppressions (email, reason) VALUES ('outbox@example.com', 'unsubscribe')",
        )
        .execute(&pool)
        .await
        .unwrap();
        worker::tick(&pool, &transport, "w-test", 10).await.unwrap();
        let (status, _, _) = delivery_row(&pool, sup_id).await;
        assert_eq!(status, "suppressed");
        assert!(fake.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn expired_lease_is_reclaimed_after_restart() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        let id = enqueue(&pool, "k-lease").await.unwrap();

        // Simulate a worker that died mid-send: sending + expired lease.
        sqlx::query(
            "UPDATE email_deliveries SET status = 'sending', lease_owner = 'w-dead', \
             lease_expires_at = datetime('now', '-1 minute') WHERE id = ?1",
        )
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

        let (transport, fake) = Transport::fake();
        let processed = worker::tick(&pool, &transport, "w-new", 10).await.unwrap();
        assert_eq!(processed, 1, "expired lease must be reclaimed");
        let (status, attempts, _) = delivery_row(&pool, id).await;
        assert_eq!(status, "sent");
        assert_eq!(attempts, 1);
        assert_eq!(fake.sent.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cancelled_campaign_drops_queued_deliveries() {
        let pool = super::common::setup_test_db().await;
        seed_guest_campaign(&pool).await;
        let id = enqueue(&pool, "k-cancel").await.unwrap();
        sqlx::query("UPDATE email_campaigns SET status = 'cancelled' WHERE id = 71")
            .execute(&pool)
            .await
            .unwrap();

        let (transport, fake) = Transport::fake();
        worker::tick(&pool, &transport, "w-test", 10).await.unwrap();
        let (status, _, _) = delivery_row(&pool, id).await;
        assert_eq!(status, "cancelled");
        assert!(fake.sent.lock().unwrap().is_empty());
    }
}
