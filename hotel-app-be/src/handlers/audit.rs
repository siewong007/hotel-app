//! Audit log handlers
//!
//! Handlers for querying and exporting audit logs.

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::Json,
};
use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::require_permission_helper;
use crate::models::{
    AuditCategoryCounts, AuditLogEntryWithUser, AuditLogQuery, AuditLogResponse,
};

/// Single source of truth mapping an activity stream to the `resource_type`
/// values that belong to it. Used both for filtering (category → types) and
/// for tagging each entry (type → category).
const CATEGORY_MAP: &[(&str, &[&str])] = &[
    (
        "rooms",
        &[
            "room",
            "rooms",
            "room_type",
            "room_types",
            "rate",
            "rate_plan",
            "housekeeping",
        ],
    ),
    (
        "guests",
        &["guest", "guests", "ekyc_verification", "ekyc"],
    ),
    ("bookings", &["booking", "bookings"]),
    (
        "system",
        &[
            "user",
            "users",
            "user_role",
            "role",
            "roles",
            "permission",
            "permissions",
            "system_setting",
            "system_settings",
            "settings",
            "system",
        ],
    ),
    (
        "reports",
        &[
            "report",
            "reports",
            "night_audit",
            "reconciliation",
            "export",
        ],
    ),
];

/// Resolve the `resource_type` list for a requested category filter.
fn resource_types_for_category(category: &str) -> Option<Vec<String>> {
    CATEGORY_MAP
        .iter()
        .find(|(c, _)| *c == category)
        .map(|(_, list)| list.iter().map(|s| s.to_string()).collect())
}

/// Tag a `resource_type` with the activity stream it belongs to.
fn category_for_resource(resource_type: &str) -> String {
    CATEGORY_MAP
        .iter()
        .find(|(_, list)| list.contains(&resource_type))
        .map(|(c, _)| (*c).to_string())
        .unwrap_or_else(|| "other".to_string())
}

