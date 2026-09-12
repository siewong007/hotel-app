//! Guest-portal cross-user isolation (IDOR/BOLA).
//!
//! `guest_booking_isolation.rs` pins that the guest role cannot reach the
//! staff bookings API; this file pins the portal side: a session token minted
//! for guest A must never act on guest B's booking, at both the read and the
//! mutating payment/cancellation surfaces. Session rows hold sha256(token) —
//! the fixture writes the hash in SQL so no hashing dep is needed in tests.

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use hotel_app_be::routes;
use serde_json::Value;
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;

const GUEST_A: i64 = 997_001;
const GUEST_B: i64 = 997_002;
const BOOKING_A: i64 = 997_010;
const BOOKING_B: i64 = 997_011;
const ROOM_TYPE_ID: i64 = 997_012;
const ROOM_ID: i64 = 997_013;
const SESSION_A_TOKEN: &str = "idor-fixture-session-token-A";

struct Fixture {
    pool: PgPool,
    app: Router,
    session_a: String,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

fn fixture_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

impl Fixture {
    async fn new() -> Option<Self> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest portal IDOR tests because DATABASE_URL is not set");
                return None;
            }
        };
        let guard = fixture_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(3)
            .connect(&database_url)
            .await
            .expect("guest portal IDOR test database must connect");

        Self::cleanup(&pool).await;

        sqlx::query(
            "INSERT INTO room_types \
             (id, code, name, base_price, max_occupancy, keycard_deposit_amount, \
              service_charge_percentage) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'IDOR', 'IDOR Room Type', 100, 2, 0, 0) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(ROOM_TYPE_ID)
        .execute(&pool)
        .await
        .expect("room type fixture");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'IDOR1', $2, 'available') \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(ROOM_ID)
        .bind(ROOM_TYPE_ID)
        .execute(&pool)
        .await
        .expect("room fixture");

        for (guest_id, nick) in [(GUEST_A, "IDOR Guest A"), (GUEST_B, "IDOR Guest B")] {
            sqlx::query(
                "INSERT INTO guests \
                 (id, nick_name, first_name, last_name, email, tourism_type) \
                 OVERRIDING SYSTEM VALUE \
                 VALUES ($1, $2, 'Idor', 'Fixture', $3, 'local') \
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(guest_id)
            .bind(nick)
            .bind(format!("idor-{guest_id}@hotel.local"))
            .execute(&pool)
            .await
            .expect("guest fixture");
        }

        for (booking_id, guest_id, number) in
            [(BOOKING_A, GUEST_A, "BK-IDOR-A"), (BOOKING_B, GUEST_B, "BK-IDOR-B")]
        {
            sqlx::query(
                "INSERT INTO bookings \
                 (id, booking_number, guest_id, guest_name, guest_email, room_id, \
                  check_in_date, check_out_date, adults, children, room_rate, \
                  subtotal, total_amount, status, payment_status, created_by, \
                  tourism_tax_amount, extra_bed_charge) \
                 OVERRIDING SYSTEM VALUE \
                 VALUES ($1, $2, $3, 'Idor Fixture', $4, $5, '2030-02-01', \
                         '2030-02-02', 1, 0, 100, 100, 100, 'confirmed', 'unpaid', \
                         NULL, 0, 0) \
                 ON CONFLICT (id) DO NOTHING",
            )
            .bind(booking_id)
            .bind(number)
            .bind(guest_id)
            .bind(format!("idor-{guest_id}@hotel.local"))
            .bind(ROOM_ID)
            .execute(&pool)
            .await
            .expect("booking fixture");
        }

        // Mint guest A's portal session straight into the table — the store
        // holds sha256(token), so the plaintext only ever exists here.
        sqlx::query(
            "INSERT INTO guest_portal_sessions (guest_id, token_hash, expires_at) \
             VALUES ($1, encode(sha256($2::bytea), 'hex'), \
                     now() + interval '1 hour')",
        )
        .bind(GUEST_A)
        .bind(SESSION_A_TOKEN)
        .execute(&pool)
        .await
        .expect("session fixture");

        let app = routes::create_router(pool.clone());
        Some(Self {
            pool,
            app,
            session_a: format!("Bearer {SESSION_A_TOKEN}"),
            _guard: guard,
        })
    }

    async fn cleanup(pool: &PgPool) {
        sqlx::query("DELETE FROM guest_portal_sessions WHERE guest_id = ANY($1)")
            .bind(&[GUEST_A, GUEST_B][..])
            .execute(pool)
            .await
            .expect("session cleanup");
        sqlx::query("DELETE FROM payments WHERE booking_id = ANY($1)")
            .bind(&[BOOKING_A, BOOKING_B][..])
            .execute(pool)
            .await
            .expect("payment cleanup");
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = ANY($1)")
            .bind(&[BOOKING_A, BOOKING_B][..])
            .execute(pool)
            .await
            .expect("audit cleanup");
        sqlx::query("DELETE FROM booking_history WHERE booking_id = ANY($1)")
            .bind(&[BOOKING_A, BOOKING_B][..])
            .execute(pool)
            .await
            .expect("history cleanup");
        sqlx::query("DELETE FROM bookings WHERE id = ANY($1)")
            .bind(&[BOOKING_A, BOOKING_B][..])
            .execute(pool)
            .await
            .expect("booking cleanup");
        sqlx::query("DELETE FROM guests WHERE id = ANY($1)")
            .bind(&[GUEST_A, GUEST_B][..])
            .execute(pool)
            .await
            .expect("guest cleanup");
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(ROOM_ID)
            .execute(pool)
            .await
            .expect("room cleanup");
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(ROOM_TYPE_ID)
            .execute(&pool.clone())
            .await
            .expect("room type cleanup");
    }

    async fn call(
        &self,
        method: &str,
        uri: &str,
        authorization: Option<&str>,
        payload: Option<Value>,
    ) -> (StatusCode, String) {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(value) = authorization {
            builder = builder.header(header::AUTHORIZATION, value);
        }
        if payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let body = payload
            .map(|value| Body::from(value.to_string()))
            .unwrap_or_else(Body::empty);
        let response = self
            .app
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let text = String::from_utf8_lossy(
            &to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        )
        .to_string();
        (status, text)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let pool = self.pool.clone();
        tokio::spawn(async move { Fixture::cleanup(&pool).await });
    }
}

