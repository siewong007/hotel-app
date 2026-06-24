//! Booking list query planning.
//!
//! Keeps filter and sort SQL construction separate from handler orchestration.

use chrono::NaiveDate;

use crate::models::BookingPaginationParams;
use crate::utils::pagination::Pagination;

/// Dynamic SQL and bind values for the booking list endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookingListQuery {
    pub count_sql: String,
    pub data_sql: String,
    pub binds: BookingListBinds,
}

/// Bind values are stored in SQL placeholder order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BookingListBinds {
    pub status: Option<String>,
    pub search: Option<String>,
    pub room_number: Option<String>,
    pub payment_method: Option<String>,
    // Payment-date window. Bound immediately after `payment_method` because the
    // EXISTS that matches a payment of the given method also constrains its date.
    pub payment_date_from: Option<NaiveDate>,
    pub payment_date_to: Option<NaiveDate>,
    pub online_channel: Option<String>,
    pub date_search: Option<NaiveDate>,
    pub check_in_from: Option<NaiveDate>,
    pub check_in_to: Option<NaiveDate>,
}

/// Build the SQL query text and ordered bind values for booking lists.
pub fn build_booking_list_query(
    params: &BookingPaginationParams,
    base_query: &str,
    pagination: Pagination,
) -> BookingListQuery {
    let search = params.search.as_deref().filter(|s| !s.trim().is_empty());
    let status = params.status.as_deref().filter(|s| !s.trim().is_empty());
    let room_number = params
        .room_number
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    let payment_method = params
        .payment_method
        .as_deref()
        .filter(|s| !s.trim().is_empty());
    let online_channel = params
        .online_channel
        .as_deref()
        .filter(|s| !s.trim().is_empty());

    let like_op = like_operator();
    let mut conditions: Vec<String> = Vec::new();
    let mut param_idx = 0i32;
    let mut binds = BookingListBinds::default();

    // Status: explicit filter, "all" to include every status, or default exclude voided.
    if let Some(s) = status {
        if s.eq_ignore_ascii_case("all") {
            // Include every status, including voided.
        } else {
            param_idx += 1;
            conditions.push(format!("b.status = {}", param_placeholder(param_idx)));
            binds.status = Some(s.to_string());
        }
    } else {
        conditions.push("b.status != 'voided'".to_string());
    }

    if let Some(s) = search {
        param_idx += 1;
        let p = param_placeholder(param_idx);
        conditions.push(format!(
            "(CAST(b.id AS TEXT) {like_op} {p} \
              OR g.full_name {like_op} {p} \
              OR b.booking_number {like_op} {p} \
              OR b.folio_number {like_op} {p} \
              OR r.room_number {like_op} {p} \
              OR ('room ' || r.room_number) {like_op} {p} \
              OR ('rm ' || r.room_number) {like_op} {p} \
              OR EXISTS (SELECT 1 FROM invoices inv WHERE inv.booking_id = b.id AND inv.invoice_number {like_op} {p}) \
              OR EXISTS ( \
                  SELECT 1 FROM customer_ledgers cl \
                  WHERE cl.booking_id = b.id \
                    AND ( \
                        CAST(cl.id AS TEXT) {like_op} {p} \
                        OR COALESCE(cl.invoice_number, '') {like_op} {p} \
                        OR COALESCE(cl.folio_number, '') {like_op} {p} \
                        OR COALESCE(cl.reference_number, '') {like_op} {p} \
                        OR COALESCE(cl.transaction_code, '') {like_op} {p} \
                        OR COALESCE(cl.payment_reference, '') {like_op} {p} \
                        OR COALESCE(cl.company_name, '') {like_op} {p} \
                        OR COALESCE(cl.contact_person, '') {like_op} {p} \
                        OR COALESCE(cl.description, '') {like_op} {p} \
                        OR COALESCE(cl.room_number, '') {like_op} {p} \
                    ) \
              ))"
        ));
        binds.search = Some(format!("%{}%", s.trim()));
    }

    if let Some(rn) = room_number {
        param_idx += 1;
        let p = param_placeholder(param_idx);
        conditions.push(format!("r.room_number {like_op} {p}"));
        binds.room_number = Some(format!("%{}%", rn.trim()));
    }

    // When a payment method is filtered, the date filter targets the *payment*
    // date (the `payments.created_at` day, in hotel-local time via the session
    // timezone) instead of the booking's stay window. So a "23 Jun + Visa" filter
    // returns bookings that took a Visa payment on 23 Jun, not bookings merely
    // staying on 23 Jun that happen to carry a Visa payment from another day.
    let (pay_date_from, pay_date_to) = if payment_method.is_some() {
        payment_date_window(params)
    } else {
        (None, None)
    };
    let payment_date_active = pay_date_from.is_some() || pay_date_to.is_some();

    if let Some(pm) = payment_method {
        param_idx += 1;
        let p = param_placeholder(param_idx);
        binds.payment_method = Some(pm.trim().to_string());

        // EXISTS predicate over the booking's non-void payments of this method.
        // LOWER() on both sides keeps the (free-typed) filter case-insensitive.
        // The same placeholder is referenced twice — both PostgreSQL ($N) and
        // SQLite (?N) resolve a repeated numbered placeholder to the single bind.
        let mut pay_exists = format!(
            "LOWER(pay.payment_method) = LOWER({p}) \
             AND pay.status NOT IN ('void', 'voided', 'failed')"
        );

        // Fold the payment-date window into the EXISTS so a single payment row
        // must satisfy both the method and the date. Placeholders are assigned
        // here (right after the method bind) to keep numbering aligned with the
        // bind order in `apply_binds!`.
        if let Some(from) = pay_date_from {
            param_idx += 1;
            let dp = param_placeholder(param_idx);
            pay_exists.push_str(&format!(" AND {} >= {dp}", date_cast("pay.created_at")));
            binds.payment_date_from = Some(from);
        }
        if let Some(to) = pay_date_to {
            param_idx += 1;
            let dp = param_placeholder(param_idx);
            pay_exists.push_str(&format!(" AND {} <= {dp}", date_cast("pay.created_at")));
            binds.payment_date_to = Some(to);
        }

        if payment_date_active {
            // A date constraint requires an actual payment row on that day; the
            // booking's own `payment_method` column carries no date, so it can't
            // participate.
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM payments pay WHERE pay.booking_id = b.id AND {pay_exists})"
            ));
        } else {
            // No date filter: match the booking's own payment_method column OR any
            // non-void payment recorded against it. Methods like MAE/DuitNow are
            // frequently captured as `payments` rows at check-in/checkout and never
            // written back to `bookings.payment_method`, so a column-only match
            // misses them.
            conditions.push(format!(
                "(LOWER(b.payment_method) = LOWER({p}) \
                  OR EXISTS (SELECT 1 FROM payments pay \
                             WHERE pay.booking_id = b.id AND {pay_exists}))"
            ));
        }
    }

    // Online booking channel: the channel name is stored as a prefix in the
    // booking's free-text remarks (e.g. "Booking.com - Ref: ABC123") and/or the
    // `source` column, mirroring how the frontend derives the "booked via" label.
    if let Some(oc) = online_channel {
        param_idx += 1;
        let p = param_placeholder(param_idx);
        conditions.push(format!(
            "(b.source {like_op} {p} OR b.remarks {like_op} {p})"
        ));
        binds.online_channel = Some(format!("%{}%", oc.trim()));
    }

    if matches!(params.company_billed, Some(true)) {
        conditions.push("b.company_id IS NOT NULL".to_string());
    }

    // date_search intentionally overrides range filters, matching existing behavior.
    // Skipped entirely when the date has been redirected to the payment date above.
    if payment_date_active {
        // Stay-window filtering is intentionally suppressed: the selected date is
        // applied to the payment, not the stay.
    } else if let Some(ds) = params.date_search {
        param_idx += 1;
        let p = param_placeholder(param_idx);
        let col_in = date_cast("b.check_in_date");
        let col_out = date_cast("b.check_out_date");
        conditions.push(format!(
            "({col_in} <= {p} AND ({col_out} > {p} OR {col_in} = {col_out}))"
        ));
        binds.date_search = Some(ds);
    } else {
        if let (Some(from), Some(to)) = (params.check_in_from, params.check_in_to) {
            param_idx += 1;
            let from_p = param_placeholder(param_idx);
            param_idx += 1;
            let to_p = param_placeholder(param_idx);
            let col_in = date_cast("b.check_in_date");
            let col_out = date_cast("b.check_out_date");
            conditions.push(format!(
                "(({col_in} <= {to_p} AND {col_out} > {from_p}) \
                  OR ({col_in} = {col_out} AND {col_in} >= {from_p} AND {col_in} <= {to_p}))"
            ));
            binds.check_in_from = Some(from);
            binds.check_in_to = Some(to);
        } else if let Some(from) = params.check_in_from {
            param_idx += 1;
            let p = param_placeholder(param_idx);
            let col = date_cast("b.check_in_date");
            conditions.push(format!("{col} >= {p}"));
            binds.check_in_from = Some(from);
        } else if let Some(to) = params.check_in_to {
            param_idx += 1;
            let p = param_placeholder(param_idx);
            let col = date_cast("b.check_in_date");
            conditions.push(format!("{col} <= {p}"));
            binds.check_in_to = Some(to);
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sort_col = match params.sort_by.as_deref() {
        Some("check_in_date") => "b.check_in_date",
        Some("check_out_date") => "b.check_out_date",
        Some("guest_name") => "g.full_name",
        Some("room_number") => "r.room_number",
        Some("status") => "b.status",
        Some("invoice_number") => "invoice_number",
        Some("folio_number") | Some("booking_number") => "b.booking_number",
        _ => "b.created_at",
    };
    let sort_dir = match params.sort_order.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM bookings b \
         INNER JOIN guests g ON b.guest_id = g.id \
         INNER JOIN rooms r ON b.room_id = r.id {}",
        where_clause
    );
    // Inject a windowed total so the page and its total row count come back in a
    // single round-trip. COUNT(*) OVER() is evaluated over the full filtered set
    // (before LIMIT/OFFSET), so every returned row carries the same total; the
    // caller reads it from the first row and only falls back to `count_sql` when
    // the page is empty (e.g. an offset past the end). The standalone count_sql
    // stays cheaper than the data query because it omits the per-row subqueries.
    let select_with_count = base_query.replacen(
        "FROM bookings b",
        ", COUNT(*) OVER() AS total_count FROM bookings b",
        1,
    );
    let data_sql = format!(
        "{}{} ORDER BY {} {} LIMIT {} OFFSET {}",
        select_with_count,
        where_clause,
        sort_col,
        sort_dir,
        pagination.page_size,
        pagination.offset
    );

    BookingListQuery {
        count_sql,
        data_sql,
        binds,
    }
}

