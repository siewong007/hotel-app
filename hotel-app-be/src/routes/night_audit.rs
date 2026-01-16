//! Night audit routes

use axum::{
    routing::{get, post},
    Router,
};
use crate::core::db::DbPool;

use crate::handlers::night_audit;

pub fn routes() -> Router<DbPool> {
    Router::new()
        // Night audit endpoints
        .route("/night-audit/preview", get(night_audit::get_night_audit_preview))
        .route("/night-audit/run", post(night_audit::run_night_audit))
        .route("/night-audit", get(night_audit::list_night_audits))
        .route("/night-audit/:id", get(night_audit::get_night_audit))
        .route("/night-audit/:id/details", get(night_audit::get_night_audit_details))
        .route("/bookings/:id/posted", get(night_audit::is_booking_posted))
}
