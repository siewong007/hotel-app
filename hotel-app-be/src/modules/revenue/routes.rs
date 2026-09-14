use axum::{Router, routing::get};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/revenue/overview", get(handlers::overview))
        .route("/revenue/receivables", get(handlers::receivables))
        .route("/revenue/rate-calendar", get(handlers::rate_calendar))
}