/// GET /audit-logs
/// Query audit logs with filters and pagination
pub async fn get_audit_logs(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<AuditLogResponse>, ApiError> {
    // Check permission
    require_permission_helper(&pool, &headers, "audit:read").await?;

    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(25).clamp(1, 100);
    let offset = (page - 1) * page_size;

    let sort_by = params.sort_by.as_deref().unwrap_or("created_at");
    let sort_order = params.sort_order.as_deref().unwrap_or("desc");

    // Validate sort column to prevent SQL injection
    let valid_sort_columns = ["id", "created_at", "action", "resource_type", "user_id"];
    let sort_column = if valid_sort_columns.contains(&sort_by) {
        sort_by
    } else {
        "created_at"
    };

    let sort_direction = if sort_order.to_lowercase() == "asc" {
        "ASC"
    } else {
        "DESC"
    };

    // Build dynamic query
    let mut where_clauses: Vec<String> = vec![];
    let mut bind_index = 1;

    if params.user_id.is_some() {
        where_clauses.push(format!("a.user_id = ${}", bind_index));
        bind_index += 1;
    }

    if params.action.is_some() {
        where_clauses.push(format!("a.action = ${}", bind_index));
        bind_index += 1;
    }

    if params.resource_type.is_some() {
        where_clauses.push(format!("a.resource_type = ${}", bind_index));
        bind_index += 1;
    }

    if params.start_date.is_some() {
        where_clauses.push(format!("a.created_at >= ${}::timestamptz", bind_index));
        bind_index += 1;
    }

    if params.end_date.is_some() {
        where_clauses.push(format!("a.created_at <= ${}::timestamptz", bind_index));
        bind_index += 1;
    }

    if params.search.is_some() {
        where_clauses.push(format!(
            "(a.action ILIKE ${0} OR a.resource_type ILIKE ${0} OR u.username ILIKE ${0} OR a.details::text ILIKE ${0})",
            bind_index
        ));
        bind_index += 1;
    }

    // Activity-stream filter: resolve the category to its resource_type set.
    let category_types: Option<Vec<String>> = params
        .category
        .as_deref()
        .and_then(resource_types_for_category);
    if category_types.is_some() {
        where_clauses.push(format!("a.resource_type = ANY(${})", bind_index));
        bind_index += 1;
    }

    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    // Query for total count
    let count_query = format!(
        r#"
        SELECT COUNT(*) as count
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        {}
        "#,
        where_clause
    );

    // Query for data
    let data_query = format!(
        r#"
        SELECT a.id, a.user_id, u.username, a.action, a.resource_type, a.resource_id,
               a.details, a.ip_address, a.user_agent, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        {}
        ORDER BY a.{} {}
        LIMIT ${} OFFSET ${}
        "#,
        where_clause,
        sort_column,
        sort_direction,
        bind_index,
        bind_index + 1
    );

    // Build and execute count query
    let mut count_sqlx = sqlx::query_scalar::<_, i64>(&count_query);
    if let Some(user_id) = params.user_id {
        count_sqlx = count_sqlx.bind(user_id);
    }
    if let Some(ref action) = params.action {
        count_sqlx = count_sqlx.bind(action);
    }
    if let Some(ref resource_type) = params.resource_type {
        count_sqlx = count_sqlx.bind(resource_type);
    }
    if let Some(ref start_date) = params.start_date {
        count_sqlx = count_sqlx.bind(start_date);
    }
    if let Some(ref end_date) = params.end_date {
        count_sqlx = count_sqlx.bind(end_date);
    }
    if let Some(ref search) = params.search {
        count_sqlx = count_sqlx.bind(format!("%{}%", search));
    }
    if let Some(ref types) = category_types {
        count_sqlx = count_sqlx.bind(types.clone());
    }

    let total = count_sqlx
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to count audit logs: {}", e)))?;

    // Build and execute data query
    #[derive(sqlx::FromRow)]
    struct AuditLogRow {
        id: i64,
        user_id: Option<i64>,
        username: Option<String>,
        action: String,
        resource_type: String,
        resource_id: Option<i64>,
        details: Option<Value>,
        ip_address: Option<String>,
        user_agent: Option<String>,
        created_at: DateTime<Utc>,
    }

    let mut data_sqlx = sqlx::query_as::<_, AuditLogRow>(&data_query);
    if let Some(user_id) = params.user_id {
        data_sqlx = data_sqlx.bind(user_id);
    }
    if let Some(ref action) = params.action {
        data_sqlx = data_sqlx.bind(action);
    }
    if let Some(ref resource_type) = params.resource_type {
        data_sqlx = data_sqlx.bind(resource_type);
    }
    if let Some(ref start_date) = params.start_date {
        data_sqlx = data_sqlx.bind(start_date);
    }
    if let Some(ref end_date) = params.end_date {
        data_sqlx = data_sqlx.bind(end_date);
    }
    if let Some(ref search) = params.search {
        data_sqlx = data_sqlx.bind(format!("%{}%", search));
    }
    if let Some(ref types) = category_types {
        data_sqlx = data_sqlx.bind(types.clone());
    }
    data_sqlx = data_sqlx.bind(page_size);
    data_sqlx = data_sqlx.bind(offset);

    let rows = data_sqlx
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch audit logs: {}", e)))?;

    let data: Vec<AuditLogEntryWithUser> = rows
        .into_iter()
        .map(|row| AuditLogEntryWithUser {
            id: row.id,
            user_id: row.user_id,
            username: row.username,
            action: row.action,
            category: category_for_resource(&row.resource_type),
            resource_type: row.resource_type,
            resource_id: row.resource_id,
            details: row.details,
            ip_address: row.ip_address,
            user_agent: row.user_agent,
            created_at: row.created_at,
        })
        .collect();

    let total_pages = (total as f64 / page_size as f64).ceil() as i64;

    Ok(Json(AuditLogResponse {
        data,
        total,
        page,
        page_size,
        total_pages,
    }))
}

/// GET /audit-logs/actions
/// Get distinct action types for filter dropdown
pub async fn get_audit_actions(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;

    let actions =
        sqlx::query_scalar::<_, String>("SELECT DISTINCT action FROM audit_logs ORDER BY action")
            .fetch_all(&pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to fetch actions: {}", e)))?;

    Ok(Json(actions))
}

/// GET /audit-logs/resource-types
/// Get distinct resource types for filter dropdown
pub async fn get_audit_resource_types(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;

    let resource_types = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT resource_type FROM audit_logs ORDER BY resource_type",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch resource types: {}", e)))?;

    Ok(Json(resource_types))
}

