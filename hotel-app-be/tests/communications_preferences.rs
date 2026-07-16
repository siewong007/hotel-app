//! SQLite integration coverage for guest notification preferences and consent.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use std::collections::HashMap;
    use std::sync::Once;

    use hotel_app_be::core::config;
    use hotel_app_be::modules::communications::{
        models::{PreferenceUpdateInput, SubscriptionUpdateInput, UnsubscribeApplyInput},
        service, tokens,
    };
    use sqlx::Row;

    static INIT: Once = Once::new();

    fn init_config() {
        INIT.call_once(|| {
            // Unsubscribe tokens use the process-global application config.
            // This test binary owns its config singleton, so initialize it once
            // before signing or verifying a token.
            unsafe {
                std::env::set_var(
                    "JWT_SECRET",
                    "communications-preferences-test-secret-key-32-chars",
                );
            }
            config::init_from_env().expect("test configuration should initialize");
        });
    }

    async fn seed_guest(pool: &sqlx::SqlitePool, guest_id: i64, email: &str) {
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, email, is_active) \
             VALUES (?1, 'Preference', 'Guest', 'Preference Guest', ?2, 1)",
        )
        .bind(guest_id)
        .bind(email)
        .execute(pool)
        .await
        .unwrap();
    }

    fn preference_input(states: &[(&str, bool)]) -> PreferenceUpdateInput {
        PreferenceUpdateInput {
            subscriptions: states
                .iter()
                .map(|(topic, subscribed)| SubscriptionUpdateInput {
                    topic: (*topic).to_string(),
                    subscribed: *subscribed,
                })
                .collect(),
            policy_version: Some("notifications-2026-07".to_string()),
        }
    }

    fn subscription_states(
        subscriptions: &[hotel_app_be::modules::communications::models::TopicPreference],
    ) -> HashMap<&str, bool> {
        subscriptions
            .iter()
            .map(|subscription| (subscription.topic.as_str(), subscription.subscribed))
            .collect()
    }

    #[tokio::test]
    async fn guest_preference_updates_persist_subscription_states_and_consent_events() {
        init_config();
        let pool = super::common::setup_test_db().await;
        seed_guest(&pool, 9601, "preference@example.com").await;

        let response = service::update_my_preferences(
            &pool,
            9601,
            preference_input(&[
                ("announcement", true),
                ("promotion", false),
                ("birthday_voucher", true),
            ]),
            Some("203.0.113.10".to_string()),
            Some("preferences-test-agent".to_string()),
        )
        .await
        .expect("preference update should succeed");

        assert_eq!(
            subscription_states(&response.subscriptions),
            HashMap::from([
                ("announcement", true),
                ("promotion", false),
                ("birthday_voucher", true),
            ])
        );

        let subscriptions = sqlx::query(
            "SELECT topic, subscribed, source, policy_version \
             FROM notification_subscriptions WHERE guest_id = ?1 ORDER BY topic",
        )
        .bind(9601)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(subscriptions.len(), 3);
        let persisted_states: HashMap<String, bool> = subscriptions
            .iter()
            .map(|row| {
                assert_eq!(row.get::<String, _>("source"), "guest_portal");
                assert_eq!(
                    row.get::<Option<String>, _>("policy_version").as_deref(),
                    Some("notifications-2026-07")
                );
                (
                    row.get::<String, _>("topic"),
                    row.get::<i64, _>("subscribed") != 0,
                )
            })
            .collect();
        assert_eq!(
            persisted_states,
            HashMap::from([
                ("announcement".to_string(), true),
                ("promotion".to_string(), false),
                ("birthday_voucher".to_string(), true),
            ])
        );

        let events = sqlx::query(
            "SELECT topic, action, source, policy_version, actor_type, actor_user_id \
             FROM notification_consent_events WHERE guest_id = ?1 ORDER BY topic",
        )
        .bind(9601)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(events.len(), 3, "one consent event per changed topic");
        let consent_actions: HashMap<String, String> = events
            .iter()
            .map(|row| {
                assert_eq!(row.get::<String, _>("source"), "guest_portal");
                assert_eq!(
                    row.get::<Option<String>, _>("policy_version").as_deref(),
                    Some("notifications-2026-07")
                );
                assert_eq!(row.get::<String, _>("actor_type"), "guest");
                assert_eq!(row.get::<Option<i64>, _>("actor_user_id"), None);
                (
                    row.get::<String, _>("topic"),
                    row.get::<String, _>("action"),
                )
            })
            .collect();
        assert_eq!(
            consent_actions,
            HashMap::from([
                ("announcement".to_string(), "opt_in".to_string()),
                ("promotion".to_string(), "opt_out".to_string()),
                ("birthday_voucher".to_string(), "opt_in".to_string()),
            ])
        );
    }

    #[tokio::test]
    async fn global_unsubscribe_token_turns_off_every_topic_and_creates_suppression() {
        init_config();
        let pool = super::common::setup_test_db().await;
        seed_guest(&pool, 9602, "All.Topics@Example.COM").await;

        service::update_my_preferences(
            &pool,
            9602,
            preference_input(&[
                ("announcement", true),
                ("promotion", true),
                ("birthday_voucher", true),
            ]),
            None,
            None,
        )
        .await
        .expect("initial opt-in should succeed");
        let token = tokens::sign_unsubscribe_token(9602).expect("token should sign");

        let response = service::unsubscribe_apply(
            &pool,
            &token,
            UnsubscribeApplyInput {
                topic: None,
                global: Some(true),
            },
            Some("203.0.113.11".to_string()),
            Some("unsubscribe-test-agent".to_string()),
        )
        .await
        .expect("global unsubscribe should succeed");

        assert_eq!(
            subscription_states(&response.subscriptions),
            HashMap::from([
                ("announcement", false),
                ("promotion", false),
                ("birthday_voucher", false),
            ])
        );

        let subscriptions = sqlx::query(
            "SELECT topic, subscribed, source FROM notification_subscriptions \
             WHERE guest_id = ?1 ORDER BY topic",
        )
        .bind(9602)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(subscriptions.len(), 3);
        for row in &subscriptions {
            assert_eq!(row.get::<i64, _>("subscribed"), 0);
            assert_eq!(row.get::<String, _>("source"), "unsubscribe_link");
        }

        let opt_out_events: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notification_consent_events \
             WHERE guest_id = ?1 AND action = 'opt_out' AND source = 'unsubscribe_link'",
        )
        .bind(9602)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(opt_out_events, 3, "global unsubscribe records every topic");

        let suppression =
            sqlx::query("SELECT email, reason, source FROM email_suppressions WHERE email = ?1")
                .bind("all.topics@example.com")
                .fetch_one(&pool)
                .await
                .expect("global unsubscribe should create an email suppression");
        assert_eq!(
            suppression.get::<String, _>("email"),
            "all.topics@example.com"
        );
        assert_eq!(suppression.get::<String, _>("reason"), "unsubscribe");
        assert_eq!(
            suppression.get::<Option<String>, _>("source").as_deref(),
            Some("unsubscribe_link")
        );
    }
}
