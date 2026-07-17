//! Route registration for guest support.

use axum::{
    Router,
    routing::{get, post},
};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route(
            "/support/conversations",
            get(handlers::list_staff_conversations_handler),
        )
        .route(
            "/support/agents",
            get(handlers::list_support_agents_handler),
        )
        .route(
            "/support/conversations/{id}",
            get(handlers::get_staff_conversation_handler),
        )
        .route(
            "/support/conversations/{id}/messages",
            post(handlers::send_staff_message_handler),
        )
        .route(
            "/support/conversations/{id}/actions",
            post(handlers::apply_staff_action_handler),
        )
        .route(
            "/guest-portal/me/support/conversations",
            get(handlers::list_guest_conversations_handler)
                .post(handlers::create_guest_conversation_handler),
        )
        .route(
            "/guest-portal/me/support/conversations/{id}",
            get(handlers::get_guest_conversation_handler),
        )
        .route(
            "/guest-portal/me/support/conversations/{id}/messages",
            post(handlers::send_guest_message_handler),
        )
        .route(
            "/guest-portal/me/support/conversations/{id}/reopen",
            post(handlers::reopen_guest_conversation_handler),
        )
        .route(
            "/guest-portal/me/support/socket",
            get(handlers::guest_support_socket_handler),
        )
}
