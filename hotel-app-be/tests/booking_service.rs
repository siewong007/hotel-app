//! Integration tests for `services::booking`
//!
//! Pure unit tests run without a database; PostgreSQL workflow tests use
//! `DATABASE_URL` when it is available.

use hotel_app_be::services::booking;

// The PostgreSQL workflow tests share a single database and exercise DDL on the
// `audit_logs` table (installing/dropping failure triggers). Run in parallel
// they deadlock — a trigger's AccessExclusiveLock races other tests' inserts.
// This process-global async mutex serializes them; each test holds the guard
// for its whole body via the value returned from `setup_pg_pool`.
fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

// ---------------------------------------------------------------------------
// Unit tests — no database needed
// ---------------------------------------------------------------------------

#[test]
fn booking_number_has_correct_format() {
    let n = booking::generate_booking_number();

    // Expected: "BK-YYYYMMDD-XXXXXXXX"
    let parts: Vec<&str> = n.splitn(3, '-').collect();
    assert_eq!(
        parts.len(),
        3,
        "number should have 3 dash-separated segments: {n}"
    );
    assert_eq!(parts[0], "BK");
    assert_eq!(
        parts[1].len(),
        8,
        "date segment should be 8 digits (YYYYMMDD): {n}"
    );
    assert!(
        parts[1].chars().all(|c| c.is_ascii_digit()),
        "date segment must be all digits: {n}"
    );
    assert_eq!(parts[2].len(), 8, "UUID suffix should be 8 hex chars: {n}");
    assert!(
        parts[2].chars().all(|c| c.is_ascii_hexdigit() || c == '-'),
        "UUID suffix should be hex: {n}"
    );
}

#[test]
fn booking_numbers_are_unique() {
    let numbers: std::collections::HashSet<String> = (0..200)
        .map(|_| booking::generate_booking_number())
        .collect();
    assert_eq!(
        numbers.len(),
        200,
        "Generated duplicate booking numbers within 200 samples"
    );
}

mod postgres_tests {
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::bookings;
    use rust_decimal::Decimal;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping PostgreSQL workflow test because DATABASE_URL is not set");
                return None;
            }
        };

