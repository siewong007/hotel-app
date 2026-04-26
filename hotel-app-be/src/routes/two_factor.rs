//! Two-factor authentication routes

use super::extract_client_ip;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::rate_limiter::RateLimiters;
use crate::handlers;
use crate::models;
use axum::{
    Router,
    extract::{Extension, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
};

pub fn routes() -> Router<DbPool> {
    Router::new()
        .route("/auth/2fa/setup", post(setup_2fa))
        .route("/auth/2fa/enable", post(enable_2fa))
        .route("/auth/2fa/disable", post(disable_2fa))
        .route("/auth/2fa/status", get(get_2fa_status))
        .route("/auth/2fa/verify", post(verify_2fa))
        .route(
            "/auth/2fa/regenerate-backup-codes",
            post(regenerate_backup_codes),
        )
}

async fn setup_2fa(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorSetupRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::two_factor::setup_2fa_handler(State(pool), headers, Json(req)).await
}

async fn enable_2fa(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorEnableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::two_factor::enable_2fa_handler(State(pool), headers, Json(req)).await
}

async fn disable_2fa(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorDisableRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::two_factor::disable_2fa_handler(State(pool), headers, Json(req)).await
}

async fn get_2fa_status(
    State(pool): State<DbPool>,
    headers: HeaderMap,
) -> Result<Json<models::TwoFactorStatusResponse>, ApiError> {
    handlers::two_factor::get_2fa_status_handler(State(pool), headers).await
}

async fn verify_2fa(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::TwoFactorVerifyRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::two_factor::verify_2fa_code_handler(State(pool), Json(req)).await
}

async fn regenerate_backup_codes(
    State(pool): State<DbPool>,
    Extension(limiters): Extension<RateLimiters>,
    headers: HeaderMap,
    Json(req): Json<models::RegenerateBackupCodesRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ip = extract_client_ip(&headers);
    let (allowed, retry_after) = limiters.sensitive.check_with_retry(ip).await;
    if !allowed {
        return Err(ApiError::TooManyRequestsRetryAfter(
            format!(
                "Too many requests. Please try again in {} seconds.",
                retry_after
            ),
            retry_after,
        ));
    }
    handlers::two_factor::regenerate_backup_codes_handler(State(pool), headers, Json(req)).await
}
