//! Integration tests for rooms (status machine + sync), housekeeping tasks,
//! and maintenance requests against PostgreSQL.
//!
//! This area previously shipped two live 500s (see `.claude/rules/lessons.md`
//! 2026-07-10b): a missing `room_events` table, and a `let _ = sqlx::query(...)`
//! inside a transaction that swallowed a failure and let it poison a later
//! statement. Both are fixed in the current code
//! (`services::rooms::complete_housekeeping_cleaning_tx` now uses
//! `insert_room_status_event_best_effort_tx`, which wraps the best-effort
//! insert in a SAVEPOINT), but there was zero regression coverage for any of
//! rooms/housekeeping/maintenance until this file.
//!
//! All tests share one process-global serialization lock. `sync_all_room_statuses`
//! (scenario 4) scans and reconciles *every* active room in `available` /
//! `occupied` / `reserved` status, not just this file's fixture rooms; running
//! it concurrently with another test in this file that manually parks a fixture
//! room in one of those same statuses (e.g. the scenario-3 manual-status test)
//! could race and have the sync silently "correct" the other test's room out
//! from under it. Serializing avoids that without weakening either test.

use chrono::{Duration, Utc};
use hotel_app_be::{AuthService, Claims};
use jsonwebtoken::{EncodingKey, Header, encode};

/// Distinct per-binary JWT secret (each integration test file is its own
/// process, so `AuthService`'s `OnceLock` is independent of every other test
/// file) -- mirrors the pattern in `tests/auth_session.rs`.
const TEST_JWT_SECRET: &str = "hotel-app-be-rooms-housekeeping-test-secret-32chars-minimum";

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn ensure_jwt_secret() {
    let _ = AuthService::init_jwt_secret(TEST_JWT_SECRET);
}

/// Mints a valid bearer-token `HeaderMap` for `user_id`, for calling the
/// `services::rooms` handlers that (unlike `services::housekeeping` /
/// `services::maintenance`) authenticate via `HeaderMap` + `require_permission_helper`
/// directly rather than via an `Extension<i64>` populated by router middleware.
fn auth_headers(user_id: i64) -> axum::http::HeaderMap {
    ensure_jwt_secret();
    let claims = Claims {
        sub: user_id.to_string(),
        username: format!("rm980_actor_{user_id}"),
        iss: "hotel-app-be".to_string(),
        aud: "hotel-web".to_string(),
        exp: Some((Utc::now() + Duration::minutes(30)).timestamp() as usize),
        iat: Utc::now().timestamp() as usize,
        roles: vec!["staff".to_string()],
        sid: None,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(TEST_JWT_SECRET.as_bytes()),
    )
    .expect("encoding a test JWT must succeed");

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}")
            .parse()
            .expect("bearer header value must be valid"),
    );
    headers
}

