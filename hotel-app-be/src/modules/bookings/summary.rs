//! Operational summary for the bookings board.
//!
//! The board shows nine derived figures: how many stays arrive today, how many
//! of those can actually be checked in, who is in house (and how many people
//! that is), who departs today, what is still upcoming, and the two outstanding
//! balance buckets with their amounts.
//!
//! The frontend used to derive all of this itself. It called
//! `getBookingsWithDetails()` with no filter, which pages the entire non-voided
//! bookings table at 500 rows per request, and reduced the result to these nine
//! scalars in the browser. Measured on a 2,756-booking dataset that was five
//! HTTP requests, ~85 ms of database time and **3,143 kB of JSON** on every load
//! of the page -- and again on every booking mutation, because
//! `invalidateBookingDependencies` invalidates the whole `bookings` key space,
//! including from the `data_changed` socket on every other connected client.
//!
//! This aggregate returns the same nine values in a single round trip: **4.2-5.5
//! ms** and a few hundred bytes.
//!
//! # Staying equivalent to the board
//!
//! The predicates below are transcriptions of `getBookingViewSlices` in
//! `hotel-web-fe/src/features/bookings/utils/bookingPageUtils.ts`. Two of them
//! are easy to get subtly wrong:
//!
//! * `is_company` mirrors `isCompanyBooking`, which is truthy on **either** a
//!   `company_id` **or** a non-blank `company_name` -- not the id alone.
//! * The company bucket uses the client's `addMonthsToDateOnly(check_out, 1)`,
//!   which clamps the day into the target month (31 Jan + 1 month = 28 Feb).
//!   PostgreSQL's `+ INTERVAL '1 month'` clamps identically, so the two agree
//!   including at month ends.
//!
//! `balance_due` is not re-derived here. It is copied character for character
//! from `GET_BOOKINGS_BASE_QUERY`, including both LATERAL joins, so a card and
//! the row beneath it can never disagree about what a guest owes. If that
//! expression changes, change it in both places.
//!
//! # One deliberate behaviour change
//!
//! "Today" was the **browser's** local date (`formatLocalDate()`); here it is
//! `CURRENT_DATE`, which each connection resolves in the hotel's own timezone
//! from `system_settings.timezone`. That is the business day the rest of the
//! backend already uses, and it makes the board agree with the night audit for
//! staff whose device clock sits in another zone.

use axum::{Json, extract::State};
use rust_decimal::Decimal;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::row_mappers;
use sqlx::Row;

use super::helpers::ROOM_HOLDING_RESERVATION_STATUSES_SQL;
use super::models::BookingBoardSummary;

/// How long after checkout a company-billed stay is treated as overdue.
/// Mirrors `COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT` on the frontend.
const COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT: i32 = 1;

/// `isCompanyBooking` — an id **or** a non-blank name, not the id alone.
const IS_COMPANY: &str = "(b.company_id IS NOT NULL OR COALESCE(TRIM(b.company_name), '') <> '')";

/// A board view's row predicate for the booking list query.
///
/// The board's seven views and its summary counts have to agree: a card that
/// says "76 due" must open a list of exactly those 76 rows. Both sides are
/// generated from the definitions here so they cannot drift apart.
pub struct BoardViewFilter {
    /// SQL predicate over the list query's `b` alias.
    pub predicate: String,
    /// Whether the predicate reads `bk_charge` / `bk_pay`, which the standalone
    /// count query does not join by default.
    pub needs_balance_joins: bool,
}

/// The outstanding-balance test, over the list query's LATERAL aliases.
/// Same expression as `BALANCE_DUE_EXPR`, reduced to `> 0`.
fn has_balance() -> String {
    format!("({}) > 0", BALANCE_DUE_EXPR.trim())
}

