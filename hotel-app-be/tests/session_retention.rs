//! Session retention: the hourly purge and the per-user live-session cap.
//!
//! `refresh_tokens` is shared by every PostgreSQL test in the suite, and the
//! purge is table-wide by design. So the fixtures here are dated thousands of
//! days in the past and the policy uses matching multi-year grace periods:
//! only rows this file wrote can qualify, and a concurrently running test's
//! freshly expired or revoked session is never deleted under it.

use hotel_app_be::AuthService;
use hotel_app_be::modules::auth::session_retention::{RetentionPolicy, enforce_session_cap, purge};
use sqlx::{PgPool, postgres::PgPoolOptions};

const TEST_JWT_SECRET: &str = "hotel-app-be-session-retention-test-secret-32chars";

/// Ids used only by this file (the 995_5xx block is otherwise unused).
const PURGE_USER_ID: i64 = 995_501;
const CAP_USER_ID: i64 = 995_502;
const IDLE_USER_ID: i64 = 995_503;
const LOGIN_CAP_USER_ID: i64 = 995_504;

/// Grace used by the purge tests. Fixtures that must go are older than this;
/// fixtures that must stay are newer but still years old.
const GRACE_DAYS: i32 = 3_650;

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
        eprintln!("Skipping PostgreSQL session-retention test because DATABASE_URL is not set");
        return None;
    };
    ensure_test_app_config();
    Some(
        PgPoolOptions::new()
            .max_connections(5)
            // Fixture cleanup deletes users, which SET NULLs audit_logs; the
            // append-only trigger forbids that, so test pools opt out
            // session-locally.
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
            .expect("failed to connect to PostgreSQL test database"),
    )
}

async fn upsert_test_user(pool: &PgPool, user_id: i64, username: &str) {
    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts,
            locked_until, two_factor_enabled, last_login_at, deleted_at
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, 'not-a-real-hash', $4, 'staff', true, true, false, 0, NULL, false, NULL, NULL)
         ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            email = EXCLUDED.email,
            is_active = true,
            deleted_at = NULL",
    )
    .bind(user_id)
    .bind(username)
    .bind(format!("{username}@example.test"))
    .bind(format!("Session Retention Test {user_id}"))
    .execute(pool)
    .await
    .unwrap();
}

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

