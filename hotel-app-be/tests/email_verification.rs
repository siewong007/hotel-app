//! End-to-end coverage for account email verification
//! (`services::account_emails::send_email_verification`).
//!
//! The defect this pins: minting the token and sending it were separate, and
//! only the minting half existed. `create_email_verification_token` wrote to
//! `users.email_verification_token`, nothing composed a mail, `login` refuses
//! an unverified account, and `SKIP_EMAIL_VERIFICATION` must be false in
//! production — so every account created with an email address was permanently
//! unable to sign in, while registration told the guest to check their inbox.
//!
//! Asserting "a delivery row exists" is not enough to prove that fixed: the
//! link has to be extractable from the body AND actually verify the account.
//! Both halves are checked here.
//!
//! Skipped without `DATABASE_URL`.

use hotel_app_be::core::auth::AuthService;
use hotel_app_be::services::account_emails;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// This binary owns the `984_` id block; verified free across `tests/` before
/// it was chosen (re-verify with `grep -rn "984_" tests/` when extending).
/// Every test fn in a binary runs concurrently, so each owns a private guest:
/// sharing one made the second test's cleanup delete the first's fixture
/// mid-run.
const GUEST_ID: i64 = 984_001;
const GUEST_PLACEHOLDER_ID: i64 = 984_002;
const USER_ID: i64 = 984_101;
const USER_NO_EMAIL_ID: i64 = 984_102;

async fn pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return None,
    };
    Some(
        PgPoolOptions::new()
            .max_connections(2)
            // Fixture cleanup deletes users, which SET NULLs audit_logs; the
            // baseline's append-only trigger forbids that, so test pools opt
            // out session-locally.
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

async fn cleanup(pool: &PgPool, guest_id: i64, user_id: i64) {
    sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(guest_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(guest_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed(pool: &PgPool) {
    sqlx::query(
        "INSERT INTO guests (id, nick_name, first_name, last_name, email, language_preference) \
         OVERRIDING SYSTEM VALUE \
         VALUES ($1, 'Verify Guest', 'Verify', 'Guest', 'verify-guest@hotel.test', 'en')",
    )
    .bind(GUEST_ID)
    .execute(pool)
    .await
    .expect("insert guest fixture");

    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, guest_id, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE \
         VALUES ($1, 'verify_guest', 'verify-guest@hotel.test', 'Verify Guest', 'guest', $2, true, false)",
    )
    .bind(USER_ID)
    .bind(GUEST_ID)
    .execute(pool)
    .await
    .expect("insert account fixture");
}

/// Pull the `?token=` value out of the queued mail the way a guest's mail
/// client would follow the link.
fn token_from_body(body: &str) -> Option<String> {
    body.split("/verify-email?token=")
        .nth(1)
        .and_then(|rest| rest.split(['"', '&', '<', ' ', '\n']).next())
        .map(str::to_owned)
}

#[tokio::test]
async fn verification_email_is_queued_and_its_link_verifies_the_account() {
    let Some(pool) = pg_pool().await else {
        return;
    };
    cleanup(&pool, GUEST_ID, USER_ID).await;
    seed(&pool).await;

    account_emails::send_email_verification(&pool, USER_ID)
        .await
        .expect("queueing the verification email must succeed");

    let (recipient, subject, body_html, body_text, kind): (
        String,
        String,
        String,
        Option<String>,
        String,
    ) = sqlx::query_as(
        "SELECT recipient_email, subject, body_html, body_text, kind \
         FROM email_deliveries WHERE guest_id = $1",
    )
    .bind(GUEST_ID)
    .fetch_one(&pool)
    .await
    .expect("exactly one verification email must be queued");

    assert_eq!(recipient, "verify-guest@hotel.test");
    assert!(subject.contains("Verify"), "unexpected subject: {subject}");
    assert_eq!(
        kind, "booking_confirmation",
        "filed under an allowed transactional kind so the worker sends it \
         without a per-topic subscription"
    );

    let token = token_from_body(&body_html).expect("the HTML body must carry a tokenised link");
    assert!(
        token_from_body(body_text.as_deref().unwrap_or_default()).is_some(),
        "the plain-text part must carry the link too"
    );

    // The token stored at rest must not be the one in the link: the column
    // holds a SHA-256 hash, and a raw token there could never be verified.
    let stored: Option<String> =
        sqlx::query_scalar("SELECT email_verification_token FROM users WHERE id = $1")
            .bind(USER_ID)
            .fetch_one(&pool)
            .await
            .expect("read the stored token");
    let stored = stored.expect("a token must be on the account");
    assert_ne!(
        stored, token,
        "the emailed token must be stored hashed, never in the clear"
    );

    // The property that actually matters: following the link verifies the
    // account, so the guest can sign in.
    let verified_user = AuthService::verify_email_token(&pool, &token)
        .await
        .expect("verification query must run")
        .expect("the emailed token must verify the account");
    assert_eq!(verified_user, USER_ID);

    let is_verified: bool = sqlx::query_scalar("SELECT is_verified FROM users WHERE id = $1")
        .bind(USER_ID)
        .fetch_one(&pool)
        .await
        .expect("read back verification state");
    assert!(is_verified, "login refuses an account that is not verified");

    cleanup(&pool, GUEST_ID, USER_ID).await;
}

#[tokio::test]
async fn no_verification_email_for_an_account_with_a_placeholder_address() {
    let Some(pool) = pg_pool().await else {
        return;
    };
    // Registration without an email stores a reserved, non-deliverable address
    // and marks the account verified already. Mailing it would bounce, and the
    // bounce would suppress the guest's real address later.
    cleanup(&pool, GUEST_PLACEHOLDER_ID, USER_NO_EMAIL_ID).await;
    sqlx::query(
        "INSERT INTO guests (id, nick_name, first_name, last_name) OVERRIDING SYSTEM VALUE \
         VALUES ($1, 'Placeholder Guest', 'Placeholder', 'Guest')",
    )
    .bind(GUEST_PLACEHOLDER_ID)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, guest_id, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE \
         VALUES ($1, 'placeholder_guest', 'placeholder_guest@no-email.invalid', 'Placeholder Guest', \
                 'guest', $2, true, true)",
    )
    .bind(USER_NO_EMAIL_ID)
    .bind(GUEST_PLACEHOLDER_ID)
    .execute(&pool)
    .await
    .expect("insert placeholder-address account");

    account_emails::send_email_verification(&pool, USER_NO_EMAIL_ID)
        .await
        .expect("a placeholder address must be skipped, not error");

    let queued: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM email_deliveries WHERE recipient_email LIKE '%@no-email.invalid'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(queued, 0, "a non-deliverable address must never be mailed");

    cleanup(&pool, GUEST_PLACEHOLDER_ID, USER_NO_EMAIL_ID).await;
}
