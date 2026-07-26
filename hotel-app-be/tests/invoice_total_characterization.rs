//! Characterization tests pinning the agreement between the booking total,
//! the invoice total, and the checkout balance guard — the single
//! highest-value money assertion in this codebase.
//!
//! `tests/invoice_numbering.rs`'s `seed_booking` makes
//! `bookings.total_amount == base_price * nights` BY CONSTRUCTION, so no
//! existing test can ever see the three calculators below disagree. The
//! fixture here (`seed_disagreeing_booking`) deliberately makes them
//! disagree: `room_rate` differs from `room_types.base_price`, and the
//! booking carries a non-zero `discount_amount`, `tourism_tax_amount`
//! (via a foreign guest — see `enforce_booking_tourism_tax` in the PG
//! baseline) and `extra_bed_charge`.
//!
//! The decided-correct amount (see `.claude/rules/lessons.md` and
//! `docs/ongoing-dev.md` item "Unify the three disagreeing invoice/payment
//! total calculators") is `billable_total() = total_amount +
//! tourism_tax_amount + extra_bed_charge` (`models/payment.rs:285-287`).
//! Today, three call sites disagree with it and with each other:
//!   - `services::payments::calculate_payment_summary` (services/payments.rs:103)
//!     recomputes `base_price * nights` from `room_types`, ignoring the
//!     booking's own `total_amount`/`discount_amount`/`tourism_tax_amount`/
//!     `extra_bed_charge` entirely.
//!   - `PaymentRepository::create_generated_invoice` (repositories/payment.rs:888)
//!     does the same `base_price * nights` recomputation.
//!   - `PaymentRepository::insert_checkout_invoice` (repositories/payment.rs:1287,
//!     reached via `services::payments::ensure_invoice_for_booking`) copies
//!     `bookings.total_amount` verbatim into both `subtotal` and
//!     `total_amount`, never adding `tourism_tax_amount`/`extra_bed_charge`.
//!   - `ensure_checkout_balance_resolved` (repositories/bookings/lifecycle.rs:739,
//!     private — exercised here indirectly through the public
//!     `services::bookings::update_booking_handler`) compares collected
//!     payments against `bookings.total_amount` only, so a booking whose
//!     room charge is fully paid can check out with tourism tax / extra bed
//!     charges still outstanding.
//!   - `create_generated_invoice` also marks `paid_amount = total_amount`
//!     and `status = 'paid'` off a bare `EXISTS(any completed payment)`,
//!     so a deposit-only booking is reported as fully settled
//!     (repositories/payment.rs:935-975).
//!
//! Every assertion of a WRONG (buggy) value is forbidden here. Where the
//! decided-correct value differs from what the code returns today, the test
//! asserts the CORRECT value and is `#[ignore]`d so it starts failing
//! (visibly, in `cargo test -- --ignored`) rather than silently, and flips
//! to passing the moment the fix lands. The only genuinely correct-today
//! behavior asserted as a real, non-ignored regression guard is that
//! `generate_invoice` writes an `audit_logs` row for the invoice it creates
//! (`services::payments::generate_invoice`'s `AuditLog::log_event` call) —
//! deliberately NOT the stay-detail-decode/idempotency properties, because
//! `tests/invoice_numbering.rs`'s
//! `generate_invoice_returns_enriched_invoice_and_is_idempotent` already
//! asserts those on the same functions against a simpler fixture; keeping a
//! second copy of the same assertions here added zero net coverage to CI
//! (adversarial review finding 3, 2026-07-27).
//!
//! Requires `DATABASE_URL` (PostgreSQL); tests skip gracefully without it,
//! the same convention as `tests/invoice_numbering.rs` / `tests/ledger_service.rs`.
//!
//! Fixture ids are in the 940_300-940_399 range. Freedom is NOT established
//! by grepping this file alone — a prior version of this comment claimed
//! exclusivity on exactly that basis and was wrong: `rooms.id = 940_302`
//! collided with `tests/booking_service.rs:946`
//! (`postgres_concurrent_checkin_allows_only_one_success`, not `#[ignore]`d),
//! because each file's cleanup deletes the other's room (plus its
//! `room_status_change_log` rows, FK'd to `room_id` with no cascade) and
//! this file's seed repoints that room to a different `room_type_id` and
//! forces `status = 'available'`. Latent under a plain sequential
//! `cargo test --test <bin>` run; real under `cargo nextest` or two
//! concurrent `cargo test --test` invocations, both of which happen in this
//! tree (review finding 6, 2026-07-27). The real basis for "this id is
//! free" is `grep -rno "940_3[0-9][0-9]" tests/` over the WHOLE `tests/`
//! directory, checked per table (`rooms`, `room_types`, `guests`,
//! `bookings`, `users`, `payments` each have their own id space — a hit in a
//! different table is not a collision), re-run at edit time rather than
//! trusted from a stale comment. `room_id` for the first fixture block was
//! moved to `940_305`, verified free for the `rooms` table across all of
//! `tests/` as of 2026-07-27; every other id in this file was re-checked the
//! same way and is unchanged.

