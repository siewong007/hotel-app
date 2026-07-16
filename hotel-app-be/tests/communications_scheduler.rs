//! Integration tests for campaign fan-out and the birthday voucher job.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use hotel_app_be::core::settings_cache;
    use hotel_app_be::modules::communications::repository::CommunicationsRepository as Repo;
    use hotel_app_be::modules::communications::scheduler;
    use hotel_app_be::modules::communications::transport::Transport;
    use hotel_app_be::modules::communications::worker;
    use sqlx::Row;

    fn ensure_env() {
        // tokens::sign_unsubscribe_token reads JWT_SECRET via core::config.
        unsafe {
            std::env::set_var(
                "JWT_SECRET",
                "communications_test_secret_0123456789abcdef",
            );
        }
    }

    async fn seed_subscribed_guest(pool: &sqlx::SqlitePool, id: i64, topic: &str, email: &str) {
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active) \
             VALUES (?1, 'G', ?2, 'G Test', ?3, 1)",
        )
        .bind(id)
        .bind(format!("T{id}"))
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO notification_subscriptions (guest_id, channel, topic, subscribed) \
             VALUES (?1, 'email', ?2, 1)",
        )
        .bind(id)
        .bind(topic)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn due_campaign_fans_out_to_subscribers_and_completes_via_worker() {
        ensure_env();
        settings_cache::invalidate_all();
        let pool = common_pool().await;
        seed_subscribed_guest(&pool, 9101, "announcement", "a@example.com").await;
        seed_subscribed_guest(&pool, 9102, "announcement", "b@example.com").await;
        // 9103 exists but never subscribed.
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active) \
             VALUES (9103, 'No', 'Sub', 'No Sub', 'c@example.com', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO email_campaigns (id, name, campaign_type, topic, status, subject, body_html, scheduled_at) \
             VALUES (91, 'Fanout', 'announcement', 'announcement', 'scheduled', 'Hello', '<p>news</p>', datetime('now', '-1 minute'))",
        )
        .execute(&pool)
        .await
        .unwrap();

        let expanded = scheduler::tick_campaigns(&pool).await.unwrap();
        assert_eq!(expanded, 2, "only subscribed guests are enqueued");

        let campaign = sqlx::query(
            "SELECT status, total_recipients FROM email_campaigns WHERE id = 91",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(campaign.get::<String, _>("status"), "running");
        assert_eq!(campaign.get::<i64, _>("total_recipients"), 2);

        let bodies: Vec<String> =
            sqlx::query_scalar("SELECT body_html FROM email_deliveries WHERE campaign_id = 91")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(bodies.len(), 2);
        for body in &bodies {
            assert!(
                body.contains("/unsubscribe/"),
                "every campaign email carries an unsubscribe link"
            );
        }
        let excluded: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = 91 AND guest_id = 9103",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(excluded, 0);

        // Second tick is a no-op (campaign no longer 'scheduled').
        assert_eq!(scheduler::tick_campaigns(&pool).await.unwrap(), 0);

        // Worker drains the outbox end-to-end and completes the campaign.
        let (transport, fake) = Transport::fake();
        worker::tick(&pool, &transport, "w-sched", 10).await.unwrap();
        assert_eq!(fake.sent.lock().unwrap().len(), 2);
        let campaign = sqlx::query(
            "SELECT status, sent_count FROM email_campaigns WHERE id = 91",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(campaign.get::<String, _>("status"), "completed");
        assert_eq!(campaign.get::<i64, _>("sent_count"), 2);
    }

    #[tokio::test]
    async fn zero_recipient_campaign_completes_immediately() {
        ensure_env();
        settings_cache::invalidate_all();
        let pool = common_pool().await;
        sqlx::query(
            "INSERT INTO email_campaigns (id, name, campaign_type, topic, status, subject, body_html, scheduled_at) \
             VALUES (92, 'Empty', 'announcement', 'announcement', 'scheduled', 'Hi', '<p>x</p>', datetime('now', '-1 minute'))",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(scheduler::tick_campaigns(&pool).await.unwrap(), 0);
        let status: String =
            sqlx::query_scalar("SELECT status FROM email_campaigns WHERE id = 92")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "completed");
    }

    async fn seed_birthday_config(pool: &sqlx::SqlitePool, promotion_status: &str) {
        for (key, value) in [
            ("birthday_voucher_enabled", "true"),
            ("birthday_promotion_id", "95"),
            ("birthday_voucher_expiry_days", "30"),
            ("hotel_name", "Testotel"),
        ] {
            sqlx::query("INSERT INTO system_settings (key, value) VALUES (?1, ?2) \
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value")
                .bind(key)
                .bind(value)
                .execute(pool)
                .await
                .unwrap();
        }
        sqlx::query(
            "INSERT INTO promotions (id, slug, name, status, promotion_kind, discount_type, discount_value) \
             VALUES (95, 'bday-95', 'Birthday Treat', ?1, 'voucher', 'percentage', 10)",
        )
        .bind(promotion_status)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seed_birthday_guest(pool: &sqlx::SqlitePool, id: i64, email: &str) {
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active, date_of_birth) \
             VALUES (?1, 'Bee', 'Day', 'Bee Day', ?2, 1, '1990-' || strftime('%m-%d', 'now', 'localtime'))",
        )
        .bind(id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO notification_subscriptions (guest_id, channel, topic, subscribed) \
             VALUES (?1, 'email', 'birthday_voucher', 1)",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn birthday_job_issues_voucher_email_and_audit_once_per_year() {
        ensure_env();
        settings_cache::invalidate_all();
        let pool = common_pool().await;
        seed_birthday_config(&pool, "published").await;
        seed_birthday_guest(&pool, 9201, "bday@example.com").await;

        let mut last_run = None;
        let issued = scheduler::tick_birthdays(&pool, &mut last_run).await.unwrap();
        assert_eq!(issued, 1);

        let voucher = sqlx::query(
            "SELECT code, source, source_reference, status FROM vouchers WHERE guest_id = 9201",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(voucher.get::<String, _>("code").starts_with("BDY"));
        assert_eq!(voucher.get::<String, _>("source"), "admin_issue");
        assert!(voucher
            .get::<String, _>("source_reference")
            .starts_with("birthday:"));
        assert_eq!(voucher.get::<String, _>("status"), "available");

        let delivery = sqlx::query(
            "SELECT kind, topic, status, voucher_id, body_html FROM email_deliveries WHERE guest_id = 9201",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(delivery.get::<String, _>("kind"), "birthday_voucher");
        assert_eq!(delivery.get::<String, _>("status"), "queued");
        assert!(delivery.get::<Option<i64>, _>("voucher_id").is_some());
        assert!(delivery.get::<String, _>("body_html").contains("BDY"));
        assert!(delivery.get::<String, _>("body_html").contains("/unsubscribe/"));

        // Audit exists but never leaks the voucher code.
        let audit: String = sqlx::query_scalar(
            "SELECT COALESCE(new_values, '') FROM audit_logs WHERE action = 'voucher.birthday_issued'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!audit.contains("BDY"), "voucher code must not reach audit logs");

        // Same-day guard.
        assert_eq!(
            scheduler::tick_birthdays(&pool, &mut last_run).await.unwrap(),
            0
        );
        // Cross-restart rerun: annual uniqueness prevents double issuance.
        let mut fresh_run = None;
        assert_eq!(
            scheduler::tick_birthdays(&pool, &mut fresh_run).await.unwrap(),
            0
        );
        let vouchers: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM vouchers WHERE guest_id = 9201")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(vouchers, 1);
    }

    #[tokio::test]
    async fn birthday_job_skips_unpublished_promotion_and_prior_promotion_conflict() {
        ensure_env();
        settings_cache::invalidate_all();
        let pool = common_pool().await;
        seed_birthday_config(&pool, "draft").await;
        seed_birthday_guest(&pool, 9301, "bday2@example.com").await;

        // Unpublished promotion → nothing issued.
        let mut last_run = None;
        assert_eq!(
            scheduler::tick_birthdays(&pool, &mut last_run).await.unwrap(),
            0
        );

        // Publish it, but the guest already holds a voucher from this
        // promotion (issued in a previous year) → uq(promotion, guest)
        // conflict skips issuance without enqueueing an email.
        sqlx::query("UPDATE promotions SET status = 'published' WHERE id = 95")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO vouchers (promotion_id, guest_id, code, status, source, source_reference) \
             VALUES (95, 9301, 'BDYOLDYEARCODE0000000AB', 'redeemed', 'admin_issue', 'birthday:2020')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut fresh_run = None;
        assert_eq!(
            scheduler::tick_birthdays(&pool, &mut fresh_run).await.unwrap(),
            0
        );
        let deliveries: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM email_deliveries WHERE guest_id = 9301")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(deliveries, 0, "no email without a freshly issued voucher");
    }

    #[tokio::test]
    async fn feb29_birthdays_match_via_second_pair_in_sql() {
        ensure_env();
        settings_cache::invalidate_all();
        let pool = common_pool().await;
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active, date_of_birth) \
             VALUES (9401, 'Leap', 'Year', 'Leap Year', 'leap@example.com', 1, '1992-02-29')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO notification_subscriptions (guest_id, channel, topic, subscribed) \
             VALUES (9401, 'email', 'birthday_voucher', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let hits = Repo::birthday_targets(&pool, 2, 28, 2, 29, "birthday:2099", 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1, "Feb-29 DOB matches the fallback pair");
        assert_eq!(hits[0].id, 9401);

        let misses = Repo::birthday_targets(&pool, 7, 15, 7, 15, "birthday:2099", 10)
            .await
            .unwrap();
        assert!(misses.is_empty());
    }

    async fn common_pool() -> sqlx::SqlitePool {
        super::common::setup_test_db().await
    }
}
