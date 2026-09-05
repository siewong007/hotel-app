//! PostgreSQL coverage for Google guest-account resolution.
//!
//! These tests are deliberately opt-in through `DATABASE_URL`. They exercise
//! the actual unique indexes, savepoints, and row locks that unit tests cannot
//! represent. A configured database must include migration 0002.

use hotel_app_be::core::error::ApiError;
use hotel_app_be::repositories::auth::AuthRepository;
use hotel_app_be::services::google_identity::{GoogleIdentity, google_username};
use sqlx::{PgPool, postgres::PgPoolOptions};

fn test_identity(label: &str) -> GoogleIdentity {
    let nonce = uuid::Uuid::now_v7().simple().to_string();
    GoogleIdentity {
        subject: format!("google-test-{label}-{nonce}"),
        email: format!("google-test-{label}-{nonce}@example.test"),
        email_verified: true,
        given_name: Some("Aisha".to_string()),
        family_name: Some("Rahman".to_string()),
    }
}

async fn postgres_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping Google guest registration PostgreSQL test because DATABASE_URL is not set"
            );
            return None;
        }
    };

    Some(
        PgPoolOptions::new()
            .max_connections(8)
            .connect(&database_url)
            .await
            .expect("failed to connect to the configured PostgreSQL test database"),
    )
}

async fn cleanup_email(pool: &PgPool, email: &str) {
    sqlx::query("DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)")
        .bind(email)
        .execute(pool)
        .await
        .expect("test cleanup must remove user roles");
    sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(email)
        .execute(pool)
        .await
        .expect("test cleanup must remove users");
    sqlx::query("DELETE FROM guests WHERE email = $1")
        .bind(email)
        .execute(pool)
        .await
        .expect("test cleanup must remove guests");
}

#[tokio::test]
async fn postgres_google_guest_create_race_returns_one_subject_account() {
    let Some(pool) = postgres_pool().await else {
        return;
    };
    let identity = test_identity("create-race");
    cleanup_email(&pool, &identity.email).await;

    let first_pool = pool.clone();
    let second_pool = pool.clone();
    let first_identity = identity.clone();
    let second_identity = identity.clone();
    let (first, second) = tokio::join!(
        AuthRepository::resolve_google_guest(&first_pool, &first_identity),
        AuthRepository::resolve_google_guest(&second_pool, &second_identity),
    );

    let first = first.expect("the first concurrent Google guest create must succeed");
    let second = second.expect("the second concurrent Google guest create must return the winner");
    assert_eq!(first.id, second.id);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE google_subject = $1")
        .bind(&identity.subject)
        .fetch_one(&pool)
        .await
        .expect("the Google subject count query must succeed");
    assert_eq!(count, 1);

    cleanup_email(&pool, &identity.email).await;
}

#[tokio::test]
async fn postgres_google_guest_link_race_returns_the_same_existing_guest() {
    let Some(pool) = postgres_pool().await else {
        return;
    };
    let identity = test_identity("link-race");
    cleanup_email(&pool, &identity.email).await;

    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (full_name, email, is_active, guest_type) VALUES ($1, $2, true, 'non_member') RETURNING id",
    )
    .bind(format!("Linked Guest {}", &identity.subject))
    .bind(&identity.email)
    .fetch_one(&pool)
    .await
    .expect("test setup must create a guest");
    let existing_user_id: i64 = sqlx::query_scalar(
        "INSERT INTO users (username, email, full_name, user_type, guest_id, is_active, is_verified) VALUES ($1, $2, $3, 'guest', $4, true, false) RETURNING id",
    )
    .bind(format!("legacy_{}", uuid::Uuid::now_v7().simple()))
    .bind(&identity.email)
    .bind("Aisha Rahman")
    .bind(guest_id)
    .fetch_one(&pool)
    .await
    .expect("test setup must create an active guest user");

    let first_pool = pool.clone();
    let second_pool = pool.clone();
    let first_identity = identity.clone();
    let second_identity = identity.clone();
    let (first, second) = tokio::join!(
        AuthRepository::resolve_google_guest(&first_pool, &first_identity),
        AuthRepository::resolve_google_guest(&second_pool, &second_identity),
    );

    assert_eq!(
        first.expect("first link request must succeed").id,
        existing_user_id
    );
    assert_eq!(
        second
            .expect("second link request must return the linked guest")
            .id,
        existing_user_id
    );
    let subject: Option<String> =
        sqlx::query_scalar("SELECT google_subject FROM users WHERE id = $1")
            .bind(existing_user_id)
            .fetch_one(&pool)
            .await
            .expect("linked user must remain readable");
    assert_eq!(subject.as_deref(), Some(identity.subject.as_str()));

    cleanup_email(&pool, &identity.email).await;
}

