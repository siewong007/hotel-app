//! Route registration for the Guest Relations workspace.
//!
//! All routes hang under `/guests/{id}` (the `{id}` name matches the existing
//! `routes/guests.rs` tree so the merged router stays consistent). The spec's
//! original `/notes` path segment is superseded by `/interactions` — do not
//! register both.
//!
//! | Route | Permission |
//! |---|---|
//! | `GET /guests/{id}/interactions` | `guests:read` |
//! | `POST /guests/{id}/interactions` | `guests:update` |
//! | `PATCH /guests/{id}/interactions/{nid}` | `guests:update` (+ author-or-`guests:manage` for private rows) |
//! | `DELETE /guests/{id}/interactions/{nid}` | `guests:update` (+ same private rule) |
//! | `GET /guests/{id}/preferences` | `guests:read` |
//! | `PUT /guests/{id}/preferences` | `guests:update` |
//! | `GET /guests/{id}/reviews` | `reviews:read` |
//! | `POST /guests/{id}/reviews/{rid}/response` | `reviews:update` |
//! | `GET /guests/{id}/loyalty` | `guests:read` |
//! | `GET /guests/{id}/vouchers` | `guests:read` |
//! | `GET /guests/{id}/communications` | `communications:read` |
//! | `GET /guests/{id}/support` | `support:read` |

use axum::{
    Router,
    routing::{get, patch, post},
};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route(
            "/guests/{id}/interactions",
            get(handlers::list_interactions_handler).post(handlers::create_interaction_handler),
        )
        .route(
            "/guests/{id}/interactions/{nid}",
            patch(handlers::update_interaction_handler)
                .delete(handlers::delete_interaction_handler),
        )
        .route(
            "/guests/{id}/preferences",
            get(handlers::list_preferences_handler).put(handlers::put_preferences_handler),
        )
        .route("/guests/{id}/reviews", get(handlers::list_reviews_handler))
        .route(
            "/guests/{id}/reviews/{rid}/response",
            post(handlers::respond_to_review_handler),
        )
        .route("/guests/{id}/loyalty", get(handlers::loyalty_summary_handler))
        .route("/guests/{id}/vouchers", get(handlers::list_vouchers_handler))
        .route(
            "/guests/{id}/communications",
            get(handlers::communications_summary_handler),
        )
        .route(
            "/guests/{id}/support",
            get(handlers::list_support_conversations_handler),
        )
}
