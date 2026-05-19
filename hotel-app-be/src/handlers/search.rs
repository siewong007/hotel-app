//! Global federated search (P2): bookings, guests, rooms.
//!
//! One permission-scoped endpoint that powers the header command bar.
//! Each domain is only queried if the caller holds its `:read` (or
//! `:manage`) permission, so results never leak past RBAC.

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::Json,
};
use serde::{Deserialize, Serialize};

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    /// Comma-separated domain filter: `bookings,guests,rooms`. Empty = all.
    pub types: Option<String>,
    /// Max results per group.
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub id: i64,
    pub title: String,
    pub subtitle: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
pub struct SearchGroup {
    /// Stable key: `bookings` | `guests` | `rooms`.
    pub r#type: String,
    pub label: String,
    pub results: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub groups: Vec<SearchGroup>,
}

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

/// GET /search?q=&types=&limit=
pub async fn global_search(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<SearchQuery>,
) -> Result<Json<SearchResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;

    let q = params.q.unwrap_or_default().trim().to_string();
    if q.len() < 2 {
        return Ok(Json(SearchResponse { query: q, groups: vec![] }));
    }

    let limit = params.limit.unwrap_or(6).clamp(1, 15);
    let want: Vec<String> = params
        .types
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.split(',').map(|t| t.trim().to_lowercase()).collect())
        .unwrap_or_default();
    let wants = |t: &str| want.is_empty() || want.iter().any(|w| w == t);

    let can = |perm: &'static str| {
        let pool = pool.clone();
        async move {
            AuthService::check_permission(&pool, user_id, perm)
                .await
                .unwrap_or(false)
        }
    };

    let pattern = format!("%{}%", q);
    let lk = like_op();
    let (p, plim) = placeholders();
    let mut groups: Vec<SearchGroup> = Vec::new();

    // ---------------- Bookings ----------------
    if wants("bookings") && can("bookings:read").await {
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
            .bind(&pattern)
            .bind(limit)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        if !rows.is_empty() {
            groups.push(SearchGroup {
                r#type: "bookings".into(),
                label: "Bookings".into(),
                results: rows
                    .into_iter()
                    .map(|r| {
                        let mut sub = String::new();
                        if !r.guest_name.is_empty() {
                            sub.push_str(&r.guest_name);
                        }
                        if !r.room_number.is_empty() {
                            if !sub.is_empty() {
                                sub.push_str(" · ");
                            }
                            sub.push_str(&format!("Room {}", r.room_number));
                        }
                        if !sub.is_empty() {
                            sub.push_str(" · ");
                        }
                        sub.push_str(&r.status.replace('_', " "));
                        SearchHit {
                            id: r.id,
                            title: r.booking_number,
                            subtitle: sub,
                            route: "/bookings".into(),
                        }
                    })
                    .collect(),
            });
        }
    }

    // ---------------- Guests ----------------
    if wants("guests") && can("guests:read").await {
        let sql = format!(
            "SELECT id AS id, full_name AS full_name, \
                    COALESCE(phone, '') AS phone, COALESCE(email, '') AS email, \
                    COALESCE(company_name, '') AS company_name \
             FROM guests \
             WHERE deleted_at IS NULL AND ( \
                 full_name {lk} {p} OR email {lk} {p} OR phone {lk} {p} \
                 OR company_name {lk} {p}) \
             ORDER BY full_name LIMIT {plim}"
        );
        #[derive(sqlx::FromRow)]
        struct Row {
            id: i64,
            full_name: String,
            phone: String,
            email: String,
            company_name: String,
        }
        let rows = sqlx::query_as::<_, Row>(&sql)
            .bind(&pattern)
            .bind(limit)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        if !rows.is_empty() {
            groups.push(SearchGroup {
                r#type: "guests".into(),
                label: "Guests".into(),
                results: rows
                    .into_iter()
                    .map(|r| {
                        let sub = [r.phone, r.email, r.company_name]
                            .into_iter()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(" · ");
                        SearchHit {
                            id: r.id,
                            title: r.full_name,
                            subtitle: sub,
                            route: "/guest-config".into(),
                        }
                    })
                    .collect(),
            });
        }
    }

    // ---------------- Rooms ----------------
    if wants("rooms") && can("rooms:read").await {
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
            .bind(&pattern)
            .bind(limit)
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;
        if !rows.is_empty() {
            groups.push(SearchGroup {
                r#type: "rooms".into(),
                label: "Rooms".into(),
                results: rows
                    .into_iter()
                    .map(|r| {
                        let mut sub = r.room_type;
                        if !r.status.is_empty() {
                            sub.push_str(&format!(" · {}", r.status.replace('_', " ")));
                        }
                        SearchHit {
                            id: r.id,
                            title: format!("Room {}", r.room_number),
                            subtitle: sub,
                            route: "/room-management".into(),
                        }
                    })
                    .collect(),
            });
        }
    }

    Ok(Json(SearchResponse { query: q, groups }))
}
