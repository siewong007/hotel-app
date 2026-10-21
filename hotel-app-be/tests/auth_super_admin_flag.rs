//! Sign-in must report `users.is_super_admin` truthfully.
//!
//! `User` maps `is_super_admin` with `#[sqlx(default)]`, and the password,
//! passkey, token-refresh and access-snapshot lookups selected column lists
//! that left it out, so every login response said `is_super_admin: false`.
//! The app hides super-admin-only controls (the system export tier, custom
//! permission editing) on that flag, so super admins never saw them.
//!
//! Same pattern as `rbac_profile.rs`: services and repositories against a real
//! PostgreSQL database, skipping when `DATABASE_URL` is unset. Fixtures use
//! the fixed `928_xxx` block.

use hotel_app_be::AuthService;
use hotel_app_be::models::LoginRequest;
use hotel_app_be::modules::auth::repository::AuthRepository;
use hotel_app_be::modules::auth::service as auth_service;
use hotel_app_be::modules::passkey::repository::PasskeyRepository;
use sqlx::{PgPool, postgres::PgPoolOptions};

const TEST_JWT_SECRET: &str = "hotel-app-be-auth-super-admin-flag-test-secret-32chars";
const SUPER_ADMIN_ID: i64 = 928_001;
const STAFF_ID: i64 = 928_002;
const PASSWORD: &str = "Flag-Test-928-pass!";

fn ensure_test_app_config() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
        if std::env::var("JWT_SECRET").is_err() {
            // SAFETY: runs exactly once, inside `Once::call_once`, before any
            // test in this binary reads config env vars.
            unsafe { std::env::set_var("JWT_SECRET", TEST_JWT_SECRET) };
        }
        let _ = hotel_app_be::core::config::init_from_env();
    });
}

async fn setup_pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping PostgreSQL super-admin flag test because DATABASE_URL is not set");
            return None;
        }
    };

    let pool = PgPoolOptions::new()
        .max_connections(5)
        // The append-only trigger on audit_logs forbids the fixture cleanup
        // below; test pools opt out session-locally.
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET app.allow_audit_mutation = 'on'")
                    .execute(conn)
                    .await
                    .map(|_| ())
            })
        })
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some(pool)
}

/// A role-less staff account (so no 2FA policy applies), reset on every run.
async fn upsert_user(pool: &PgPool, id: i64, username: &str, is_super_admin: bool) {
    let password_hash = AuthService::hash_password(PASSWORD)
        .await
        .expect("bcrypt hashing must succeed");
    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts, locked_until,
            two_factor_enabled, two_factor_secret, two_factor_recovery_codes,
            is_super_admin, deleted_at
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, 'staff', true, true, false, 0, NULL, false, NULL, NULL, $6, NULL)
         ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            password_hash = EXCLUDED.password_hash,
            is_active = true,
            is_locked = false,
            failed_login_attempts = 0,
            locked_until = NULL,
            two_factor_enabled = false,
            two_factor_secret = NULL,
            two_factor_recovery_codes = NULL,
            is_super_admin = EXCLUDED.is_super_admin,
            deleted_at = NULL",
    )
    .bind(id)
    .bind(username)
    .bind(format!("{username}@example.test"))
    .bind(password_hash)
    .bind(format!("Flag Test {id}"))
    .bind(is_super_admin)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

/// Sessions and audit rows the login writes; the users themselves stay for
/// the next run's upsert.
async fn cleanup(pool: &PgPool) {
    let ids = [SUPER_ADMIN_ID, STAFF_ID];
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id = ANY($1)")
        .bind(&ids[..])
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM audit_logs WHERE user_id = ANY($1)")
        .bind(&ids[..])
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn sign_in_reports_the_super_admin_flag() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    ensure_test_app_config();
    upsert_user(&pool, SUPER_ADMIN_ID, "super_admin_flag_928", true).await;
    upsert_user(&pool, STAFF_ID, "staff_flag_928", false).await;

    let by_login = AuthRepository::find_user_by_login(&pool, "super_admin_flag_928")
        .await
        .unwrap()
        .expect("the fixture must be found by username");
    let by_email = AuthRepository::find_user_by_email(&pool, "super_admin_flag_928@example.test")
        .await
        .unwrap()
        .expect("the fixture must be found by email");
    let by_id = AuthRepository::find_user_by_id(&pool, SUPER_ADMIN_ID)
        .await
        .unwrap()
        .expect("the fixture must be found by id");
    let by_passkey_name =
        PasskeyRepository::find_active_user_by_username(&pool, "super_admin_flag_928")
            .await
            .unwrap()
            .expect("the fixture must be found for a passkey sign-in");
    let by_passkey_id = PasskeyRepository::find_active_user_by_id_and_username(
        &pool,
        SUPER_ADMIN_ID,
        "super_admin_flag_928",
    )
    .await
    .unwrap()
    .expect("the fixture must be found for passkey registration");
    let staff = AuthRepository::find_user_by_login(&pool, "staff_flag_928")
        .await
        .unwrap()
        .expect("the staff fixture must be found");

    let login = auth_service::login(
        &pool,
        LoginRequest {
            username: "super_admin_flag_928".to_string(),
            password: PASSWORD.to_string(),
            totp_code: None,
        },
        None,
        None,
        None,
    )
    .await;

    cleanup(&pool).await;

    assert!(by_login.is_super_admin, "password sign-in lookup");
    assert!(by_email.is_super_admin, "lookup by email");
    assert!(by_id.is_super_admin, "refresh and access-snapshot lookup");
    assert!(by_passkey_name.is_super_admin, "passkey sign-in lookup");
    assert!(by_passkey_id.is_super_admin, "passkey registration lookup");
    assert!(!staff.is_super_admin, "an ordinary account stays false");

    let (auth, _refresh_token) = login.expect("the fixture must sign in");
    assert!(
        auth.user.is_super_admin,
        "the login response must carry the flag the app gates on"
    );
}