use axum::Json;
use axum::extract::{Extension, Path, State};
use chrono::NaiveDate;
use hotel_app_be::models::BookingUpdateInput;
use hotel_app_be::repositories::payment::PaymentRepository;
use hotel_app_be::services::{bookings, payments};
use rust_decimal::Decimal;
use sqlx::{PgPool, postgres::PgPoolOptions};

// Tests in this file seed fully isolated fixtures (disjoint id ranges), but
// each opens its own small connection pool; serializing them keeps this
// file's footprint on the shared, persistent dev database predictable when
// run alongside the rest of the suite — same pattern as
// tests/invoice_numbering.rs / tests/ledger_service.rs.
fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn setup_pg_pool() -> Option<(PgPool, tokio::sync::OwnedMutexGuard<()>)> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!(
                "Skipping PostgreSQL invoice-total-characterization test because DATABASE_URL is not set"
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

/// All-`None` `BookingUpdateInput`, so a test only spells out the field(s)
/// it actually changes via `..empty_booking_update()`. Mirrors the helper of
/// the same name in `tests/ledger_service.rs`.
fn empty_booking_update() -> BookingUpdateInput {
    BookingUpdateInput {
        room_id: None,
        check_in_date: None,
        check_out_date: None,
        actual_check_out: None,
        total_amount: None,
        status: None,
        payment_status: None,
        post_type: None,
        rate_code: None,
        is_tourist: None,
        tourism_tax_amount: None,
        extra_bed_count: None,
        extra_bed_charge: None,
        late_checkout_penalty: None,
        payment_method: None,
        market_code: None,
        discount_percentage: None,
        rate_override_weekday: None,
        rate_override_weekend: None,
        check_in_time: None,
        check_out_time: None,
        deposit_paid: None,
        deposit_amount: None,
        company_id: None,
        company_name: None,
        clear_company: None,
        payment_note: None,
        remarks: None,
        special_requests: None,
        source: None,
        booking_channel_id: None,
        ota_reference: None,
        room_rate_override: None,
        daily_rates: None,
        cleaning_preference: None,
    }
}

/// One test fn's exclusive slice of the 940_300-940_399 fixture block.
struct FixtureIds {
    actor_id: i64,
    room_type_id: i64,
    room_id: i64,
    guest_id: i64,
    booking_id: i64,
}

/// Stay/money facts read back from the persisted booking row after seeding
/// (never the values we sent in the INSERT — `tourism_tax_amount` is
/// overwritten by the `trg_enforce_booking_tourism_tax` trigger, so the only
/// trustworthy source is a fresh SELECT).
struct SeededBooking {
    booking_id: i64,
    total_amount: Decimal,
    tourism_tax_amount: Decimal,
    extra_bed_charge: Decimal,
}

impl SeededBooking {
    /// The decided-correct amount every calculator under test should quote.
    /// Re-derived LIVE via the same function production code calls
    /// (`PaymentRepository::workflow_summary_row` ->
    /// `PaymentWorkflowSummaryRow::billable_total`, models/payment.rs:285-287)
    /// rather than a hand-copied `total_amount + tourism_tax_amount +
    /// extra_bed_charge` formula — a private copy would silently keep
    /// asserting the OLD formula if the real definition ever changed
    /// (review finding 9, 2026-07-27). Must be called before
    /// `cleanup_fixture` deletes the booking row it reads.
    async fn billable_total(&self, pool: &PgPool) -> Decimal {
        PaymentRepository::workflow_summary_row(pool, self.booking_id)
            .await
            .expect("workflow_summary_row must succeed for the seeded booking")
            .expect("workflow_summary_row must find the seeded booking")
            .billable_total()
    }
}

async fn ensure_admin_actor(pool: &PgPool, actor_id: i64) {
    sqlx::query(
        "INSERT INTO users (id, username, email, full_name, user_type, is_active, is_verified) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'staff', true, true) \
         ON CONFLICT (id) DO UPDATE SET \
             username = EXCLUDED.username, email = EXCLUDED.email, full_name = EXCLUDED.full_name, \
             is_active = true, is_verified = true",
    )
    .bind(actor_id)
    .bind(format!("tot940_actor_{actor_id}"))
    .bind(format!("tot940-actor-{actor_id}@hotel.local"))
    .bind(format!("Total Test Actor {actor_id}"))
    .execute(pool)
    .await
    .unwrap();
}

/// Grants the shared, idempotently-created 'admin' role's `bookings:update`/
/// `bookings:manage` permissions to `actor_id` — required only by the test
/// that calls `services::bookings::update_booking_handler` directly (it
/// checks these permissions internally). Mirrors `ensure_test_actor` in
/// `tests/ledger_service.rs`.
async fn ensure_actor_can_update_bookings(pool: &PgPool, actor_id: i64) {
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
         ('bookings:manage', 'bookings', 'manage', 'Manage bookings', true) \
         ON CONFLICT (name) DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO role_permissions (role_id, permission_id) \
         SELECT r.id, p.id FROM roles r CROSS JOIN permissions p \
         WHERE r.name = 'admin' AND p.name IN ('bookings:update', 'bookings:manage') \
         ON CONFLICT DO NOTHING",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO user_roles (user_id, role_id) \
         SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING",
    )
    .bind(actor_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Seeds a booking whose `total_amount`, `discount_amount`,
/// `tourism_tax_amount`, and `extra_bed_charge` all deliberately DISAGREE
/// with a naive `room_types.base_price * nights` recomputation:
///   - `room_types.base_price` = 100.00, but `room_rate` = 150.00 (2 nights
///     -> subtotal 300.00).
///   - `discount_amount` = 30.00, so `total_amount` = 270.00 (not 300.00).
///   - the guest is `tourism_type = 'foreign'`, so
///     `trg_enforce_booking_tourism_tax` stamps a non-zero
///     `tourism_tax_amount`.
///   - `extra_bed_charge` = 40.00.
///
/// Upsert-reset (`ON CONFLICT DO UPDATE`) so reruns against the persistent
/// dev DB are deterministic.
async fn seed_disagreeing_booking(pool: &PgPool, ids: &FixtureIds) -> SeededBooking {
    ensure_admin_actor(pool, ids.actor_id).await;

    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price, max_occupancy, keycard_deposit_amount, service_charge_percentage) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 100.00, 2, 0, 0) \
         ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, \
             base_price = 100.00, keycard_deposit_amount = 0, service_charge_percentage = 0",
    )
    .bind(ids.room_type_id)
    .bind(format!("TOT{}", ids.room_type_id))
    .bind(format!("Total Test Room Type {}", ids.room_type_id))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO rooms (id, room_number, room_type_id, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
         ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number, \
             room_type_id = EXCLUDED.room_type_id, status = 'available'",
    )
    .bind(ids.room_id)
    .bind(format!("TOT{}", ids.room_id))
    .bind(ids.room_type_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO guests (id, full_name, first_name, last_name, email, tourism_type) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Total', $3, $4, 'foreign') \
         ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, tourism_type = 'foreign'",
    )
    .bind(ids.guest_id)
    .bind(format!("Total Test Guest {}", ids.guest_id))
    .bind(format!("Guest{}", ids.guest_id))
    .bind(format!("tot940-guest-{}@hotel.local", ids.guest_id))
    .execute(pool)
    .await
    .unwrap();

    let check_in = NaiveDate::from_ymd_opt(2031, 3, 10).unwrap();
    let check_out = NaiveDate::from_ymd_opt(2031, 3, 12).unwrap();
    let room_rate = Decimal::new(15_000, 2); // 150.00 — differs from base_price 100.00
    let subtotal = Decimal::new(30_000, 2); // 300.00 (150.00 * 2 nights)
    let discount_amount = Decimal::new(3_000, 2); // 30.00
    let total_amount = subtotal - discount_amount; // 270.00
    let extra_bed_charge = Decimal::new(4_000, 2); // 40.00

    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, discount_amount, total_amount,
            extra_bed_count, extra_bed_charge, status, payment_status, created_by
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 0,
                 $9, $10, $11, $12, 1, $13, 'confirmed', 'unpaid', $14)
         ON CONFLICT (id) DO UPDATE SET
             room_id = EXCLUDED.room_id,
             check_in_date = EXCLUDED.check_in_date,
             check_out_date = EXCLUDED.check_out_date,
             room_rate = EXCLUDED.room_rate,
             subtotal = EXCLUDED.subtotal,
             discount_amount = EXCLUDED.discount_amount,
             total_amount = EXCLUDED.total_amount,
             extra_bed_count = 1,
             extra_bed_charge = EXCLUDED.extra_bed_charge,
             status = 'confirmed',
             payment_status = 'unpaid',
             actual_check_out = NULL,
             created_by = EXCLUDED.created_by",
    )
    .bind(ids.booking_id)
    .bind(format!("BK-TOT-{}", ids.booking_id))
    .bind(ids.guest_id)
    .bind(format!("Total Test Guest {}", ids.guest_id))
    .bind(format!("tot940-guest-{}@hotel.local", ids.guest_id))
    .bind(ids.room_id)
    .bind(check_in)
    .bind(check_out)
    .bind(room_rate)
    .bind(subtotal)
    .bind(discount_amount)
    .bind(total_amount)
    .bind(extra_bed_charge)
    .bind(ids.actor_id)
    .execute(pool)
    .await
    .unwrap();

    let (persisted_total, tourism_tax_amount, persisted_extra_bed, persisted_discount): (
        Decimal,
        Decimal,
        Decimal,
        Decimal,
    ) = sqlx::query_as(
        "SELECT total_amount, tourism_tax_amount, extra_bed_charge, discount_amount \
         FROM bookings WHERE id = $1",
    )
    .bind(ids.booking_id)
    .fetch_one(pool)
    .await
    .unwrap();

    // Sanity-check the fixture itself disagrees with a naive base_price*nights
    // recomputation on every dimension the known bugs ignore — otherwise a
    // silent trigger/default change could make this file pass for the wrong
    // reason (all deltas coincidentally zero).
    assert_ne!(
        room_rate,
        Decimal::new(10_000, 2),
        "fixture room_rate must differ from room_types.base_price (100.00)"
    );
    assert!(
        persisted_discount > Decimal::ZERO,
        "fixture discount_amount must be non-zero"
    );
    assert!(
        tourism_tax_amount > Decimal::ZERO,
        "fixture guest must be foreign so trg_enforce_booking_tourism_tax stamps a non-zero tourism_tax_amount for booking {}",
        ids.booking_id
    );
    assert!(
        persisted_extra_bed > Decimal::ZERO,
        "fixture extra_bed_charge must be non-zero"
    );

    SeededBooking {
        booking_id: ids.booking_id,
        total_amount: persisted_total,
        tourism_tax_amount,
        extra_bed_charge: persisted_extra_bed,
    }
}