/// Insert one session row with explicit timestamps (`days_ago` relative to
/// now; negative means in the future). Returns its id.
async fn insert_session(
    pool: &PgPool,
    user_id: i64,
    label: &str,
    created_days_ago: i32,
    last_used_days_ago: i32,
    expires_days_ago: i32,
    revoked_days_ago: Option<i32>,
) -> String {
    let token_hash = AuthService::hash_refresh_token(&AuthService::generate_refresh_token());
    sqlx::query_scalar::<_, String>(
        "INSERT INTO refresh_tokens
            (user_id, token_hash, user_agent, created_at, last_used_at, expires_at,
             is_revoked, revoked_at)
         VALUES ($1, $2, $3,
                 CURRENT_TIMESTAMP - make_interval(days => $4),
                 CURRENT_TIMESTAMP - make_interval(days => $5),
                 CURRENT_TIMESTAMP - make_interval(days => $6),
                 $7 IS NOT NULL,
                 CURRENT_TIMESTAMP - make_interval(days => $7))
         RETURNING id::text",
    )
    .bind(user_id)
    .bind(token_hash)
    .bind(label)
    .bind(created_days_ago)
    .bind(last_used_days_ago)
    .bind(expires_days_ago)
    .bind(revoked_days_ago)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn surviving_labels(pool: &PgPool, user_id: i64) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT user_agent FROM refresh_tokens WHERE user_id = $1 ORDER BY user_agent",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn active_labels(pool: &PgPool, user_id: i64) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT user_agent FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL AND is_revoked = false
           AND expires_at > CURRENT_TIMESTAMP
         ORDER BY user_agent",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn postgres_purge_deletes_only_sessions_past_their_grace() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, PURGE_USER_ID).await;
    upsert_test_user(&pool, PURGE_USER_ID, "session_retention_purge").await;

    let old = GRACE_DAYS + 400;
    let recent = GRACE_DAYS - 400;
    // Gone: expired beyond the grace, revoked beyond the grace, and a revoked
    // row with no revoked_at that is older than the grace.
    insert_session(
        &pool,
        PURGE_USER_ID,
        "expired-old",
        old + 40,
        old + 30,
        old,
        None,
    )
    .await;
    insert_session(
        &pool,
        PURGE_USER_ID,
        "revoked-old",
        old + 5,
        old + 5,
        -10,
        Some(old),
    )
    .await;
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, user_agent, created_at, expires_at, is_revoked, revoked_at)
         VALUES ($1, $2, 'revoked-null-old', CURRENT_TIMESTAMP - make_interval(days => $3),
                 CURRENT_TIMESTAMP + interval '10 days', true, NULL)",
    )
    .bind(PURGE_USER_ID)
    .bind(AuthService::hash_refresh_token(&AuthService::generate_refresh_token()))
    .bind(old)
    .execute(&pool)
    .await
    .unwrap();
    // Kept: inside the grace, or still live.
    insert_session(
        &pool,
        PURGE_USER_ID,
        "expired-recent",
        recent + 40,
        recent + 30,
        recent,
        None,
    )
    .await;
    insert_session(
        &pool,
        PURGE_USER_ID,
        "revoked-recent",
        recent,
        recent,
        -10,
        Some(recent),
    )
    .await;
    insert_session(&pool, PURGE_USER_ID, "live", old, 0, -30, None).await;

    let policy = RetentionPolicy {
        expired_days: GRACE_DAYS,
        revoked_days: GRACE_DAYS,
        max_active_per_user: 10,
        idle_days: 0,
    };
    let first = purge(&pool, &policy).await;
    let after_first = surviving_labels(&pool, PURGE_USER_ID).await;
    // Idempotent: a second sweep (or an overlapping leader) finds nothing.
    let second = purge(&pool, &policy).await;
    let after_second = surviving_labels(&pool, PURGE_USER_ID).await;

    // "Off" deletes nothing even when everything is eligible.
    insert_session(
        &pool,
        PURGE_USER_ID,
        "expired-old-2",
        old + 40,
        old + 30,
        old,
        None,
    )
    .await;
    let off = purge(
        &pool,
        &RetentionPolicy {
            expired_days: 0,
            revoked_days: 0,
            max_active_per_user: 0,
            idle_days: 0,
        },
    )
    .await;
    let after_off = surviving_labels(&pool, PURGE_USER_ID).await;
    cleanup(&pool, PURGE_USER_ID).await;

    // Survivors, not report counts, are the assertion: another test in this
    // binary may run a purge concurrently and delete these fixtures first.
    first.expect("purge must succeed");
    assert_eq!(
        after_first,
        vec!["expired-recent", "live", "revoked-recent"],
        "only sessions past their grace may be deleted"
    );
    second.expect("second purge must succeed");
    assert_eq!(after_first, after_second);
    let off = off.expect("purge with everything off must succeed");
    assert_eq!(off.expired_deleted + off.revoked_deleted, 0);
    assert!(after_off.contains(&"expired-old-2".to_string()));
}

#[tokio::test]
async fn postgres_cap_revokes_the_least_recently_used_sessions() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, CAP_USER_ID).await;
    upsert_test_user(&pool, CAP_USER_ID, "session_retention_cap").await;

    // Five live sessions, s1 the most recently used ... s5 the least.
    for n in 1..=5 {
        insert_session(&pool, CAP_USER_ID, &format!("s{n}"), 20, n, -20, None).await;
    }
    // Already-dead sessions do not count toward the cap and are left alone.
    insert_session(&pool, CAP_USER_ID, "dead-revoked", 20, 0, -20, Some(1)).await;
    insert_session(&pool, CAP_USER_ID, "dead-expired", 40, 31, 1, None).await;
    // The session just minted: never revoked, and it takes one slot.
    let new_id = insert_session(&pool, CAP_USER_ID, "s0-new", 0, 0, -30, None).await;

    let revoked = enforce_session_cap(&pool, CAP_USER_ID, &new_id, 3).await;
    let after_cap = active_labels(&pool, CAP_USER_ID).await;
    let revoked_rows_have_timestamps: bool = sqlx::query_scalar(
        "SELECT bool_and(revoked_at IS NOT NULL) FROM refresh_tokens
         WHERE user_id = $1 AND user_agent IN ('s3', 's4', 's5')",
    )
    .bind(CAP_USER_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    // Under the cap: nothing more to do. Cap 0: off.
    let again = enforce_session_cap(&pool, CAP_USER_ID, &new_id, 3).await;
    let off = enforce_session_cap(&pool, CAP_USER_ID, &new_id, 0).await;
    // Cap 1 keeps only the new session.
    let one = enforce_session_cap(&pool, CAP_USER_ID, &new_id, 1).await;
    let after_one = active_labels(&pool, CAP_USER_ID).await;
    cleanup(&pool, CAP_USER_ID).await;

    assert_eq!(revoked.expect("cap must succeed"), 3);
    assert_eq!(after_cap, vec!["s0-new", "s1", "s2"]);
    assert!(
        revoked_rows_have_timestamps,
        "capped sessions must get revoked_at"
    );
    assert_eq!(again.unwrap(), 0);
    assert_eq!(off.unwrap(), 0);
    assert_eq!(one.unwrap(), 2);
    assert_eq!(after_one, vec!["s0-new"]);
}

