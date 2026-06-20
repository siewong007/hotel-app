//! Audit log routes
//!
//! Routes for querying and exporting audit logs.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::models;
use axum::{
    Router,
    extract::{Extension, Query, State},
    http::HeaderMap,
    response::Json,
    routing::get,
};

use crate::handlers::audit;

/// Create audit routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/audit-logs", get(get_audit_logs))
        .route("/audit-logs/actions", get(get_audit_actions))
        .route("/audit-logs/resource-types", get(get_audit_resource_types))
        .route("/audit-logs/users", get(get_audit_users))
        .route(
            "/audit-logs/category-counts",
            get(get_audit_category_counts),
        )
        .route("/audit-logs/export/csv", get(export_audit_logs_csv))
        .route("/audit-logs/db-statements", get(get_db_statements))
}

async fn get_audit_logs(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::AuditLogQuery>,
) -> Result<Json<models::AuditLogResponse>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;
    audit::get_audit_logs(State(pool), query).await
}

async fn get_audit_actions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;
    audit::get_audit_actions(State(pool)).await
}

async fn get_audit_resource_types(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;
    audit::get_audit_resource_types(State(pool)).await
}

async fn get_audit_users(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;
    audit::get_audit_users(State(pool)).await
}

async fn get_audit_category_counts(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::AuditLogQuery>,
) -> Result<Json<models::AuditCategoryCounts>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;
    audit::get_audit_category_counts(State(pool), query).await
}

async fn export_audit_logs_csv(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::AuditLogQuery>,
) -> Result<axum::response::Response, ApiError> {
    let user_id = require_permission_helper(&pool, &headers, "audit:export").await?;
    audit::export_audit_logs_csv(State(pool), Extension(user_id), query).await
}

async fn get_db_statements(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<models::DbStatementsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;
    audit::get_db_statements(State(pool), query).await
}