async fn insert_completed_payment(
    pool: &PgPool,
    payment_id: i64,
    booking_id: i64,
    amount: Decimal,
    payment_type: &str,
) {
    sqlx::query(
        "INSERT INTO payments (id, booking_id, amount, currency, payment_method, payment_type, status) \
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'MYR', 'cash', $4, 'completed') \
         ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, payment_type = EXCLUDED.payment_type, status = 'completed'",
    )
    .bind(payment_id)
    .bind(booking_id)
    .bind(amount)
    .bind(payment_type)
    .execute(pool)
    .await
    .unwrap();
}

/// Tears down every row a `seed_disagreeing_booking` fixture (plus any
/// payment inserted via `insert_completed_payment`) can have produced.
/// `invoices`/`payments`/`booking_history`/`booking_modifications` all
/// `ON DELETE CASCADE` from `bookings.id`, so deleting the booking is
/// sufficient for those; `room_status_change_log` does NOT cascade (FK on
/// `room_id`, no `ON DELETE` clause — see `.claude/rules/lessons.md`
/// 2026-07-26e) and must be cleared before the room.
async fn cleanup_fixture(pool: &PgPool, ids: &FixtureIds) {
    sqlx::query(
        "DELETE FROM audit_logs WHERE resource_type = 'invoice' \
         AND (details->>'booking_id')::bigint = $1",
    )
    .bind(ids.booking_id)
    .execute(pool)
    .await
    .ok();
    sqlx::query("DELETE FROM audit_logs WHERE resource_type = 'booking' AND resource_id = $1")
        .bind(ids.booking_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM payments WHERE booking_id = $1")
        .bind(ids.booking_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM bookings WHERE id = $1")
        .bind(ids.booking_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM guests WHERE id = $1")
        .bind(ids.guest_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM room_status_change_log WHERE room_id = $1")
        .bind(ids.room_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM rooms WHERE id = $1")
        .bind(ids.room_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(ids.room_type_id)
        .execute(pool)
        .await
        .ok();
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(ids.actor_id)
        .execute(pool)
        .await
        .ok();
}

/// `(action, resource_type, resource_id)` from an `audit_logs` row, or the
/// `sqlx::Error` from querying it, captured before cleanup can delete the
/// row — `None` when `generate_invoice` itself failed and no query was run.
type AuditLogQueryResult = Option<Result<(String, String, Option<i64>), sqlx::Error>>;

// ---------------------------------------------------------------------
// (1) Genuinely correct today: real regression guard, NOT ignored.
// ---------------------------------------------------------------------

/// `generate_invoice` writes an `audit_logs` row (`action =
/// 'invoice_generated'`, `resource_type = 'invoice'`) recording which
/// booking and invoice number it created
/// (`services::payments::generate_invoice`'s `AuditLog::log_event` call,
/// unconditional and unaffected by the total-calculator bugs documented in
/// the module doc comment above). This is genuinely NEW coverage — the
/// equivalent stay-detail-decode/idempotency assertions this test used to
/// duplicate already live in
/// `tests/invoice_numbering.rs::generate_invoice_returns_enriched_invoice_and_is_idempotent`,
/// which never inspects the audit trail (review finding 3, 2026-07-27).
#[tokio::test]
async fn generate_invoice_writes_an_audit_log_entry() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };

    let ids = FixtureIds {
        actor_id: 940_300,
        room_type_id: 940_301,
        room_id: 940_305,
        guest_id: 940_303,
        booking_id: 940_304,
    };

    cleanup_fixture(&pool, &ids).await;
    seed_disagreeing_booking(&pool, &ids).await;

    let invoice_result = payments::generate_invoice(&pool, ids.actor_id, ids.booking_id).await;
    let audit_row_result: AuditLogQueryResult = if invoice_result.is_ok() {
            Some(
                sqlx::query_as(
                    "SELECT action, resource_type, resource_id FROM audit_logs \
                     WHERE resource_type = 'invoice' AND (details->>'booking_id')::bigint = $1",
                )
                .bind(ids.booking_id)
                .fetch_one(&pool)
                .await,
            )
        } else {
            None
        };

    cleanup_fixture(&pool, &ids).await;

    let invoice = invoice_result.expect("generate_invoice must succeed for a live booking fixture");
    let (action, resource_type, resource_id) = audit_row_result
        .expect("generate_invoice succeeded but the audit row was never queried")
        .expect("generate_invoice must write an audit_logs row for the new invoice");

    assert_eq!(action, "invoice_generated");
    assert_eq!(resource_type, "invoice");
    assert_eq!(
        resource_id,
        Some(invoice.id),
        "the audit row's resource_id must be the generated invoice's id"
    );
}

// ---------------------------------------------------------------------
// (2)-(6) Known-buggy today: assert the DECIDED-CORRECT value, #[ignore]d.
//
// Every one of these cleans up the fixture BEFORE the assertion/`.expect()`
// that is expected to panic (that is the whole point of `#[ignore]`ing a
// known bug) — an assertion panic must never skip teardown and leak fixture
// rows on the persistent, shared dev database when run with `--ignored`
// (review finding 8, 2026-07-27; pattern matches
// tests/payment_characterization.rs).
// ---------------------------------------------------------------------

/// `calculate_payment_summary` must quote the same billable total as the
/// booking. Today it recomputes `base_price * nights` from `room_types` and
/// never looks at `bookings.total_amount`/`discount_amount`/
/// `tourism_tax_amount`/`extra_bed_charge` at all.
#[tokio::test]
#[ignore = "calculate_payment_summary computes base_price*nights from room_types and ignores bookings.total_amount/discount_amount/tourism_tax_amount/extra_bed_charge — pending fix: unify invoice total calculators"]
async fn calculate_payment_summary_should_equal_billable_total() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };

    let ids = FixtureIds {
        actor_id: 940_310,
        room_type_id: 940_311,
        room_id: 940_312,
        guest_id: 940_313,
        booking_id: 940_314,
    };

    cleanup_fixture(&pool, &ids).await;
    let seeded = seed_disagreeing_booking(&pool, &ids).await;

    let summary_result = payments::calculate_payment_summary(&pool, ids.booking_id).await;
    let expected_billable_total = seeded.billable_total(&pool).await;

    cleanup_fixture(&pool, &ids).await;

    let summary = summary_result.expect("calculate_payment_summary must succeed");
    assert_eq!(
        summary.total_amount,
        expected_billable_total,
        "calculate_payment_summary must quote the booking's billable_total \
         (total_amount + tourism_tax_amount + extra_bed_charge), not base_price * nights"
    );
}

/// `generate_invoice`'s `Invoice.total_amount` must equal the booking's
/// billable_total. Today `create_generated_invoice` recomputes
/// `base_price * nights` the same way `calculate_payment_summary` does.
#[tokio::test]
#[ignore = "create_generated_invoice computes base_price*nights with tax 0, ignoring bookings.total_amount/discount_amount/tourism_tax_amount/extra_bed_charge — pending fix: unify invoice total calculators"]
async fn generate_invoice_total_should_equal_billable_total() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };

    let ids = FixtureIds {
        actor_id: 940_320,
        room_type_id: 940_321,
        room_id: 940_322,
        guest_id: 940_323,
        booking_id: 940_324,
    };

    cleanup_fixture(&pool, &ids).await;
    let seeded = seed_disagreeing_booking(&pool, &ids).await;

    let invoice_result = payments::generate_invoice(&pool, ids.actor_id, ids.booking_id).await;
    let expected_billable_total = seeded.billable_total(&pool).await;

    cleanup_fixture(&pool, &ids).await;

    let invoice = invoice_result.expect("generate_invoice must succeed");
    assert_eq!(
        invoice.total_amount,
        expected_billable_total,
        "generate_invoice's total_amount must equal the booking's billable_total \
         (total_amount + tourism_tax_amount + extra_bed_charge)"
    );
}

