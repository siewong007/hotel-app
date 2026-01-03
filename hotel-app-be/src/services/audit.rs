use sqlx::PgPool;
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
    pub async fn log_event(
        pool: &PgPool,
        user_id: Option<i64>,
        action: &str,
        resource_type: &str,
        resource_id: Option<i64>,
        details: Option<Value>,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), sqlx::Error> {
        // Note: The audit_logs table may not exist yet. This is prepared for future migration.
        // If the table doesn't exist, we'll log the error but not fail the operation.

        let result = sqlx::query(
            r#"
            INSERT INTO audit_logs
            (user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at)
            VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8)
            "#
        )
        .bind(user_id)
        .bind(action)
        .bind(resource_type)
        .bind(resource_id)
        .bind(details)
        .bind(ip_address)
        .bind(user_agent)
        .bind(Utc::now())
        .execute(pool)
        .await;

        // Log to console if database insert fails (table might not exist yet)
        if let Err(e) = &result {
            log::warn!("Audit log failed (table may not exist): {} - Action: {}, Resource: {}", e, action, resource_type);
        }

        // Return Ok even if insert fails - don't block operations due to audit log issues
        Ok(())
    }

    /// Log a successful login attempt
    pub async fn log_login_success(
        pool: &PgPool,
        user_id: i64,
        method: &str, // "password", "passkey", "2fa"
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log a failed login attempt
    pub async fn log_login_failure(
        pool: &PgPool,
        username: &str,
        reason: &str,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log role assignment
    pub async fn log_role_assignment(
        pool: &PgPool,
        admin_id: i64,
        user_id: i64,
        role_id: i64,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log role removal
    pub async fn log_role_removal(
        pool: &PgPool,
        admin_id: i64,
        user_id: i64,
        role_id: i64,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log booking creation
    pub async fn log_booking_created(
        pool: &PgPool,
        user_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log booking modification
    pub async fn log_booking_updated(
        pool: &PgPool,
        user_id: i64,
        booking_id: i64,
        changes: Value,
    ) -> Result<(), sqlx::Error> {
        Self::log_event(
            pool,
            Some(user_id),
            "booking_updated",
            "booking",
            Some(booking_id),
            Some(changes),
            None,
            None,
        ).await
    }

    /// Log booking cancellation
    pub async fn log_booking_cancelled(
        pool: &PgPool,
        user_id: i64,
        booking_id: i64,
    ) -> Result<(), sqlx::Error> {
        Self::log_event(
            pool,
            Some(user_id),
            "booking_cancelled",
            "booking",
            Some(booking_id),
            None,
            None,
            None,
        ).await
    }

    /// Log eKYC approval
    pub async fn log_ekyc_approved(
        pool: &PgPool,
        admin_id: i64,
        verification_id: i64,
        guest_id: i64,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log eKYC rejection
    pub async fn log_ekyc_rejected(
        pool: &PgPool,
        admin_id: i64,
        verification_id: i64,
        guest_id: i64,
        reason: &str,
    ) -> Result<(), sqlx::Error> {
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
        ).await
    }

    /// Log password change
    pub async fn log_password_changed(
        pool: &PgPool,
        user_id: i64,
    ) -> Result<(), sqlx::Error> {
        Self::log_event(
            pool,
            Some(user_id),
            "password_changed",
            "user",
            Some(user_id),
            None,
            None,
            None,
        ).await
    }

    /// Log system settings change
    pub async fn log_settings_changed(
        pool: &PgPool,
        admin_id: i64,
        setting_key: &str,
        old_value: Option<&str>,
        new_value: &str,
    ) -> Result<(), sqlx::Error> {
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
        ).await
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
