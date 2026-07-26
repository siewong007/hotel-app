//! Integration tests for the auth session lifecycle: password login, JWT
//! validation, refresh-token rotation, and logout/session invalidation.
//!
//! `src/core/auth.rs` unit tests cover primitives (hashing, TOTP, password
//! rules) in isolation. This file exercises the `services::auth` workflow
//! functions end-to-end against PostgreSQL, the same way
//! `tests/booking_service.rs` exercises `services::bookings`.

use chrono::{Duration, Utc};
use hotel_app_be::{AuthService, Claims};
use jsonwebtoken::{EncodingKey, Header, encode, errors::ErrorKind};

/// The JWT secret this test binary signs/verifies with. Deliberately distinct
/// from any real deployment secret; `ensure_test_app_config` (postgres tests)
/// and this test both seed `AuthService`'s secret `OnceLock` with the exact
/// same constant so hand-crafted tokens below are comparable to real ones.
const TEST_JWT_SECRET: &str = "hotel-app-be-auth-session-test-secret-32chars-minimum";

fn ensure_jwt_secret() {
    // `init_jwt_secret` only ever wins the underlying `OnceLock` once; later
    // calls (including the one inside `ensure_test_app_config`) are no-ops
    // that leave this same secret in place.
    let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
}

fn build_claims(user_id: i64, exp: Option<usize>, sid: &str) -> Claims {
    Claims {
        sub: user_id.to_string(),
        username: "auth_session_jwt_check".to_string(),
        iss: "hotel-app-be".to_string(),
        aud: "hotel-web".to_string(),
        exp,
        iat: Utc::now().timestamp() as usize,
        roles: vec!["staff".to_string()],
        sid: Some(sid.to_string()),
    }
}

/// A JWT signed with the wrong secret must be rejected regardless of an
/// otherwise-valid, unexpired payload.
#[test]
fn jwt_with_wrong_signature_is_rejected() {
    ensure_jwt_secret();

    let future_exp = Some((Utc::now() + Duration::minutes(30)).timestamp() as usize);
    let claims = build_claims(970_901, future_exp, "wrong-signature-session");
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(b"a-completely-different-secret-not-used-by-the-app"),
    )
    .expect("encoding with an arbitrary secret must succeed");

    let result = AuthService::verify_jwt(&token);
    assert!(
        result.is_err(),
        "a token signed with the wrong secret must fail verification"
    );
    assert_eq!(*result.unwrap_err().kind(), ErrorKind::InvalidSignature);
}

/// An expired JWT (valid signature, `exp` in the past) must be rejected.
#[test]
fn jwt_that_has_expired_is_rejected() {
    ensure_jwt_secret();

    let past_exp = Some((Utc::now() - Duration::hours(1)).timestamp() as usize);
    let claims = build_claims(970_902, past_exp, "expired-session");
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .expect("encoding with the app's own secret must succeed");

    let result = AuthService::verify_jwt(&token);
    assert!(result.is_err(), "an expired token must fail verification");
    assert_eq!(*result.unwrap_err().kind(), ErrorKind::ExpiredSignature);
}

// ---------------------------------------------------------------------------
// PostgreSQL workflow tests — require DATABASE_URL, skip gracefully without it
// ---------------------------------------------------------------------------

mod postgres_tests {
    use super::{TEST_JWT_SECRET, ensure_jwt_secret};
    use chrono::{DateTime, Utc};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::auth::{LoginRequest, RefreshTokenRequest};
    use hotel_app_be::services::auth as auth_service;
    use hotel_app_be::AuthService;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    /// `services::auth::login` hard-requires `core::config::get()` (for the
    /// `skip_email_verification` check), unlike the booking workflow tested in
    /// `booking_service.rs`. Seed a minimal, self-contained `AppConfig` once
    /// per test process so these tests don't depend on a real `JWT_SECRET`
    /// being exported by whoever runs `cargo test`.
    fn ensure_test_app_config() {
        static INIT: std::sync::Once = std::sync::Once::new();
        INIT.call_once(|| {
            // Lock in the JWT secret used for signing/verification first, so
            // it is deterministic regardless of what `JWT_SECRET` (if
            // anything) is already present in the process environment.
            ensure_jwt_secret();

            if std::env::var("JWT_SECRET").is_err() {
                // SAFETY: runs exactly once, inside `Once::call_once`, before
                // any test in this binary reads the auth/config env vars it
                // touches -- required so `AppConfig::from_env` (which
                // `services::auth::login` needs) can initialize without a
                // real deployment secret being exported by the caller.
                unsafe { std::env::set_var("JWT_SECRET", TEST_JWT_SECRET) };
            }
            let _ = hotel_app_be::core::config::init_from_env();
        });
    }

