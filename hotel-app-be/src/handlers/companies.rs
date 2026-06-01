//! Company handlers
//!
//! Handles company CRUD operations for direct billing.

use axum::{
    Json,
    extract::{Path, Query, State},
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Company, CompanyCreateRequest, CompanyListQuery, CompanyUpdateRequest};
use crate::services::companies as company_service;

/// List all companies with optional filters
pub async fn list_companies_handler(
    State(pool): State<DbPool>,
    Query(query): Query<CompanyListQuery>,
) -> Result<Json<Vec<Company>>, ApiError> {
    Ok(Json(company_service::list_companies(&pool, &query).await?))
}

/// Get a single company by ID
pub async fn get_company_handler(
    State(pool): State<DbPool>,
    Path(company_id): Path<i64>,
) -> Result<Json<Company>, ApiError> {
    Ok(Json(company_service::get_company(&pool, company_id).await?))
}

/// Create a new company
pub async fn create_company_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(input): Json<CompanyCreateRequest>,
) -> Result<Json<Company>, ApiError> {
    Ok(Json(
        company_service::create_company(&pool, input, user_id).await?,
    ))
}

/// Update a company
pub async fn update_company_handler(
    State(pool): State<DbPool>,
    Path(company_id): Path<i64>,
    Json(input): Json<CompanyUpdateRequest>,
) -> Result<Json<Company>, ApiError> {
    Ok(Json(
        company_service::update_company(&pool, company_id, input).await?,
    ))
}

/// Delete a company
pub async fn delete_company_handler(
    State(pool): State<DbPool>,
    Path(company_id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    company_service::delete_company(&pool, company_id).await?;

    Ok(Json(serde_json::json!({
        "message": "Company deleted successfully"
    })))
}
