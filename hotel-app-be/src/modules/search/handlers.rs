//! Global federated search handler.

use axum::{
    extract::{Query, State},
    response::Json,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{GlobalSearchQuery, SearchResponse};
use super::service;

/// GET /search?q=&types=&limit=
pub async fn global_search(
    State(pool): State<DbPool>,
    user_id: i64,
    Query(params): Query<GlobalSearchQuery>,
) -> Result<Json<SearchResponse>, ApiError> {
    Ok(Json(
        service::global_search(&pool, user_id, params).await?,
    ))
}
