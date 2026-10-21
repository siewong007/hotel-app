//! Live-PostgreSQL coverage for `GET /auth/session-hint`'s service: it must
//! report the session without rotating the refresh token. Skipped without
//! `DATABASE_URL`.

use hotel_app_be::AuthService;
use hotel_app_be::modules::auth::service::session_hint;
use sqlx::PgPool;

#[tokio::test]
async fn session_hint_reads_without_rotating() {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        eprintln!("Skipping session hint test because DATABASE_URL is not set");
        return;
    };
    let pool = PgPool::connect(&url).await.expect("connect");
    let Some(uid) = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM users WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1",
    )
    .fetch_optional(&pool)
    .await
    .unwrap() else {
        eprintln!("Skipping: no users");
        return;
    };

    assert!(!session_hint(&pool, None).await.signed_in);
    assert!(!session_hint(&pool, Some("")).await.signed_in);
    assert!(
        !session_hint(&pool, Some("not-a-real-token"))
            .await
            .signed_in
    );

    let token = format!("hint-test-{}", uuid::Uuid::new_v4());
    AuthService::store_refresh_token(&pool, uid, &token, 1, None, None, None)
        .await
        .expect("store token");

    let hint = session_hint(&pool, Some(&token)).await;
    assert!(hint.signed_in);
    assert!(matches!(hint.account, Some("staff" | "guest")));
    assert!(hint.display_name.as_deref().is_some_and(|n| !n.is_empty()));

    // Still valid afterwards: the hint must not rotate or revoke it.
    assert!(
        AuthService::validate_refresh_token(&pool, &token)
            .await
            .unwrap()
            .is_some()
    );
    assert!(session_hint(&pool, Some(&token)).await.signed_in);

    AuthService::revoke_refresh_token(&pool, &token)
        .await
        .unwrap();
    assert!(!session_hint(&pool, Some(&token)).await.signed_in);
}
