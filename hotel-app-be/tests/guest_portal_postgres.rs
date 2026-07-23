//! PostgreSQL runtime coverage for guest portal persistence.
//!
//! This test is intentionally opt-in through `DATABASE_URL`, matching the
//! existing PostgreSQL workflow tests. It exercises the production `$N`
//! placeholder path.

mod postgres_tests {
    use chrono::Utc;
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
}
