//! Global search route.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models;
use axum::{
    Router,
    extract::{Query, State},
    http::HeaderMap,
    response::Json,
    routing::get,
};

use crate::handlers::search;

/// Create search routes
pub fn routes() -> Router<DbPool> {
    Router::new().route("/search", get(global_search))
}

async fn global_search(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::GlobalSearchQuery>,
) -> Result<Json<models::SearchResponse>, ApiError> {
    let user_id = require_auth(&headers).await?;
    search::global_search(State(pool), user_id, query).await
}
