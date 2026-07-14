mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::UserProfileUpdate;
    use hotel_app_be::services::profile;

    async fn seed_guest_without_email(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO guests (id, first_name, last_name, full_name, phone) \
             VALUES (9701, 'Portal', 'Guest', 'Portal Guest', '60123456789')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO users (id, uuid, username, email, password_hash, full_name, user_type, \
             guest_id, is_active, is_verified) VALUES (9701, \
             '00000000-0000-0000-0000-000000009701', 'portalguest', \
             'portalguest@no-email.invalid', 'hash', 'Portal Guest', 'guest', 9701, 1, 1)",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    fn email_update(email: &str) -> UserProfileUpdate {
        UserProfileUpdate {
            full_name: None,
            email: Some(email.to_string()),
            phone: None,
            avatar_url: None,
        }
    }

    #[tokio::test]
    async fn guest_can_configure_email_once_and_profile_reports_pending_verification() {
        let pool = common::setup_test_db().await;
        seed_guest_without_email(&pool).await;

        let before = profile::get_user_profile(&pool, 9701).await.unwrap();
        assert_eq!(before.email, "");
        assert!(!before.email_configured);

        let updated =
            profile::update_user_profile(&pool, 9701, email_update(" Portal.Guest@Example.COM "))
                .await
                .unwrap();

        assert_eq!(updated.email, "portal.guest@example.com");
        assert!(updated.email_configured);
        assert!(!updated.is_verified);

        let guest_email: Option<String> =
            sqlx::query_scalar("SELECT email FROM guests WHERE id = 9701")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(guest_email.as_deref(), Some("portal.guest@example.com"));

        let token: Option<String> =
            sqlx::query_scalar("SELECT email_verification_token FROM users WHERE id = 9701")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(token.is_some());
    }

    #[tokio::test]
    async fn guest_cannot_replace_an_already_configured_email() {
        let pool = common::setup_test_db().await;
        seed_guest_without_email(&pool).await;
        profile::update_user_profile(&pool, 9701, email_update("first@example.com"))
            .await
            .unwrap();

        let error = profile::update_user_profile(&pool, 9701, email_update("second@example.com"))
            .await
            .unwrap_err();

        assert!(
            matches!(error, ApiError::BadRequest(message) if message.contains("already configured"))
        );
    }
}
