use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::{
    AuditCategoryCounts, AuditLogEntryWithUser, AuditLogQuery, AuditLogResponse, AuditLogRow,
    DbStatementsQuery,
};
use crate::repositories::audit::AuditRepository;
use crate::utils::pagination::normalize_pagination;
use chrono::Utc;
use serde_json::Value;

/// Audit logging service for tracking sensitive operations
pub struct AuditLog;

impl AuditLog {
    /// Log an audit event to the database
    ///
    /// # Arguments
    /// * `pool` - Database connection pool
    /// * `user_id` - ID of user performing the action (None for system actions)
    /// * `action` - Action being performed (e.g., "login_success", "role_assigned")
    /// * `resource_type` - Type of resource affected (e.g., "user", "booking", "room")
    /// * `resource_id` - ID of the resource affected
    /// * `details` - Additional details as JSON
    /// * `ip_address` - IP address of the requester
    /// * `user_agent` - User agent string from the request
    #[allow(clippy::too_many_arguments)]
    pub async fn log_event(
        pool: &DbPool,
        user_id: Option<i64>,
        action: &str,
        resource_type: &str,
        resource_id: Option<i64>,
        details: Option<Value>,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        // Note: The audit_logs table may not exist yet. This is prepared for future migration.
        // If the table doesn't exist, we'll log the error but not fail the operation.

        let result = AuditRepository::insert_event(
            pool,
            user_id,
            action,
            resource_type,
            resource_id,
            details,
            ip_address,
            user_agent,
            Utc::now(),
        )
        .await;

        // Log to console if database insert fails (table might not exist yet)
        if let Err(e) = &result {
            log::warn!(
                "Audit log failed (table may not exist): {} - Action: {}, Resource: {}",
                e,
                action,
                resource_type
            );
        }

        // Return Ok even if insert fails - don't block operations due to audit log issues
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn log_event_tx(
        tx: &mut DbTransaction<'_>,
        user_id: Option<i64>,
        action: &str,
        resource_type: &str,
        resource_id: Option<i64>,
        details: Option<Value>,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        AuditRepository::insert_event_tx(
            tx,
            user_id,
            action,
            resource_type,
            resource_id,
            details,
            ip_address,
            user_agent,
            Utc::now(),
        )
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Log a successful login attempt
    pub async fn log_login_success(
        pool: &DbPool,
        user_id: i64,
        method: &str, // "password", "passkey", "2fa"
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "method": method,
            "success": true
        });

        Self::log_event(
            pool,
            Some(user_id),
            "login_success",
            "user",
            Some(user_id),
            Some(details),
            ip_address,
            user_agent,
        )
        .await
    }

