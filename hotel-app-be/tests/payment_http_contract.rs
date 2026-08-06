//! HTTP contract tests for staff payment idempotency keys.
//!
//! These exercise the production router, session middleware, RBAC guard, JSON
//! extraction, and payment validation against PostgreSQL. Valid keys either
//! complete a fixture-backed payment or reach a deliberate domain 404, proving
//! extraction and idempotency validation passed without weakening guards.

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use hotel_app_be::{AuthService, core, routes};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;

const TEST_JWT_SECRET: &str = "hotel-app-be-payment-http-contract-secret-32chars";
const ACTOR_ID: i64 = 997_001;
const ABSENT_BOOKING_ID: i64 = 9_970_001;
const ABSENT_LEDGER_ID: i64 = 9_970_002;
const LEGACY_BOOKING_ID: i64 = 997_013;
const LEGACY_GUEST_ID: i64 = 997_012;
const LEGACY_ROOM_ID: i64 = 997_011;
const LEGACY_ROOM_TYPE_ID: i64 = 997_010;
const IDEMPOTENCY_ERROR: &str = "Idempotency key must be between 1 and 160 characters.";

struct HttpFixture {
    pool: PgPool,
    app: Router,
    authorization: String,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

impl HttpFixture {
    async fn new() -> Option<Self> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping payment HTTP contract tests because DATABASE_URL is not set");
                return None;
            }
        };
        let guard = fixture_lock().lock_owned().await;

        unsafe {
            std::env::set_var("JWT_SECRET", TEST_JWT_SECRET);
        }
        core::config::init_from_env().expect("test app configuration must initialize");
        AuthService::init_jwt_secret(TEST_JWT_SECRET)
            .expect("test JWT secret must satisfy production validation");

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("payment HTTP contract test database must connect");

        sqlx::query(
            "INSERT INTO users \
             (id, username, email, full_name, user_type, is_active, is_verified, is_locked) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'payment_http_actor', 'payment-http-actor@hotel.local', \
                     'Payment HTTP Actor', 'staff', true, true, false) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, \
                 full_name = EXCLUDED.full_name, user_type = EXCLUDED.user_type, \
                 is_active = true, is_verified = true, is_locked = false, deleted_at = NULL",
        )
        .bind(ACTOR_ID)
        .execute(&pool)
        .await
        .expect("staff actor fixture must be inserted");

        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'receptionist' \
             ON CONFLICT (user_id, role_id) DO NOTHING",
        )
        .bind(ACTOR_ID)
        .execute(&pool)
        .await
        .expect("staff actor role fixture must be inserted");
        core::rbac_cache::invalidate_all();

        let refresh_token = AuthService::generate_refresh_token();
        let session_id = AuthService::store_refresh_token(
            &pool,
            ACTOR_ID,
            &refresh_token,
            1,
            Some("127.0.0.1"),
            Some("payment-http-contract-test"),
        )
        .await
        .expect("active session fixture must be inserted");
        let token = AuthService::generate_session_jwt(
            ACTOR_ID,
            "payment_http_actor".to_string(),
            vec!["receptionist".to_string()],
            session_id,
        )
        .expect("test access token must encode");

        let app = routes::create_router(pool.clone());
        Some(Self {
            pool,
            app,
            authorization: format!("Bearer {token}"),
            _guard: guard,
        })
    }

    async fn post(&self, uri: &str, payload: Value) -> (StatusCode, String) {
        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::AUTHORIZATION, &self.authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(payload.to_string()))
            .expect("HTTP request must build");
        let response = self
            .app
            .clone()
            .oneshot(request)
            .await
            .expect("router response must complete");
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body must be readable");
        (
            status,
            String::from_utf8(body.to_vec()).expect("response body must be UTF-8"),
        )
    }

    async fn seed_legacy_booking(&self) {
        Self::cleanup_legacy_booking(&self.pool).await;
        sqlx::query(
            "INSERT INTO room_types \
             (id, code, name, base_price, max_occupancy, keycard_deposit_amount, \
              service_charge_percentage) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'PAYHTTP', 'Payment HTTP Room Type', 100, 2, 0, 0)",
        )
        .bind(LEGACY_ROOM_TYPE_ID)
        .execute(&self.pool)
        .await
        .expect("room type fixture must be inserted");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'PAYHTTP', $2, 'available')",
        )
        .bind(LEGACY_ROOM_ID)
        .bind(LEGACY_ROOM_TYPE_ID)
        .execute(&self.pool)
        .await
        .expect("room fixture must be inserted");
        sqlx::query(
            "INSERT INTO guests \
             (id, full_name, first_name, last_name, email, tourism_type) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'Payment HTTP Guest', 'Payment', 'HTTP', \
                     'payment-http-guest@hotel.local', 'local')",
        )
        .bind(LEGACY_GUEST_ID)
        .execute(&self.pool)
        .await
        .expect("guest fixture must be inserted");
        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, guest_name, guest_email, room_id, \
              check_in_date, check_out_date, adults, children, room_rate, subtotal, \
              total_amount, status, payment_status, created_by, tourism_tax_amount, \
              extra_bed_charge) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'BK-PAY-HTTP', $2, 'Payment HTTP Guest', \
                     'payment-http-guest@hotel.local', $3, '2030-01-01', '2030-01-02', \
                     1, 0, 100, 100, 100, 'confirmed', 'unpaid', $4, 0, 0)",
        )
        .bind(LEGACY_BOOKING_ID)
        .bind(LEGACY_GUEST_ID)
        .bind(LEGACY_ROOM_ID)
        .bind(ACTOR_ID)
        .execute(&self.pool)
        .await
        .expect("booking fixture must be inserted");
    }

    async fn cleanup_legacy_booking(pool: &PgPool) {
        sqlx::query("DELETE FROM audit_logs WHERE user_id = $1")
            .bind(ACTOR_ID)
            .execute(pool)
            .await
            .expect("audit fixture cleanup must succeed");
        sqlx::query("DELETE FROM payments WHERE booking_id = $1")
            .bind(LEGACY_BOOKING_ID)
            .execute(pool)
            .await
            .expect("payment fixture cleanup must succeed");
        sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
            .bind(LEGACY_BOOKING_ID)
            .execute(pool)
            .await
            .expect("history fixture cleanup must succeed");
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(LEGACY_BOOKING_ID)
            .execute(pool)
            .await
            .expect("booking fixture cleanup must succeed");
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(LEGACY_GUEST_ID)
            .execute(pool)
            .await
            .expect("guest fixture cleanup must succeed");
        for table in ["room_status_change_log", "room_events", "room_history"] {
            sqlx::query(&format!("DELETE FROM {table} WHERE room_id = $1"))
                .bind(LEGACY_ROOM_ID)
                .execute(pool)
                .await
                .expect("room-event fixture cleanup must succeed");
        }
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(LEGACY_ROOM_ID)
            .execute(pool)
            .await
            .expect("room fixture cleanup must succeed");
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(LEGACY_ROOM_TYPE_ID)
            .execute(pool)
            .await
            .expect("room type fixture cleanup must succeed");
    }

    async fn cleanup(self) {
        Self::cleanup_legacy_booking(&self.pool).await;
        sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
            .bind(ACTOR_ID)
            .execute(&self.pool)
            .await
            .expect("session fixture cleanup must succeed");
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(ACTOR_ID)
            .execute(&self.pool)
            .await
            .expect("role fixture cleanup must succeed");
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(ACTOR_ID)
            .execute(&self.pool)
            .await
            .expect("actor fixture cleanup must succeed");
        core::rbac_cache::invalidate_all();
    }
}

