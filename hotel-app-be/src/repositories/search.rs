//! Global search read queries

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::SearchHit;

fn like_op() -> &'static str {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    return "LIKE";
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    return "ILIKE";
}

/// (`$1`/`?1` for the search pattern, `$2`/`?2` for the row limit).
fn placeholders() -> (&'static str, &'static str) {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    return ("?1", "?2");
    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    return ("$1", "$2");
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
                    title: row.booking_number,
                    subtitle,
                    route: "/bookings".into(),
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
            "SELECT id AS id, \
                    COALESCE(full_name, TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS full_name, \
                    COALESCE(phone, '') AS phone, COALESCE(email, '') AS email, \
                    COALESCE(ic_number, '') AS ic_number, \
                    COALESCE(company_name, '') AS company_name \
             FROM guests \
             WHERE deleted_at IS NULL AND ( \
                 CAST(id AS TEXT) {lk} {p} \
                 OR COALESCE(full_name, '') {lk} {p} \
                 OR COALESCE(first_name, '') {lk} {p} \
                 OR COALESCE(last_name, '') {lk} {p} \
                 OR TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) {lk} {p} \
                 OR COALESCE(email, '') {lk} {p} \
                 OR COALESCE(phone, '') {lk} {p} \
                 OR COALESCE(ic_number, '') {lk} {p} \
                 OR COALESCE(company_name, '') {lk} {p}) \
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
                    route: "/guest-config".into(),
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
