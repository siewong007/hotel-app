//! Group (multi-room) PayPal checkout against a local mock PayPal API.
//! Opt-in through `DATABASE_URL`. No real PayPal is contacted: this binary
//! points `PAYPAL_API_BASE` at an in-process mock before config initialises.
//! Rows are committed (the service owns its transactions) and hard-deleted at
//! the end.
use axum::{Json, Router, extract::Path, routing::post};
use hotel_app_be::core::error::ApiError;
use hotel_app_be::modules::payments::service::{
    self as payments, PaypalWebhookApplyOutcome, PaypalWebhookEvent, PaypalWebhookKind,
};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// order_id -> (custom_id, amount, currency, captured amount override)
type Orders = Mutex<HashMap<String, (String, String, String, Option<String>)>>;
static ORDERS: LazyLock<Orders> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn start_mock() -> u16 {
    let (send, recv) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            let app = Router::new()
                .route(
                    "/v1/oauth2/token",
                    post(|| async { Json(json!({"access_token": "mock", "expires_in": 3600})) }),
                )
                .route(
                    "/v2/checkout/orders",
                    post(|Json(body): Json<Value>| async move {
                        let unit = &body["purchase_units"][0];
                        let mut orders = ORDERS.lock().unwrap();
                        let id = format!("MOCK-{}", orders.len() + 1);
                        orders.insert(
                            id.clone(),
                            (
                                unit["custom_id"].as_str().unwrap().to_string(),
                                unit["amount"]["value"].as_str().unwrap().to_string(),
                                unit["amount"]["currency_code"].as_str().unwrap().to_string(),
                                None,
                            ),
                        );
                        Json(json!({"id": id}))
                    }),
                )
                .route(
                    "/v2/checkout/orders/{id}/capture",
                    post(|Path(id): Path<String>| async move {
                        let (custom_id, amount, currency, over) =
                            ORDERS.lock().unwrap().get(&id).cloned().unwrap();
                        Json(json!({
                            "status": "COMPLETED",
                            "purchase_units": [{"payments": {"captures": [{
                                "custom_id": custom_id,
                                "amount": {"value": over.unwrap_or(amount), "currency_code": currency}
                            }]}}]
                        }))
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            send.send(listener.local_addr().unwrap().port()).unwrap();
            axum::serve(listener, app).await.unwrap();
        });
    });
    recv.recv().unwrap()
}

fn dec(v: &str) -> Decimal {
    v.parse().unwrap()
}

struct Fixture {
    guest_id: i64,
    group_id: i64,
    bookings: Vec<i64>,
    room_type_id: i64,
}

