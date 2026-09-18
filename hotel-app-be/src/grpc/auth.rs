//! gRPC authentication — mirrors `routes::enforce_active_session`.
//!
//! Runs per-RPC at the top of every handler rather than in a tonic
//! interceptor: `Interceptor` is synchronous but session validation needs the
//! database, and a blocking call inside an interceptor would stall the
//! executor. The security checks are identical and in the same order:
//!
//!   1. `authorization` metadata carries `Bearer <jwt>` (missing →
//!      UNAUTHENTICATED, matching `extract_claims`'s message).
//!   2. The JWT verifies against the same secret/algorithm.
//!   3. `claims.sid` must be present (session-bound tokens only — guest-portal
//!      bearer tokens are a different credential and are rejected here, same
//!      as the REST staff middleware).
//!   4. `AuthService::is_session_active` must hold — a logged-out or expired
//!      session is rejected even when the JWT signature is still valid.
//!
//! On success the handler receives [`GrpcAuth`]: the resolved `user_id` plus
//! a reconstructed `HeaderMap` carrying the Authorization header. Passing
//! those headers into the existing service functions lets them re-run their
//! own `require_*_helper` permission checks through the exact same code path
//! REST uses — no duplicated guard logic in this layer.

use axum::http::{HeaderMap, HeaderValue, header::AUTHORIZATION};
use tonic::{Status, metadata::MetadataMap};

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::middleware::{extract_claims, extract_user_id};

/// The authenticated staff identity for one RPC call.
pub struct GrpcAuth {
    /// `claims.sub` parsed as the users-table primary key.
    pub user_id: i64,
    /// Authorization header rebuilt from the request metadata. Service
    /// functions that take `&HeaderMap` run their own auth against this.
    pub headers: HeaderMap,
}

pub async fn authenticate(pool: &DbPool, metadata: &MetadataMap) -> Result<GrpcAuth, Status> {
    let auth_value = metadata
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Status::unauthenticated("Missing authorization header"))?;

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(auth_value)
            .map_err(|_| Status::unauthenticated("Invalid authorization header format"))?,
    );

    // extract_claims performs the same JWT verification REST relies on
    // (including the AUTH_DENIED metric for bad tokens).
    let claims = extract_claims(&headers)
        .await
        .map_err(|_| Status::unauthenticated("Invalid or expired token"))?;

    let user_id = extract_user_id(&claims)
        .map_err(|_| Status::unauthenticated("Invalid user ID in token"))?;

    let Some(session_id) = claims.sid else {
        return Err(Status::unauthenticated(
            "Session-bound authentication is required",
        ));
    };

    match AuthService::is_session_active(pool, user_id, &session_id).await {
        Ok(true) => Ok(GrpcAuth { user_id, headers }),
        Ok(false) => Err(Status::unauthenticated("Session has been logged out")),
        Err(e) => Err(Status::internal(format!("Session validation failed: {e}"))),
    }
}
