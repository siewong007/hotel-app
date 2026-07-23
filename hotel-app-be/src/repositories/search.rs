//! Global search read queries

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::SearchHit;

fn like_op() -> &'static str {
    "ILIKE"
}

/// (`$1`/`?1` for the search pattern, `$2`/`?2` for the row limit).
fn placeholders() -> (&'static str, &'static str) {
    ("$1", "$2")
}

fn encode_query_component(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn matches_search_query(value: &str, query: &str) -> bool {
    !query.is_empty() && !value.is_empty() && value.to_lowercase().contains(query)
}

fn select_ledger_reference_title(
    query: &str,
    ledger_id: i64,
    invoice_number: &str,
    folio_number: &str,
    booking_number: &str,
) -> (String, String) {
    for value in [invoice_number, folio_number, booking_number] {
        if matches_search_query(value, query) {
            return (value.to_string(), value.to_string());
        }
    }

    for value in [invoice_number, folio_number, booking_number] {
        if !value.is_empty() {
            return (value.to_string(), value.to_string());
        }
    }

    (format!("Ledger #{}", ledger_id), ledger_id.to_string())
}

pub struct SearchRepository;

impl SearchRepository {
    pub async fn search_bookings(
        pool: &DbPool,
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ApiError> {
        let lk = like_op();
        let (p, plim) = placeholders();
        let sql = format!(
            "SELECT b.id AS id, b.booking_number AS booking_number, \
                    COALESCE(g.full_name, '') AS guest_name, \
                    COALESCE(r.room_number, '') AS room_number, \
                    b.status AS status \
             FROM bookings b \
             LEFT JOIN guests g ON b.guest_id = g.id \
             LEFT JOIN rooms r ON b.room_id = r.id \
             WHERE b.status != 'voided' AND ( \
                 b.booking_number {lk} {p} OR g.full_name {lk} {p} OR r.room_number {lk} {p}) \
             ORDER BY b.check_in_date DESC LIMIT {plim}"
        );

        #[derive(sqlx::FromRow)]
        struct Row {
            id: i64,
            booking_number: String,
            guest_name: String,
            room_number: String,
            status: String,
        }

        let rows = sqlx::query_as::<_, Row>(&sql)
            .bind(pattern)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let (booking_label, route_search_value) = if row.booking_number.trim().is_empty() {
                    (format!("#{}", row.id), row.id.to_string())
                } else {
                    (row.booking_number.clone(), row.booking_number)
                };
                let route_search = encode_query_component(&route_search_value);
                let mut subtitle = String::new();
                if !row.guest_name.is_empty() {
                    subtitle.push_str(&row.guest_name);
                }
                if !row.room_number.is_empty() {
                    if !subtitle.is_empty() {
                        subtitle.push_str(" · ");
                    }
                    subtitle.push_str(&format!("Room {}", row.room_number));
                }
                if !subtitle.is_empty() {
                    subtitle.push_str(" · ");
                }
                subtitle.push_str(&row.status.replace('_', " "));

                SearchHit {
                    id: row.id,
                    title: booking_label,
                    subtitle,
                    route: format!("/bookings?search={}&booking_id={}", route_search, row.id),
                }
            })
            .collect())
    }

    pub async fn search_guests(
        pool: &DbPool,
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ApiError> {
        let lk = like_op();
        let (p, plim) = placeholders();
        let sql = format!(
            "SELECT g.id AS id, \
                    COALESCE(g.full_name, TRIM(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')), '') AS full_name, \
                    COALESCE(g.phone, '') AS phone, COALESCE(g.email, '') AS email, \
                    COALESCE(g.ic_number, '') AS ic_number, \
                    COALESCE(g.company_name, '') AS company_name \
             FROM guests g \
             WHERE g.deleted_at IS NULL AND ( \
                 CAST(g.id AS TEXT) {lk} {p} \
                 OR COALESCE(g.full_name, '') {lk} {p} \
                 OR COALESCE(g.first_name, '') {lk} {p} \
                 OR COALESCE(g.last_name, '') {lk} {p} \
                 OR TRIM(COALESCE(g.first_name, '') || ' ' || COALESCE(g.last_name, '')) {lk} {p} \
                 OR COALESCE(g.email, '') {lk} {p} \
                 OR COALESCE(g.phone, '') {lk} {p} \
                 OR COALESCE(g.ic_number, '') {lk} {p} \
                 OR COALESCE(g.company_name, '') {lk} {p} \
                 OR EXISTS (SELECT 1 FROM users u \
                            WHERE u.guest_id = g.id \
                              AND u.deleted_at IS NULL \
                              AND u.is_active = true \
                              AND u.username {lk} {p})) \
             ORDER BY full_name LIMIT {plim}"
        );

        #[derive(sqlx::FromRow)]
        struct Row {
            id: i64,
            full_name: String,
            phone: String,
            email: String,
            ic_number: String,
            company_name: String,
        }

        let rows = sqlx::query_as::<_, Row>(&sql)
            .bind(pattern)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let route_search = encode_query_component(&row.full_name);
                let subtitle = [
                    format!("#{}", row.id),
                    row.phone,
                    row.email,
                    row.ic_number,
                    row.company_name,
                ]
                .into_iter()
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");

                SearchHit {
                    id: row.id,
                    title: row.full_name,
                    subtitle,
                    route: format!("/guest-config?search={}&guest_id={}", route_search, row.id),
                }
            })
            .collect())
    }

    pub async fn search_ledgers(
        pool: &DbPool,
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ApiError> {
        let lk = like_op();
        let (p, plim) = placeholders();
        let sql = format!(
            "SELECT cl.id AS id, cl.company_name AS company_name, \
                    c.id AS company_id, \
                    COALESCE(cl.description, '') AS description, \
                    COALESCE(cl.invoice_number, '') AS invoice_number, \
                    COALESCE(cl.folio_number, '') AS folio_number, \
                    COALESCE(b.booking_number, '') AS booking_number, \
                    COALESCE(cl.room_number, '') AS room_number, \
                    cl.status AS status \
             FROM customer_ledgers cl \
             LEFT JOIN companies c ON LOWER(c.company_name) = LOWER(cl.company_name) \
             LEFT JOIN bookings b ON b.id = cl.booking_id \
             WHERE CAST(cl.id AS TEXT) {lk} {p} \
                OR cl.company_name {lk} {p} \
                OR COALESCE(cl.description, '') {lk} {p} \
                OR COALESCE(cl.invoice_number, '') {lk} {p} \
                OR COALESCE(cl.folio_number, '') {lk} {p} \
                OR COALESCE(b.booking_number, '') {lk} {p} \
                OR COALESCE(cl.reference_number, '') {lk} {p} \
                OR COALESCE(cl.payment_reference, '') {lk} {p} \
                OR COALESCE(cl.room_number, '') {lk} {p} \
             ORDER BY cl.created_at DESC LIMIT {plim}"
        );

        #[derive(sqlx::FromRow)]
        struct Row {
            id: i64,
            company_name: String,
            company_id: Option<i64>,
            description: String,
            invoice_number: String,
            folio_number: String,
            booking_number: String,
            room_number: String,
            status: String,
        }

        let rows = sqlx::query_as::<_, Row>(&sql)
            .bind(pattern)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let query = pattern.trim_matches('%').to_lowercase();
                let (title, route_search_value) = select_ledger_reference_title(
                    &query,
                    row.id,
                    &row.invoice_number,
                    &row.folio_number,
                    &row.booking_number,
                );

                let mut subtitle = row.company_name.clone();
                if !row.booking_number.is_empty() && row.booking_number != title {
                    subtitle.push_str(" · ");
                    subtitle.push_str(&row.booking_number);
                }
                if !row.description.is_empty() {
                    subtitle.push_str(" · ");
                    subtitle.push_str(&row.description);
                }
                if !row.room_number.is_empty() {
                    subtitle.push_str(" · Room ");
                    subtitle.push_str(&row.room_number);
                }
                if !row.status.is_empty() {
                    subtitle.push_str(" · ");
                    subtitle.push_str(&row.status.replace('_', " "));
                }

                let company_context = row
                    .company_id
                    .map(|id| format!("&company_id={id}"))
                    .unwrap_or_else(|| {
                        format!("&company={}", encode_query_component(&row.company_name))
                    });

                SearchHit {
                    id: row.id,
                    title,
                    subtitle,
                    route: format!(
                        "/company-ledger?tab=entries&search={}&ledger_id={}{}",
                        encode_query_component(&route_search_value),
                        row.id,
                        company_context
                    ),
                }
            })
            .collect())
    }

    pub async fn search_rooms(
        pool: &DbPool,
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ApiError> {
        let lk = like_op();
        let (p, plim) = placeholders();
        let sql = format!(
            "SELECT r.id AS id, r.room_number AS room_number, \
                    COALESCE(rt.name, '') AS room_type, \
                    COALESCE(r.status, '') AS status \
             FROM rooms r \
             LEFT JOIN room_types rt ON r.room_type_id = rt.id \
             WHERE r.room_number {lk} {p} OR rt.name {lk} {p} OR rt.code {lk} {p} \
             ORDER BY r.room_number LIMIT {plim}"
        );

        #[derive(sqlx::FromRow)]
        struct Row {
            id: i64,
            room_number: String,
            room_type: String,
            status: String,
        }

        let rows = sqlx::query_as::<_, Row>(&sql)
            .bind(pattern)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let mut subtitle = row.room_type;
                if !row.status.is_empty() {
                    subtitle.push_str(&format!(" · {}", row.status.replace('_', " ")));
                }

                SearchHit {
                    id: row.id,
                    title: format!("Room {}", row.room_number),
                    subtitle,
                    route: "/room-management".into(),
                }
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ledger_search_title_uses_matching_invoice_number() {
        let (title, route_search_value) = select_ledger_reference_title(
            "inv-202606-0296",
            43,
            "INV-202606-0296",
            "CL-20260620-000234",
            "BK-20260620-390178d0",
        );

        assert_eq!(title, "INV-202606-0296");
        assert_eq!(route_search_value, "INV-202606-0296");
    }

    #[test]
    fn ledger_search_title_uses_matching_folio_booking_reference() {
        let (title, route_search_value) = select_ledger_reference_title(
            "cl-20260620-000234",
            43,
            "INV-202606-0296",
            "CL-20260620-000234",
            "BK-20260620-390178d0",
        );

        assert_eq!(title, "CL-20260620-000234");
        assert_eq!(route_search_value, "CL-20260620-000234");
    }

    #[test]
    fn ledger_search_title_uses_matching_joined_booking_number() {
        let (title, route_search_value) = select_ledger_reference_title(
            "bk-20260620-390178d0",
            43,
            "INV-202606-0296",
            "CL-20260620-000234",
            "BK-20260620-390178d0",
        );

        assert_eq!(title, "BK-20260620-390178d0");
        assert_eq!(route_search_value, "BK-20260620-390178d0");
    }
}