/// The checkout invoice inserted via `services::payments::ensure_invoice_for_booking`
/// (-> `PaymentRepository::insert_checkout_invoice`) must also quote
/// billable_total. Today it copies `bookings.total_amount` verbatim into
/// both `subtotal` and `total_amount`, never adding `tourism_tax_amount`/
/// `extra_bed_charge`.
#[tokio::test]
#[ignore = "insert_checkout_invoice copies bookings.total_amount verbatim into subtotal/total_amount, never adding tourism_tax_amount/extra_bed_charge — pending fix: unify invoice total calculators"]
async fn checkout_invoice_total_should_equal_billable_total() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };

    let ids = FixtureIds {
        actor_id: 940_330,
        room_type_id: 940_331,
        room_id: 940_332,
        guest_id: 940_333,
        booking_id: 940_334,
    };

    cleanup_fixture(&pool, &ids).await;
    let seeded = seed_disagreeing_booking(&pool, &ids).await;

    let invoice_number_result =
        payments::ensure_invoice_for_booking(&pool, ids.booking_id, ids.actor_id).await;
    let total_amount_result: Option<Result<Decimal, sqlx::Error>> =
        if let Ok(invoice_number) = &invoice_number_result {
            Some(
                sqlx::query_scalar("SELECT total_amount FROM invoices WHERE invoice_number = $1")
                    .bind(invoice_number)
                    .fetch_one(&pool)
                    .await,
            )
        } else {
            None
        };
    let expected_billable_total = seeded.billable_total(&pool).await;

    cleanup_fixture(&pool, &ids).await;

    let _invoice_number =
        invoice_number_result.expect("ensure_invoice_for_booking must succeed");
    let total_amount = total_amount_result
        .expect("ensure_invoice_for_booking succeeded but the invoice row was never queried")
        .expect("checkout invoice row must exist");

    assert_eq!(
        total_amount,
        expected_billable_total,
        "the checkout invoice's total_amount must equal the booking's billable_total \
         (total_amount + tourism_tax_amount + extra_bed_charge)"
    );
}