/// Resolve a board view name to its row predicate.
///
/// Returns `None` for `all`, an empty value, or anything unrecognised — an
/// unknown view must fall through to the unfiltered list rather than silently
/// returning nothing.
pub fn board_view_filter(view: &str) -> Option<BoardViewFilter> {
    let months = COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT;
    let (predicate, needs_balance_joins) = match view.trim() {
        "arriving" => (
            "b.check_in_date = CURRENT_DATE \
             AND b.status NOT IN ('checked_in', 'checked_out', 'completed')"
                .to_string(),
            false,
        ),
        "in_house" => ("b.status = 'checked_in'".to_string(), false),
        "departing" => (
            "b.check_out_date = CURRENT_DATE AND b.status = 'checked_in'".to_string(),
            false,
        ),
        // Every room-holding reservation, so unpaid and awaiting-confirmation
        // website bookings are counted too. Mirrors `getBookingViewSlices`.
        "upcoming" => (
            format!(
                "b.status IN ({ROOM_HOLDING_RESERVATION_STATUSES_SQL}) AND b.check_in_date > CURRENT_DATE"
            ),
            false,
        ),
        "normal_balance" => (
            format!(
                "NOT {IS_COMPANY} AND b.check_out_date < CURRENT_DATE AND {}",
                has_balance()
            ),
            true,
        ),
        "company_balance" => (
            format!(
                "{IS_COMPANY} AND b.check_out_date + INTERVAL '{months} month' <= CURRENT_DATE AND {}",
                has_balance()
            ),
            true,
        ),
        // The combined bucket is the union of the two above, and they are
        // disjoint on `is_company`.
        "balance" => (
            format!(
                "((NOT {IS_COMPANY} AND b.check_out_date < CURRENT_DATE) \
                  OR ({IS_COMPANY} AND b.check_out_date + INTERVAL '{months} month' <= CURRENT_DATE)) \
                 AND {}",
                has_balance()
            ),
            true,
        ),
        _ => return None,
    };

    Some(BoardViewFilter {
        predicate,
        needs_balance_joins,
    })
}

/// The two LATERAL joins a balance-filtered count query needs. The data query
/// already carries them via `GET_BOOKINGS_BASE_QUERY`; the standalone count
/// joins only guests and rooms, so it has to add them itself.
pub const BALANCE_LATERAL_JOINS: &str = r#"
    LEFT JOIN LATERAL (
        SELECT cl.amount, cl.paid_amount
        FROM customer_ledgers cl
        WHERE cl.booking_id = b.id
          AND cl.post_type = 'room_charge'
          AND COALESCE(cl.is_reversal, FALSE) = FALSE
        ORDER BY cl.created_at DESC
        LIMIT 1
    ) bk_charge ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            SUM(p.amount) FILTER (
                WHERE p.status = 'completed'
                  AND COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')
            ) AS completed_paid
        FROM payments p
        WHERE p.booking_id = b.id
    ) bk_pay ON TRUE
"#;

/// `balance_due`, verbatim from `GET_BOOKINGS_BASE_QUERY`.
const BALANCE_DUE_EXPR: &str = r#"
        CASE WHEN COALESCE(bk_charge.amount, b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) - COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0)) > 0
             THEN COALESCE(bk_charge.amount, b.total_amount + COALESCE(b.tourism_tax_amount, 0) + COALESCE(b.extra_bed_charge, 0)) - COALESCE(bk_charge.paid_amount, COALESCE(bk_pay.completed_paid, 0))
             ELSE 0
        END
"#;

/// Every count below is `COUNT(*) FILTER (WHERE <the view's own predicate>)`,
/// taken from `board_view_filter` rather than restated — so the number on a card
/// and the rows the card opens are generated from one string.
fn board_summary_sql() -> String {
    let view = |name: &str| {
        board_view_filter(name)
            .expect("board_summary_sql references only known views")
            .predicate
    };
    let (arriving, in_house, departing, upcoming, normal, company) = (
        view("arriving"),
        view("in_house"),
        view("departing"),
        view("upcoming"),
        view("normal_balance"),
        view("company_balance"),
    );
    let balance = BALANCE_DUE_EXPR.trim();

    format!(
        r#"
SELECT
    COUNT(*) FILTER (WHERE {arriving}) AS arriving,
    -- `canCheckIn`: confirmed or pending, on or after the arrival date. Inside
    -- the arriving bucket the date half is already true.
    COUNT(*) FILTER (
        WHERE b.check_in_date = CURRENT_DATE AND b.status IN ('confirmed', 'pending')
    ) AS ready_to_check_in,
    COUNT(*) FILTER (WHERE {in_house}) AS in_house,
    -- Occupancy defaults match the board's `Number(adults || 1)` /
    -- `Number(children || 0)`.
    COALESCE(
        SUM(COALESCE(b.adults, 1) + COALESCE(b.children, 0)) FILTER (WHERE {in_house}), 0
    ) AS guests_in_house,
    COUNT(*) FILTER (WHERE {departing}) AS departing,
    COUNT(*) FILTER (WHERE {upcoming}) AS upcoming,
    COUNT(*) FILTER (WHERE {normal}) AS normal_due,
    COALESCE(SUM({balance}) FILTER (WHERE {normal}), 0) AS normal_due_amount,
    COUNT(*) FILTER (WHERE {company}) AS company_due,
    COALESCE(SUM({balance}) FILTER (WHERE {company}), 0) AS company_due_amount
FROM bookings b
{joins}
WHERE b.status <> 'voided'
"#,
        joins = BALANCE_LATERAL_JOINS.trim(),
    )
}

