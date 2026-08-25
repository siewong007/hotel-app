//! Regression test for the transactional-consent gate.
//!
//! v1 bug: the worker required a subscribed `notification_subscriptions` row
//! for topic `booking_confirmation`, but the table's topic CHECK forbids that
//! topic — so every transactional booking confirmation was marked `suppressed`.
//! The fix (`validation::TRANSACTIONAL_KINDS` + `is_guest_active`) makes the
//! decision independent of subscriptions while keeping suppression checks.
//!
//! This suite pins the exact database facts the worker branch now relies on,
//! against live PostgreSQL. Skipped without `DATABASE_URL`.

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

const GUEST_ID: i64 = 978_201;

async fn pg_pool() -> Option<PgPool> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return None,
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("failed to connect to PostgreSQL test database");
    Some(pool)
}

async fn cleanup(pool: &PgPool) {
    sqlx::query("DELETE FROM email_deliveries WHERE guest_id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM notification_subscriptions WHERE guest_id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM email_suppressions WHERE email = $1")
        .bind("consent-gate@hotel.local")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(GUEST_ID)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn booking_confirmation_passes_the_gate_without_any_subscription_row() {
    use hotel_app_be::modules::communications::repository::{
        CommunicationsRepository as Repo, DeliveryValues,
    };
    use hotel_app_be::modules::communications::validation;

    let Some(pool) = pg_pool().await else {
        return;
    };

    cleanup(&pool).await;

    // Active guest with an email but ZERO subscription rows of any kind.
    sqlx::query(
        "INSERT INTO guests (id, full_name, first_name, last_name, email) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'Consent Gate Guest', 'Consent', 'Gate', 'consent-gate@hotel.local')",
    )
    .bind(GUEST_ID)
    .execute(&pool)
    .await
    .unwrap();

    let subscription_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM notification_subscriptions WHERE guest_id = $1")
            .bind(GUEST_ID)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        subscription_rows, 0,
        "fixture precondition: the guest holds no subscriptions"
    );

    // Worker decision inputs for a transactional kind:
    assert!(!validation::requires_topic_subscription("booking_confirmation"));
    assert!(
        Repo::is_guest_active(&pool, GUEST_ID).await.unwrap(),
        "active guest must pass the transactional gate"
    );
    assert!(
        !Repo::is_email_suppressed(&pool, "consent-gate@hotel.local")
            .await
            .unwrap(),
        "clean address must not be suppressed"
    );

    // And the v1 behaviour this replaces: the subscription-based check fails
    // for booking_confirmation even though nothing is wrong with the guest —
    // the exact mechanism that suppressed every confirmation mail.
    assert!(
        !Repo::is_guest_deliverable(&pool, GUEST_ID, "booking_confirmation")
            .await
            .unwrap(),
        "v1 check must stay false here; if it flips true, the topics CHECK was widened and this regression needs revisiting"
    );

    // A queued booking_confirmation delivery must be insertable with the new
    // kinds/topics vocabulary (patch 0008).
    let mut tx = pool.begin().await.unwrap();
    let inserted = Repo::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id: GUEST_ID,
            topic: "booking_confirmation",
            recipient_email: "consent-gate@hotel.local",
            subject: "Booking confirmed BK-CONSENT",
            body_html: "<p>confirmed</p>",
            body_text: None,
            voucher_id: None,
            idempotency_key: &format!("consent-gate:{GUEST_ID}"),
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(inserted.is_some(), "transactional delivery must enqueue");

    cleanup(&pool).await;
}
