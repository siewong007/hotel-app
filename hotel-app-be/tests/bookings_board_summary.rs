//! Bookings board summary and the `?view=` list filter.
//!
//! Two things have to stay true for the board to be trustworthy, and both need
//! a real database:
//!
//! 1. A card's number and the list that card opens describe the same rows. The
//!    predicates are generated from one function, but only an actual query
//!    proves the SQL agrees.
//! 2. `adults` / `children` come back on `BookingWithDetails`. They were absent
//!    from the select list for a long time while the type declared them, which
//!    made the board's "In-house guests" card silently report the room count.
//!    `sqlx` is untyped here, so nothing but a live fetch catches that.
//!
//! Skipped without `DATABASE_URL`. Note that libtest counts an early return as
//! a pass, so a green run without a database proves nothing — check the
//! per-test output.

use hotel_app_be::core::db::DbPool;
use hotel_app_be::models::{BookingPaginationParams, BookingWithDetails};
use hotel_app_be::modules::bookings::queries::GET_BOOKINGS_BASE_QUERY;
use hotel_app_be::modules::bookings::repository::BookingRepository;
use hotel_app_be::utils::pagination::Pagination;
use rust_decimal::Decimal;
use sqlx::Row;
use sqlx::postgres::PgPoolOptions;

// Fixture ids: the 905_xxx block is unused elsewhere in tests/.
const ROOM_TYPE_ID: i64 = 905_001;
const ROOM_ID_A: i64 = 905_101;
const ROOM_ID_B: i64 = 905_102;
const GUEST_ID_A: i64 = 905_201;
const GUEST_ID_B: i64 = 905_202;
/// In-house today, 2 adults + 1 child — the occupancy case the board got wrong.
const BOOKING_IN_HOUSE: i64 = 905_301;
/// Past checkout with an unpaid balance, no company — the `normal_balance` case.
const BOOKING_PAST_DUE: i64 = 905_302;

fn pg_serial_lock() -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCK: std::sync::OnceLock<std::sync::Arc<tokio::sync::Mutex<()>>> =
        std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

async fn setup_pool() -> Option<(DbPool, tokio::sync::OwnedMutexGuard<()>)> {
    let database_url = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => return None,
    };
    let guard = pg_serial_lock().lock_owned().await;
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await
        .expect("failed to connect to the PostgreSQL test database");
    Some((pool, guard))
}