    async fn setup_pg_pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping PostgreSQL auth-session test because DATABASE_URL is not set");
                return None;
            }
        };
        ensure_test_app_config();

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some(pool)
    }

    /// Upserts a dedicated, fully-reset test user (never depends on the
    /// seeded admin's password) so reruns against the persistent dev DB are
    /// deterministic regardless of prior test runs.
    async fn upsert_test_user(pool: &PgPool, user_id: i64, username: &str, email: &str, password: &str) {
        let password_hash = AuthService::hash_password(password)
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
                full_name = EXCLUDED.full_name,
                is_active = true,
                is_verified = true,
                is_locked = false,
                failed_login_attempts = 0,
                locked_until = NULL,
                two_factor_enabled = false,
                last_login_at = NULL,
                deleted_at = NULL",
        )
        .bind(user_id)
        .bind(username)
        .bind(email)
        .bind(password_hash)
        .bind(format!("Auth Session Test User {user_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_auth_fixture(pool: &PgPool, user_id: i64) {
        sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'user' AND resource_id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
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

    #[tokio::test]
    async fn postgres_login_mints_access_token_and_session() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 970_001;
        let username = format!("auth_session_login_{user_id}");
        let email = format!("auth-session-login-{user_id}@hotel.local");
        let password = "S3cure!Passw0rd-Login";

        cleanup_auth_fixture(&pool, user_id).await;
        upsert_test_user(&pool, user_id, &username, &email, password).await;

        let (auth_response, refresh_token) = auth_service::login(
            &pool,
            LoginRequest {
                username: username.clone(),
                password: password.to_string(),
                totp_code: None,
            },
            Some("127.0.0.1"),
            Some("auth-session-test-agent"),
        )
        .await
        .expect("login with correct credentials should succeed");

        assert!(!auth_response.access_token.is_empty());
        assert_eq!(
            refresh_token.len(),
            64,
            "refresh token should be 32 random bytes, hex-encoded"
        );

        let claims = AuthService::verify_jwt(&auth_response.access_token)
            .expect("a freshly minted access token must verify");
        assert_eq!(claims.sub, user_id.to_string());
        let session_id = claims
            .sid
            .clone()
            .expect("a login-minted token must carry a sid claim");

        // The refresh token itself is never stored in plaintext -- only its
        // hash. Rehash it the same way `store_refresh_token` does and confirm
        // exactly one live session row backs it.
        let token_hash = AuthService::hash_refresh_token(&refresh_token);
        let row = sqlx::query(
            "SELECT id::text AS id, is_revoked, revoked_at, host(ip_address) AS ip_address, \
                    user_agent, expires_at > CURRENT_TIMESTAMP AS not_expired \
             FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2",
        )
        .bind(user_id)
        .bind(&token_hash)
        .fetch_one(&pool)
        .await
        .expect("login must persist a matching refresh_tokens session row");

        assert_eq!(
            row.get::<String, _>("id"),
            session_id,
            "the access token's sid must match the minted session row's id"
        );
        assert!(!row.get::<bool, _>("is_revoked"));
        assert!(row.get::<Option<DateTime<Utc>>, _>("revoked_at").is_none());
        assert!(row.get::<bool, _>("not_expired"));
        assert_eq!(row.get::<Option<String>, _>("ip_address"), Some("127.0.0.1".to_string()));
        assert_eq!(
            row.get::<Option<String>, _>("user_agent"),
            Some("auth-session-test-agent".to_string())
        );

        cleanup_auth_fixture(&pool, user_id).await;
    }

    #[tokio::test]
    async fn postgres_refresh_rotates_access_and_refresh_tokens() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 970_002;
        let username = format!("auth_session_refresh_{user_id}");
        let email = format!("auth-session-refresh-{user_id}@hotel.local");
        let password = "S3cure!Passw0rd-Refresh";

        cleanup_auth_fixture(&pool, user_id).await;
        upsert_test_user(&pool, user_id, &username, &email, password).await;

        let (auth_response, refresh_token_1) = auth_service::login(
            &pool,
            LoginRequest {
                username: username.clone(),
                password: password.to_string(),
                totp_code: None,
            },
            None,
            None,
        )
        .await
        .expect("login should succeed");
        let session_id = AuthService::verify_jwt(&auth_response.access_token)
            .expect("initial access token must verify")
            .sid
            .expect("initial access token must carry a sid");

        let refreshed = auth_service::refresh_token(
            &pool,
            RefreshTokenRequest {
                refresh_token: refresh_token_1.clone(),
            },
        )
        .await
        .expect("refreshing a valid, unexpired token should succeed");

        assert_ne!(
            refreshed.refresh_token, refresh_token_1,
            "the refresh token must rotate on every use"
        );
        // NOTE: the access token is NOT asserted to differ from the pre-refresh
        // one. Its claims (sub, roles, sid, iat/exp truncated to whole seconds)
        // can be byte-identical to the original when login and refresh land in
        // the same wall-clock second, which happens routinely in a fast test --
        // that produces the exact same HMAC signature, not a bug. The refresh
        // token's freshness (asserted above) is the real, unconditional
        // guarantee; access-token freshness is only guaranteed by `iat`/`exp`
        // once a second boundary elapses.

        let rotated_claims = AuthService::verify_jwt(&refreshed.access_token)
            .expect("the rotated access token must verify");
        assert_eq!(
            rotated_claims.sid.as_deref(),
            Some(session_id.as_str()),
            "rotation must preserve the same session id"
        );

        // The old refresh token was consumed by the rotation above; replaying
        // it must now fail.
        let replay = auth_service::refresh_token(
            &pool,
            RefreshTokenRequest {
                refresh_token: refresh_token_1,
            },
        )
        .await;
        assert!(
            matches!(replay, Err(ApiError::Unauthorized(_))),
            "a rotated-away refresh token must be rejected, got: {replay:?}"
        );

        // Exactly one session row remains, now hashing the NEW token.
        let stored_hash: String =
            sqlx::query_scalar("SELECT token_hash FROM refresh_tokens WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_hash, AuthService::hash_refresh_token(&refreshed.refresh_token));

        cleanup_auth_fixture(&pool, user_id).await;
    }

    #[tokio::test]
    async fn postgres_logout_invalidates_session_and_blocks_refresh() {
        let Some(pool) = setup_pg_pool().await else {
            return;
        };
        let user_id = 970_003;
        let username = format!("auth_session_logout_{user_id}");
        let email = format!("auth-session-logout-{user_id}@hotel.local");
        let password = "S3cure!Passw0rd-Logout";

        cleanup_auth_fixture(&pool, user_id).await;
        upsert_test_user(&pool, user_id, &username, &email, password).await;

        let (auth_response, refresh_token) = auth_service::login(
            &pool,
            LoginRequest {
                username: username.clone(),
                password: password.to_string(),
                totp_code: None,
            },
            None,
            None,
        )
        .await
        .expect("login should succeed");
        let session_id = AuthService::verify_jwt(&auth_response.access_token)
            .expect("access token must verify")
            .sid
            .expect("access token must carry a sid");

        assert!(
            AuthService::is_session_active(&pool, user_id, &session_id)
                .await
                .unwrap(),
            "the session should be active immediately after login"
        );

        auth_service::logout(
            &pool,
            RefreshTokenRequest {
                refresh_token: refresh_token.clone(),
            },
        )
        .await
        .expect("logout should revoke the refresh token");

        let row = sqlx::query("SELECT is_revoked, revoked_at FROM refresh_tokens WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(row.get::<bool, _>("is_revoked"), "logout must mark the session revoked");
        assert!(
            row.get::<Option<DateTime<Utc>>, _>("revoked_at").is_some(),
            "logout must stamp revoked_at"
        );

        assert!(
            !AuthService::is_session_active(&pool, user_id, &session_id)
                .await
                .unwrap(),
            "a logged-out session must no longer be reported active"
        );

        let refresh_after_logout = auth_service::refresh_token(
            &pool,
            RefreshTokenRequest { refresh_token },
        )
        .await;
        assert!(
            matches!(refresh_after_logout, Err(ApiError::Unauthorized(_))),
            "refreshing with a logged-out token must fail, got: {refresh_after_logout:?}"
        );

        // Session invalidation on logout is enforced by the refresh-token and
        // is_session_active checks above; the JWT itself is stateless and
        // remains cryptographically valid until its own `exp` elapses (see
        // core/middleware.rs::require_auth, which never re-checks the DB).
        assert!(
            AuthService::verify_jwt(&auth_response.access_token).is_ok(),
            "the already-issued access token remains verifiable (stateless JWT) after logout"
        );

        cleanup_auth_fixture(&pool, user_id).await;
    }
}
