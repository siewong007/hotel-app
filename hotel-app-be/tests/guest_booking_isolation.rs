//! Guest-role isolation from the staff bookings API.
//!
//! The seeded `guest` role historically held `bookings:read` and
//! `bookings:create`, which let any self-registered guest account list every
//! booking in the hotel (full guest PII), read arbitrary booking details, and
//! create bookings with forged money fields (`payment_status: "paid"`,
//! `room_rate_override`, another guest's `guest_id`). These tests pin the
//! contract that the guest role can no longer reach the staff-side bookings
//! API at all; guests use the scoped `/api/guest-portal/*` surface instead.
//!
//! The staff parity assertions (receptionist still succeeds) prove the denials
//! come from the revoked grant and not from a broken router or guard.

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use hotel_app_be::{AuthService, core, routes};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;

const TEST_JWT_SECRET: &str = "hotel-app-be-guest-isolation-secret-32chars";
const GUEST_ACTOR_ID: i64 = 998_001;
const STAFF_ACTOR_ID: i64 = 998_002;
const FIXTURE_GUEST_ID: i64 = 998_011;
const FIXTURE_ROOM_TYPE_ID: i64 = 998_012;
const FIXTURE_ROOM_ID: i64 = 998_013;
const FIXTURE_BOOKING_ID: i64 = 998_020;

struct Fixture {
    pool: PgPool,
    app: Router,
    guest_authorization: String,
    staff_authorization: String,
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

impl Fixture {
    async fn new() -> Option<Self> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest isolation tests because DATABASE_URL is not set");
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
            .expect("guest isolation test database must connect");

        Self::cleanup_fixture(&pool).await;

        Self::upsert_actor(
            &pool,
            GUEST_ACTOR_ID,
            "guest_isolation_guest",
            "guest-isolation-guest@hotel.local",
            "guest",
        )
        .await;
        Self::upsert_actor(
            &pool,
            STAFF_ACTOR_ID,
            "guest_isolation_staff",
            "guest-isolation-staff@hotel.local",
            "staff",
        )
        .await;
        Self::assign_role(&pool, GUEST_ACTOR_ID, "guest").await;
        Self::assign_role(&pool, STAFF_ACTOR_ID, "receptionist").await;
        core::rbac_cache::invalidate_all();

        let guest_authorization = format!(
            "Bearer {}",
            Self::session_token(&pool, GUEST_ACTOR_ID, "guest_isolation_guest", "guest").await
        );
        let staff_authorization = format!(
            "Bearer {}",
            Self::session_token(
                &pool,
                STAFF_ACTOR_ID,
                "guest_isolation_staff",
                "receptionist",
            )
            .await
        );

        Self::seed_fixture_booking(&pool).await;

        let app = routes::create_router(pool.clone());
        Some(Self {
            pool,
            app,
            guest_authorization,
            staff_authorization,
            _guard: guard,
        })
    }

    async fn upsert_actor(pool: &PgPool, id: i64, username: &str, email: &str, user_type: &str) {
        sqlx::query(
            "INSERT INTO users \
             (id, username, email, full_name, user_type, is_active, is_verified, is_locked) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, $2, $3, 'Guest Isolation Actor', $4::usertype, true, true, false) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, email = EXCLUDED.email, \
                 user_type = EXCLUDED.user_type, is_active = true, \
                 is_verified = true, is_locked = false, deleted_at = NULL",
        )
        .bind(id)
        .bind(username)
        .bind(email)
        .bind(user_type)
        .execute(pool)
        .await
        .expect("actor fixture must be inserted");
    }

