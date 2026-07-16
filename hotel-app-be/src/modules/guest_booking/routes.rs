use axum::{
    Router,
    routing::{get, post},
};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route(
            "/guest-portal/me/booking-options",
            get(handlers::search_handler),
        )
        .route(
            "/guest-portal/me/booking-quote",
            post(handlers::quote_handler),
        )
        .route(
            "/guest-portal/me/availability",
            get(handlers::availability_socket_handler),
        )
}