fn fixture_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn key_contract_responses(
    fixture: &HttpFixture,
    uri: &str,
    base_payload: Value,
) -> [(StatusCode, String); 4] {
    let missing = fixture.post(uri, base_payload.clone()).await;

    let mut blank = base_payload.clone();
    blank["idempotency_key"] = json!("   ");
    let blank = fixture.post(uri, blank).await;

    let mut overlong = base_payload.clone();
    overlong["idempotency_key"] = json!("x".repeat(161));
    let overlong = fixture.post(uri, overlong).await;

    let mut valid = base_payload;
    valid["idempotency_key"] = json!("payment-http-contract-valid-key");
    let valid = fixture.post(uri, valid).await;

    [missing, blank, overlong, valid]
}

fn assert_key_contract(responses: [(StatusCode, String); 4], expected_valid_status: StatusCode) {
    let [
        (status, body),
        (blank_status, blank_body),
        (overlong_status, overlong_body),
        (valid_status, valid_body),
    ] = responses;
    assert_eq!(status, StatusCode::BAD_REQUEST, "missing key body: {body}");
    assert_eq!(body, json!({ "error": IDEMPOTENCY_ERROR }).to_string());
    assert_eq!(
        blank_status,
        StatusCode::BAD_REQUEST,
        "blank key body: {blank_body}"
    );
    assert_eq!(
        blank_body,
        json!({ "error": IDEMPOTENCY_ERROR }).to_string()
    );
    assert_eq!(
        overlong_status,
        StatusCode::BAD_REQUEST,
        "overlong key body: {overlong_body}"
    );
    assert_eq!(
        overlong_body,
        json!({ "error": IDEMPOTENCY_ERROR }).to_string()
    );
    assert_eq!(
        valid_status, expected_valid_status,
        "valid key body: {valid_body}"
    );
}

