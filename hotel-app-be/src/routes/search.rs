//! Global search route.

use crate::core::db::DbPool;
use axum::{Router, routing::get};

use crate::handlers::search;

/// Create search routes
pub fn routes() -> Router<DbPool> {
    Router::new().route("/search", get(search::global_search))
}
