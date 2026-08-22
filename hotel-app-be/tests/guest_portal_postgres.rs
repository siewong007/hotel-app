//! PostgreSQL runtime coverage for guest portal persistence.
//!
//! This test is intentionally opt-in through `DATABASE_URL`, matching the
//! existing PostgreSQL workflow tests. It exercises the production `$N`
//! placeholder path.

mod postgres_tests {
    use chrono::Utc;
    use hotel_app_be::models::guest::GuestUpdateInput;
    use hotel_app_be::repositories::guest_portal::GuestPortalRepository;
    use hotel_app_be::repositories::guest_portal_session::GuestPortalSessionRepository;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest portal PostgreSQL test because DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(1)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    #[tokio::test]
    async fn postgres_guest_portal_session_revocation_removes_only_the_target_token() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (full_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Guest Portal PG {suffix}"))
        .bind(format!("guest-portal-pg-{suffix}@hotel.test"))
        .fetch_one(&pool)
        .await
        .expect("insert guest fixture");
        let target = format!("target-{suffix}");
        let other = format!("other-{suffix}");
        for token_hash in [&target, &other] {
            sqlx::query(
                "INSERT INTO guest_portal_sessions (guest_id, token_hash, expires_at) \
                 VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')",
            )
            .bind(guest_id)
            .bind(token_hash)
            .execute(&pool)
            .await
            .expect("insert portal session fixture");
        }

        GuestPortalSessionRepository::delete_session(&pool, &target)
            .await
            .expect("revoke target portal session");

        let rows = sqlx::query(
            "SELECT token_hash FROM guest_portal_sessions WHERE guest_id = $1 ORDER BY token_hash",
        )
        .bind(guest_id)
        .fetch_all(&pool)
        .await
        .expect("read portal sessions");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<String, _>("token_hash"), other);

        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(&pool)
            .await
            .expect("clean up guest portal fixture");
    }

    /// Regression: the portal pre-check-in guest patch used to name the
    /// nonexistent columns `address_line1` and `state_province` (the real
    /// `guests` columns are `address_line_1` and `state`), so every portal
    /// pre-check-in submission aborted with an undefined-column error. The
    /// DTO field names stay camel-case-adjacent (`address_line1`,
    /// `state_province`); only the SQL column names were wrong.
    #[tokio::test]
    async fn postgres_guest_precheckin_persists_address_and_state() {
        let Some(pool) = pool().await else {
            return;
        };
        let suffix = Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .unsigned_abs();
        let guest_id: i64 = sqlx::query_scalar(
            "INSERT INTO guests (full_name, email) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("Precheckin Address {suffix}"))
        .bind(format!("precheckin-address-{suffix}@hotel.test"))
        .fetch_one(&pool)
        .await
        .expect("insert guest fixture");

        let update = GuestUpdateInput {
            address_line1: Some("12 Jalan Isolation".to_string()),
            city: Some("Kuala Lumpur".to_string()),
            state_province: Some("Selangor".to_string()),
            ..Default::default()
        };
        GuestPortalRepository::update_guest_precheckin(&pool, guest_id, &update)
            .await
            .expect("portal pre-checkin guest patch must succeed");

        let (address_line_1, city, state): (String, String, String) =
            sqlx::query_as("SELECT address_line_1, city, state FROM guests WHERE id = $1")
                .bind(guest_id)
                .fetch_one(&pool)
                .await
                .expect("read back patched guest");
        assert_eq!(address_line_1, "12 Jalan Isolation");
        assert_eq!(city, "Kuala Lumpur");
        assert_eq!(state, "Selangor");

        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(&pool)
            .await
            .expect("clean up precheckin fixture");
    }
}
