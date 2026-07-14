use axum::{
    Router,
    routing::{get, post, put},
};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/promotions", get(handlers::list_public_promotions_handler))
        .route(
            "/promotions/{slug}",
            get(handlers::get_public_promotion_handler),
        )
        .route(
            "/guest-portal/me/promotions",
            get(handlers::list_guest_promotions_handler),
        )
        .route(
            "/guest-portal/me/promotions/{id}/claim",
            post(handlers::claim_guest_promotion_handler),
        )
        .route(
            "/guest-portal/me/vouchers",
            get(handlers::list_guest_vouchers_handler),
        )
        .route(
            "/admin/promotions",
            get(handlers::list_admin_promotions_handler)
                .post(handlers::create_admin_promotion_handler),
        )
        .route(
            "/admin/promotions/{id}",
            get(handlers::get_admin_promotion_handler)
                .put(handlers::update_admin_promotion_handler),
        )
        .route(
            "/admin/promotions/{id}/publish",
            post(handlers::publish_admin_promotion_handler),
        )
        .route(
            "/admin/promotions/{id}/pause",
            post(handlers::pause_admin_promotion_handler),
        )
        .route(
            "/admin/promotions/{id}/archive",
            post(handlers::archive_admin_promotion_handler),
        )
        .route(
            "/admin/vouchers",
            get(handlers::list_admin_vouchers_handler)
                .post(handlers::issue_admin_voucher_handler),
        )
        .route(
            "/admin/vouchers/{id}/revoke",
            post(handlers::revoke_admin_voucher_handler),
        )
}
