//! Audit log handlers
//!
//! Handlers for querying and exporting audit logs.

use axum::{
    extract::{Extension, Query, State},
    response::Json,
};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{AuditCategoryCounts, AuditLogQuery, AuditLogResponse, DbStatementsQuery};
use crate::services::audit as audit_service;

/// GET /audit-logs
pub async fn get_audit_logs(
    State(pool): State<DbPool>,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<AuditLogResponse>, ApiError> {
    Ok(Json(audit_service::get_audit_logs(&pool, params).await?))
}

/// GET /audit-logs/actions
pub async fn get_audit_actions(State(pool): State<DbPool>) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(audit_service::get_audit_actions(&pool).await?))
}

/// GET /audit-logs/resource-types
pub async fn get_audit_resource_types(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(audit_service::get_audit_resource_types(&pool).await?))
}

/// GET /audit-logs/export/csv
pub async fn export_audit_logs_csv(
    State(pool): State<DbPool>,
    Extension(user_id): Extension<i64>,
    Query(params): Query<AuditLogQuery>,
) -> Result<axum::response::Response, ApiError> {
    let (filename, csv_content) =
        audit_service::export_audit_logs_csv(&pool, user_id, params).await?;

    Ok(axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(axum::body::Body::from(csv_content))
        .unwrap())
}

/// GET /audit-logs/users
pub async fn get_audit_users(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    Ok(Json(audit_service::get_audit_users(&pool).await?))
}

/// GET /audit-logs/category-counts
pub async fn get_audit_category_counts(
    State(pool): State<DbPool>,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<AuditCategoryCounts>, ApiError> {
    Ok(Json(
        audit_service::get_audit_category_counts(&pool, params).await?,
    ))
}

/// Admin-only `pg_stat_statements` snapshot.
pub async fn get_db_statements(
    State(pool): State<DbPool>,
    Query(params): Query<DbStatementsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(audit_service::get_db_statements(&pool, params).await?))
}
