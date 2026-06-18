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
            "(g.full_name {like_op} {p} \
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

    if matches!(params.company_billed, Some(true)) {
        conditions.push("b.company_id IS NOT NULL".to_string());
    }

    // date_search intentionally overrides range filters, matching existing behavior.
    if let Some(ds) = params.date_search {
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