#[tokio::test]
async fn postgres_google_guest_creation_retries_a_taken_derived_username() {
    let Some(pool) = postgres_pool().await else {
        return;
    };
    let identity = test_identity("username-collision");
    let collision_email = format!("collision-{}@example.test", uuid::Uuid::now_v7().simple());
    cleanup_email(&pool, &identity.email).await;
    cleanup_email(&pool, &collision_email).await;

    let taken_username = google_username(&identity.email, &identity.subject);
    sqlx::query(
        "INSERT INTO users (username, email, full_name, user_type, is_active, is_verified) VALUES ($1, $2, $3, 'guest', true, true)",
    )
    .bind(&taken_username)
    .bind(&collision_email)
    .bind("Username Collision Fixture")
    .execute(&pool)
    .await
    .expect("test setup must reserve the initial Google username");

    let user = AuthRepository::resolve_google_guest(&pool, &identity)
        .await
        .expect("a username collision must not reject a new verified Google guest");
    assert_ne!(user.username, taken_username);
    assert_eq!(
        user.google_subject.as_deref(),
        Some(identity.subject.as_str())
    );

    cleanup_email(&pool, &identity.email).await;
    cleanup_email(&pool, &collision_email).await;
}

#[tokio::test]
async fn postgres_google_guest_creation_allows_an_unrelated_duplicate_display_name() {
    let Some(pool) = postgres_pool().await else {
        return;
    };
    let identity = test_identity("full-name-collision");
    let collision_email = format!(
        "name-collision-{}@example.test",
        uuid::Uuid::now_v7().simple()
    );
    cleanup_email(&pool, &identity.email).await;
    cleanup_email(&pool, &collision_email).await;

    sqlx::query(
        "INSERT INTO guests (full_name, email, is_active, guest_type) VALUES ('Aisha Rahman', $1, true, 'non_member')",
    )
    .bind(&collision_email)
    .execute(&pool)
    .await
    .expect("test setup must reserve the human display name");

    let user = AuthRepository::resolve_google_guest(&pool, &identity)
        .await
        .expect("an unrelated same-name guest must not block Google registration");
    let stored_guest_name: String = sqlx::query_scalar(
        "SELECT g.full_name FROM guests g JOIN users u ON u.guest_id = g.id WHERE u.id = $1",
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .expect("the created guest profile must be readable");
    assert_ne!(stored_guest_name, "Aisha Rahman");

    cleanup_email(&pool, &identity.email).await;
    cleanup_email(&pool, &collision_email).await;
}
#[tokio::test]
async fn postgres_google_guest_rejects_an_email_held_by_a_soft_deleted_account() {
    let Some(pool) = postgres_pool().await else {
        return;
    };
    let identity = test_identity("reserved-email");
    cleanup_email(&pool, &identity.email).await;

    // `users_email_key` is a plain unique index, so a soft-deleted row still
    // occupies the address. It is invisible to the `deleted_at IS NULL` lookups
    // in resolve_google_guest, which is exactly the case the reserved-email
    // guard exists for -- and the case the lost-race recovery must not swallow.
    let guest_id: i64 = sqlx::query_scalar(
        "INSERT INTO guests (full_name, email, is_active, guest_type) VALUES ($1, $2, true, 'non_member') RETURNING id",
    )
    .bind(format!("Soft Deleted {}", &identity.subject))
    .bind(&identity.email)
    .fetch_one(&pool)
    .await
    .expect("test setup must create a guest");
    sqlx::query(
        "INSERT INTO users (username, email, full_name, user_type, guest_id, is_active, is_verified, deleted_at) VALUES ($1, $2, $3, 'guest', $4, true, false, CURRENT_TIMESTAMP)",
    )
    .bind(format!("deleted_{}", uuid::Uuid::now_v7().simple()))
    .bind(&identity.email)
    .bind("Soft Deleted")
    .bind(guest_id)
    .execute(&pool)
    .await
    .expect("test setup must create a soft-deleted user");

    let result = AuthRepository::resolve_google_guest(&pool, &identity).await;

    cleanup_email(&pool, &identity.email).await;

    match result {
        Err(ApiError::Conflict(message)) => assert_eq!(
            message, "This guest account cannot be linked to Google sign-in.",
            "a reserved address must still be refused, not resolved to a winner"
        ),
        other => panic!("expected a Conflict for a reserved email, got {other:?}"),
    }
}