    /// Log a failed login attempt
    pub async fn log_login_failure(
        pool: &DbPool,
        username: &str,
        reason: &str,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "username": username,
            "reason": reason,
            "success": false
        });

        Self::log_event(
            pool,
            None,
            "login_failure",
            "user",
            None,
            Some(details),
            ip_address,
            user_agent,
        )
        .await
    }

    /// Log role assignment
    pub async fn log_role_assignment(
        pool: &DbPool,
        admin_id: i64,
        user_id: i64,
        role_id: i64,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "user_id": user_id,
            "role_id": role_id,
            "assigned_by": admin_id
        });

        Self::log_event(
            pool,
            Some(admin_id),
            "role_assigned",
            "user_role",
            Some(user_id),
            Some(details),
            None,
            None,
        )
        .await
    }

    /// Log role removal
    pub async fn log_role_removal(
        pool: &DbPool,
        admin_id: i64,
        user_id: i64,
        role_id: i64,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "user_id": user_id,
            "role_id": role_id,
            "removed_by": admin_id
        });

        Self::log_event(
            pool,
            Some(admin_id),
            "role_removed",
            "user_role",
            Some(user_id),
            Some(details),
            None,
            None,
        )
        .await
    }

    /// Log booking creation
    pub async fn log_booking_created(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "booking_id": booking_id,
            "guest_id": guest_id,
            "room_id": room_id
        });

        Self::log_event(
            pool,
            Some(user_id),
            "booking_created",
            "booking",
            Some(booking_id),
            Some(details),
            None,
            None,
        )
        .await
    }

    /// Log booking modification
    pub async fn log_booking_updated(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
        changes: Value,
    ) -> Result<(), ApiError> {
        Self::log_event(
            pool,
            Some(user_id),
            "booking_updated",
            "booking",
            Some(booking_id),
            Some(changes),
            None,
            None,
        )
        .await
    }

    /// Log booking cancellation with the legacy audit action name.
    pub async fn log_booking_cancelled(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
    ) -> Result<(), ApiError> {
        Self::log_event(
            pool,
            Some(user_id),
            "booking_cancelled",
            "booking",
            Some(booking_id),
            None,
            None,
            None,
        )
        .await
    }

    /// Log booking voiding with the current audit action name.
    pub async fn log_booking_voided_tx(
        tx: &mut DbTransaction<'_>,
        user_id: i64,
        booking_id: i64,
    ) -> Result<(), ApiError> {
        Self::log_event_tx(
            tx,
            Some(user_id),
            "booking_voided",
            "booking",
            Some(booking_id),
            None,
            None,
            None,
        )
        .await
    }

    /// Log eKYC approval
    pub async fn log_ekyc_approved(
        pool: &DbPool,
        admin_id: i64,
        verification_id: i64,
        guest_id: i64,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "verification_id": verification_id,
            "guest_id": guest_id,
            "approved_by": admin_id
        });

        Self::log_event(
            pool,
            Some(admin_id),
            "ekyc_approved",
            "ekyc_verification",
            Some(verification_id),
            Some(details),
            None,
            None,
        )
        .await
    }

    /// Log eKYC rejection
    pub async fn log_ekyc_rejected(
        pool: &DbPool,
        admin_id: i64,
        verification_id: i64,
        guest_id: i64,
        reason: &str,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "verification_id": verification_id,
            "guest_id": guest_id,
            "rejected_by": admin_id,
            "reason": reason
        });

        Self::log_event(
            pool,
            Some(admin_id),
            "ekyc_rejected",
            "ekyc_verification",
            Some(verification_id),
            Some(details),
            None,
            None,
        )
        .await
    }

    /// Log password change
    pub async fn log_password_changed(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        Self::log_event(
            pool,
            Some(user_id),
            "password_changed",
            "user",
            Some(user_id),
            None,
            None,
            None,
        )
        .await
    }

    /// Log system settings change
    pub async fn log_settings_changed(
        pool: &DbPool,
        admin_id: i64,
        setting_key: &str,
        old_value: Option<&str>,
        new_value: &str,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "key": setting_key,
            "old_value": old_value,
            "new_value": new_value
        });

        Self::log_event(
            pool,
            Some(admin_id),
            "settings_changed",
            "system_setting",
            None,
            Some(details),
            None,
            None,
        )
        .await
    }
}

/// Single source of truth mapping an activity stream to the `resource_type`
/// values that belong to it.
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
    ("guests", &["guest", "guests", "ekyc_verification", "ekyc"]),
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

pub async fn get_audit_logs(
    pool: &DbPool,
    params: AuditLogQuery,
) -> Result<AuditLogResponse, ApiError> {
    let pagination = normalize_pagination(params.page, params.page_size, 25, 100);
    let sort_column = valid_sort_column(params.sort_by.as_deref());
    let sort_direction = sort_direction(params.sort_order.as_deref());
    let category_types = params
        .category
        .as_deref()
        .and_then(resource_types_for_category);

    let (total, rows) = AuditRepository::list_logs(
        pool,
        &params,
        category_types.as_ref(),
        sort_column,
        sort_direction,
        pagination.page_size,
        pagination.offset,
    )
    .await?;

    let total_pages = (total as f64 / pagination.page_size as f64).ceil() as i64;

    Ok(AuditLogResponse {
        data: rows.into_iter().map(row_to_entry).collect(),
        total,
        page: pagination.page,
        page_size: pagination.page_size,
        total_pages,
    })
}

pub async fn get_audit_actions(pool: &DbPool) -> Result<Vec<String>, ApiError> {
    AuditRepository::list_actions(pool).await
}