/// GET /audit-logs/export/csv
/// Export filtered audit logs as CSV
pub async fn export_audit_logs_csv(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<AuditLogQuery>,
) -> Result<axum::response::Response, ApiError> {
    require_permission_helper(&pool, &headers, "audit:export").await?;

    // Build query similar to get_audit_logs but without pagination
    let mut where_clauses: Vec<String> = vec![];
    let mut bind_index = 1;

    if params.user_id.is_some() {
        where_clauses.push(format!("a.user_id = ${}", bind_index));
        bind_index += 1;
    }

    if params.action.is_some() {
        where_clauses.push(format!("a.action = ${}", bind_index));
        bind_index += 1;
    }

    if params.resource_type.is_some() {
        where_clauses.push(format!("a.resource_type = ${}", bind_index));
        bind_index += 1;
    }

    if params.start_date.is_some() {
        where_clauses.push(format!("a.created_at >= ${}::timestamptz", bind_index));
        bind_index += 1;
    }

    if params.end_date.is_some() {
        where_clauses.push(format!("a.created_at <= ${}::timestamptz", bind_index));
        bind_index += 1;
    }

    if params.search.is_some() {
        where_clauses.push(format!(
            "(a.action ILIKE ${0} OR a.resource_type ILIKE ${0} OR u.username ILIKE ${0})",
            bind_index
        ));
        bind_index += 1;
    }

    let category_types: Option<Vec<String>> = params
        .category
        .as_deref()
        .and_then(resource_types_for_category);
    if category_types.is_some() {
        where_clauses.push(format!("a.resource_type = ANY(${})", bind_index));
        // bind_index is not used after this, but kept for consistency
    }

    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let query = format!(
        r#"
        SELECT a.id, a.user_id, u.username, a.action, a.resource_type, a.resource_id,
               a.details, a.ip_address, a.user_agent, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        {}
        ORDER BY a.created_at DESC
        LIMIT 10000
        "#,
        where_clause
    );

    #[derive(sqlx::FromRow)]
    struct AuditLogRow {
        id: i64,
        user_id: Option<i64>,
        username: Option<String>,
        action: String,
        resource_type: String,
        resource_id: Option<i64>,
        details: Option<Value>,
        ip_address: Option<String>,
        user_agent: Option<String>,
        created_at: DateTime<Utc>,
    }

    let mut data_sqlx = sqlx::query_as::<_, AuditLogRow>(&query);
    if let Some(user_id) = params.user_id {
        data_sqlx = data_sqlx.bind(user_id);
    }
    if let Some(ref action) = params.action {
        data_sqlx = data_sqlx.bind(action);
    }
    if let Some(ref resource_type) = params.resource_type {
        data_sqlx = data_sqlx.bind(resource_type);
    }
    if let Some(ref start_date) = params.start_date {
        data_sqlx = data_sqlx.bind(start_date);
    }
    if let Some(ref end_date) = params.end_date {
        data_sqlx = data_sqlx.bind(end_date);
    }
    if let Some(ref search) = params.search {
        data_sqlx = data_sqlx.bind(format!("%{}%", search));
    }
    if let Some(ref types) = category_types {
        data_sqlx = data_sqlx.bind(types.clone());
    }

    let rows = data_sqlx
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to fetch audit logs: {}", e)))?;

    // Build CSV
    let mut csv_content = String::from(
        "ID,Timestamp,User ID,Username,Action,Category,Resource Type,Resource ID,IP Address,User Agent,Details\n",
    );

    for row in rows {
        let details_str = row
            .details
            .map(|d| serde_json::to_string(&d).unwrap_or_default())
            .unwrap_or_default()
            .replace("\"", "\"\""); // Escape quotes for CSV
        let category = category_for_resource(&row.resource_type);

        csv_content.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},\"{}\"\n",
            row.id,
            row.created_at.to_rfc3339(),
            row.user_id.map(|id| id.to_string()).unwrap_or_default(),
            row.username.unwrap_or_default(),
            row.action,
            category,
            row.resource_type,
            row.resource_id.map(|id| id.to_string()).unwrap_or_default(),
            row.ip_address.unwrap_or_default(),
            row.user_agent
                .as_deref()
                .unwrap_or_default()
                .replace(",", " "),
            details_str
        ));
    }

    let filename = format!("audit_logs_{}.csv", Utc::now().format("%Y%m%d_%H%M%S"));

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
/// Get users who have audit log entries for filter dropdown
pub async fn get_audit_users(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;

    #[derive(sqlx::FromRow)]
    struct UserInfo {
        id: i64,
        username: String,
    }

    let users = sqlx::query_as::<_, UserInfo>(
        r#"
        SELECT DISTINCT u.id, u.username
        FROM users u
        INNER JOIN audit_logs a ON u.id = a.user_id
        ORDER BY u.username
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch users: {}", e)))?;

    let result: Vec<serde_json::Value> = users
        .into_iter()
        .map(|u| serde_json::json!({"id": u.id, "username": u.username}))
        .collect();

    Ok(Json(result))
}

/// GET /audit-logs/category-counts
/// Event counts per activity stream (rooms / guests / bookings / system /
/// reports), honouring the same date-range and search filters as the list so
/// the category rail stays in sync with the active query.
pub async fn get_audit_category_counts(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<AuditCategoryCounts>, ApiError> {
    require_permission_helper(&pool, &headers, "audit:read").await?;

    let mut where_clauses: Vec<String> = vec![];
    let mut bind_index = 1;

    if params.start_date.is_some() {
        where_clauses.push(format!("a.created_at >= ${}::timestamptz", bind_index));
        bind_index += 1;
    }
    if params.end_date.is_some() {
        where_clauses.push(format!("a.created_at <= ${}::timestamptz", bind_index));
        bind_index += 1;
    }
    if params.search.is_some() {
        where_clauses.push(format!(
            "(a.action ILIKE ${0} OR a.resource_type ILIKE ${0} OR u.username ILIKE ${0} OR a.details::text ILIKE ${0})",
            bind_index
        ));
    }

    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let query = format!(
        r#"
        SELECT a.resource_type AS resource_type, COUNT(*) AS count
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        {}
        GROUP BY a.resource_type
        "#,
        where_clause
    );

    #[derive(sqlx::FromRow)]
    struct RtCount {
        resource_type: String,
        count: i64,
    }

    let mut q = sqlx::query_as::<_, RtCount>(&query);
    if let Some(ref start_date) = params.start_date {
        q = q.bind(start_date);
    }
    if let Some(ref end_date) = params.end_date {
        q = q.bind(end_date);
    }
    if let Some(ref search) = params.search {
        q = q.bind(format!("%{}%", search));
    }

    let rows = q
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to count audit categories: {}", e)))?;

    let mut counts = AuditCategoryCounts::default();
    for row in rows {
        counts.total += row.count;
        match category_for_resource(&row.resource_type).as_str() {
            "rooms" => counts.rooms += row.count,
            "guests" => counts.guests += row.count,
            "bookings" => counts.bookings += row.count,
            "system" => counts.system += row.count,
            "reports" => counts.reports += row.count,
            _ => counts.other += row.count,
        }
    }

    Ok(Json(counts))
}