/// The checkout guard (`ensure_checkout_balance_resolved`, private —
/// exercised here via the public `update_booking_handler`) must require the
/// full billable_total to be collected before allowing checkout, not just
/// the room-only `total_amount`. Today it compares payments against
/// `total_amount` alone, so a booking whose room charge is fully paid can
/// check out with tourism tax and extra bed charges still outstanding.
///
/// The failure must be the balance guard specifically, not some other
/// `update_booking_handler` failure mode (permission check, room
/// availability, transaction error) that would also make this test "pass"
/// for the wrong reason — so this asserts the guard's actual message
/// (`repositories/bookings/lifecycle.rs::ensure_checkout_balance_resolved`,
/// ~line 764-767: `"Collect full payment before checkout. Balance due: {}"`),
/// not merely `.is_err()` (review finding 10, 2026-07-27).
#[tokio::test]
#[ignore = "ensure_checkout_balance_resolved compares collected payments against bookings.total_amount only, ignoring tourism_tax_amount/extra_bed_charge — pending fix: unify invoice total calculators"]
async fn checkout_guard_should_require_full_billable_total_not_just_room_total_amount() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };

    let ids = FixtureIds {
        actor_id: 940_340,
        room_type_id: 940_341,
        room_id: 940_342,
        guest_id: 940_343,
        booking_id: 940_344,
    };
    let payment_id = 940_345;

    cleanup_fixture(&pool, &ids).await;
    let seeded = seed_disagreeing_booking(&pool, &ids).await;
    ensure_actor_can_update_bookings(&pool, ids.actor_id).await;

    // Pay exactly the room-only total_amount; tourism tax + extra bed remain
    // outstanding.
    insert_completed_payment(
        &pool,
        payment_id,
        ids.booking_id,
        seeded.total_amount,
        "booking",
    )
    .await;

    let result = bookings::update_booking_handler(
        State(pool.clone()),
        Extension(ids.actor_id),
        Path(ids.booking_id),
        Json(BookingUpdateInput {
            status: Some("checked_out".to_string()),
            ..empty_booking_update()
        }),
    )
    .await;

    // Capture the outcome as plain data (never panics) before cleanup runs.
    let outcome: Result<String, String> = match result {
        Ok(Json(booking)) => Ok(booking.status),
        Err(err) => Err(err.to_string()),
    };

    cleanup_fixture(&pool, &ids).await;

    match outcome {
        Err(message) => {
            assert!(
                message.contains("Collect full payment before checkout"),
                "checkout was refused, but not by the balance guard \
                 (ensure_checkout_balance_resolved's \"Collect full payment before \
                 checkout...\" message) — got a different error, which could mean \
                 update_booking_handler failed for an unrelated reason (permission, \
                 room availability, transaction failure): {message}"
            );
        }
        Ok(status) => panic!(
            "checkout must be refused while tourism tax ({}) and extra bed charge ({}) \
             remain unpaid on top of the paid total_amount ({}), but succeeded with status {status}",
            seeded.tourism_tax_amount, seeded.extra_bed_charge, seeded.total_amount
        ),
    }
}