pub async fn get_audit_resource_types(pool: &DbPool) -> Result<Vec<String>, ApiError> {
    AuditRepository::list_resource_types(pool).await
}

pub async fn export_audit_logs_csv(
    pool: &DbPool,
    params: AuditLogQuery,
) -> Result<(String, String), ApiError> {
    let category_types = params
        .category
        .as_deref()
        .and_then(resource_types_for_category);
    let rows =
        AuditRepository::list_logs_for_export(pool, &params, category_types.as_ref()).await?;

    let mut csv_content = String::from(
        "ID,Timestamp,User ID,Username,Action,Category,Resource Type,Resource ID,IP Address,User Agent,Details\n",
    );

    for row in rows.into_iter().map(row_to_entry) {
        let details_str = row
            .details
            .map(|details| serde_json::to_string(&details).unwrap_or_default())
            .unwrap_or_default()
            .replace("\"", "\"\"");

        csv_content.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},\"{}\"\n",
            row.id,
            row.created_at.to_rfc3339(),
            row.user_id.map(|id| id.to_string()).unwrap_or_default(),
            row.username.unwrap_or_default(),
            row.action,
            row.category,
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

    Ok((filename, csv_content))
}

pub async fn get_audit_users(pool: &DbPool) -> Result<Vec<Value>, ApiError> {
    Ok(AuditRepository::list_users(pool)
        .await?
        .into_iter()
        .map(|user| serde_json::json!({"id": user.id, "username": user.username}))
        .collect())
}

pub async fn get_audit_category_counts(
    pool: &DbPool,
    params: AuditLogQuery,
) -> Result<AuditCategoryCounts, ApiError> {
    let rows = AuditRepository::count_by_resource_type(pool, &params).await?;
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

    Ok(counts)
}

pub async fn get_db_statements(
    pool: &DbPool,
    params: DbStatementsQuery,
) -> Result<Value, ApiError> {
    let limit = params.limit.unwrap_or(20).clamp(1, 200);

    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        let _ = (pool, limit);
        Ok(serde_json::json!({
            "available": false,
            "reason": "pg_stat_statements is PostgreSQL-only; not available in SQLite mode.",
            "statements": [],
        }))
    }

    #[cfg(any(feature = "postgres", not(feature = "sqlite")))]
    {
        match AuditRepository::list_db_statements(pool, limit).await {
            Ok(statements) => Ok(serde_json::json!({
                "available": true,
                "statements": statements,
            })),
            Err(error) => {
                log::warn!("pg_stat_statements unavailable: {error}");
                Ok(serde_json::json!({
                    "available": false,
                    "reason": "pg_stat_statements is not installed or not accessible on this database.",
                    "statements": [],
                }))
            }
        }
    }
}

fn row_to_entry(row: AuditLogRow) -> AuditLogEntryWithUser {
    AuditLogEntryWithUser {
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
    }
}

fn resource_types_for_category(category: &str) -> Option<Vec<String>> {
    CATEGORY_MAP
        .iter()
        .find(|(candidate, _)| *candidate == category)
        .map(|(_, list)| list.iter().map(|value| value.to_string()).collect())
}

fn category_for_resource(resource_type: &str) -> String {
    CATEGORY_MAP
        .iter()
        .find(|(_, list)| list.contains(&resource_type))
        .map(|(category, _)| (*category).to_string())
        .unwrap_or_else(|| "other".to_string())
}

fn valid_sort_column(sort_by: Option<&str>) -> &'static str {
    match sort_by {
        Some("id") => "id",
        Some("created_at") => "created_at",
        Some("action") => "action",
        Some("resource_type") => "resource_type",
        Some("user_id") => "user_id",
        _ => "created_at",
    }
}

fn sort_direction(sort_order: Option<&str>) -> &'static str {
    if sort_order
        .map(|value| value.eq_ignore_ascii_case("asc"))
        .unwrap_or(false)
    {
        "ASC"
    } else {
        "DESC"
    }
}

/// SQL migration for creating the audit_logs table
/// This should be run as a database migration
pub const AUDIT_LOGS_MIGRATION: &str = r#"
-- Migration: Create audit_logs table
-- Run this with: psql $DATABASE_URL < migration.sql

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id BIGINT,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
"#;
