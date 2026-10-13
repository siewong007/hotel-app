//! Sign-in second factor: authenticator codes, backup codes and passkeys.
//!
//! * A wrong authenticator/backup code costs a login attempt exactly like a
//!   wrong password and eventually locks the account (it used to cost nothing).
//! * The `two_factor_required` answer carries a short-lived, single-use
//!   `mfa_token` bound to the user who passed the password check, plus the
//!   methods that account can use.
//! * A passkey assertion completes the sign-in only for that token's user,
//!   only while the token is live, and only once.
//! * An account whose only second factor is a passkey can no longer finish a
//!   password sign-in without it.
//!
//! PostgreSQL-backed (`DATABASE_URL`); without one every test returns early and
//! reports a pass — judge by wall-clock. Fixture ids use the 982_xxx block, one
//! per test, because cargo runs the test fns concurrently.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use hotel_app_be::AuthService;
use hotel_app_be::core::error::ApiError;
use hotel_app_be::models::{LoginRequest, PasskeySecondFactorFinish, PasskeySecondFactorStart};
use hotel_app_be::modules::auth::repository::AuthRepository;
use hotel_app_be::modules::auth::service::{self as auth_service, available_second_factor_methods};
use hotel_app_be::modules::passkey::service as passkey_service;
use ring::rand::SystemRandom;
use ring::signature::{ECDSA_P256_SHA256_ASN1_SIGNING, EcdsaKeyPair, KeyPair};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};

const TEST_JWT_SECRET: &str = "hotel-app-be-login-second-factor-test-secret-32";
const PASSWORD: &str = "S3cond!Factor-Passw0rd";
// 160-bit base32 secret, stored plaintext (the login path accepts a legacy
// unencrypted secret, so the test needs no TOTP_ENCRYPTION_KEY).
const TOTP_SECRET: &str = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const BACKUP_CODE: &str = "ABCDE-12345-ABCDE-12345";

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
        eprintln!("Skipping PostgreSQL second-factor test because DATABASE_URL is not set");
        return None;
    };
    ensure_test_app_config();
    Some(
        PgPoolOptions::new()
            .max_connections(8)
            // audit_logs is append-only; the fixture cleanup needs the
            // session-local opt-out every PostgreSQL suite here uses.
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

fn username(user_id: i64) -> String {
    format!("second_factor_user_{user_id}")
}

async fn cleanup(pool: &PgPool, user_id: i64) {
    for sql in [
        "DELETE FROM two_factor_challenges WHERE user_id = $1",
        "DELETE FROM passkey_challenges WHERE user_id = $1",
        "DELETE FROM passkeys WHERE user_id = $1",
        "DELETE FROM refresh_tokens WHERE user_id = $1",
        "DELETE FROM audit_logs WHERE user_id = $1 OR (resource_type = 'user' AND resource_id = $1)",
    ] {
        sqlx::query(sql).bind(user_id).execute(pool).await.unwrap();
    }
    sqlx::query("DELETE FROM audit_logs WHERE details->>'username' = $1")
        .bind(username(user_id))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
}

/// A verified, unlocked staff user; `with_totp` enrols an authenticator and
/// one (hashed) backup code.
async fn upsert_user(pool: &PgPool, user_id: i64, with_totp: bool) {
    cleanup(pool, user_id).await;
    let password_hash = AuthService::hash_password(PASSWORD).await.unwrap();
    let backup_codes: Vec<String> = if with_totp {
        vec![AuthService::hash_recovery_code(BACKUP_CODE)]
    } else {
        Vec::new()
    };
    sqlx::query(
        "INSERT INTO users (
            id, username, email, password_hash, full_name, user_type,
            is_active, is_verified, is_locked, failed_login_attempts, locked_until,
            two_factor_enabled, two_factor_secret, two_factor_recovery_codes
         )
         OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, 'Second Factor Test', 'staff',
                 true, true, false, 0, NULL, $5, $6, $7)",
    )
    .bind(user_id)
    .bind(username(user_id))
    .bind(format!("second-factor-{user_id}@example.test"))
    .bind(password_hash)
    .bind(with_totp)
    .bind(with_totp.then_some(TOTP_SECRET))
    .bind(&backup_codes)
    .execute(pool)
    .await
    .unwrap();
}

