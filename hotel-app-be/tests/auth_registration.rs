//! Registration coverage for phone-first guest accounts.

mod common;

#[cfg(all(feature = "sqlite", not(feature = "postgres")))]
mod sqlite_tests {
    use crate::common;
    use hotel_app_be::models::RegisterRequest;
    use hotel_app_be::services::auth;

    #[tokio::test]
    async fn registers_guest_without_email_and_persists_phone_and_address() {
        let pool = common::setup_test_db().await;
        let request = RegisterRequest {
            username: "phone_guest".to_string(),
            email: None,
            password: "PhoneGuest#2026".to_string(),
            full_name: None,
            first_name: "Phone".to_string(),
            last_name: "Guest".to_string(),
            phone: "+60123456789".to_string(),
            address_line1: Some("12 Jalan Example".to_string()),
        };

        let response = auth::register(&pool, request)
            .await
            .expect("phone-first registration should succeed");

        assert_eq!(response["user"]["email"], serde_json::Value::Null);
        assert_eq!(response["user"]["is_verified"], true);

        let user: (String, String, bool) =
            sqlx::query_as("SELECT email, phone, is_verified FROM users WHERE username = ?1")
                .bind("phone_guest")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(user.0, "phone_guest@no-email.invalid");
        assert_eq!(user.1, "+60123456789");
        assert!(user.2);

        let guest: (Option<String>, String, Option<String>) =
            sqlx::query_as("SELECT email, phone, address_line1 FROM guests WHERE full_name = ?1")
                .bind("Phone Guest")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(guest.0, None);
        assert_eq!(guest.1, "+60123456789");
        assert_eq!(guest.2.as_deref(), Some("12 Jalan Example"));
    }

    #[tokio::test]
    async fn duplicate_guest_name_returns_conflict_without_creating_user() {
        let pool = common::setup_test_db().await;
        sqlx::query(
            "INSERT INTO guests (first_name, last_name, full_name, phone) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind("Existing")
        .bind("Guest")
        .bind("Existing Guest")
        .bind("+60111111111")
        .execute(&pool)
        .await
        .unwrap();

        let request = RegisterRequest {
            username: "existing_guest".to_string(),
            email: None,
            password: "ExistingGuest#2026".to_string(),
            full_name: None,
            first_name: "Existing".to_string(),
            last_name: "Guest".to_string(),
            phone: "+60222222222".to_string(),
            address_line1: None,
        };

        let error = auth::register(&pool, request)
            .await
            .expect_err("duplicate guest names must return a conflict");

        match error {
            hotel_app_be::core::error::ApiError::Conflict(message) => {
                assert!(message.contains("guest profile with this name already exists"));
            }
            other => panic!("expected conflict error, got {other}"),
        }

        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE username = ?1")
            .bind("existing_guest")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(user_count, 0);
    }
}