/// Initialize process config exactly once for suites whose flows now touch
    /// config-dependent side effects (checkout receipt footer).
    fn core_config_init_in_tests() {
        if std::env::var("SETTINGS_CACHE_TTL_SECS").is_err() {
            // SAFETY: single-test binary; no concurrent environment readers.
            unsafe { std::env::set_var("SETTINGS_CACHE_TTL_SECS", "0") };
        }
        if std::env::var("JWT_SECRET").is_err() {
            // SAFETY: single-test binary; no concurrent environment readers.
            unsafe { std::env::set_var("JWT_SECRET", "booking-service-test-secret-0123456789ab") };
        }
        hotel_app_be::core::config::init_from_env()
            .expect("test config initialises from env");
    }
    
    

        // Serialize against the other PostgreSQL workflow tests (shared DB + DDL).
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");

        // Checkout now queues a transactional receipt email whose footer reads
        // process config (public base URL + token secret). Production always
        // initializes config at startup; mirror that here.
        core_config_init_in_tests();

        Some((pool, guard))
    }

    async fn ensure_admin_actor(pool: &PgPool, actor_id: i64) {
        sqlx::query(
            "INSERT INTO roles (name, display_name, description, is_system_role, priority) \
             VALUES ('admin', 'Administrator', 'Test admin role', true, 100) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO permissions (name, resource, action, description, is_system_permission) VALUES \
             ('bookings:update', 'bookings', 'update', 'Update bookings', true), \
             ('bookings:delete', 'bookings', 'delete', 'Delete bookings', true), \
             ('bookings:manage', 'bookings', 'manage', 'Manage bookings', true) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT r.id, p.id FROM roles r CROSS JOIN permissions p \
             WHERE r.name = 'admin' AND p.name IN ('bookings:update', 'bookings:delete', 'bookings:manage') \
             ON CONFLICT DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();
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
        .bind(format!("pg_void_actor_{actor_id}"))
        .bind(format!("pg-void-actor-{actor_id}@hotel.local"))
        .bind(format!("PG Void Actor {actor_id}"))
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

    async fn cleanup_pg_fixture(
        pool: &PgPool,
        actor_id: i64,
        room_type_id: i64,
        room_ids: &[i64],
        guest_ids: &[i64],
        booking_ids: &[i64],
    ) {
        for booking_id in booking_ids {
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

        for guest_id in guest_ids {
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

        for room_id in room_ids {
            sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
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

        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
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

    /// Fixture ids and flags for a seeded PostgreSQL booking.
    ///
    /// Deliberately no `Default`: every field must be stated at the call site
    /// so a forgotten id cannot silently become 0.
    struct BookingFixture<'a> {
        actor_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
        room_type_id: i64,
        status: &'a str,
        is_complimentary: bool,
    }

    async fn seed_pg_booking(pool: &PgPool, fixture: BookingFixture<'_>) {
        let BookingFixture {
            actor_id,
            booking_id,
            guest_id,
            room_id,
            room_type_id,
            status,
            is_complimentary,
        } = fixture;
        ensure_admin_actor(pool, actor_id).await;
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 150.00, 2) \
             ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(room_type_id)
        .bind(format!("PGRT{room_type_id}"))
        .bind(format!("PG Test Room Type {room_type_id}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'reserved') \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = EXCLUDED.status",
        )
        .bind(room_id)
        .bind(format!("PG{room_id}"))
        .bind(room_type_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Postgres', $3, $4) \
             ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email",
        )
        .bind(guest_id)
        .bind(format!("Postgres Guest {guest_id}"))
        .bind(format!("Guest{guest_id}"))
        .bind(format!("pg-guest-{guest_id}@hotel.local"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, guest_email, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status,
                is_complimentary, created_by
             )
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, '2031-01-10', '2031-01-12', 1, 0,
                     150.00, 300.00, 300.00, $7, 'partial', $8, $9)",
        )
        .bind(booking_id)
        .bind(format!("BK-PG-{booking_id}"))
        .bind(guest_id)
        .bind(format!("Postgres Guest {guest_id}"))
        .bind(format!("pg-guest-{guest_id}@hotel.local"))
        .bind(room_id)
        .bind(status)
        .bind(is_complimentary)
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_pg_completed_payment(pool: &PgPool, booking_id: i64, actor_id: i64) {
        sqlx::query(
            "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status, created_by, processed_by) \
             VALUES ($1, $2, 'cash', 'booking', 'completed', $3, $3)",
        )
        .bind(booking_id)
        .bind(Decimal::new(10_000, 2))
        .bind(actor_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn count_pg_rows(pool: &PgPool, table: &str, booking_id: i64) -> i64 {
        let query = format!("SELECT COUNT(*) FROM {table} WHERE booking_id = $1");
        sqlx::query_scalar::<_, i64>(&query)
            .bind(booking_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn postgres_void_booking_updates_workflow_side_effects() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_001;
        let booking_id = 930_101;
        let guest_id = 930_201;
        let room_id = 930_301;
        let room_type_id = 930_401;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: false,
            },
        )
        .await;
        insert_pg_completed_payment(&pool, booking_id, actor_id).await;

        let result =
            bookings::void_booking(&pool, actor_id, booking_id, Some("PG void".to_string()))
                .await
                .expect("postgres booking should void");

        let booking = sqlx::query("SELECT status, payment_status FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_status: String =
            sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1 AND action = 'booking_voided'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(result["booking_id"].as_i64(), Some(booking_id));
        assert_eq!(booking.get::<String, _>("status"), "voided");
        assert_eq!(booking.get::<String, _>("payment_status"), "void");
        assert_eq!(room_status, "available");
        assert_eq!(payment_status, "void");
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );
        assert_eq!(audit_count, 1);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_concurrent_void_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_002;
        let booking_id = 930_102;
        let guest_id = 930_202;
        let room_id = 930_302;
        let room_type_id = 930_402;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: false,
            },
        )
        .await;

        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let (first, second) = tokio::join!(
            bookings::void_booking(&pool_a, actor_id, booking_id, None),
            bookings::void_booking(&pool_b, actor_id, booking_id, None)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            success_count, 1,
            "exactly one concurrent void should succeed: first={first:?}, second={second:?}"
        );
        let failed = if first.is_ok() { second } else { first };
        assert!(
            matches!(failed, Err(ApiError::BadRequest(_))),
            "second void should return a controlled state error"
        );
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_reactivation_rejects_room_date_conflict() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_003;
        let voided_booking_id = 930_103;
        let conflicting_booking_id = 930_104;
        let voided_guest_id = 930_203;
        let conflicting_guest_id = 930_204;
        let room_id = 930_303;
        let room_type_id = 930_403;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[voided_guest_id, conflicting_guest_id],
            &[voided_booking_id, conflicting_booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id: voided_booking_id,
                guest_id: voided_guest_id,
                room_id,
                room_type_id,
                status: "voided",
                is_complimentary: false,
            },
        )
        .await;
        sqlx::query(
            "INSERT INTO guests (id, full_name, first_name, last_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Conflict', $3, $4)",
        )
        .bind(conflicting_guest_id)
        .bind(format!("Conflict Guest {conflicting_guest_id}"))
        .bind(format!("Guest{conflicting_guest_id}"))
        .bind(format!("pg-conflict-{conflicting_guest_id}@hotel.local"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, guest_name, guest_email, room_id,
                check_in_date, check_out_date, adults, children,
                room_rate, subtotal, total_amount, status, payment_status, created_by
             )
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, '2031-01-11', '2031-01-13', 1, 0,
                     150.00, 300.00, 300.00, 'confirmed', 'partial', $7)",
        )
        .bind(conflicting_booking_id)
        .bind(format!("BK-PG-{conflicting_booking_id}"))
        .bind(conflicting_guest_id)
        .bind(format!("Conflict Guest {conflicting_guest_id}"))
        .bind(format!("pg-conflict-{conflicting_guest_id}@hotel.local"))
        .bind(room_id)
        .bind(actor_id)
        .execute(&pool)
        .await
        .unwrap();

        let result = bookings::reactivate_booking(&pool, actor_id, voided_booking_id).await;

        assert!(
            matches!(result, Err(ApiError::BadRequest(ref message)) if message.contains("already booked")),
            "expected conflict rejection, got: {result:?}"
        );
        let status: String = sqlx::query_scalar("SELECT status FROM bookings WHERE id = $1")
            .bind(voided_booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "voided");

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[voided_guest_id, conflicting_guest_id],
            &[voided_booking_id, conflicting_booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_void_restores_complimentary_credits() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_004;
        let booking_id = 930_105;
        let guest_id = 930_205;
        let room_id = 930_305;
        let room_type_id = 930_405;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: true,
            },
        )
        .await;

        let result = bookings::void_booking(&pool, actor_id, booking_id, None)
            .await
            .expect("complimentary postgres booking should void");

        let credits: i32 = sqlx::query_scalar(
            "SELECT nights_available FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(result["complimentary_nights_credited"].as_i64(), Some(2));
        assert_eq!(credits, 2);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    async fn install_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_void_audit_{booking_id}");
        let trigger_name = format!("trg_fail_void_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(&format!(
            r#"
            CREATE FUNCTION {function_name}() RETURNS trigger AS $$
            BEGIN
                IF NEW.action = 'booking_voided'
                   AND NEW.resource_type = 'booking'
                   AND NEW.resource_id = {booking_id} THEN
                    RAISE EXCEPTION 'forced audit failure for booking {booking_id}';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            "#
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!(
            "CREATE TRIGGER {trigger_name} BEFORE INSERT ON audit_logs \
             FOR EACH ROW EXECUTE FUNCTION {function_name}()"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn drop_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_void_audit_{booking_id}");
        let trigger_name = format!("trg_fail_void_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn postgres_void_rolls_back_when_late_audit_insert_fails() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 930_005;
        let booking_id = 930_106;
        let guest_id = 930_206;
        let room_id = 930_306;
        let room_type_id = 930_406;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: true,
            },
        )
        .await;
        insert_pg_completed_payment(&pool, booking_id, actor_id).await;
        install_audit_failure_trigger(&pool, booking_id).await;

        let result = bookings::void_booking(&pool, actor_id, booking_id, None).await;
        drop_audit_failure_trigger(&pool, booking_id).await;

        assert!(
            matches!(result, Err(ApiError::Database(_))),
            "expected forced audit failure, got: {result:?}"
        );

        let booking = sqlx::query(
            "SELECT status, payment_status, cancelled_at IS NULL AS no_cancelled_at, cancelled_by IS NULL AS no_cancelled_by \
             FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let payment_status: String =
            sqlx::query_scalar("SELECT status FROM payments WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let credits_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM guest_complimentary_credits WHERE guest_id = $1 AND room_type_id = $2",
        )
        .bind(guest_id)
        .bind(room_type_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(booking.get::<String, _>("status"), "confirmed");
        assert_eq!(booking.get::<String, _>("payment_status"), "partial");
        assert!(booking.get::<bool, _>("no_cancelled_at"));
        assert!(booking.get::<bool, _>("no_cancelled_by"));
        assert_eq!(room_status, "reserved");
        assert_eq!(payment_status, "completed");
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 0);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            0
        );
        assert_eq!(credits_count, 0);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    // -----------------------------------------------------------------------
    // Manual check-in (PostgreSQL)
    // -----------------------------------------------------------------------

    async fn install_checkin_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_checkin_audit_{booking_id}");
        let trigger_name = format!("trg_fail_checkin_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(&format!(
            r#"
            CREATE FUNCTION {function_name}() RETURNS trigger AS $$
            BEGIN
                IF NEW.action = 'booking_checkin'
                   AND NEW.resource_type = 'booking'
                   AND NEW.resource_id = {booking_id} THEN
                    RAISE EXCEPTION 'forced audit failure for booking {booking_id}';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
            "#
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!(
            "CREATE TRIGGER {trigger_name} BEFORE INSERT ON audit_logs \
             FOR EACH ROW EXECUTE FUNCTION {function_name}()"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    async fn drop_checkin_audit_failure_trigger(pool: &PgPool, booking_id: i64) {
        let function_name = format!("fail_checkin_audit_{booking_id}");
        let trigger_name = format!("trg_fail_checkin_audit_{booking_id}");
        sqlx::query(&format!(
            "DROP TRIGGER IF EXISTS {trigger_name} ON audit_logs"
        ))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(&format!("DROP FUNCTION IF EXISTS {function_name}()"))
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn postgres_checkin_updates_workflow_side_effects() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_001;
        let booking_id = 940_101;
        let guest_id = 940_201;
        let room_id = 940_301;
        let room_type_id = 940_401;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: false,
            },
        )
        .await;
        // Check-in now requires an IC/passport on file (see
        // `checkin_booking_flow_for_booking`); `seed_pg_booking` doesn't set one.
        sqlx::query("UPDATE guests SET ic_number = $1 WHERE id = $2")
            .bind(format!("PG-IC-{guest_id}"))
            .bind(guest_id)
            .execute(&pool)
            .await
            .unwrap();

        let checkin: hotel_app_be::models::CheckInRequest =
            serde_json::from_value(serde_json::json!({
                "payment_record": {"amount": 150.0, "payment_method": "cash", "payment_type": "booking", "notes": "pg full"}
            }))
            .unwrap();
        let booking = bookings::manual_checkin(&pool, actor_id, booking_id, Some(checkin))
            .await
            .expect("postgres booking should check in");
        assert_eq!(booking.status, "checked_in");

        let row = sqlx::query(
            "SELECT status, actual_check_in IS NOT NULL AS has_actual FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1 AND action = 'booking_checkin'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(row.get::<String, _>("status"), "checked_in");
        assert!(row.get::<bool, _>("has_actual"));
        assert_eq!(room_status, "occupied");
        assert_eq!(count_pg_rows(&pool, "payments", booking_id).await, 1);
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );
        assert_eq!(audit_count, 1);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_concurrent_checkin_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_002;
        let booking_id = 940_102;
        let guest_id = 940_202;
        let room_id = 940_302;
        let room_type_id = 940_402;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: false,
            },
        )
        .await;
        sqlx::query("UPDATE guests SET ic_number = $1 WHERE id = $2")
            .bind(format!("PG-IC-{guest_id}"))
            .bind(guest_id)
            .execute(&pool)
            .await
            .unwrap();

        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let (first, second) = tokio::join!(
            bookings::manual_checkin(&pool_a, actor_id, booking_id, None),
            bookings::manual_checkin(&pool_b, actor_id, booking_id, None)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            success_count, 1,
            "exactly one concurrent check-in should succeed: first={first:?}, second={second:?}"
        );
        let failed = if first.is_ok() { second } else { first };
        assert!(
            matches!(failed, Err(ApiError::BadRequest(_))),
            "the losing check-in should return a controlled state error, got: {failed:?}"
        );
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 1);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            1
        );

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }

    #[tokio::test]
    async fn postgres_checkin_rolls_back_when_late_audit_insert_fails() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_003;
        let booking_id = 940_103;
        let guest_id = 940_203;
        let room_id = 940_303;
        let room_type_id = 940_403;
        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
        seed_pg_booking(
            &pool,
            BookingFixture {
                actor_id,
                booking_id,
                guest_id,
                room_id,
                room_type_id,
                status: "confirmed",
                is_complimentary: false,
            },
        )
        .await;
        sqlx::query("UPDATE guests SET ic_number = $1 WHERE id = $2")
            .bind(format!("PG-IC-{guest_id}"))
            .bind(guest_id)
            .execute(&pool)
            .await
            .unwrap();
        install_checkin_audit_failure_trigger(&pool, booking_id).await;

        let checkin: hotel_app_be::models::CheckInRequest =
            serde_json::from_value(serde_json::json!({
                "payment_record": {"amount": 75.0, "payment_method": "cash", "payment_type": "booking"}
            }))
            .unwrap();
        let result = bookings::manual_checkin(&pool, actor_id, booking_id, Some(checkin)).await;
        drop_checkin_audit_failure_trigger(&pool, booking_id).await;

        assert!(
            matches!(result, Err(ApiError::Database(_))),
            "expected forced audit failure, got: {result:?}"
        );

        let row = sqlx::query(
            "SELECT status, actual_check_in IS NULL AS no_actual FROM bookings WHERE id = $1",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        // The whole check-in unwinds: status, timestamp, room, payment, and the
        // history/modification writes all roll back together.
        assert_eq!(row.get::<String, _>("status"), "confirmed");
        assert!(row.get::<bool, _>("no_actual"));
        assert_eq!(room_status, "reserved");
        assert_eq!(count_pg_rows(&pool, "payments", booking_id).await, 0);
        assert_eq!(count_pg_rows(&pool, "booking_history", booking_id).await, 0);
        assert_eq!(
            count_pg_rows(&pool, "booking_modifications", booking_id).await,
            0
        );

        cleanup_pg_fixture(
            &pool,
            actor_id,
            room_type_id,
            &[room_id],
            &[guest_id],
            &[booking_id],
        )
        .await;
    }
}

