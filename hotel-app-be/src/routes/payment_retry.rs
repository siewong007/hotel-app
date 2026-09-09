//! Public routes for emailed payment recovery.
//!
//! Unauthenticated by design: the capability in the path is the only authority,
//! and it is scoped to one rejected payment on one booking. These sit under
//! `/booking` alongside the other public booking endpoints rather than under
//! `/guest-portal`, because reaching them must never imply a portal session.

use axum::{
    Router,
    routing::{get, post},
};

use crate::core::db::DbPool;
use crate::handlers::payment_retry;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route(
            "/booking/recover-payment/{token}",
            get(payment_retry::view_recovery_handler),
        )
        .route(
            "/booking/recover-payment/{token}/bank-transfer",
            post(payment_retry::recover_bank_transfer_handler),
        )
        .route(
            "/booking/recover-payment/{token}/paypal/create-order",
            post(payment_retry::recover_paypal_create_order_handler),
        )
        // Capture stays reachable after the capability is spent: the guest has
        // to approve the order in PayPal's window and return, and refusing a
        // consumed link here would strand every authorised order.
        .route(
            "/booking/recover-payment/{token}/paypal/capture",
            post(payment_retry::recover_paypal_capture_handler),
        )
}