/// Remove fixture rows. Payments first, then bookings, then their parents —
/// cascade is per-FK, not per-table.
async fn cleanup(pool: &DbPool) {
    for booking_id in [BOOKING_IN_HOUSE, BOOKING_PAST_DUE] {
        let _ = sqlx::query("DELETE FROM payments WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM customer_ledgers WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        // Status triggers write this behind the test's back.
        let _ = sqlx::query("DELETE FROM room_status_change_log WHERE booking_id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
        let _ = sqlx::query("DELETE FROM bookings WHERE id = $1")
            .bind(booking_id)
            .execute(pool)
            .await;
    }
    for guest_id in [GUEST_ID_A, GUEST_ID_B] {
        let _ = sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await;
    }
    for room_id in [ROOM_ID_A, ROOM_ID_B] {
        let _ = sqlx::query("DELETE FROM rooms WHERE id = $1")
            .bind(room_id)
            .execute(pool)
            .await;
    }
    let _ = sqlx::query("DELETE FROM room_types WHERE id = $1")
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await;
}

async fn seed(pool: &DbPool) {
    cleanup(pool).await;

    sqlx::query(
        "INSERT INTO room_types (id, code, name, base_price, max_occupancy) \
         OVERRIDING SYSTEM VALUE VALUES ($1, 'BSUM', 'Board Summary Type', 150.00, 4) \
         ON CONFLICT (id) DO UPDATE SET base_price = EXCLUDED.base_price",
    )
    .bind(ROOM_TYPE_ID)
    .execute(pool)
    .await
    .expect("seed room type");

    for (room_id, number) in [(ROOM_ID_A, "BSUM-A"), (ROOM_ID_B, "BSUM-B")] {
        sqlx::query(
            "INSERT INTO rooms (id, room_number, room_type_id, status) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'available') \
             ON CONFLICT (id) DO UPDATE SET room_number = EXCLUDED.room_number",
        )
        .bind(room_id)
        .bind(number)
        .bind(ROOM_TYPE_ID)
        .execute(pool)
        .await
        .expect("seed room");
    }

    for (guest_id, label) in [(GUEST_ID_A, "A"), (GUEST_ID_B, "B")] {
        sqlx::query(
            "INSERT INTO guests (id, nick_name, first_name, last_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Board', $3, $4) \
             ON CONFLICT (id) DO UPDATE SET nick_name = EXCLUDED.nick_name",
        )
        .bind(guest_id)
        .bind(format!("Board Summary Guest {label}"))
        .bind(format!("Summary{label}"))
        .bind(format!("board-summary-{guest_id}@hotel.local"))
        .execute(pool)
        .await
        .expect("seed guest");
    }

    // In house right now, 3 occupants, fully paid so it stays out of the due
    // buckets. Dates use CURRENT_DATE so the fixture tracks the hotel's
    // business day exactly as the summary does.
    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status, is_complimentary
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6,
            CURRENT_DATE - 1, CURRENT_DATE + 2, 2, 1,
            150.00, 450.00, 450.00, 'checked_in', 'paid', false)",
    )
    .bind(BOOKING_IN_HOUSE)
    .bind(format!("BK-BSUM-{BOOKING_IN_HOUSE}"))
    .bind(GUEST_ID_A)
    .bind("Board Summary Guest A")
    .bind(format!("board-summary-{GUEST_ID_A}@hotel.local"))
    .bind(ROOM_ID_A)
    .execute(pool)
    .await
    .expect("seed in-house booking");

    sqlx::query(
        "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status) \
         VALUES ($1, 450.00, 'Cash', 'booking', 'completed')",
    )
    .bind(BOOKING_IN_HOUSE)
    .execute(pool)
    .await
    .expect("seed settling payment");

    // Checked out last week owing 200.00, no company — `normal_balance`.
    sqlx::query(
        "INSERT INTO bookings (
            id, booking_number, guest_id, guest_name, guest_email, room_id,
            check_in_date, check_out_date, adults, children,
            room_rate, subtotal, total_amount, status, payment_status, is_complimentary
         )
         OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6,
            CURRENT_DATE - 9, CURRENT_DATE - 7, 1, 0,
            150.00, 300.00, 300.00, 'checked_out', 'partial', false)",
    )
    .bind(BOOKING_PAST_DUE)
    .bind(format!("BK-BSUM-{BOOKING_PAST_DUE}"))
    .bind(GUEST_ID_B)
    .bind("Board Summary Guest B")
    .bind(format!("board-summary-{GUEST_ID_B}@hotel.local"))
    .bind(ROOM_ID_B)
    .execute(pool)
    .await
    .expect("seed past-due booking");

    sqlx::query(
        "INSERT INTO payments (booking_id, amount, payment_method, payment_type, status) \
         VALUES ($1, 100.00, 'Cash', 'booking', 'completed')",
    )
    .bind(BOOKING_PAST_DUE)
    .execute(pool)
    .await
    .expect("seed partial payment");
}

/// Count the rows a board view returns, restricted to this test's fixtures so
/// whatever else lives in the database cannot affect the result.
async fn view_row_count(pool: &DbPool, view: &str) -> i64 {
    let params = BookingPaginationParams {
        view: Some(view.to_string()),
        page_size: Some(500),
        ..Default::default()
    };
    let pagination = Pagination {
        page: 1,
        page_size: 500,
        offset: 0,
    };
    let (_, rows) = BookingRepository::find_paginated_with_details(
        pool,
        &params,
        GET_BOOKINGS_BASE_QUERY,
        pagination,
    )
    .await
    .expect("board view query runs");

    rows.iter()
        .filter(|b| b.id == BOOKING_IN_HOUSE || b.id == BOOKING_PAST_DUE)
        .count() as i64
}

#[tokio::test]
async fn board_views_return_the_rows_their_cards_count() {
    let Some((pool, _guard)) = setup_pool().await else {
        eprintln!("Skipping board-summary test because DATABASE_URL is not set");
        return;
    };
    seed(&pool).await;

    let in_house = view_row_count(&pool, "in_house").await;
    let normal_balance = view_row_count(&pool, "normal_balance").await;
    let combined_balance = view_row_count(&pool, "balance").await;
    let upcoming = view_row_count(&pool, "upcoming").await;

    cleanup(&pool).await;

    // One fixture is in house; the other checked out a week ago owing money.
    assert_eq!(in_house, 1, "in_house view must return the checked-in stay");
    assert_eq!(
        normal_balance, 1,
        "normal_balance must return the past-checkout stay with an outstanding balance"
    );
    assert_eq!(
        combined_balance, 1,
        "the combined balance view is the union of the two disjoint buckets"
    );
    assert_eq!(
        upcoming, 0,
        "neither fixture is a future confirmed/pending arrival"
    );
}

#[tokio::test]
async fn an_unknown_view_falls_through_to_the_unfiltered_list() {
    let Some((pool, _guard)) = setup_pool().await else {
        eprintln!("Skipping board-summary test because DATABASE_URL is not set");
        return;
    };
    seed(&pool).await;

    // A typo or a stale link must not silently return an empty board.
    let rows = view_row_count(&pool, "not-a-real-view").await;

    cleanup(&pool).await;

    assert_eq!(
        rows, 2,
        "an unrecognised view must not filter anything out; both fixtures should come back"
    );
}