#[tokio::test]
async fn session_cannot_claim_another_guests_booking_for_bank_transfer() {
    let Some(fixture) = Fixture::new().await else { return };

    let (status, _) = fixture
        .call(
            "POST",
            "/api/guest-portal/me/payments/bank-transfer",
            Some(&fixture.session_a),
            Some(serde_json::json!({ "booking_id": BOOKING_B })),
        )
        .await;

    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "guest A paying for guest B's booking must be denied"
    );
}

#[tokio::test]
async fn session_cannot_cancel_another_guests_booking() {
    let Some(fixture) = Fixture::new().await else { return };

    let (status, _) = fixture
        .call(
            "POST",
            &format!("/api/guest-portal/me/bookings/{BOOKING_B}/cancel"),
            Some(&fixture.session_a),
            Some(serde_json::json!({ "reason": "idor test" })),
        )
        .await;

    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "guest A cancelling guest B's booking must be denied"
    );
}

#[tokio::test]
async fn unauthenticated_session_routes_require_a_token() {
    let Some(fixture) = Fixture::new().await else { return };

    let (status, _) = fixture
        .call(
            "POST",
            "/api/guest-portal/me/payments/bank-transfer",
            None,
            Some(serde_json::json!({ "booking_id": BOOKING_A })),
        )
        .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn booking_list_contains_only_the_callers_rows() {
    let Some(fixture) = Fixture::new().await else { return };

    let (status, body) = fixture
        .call(
            "GET",
            "/api/guest-portal/me/bookings",
            Some(&fixture.session_a),
            None,
        )
        .await;

    assert_eq!(status, StatusCode::OK, "list failed: {body}");
    let parsed: Value = serde_json::from_str(&body).unwrap();
    let items = parsed["items"]
        .as_array()
        .or_else(|| parsed.as_array())
        .cloned()
        .unwrap_or_default();
    let numbers: Vec<&str> = items
        .iter()
        .filter_map(|b| b["booking_number"].as_str())
        .collect();
    assert!(
        numbers.iter().all(|n| *n == "BK-IDOR-A"),
        "guest A's list leaked another guest's booking: {numbers:?}"
    );
}
