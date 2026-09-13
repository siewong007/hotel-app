//! Route registration for the guest-segments admin surface.

use axum::{
    Router,
    routing::{get, post},
};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        // Static routes before the `{id}` parameter route.
        .route(
            "/admin/segments",
            get(handlers::list_segments_handler).post(handlers::create_segment_handler),
        )
        .route(
            "/admin/segments/field-options",
            get(handlers::field_options_handler),
        )
        .route(
            "/admin/segments/preview",
            post(handlers::preview_rules_handler),
        )
        .route(
            "/admin/segments/{id}",
            get(handlers::get_segment_handler)
                .put(handlers::update_segment_handler)
                .delete(handlers::delete_segment_handler),
        )
        .route(
            "/admin/segments/{id}/preview",
            get(handlers::preview_segment_handler),
        )
}