mod postgres_tests {
    use super::{auth_headers, pg_serial_lock};
    use axum::extract::{Path, State};
    use axum::http::HeaderMap;
    use chrono::{Duration, NaiveDate, Utc};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::{
        CreateHousekeepingTaskRequest, CreateMaintenanceTicketRequest, RoomStatusUpdateInput,
        UpdateHousekeepingTaskRequest, UpdateMaintenanceTicketRequest,
    };
    use hotel_app_be::repositories::rooms_queries as rq;
    use hotel_app_be::services::{bookings, housekeeping, maintenance, rooms};
    use sqlx::{PgPool, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!(
                    "Skipping PostgreSQL rooms/housekeeping test because DATABASE_URL is not set"
                );
                return None;
            }
        };

        let guard = pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some((pool, guard))
    }

    // -----------------------------------------------------------------
    // Fixture helpers -- fixed ids in the 980_xxx block, never overlapping
    // with any other test file. Rooms/room_types/users/guests/bookings are
    // all seeded with `OVERRIDING SYSTEM VALUE` + `ON CONFLICT (id) DO
    // UPDATE` (upsert-reset), so reruns against a persistent dev DB are
    // deterministic. `housekeeping_tasks` / `maintenance_tickets` rows are
    // created through the real service functions under test
    // (`housekeeping::create_task` / `maintenance::create_ticket`), which
    // insert through an auto-generated IDENTITY column and do not accept an
    // explicit id -- those rows are tracked by the id the service returns
    // and cleaned up by `room_id` instead of a fixed literal.
    // -----------------------------------------------------------------

    async fn seed_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                username = EXCLUDED.username, \
                email = EXCLUDED.email, \
                full_name = EXCLUDED.full_name, \
                is_active = true, \
                is_verified = true",
        )
        .bind(actor_id)
        .bind(format!("rm980_actor_{actor_id}"))
        .bind(format!("rm980-actor-{actor_id}@hotel.local"))
        .bind(format!("RM980 Actor {actor_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    /// Grants `permission` (e.g. `"rooms:update"`) to `actor_id` via a
    /// shared `admin` test role -- needed for `services::rooms` handlers
    /// (which call `require_permission_helper`/`check_permission`
    /// themselves) and for `services::bookings::void_booking` (which checks
    /// `bookings:update`/`bookings:delete`/`bookings:manage` or booking
    /// ownership). `services::housekeeping` / `services::maintenance` do
    /// NOT check permission internally (that happens at router middleware,
    /// which direct service calls bypass), so tests that only touch those
    /// domains don't need this at all.
    async fn grant_permission(pool: &PgPool, actor_id: i64, permission: &str) {
        let (resource, action) = permission
            .split_once(':')
            .expect("permission must be \"resource:action\"");
        sqlx::query(
            "INSERT INTO roles (name, display_name, description, is_system_role, priority) \
             VALUES ('admin', 'Administrator', 'Test admin role', true, 100) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO permissions (name, resource, action, description, is_system_permission) \
             VALUES ($1, $2, $3, $1, true) \
             ON CONFLICT (name) DO NOTHING",
        )
        .bind(permission)
        .bind(resource)
        .bind(action)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT r.id, p.id FROM roles r CROSS JOIN permissions p \
             WHERE r.name = 'admin' AND p.name = $1 \
             ON CONFLICT DO NOTHING",
        )
        .bind(permission)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) \
             SELECT $1, id FROM roles WHERE name = 'admin' \
             ON CONFLICT DO NOTHING",
        )
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_actor(pool: &PgPool, actor_id: i64) {
        // The housekeeping/maintenance services audit-log under this actor;
        // their resource ids are IDENTITY-generated (fresh every run), so
        // cleanup keys on user_id to avoid accumulating orphan audit rows in
        // the persistent dev DB (adversarial-review finding, 2026-07-26).
        sqlx::query(
            "DELETE FROM audit_logs WHERE user_id = $1 AND resource_type IN ('housekeeping', 'maintenance')",
        )
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed_room_type(pool: &PgPool, room_type_id: i64) {
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 150.00, 2) \
             ON CONFLICT (id) DO UPDATE SET \
                code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(room_type_id)
        .bind(format!("RM980{room_type_id}"))
        .bind(format!("RM980 Room Type {room_type_id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_room_type(pool: &PgPool, room_type_id: i64) {
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed_room(pool: &PgPool, room_id: i64, room_type_id: i64, status: &str) {
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4) \
             ON CONFLICT (id) DO UPDATE SET \
                room_number = EXCLUDED.room_number, \
                room_type_id = EXCLUDED.room_type_id, \
                status = EXCLUDED.status, \
                last_cleaned_at = NULL",
        )
        .bind(room_id)
        .bind(format!("R980-{room_id}"))
        .bind(room_type_id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Deletes every row this domain can attach to a room, in FK-safe order.
    /// `room_status_change_log` has NO cascade on `room_id` (lesson
    /// 2026-07-26e / the room_events/room_history 2026-07-10b fix both apply
    /// here) so it MUST be deleted before the room; `room_events`,
    /// `room_history`, and `housekeeping_tasks` do cascade, and
    /// `maintenance_tickets.room_id` is `ON DELETE SET NULL`, but all four
    /// are deleted explicitly anyway so reruns don't accumulate orphan rows.
    async fn cleanup_room(pool: &PgPool, room_id: i64) {
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_events WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_history WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM housekeeping_tasks WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM maintenance_tickets WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'room' AND resource_id = $1",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed_guest(pool: &PgPool, guest_id: i64) {
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'RM980', $3, $4) \
             ON CONFLICT (id) DO UPDATE SET \
                full_name = EXCLUDED.full_name, email = EXCLUDED.email, ic_number = NULL",
        )
        .bind(guest_id)
        .bind(format!("RM980 Guest {guest_id}"))
        .bind(format!("Guest{guest_id}"))
        .bind(format!("rm980-guest-{guest_id}@hotel.local"))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_guest(pool: &PgPool, guest_id: i64) {
        sqlx::query("DELETE FROM guest_complimentary_credits WHERE guest_id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM user_guests WHERE guest_id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Fixture ids and stay details for a seeded booking.
    ///
    /// Deliberately no `Default`: every field must be stated at the call site
    /// so a forgotten id cannot silently become 0.
    struct BookingFixture<'a> {
        actor_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        status: &'a str,
        check_in: NaiveDate,
        check_out: NaiveDate,
    }

    async fn seed_booking(pool: &PgPool, fixture: BookingFixture<'_>) {
        let BookingFixture {
            actor_id,
            booking_id,
            guest_id,
            room_id,
            status,
            check_in,
            check_out,
        } = fixture;
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, guest_email, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status,
                is_complimentary, created_by
             )
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 0,
                     150.00, 300.00, 300.00, $9, 'partial', false, $10)
             ON CONFLICT (id) DO UPDATE SET
                guest_id = EXCLUDED.guest_id,
                room_id = EXCLUDED.room_id,
                check_in_date = EXCLUDED.check_in_date,
                check_out_date = EXCLUDED.check_out_date,
                status = EXCLUDED.status,
                payment_status = 'partial',
                is_complimentary = false,
                actual_check_in = NULL,
                actual_check_out = NULL",
        )
        .bind(booking_id)
        .bind(format!("BK-RM980-{booking_id}"))
        .bind(guest_id)
        .bind(format!("RM980 Guest {guest_id}"))
        .bind(format!("rm980-guest-{guest_id}@hotel.local"))
        .bind(room_id)
        .bind(check_in)
        .bind(check_out)
        .bind(status)
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn cleanup_booking(pool: &PgPool, booking_id: i64) {
        sqlx::query("DELETE FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM booking_modifications WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1",
        )
        .bind(booking_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn room_status_of(pool: &PgPool, room_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn count_room_rows(pool: &PgPool, table: &str, room_id: i64) -> i64 {
        let query = format!("SELECT COUNT(*) FROM {table} WHERE room_id = $1");
        sqlx::query_scalar::<_, i64>(&query)
            .bind(room_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    // ===================================================================
    // Scenario 1 + 2: booking check-in / check-out / void room-status side
    // effects (the actual application-level room state machine).
    // ===================================================================

    /// Check-in via the real `services::bookings::manual_checkin` workflow
    /// flips the room to `occupied`. There is no application-level
    /// "check-out" service (`repositories::booking::BookingRepository::check_out`
    /// exists but is never called from any handler/service -- verified via
    /// `grep -rn "::check_out(" src/`), so the actual check-out path a real
    /// booking update takes is a direct `bookings.status` write, which fires
    /// the `trg_sync_room_status_booking` trigger. This test exercises that
    /// exact trigger path directly to document its real behavior: checkout
    /// parks the room in `dirty` (needs cleaning), not `available`.
    #[tokio::test]
    async fn postgres_checkin_and_checkout_transition_room_status() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 980_001;
        let booking_id = 980_101;
        let guest_id = 980_201;
        let room_id = 980_301;
        let room_type_id = 980_401;

        cleanup_booking(&pool, booking_id).await;
        cleanup_room(&pool, room_id).await;
        cleanup_guest(&pool, guest_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;

        seed_actor(&pool, actor_id).await;
        seed_room_type(&pool, room_type_id).await;
        seed_room(&pool, room_id, room_type_id, "reserved").await;
        seed_guest(&pool, guest_id).await;
        seed_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                status: "confirmed",
                check_in: NaiveDate::from_ymd_opt(2031, 1, 10).unwrap(),
                check_out: NaiveDate::from_ymd_opt(2031, 1, 12).unwrap(),
            },
        )
        .await;
        // Check-in requires an IC/passport on file (see
        // `checkin_booking_flow_for_booking`); `seed_booking` doesn't set one.
        sqlx::query("UPDATE guests SET ic_number = $1 WHERE id = $2")
            .bind(format!("RM980-IC-{guest_id}"))
            .bind(guest_id)
            .execute(&pool)
            .await
            .unwrap();

        let checkin: hotel_app_be::models::CheckInRequest =
            serde_json::from_value(serde_json::json!({
                "payment_record": {"amount": 150.0, "payment_method": "cash", "payment_type": "booking", "notes": "rm980 full"}
            }))
            .unwrap();
        let booking = bookings::manual_checkin(&pool, actor_id, booking_id, Some(checkin))
            .await
            .expect("booking should check in");
        assert_eq!(booking.status, "checked_in");
        assert_eq!(
            room_status_of(&pool, room_id).await,
            "occupied",
            "check-in must flip the room to occupied"
        );

        // No service performs checkout; the real transition a booking update
        // takes is a direct status write that fires the sync trigger.
        sqlx::query(
            "UPDATE bookings SET status = 'checked_out', actual_check_out = CURRENT_TIMESTAMP \
             WHERE id = $1",
        )
        .bind(booking_id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            room_status_of(&pool, room_id).await,
            "dirty",
            "checkout must park the room dirty (needs cleaning), not available"
        );

        cleanup_booking(&pool, booking_id).await;
        cleanup_room(&pool, room_id).await;
        cleanup_guest(&pool, guest_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;
    }

    /// `services::bookings::void_booking` releases the room to `available`
    /// (distinct from checkout's `dirty`) -- both the explicit
    /// `release_room_tx` call and the sync trigger agree on this target.
    #[tokio::test]
    async fn postgres_void_booking_transitions_room_to_available() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 980_002;
        let booking_id = 980_102;
        let guest_id = 980_202;
        let room_id = 980_302;
        let room_type_id = 980_402;

        cleanup_booking(&pool, booking_id).await;
        cleanup_room(&pool, room_id).await;
        cleanup_guest(&pool, guest_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;

        seed_actor(&pool, actor_id).await;
        grant_permission(&pool, actor_id, "bookings:update").await;
        seed_room_type(&pool, room_type_id).await;
        seed_room(&pool, room_id, room_type_id, "reserved").await;
        seed_guest(&pool, guest_id).await;
        seed_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                status: "confirmed",
                check_in: NaiveDate::from_ymd_opt(2031, 2, 10).unwrap(),
                check_out: NaiveDate::from_ymd_opt(2031, 2, 12).unwrap(),
            },
        )
        .await;

        let result = bookings::void_booking(&pool, actor_id, booking_id, Some("rm980 void".to_string()))
            .await
            .expect("booking should void");
        assert_eq!(result["booking_id"].as_i64(), Some(booking_id));
        assert_eq!(
            room_status_of(&pool, room_id).await,
            "available",
            "voiding a booking must release the room to available"
        );

        cleanup_booking(&pool, booking_id).await;
        cleanup_room(&pool, room_id).await;
        cleanup_guest(&pool, guest_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // ===================================================================
    // Scenario 3: manual room-status-update service (`update_room_status_handler`)
    // -- validates a real caller (JWT + `rooms:update` permission) and
    // asserts what it writes to `room_history` / `room_events`.
    // ===================================================================

    /// `room_history` rows are only written for guest-facing transitions
    /// (into/out of `occupied`); every transition writes a `room_events`
    /// row unconditionally. Since 2026-07-26 the manual handler also matches
    /// the booking-trigger path's `update_room_status()` SQL semantics:
    /// it enforces `validate_room_status_transition()` (undefined/disallowed
    /// transitions are rejected as 400s before any write) and auto-creates a
    /// pending `housekeeping_tasks` cleaning row when a room is flipped
    /// `dirty`/`reserved_dirty` -- deduplicated against an existing open
    /// cleaning task, which the SQL path's no-op ON CONFLICT does not do.
    #[tokio::test]
    async fn postgres_manual_room_status_update_writes_history_and_events() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 980_003;
        let room_id = 980_303;
        let room_type_id = 980_403;

        cleanup_room(&pool, room_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;

        seed_actor(&pool, actor_id).await;
        grant_permission(&pool, actor_id, "rooms:update").await;
        seed_room_type(&pool, room_type_id).await;
        seed_room(&pool, room_id, room_type_id, "available").await;

        let headers: HeaderMap = auth_headers(actor_id);

        // available -> occupied: a guest-facing transition (is_checkin).
        let input: RoomStatusUpdateInput = serde_json::from_value(serde_json::json!({
            "status": "occupied"
        }))
        .unwrap();
        let room = rooms::update_room_status_handler(
            State(pool.clone()),
            Path(room_id),
            headers.clone(),
            axum::Json(input),
        )
        .await
        .expect("available -> occupied must be accepted");
        assert_eq!(room.status.as_deref(), Some("occupied"));
        assert_eq!(count_room_rows(&pool, "room_history", room_id).await, 1);
        assert_eq!(count_room_rows(&pool, "room_events", room_id).await, 1);

        // occupied -> dirty: also guest-facing (is_checkout).
        let input: RoomStatusUpdateInput = serde_json::from_value(serde_json::json!({
            "status": "dirty"
        }))
        .unwrap();
        let room = rooms::update_room_status_handler(
            State(pool.clone()),
            Path(room_id),
            headers.clone(),
            axum::Json(input),
        )
        .await
        .expect("occupied -> dirty must be accepted");
        assert_eq!(room.status.as_deref(), Some("dirty"));
        assert_eq!(count_room_rows(&pool, "room_history", room_id).await, 2);
        assert_eq!(count_room_rows(&pool, "room_events", room_id).await, 2);

        // Flipping to dirty must auto-create a pending cleaning task, like
        // the SQL update_room_status() path does for the booking trigger.
        assert_eq!(
            count_room_rows(&pool, "housekeeping_tasks", room_id).await,
            1,
            "dirty flip must auto-create a housekeeping task"
        );
        let (task_type, task_status): (String, String) = sqlx::query_as(
            "SELECT task_type, status FROM housekeeping_tasks WHERE room_id = $1",
        )
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(task_type, "cleaning");
        assert_eq!(task_status, "pending");

        // dirty -> maintenance: neither leg touches occupied, so no new
        // room_history row -- only the unconditional event log grows.
        let input: RoomStatusUpdateInput = serde_json::from_value(serde_json::json!({
            "status": "maintenance"
        }))
        .unwrap();
        let room = rooms::update_room_status_handler(
            State(pool.clone()),
            Path(room_id),
            headers.clone(),
            axum::Json(input),
        )
        .await
        .expect("dirty -> maintenance must be accepted");
        assert_eq!(room.status.as_deref(), Some("maintenance"));
        assert_eq!(
            count_room_rows(&pool, "room_history", room_id).await,
            2,
            "a non-guest-facing transition must not add a room_history row"
        );
        assert_eq!(count_room_rows(&pool, "room_events", room_id).await, 3);

        // maintenance -> occupied is not defined in room_status_transitions:
        // validate_room_status_transition() must now reject it as a 400
        // before any write happens.
        let input: RoomStatusUpdateInput = serde_json::from_value(serde_json::json!({
            "status": "occupied"
        }))
        .unwrap();
        let err = rooms::update_room_status_handler(
            State(pool.clone()),
            Path(room_id),
            headers.clone(),
            axum::Json(input),
        )
        .await
        .expect_err("maintenance -> occupied must be rejected by the state machine");
        match err {
            ApiError::BadRequest(msg) => assert!(
                msg.contains("is not defined") || msg.contains("is not allowed"),
                "unexpected rejection message: {msg}"
            ),
            other => panic!("expected BadRequest, got {other:?}"),
        }
        assert_eq!(
            room_status_of(&pool, room_id).await,
            "maintenance",
            "a rejected transition must not change the room status"
        );
        assert_eq!(
            count_room_rows(&pool, "room_events", room_id).await,
            3,
            "a rejected transition must not write a room_events row"
        );

        // maintenance -> dirty is allowed; the earlier cleaning task is still
        // open (pending), so no duplicate task may be created.
        let input: RoomStatusUpdateInput = serde_json::from_value(serde_json::json!({
            "status": "dirty"
        }))
        .unwrap();
        let room = rooms::update_room_status_handler(
            State(pool.clone()),
            Path(room_id),
            headers.clone(),
            axum::Json(input),
        )
        .await
        .expect("maintenance -> dirty must be accepted");
        assert_eq!(room.status.as_deref(), Some("dirty"));
        assert_eq!(
            count_room_rows(&pool, "housekeeping_tasks", room_id).await,
            1,
            "an open cleaning task must not be duplicated by a second dirty flip"
        );

        cleanup_room(&pool, room_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // ===================================================================
    // Scenario 4: sync_all_room_statuses() -- bulk reconciliation, and its
    // "never override housekeeping/maintenance states" policy.
    // ===================================================================

    #[tokio::test]
    async fn postgres_sync_all_room_statuses_respects_housekeeping_states() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 980_004;
        let booking_id = 980_104;
        let guest_id = 980_204;
        let room_type_id = 980_404;
        // room A: a real, currently-active checked-in booking, but the room
        // row itself is drifted to "reserved" (should be corrected to occupied).
        let room_a = 980_304;
        // room D: no booking at all, but drifted to "occupied" (should be
        // corrected to available).
        let room_d = 980_305;
        // room B / C: housekeeping/maintenance states must never be touched,
        // regardless of any drift, because they're outside the function's
        // `status IN ('available','occupied','reserved')` scan.
        let room_b = 980_306;
        let room_c = 980_307;

        cleanup_booking(&pool, booking_id).await;
        for room_id in [room_a, room_d, room_b, room_c] {
            cleanup_room(&pool, room_id).await;
        }
        cleanup_guest(&pool, guest_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;

        seed_actor(&pool, actor_id).await;
        seed_room_type(&pool, room_type_id).await;
        seed_guest(&pool, guest_id).await;

        seed_room(&pool, room_a, room_type_id, "available").await;
        let today = Utc::now().date_naive();
        seed_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id: room_a,
                status: "checked_in",
                check_in: today - Duration::days(1),
                check_out: today + Duration::days(1),
            },
        )
        .await;
        // The trigger just set room_a to "occupied" (correct); force it back
        // to a drifted value directly on the rooms table (no trigger there).
        sqlx::query("UPDATE rooms SET status = 'reserved' WHERE id = $1")
            .bind(room_a)
            .execute(&pool)
            .await
            .unwrap();

        seed_room(&pool, room_d, room_type_id, "occupied").await;
        seed_room(&pool, room_b, room_type_id, "dirty").await;
        seed_room(&pool, room_c, room_type_id, "maintenance").await;

        let changes = rq::sync_all_room_statuses(&pool, actor_id)
            .await
            .expect("sync_all_room_statuses must succeed");
        let by_room: std::collections::HashMap<i64, &rq::RoomStatusSyncChange> =
            changes.iter().map(|c| (c.room_id, c)).collect();

        let change_a = by_room
            .get(&room_a)
            .expect("drifted active-booking room must be reconciled");
        assert_eq!(change_a.old_status, "reserved");
        assert_eq!(change_a.new_status, "occupied");

        let change_d = by_room
            .get(&room_d)
            .expect("drifted unbooked room must be reconciled");
        assert_eq!(change_d.old_status, "occupied");
        assert_eq!(change_d.new_status, "available");

        assert!(
            !by_room.contains_key(&room_b),
            "a dirty room must never appear in the sync results"
        );
        assert!(
            !by_room.contains_key(&room_c),
            "a maintenance room must never appear in the sync results"
        );
        assert_eq!(room_status_of(&pool, room_a).await, "occupied");
        assert_eq!(room_status_of(&pool, room_d).await, "available");
        assert_eq!(
            room_status_of(&pool, room_b).await,
            "dirty",
            "sync must never override a dirty room"
        );
        assert_eq!(
            room_status_of(&pool, room_c).await,
            "maintenance",
            "sync must never override a maintenance room"
        );

        cleanup_booking(&pool, booking_id).await;
        for room_id in [room_a, room_d, room_b, room_c] {
            cleanup_room(&pool, room_id).await;
        }
        cleanup_guest(&pool, guest_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // ===================================================================
    // Scenario 5: housekeeping task create + PATCH lifecycle -- the exact
    // path that produced a live 500 in lesson 2026-07-10b (missing table +
    // a swallowed-error transaction abort). Now backed by real tables and a
    // SAVEPOINT-wrapped best-effort event insert; this asserts it actually
    // commits cleanly end to end.
    // ===================================================================

    #[tokio::test]
    async fn postgres_housekeeping_task_create_and_complete_cleans_room() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 980_005;
        let room_id = 980_308;
        let room_type_id = 980_405;

        cleanup_room(&pool, room_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;

        seed_actor(&pool, actor_id).await;
        seed_room_type(&pool, room_type_id).await;
        seed_room(&pool, room_id, room_type_id, "dirty").await;

        let create_input: CreateHousekeepingTaskRequest =
            serde_json::from_value(serde_json::json!({
                "room_id": room_id,
                "notes": "Guest checked out, needs full clean"
            }))
            .unwrap();
        let task = housekeeping::create_task(&pool, actor_id, create_input)
            .await
            .expect("housekeeping task creation must succeed");
        assert_eq!(task.status, "pending");
        assert_eq!(task.task_type, "cleaning");
        assert_eq!(task.room_id, room_id);

        let start_input: UpdateHousekeepingTaskRequest =
            serde_json::from_value(serde_json::json!({"status": "in_progress"})).unwrap();
        let task = housekeeping::update_task(&pool, actor_id, task.id, start_input)
            .await
            .expect("pending -> in_progress must be a valid transition");
        assert_eq!(task.status, "in_progress");
        assert!(task.started_at.is_some());

        let complete_input: UpdateHousekeepingTaskRequest = serde_json::from_value(
            serde_json::json!({"status": "completed", "notes": "All done"}),
        )
        .unwrap();
        let task = housekeeping::update_task(&pool, actor_id, task.id, complete_input)
            .await
            .expect(
                "completing a cleaning task must commit the whole transaction \
                 (this is the exact path that 500'd in lessons.md 2026-07-10b)",
            );
        assert_eq!(task.status, "completed");
        assert!(task.completed_at.is_some());

        assert_eq!(
            room_status_of(&pool, room_id).await,
            "available",
            "completing the cleaning must release the room"
        );
        let last_cleaned_at: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT last_cleaned_at FROM rooms WHERE id = $1")
                .bind(room_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(last_cleaned_at.is_some());
        assert!(count_room_rows(&pool, "room_events", room_id).await >= 1);

        let completed_audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs \
             WHERE resource_type = 'housekeeping' AND resource_id = $1 \
               AND action = 'housekeeping_task_completed'",
        )
        .bind(task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(completed_audit_count, 1);

        cleanup_room(&pool, room_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;
    }

    // ===================================================================
    // Scenario 6: maintenance ticket create/update/resolve basics.
    // ===================================================================

    #[tokio::test]
    async fn postgres_maintenance_ticket_lifecycle() {
        let Some((pool, _guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 980_006;
        let room_id = 980_309;
        let room_type_id = 980_406;

        cleanup_room(&pool, room_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;

        seed_actor(&pool, actor_id).await;
        seed_room_type(&pool, room_type_id).await;
        seed_room(&pool, room_id, room_type_id, "available").await;

        let create_input: CreateMaintenanceTicketRequest =
            serde_json::from_value(serde_json::json!({
                "room_id": room_id,
                "title": "Leaky faucet",
                "description": "Bathroom sink drips constantly",
                "category": "plumbing"
            }))
            .unwrap();
        let ticket = maintenance::create_ticket(&pool, actor_id, create_input)
            .await
            .expect("maintenance ticket creation must succeed");
        assert_eq!(ticket.status, "open");
        assert_eq!(ticket.category, "plumbing");
        assert_eq!(ticket.room_id, Some(room_id));
        assert!(ticket.ticket_number.starts_with("MT-"));

        let start_input: UpdateMaintenanceTicketRequest =
            serde_json::from_value(serde_json::json!({"status": "in_progress"})).unwrap();
        let ticket = maintenance::update_ticket(&pool, actor_id, ticket.id, start_input)
            .await
            .expect("open -> in_progress must be a valid transition");
        assert_eq!(ticket.status, "in_progress");
        assert!(ticket.started_at.is_some());

        let resolve_input: UpdateMaintenanceTicketRequest = serde_json::from_value(
            serde_json::json!({"status": "resolved", "resolution_notes": "Replaced the washer"}),
        )
        .unwrap();
        let ticket = maintenance::update_ticket(&pool, actor_id, ticket.id, resolve_input)
            .await
            .expect("in_progress -> resolved must be a valid transition");
        assert_eq!(ticket.status, "resolved");
        assert_eq!(ticket.resolution_notes.as_deref(), Some("Replaced the washer"));
        assert!(ticket.resolved_at.is_some());

        let close_input: UpdateMaintenanceTicketRequest =
            serde_json::from_value(serde_json::json!({"status": "closed"})).unwrap();
        let ticket = maintenance::update_ticket(&pool, actor_id, ticket.id, close_input)
            .await
            .expect("resolved -> closed must be a valid transition");
        assert_eq!(ticket.status, "closed");

        let updated_audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs \
             WHERE resource_type = 'maintenance' AND resource_id = $1 \
               AND action = 'maintenance_ticket_updated'",
        )
        .bind(ticket.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(updated_audit_count, 3);

        cleanup_room(&pool, room_id).await;
        cleanup_room_type(&pool, room_type_id).await;
        cleanup_actor(&pool, actor_id).await;
    }
}