fn current_totp() -> String {
    let totp = totp_rs::Builder::new()
        .with_algorithm(totp_rs::Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_secret(totp_rs::Secret::try_from_base32(TOTP_SECRET).unwrap())
        .build()
        .unwrap();
    totp.generate_current().to_string()
}

/// Six digits that are not the current code (nor, in practice, its
/// neighbours in the ±1 step skew window).
fn wrong_totp() -> String {
    let current: u32 = current_totp().parse().unwrap();
    format!("{:06}", (current + 500_000) % 1_000_000)
}

async fn login(
    pool: &PgPool,
    user_id: i64,
    code: Option<&str>,
) -> Result<(hotel_app_be::models::AuthResponse, String), ApiError> {
    auth_service::login(
        pool,
        LoginRequest {
            username: username(user_id),
            password: PASSWORD.to_string(),
            totp_code: code.map(str::to_string),
        },
        Some("127.0.0.1"),
        Some("second-factor-test"),
        Some("Asia/Kuala_Lumpur"),
    )
    .await
}

/// Password step for an account with a second factor: returns the token and
/// the methods offered.
async fn password_step(pool: &PgPool, user_id: i64) -> (String, Vec<String>) {
    match login(pool, user_id, None).await {
        Err(ApiError::TwoFactorRequired {
            mfa_token,
            available_methods,
        }) => (mfa_token.expose().to_owned(), available_methods),
        other => panic!("expected two_factor_required, got {:?}", other.map(|_| ())),
    }
}

async fn failed_attempts(pool: &PgPool, user_id: i64) -> (i32, bool) {
    sqlx::query_as("SELECT failed_login_attempts, is_locked FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// A software P-256 authenticator holding one credential.
struct TestPasskey {
    key: EcdsaKeyPair,
    credential_id: Vec<u8>,
    counter: u32,
}

impl TestPasskey {
    async fn register(pool: &PgPool, user_id: i64, credential_id: &[u8]) -> Self {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).unwrap();
        let key = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng)
            .unwrap();
        sqlx::query(
            "INSERT INTO passkeys (user_id, credential_id, public_key, counter, is_active)
             VALUES ($1, $2, $3, 0, true)",
        )
        .bind(user_id)
        .bind(credential_id)
        .bind(key.public_key().as_ref())
        .execute(pool)
        .await
        .unwrap();
        Self {
            key,
            credential_id: credential_id.to_vec(),
            counter: 0,
        }
    }

    /// Answer a `navigator.credentials.get` challenge (standard base64, as the
    /// start endpoint returns it) the way a browser + authenticator would.
    fn assert(&mut self, mfa_token: &str, challenge_b64: &str) -> PasskeySecondFactorFinish {
        let rp_id = hotel_app_be::core::config::get().passkey_rp_id.clone();
        let challenge = STANDARD.decode(challenge_b64).unwrap();
        let client_data = serde_json::json!({
            "type": "webauthn.get",
            "challenge": URL_SAFE_NO_PAD.encode(&challenge),
            "origin": format!("https://{rp_id}"),
            "crossOrigin": false,
        })
        .to_string();
        self.counter += 1;
        let mut authenticator_data = Sha256::digest(rp_id.as_bytes()).to_vec();
        authenticator_data.push(0x05); // user present + user verified
        authenticator_data.extend_from_slice(&self.counter.to_be_bytes());
        let mut signed = authenticator_data.clone();
        signed.extend_from_slice(&Sha256::digest(client_data.as_bytes()));
        let signature = self.key.sign(&SystemRandom::new(), &signed).unwrap();
        PasskeySecondFactorFinish {
            mfa_token: mfa_token.to_string(),
            credential_id: URL_SAFE_NO_PAD.encode(&self.credential_id),
            authenticator_data: STANDARD.encode(&authenticator_data),
            client_data_json: STANDARD.encode(client_data.as_bytes()),
            signature: STANDARD.encode(signature.as_ref()),
            challenge: challenge_b64.to_string(),
        }
    }
}

async fn start(pool: &PgPool, mfa_token: &str) -> Result<serde_json::Value, ApiError> {
    passkey_service::second_factor_start(
        pool,
        PasskeySecondFactorStart {
            mfa_token: mfa_token.to_string(),
        },
    )
    .await
}

async fn finish(
    pool: &PgPool,
    req: PasskeySecondFactorFinish,
) -> Result<(hotel_app_be::models::AuthResponse, String), ApiError> {
    passkey_service::second_factor_finish(pool, req, Some("127.0.0.1"), Some("t"), None).await
}

fn challenge_of(options: &serde_json::Value) -> String {
    options["challenge"].as_str().unwrap().to_string()
}

#[test]
fn methods_list_backup_codes_only_behind_an_authenticator() {
    assert_eq!(
        available_second_factor_methods(true, true, 4),
        ["totp", "passkey", "backup_code"]
    );
    assert_eq!(available_second_factor_methods(true, false, 0), ["totp"]);
    assert_eq!(available_second_factor_methods(false, true, 0), ["passkey"]);
    // Backup codes are verified on the authenticator path; without one they
    // cannot be used, so they are not offered.
    assert_eq!(available_second_factor_methods(false, true, 3), ["passkey"]);
}

#[tokio::test]
async fn wrong_second_factor_counts_toward_lockout() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 982_001;
    upsert_user(&pool, user_id, true).await;
    let max_attempts = AuthRepository::max_login_attempts(&pool).await;

    let (_, methods) = password_step(&pool, user_id).await;
    assert_eq!(methods, ["totp", "backup_code"]);
    assert_eq!(failed_attempts(&pool, user_id).await, (0, false));

    let wrong = wrong_totp();
    for attempt in 1..max_attempts {
        match login(&pool, user_id, Some(&wrong)).await {
            Err(ApiError::TwoFactorInvalid { attempts_remaining }) => {
                assert_eq!(attempts_remaining, max_attempts - attempt)
            }
            other => panic!(
                "attempt {attempt}: expected two_factor_invalid, got {:?}",
                other.map(|_| ())
            ),
        }
        assert_eq!(failed_attempts(&pool, user_id).await, (attempt, false));
    }
    // The last allowed miss locks the account...
    assert!(matches!(
        login(&pool, user_id, Some(&wrong)).await,
        Err(ApiError::TooManyRequests(_))
    ));
    assert!(failed_attempts(&pool, user_id).await.1);
    // ...and a locked account refuses even the right code.
    assert!(matches!(
        login(&pool, user_id, Some(&current_totp())).await,
        Err(ApiError::TooManyRequests(_))
    ));
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn correct_code_or_backup_code_signs_in_and_resets_attempts() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 982_002;
    upsert_user(&pool, user_id, true).await;

    password_step(&pool, user_id).await;
    let _ = login(&pool, user_id, Some(&wrong_totp())).await;
    assert_eq!(failed_attempts(&pool, user_id).await.0, 1);

    let (response, _) = login(&pool, user_id, Some(&current_totp())).await.unwrap();
    assert!(response.recovery_codes_remaining.is_none());
    assert_eq!(failed_attempts(&pool, user_id).await, (0, false));
    // The passkey token from the password step is no longer needed.
    let leftover: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM two_factor_challenges WHERE user_id = $1 AND purpose = 'login_mfa'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(leftover, 0);

    // A backup code works once, then is spent.
    let (response, _) = login(&pool, user_id, Some(BACKUP_CODE)).await.unwrap();
    assert_eq!(response.recovery_codes_remaining, Some(0));
    assert!(matches!(
        login(&pool, user_id, Some(BACKUP_CODE)).await,
        Err(ApiError::TwoFactorInvalid { .. })
    ));
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn passkey_only_account_cannot_finish_with_password_alone() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 982_003;
    upsert_user(&pool, user_id, false).await;
    TestPasskey::register(&pool, user_id, b"cred-982003").await;

    let (_, methods) = password_step(&pool, user_id).await;
    assert_eq!(methods, ["passkey"]);
    // A code means nothing to an account with no authenticator: still asked
    // for the passkey, and no session.
    assert!(matches!(
        login(&pool, user_id, Some("123456")).await,
        Err(ApiError::TwoFactorRequired { .. })
    ));
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn passkey_second_factor_signs_in_once() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 982_004;
    upsert_user(&pool, user_id, true).await;
    let mut passkey = TestPasskey::register(&pool, user_id, b"cred-982004").await;

    let (token, methods) = password_step(&pool, user_id).await;
    assert_eq!(methods, ["totp", "passkey", "backup_code"]);

    let options = start(&pool, &token).await.unwrap();
    assert_eq!(options["allowCredentials"].as_array().unwrap().len(), 1);
    let assertion = passkey.assert(&token, &challenge_of(&options));
    let (response, refresh_token) = finish(&pool, assertion).await.unwrap();
    assert!(!response.access_token.is_empty());
    assert!(!refresh_token.is_empty());

    let method: String = sqlx::query_scalar(
        "SELECT details->>'method' FROM audit_logs
         WHERE user_id = $1 AND action = 'login_success' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(method, "password+passkey");

    // Single use: the token is spent, so neither a new ceremony nor a
    // replayed finish can mint a second session.
    assert!(matches!(
        start(&pool, &token).await,
        Err(ApiError::TwoFactorExpired)
    ));
    let replay = passkey.assert(&token, &challenge_of(&options));
    assert!(matches!(
        finish(&pool, replay).await,
        Err(ApiError::TwoFactorExpired)
    ));
    cleanup(&pool, user_id).await;
}

#[tokio::test]
async fn passkey_second_factor_is_bound_to_the_password_user() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let victim = 982_005;
    let attacker = 982_006;
    upsert_user(&pool, victim, true).await;
    upsert_user(&pool, attacker, false).await;
    TestPasskey::register(&pool, victim, b"cred-982005").await;
    let mut attacker_key = TestPasskey::register(&pool, attacker, b"cred-982006").await;

    // The victim's token (password known) cannot be completed with a passkey
    // that belongs to a different account.
    let (token, _) = password_step(&pool, victim).await;
    let options = start(&pool, &token).await.unwrap();
    let forged = attacker_key.assert(&token, &challenge_of(&options));
    assert!(matches!(
        finish(&pool, forged).await,
        Err(ApiError::Unauthorized(_))
    ));
    let sessions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM refresh_tokens WHERE user_id = $1")
            .bind(victim)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sessions, 0);

    // A made-up token resolves to nobody.
    assert!(matches!(
        start(&pool, "not-a-real-token").await,
        Err(ApiError::TwoFactorExpired)
    ));
    cleanup(&pool, victim).await;
    cleanup(&pool, attacker).await;
}

