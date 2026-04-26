//! Audit log routes
//!
//! Routes for querying and exporting audit logs.

use crate::core::db::DbPool;
use axum::{Router, routing::get};

use crate::handlers::audit;

/// Create audit routes
pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/audit-logs", get(audit::get_audit_logs))
        .route("/audit-logs/actions", get(audit::get_audit_actions))
        .route(
            "/audit-logs/resource-types",
            get(audit::get_audit_resource_types),
        )
        .route("/audit-logs/users", get(audit::get_audit_users))
        .route("/audit-logs/export/csv", get(audit::export_audit_logs_csv))
}