    async fn assign_role(pool: &PgPool, user_id: i64, role_name: &str) {
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = $2 \
             ON CONFLICT (user_id, role_id) DO NOTHING",
        )
        .bind(user_id)
        .bind(role_name)
        .execute(pool)
        .await
        .expect("role fixture must be inserted");
    }

    async fn session_token(pool: &PgPool, user_id: i64, username: &str, role_name: &str) -> String {
        let refresh_token = AuthService::generate_refresh_token();
        let session_id = AuthService::store_refresh_token(
            pool,
            user_id,
            &refresh_token,
            1,
            Some("127.0.0.1"),
            Some("guest-isolation-test"),
        )
        .await
        .expect("active session fixture must be inserted");
        AuthService::generate_session_jwt(
            user_id,
            username.to_string(),
            vec![role_name.to_string()],
            session_id,
        )
        .expect("test access token must encode")
    }

    async fn seed_fixture_booking(pool: &PgPool) {
        sqlx::query(
            "INSERT INTO room_types \
             (id, code, name, base_price, max_occupancy, keycard_deposit_amount, \
              service_charge_percentage) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'GSTISO', 'Guest Isolation Room Type', 100, 2, 0, 0)",
        )
        .bind(FIXTURE_ROOM_TYPE_ID)
        .execute(pool)
        .await
        .expect("room type fixture must be inserted");
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, 'GSTISO', $2, 'available')",
        )
        .bind(FIXTURE_ROOM_ID)
        .bind(FIXTURE_ROOM_TYPE_ID)
        .execute(pool)
        .await
        .expect("room fixture must be inserted");
        sqlx::query(
            "INSERT INTO guests \
             (id, full_name, first_name, last_name, email, tourism_type) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'Guest Isolation Guest', 'Guest', 'Isolation', \
                     'guest-isolation-guest-fixture@hotel.local', 'local')",
        )
        .bind(FIXTURE_GUEST_ID)
        .execute(pool)
        .await
        .expect("guest fixture must be inserted");
        sqlx::query(
            "INSERT INTO bookings \
             (id, booking_number, guest_id, guest_name, guest_email, room_id, \
              check_in_date, check_out_date, adults, children, room_rate, subtotal, \
              total_amount, status, payment_status, created_by, tourism_tax_amount, \
              extra_bed_charge) \
             OVERRIDING SYSTEM VALUE \
             VALUES ($1, 'BK-GST-ISO', $2, 'Guest Isolation Guest', \
                     'guest-isolation-guest-fixture@hotel.local', $3, '2030-01-01', \
                     '2030-01-02', 1, 0, 100, 100, 100, 'confirmed', 'unpaid', \
                     NULL, 0, 0)",
        )
        .bind(FIXTURE_BOOKING_ID)
        .bind(FIXTURE_GUEST_ID)
        .bind(FIXTURE_ROOM_ID)
        .execute(pool)
        .await
        .expect("booking fixture must be inserted");
    }

    async fn cleanup_fixture(pool: &PgPool) {
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
            .bind(FIXTURE_BOOKING_ID)
            .execute(pool)
            .await
            .expect("audit fixture cleanup must succeed");
        sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
            .bind(FIXTURE_BOOKING_ID)
            .execute(pool)
            .await
            .expect("history fixture cleanup must succeed");
        sqlx::query("DELETE FROM payments WHERE booking_id = $1")
            .bind(FIXTURE_BOOKING_ID)
            .execute(pool)
            .await
            .expect("payment fixture cleanup must succeed");
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(FIXTURE_BOOKING_ID)
            .execute(pool)
            .await
            .expect("booking fixture cleanup must succeed");
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(FIXTURE_GUEST_ID)
            .execute(pool)
            .await
            .expect("guest fixture cleanup must succeed");
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(FIXTURE_ROOM_ID)
            .execute(pool)
            .await
            .expect("room status log fixture cleanup must succeed");
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(FIXTURE_ROOM_ID)
            .execute(pool)
            .await
            .expect("room fixture cleanup must succeed");
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(FIXTURE_ROOM_TYPE_ID)
            .execute(pool)
            .await
            .expect("room type fixture cleanup must succeed");
        for user_id in [GUEST_ACTOR_ID, STAFF_ACTOR_ID] {
            let _ = sqlx::query("DELETE FROM audit_logs WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await;
            let _ = sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await;
            let _ = sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
                .bind(user_id)
                .execute(pool)
                .await;
            let _ = sqlx::query("DELETE FROM users WHERE id = $1")
                .bind(user_id)
                .execute(pool)
                .await;
        }
    }

    async fn request_with(
        &self,
        method: &str,
        uri: &str,
        authorization: &str,
        payload: Option<Value>,
    ) -> (StatusCode, String) {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, authorization);
        if payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        let body = payload
            .map(|value| Body::from(value.to_string()))
            .unwrap_or_else(Body::empty);
        let request = builder.body(body).expect("HTTP request must build");
        let response = self
            .app
            .clone()
            .oneshot(request)
            .await
            .expect("router response must complete");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body must be readable");
        (
            status,
            String::from_utf8(bytes.to_vec()).expect("body UTF-8"),
        )
    }
}

fn fixture_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// GET /api/bookings must not leak the hotel-wide booking list to the guest
/// role, while staff with `bookings:read` still receive it.
#[tokio::test]
async fn guest_role_cannot_list_staff_bookings() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    let (status, body) = fixture
        .request_with("GET", "/api/bookings", &fixture.guest_authorization, None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "guest role must be denied the staff booking list, got {status}: {body}"
    );

    let (status, _) = fixture
        .request_with(
            "GET",
            "/api/bookings?limit=5",
            &fixture.staff_authorization,
            None,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "receptionist parity broken: staff booking list should stay reachable"
    );
}

/// Booking detail by id carries full guest PII; the guest role must get the
/// same denial as the list endpoint.
#[tokio::test]
async fn guest_role_cannot_read_booking_detail() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    let (status, body) = fixture
        .request_with(
            "GET",
            &format!("/api/bookings/{FIXTURE_BOOKING_ID}"),
            &fixture.guest_authorization,
            None,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "guest role must be denied booking detail, got {status}: {body}"
    );
}

/// POST /api/bookings accepted forged money fields and cross-guest writes from
/// the guest role. The endpoint must reject the role outright and persist
/// nothing.
#[tokio::test]
async fn guest_role_cannot_create_staff_bookings() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };

    let forgery = json!({
        "guest_id": FIXTURE_GUEST_ID,
        "room_id": FIXTURE_ROOM_ID,
        "check_in_date": "2030-02-01",
        "check_out_date": "2030-02-03",
        "payment_status": "paid",
        "amount_paid": 50_000,
        "room_rate_override": 0.01,
        "source": "walk_in"
    });
    let (status, body) = fixture
        .request_with(
            "POST",
            "/api/bookings",
            &fixture.guest_authorization,
            Some(forgery),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "guest role must be denied staff-side booking creation, got {status}: {body}"
    );

    let forged_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookings \
         WHERE created_by = $1 AND total_amount < 100",
    )
    .bind(GUEST_ACTOR_ID)
    .fetch_one(&fixture.pool)
    .await
    .expect("forged booking count query must run");
    assert_eq!(forged_count, 0, "no forged booking may be persisted");
}