/// A booking with only a deposit payment must not produce an invoice
/// claiming full settlement. Today `create_generated_invoice` sets
/// `paid_amount = total_amount` and `status = 'paid'` off a bare
/// `EXISTS(any completed payment)`, regardless of amount.
#[tokio::test]
#[ignore = "create_generated_invoice sets paid_amount = total_amount and status = 'paid' off EXISTS(any completed payment), so a deposit-only booking is reported as fully settled — pending fix: unify invoice total calculators"]
async fn deposit_only_payment_should_not_produce_a_fully_settled_invoice() {
    let Some((pool, _guard)) = setup_pg_pool().await else {
        return;
    };

    let ids = FixtureIds {
        actor_id: 940_350,
        room_type_id: 940_351,
        room_id: 940_352,
        guest_id: 940_353,
        booking_id: 940_354,
    };
    let payment_id = 940_355;

    cleanup_fixture(&pool, &ids).await;
    let seeded = seed_disagreeing_booking(&pool, &ids).await;

    // A small deposit only — far less than the booking's billable total.
    let deposit_amount = Decimal::new(5_000, 2); // 50.00
    insert_completed_payment(&pool, payment_id, ids.booking_id, deposit_amount, "deposit").await;

    let invoice_result = payments::generate_invoice(&pool, ids.actor_id, ids.booking_id).await;
    let expected_billable_total = seeded.billable_total(&pool).await;

    cleanup_fixture(&pool, &ids).await;

    let invoice =
        invoice_result.expect("generate_invoice should still succeed for a deposit-only booking");

    assert!(
        invoice.paid_amount < invoice.total_amount,
        "a deposit of {} against a billable total of {} must not be reported as fully paid \
         (invoice reported paid_amount = {}, total_amount = {})",
        deposit_amount,
        expected_billable_total,
        invoice.paid_amount,
        invoice.total_amount
    );
    assert_ne!(
        invoice.status, "paid",
        "a deposit-only booking's invoice must not be marked 'paid'"
    );
}
