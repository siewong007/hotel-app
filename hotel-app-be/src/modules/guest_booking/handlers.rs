use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, Extension, Query, State, WebSocketUpgrade},
    http::HeaderMap,
    response::Response,
};

use super::availability::{AvailabilityHub, serve_socket};
use super::models::{
    BookingQuoteRequest, BookingSearchQuery, CreateGuestBookingRequest, GuestBookingConfirmation,
    GuestBookingOffer, GuestBookingQuote, GuestBookingVoucherOptions, OnlineInventoryAllocation,
    OnlineInventoryQuery, UpdateOnlineInventoryRequest,
};
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::services::guest_portal;

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

async fn require_read_capacity(limiters: &RateLimiters, guest_id: i64) -> Result<(), ApiError> {
    let (allowed, retry_after) = limiters
        .guest_portal_token_read
        .check_with_retry(format!("guest:{guest_id}"))
        .await;
    if allowed {
        Ok(())
    } else {
        Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many portal requests. Please try again in {retry_after} seconds."),
            retry_after,
        ))
    }
}

pub async fn search_handler(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Query(query): Query<BookingSearchQuery>,
) -> Result<Json<Vec<GuestBookingOffer>>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    require_read_capacity(&limiters, guest_id).await?;
    Ok(Json(service::search(&pool, guest_id, query).await?))
}

pub async fn quote_handler(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(request): Json<BookingQuoteRequest>,
) -> Result<Json<GuestBookingQuote>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    require_read_capacity(&limiters, guest_id).await?;
    Ok(Json(service::quote(&pool, guest_id, request).await?))
}

pub async fn quote_with_eligible_vouchers_handler(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(request): Json<BookingQuoteRequest>,
) -> Result<Json<GuestBookingVoucherOptions>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    require_read_capacity(&limiters, guest_id).await?;
    Ok(Json(
        service::quote_with_eligible_vouchers(&pool, guest_id, request).await?,
    ))
}

pub async fn list_online_inventory_handler(
    State(pool): State<DbPool>,
    Query(query): Query<OnlineInventoryQuery>,
) -> Result<Json<Vec<OnlineInventoryAllocation>>, ApiError> {
    Ok(Json(service::list_online_inventory(&pool, query).await?))
}

pub async fn update_online_inventory_handler(
    State(pool): State<DbPool>,
    Extension(actor_id): Extension<i64>,
    Extension(hub): Extension<AvailabilityHub>,
    axum::extract::Path((room_type_id, stay_date)): axum::extract::Path<(i64, String)>,
    Json(request): Json<UpdateOnlineInventoryRequest>,
) -> Result<Json<OnlineInventoryAllocation>, ApiError> {
    let allocation =
        service::update_online_inventory(&pool, room_type_id, &stay_date, request, actor_id)
            .await?;
    hub.publish(super::availability::AvailabilityEvent {
        event_id: uuid::Uuid::new_v4().to_string(),
        event_type: "availability_changed",
        reason: "online_inventory_changed",
        room_type_id: Some(room_type_id),
        check_in_date: Some(allocation.stay_date),
        check_out_date: Some(
            allocation
                .stay_date
                .succ_opt()
                .ok_or_else(|| ApiError::BadRequest("Invalid stay date".to_string()))?,
        ),
        remaining_rooms: Some(allocation.online_available_rooms),
    });
    Ok(Json(allocation))
}

pub async fn create_booking_handler(
    State(pool): State<DbPool>,
    Extension(hub): Extension<AvailabilityHub>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<CreateGuestBookingRequest>,
) -> Result<Json<GuestBookingConfirmation>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    let ip = crate::routes::extract_client_ip(&headers, peer_addr);
    let (ip_allowed, ip_retry_after) = limiters
        .guest_portal_booking_create_ip
        .check_with_retry(ip)
        .await;
    if !ip_allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many booking attempts from this connection. Please try again in {ip_retry_after} seconds."
            ),
            ip_retry_after,
        ));
    }
    let (allowed, retry_after) = limiters
        .guest_portal_booking_create
        .check_with_retry(format!("guest:{guest_id}"))
        .await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!("Too many booking attempts. Please try again in {retry_after} seconds."),
            retry_after,
        ));
    }
    Ok(Json(
        service::create(
            &pool,
            &hub,
            guest_id,
            request,
            Some(ip.to_string()),
            user_agent(&headers),
        )
        .await?,
    ))
}

fn websocket_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .find(|protocol| *protocol != "hotel-guest-availability" && !protocol.is_empty())
        })
}

pub async fn availability_socket_handler(
    State(pool): State<DbPool>,
    Extension(hub): Extension<AvailabilityHub>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let token = websocket_token(&headers)
        .ok_or_else(|| ApiError::Unauthorized("Missing guest session token".to_string()))?;
    let guest_id = guest_portal::require_guest_session_token(token, &pool).await?;
    require_read_capacity(&limiters, guest_id).await?;
    Ok(websocket
        .protocols(["hotel-guest-availability"])
        .on_upgrade(move |socket| serve_socket(socket, hub)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn websocket_token_comes_from_subprotocol_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static("hotel-guest-availability, abc123"),
        );
        assert_eq!(websocket_token(&headers), Some("abc123"));
    }
}
