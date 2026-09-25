//! Passkey ceremony challenges are single-use and must stay single-use under
//! concurrency. `PasskeyRepository::consume_challenge` enforces it with one
//! conditional UPDATE — the row lock makes the second consumer see `used_at`
//! already set, so a replayed or raced assertion finds no pending challenge.
//!
//! These need a live PostgreSQL (`DATABASE_URL`): the guarantee under test is
//! the database's row locking, which no mock can stand in for. Without one
//! every test here returns early and reports a pass — judge by wall-clock.
//!
//! In its own file so fixture ids cannot collide with other suites; this file
//! uses the 994_9xx block.

use chrono::{Duration, Utc};
use hotel_app_be::modules::passkey::repository::PasskeyRepository;
use sqlx::{PgPool, postgres::PgPoolOptions};

const TEST_JWT_SECRET: &str = "hotel-app-be-passkey-challenge-test-secret-32ch";

/// Ids used only by this file. Verified against every other `tests/` fixture id.
///
/// ONE PER TEST, not one shared: cargo runs the test fns in this binary
/// concurrently, so a shared fixture user means one test's setup runs while
/// another's teardown is removing the very same row.
const SINGLE_USE_USER_ID: i64 = 994_901;
const EXPIRED_USER_ID: i64 = 994_902;
const CONCURRENT_USER_ID: i64 = 994_903;

fn ensure_test_app_config() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let _ = hotel_app_be::AuthService::init_jwt_secret(TEST_JWT_SECRET);
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
        eprintln!("Skipping PostgreSQL passkey-challenge test because DATABASE_URL is not set");
        return None;
    };
    ensure_test_app_config();
    Some(
        PgPoolOptions::new()
            .max_connections(8)
            // The baseline's append-only trigger on audit_logs forbids the
            // fixture cleanup below; test pools opt out session-locally, the
            // same way every other PostgreSQL suite in tests/ does. Without
            // it, deleting the fixture user is rejected by the referential
            // action on audit_logs.user_id even when the user owns no audit
            // rows, because that trigger is FOR EACH STATEMENT.
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

async fn upsert_test_user(pool: &PgPool, user_id: i64) {
    let password_hash = hotel_app_be::AuthService::hash_password("PasskeyChallenge!234")
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
    .bind(format!("passkey_challenge_user_{user_id}"))
    .bind(format!("passkey_challenge_user_{user_id}@example.test"))
    .bind(password_hash)
    .bind("Passkey Challenge Test")
    .execute(pool)
    .await
    .unwrap();
}

/// Cleans up BEFORE any assertion that can panic, so a failed run does not
/// poison the next one. Needs the `app.allow_audit_mutation` opt-out the pool
/// sets — see `setup_pg_pool`.
async fn cleanup(pool: &PgPool, user_id: i64) {
    sqlx::query("DELETE FROM passkey_challenges WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM passkeys WHERE user_id = $1")
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

async fn fresh_challenge(pool: &PgPool, user_id: i64, challenge_type: &str, challenge: &[u8]) {
    PasskeyRepository::insert_challenge(
        pool,
        user_id,
        challenge,
        challenge_type,
        Utc::now() + Duration::minutes(5),
    )
    .await
    .expect("inserting a challenge must succeed");
}

/// First consumer wins; every later attempt — including a different
/// challenge_type — must find the row already spent.
#[tokio::test]
async fn consume_challenge_is_single_use_and_type_scoped() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, SINGLE_USE_USER_ID).await;
    upsert_test_user(&pool, SINGLE_USE_USER_ID).await;

    let challenge: [u8; 32] = [0xAA; 32];
    fresh_challenge(&pool, SINGLE_USE_USER_ID, "authentication", &challenge).await;

    let first = PasskeyRepository::consume_challenge(
        &pool,
        SINGLE_USE_USER_ID,
        &challenge,
        "authentication",
    )
    .await;
    let replay = PasskeyRepository::consume_challenge(
        &pool,
        SINGLE_USE_USER_ID,
        &challenge,
        "authentication",
    )
    .await;
    let wrong_type =
        PasskeyRepository::consume_challenge(&pool, SINGLE_USE_USER_ID, &challenge, "registration")
            .await;

    cleanup(&pool, SINGLE_USE_USER_ID).await;

    assert!(
        first.expect("first consumption errored"),
        "the first consumption must succeed"
    );
    assert!(
        !replay.expect("replay consumption errored"),
        "a spent challenge must not be reusable"
    );
    assert!(
        !wrong_type.expect("wrong-type consumption errored"),
        "a consumed challenge must stay consumed under another type"
    );
}

/// An expired challenge cannot be consumed at all.
#[tokio::test]
async fn consume_challenge_rejects_expired() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, EXPIRED_USER_ID).await;
    upsert_test_user(&pool, EXPIRED_USER_ID).await;

    let challenge: [u8; 32] = [0xBB; 32];
    PasskeyRepository::insert_challenge(
        &pool,
        EXPIRED_USER_ID,
        &challenge,
        "registration",
        Utc::now() - Duration::minutes(1),
    )
    .await
    .expect("inserting an expired challenge must succeed");

    let result =
        PasskeyRepository::consume_challenge(&pool, EXPIRED_USER_ID, &challenge, "registration")
            .await;

    cleanup(&pool, EXPIRED_USER_ID).await;

    assert!(
        !result.expect("expired consumption errored"),
        "an expired challenge must not consume"
    );
}

/// The guarantee the login path depends on: N racing consumers of the same
/// challenge, exactly one may win. Sequential reuse was already covered; this
/// is the check-then-act race the atomic UPDATE exists to close.
#[tokio::test]
async fn consume_challenge_allows_exactly_one_concurrent_winner() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    cleanup(&pool, CONCURRENT_USER_ID).await;
    upsert_test_user(&pool, CONCURRENT_USER_ID).await;

    let challenge: [u8; 32] = [0xCC; 32];
    fresh_challenge(&pool, CONCURRENT_USER_ID, "authentication", &challenge).await;

    const RACERS: usize = 8;
    let mut handles = Vec::with_capacity(RACERS);
    for _ in 0..RACERS {
        let pool = pool.clone();
        handles.push(tokio::spawn(async move {
            PasskeyRepository::consume_challenge(
                &pool,
                CONCURRENT_USER_ID,
                &challenge,
                "authentication",
            )
            .await
        }));
    }

    let mut winners = 0usize;
    for handle in handles {
        match handle.await.expect("consumer task must not panic") {
            Ok(true) => winners += 1,
            Ok(false) => {}
            Err(e) => panic!("consume_challenge failed: {e}"),
        }
    }

    cleanup(&pool, CONCURRENT_USER_ID).await;

    assert_eq!(winners, 1, "exactly one of {RACERS} racers may consume");
}
