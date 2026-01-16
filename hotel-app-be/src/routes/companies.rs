//! Company routes

use axum::{
    routing::{get, post, put, delete},
    Router,
};
use crate::core::db::DbPool;

use crate::handlers::companies::*;

/// Create company routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/companies", get(list_companies_handler))
        .route("/companies", post(create_company_handler))
        .route("/companies/:id", get(get_company_handler))
        .route("/companies/:id", put(update_company_handler))
        .route("/companies/:id", delete(delete_company_handler))
}