#[tokio::test]
async fn passkey_second_factor_token_expires() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 982_007;
    upsert_user(&pool, user_id, true).await;
    let mut passkey = TestPasskey::register(&pool, user_id, b"cred-982007").await;

    let (token, _) = password_step(&pool, user_id).await;
    let ttl_minutes: f64 = sqlx::query_scalar(
        "SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::float8 / 60
         FROM two_factor_challenges WHERE user_id = $1 AND purpose = 'login_mfa'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        (ttl_minutes - auth_service::LOGIN_MFA_TTL_MINUTES as f64).abs() < 0.5,
        "token TTL was {ttl_minutes} minutes"
    );

    let options = start(&pool, &token).await.unwrap();
    sqlx::query(
        "UPDATE two_factor_challenges SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
         WHERE user_id = $1 AND purpose = 'login_mfa'",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let late = passkey.assert(&token, &challenge_of(&options));
    assert!(matches!(
        finish(&pool, late).await,
        Err(ApiError::TwoFactorExpired)
    ));
    assert!(matches!(
        start(&pool, &token).await,
        Err(ApiError::TwoFactorExpired)
    ));
    cleanup(&pool, user_id).await;
}

/// A passwordless (Google sign-in) account answers a password login with a
/// clear 401 rather than a 500 from decoding the NULL hash, and the refusal
/// does not count toward lockout.
#[tokio::test]
async fn passwordless_account_password_login_is_401_not_500() {
    let Some(pool) = setup_pg_pool().await else {
        return;
    };
    let user_id = 982_008;
    upsert_user(&pool, user_id, false).await;
    sqlx::query("UPDATE users SET password_hash = NULL WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        AuthRepository::password_hash(&pool, user_id).await.unwrap(),
        None
    );
    match login(&pool, user_id, None).await {
        Err(ApiError::Unauthorized(message)) => {
            assert_eq!(message, auth_service::GOOGLE_SIGN_IN_ONLY_MESSAGE)
        }
        other => panic!("expected 401, got {:?}", other.map(|_| ())),
    }
    assert_eq!(failed_attempts(&pool, user_id).await, (0, false));
    cleanup(&pool, user_id).await;
}
