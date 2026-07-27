//! Guest-portal eKYC handlers.
//!
//! Self-service identity verification for a guest signed in to the portal.
//!
//! These are transport only: they authenticate with a guest portal session
//! (`Authorization: Bearer <portal token>`) instead of an account JWT, bridge
//! the session's `guest_id` to the `users.id` the eKYC domain is keyed on, and
//! then delegate to the same `super::service` functions the staff routes use.
//! Every business rule — the one-open-verification-per-guest guard, date and
//! field validation, sanitization, the audit write — is inherited unchanged.
//!
//! The bridge is safe by construction: a portal session is only ever minted for
//! an active `users` row with `user_type = 'guest'` and a non-null `guest_id`
//! (`services::guest_portal::create_authenticated_guest_portal_session`), so
//! resolving that guest back to its user cannot reach another guest's account.

use axum::{
    extract::{ConnectInfo, Extension, Multipart, State},
    http::HeaderMap,
    response::Json,
};
use std::net::SocketAddr;

use super::models;
use super::service;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::models::AuditEvent;
use crate::repositories::guest_portal_session::GuestPortalSessionRepository;
use crate::services::audit::AuditLog;
use crate::services::guest_portal;

/// Resolve the `users.id` that backs a portal session's guest.
///
/// Reuses `find_guest_user_id`, which filters on `is_active = true`. Soft
/// deletion sets `is_active = false` alongside `deleted_at`
/// (`repositories/user.rs:174-181`), so a deactivated or deleted account
/// resolves to `None` here even though its portal session may not have expired
/// yet — revoking the account revokes the ability to submit.
///
/// Deliberately does NOT provision a user: the portal must never mint `users`
/// rows, and an extra row would shadow the front-desk anchor account that
/// `EkycRepository::find_guest_user` looks for.
async fn resolve_portal_user_id(pool: &DbPool, guest_id: i64) -> Result<i64, ApiError> {
    GuestPortalSessionRepository::find_guest_user_id(pool, guest_id)
        .await?
        .ok_or_else(|| {
            ApiError::Forbidden(
                "This portal account is no longer active. Please contact the front desk."
                    .to_string(),
            )
        })
}

/// Per-guest and per-IP budget for eKYC writes (upload + submit).
///
/// The IP ceiling is the load-bearing one: `/auth/register` is public and mints
/// `user_type = 'guest'` accounts, so an attacker who is only bounded per guest
/// can register more guests. Checked first so a flood is rejected before any
/// per-guest bookkeeping.
async fn enforce_ekyc_write_limit(
    limiters: &RateLimiters,
    guest_id: i64,
    headers: &HeaderMap,
    peer_addr: SocketAddr,
) -> Result<(), ApiError> {
    let (ip_allowed, ip_retry_after) = limiters
        .guest_portal_ekyc_ip
        .check_with_retry(crate::routes::extract_client_ip(headers, peer_addr))
        .await;
    if !ip_allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many verification requests from this connection. Please try again in {ip_retry_after} seconds."
            ),
            ip_retry_after,
        ));
    }

    let (allowed, retry_after) = limiters
        .guest_portal_ekyc
        .check_with_retry(format!("guest:{guest_id}"))
        .await;
    if allowed {
        Ok(())
    } else {
        Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many verification attempts. Please try again in {retry_after} seconds."
            ),
            retry_after,
        ))
    }
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(512).collect())
}

fn client_ip(headers: &HeaderMap, peer_addr: SocketAddr) -> Option<String> {
    Some(crate::routes::extract_client_ip(headers, peer_addr).to_string())
}

/// `GET /guest-portal/me/ekyc` — the signed-in guest's own verification status.
///
/// Returns `null` when they have never submitted. Rides the shared portal read
/// budget via `require_guest_session_for_read`; no separate limiter needed.
pub async fn get_status_handler(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
) -> Result<Json<Option<models::EkycStatusResponse>>, ApiError> {
    let guest_id = guest_portal::require_guest_session_for_read(&headers, &pool, &limiters).await?;
    let user_id = resolve_portal_user_id(&pool, guest_id).await?;
    Ok(Json(service::get_ekyc_status(&pool, user_id).await?))
}

/// `POST /guest-portal/me/ekyc/documents` — store one identity document.
///
/// The stored filename embeds the resolved `user_id`, and submit re-checks that
/// prefix (`validation::validate_existing_ekyc_path`), so a guest can only ever
/// reference files they uploaded themselves.
pub async fn upload_document_handler(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    enforce_ekyc_write_limit(&limiters, guest_id, &headers, peer_addr).await?;
    let user_id = resolve_portal_user_id(&pool, guest_id).await?;

    let result = service::store_document_upload(multipart, user_id).await?;

    // Writing an identity document to disk is an event worth recording on its
    // own: without this, a document that is uploaded but never submitted leaves
    // no trace of who put it there.
    let _ = AuditLog::log_event(
        &pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "ekyc_document_uploaded",
            // Keyed on the GUEST, not on "ekyc_verification": no verification
            // row exists yet at upload time, so writing guest_id under that
            // resource_type would point at an unrelated verification whose id
            // happens to collide (both are independent identity sequences), and
            // the admin audit view renders it as "eKYC Verification #<id>".
            // "guest" + guest_id matches the convention the other guest-portal
            // audit events use, and maps to the same "guests" audit category.
            resource_type: "guest",
            resource_id: Some(guest_id),
            details: Some(serde_json::json!({
                "channel": "guest_portal",
                "guest_id": guest_id,
                "document_type": result.get("document_type"),
                "stored_path": result.get("file_path"),
            })),
            ip_address: client_ip(&headers, peer_addr),
            user_agent: user_agent(&headers),
        },
    )
    .await;

    Ok(Json(result))
}

/// `POST /guest-portal/me/ekyc/submit` — submit the verification for review.
///
/// Runs through `SubmissionChannel::GuestPortal`, which restricts image fields
/// to paths already stored by the upload route above (no inline base64), so
/// every byte written to disk on this surface passed the rate limit and the
/// body cap.
pub async fn submit_handler(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(input): Json<models::EkycSubmissionRequest>,
) -> Result<Json<models::EkycStatusResponse>, ApiError> {
    let guest_id = guest_portal::require_guest_session(&headers, &pool).await?;
    enforce_ekyc_write_limit(&limiters, guest_id, &headers, peer_addr).await?;
    let user_id = resolve_portal_user_id(&pool, guest_id).await?;

    Ok(Json(
        service::submit_ekyc(
            &pool,
            user_id,
            input,
            service::SubmissionChannel::GuestPortal,
            client_ip(&headers, peer_addr),
            user_agent(&headers),
        )
        .await?,
    ))
}
