//! Public routes for emailed payment recovery.
//!
//! Unauthenticated by design: the capability in the path is the only authority,
//! and it is scoped to one rejected payment on one booking. These sit under
//! `/booking` alongside the other public booking endpoints rather than under
//! `/guest-portal`, because reaching them must never imply a portal session.

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{get, post},
};

use super::handlers;
use crate::core::db::DbPool;

/// Matches the guest-portal receipt limit; `save_payment_receipt` enforces the
/// same ceiling again, so this only stops a large body being buffered at all.
const UPLOAD_BODY_LIMIT: usize = 10 * 1024 * 1024;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route(
            "/booking/recover-payment/{token}",
            get(handlers::view_recovery_handler),
        )
        .route(
            "/booking/recover-payment/{token}/bank-transfer",
            post(handlers::recover_bank_transfer_handler),
        )
        .route(
            "/booking/recover-payment/{token}/paypal/create-order",
            post(handlers::recover_paypal_create_order_handler),
        )
        // Capture stays reachable after the capability is spent: the guest has
        // to approve the order in PayPal's window and return, and refusing a
        // consumed link here would strand every authorised order.
        .route(
            "/booking/recover-payment/{token}/paypal/capture",
            post(handlers::recover_paypal_capture_handler),
        )
        .route(
            "/booking/recover-payment/{token}/payments/{payment_id}/receipt",
            post(handlers::recover_upload_receipt_handler)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
}
