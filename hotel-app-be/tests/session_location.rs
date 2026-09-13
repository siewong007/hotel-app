//! The approximate sign-in location shown against a signed-in device.
//!
//! `refresh_tokens.client_timezone` is written on every sign-in and read back
//! by `services::profile::list_sessions`. This codebase uses plain
//! `sqlx::query`, not the checking macros, so a column that does not exist or
//! decodes to the wrong Rust type compiles cleanly and fails at runtime — only
//! a live round trip proves the whole path.
//!
//! In its own file rather than in `auth_session.rs` so its fixtures cannot
//! collide with that file's; ids here are in an otherwise unused block.

use hotel_app_be::AuthService;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};

const TEST_JWT_SECRET: &str = "hotel-app-be-session-location-test-secret-32chars";

/// Ids used only by this file. Verified against every other `tests/` fixture id.
const TIMEZONE_USER_ID: i64 = 994_101;
const NO_TIMEZONE_USER_ID: i64 = 994_102;

fn ensure_test_app_config() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
        if std::env::var("JWT_SECRET").is_err() {
            // SAFETY: runs exactly once, inside `Once::call_once`, before any
            // test in this binary reads the auth/config env vars.
            unsafe { std::env::set_var("JWT_SECRET", TEST_JWT_SECRET) };
        }
        let _ = hotel_app_be::core::config::init_from_env();
    });
}

async fn setup_pg_pool() -> Option<PgPool> {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        eprintln!("Skipping PostgreSQL session-location test because DATABASE_URL is not set");
        return None;
    };
    ensure_test_app_config();
    Some(
        PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database"),
    )
}

async fn upsert_test_user(pool: &PgPool, user_id: i64, username: &str) {
    let password_hash = AuthService::hash_password("SessionLocation!234")
        .await
        .expect("bcrypt hashing must succeed");
    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts,
            locked_until, two_factor_enabled, last_login_at, deleted_at
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, 'staff', true, true, false, 0, NULL, false, NULL, NULL)
         ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            password_hash = EXCLUDED.password_hash,
            is_active = true,
            deleted_at = NULL",
    )
    .bind(user_id)
    .bind(username)
    .bind(format!("{username}@example.test"))
    .bind(password_hash)
    .bind(format!("Session Location Test {user_id}"))
    .execute(pool)
    .await
    .unwrap();
}

/// Cleans up BEFORE any assertion that can panic, so a failed run does not
/// poison the next one (`refresh_tokens.user_id` cascades from `users`, but
/// the row is deleted explicitly so the intent is not load-bearing on the FK).
async fn cleanup(pool: &PgPool, user_id: i64) {
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
}

/// A timezone supplied at sign-in survives the round trip and becomes the
/// human-readable location, while the IP is still masked.
#[tokio::test]
async fn postgres_session_timezone_becomes_an_approximate_location() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, TIMEZONE_USER_ID).await;
    upsert_test_user(&pool, TIMEZONE_USER_ID, "session_location_tz").await;

    let refresh_token = AuthService::generate_refresh_token();
    let session_id = AuthService::store_refresh_token(
        &pool,
        TIMEZONE_USER_ID,
        &refresh_token,
        30,
        Some("203.0.113.42"),
        Some("Mozilla/5.0 (Macintosh; MacBook Pro)"),
        Some("Asia/Kuala_Lumpur"),
    )
    .await
    .expect("storing a refresh token with a timezone must succeed");

    let sessions = hotel_app_be::services::profile::list_sessions(
        &pool,
        TIMEZONE_USER_ID,
        Some(session_id.as_str()),
    )
    .await
    .expect("listing sessions must succeed");

    let found = sessions.iter().find(|s| s.id == session_id).cloned();
    cleanup(&pool, TIMEZONE_USER_ID).await;

    let found = found.expect("the session just stored must be listed");
    assert_eq!(
        found.location.as_deref(),
        Some("Kuala Lumpur"),
        "the IANA zone must render as a place name"
    );
    assert_eq!(found.timezone.as_deref(), Some("Asia/Kuala_Lumpur"));
    assert!(found.is_current, "the current session must be flagged");
    // The location must not have come at the cost of the IP masking.
    assert_eq!(
        found.ip_address.as_deref(),
        Some("203.0.113.•••"),
        "the IP must still be masked"
    );
}

/// A session stored without a timezone — every session minted before this
/// column existed — must list cleanly with no location rather than erroring.
#[tokio::test]
async fn postgres_session_without_a_timezone_reports_no_location() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, NO_TIMEZONE_USER_ID).await;
    upsert_test_user(&pool, NO_TIMEZONE_USER_ID, "session_location_none").await;

    let refresh_token = AuthService::generate_refresh_token();
    let session_id = AuthService::store_refresh_token(
        &pool,
        NO_TIMEZONE_USER_ID,
        &refresh_token,
        30,
        Some("203.0.113.43"),
        Some("Mozilla/5.0 (Windows NT 10.0)"),
        None,
    )
    .await
    .expect("storing a refresh token without a timezone must succeed");

    let stored_is_null: bool = sqlx::query(
        "SELECT client_timezone IS NULL AS is_null FROM refresh_tokens WHERE id = $1::uuid",
    )
    .bind(&session_id)
    .fetch_one(&pool)
    .await
    .expect("the stored row must be readable")
    .get("is_null");

    let sessions = hotel_app_be::services::profile::list_sessions(&pool, NO_TIMEZONE_USER_ID, None)
        .await
        .expect("listing sessions must succeed");
    let found = sessions.iter().find(|s| s.id == session_id).cloned();
    cleanup(&pool, NO_TIMEZONE_USER_ID).await;

    assert!(stored_is_null, "an absent timezone must be stored as NULL");
    let found = found.expect("the session just stored must be listed");
    assert_eq!(found.location, None);
    assert_eq!(found.timezone, None);
    assert!(!found.is_current, "no current session id was supplied");
}
