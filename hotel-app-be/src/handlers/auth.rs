//! Authentication handlers.
//!
//! Handles login, logout, registration, and token management.

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::services::auth as svc;
use axum::{extract::State, response::Json};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};

/// Name of the `HttpOnly` cookie that carries the refresh token.
pub const REFRESH_COOKIE: &str = "refresh_token";
/// Refresh tokens are minted with a 30-day lifetime (see `store_refresh_token`);
/// keep the cookie lifetime in lockstep so the browser drops it when it expires.
const REFRESH_COOKIE_MAX_AGE_DAYS: i64 = 30;

/// Local development and the desktop sidecar use HTTP loopback URLs. Browsers
/// do not send `Secure` cookies over those URLs, so only require the flag for
/// deployed web servers. Production web deployments must terminate TLS.
fn refresh_cookie_is_secure() -> bool {
    !cfg!(debug_assertions) && !crate::core::config::get().desktop_mode
}

/// Builds the refresh-token cookie: `HttpOnly`, `Secure`, `SameSite=Strict`,
/// scoped to `/api/auth` so it is only ever sent to the auth endpoints.
pub(crate) fn build_refresh_cookie(token: String) -> Cookie<'static> {
    Cookie::build((REFRESH_COOKIE, token))
        .http_only(true)
        .secure(refresh_cookie_is_secure())
        .same_site(SameSite::Strict)
        .path("/api/auth")
        .max_age(time::Duration::days(REFRESH_COOKIE_MAX_AGE_DAYS))
        .build()
}

/// Builds an expired refresh-token cookie (same name/path) so the browser deletes
/// it on logout. `Max-Age=0` / a past expiry is what clears it.
fn clear_refresh_cookie() -> Cookie<'static> {
    Cookie::build((REFRESH_COOKIE, ""))
        .http_only(true)
        .secure(refresh_cookie_is_secure())
        .same_site(SameSite::Strict)
        .path("/api/auth")
        .max_age(time::Duration::seconds(0))
        .build()
}

pub async fn login_handler(
    State(pool): State<DbPool>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<AuthResponse>), ApiError> {
    let (response, refresh_token) = svc::login(&pool, req).await?;
    let jar = jar.add(build_refresh_cookie(refresh_token));
    Ok((jar, Json(response)))
}

pub async fn refresh_token_handler(
    State(pool): State<DbPool>,
    jar: CookieJar,
    req: RefreshTokenRequest,
) -> Result<(CookieJar, Json<RefreshTokenResponse>), ApiError> {
    let response = svc::refresh_token(&pool, req).await?;
    // `refresh_token` is rotated on every refresh; set the new one on the cookie
    // and strip it from the JSON body (`skip_serializing` on the field).
    let jar = jar.add(build_refresh_cookie(response.refresh_token.clone()));
    Ok((jar, Json(response)))
}

pub async fn access_snapshot_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Json<AccessSnapshot>, ApiError> {
    Ok(Json(svc::access_snapshot(&pool, user_id).await?))
}

pub async fn logout_handler(
    State(pool): State<DbPool>,
    jar: CookieJar,
    req: RefreshTokenRequest,
) -> Result<(CookieJar, Json<serde_json::Value>), ApiError> {
    // Best-effort server-side revoke, but always clear the browser cookie below
    // so the client ends up logged out even if the token was already invalid.
    let _ = svc::logout(&pool, req).await;

    let jar = jar.add(clear_refresh_cookie());
    Ok((
        jar,
        Json(serde_json::json!({"message": "Logged out successfully"})),
    ))
}

pub async fn register_handler(
    State(pool): State<DbPool>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::register(&pool, req).await?))
}

pub async fn verify_email_handler(
    State(pool): State<DbPool>,
    Json(req): Json<EmailVerificationConfirm>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::verify_email(&pool, req).await?))
}

pub async fn resend_verification_handler(
    State(pool): State<DbPool>,
    Json(req): Json<ResendVerificationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(svc::resend_verification(&pool, req).await?))
}