#[tokio::test]
async fn postgres_idle_timeout_revokes_only_long_unused_live_sessions() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, IDLE_USER_ID).await;
    upsert_test_user(&pool, IDLE_USER_ID, "session_retention_idle").await;

    insert_session(
        &pool,
        IDLE_USER_ID,
        "idle",
        GRACE_DAYS + 50,
        GRACE_DAYS + 10,
        -5,
        None,
    )
    .await;
    insert_session(&pool, IDLE_USER_ID, "busy", GRACE_DAYS + 50, 0, -30, None).await;

    let report = purge(
        &pool,
        &RetentionPolicy {
            expired_days: 0,
            revoked_days: GRACE_DAYS,
            max_active_per_user: 0,
            idle_days: GRACE_DAYS,
        },
    )
    .await;
    let active = active_labels(&pool, IDLE_USER_ID).await;
    let surviving = surviving_labels(&pool, IDLE_USER_ID).await;
    cleanup(&pool, IDLE_USER_ID).await;

    let report = report.expect("purge must succeed");
    assert!(report.idle_revoked >= 1, "{report:?}");
    assert_eq!(active, vec!["busy"]);
    // Revoked now, so it waits out its revoked grace instead of vanishing in
    // the same sweep.
    assert_eq!(surviving, vec!["busy", "idle"]);
}

/// End to end through a real sign-in: the shipped cap of 10 (from the
/// `session_max_active_per_user` row) trims an account that a script has
/// signed in on a dozen times, and the newest session always survives.
#[tokio::test]
async fn postgres_sign_in_trims_the_account_to_the_session_cap() {
    use hotel_app_be::modules::auth::models::LoginRequest;
    use hotel_app_be::modules::auth::service as auth_service;

    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    if std::env::var("SESSION_MAX_ACTIVE_PER_USER").is_ok() {
        eprintln!("Skipping: SESSION_MAX_ACTIVE_PER_USER overrides the shipped cap");
        return;
    }
    cleanup(&pool, LOGIN_CAP_USER_ID).await;
    upsert_test_user(&pool, LOGIN_CAP_USER_ID, "session_retention_login").await;
    let password = "S3cure!Passw0rd-Retention";
    let password_hash = AuthService::hash_password(password).await.unwrap();
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1")
        .bind(LOGIN_CAP_USER_ID)
        .bind(password_hash)
        .execute(&pool)
        .await
        .unwrap();
    let cap: i32 = sqlx::query_scalar::<_, Option<String>>(
        "SELECT value FROM system_settings WHERE key = 'session_max_active_per_user'",
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten()
    .and_then(|value| value.parse().ok())
    .unwrap_or(10);

    // Twelve live sessions already exist from earlier sign-ins.
    for n in 1..=12 {
        insert_session(
            &pool,
            LOGIN_CAP_USER_ID,
            &format!("old-{n:02}"),
            5,
            n,
            -25,
            None,
        )
        .await;
    }
    let login = auth_service::login(
        &pool,
        LoginRequest {
            username: "session_retention_login".to_string(),
            password: password.to_string(),
            totp_code: None,
        },
        Some("203.0.113.77"),
        Some("session-retention-test"),
        None,
    )
    .await;
    let active = active_labels(&pool, LOGIN_CAP_USER_ID).await;
    let capped_audit_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_logs WHERE action = 'sessions_capped' AND user_id = $1",
    )
    .bind(LOGIN_CAP_USER_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    cleanup(&pool, LOGIN_CAP_USER_ID).await;

    login.expect("sign-in must succeed");
    if cap <= 0 {
        assert_eq!(active.len(), 13, "a cap of 0 must leave every session live");
        return;
    }
    assert_eq!(active.len(), cap as usize, "{active:?}");
    assert!(
        active.contains(&"session-retention-test".to_string()),
        "the session just minted must survive the cap"
    );
    assert!(
        !active.contains(&"old-12".to_string()),
        "the least recently used session must be the one revoked"
    );
    assert_eq!(capped_audit_rows, 1);
}
