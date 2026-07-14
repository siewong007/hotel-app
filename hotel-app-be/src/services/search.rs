//! Global search workflow

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{GlobalSearchQuery, SearchGroup, SearchResponse};
use crate::repositories::search::SearchRepository;

pub async fn global_search(
    pool: &DbPool,
    user_id: i64,
    params: GlobalSearchQuery,
) -> Result<SearchResponse, ApiError> {
    if AuthService::check_role(pool, user_id, "guest").await? {
        return Err(ApiError::Forbidden(
            "Global search is not available to guest accounts".to_string(),
        ));
    }

    let query = params.q.unwrap_or_default().trim().to_string();
    if query.len() < 2 {
        return Ok(SearchResponse {
            query,
            groups: Vec::new(),
        });
    }

    let limit = params.limit.unwrap_or(6).clamp(1, 15);
    let wanted_types: Vec<String> = params
        .types
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            value
                .split(',')
                .map(|item| item.trim().to_lowercase())
                .collect()
        })
        .unwrap_or_default();

    let pattern = format!("%{}%", query);
    let mut groups = Vec::new();

    if wants_type(&wanted_types, "bookings") && can_read(pool, user_id, "bookings:read").await {
        let results = SearchRepository::search_bookings(pool, &pattern, limit).await?;
        if !results.is_empty() {
            groups.push(SearchGroup {
                r#type: "bookings".into(),
                label: "Bookings".into(),
                results,
            });
        }
    }

    if wants_type(&wanted_types, "guests") && can_read(pool, user_id, "guests:read").await {
        let results = SearchRepository::search_guests(pool, &pattern, limit).await?;
        if !results.is_empty() {
            groups.push(SearchGroup {
                r#type: "guests".into(),
                label: "Guests".into(),
                results,
            });
        }
    }

    if wants_type(&wanted_types, "ledgers") && can_read(pool, user_id, "ledgers:read").await {
        let results = SearchRepository::search_ledgers(pool, &pattern, limit).await?;
        if !results.is_empty() {
            groups.push(SearchGroup {
                r#type: "ledgers".into(),
                label: "Ledger".into(),
                results,
            });
        }
    }

    if wants_type(&wanted_types, "rooms") && can_read(pool, user_id, "rooms:read").await {
        let results = SearchRepository::search_rooms(pool, &pattern, limit).await?;
        if !results.is_empty() {
            groups.push(SearchGroup {
                r#type: "rooms".into(),
                label: "Rooms".into(),
                results,
            });
        }
    }

    Ok(SearchResponse { query, groups })
}

fn wants_type(wanted_types: &[String], value: &str) -> bool {
    wanted_types.is_empty() || wanted_types.iter().any(|wanted| wanted == value)
}

async fn can_read(pool: &DbPool, user_id: i64, permission: &'static str) -> bool {
    AuthService::check_permission(pool, user_id, permission)
        .await
        .unwrap_or(false)
}
