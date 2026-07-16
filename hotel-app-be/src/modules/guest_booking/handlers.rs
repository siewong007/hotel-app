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
    GuestBookingOffer, GuestBookingQuote,
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

pub async fn search_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Query(query): Query<BookingSearchQuery>,
) -> Result<Json<Vec<GuestBookingOffer>>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(service::search(&pool, guest_id, query).await?))
}

pub async fn quote_handler(
    State(pool): State<DbPool>,
    headers: HeaderMap,
    Json(request): Json<BookingQuoteRequest>,
) -> Result<Json<GuestBookingQuote>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    Ok(Json(service::quote(&pool, guest_id, request).await?))
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
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let token = websocket_token(&headers)
        .ok_or_else(|| ApiError::Unauthorized("Missing guest session token".to_string()))?;
    guest_portal::require_guest_session_token(token, &pool).await?;
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