mod postgres_reactivation_tests {
    use axum::extract::{Extension, Path, State};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::services::bookings;
    use sqlx::postgres::PgPoolOptions;
    use sqlx::{PgPool, Row};

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("skipping PostgreSQL booking workflow test; DATABASE_URL is not set");
                return None;
            }
        };

        // Serialize against the other PostgreSQL workflow tests (shared DB + DDL).
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("connect to PostgreSQL test database");
        Some((pool, guard))
    }

    async fn cleanup_pg_fixture(
        pool: &PgPool,
        actor_id: i64,
        role_name: &str,
        room_type_id: i64,
        room_id: i64,
        guest_id: i64,
        booking_id: i64,
    ) {
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM booking_modifications WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM booking_history WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await
            .ok();
        // The room-status sync trigger logs to room_status_change_log (FK on
        // room_id, no cascade) during reactivation; without this delete the
        // rooms/room_types deletes below are FK-blocked and reruns collide.
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .ok();
        sqlx::query(
            "DELETE FROM user_roles WHERE user_id = $1 OR role_id IN (SELECT id FROM roles WHERE name = $2)",
        )
        .bind(actor_id)
        .bind(role_name)
        .execute(pool)
        .await
        .ok();
        sqlx::query(
            "DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name = $1)",
        )
        .bind(role_name)
        .execute(pool)
        .await
        .ok();
        sqlx::query("DELETE FROM roles WHERE name = $1")
            .bind(role_name)
            .execute(pool)
            .await
            .ok();
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(actor_id)
            .execute(pool)
            .await
            .ok();
    }

    async fn seed_pg_reactivation_fixture(
        pool: &PgPool,
        actor_id: i64,
        role_name: &str,
        room_type_id: i64,
        room_id: i64,
        guest_id: i64,
        booking_id: i64,
    ) {
        // Every fixed-id insert below is an upsert that RESETS the row to its
        // pre-test state, so a rerun against the same database starts from a
        // 'voided' booking even when cleanup was FK-blocked by leftover rows.
        sqlx::query(
            "INSERT INTO users (id, username, email, full_name, is_active, is_verified) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'Reactivation Actor', true, true) \
             ON CONFLICT (id) DO UPDATE SET \
                 username = EXCLUDED.username, \
                 email = EXCLUDED.email, \
                 is_active = true, \
                 is_verified = true",
        )
        .bind(actor_id)
        .bind(format!("reactivation_actor_{actor_id}"))
        .bind(format!("reactivation_actor_{actor_id}@example.com"))
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO permissions (name, resource, action, description, is_system_permission) \
             VALUES ('bookings:update', 'bookings', 'update', 'Update bookings', true) \
             ON CONFLICT (name) DO NOTHING",
        )
        .execute(pool)
        .await
        .unwrap();

        // DO UPDATE (not DO NOTHING) so RETURNING still yields the id when the
        // role survived a previous run.
        let role_id: i64 = sqlx::query_scalar(
            "INSERT INTO roles (name, display_name, is_system_role) \
             VALUES ($1, 'Reactivation Test Role', false) \
             ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name \
             RETURNING id",
        )
        .bind(role_name)
        .fetch_one(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO role_permissions (role_id, permission_id) \
             SELECT $1, id FROM permissions WHERE name = 'bookings:update' \
             ON CONFLICT DO NOTHING",
        )
        .bind(role_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) \
             ON CONFLICT DO NOTHING",
        )
        .bind(actor_id)
        .bind(role_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO guests (id, full_name) OVERRIDING SYSTEM VALUE VALUES ($1, 'Reactivation Guest') \
             ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name",
        )
        .bind(guest_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 100.00) \
             ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, base_price = EXCLUDED.base_price",
        )
        .bind(room_type_id)
        .bind(format!("RCT{room_type_id}"))
        .bind(format!("Reactivation Room Type {room_type_id}"))
        .execute(pool)
        .await
        .unwrap();
        // Room reset to 'available' must run before the booking upsert below:
        // re-voiding the booking only leaves the room untouched when the room
        // is not still 'reserved' from a previous run.
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, room_type_id = EXCLUDED.room_type_id, status = EXCLUDED.status",
        )
        .bind(room_id)
        .bind(format!("RCT-{room_id}"))
        .bind(room_type_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO bookings (
                id, booking_number, guest_id, room_id, check_in_date, check_out_date,
                room_rate, subtotal, total_amount, status, payment_status
             )
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, CURRENT_DATE + 30, CURRENT_DATE + 32, 100.00, 200.00, 200.00, 'voided', 'void')
             ON CONFLICT (id) DO UPDATE SET
                 booking_number = EXCLUDED.booking_number,
                 guest_id = EXCLUDED.guest_id,
                 room_id = EXCLUDED.room_id,
                 check_in_date = EXCLUDED.check_in_date,
                 check_out_date = EXCLUDED.check_out_date,
                 room_rate = EXCLUDED.room_rate,
                 subtotal = EXCLUDED.subtotal,
                 total_amount = EXCLUDED.total_amount,
                 status = EXCLUDED.status,
                 payment_status = EXCLUDED.payment_status",
        )
        .bind(booking_id)
        .bind(format!("BK-RCT-{booking_id}"))
        .bind(guest_id)
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn postgres_concurrent_reactivation_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 940_001;
        let role_name = "reactivation_test_role_940001";
        let room_type_id = 940_101;
        let room_id = 940_201;
        let guest_id = 940_301;
        let booking_id = 940_401;

        cleanup_pg_fixture(
            &pool,
            actor_id,
            role_name,
            room_type_id,
            room_id,
            guest_id,
            booking_id,
        )
        .await;
        seed_pg_reactivation_fixture(
            &pool,
            actor_id,
            role_name,
            room_type_id,
            room_id,
            guest_id,
            booking_id,
        )
        .await;

        let first = bookings::reactivate_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
        );
        let second = bookings::reactivate_booking_handler(
            State(pool.clone()),
            Extension(actor_id),
            Path(booking_id),
        );
        let (first_result, second_result) = tokio::join!(first, second);

        let successes = [first_result.as_ref(), second_result.as_ref()]
            .iter()
            .filter(|result| result.is_ok())
            .count();
        assert_eq!(
            successes, 1,
            "exactly one concurrent reactivation should succeed"
        );

        let failures = [first_result, second_result]
            .into_iter()
            .filter_map(Result::err)
            .collect::<Vec<_>>();
        assert_eq!(failures.len(), 1);
        assert!(
            matches!(failures[0], ApiError::BadRequest(_)),
            "repeated reactivation should return a controlled bad request: {:?}",
            failures[0]
        );

        let booking = sqlx::query("SELECT status FROM bookings WHERE id = $1")
            .bind(booking_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(booking.get::<String, _>("status"), "confirmed");

        let room_status: String = sqlx::query_scalar("SELECT status FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(room_status, "reserved");

        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_history WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let modification_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM booking_modifications WHERE booking_id = $1")
                .bind(booking_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1 AND action = 'booking_reactivated'",
        )
        .bind(booking_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(history_count, 1);
        assert_eq!(modification_count, 1);
        assert_eq!(audit_count, 1);

        cleanup_pg_fixture(
            &pool,
            actor_id,
            role_name,
            room_type_id,
            room_id,
            guest_id,
            booking_id,
        )
        .await;
    }
}

mod postgres_creation_tests {
    use axum::Json;
    use axum::extract::{Extension, State};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::models::BookingInput;
    use hotel_app_be::repositories::bookings::create_booking_handler;
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => return None,
        };
        if database_url.is_empty() {
            return None;
        }
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some((pool, guard))
    }

    async fn cleanup(pool: &PgPool, room_id: i64, guest_id: i64, actor_id: i64) {
        sqlx::query("DELETE FROM booking_modifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM booking_history WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query(
            "DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id IN (SELECT id FROM bookings WHERE room_id = $1)").bind(room_id).execute(pool).await.unwrap();
        sqlx::query("DELETE FROM bookings WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
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

    async fn seed_data(pool: &PgPool, room_id: i64, guest_id: i64, actor_id: i64) {
        sqlx::query("INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) ON CONFLICT DO NOTHING")
            .bind(actor_id).bind(format!("pg_creation_actor_{actor_id}")).bind(format!("pg-create-{actor_id}@hotel.local")).bind(format!("Actor {actor_id}")).execute(pool).await.unwrap();

        sqlx::query("INSERT INTO guests (id, first_name, last_name, full_name) OVERRIDING SYSTEM VALUE VALUES ($1, 'Create', 'Guest', 'Create Guest') ON CONFLICT DO NOTHING")
            .bind(guest_id).execute(pool).await.unwrap();

        sqlx::query("INSERT INTO room_types (id, name, code, base_price) OVERRIDING SYSTEM VALUE VALUES (1, 'Base', 'BASE', 100.0) ON CONFLICT DO NOTHING")
            .execute(pool).await.unwrap();

        sqlx::query("INSERT INTO rooms (id, room_number, room_type_id, status, is_active) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 1, 'available', true) ON CONFLICT DO NOTHING")
            .bind(room_id).bind(format!("R{room_id}")).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn postgres_concurrent_creation_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 960_001;
        let guest_id = 960_201;
        let room_id = 960_301;

        cleanup(&pool, room_id, guest_id, actor_id).await;
        seed_data(&pool, room_id, guest_id, actor_id).await;

        let input = BookingInput {
            guest_id,
            room_id,
            check_in_date: "2027-03-01".to_string(),
            check_out_date: "2027-03-05".to_string(),
            post_type: None,
            rate_code: None,
            booking_remarks: None,
            is_tourist: None,
            tourism_tax_amount: None,
            extra_bed_count: None,
            extra_bed_charge: None,
            late_checkout_penalty: None,
            payment_method: None,
            payment_status: None,
            amount_paid: None,
            source: None,
            booking_channel_id: None,
            ota_reference: None,
            booking_number: None,
            deposit_paid: None,
            deposit_amount: None,
            room_rate_override: None,
            special_requests: None,
            daily_rates: None,
            cleaning_preference: None,
            company_id: None,
            company_name: None,
        };

        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let input_a = Json(
            serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap(),
        );
        let input_b = Json(
            serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap(),
        );

        let (first, second) = tokio::join!(
            create_booking_handler(State(pool_a), Extension(actor_id), input_a),
            create_booking_handler(State(pool_b), Extension(actor_id), input_b)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            success_count, 1,
            "exactly one concurrent creation should succeed: first={first:?}, second={second:?}"
        );

        cleanup(&pool, room_id, guest_id, actor_id).await;
    }

    #[tokio::test]
    async fn postgres_creation_is_idempotent_with_booking_number() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let actor_id = 960_002;
        let guest_id = 960_202;
        let room_id = 960_302;

        cleanup(&pool, room_id, guest_id, actor_id).await;
        seed_data(&pool, room_id, guest_id, actor_id).await;

        let booking_number = "BK-IDEMPOTENT-TEST-960".to_string();
        sqlx::query("DELETE FROM bookings WHERE booking_number = $1")
            .bind(&booking_number)
            .execute(&pool)
            .await
            .unwrap();

        let input = BookingInput {
            guest_id,
            room_id,
            check_in_date: "2027-04-01".to_string(),
            check_out_date: "2027-04-05".to_string(),
            post_type: None,
            rate_code: None,
            booking_remarks: None,
            is_tourist: None,
            tourism_tax_amount: None,
            extra_bed_count: None,
            extra_bed_charge: None,
            late_checkout_penalty: None,
            payment_method: None,
            payment_status: None,
            amount_paid: None,
            source: None,
            booking_channel_id: None,
            ota_reference: None,
            booking_number: Some(booking_number.clone()),
            deposit_paid: None,
            deposit_amount: None,
            room_rate_override: None,
            special_requests: None,
            daily_rates: None,
            cleaning_preference: None,
            company_id: None,
            company_name: None,
        };

        let input_a = Json(
            serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap(),
        );
        let input_b = Json(
            serde_json::from_str::<BookingInput>(&serde_json::to_string(&input).unwrap()).unwrap(),
        );

        let first = create_booking_handler(State(pool.clone()), Extension(actor_id), input_a).await;
        assert!(first.is_ok(), "first creation should succeed");

        let second =
            create_booking_handler(State(pool.clone()), Extension(actor_id), input_b).await;
        assert!(
            matches!(
                second,
                Err(ApiError::Database(_)) | Err(ApiError::BadRequest(_))
            ),
            "second creation with same booking number should be rejected (unique booking number or room overlap): {:?}",
            second
        );

        cleanup(&pool, room_id, guest_id, actor_id).await;
    }
}