/// `GET /bookings/summary` -- the bookings board's nine operational figures.
pub async fn get_booking_board_summary_handler(
    State(pool): State<DbPool>,
) -> Result<Json<BookingBoardSummary>, ApiError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(board_summary_sql()))
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let count = |col: &str| row.try_get::<i64, _>(col).unwrap_or(0);

    Ok(Json(BookingBoardSummary {
        arriving: count("arriving"),
        ready_to_check_in: count("ready_to_check_in"),
        in_house: count("in_house"),
        guests_in_house: count("guests_in_house"),
        departing: count("departing"),
        upcoming: count("upcoming"),
        normal_due: count("normal_due"),
        normal_due_amount: row_mappers::get_decimal(&row, "normal_due_amount"),
        company_due: count("company_due"),
        company_due_amount: row_mappers::get_decimal(&row, "company_due_amount"),
        company_outstanding_months: COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT,
    }))
}

/// A zeroed summary, used where a caller needs the shape without a query.
#[allow(dead_code)] // used by tests/bookings_board_summary.rs
pub fn empty_board_summary() -> BookingBoardSummary {
    BookingBoardSummary {
        arriving: 0,
        ready_to_check_in: 0,
        in_house: 0,
        guests_in_house: 0,
        departing: 0,
        upcoming: 0,
        normal_due: 0,
        normal_due_amount: Decimal::ZERO,
        company_due: 0,
        company_due_amount: Decimal::ZERO,
        company_outstanding_months: COMPANY_OUTSTANDING_MONTHS_AFTER_CHECKOUT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_sql_reuses_the_list_query_balance_expression() {
        let sql = board_summary_sql();
        // The card and the row beneath it must agree on what is owed, so this
        // aggregate carries the list query's own expression, not a rewrite.
        assert!(sql.contains("bk_charge.paid_amount"));
        assert!(sql.contains(
            "COALESCE(p.payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited')"
        ));
        assert!(sql.contains("cl.post_type = 'room_charge'"));
    }

    #[test]
    fn company_bucket_matches_the_frontend_predicate() {
        let sql = board_summary_sql();
        // isCompanyBooking is id OR non-blank name -- not the id alone.
        assert!(
            sql.contains("b.company_id IS NOT NULL OR COALESCE(TRIM(b.company_name), '') <> ''")
        );
        // ...and the terms window comes from the shared constant.
        assert!(sql.contains("INTERVAL '1 month'"));
    }

    #[test]
    fn upcoming_counts_unpaid_and_awaiting_confirmation_holds() {
        let upcoming = board_view_filter("upcoming").expect("upcoming is a known view");
        for status in [
            "'pending'",
            "'pending_payment'",
            "'pending_confirmation'",
            "'confirmed'",
        ] {
            assert!(
                upcoming.predicate.contains(status),
                "upcoming must include {status}: {}",
                upcoming.predicate
            );
        }
        assert!(!upcoming.predicate.contains("voided"));
        // The card count is generated from the same predicate.
        assert!(board_summary_sql().contains(&upcoming.predicate));
    }

    #[test]
    fn ready_to_check_in_stays_limited_to_check_in_able_statuses() {
        // Check-in accepts only confirmed/pending; an awaiting-payment hold is
        // arriving but not ready.
        let sql = board_summary_sql();
        assert!(sql.contains(
            "WHERE b.check_in_date = CURRENT_DATE AND b.status IN ('confirmed', 'pending')"
        ));
    }

    #[test]
    fn board_excludes_voided_bookings() {
        assert!(board_summary_sql().contains("b.status <> 'voided'"));
    }

    #[test]
    fn dates_resolve_in_the_hotel_timezone_not_the_process_clock() {
        let sql = board_summary_sql();
        // CURRENT_DATE is the business day (connection timezone). A chrono::Local
        // or Utc date here would silently name a different day for staff in
        // another zone -- see core/db.rs.
        assert!(sql.contains("CURRENT_DATE"));
        assert!(!sql.contains("NOW()"));
    }
}
