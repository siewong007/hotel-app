//! Company routes

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{delete, get, post, put},
};

const COMPANIES_READ: &str = "companies:read";
const COMPANIES_CREATE: &str = "companies:create";
const COMPANIES_UPDATE: &str = "companies:update";
const COMPANIES_DELETE: &str = "companies:delete";

/// Create company routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/companies", get(list_companies))
        .route("/companies", post(create_company))
        .route("/companies/{id}", get(get_company))
        .route("/companies/{id}", put(update_company))
        .route("/companies/{id}", delete(delete_company))
}

async fn list_companies(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::CompanyListQuery>,
) -> Result<Json<Vec<models::Company>>, ApiError> {
    require_permission_helper(&pool, &headers, COMPANIES_READ).await?;
    handlers::companies::list_companies_handler(State(pool), query).await
}

async fn get_company(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<models::Company>, ApiError> {
    require_permission_helper(&pool, &headers, COMPANIES_READ).await?;
    handlers::companies::get_company_handler(State(pool), path).await
}

async fn create_company(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(input): Json<models::CompanyCreateRequest>,
) -> Result<Json<models::Company>, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, COMPANIES_CREATE).await?;
    handlers::companies::create_company_handler(State(pool), user_id, Json(input)).await
}

async fn update_company(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
    Json(input): Json<models::CompanyUpdateRequest>,
) -> Result<Json<models::Company>, ApiError> {
    require_permission_helper(&pool, &headers, COMPANIES_UPDATE).await?;
    handlers::companies::update_company_handler(State(pool), path, Json(input)).await
}

async fn delete_company(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    path: Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, COMPANIES_DELETE).await?;
    handlers::companies::delete_company_handler(State(pool), path).await
}
