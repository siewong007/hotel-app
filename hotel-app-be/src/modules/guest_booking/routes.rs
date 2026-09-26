use axum::{
    Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
};

use super::handlers;
use crate::core::db::DbPool;

pub fn routes() -> Router<DbPool> {
    Router::new()
        // Public booking: no account, no token. Priced at list rates — an
        // anonymous booking never carries a voucher, complimentary-night
        // credits or loyalty, all of which belong to an account. Each is rate
        // limited by origin IP inside the handler, the only identity available.
        .route("/booking/offers", get(handlers::public_search_handler))
        .route(
            "/booking/room-types",
            get(handlers::public_room_types_handler),
        )
        .route("/booking/quote", post(handlers::public_quote_handler))
        .route(
            "/booking/reservations",
            post(handlers::public_create_booking_handler),
        )
        .route(
            "/guest-portal/me/booking-options",
            get(handlers::search_handler),
        )
        .route(
            "/guest-portal/me/booking-quote",
            post(handlers::quote_handler),
        )
        .route(
            "/guest-portal/me/booking-voucher-options",
            post(handlers::quote_with_eligible_vouchers_handler),
        )
        .route(
            "/guest-portal/me/availability",
            get(handlers::availability_socket_handler),
        )
        .route("/admin/online-inventory", get(list_online_inventory))
        .route(
            "/admin/online-inventory/bulk",
            put(bulk_update_online_inventory),
        )
        .route(
            "/admin/online-inventory/{room_type_id}/{stay_date}",
            put(update_online_inventory),
        )
}

/// Changing online inventory — online sales, walk-in holds and guest-facing
/// custom prices — is limited to roles granted this permission (admin and
/// manager by default). Viewing stays on `rooms:update`, so front-desk and
/// housekeeping staff keep a read-only view.
pub const ONLINE_INVENTORY_MANAGE: &str = "online_inventory:manage";

async fn list_online_inventory(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    query: Query<super::models::OnlineInventoryQuery>,
) -> Result<axum::Json<Vec<super::models::OnlineInventoryAllocation>>, crate::core::error::ApiError>
{
    crate::core::middleware::require_any_permission_helper(
        &pool,
        &headers,
        &["rooms:update", ONLINE_INVENTORY_MANAGE],
    )
    .await?;
    handlers::list_online_inventory_handler(State(pool), query).await
}

async fn update_online_inventory(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    axum::extract::Extension(hub): axum::extract::Extension<
        crate::modules::guest_booking::availability::AvailabilityHub,
    >,
    Path(path): Path<(i64, String)>,
    axum::Json(request): axum::Json<super::models::UpdateOnlineInventoryRequest>,
) -> Result<axum::Json<super::models::OnlineInventoryAllocation>, crate::core::error::ApiError> {
    let actor_id = crate::core::middleware::require_permission_helper(
        &pool,
        &headers,
        ONLINE_INVENTORY_MANAGE,
    )
    .await?;
    handlers::update_online_inventory_handler(
        State(pool),
        axum::Extension(actor_id),
        axum::Extension(hub),
        Path(path),
        axum::Json(request),
    )
    .await
}

async fn bulk_update_online_inventory(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    axum::extract::Extension(hub): axum::extract::Extension<
        crate::modules::guest_booking::availability::AvailabilityHub,
    >,
    axum::Json(request): axum::Json<super::models::BulkUpdateOnlineInventoryRequest>,
) -> Result<axum::Json<Vec<super::models::OnlineInventoryAllocation>>, crate::core::error::ApiError>
{
    let actor_id = crate::core::middleware::require_permission_helper(
        &pool,
        &headers,
        ONLINE_INVENTORY_MANAGE,
    )
    .await?;
    handlers::bulk_update_online_inventory_handler(
        State(pool),
        axum::Extension(actor_id),
        axum::Extension(hub),
        axum::Json(request),
    )
    .await
}