// ---------------------------------------------------------------------------
// Guest-portal concurrent booking race — proves two guests cannot double-book
// the same room for overlapping dates through the online-booking creation
// path (docs/ongoing-dev.md P2 gap).
// ---------------------------------------------------------------------------

mod postgres_guest_portal_race_tests {
    use chrono::{Duration, NaiveDate};
    use hotel_app_be::core::error::ApiError;
    use hotel_app_be::modules::guest_booking::availability::AvailabilityHub;
    use hotel_app_be::modules::guest_booking::models::{
        BookingQuoteRequest, CreateGuestBookingRequest,
    };
    use hotel_app_be::modules::guest_booking::service;
    use sqlx::PgPool;
    use sqlx::postgres::PgPoolOptions;

    async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => return None,
        };
        if database_url.is_empty() {
            return None;
        }
        // Shares the process-wide serialization lock with the other
        // `postgres_*` mods in this file: our AuditLog::log_event_tx insert
        // into `audit_logs` would otherwise deadlock against those mods'
        // install/drop of `audit_logs` failure triggers if the two ran
        // concurrently within this test binary.
        let guard = super::pg_serial_lock().lock_owned().await;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");
        Some((pool, guard))
    }

    async fn cleanup(pool: &PgPool, room_type_id: i64, room_id: i64, guest_ids: &[i64]) {
        sqlx::query("DELETE FROM email_deliveries WHERE guest_id = ANY($1)")
            .bind(guest_ids)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "DELETE FROM booking_modifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "DELETE FROM booking_history WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id IN (SELECT id FROM bookings WHERE room_id = $1)",
        )
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM bookings WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM guests WHERE id = ANY($1)")
            .bind(guest_ids)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM room_types WHERE id = $1")
            .bind(room_type_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed(pool: &PgPool, room_type_id: i64, room_id: i64, guest_ids: &[i64]) {
        sqlx::query(
            "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 200.00, 2) \
             ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, \
                 base_price = EXCLUDED.base_price, max_occupancy = EXCLUDED.max_occupancy, is_active = true",
        )
        .bind(room_type_id)
        .bind(format!("GPRT{room_type_id}"))
        .bind(format!("Guest Portal Race Room Type {room_type_id}"))
        .execute(pool)
        .await
        .unwrap();
        // Exactly one physical room of this type — the two concurrent portal
        // bookings below are contesting the SAME single room.
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status, is_active) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available', true) \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, \
                 room_type_id = EXCLUDED.room_type_id, status = 'available', is_active = true",
        )
        .bind(room_id)
        .bind(format!("GPR{room_id}"))
        .bind(room_type_id)
        .execute(pool)
        .await
        .unwrap();
        for guest_id in guest_ids {
            sqlx::query(
                "INSERT INTO guests (id, first_name, last_name, full_name, email, phone) \
                 OVERRIDING SYSTEM VALUE VALUES ($1, 'Portal', 'Guest', $2, $3, $4) \
                 ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, \
                     email = EXCLUDED.email, phone = EXCLUDED.phone",
            )
            .bind(guest_id)
            .bind(format!("Portal Guest {guest_id}"))
            .bind(format!("portal-race-{guest_id}@hotel.test"))
            .bind(format!("+1555010{guest_id}"))
            .execute(pool)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn postgres_concurrent_portal_booking_allows_only_one_success() {
        let Some((pool, _serial_guard)) = setup_pg_pool().await else {
            return;
        };
        let room_type_id = 975_401;
        let room_id = 975_301;
        let guest_a = 975_201;
        let guest_b = 975_202;
        let guest_ids = [guest_a, guest_b];

        cleanup(&pool, room_type_id, room_id, &guest_ids).await;
        seed(&pool, room_type_id, room_id, &guest_ids).await;

        let today: NaiveDate = sqlx::query_scalar("SELECT CURRENT_DATE")
            .fetch_one(&pool)
            .await
            .unwrap();
        let check_in = today + Duration::days(10);
        let check_out = check_in + Duration::days(2);
        let check_in_date = check_in.format("%Y-%m-%d").to_string();
        let check_out_date = check_out.format("%Y-%m-%d").to_string();

        // Compute the canonical quote once so both concurrent requests carry
        // a matching `expected_total` (the same value each call independently
        // recomputes internally from static room-type pricing).
        let quote = service::quote(
            &pool,
            guest_a,
            BookingQuoteRequest {
                room_type_id,
                check_in_date: check_in_date.clone(),
                check_out_date: check_out_date.clone(),
                adults: Some(1),
                children: Some(0),
                voucher_id: None,
                complimentary_dates: None,
            },
        )
        .await
        .expect("quote should succeed with one available room");

        let build_request = |client_request_id: &str| CreateGuestBookingRequest {
            client_request_id: client_request_id.to_string(),
            room_type_id,
            check_in_date: check_in_date.clone(),
            check_out_date: check_out_date.clone(),
            adults: Some(1),
            children: Some(0),
            voucher_id: None,
            complimentary_dates: None,
            expected_total: quote.total_amount,
            special_requests: None,
            cleaning_preference: None,
        };

        let hub = AvailabilityHub::default();
        let pool_a = pool.clone();
        let pool_b = pool.clone();
        let (first, second) = tokio::join!(
            service::create(&pool_a, &hub, guest_a, build_request("race-a"), None, None),
            service::create(&pool_b, &hub, guest_b, build_request("race-b"), None, None)
        );

        let success_count = usize::from(first.is_ok()) + usize::from(second.is_ok());
        assert_eq!(
            success_count, 1,
            "exactly one concurrent guest-portal booking for the same room should succeed: first={first:?}, second={second:?}"
        );
        let failed = if first.is_ok() { &second } else { &first };
        assert!(
            matches!(failed, Err(ApiError::Conflict(_))),
            "the losing concurrent booking should return a conflict-class error, got: {failed:?}"
        );

        let booking_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bookings WHERE room_id = $1")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            booking_count, 1,
            "exactly one booking row should exist for the contested room"
        );

        cleanup(&pool, room_type_id, room_id, &guest_ids).await;
    }
}