fn param_placeholder(idx: i32) -> String {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    return format!("?{}", idx);
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    return format!("${}", idx);
}

fn like_operator() -> &'static str {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    return "LIKE";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    return "ILIKE";
}

/// Resolve the payment-date window from the request's date filters.
///
/// The frontend sends either a single `date_search` or a `check_in_from`/
/// `check_in_to` range. When a payment method is also filtered, that date is
/// reinterpreted as the payment date: a single day collapses to an inclusive
/// `[day, day]` window; a range is carried through as-is (either bound optional).
fn payment_date_window(
    params: &BookingPaginationParams,
) -> (Option<NaiveDate>, Option<NaiveDate>) {
    if let Some(ds) = params.date_search {
        (Some(ds), Some(ds))
    } else {
        (params.check_in_from, params.check_in_to)
    }
}

fn date_cast(col: &str) -> String {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    return format!("date({})", col);
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    return format!("{}::date", col);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> BookingPaginationParams {
        BookingPaginationParams {
            page: None,
            page_size: None,
            search: None,
            status: None,
            room_number: None,
            payment_method: None,
            online_channel: None,
            company_billed: None,
            date_search: None,
            check_in_from: None,
            check_in_to: None,
            sort_by: None,
            sort_order: None,
        }
    }

    fn pagination() -> Pagination {
        Pagination {
            page: 1,
            page_size: 50,
            offset: 0,
        }
    }

    #[test]
    fn default_query_excludes_voided_bookings() {
        let query = build_booking_list_query(&params(), "SELECT * FROM bookings b ", pagination());

        assert!(query.count_sql.contains("WHERE b.status != 'voided'"));
        assert!(
            query.data_sql.ends_with(
                "WHERE b.status != 'voided' ORDER BY b.created_at DESC LIMIT 50 OFFSET 0"
            )
        );
        assert_eq!(query.binds, BookingListBinds::default());
    }

    #[test]
    fn status_all_keeps_voided_bookings_visible() {
        let mut params = params();
        params.status = Some("all".to_string());

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        assert!(!query.count_sql.contains("b.status !="));
        assert!(!query.count_sql.contains("b.status ="));
        assert_eq!(query.binds.status, None);
    }

    #[test]
    fn filters_are_bound_in_placeholder_order() {
        let mut params = params();
        params.status = Some("confirmed".to_string());
        params.search = Some("  INV-10  ".to_string());
        params.room_number = Some(" 101 ".to_string());
        params.check_in_from = NaiveDate::from_ymd_opt(2026, 5, 1);
        params.check_in_to = NaiveDate::from_ymd_opt(2026, 5, 31);

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        assert!(
            query
                .count_sql
                .contains(&format!("b.status = {}", param_placeholder(1)))
        );
        assert!(query.count_sql.contains(&format!(
            "g.full_name {} {}",
            like_operator(),
            param_placeholder(2)
        )));
        assert!(query.count_sql.contains(&format!(
            "CAST(b.id AS TEXT) {} {}",
            like_operator(),
            param_placeholder(2)
        )));
        assert!(query.count_sql.contains(&format!(
            "r.room_number {} {}",
            like_operator(),
            param_placeholder(3)
        )));
        assert!(query.count_sql.contains(&format!(
            "{} <= {}",
            date_cast("b.check_in_date"),
            param_placeholder(5)
        )));
        assert!(query.count_sql.contains(&format!(
            "{} > {}",
            date_cast("b.check_out_date"),
            param_placeholder(4)
        )));
        assert_eq!(query.binds.status.as_deref(), Some("confirmed"));
        assert_eq!(query.binds.search.as_deref(), Some("%INV-10%"));
        assert_eq!(query.binds.room_number.as_deref(), Some("%101%"));
        assert_eq!(query.binds.date_search, None);
        assert_eq!(query.binds.check_in_from, params.check_in_from);
        assert_eq!(query.binds.check_in_to, params.check_in_to);
    }

    #[test]
    fn payment_method_filter_binds_after_room_number() {
        let mut params = params();
        params.room_number = Some("101".to_string());
        params.payment_method = Some(" Cash ".to_string());

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        assert!(query.count_sql.contains(&format!(
            "r.room_number {} {}",
            like_operator(),
            param_placeholder(1)
        )));
        assert!(query.count_sql.contains(&format!(
            "LOWER(b.payment_method) = LOWER({})",
            param_placeholder(2)
        )));
        // The payments-table branch reuses the same numbered placeholder.
        assert!(query.count_sql.contains(&format!(
            "LOWER(pay.payment_method) = LOWER({})",
            param_placeholder(2)
        )));
        assert_eq!(query.binds.payment_method.as_deref(), Some("Cash"));
    }

    #[test]
    fn payment_method_with_date_search_filters_by_payment_date() {
        let mut params = params();
        params.payment_method = Some("Visa".to_string());
        params.date_search = NaiveDate::from_ymd_opt(2026, 6, 23);

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        // The method is bound first ($1), then the payment-date window ($2 = $3 = day).
        let pay_date = date_cast("pay.created_at");
        assert!(query.count_sql.contains(&format!(
            "EXISTS (SELECT 1 FROM payments pay WHERE pay.booking_id = b.id AND LOWER(pay.payment_method) = LOWER({})",
            param_placeholder(1)
        )));
        assert!(
            query
                .count_sql
                .contains(&format!("{pay_date} >= {}", param_placeholder(2)))
        );
        assert!(
            query
                .count_sql
                .contains(&format!("{pay_date} <= {}", param_placeholder(3)))
        );
        // The stay-window date filter must NOT be applied.
        assert!(
            !query
                .count_sql
                .contains(&date_cast("b.check_in_date"))
        );
        assert_eq!(query.binds.payment_method.as_deref(), Some("Visa"));
        assert_eq!(query.binds.payment_date_from, params.date_search);
        assert_eq!(query.binds.payment_date_to, params.date_search);
        assert_eq!(query.binds.date_search, None);
    }

    #[test]
    fn payment_method_with_date_range_filters_payment_date_range() {
        let mut params = params();
        params.payment_method = Some("Cash".to_string());
        params.check_in_from = NaiveDate::from_ymd_opt(2026, 6, 1);
        params.check_in_to = NaiveDate::from_ymd_opt(2026, 6, 30);

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());
        let pay_date = date_cast("pay.created_at");

        assert!(
            query
                .count_sql
                .contains(&format!("{pay_date} >= {}", param_placeholder(2)))
        );
        assert!(
            query
                .count_sql
                .contains(&format!("{pay_date} <= {}", param_placeholder(3)))
        );
        assert!(!query.count_sql.contains(&date_cast("b.check_in_date")));
        assert_eq!(query.binds.payment_date_from, params.check_in_from);
        assert_eq!(query.binds.payment_date_to, params.check_in_to);
        assert_eq!(query.binds.check_in_from, None);
        assert_eq!(query.binds.check_in_to, None);
    }

    #[test]
    fn payment_method_without_date_keeps_column_or_payment_match() {
        let mut params = params();
        params.payment_method = Some("Visa".to_string());

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        // No date filter → preserve the column-OR-payment match (no date predicate).
        assert!(query.count_sql.contains(&format!(
            "LOWER(b.payment_method) = LOWER({})",
            param_placeholder(1)
        )));
        assert!(!query.count_sql.contains(&date_cast("pay.created_at")));
        assert_eq!(query.binds.payment_date_from, None);
        assert_eq!(query.binds.payment_date_to, None);
    }

    #[test]
    fn online_channel_filter_matches_source_or_remarks() {
        let mut params = params();
        params.online_channel = Some("  Booking.com  ".to_string());

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());
        let p = param_placeholder(1);

        assert!(query.count_sql.contains(&format!(
            "(b.source {like} {p} OR b.remarks {like} {p})",
            like = like_operator()
        )));
        assert_eq!(query.binds.online_channel.as_deref(), Some("%Booking.com%"));
    }

    #[test]
    fn text_search_matches_room_prefix_phrases() {
        let mut params = params();
        params.search = Some("room 103".to_string());

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());
        let p = param_placeholder(1);

        assert!(query.count_sql.contains(&format!(
            "('room ' || r.room_number) {} {}",
            like_operator(),
            p
        )));
        assert!(query.count_sql.contains(&format!(
            "('rm ' || r.room_number) {} {}",
            like_operator(),
            p
        )));
        assert_eq!(query.binds.search.as_deref(), Some("%room 103%"));
    }

    #[test]
    fn date_range_filters_bookings_that_overlap_the_stay_window() {
        let mut params = params();
        params.check_in_from = NaiveDate::from_ymd_opt(2026, 6, 14);
        params.check_in_to = NaiveDate::from_ymd_opt(2026, 6, 18);

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());
        let col_in = date_cast("b.check_in_date");
        let col_out = date_cast("b.check_out_date");

        assert!(query.count_sql.contains(&format!(
            "({col_in} <= {} AND {col_out} > {})",
            param_placeholder(2),
            param_placeholder(1)
        )));
        assert!(query.count_sql.contains(&format!(
            "({col_in} = {col_out} AND {col_in} >= {} AND {col_in} <= {})",
            param_placeholder(1),
            param_placeholder(2)
        )));
        assert_eq!(query.binds.check_in_from, params.check_in_from);
        assert_eq!(query.binds.check_in_to, params.check_in_to);
    }

    #[test]
    fn date_search_overrides_range_filters() {
        let mut params = params();
        params.date_search = NaiveDate::from_ymd_opt(2026, 5, 26);
        params.check_in_from = NaiveDate::from_ymd_opt(2026, 5, 1);
        params.check_in_to = NaiveDate::from_ymd_opt(2026, 5, 31);

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        assert!(query.count_sql.contains(&format!(
            "{} <= {}",
            date_cast("b.check_in_date"),
            param_placeholder(1)
        )));
        assert_eq!(query.binds.date_search, params.date_search);
        assert_eq!(query.binds.check_in_from, None);
        assert_eq!(query.binds.check_in_to, None);
    }

    #[test]
    fn sort_options_are_whitelisted() {
        let mut params = params();
        params.sort_by = Some("guest_name".to_string());
        params.sort_order = Some("asc".to_string());

        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        assert!(
            query
                .data_sql
                .ends_with("ORDER BY g.full_name ASC LIMIT 50 OFFSET 0")
        );

        params.sort_by = Some("created_at; DROP TABLE bookings".to_string());
        params.sort_order = Some("ASC".to_string());
        let query = build_booking_list_query(&params, "SELECT * FROM bookings b ", pagination());

        assert!(
            query
                .data_sql
                .ends_with("ORDER BY b.created_at DESC LIMIT 50 OFFSET 0")
        );
    }

    #[test]
    fn data_query_carries_windowed_total_but_count_query_does_not() {
        let query = build_booking_list_query(&params(), "SELECT * FROM bookings b ", pagination());

        // The page total rides along on the data rows (single round-trip)...
        assert!(query.data_sql.contains("COUNT(*) OVER() AS total_count"));
        // ...and the standalone count (empty-page fallback) stays a plain COUNT.
        assert!(query.count_sql.contains("SELECT COUNT(*)"));
        assert!(!query.count_sql.contains("OVER()"));
    }
}