#[tokio::test]
async fn booking_rows_carry_occupancy() {
    let Some((pool, _guard)) = setup_pool().await else {
        eprintln!("Skipping board-summary test because DATABASE_URL is not set");
        return;
    };
    seed(&pool).await;

    let params = BookingPaginationParams {
        view: Some("in_house".to_string()),
        page_size: Some(500),
        ..Default::default()
    };
    let pagination = Pagination {
        page: 1,
        page_size: 500,
        offset: 0,
    };
    let (_, rows) = BookingRepository::find_paginated_with_details(
        &pool,
        &params,
        GET_BOOKINGS_BASE_QUERY,
        pagination,
    )
    .await
    .expect("list query runs");

    let seeded: Option<BookingWithDetails> =
        rows.into_iter().find(|b| b.id == BOOKING_IN_HOUSE);

    cleanup(&pool).await;

    let booking = seeded.expect("the in-house fixture is in the list");
    // The whole point: these were declared on the type but never selected, so
    // they decoded as None and every booking counted as a single guest.
    assert_eq!(
        booking.adults,
        Some(2),
        "adults must be selected by the list query, not just declared on the struct"
    );
    assert_eq!(booking.children, Some(1), "children must be selected too");
}

#[tokio::test]
async fn summary_headcount_counts_people_not_rooms() {
    let Some((pool, _guard)) = setup_pool().await else {
        eprintln!("Skipping board-summary test because DATABASE_URL is not set");
        return;
    };
    seed(&pool).await;

    // The aggregate over just this test's in-house fixture. Scoped by id so
    // other rows in the database cannot move the number.
    let row = sqlx::query(
        "SELECT COALESCE(SUM(COALESCE(b.adults, 1) + COALESCE(b.children, 0)), 0)::bigint AS headcount, \
                COUNT(*)::bigint AS rooms \
         FROM bookings b \
         WHERE b.id = $1 AND b.status = 'checked_in'",
    )
    .bind(BOOKING_IN_HOUSE)
    .fetch_one(&pool)
    .await
    .expect("headcount query runs");

    let headcount: i64 = row.try_get("headcount").expect("headcount column");
    let rooms: i64 = row.try_get("rooms").expect("rooms column");

    cleanup(&pool).await;

    assert_eq!(rooms, 1, "one in-house fixture room");
    assert_eq!(
        headcount, 3,
        "2 adults + 1 child must total 3; equal to the room count means occupancy was dropped again"
    );
}

#[tokio::test]
async fn outstanding_balance_matches_the_list_query() {
    let Some((pool, _guard)) = setup_pool().await else {
        eprintln!("Skipping board-summary test because DATABASE_URL is not set");
        return;
    };
    seed(&pool).await;

    let params = BookingPaginationParams {
        view: Some("normal_balance".to_string()),
        page_size: Some(500),
        ..Default::default()
    };
    let pagination = Pagination {
        page: 1,
        page_size: 500,
        offset: 0,
    };
    let (_, rows) = BookingRepository::find_paginated_with_details(
        &pool,
        &params,
        GET_BOOKINGS_BASE_QUERY,
        pagination,
    )
    .await
    .expect("balance view query runs");

    let seeded = rows.into_iter().find(|b| b.id == BOOKING_PAST_DUE);

    cleanup(&pool).await;

    let booking = seeded.expect("the past-due fixture is in the balance view");
    // 300.00 total, 100.00 collected. The summary sums this same expression, so
    // a card that disagreed with this number would be reading different SQL.
    assert_eq!(
        booking.balance_due,
        Some(Decimal::new(20000, 2)),
        "balance_due must be total minus completed non-deposit payments"
    );
}

/// The frontend reads these exact keys (`BookingBoardSummary` in
/// `hotel-web-fe/src/types/booking.types.ts`). serde uses the field names
/// verbatim here — no `rename_all` — so a Rust rename would silently produce
/// `undefined` on every card rather than a type error on either side.
#[test]
fn summary_serializes_the_keys_the_board_reads() {
    let json = serde_json::to_value(hotel_app_be::modules::bookings::empty_board_summary())
        .expect("summary serializes");
    let object = json.as_object().expect("summary is a JSON object");

    for key in [
        "arriving",
        "ready_to_check_in",
        "in_house",
        "guests_in_house",
        "departing",
        "upcoming",
        "normal_due",
        "normal_due_amount",
        "company_due",
        "company_due_amount",
        "company_outstanding_months",
    ] {
        assert!(
            object.contains_key(key),
            "the board reads `{key}` from GET /bookings/summary; renaming it breaks that card silently"
        );
    }
    assert_eq!(
        object.len(),
        11,
        "an added field is fine, but update the frontend type and this list with it"
    );
}