#[tokio::test]
async fn record_payment_route_maps_invalid_idempotency_keys_to_bad_request() {
    let Some(fixture) = HttpFixture::new().await else {
        return;
    };
    let responses = key_contract_responses(
        &fixture,
        "/api/payments/record-payment",
        json!({
            "booking_id": ABSENT_BOOKING_ID,
            "amount": 1.0,
            "payment_method": "cash"
        }),
    )
    .await;
    fixture.cleanup().await;
    assert_key_contract(responses, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn legacy_payment_route_maps_invalid_idempotency_keys_to_bad_request() {
    let Some(fixture) = HttpFixture::new().await else {
        return;
    };
    fixture.seed_legacy_booking().await;
    let responses = key_contract_responses(
        &fixture,
        "/api/payments",
        json!({
            "booking_id": LEGACY_BOOKING_ID,
            "payment_method": "cash",
            "amount": 1.0
        }),
    )
    .await;
    fixture.cleanup().await;
    assert_key_contract(responses, StatusCode::OK);
}

#[tokio::test]
async fn single_ledger_payment_route_maps_invalid_idempotency_keys_to_bad_request() {
    let Some(fixture) = HttpFixture::new().await else {
        return;
    };
    let responses = key_contract_responses(
        &fixture,
        &format!("/api/ledgers/{ABSENT_LEDGER_ID}/payments"),
        json!({
            "payment_amount": 1.0,
            "payment_method": "cash"
        }),
    )
    .await;
    fixture.cleanup().await;
    assert_key_contract(responses, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn company_ledger_payment_route_maps_invalid_idempotency_keys_to_bad_request() {
    let Some(fixture) = HttpFixture::new().await else {
        return;
    };
    let responses = key_contract_responses(
        &fixture,
        "/api/ledgers/company-payments",
        json!({
            "ledger_ids": [ABSENT_LEDGER_ID],
            "payment_amount": 1.0,
            "payment_method": "cash"
        }),
    )
    .await;
    fixture.cleanup().await;
    assert_key_contract(responses, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn malformed_non_key_json_keeps_axum_extractor_status() {
    let Some(fixture) = HttpFixture::new().await else {
        return;
    };
    let (status, body) = fixture
        .post(
            "/api/payments/record-payment",
            json!({
                "booking_id": "not-an-integer",
                "amount": 1.0,
                "payment_method": "cash",
                "idempotency_key": "valid-key"
            }),
        )
        .await;
    fixture.cleanup().await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "body: {body}");
    assert_ne!(body, json!({ "error": IDEMPOTENCY_ERROR }).to_string());
}