async fn fixture(pool: &PgPool, n: u64) -> Fixture {
    let tag = format!(
        "{:x}{n}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let guest_id: i64 =
        sqlx::query_scalar("INSERT INTO guests (nick_name, email) VALUES ($1, $2) RETURNING id")
            .bind(format!("PayPal Group {tag}"))
            .bind(format!("paypal-group-{tag}@example.com"))
            .fetch_one(pool)
            .await
            .unwrap();
    let room_type_id: i64 = sqlx::query_scalar(
        "INSERT INTO room_types (code, name, base_price, max_occupancy) \
         VALUES ($1, $2, 100.00, 2) RETURNING id",
    )
    .bind(format!("PP{tag}"))
    .bind(format!("PayPal Type {tag}"))
    .fetch_one(pool)
    .await
    .unwrap();
    let group_id: i64 = sqlx::query_scalar(
        "INSERT INTO booking_groups (group_number, guest_id, check_in_date, check_out_date) \
         VALUES ($1, $2, '2031-04-10', '2031-04-12') RETURNING id",
    )
    .bind(format!("GPP{tag}"))
    .bind(guest_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut bookings = Vec::new();
    for (i, total) in ["150.00", "250.50"].iter().enumerate() {
        let room_id: i64 = sqlx::query_scalar(
            "INSERT INTO rooms (room_number, room_type_id, status, is_active) \
             VALUES ($1, $2, 'available', true) RETURNING id",
        )
        .bind(format!("PP{i}{tag}"))
        .bind(room_type_id)
        .fetch_one(pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO bookings (booking_number, guest_id, room_id, check_in_date, check_out_date, \
                 room_rate, subtotal, total_amount, status, payment_status, currency, booking_group_id) \
             VALUES ($1, $2, $3, '2031-04-10', '2031-04-12', 100.00, $4::numeric, $4::numeric, \
                 'pending_payment', 'unpaid', 'MYR', $5) RETURNING id",
        )
        .bind(format!("BPP{i}{tag}"))
        .bind(guest_id)
        .bind(room_id)
        .bind(total)
        .bind(group_id)
        .fetch_one(pool)
        .await
        .unwrap();
        bookings.push(id);
    }
    Fixture {
        guest_id,
        group_id,
        bookings,
        room_type_id,
    }
}

async fn cleanup(pool: &PgPool, f: &Fixture) {
    for sql in [
        "DELETE FROM email_deliveries WHERE booking_id = ANY($1)",
        "DELETE FROM payments WHERE booking_id = ANY($1)",
        "DELETE FROM booking_history WHERE booking_id = ANY($1)",
        "DELETE FROM bookings WHERE id = ANY($1)",
    ] {
        let _ = sqlx::query(sql).bind(&f.bookings).execute(pool).await;
    }
    let _ = sqlx::query("DELETE FROM booking_groups WHERE id = $1")
        .bind(f.group_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(f.guest_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM rooms WHERE room_type_id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(f.room_type_id)
        .execute(pool)
        .await;
}

async fn rows(pool: &PgPool, f: &Fixture) -> Vec<(String, Decimal, Option<String>, String)> {
    sqlx::query_as(
        "SELECT p.status::text, p.amount, p.gateway_payment_intent_id, b.status \
         FROM payments p JOIN bookings b ON b.id = p.booking_id \
         WHERE p.booking_id = ANY($1) ORDER BY p.booking_id",
    )
    .bind(&f.bookings)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn group_paypal_order_capture_and_webhook() {
    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        return;
    };
    let port = start_mock();
    // SAFETY: set before any config read in this binary (single test).
    unsafe {
        std::env::set_var("PAYPAL_ENABLED", "true");
        std::env::set_var("PAYPAL_CLIENT_ID", "mock-client");
        std::env::set_var("PAYPAL_CLIENT_SECRET", "mock-secret");
        std::env::set_var("PAYPAL_API_BASE", format!("http://127.0.0.1:{port}"));
        if std::env::var("JWT_SECRET").is_err() {
            std::env::set_var("JWT_SECRET", "test-secret-test-secret-test-secret");
        }
    }
    hotel_app_be::core::config::init_from_env().expect("config");
    let pool = PgPoolOptions::new()
        .max_connections(4)
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
        .expect("connect");

    // 1) Synchronous capture: one order for the sum, every room completed.
    let f = fixture(&pool, 1).await;
    let order = payments::create_group_paypal_order(&pool, f.guest_id, f.group_id)
        .await
        .expect("create order");
    let (custom_id, amount, currency, _) = ORDERS.lock().unwrap()[&order.order_id].clone();
    assert_eq!(amount, "400.50");
    assert_eq!(currency, "MYR");
    assert_eq!(custom_id, format!("{}:{}", f.bookings[0], order.payment_id));
    let before = rows(&pool, &f).await;
    assert_eq!(before.len(), 2);
    assert!(
        before
            .iter()
            .all(|r| r.0 == "pending" && r.2.as_deref() == Some(order.order_id.as_str()))
    );
    assert_eq!(before[0].1 + before[1].1, dec("400.50"));

    // A second attempt while one is open is refused.
    assert!(
        payments::create_group_paypal_order(&pool, f.guest_id, f.group_id)
            .await
            .is_err()
    );
    // Another guest cannot capture it.
    let other = payments::capture_group_paypal_payment(
        &pool,
        f.guest_id + 1_000_000,
        f.group_id,
        &order.order_id,
        order.payment_id,
    )
    .await;
    assert!(matches!(other, Err(ApiError::Forbidden(_))), "{other:?}");

    let captured = payments::capture_group_paypal_payment(
        &pool,
        f.guest_id,
        f.group_id,
        &order.order_id,
        order.payment_id,
    )
    .await
    .expect("capture");
    assert_eq!(captured.status, "completed");
    let after = rows(&pool, &f).await;
    assert!(after.iter().all(|r| r.0 == "completed"), "{after:?}");
    assert!(after.iter().all(|r| r.3 == "confirmed"), "{after:?}");
    let group_status: String =
        sqlx::query_scalar("SELECT payment_status FROM booking_groups WHERE id = $1")
            .bind(f.group_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(group_status, "paid");
    // Retry after success is idempotent.
    let again = payments::capture_group_paypal_payment(
        &pool,
        f.guest_id,
        f.group_id,
        &order.order_id,
        order.payment_id,
    )
    .await
    .expect("idempotent retry");
    assert_eq!(again.status, "completed");
    cleanup(&pool, &f).await;

    // 2) A short capture is flagged, never failed or completed.
    let f = fixture(&pool, 2).await;
    let order = payments::create_group_paypal_order(&pool, f.guest_id, f.group_id)
        .await
        .unwrap();
    ORDERS.lock().unwrap().get_mut(&order.order_id).unwrap().3 = Some("150.00".to_string());
    let short = payments::capture_group_paypal_payment(
        &pool,
        f.guest_id,
        f.group_id,
        &order.order_id,
        order.payment_id,
    )
    .await;
    assert!(matches!(short, Err(ApiError::Conflict(_))), "{short:?}");
    assert!(rows(&pool, &f).await.iter().all(|r| r.0 == "processing"));
    cleanup(&pool, &f).await;

    // 3) Webhook settles the whole group from the lead's custom_id.
    let f = fixture(&pool, 3).await;
    let order = payments::create_group_paypal_order(&pool, f.guest_id, f.group_id)
        .await
        .unwrap();
    let event = |amount: &str| PaypalWebhookEvent {
        kind: PaypalWebhookKind::CaptureCompleted,
        event_id: format!("WH-{}", order.order_id),
        capture_id: Some("CAP-1".to_string()),
        booking_id: f.bookings[0],
        payment_id: order.payment_id,
        captured_amount: Some(amount.to_string()),
        captured_currency: Some("MYR".to_string()),
        client_ip: None,
    };
    assert_eq!(
        payments::apply_paypal_webhook_event(&pool, &event("400.50"))
            .await
            .unwrap(),
        PaypalWebhookApplyOutcome::Applied
    );
    assert!(rows(&pool, &f).await.iter().all(|r| r.0 == "completed"));
    assert_eq!(
        payments::apply_paypal_webhook_event(&pool, &event("400.50"))
            .await
            .unwrap(),
        PaypalWebhookApplyOutcome::AlreadyApplied
    );
    cleanup(&pool, &f).await;

    // 4) Webhook with a mismatched amount is flagged, rows untouched.
    let f = fixture(&pool, 4).await;
    let order = payments::create_group_paypal_order(&pool, f.guest_id, f.group_id)
        .await
        .unwrap();
    let mismatch = PaypalWebhookEvent {
        kind: PaypalWebhookKind::CaptureCompleted,
        event_id: format!("WH-{}", order.order_id),
        capture_id: None,
        booking_id: f.bookings[0],
        payment_id: order.payment_id,
        captured_amount: Some("150.00".to_string()),
        captured_currency: Some("MYR".to_string()),
        client_ip: None,
    };
    assert_eq!(
        payments::apply_paypal_webhook_event(&pool, &mismatch)
            .await
            .unwrap(),
        PaypalWebhookApplyOutcome::ConflictFlagged
    );
    assert!(rows(&pool, &f).await.iter().all(|r| r.0 == "pending"));
    cleanup(&pool, &f).await;
}
