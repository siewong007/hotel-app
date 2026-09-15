//! Step-up re-authentication for privileged data-transfer operations.
//!
//! Full/backup exports and restore imports require more than a standing
//! session: the caller re-proves identity (password, plus TOTP when the
//! account has it) and receives a 120-second token bound to the same session
//! (`sid`). The gated endpoint re-checks the token's signature, expiry,
//! audience, subject, and session — a token cannot cross users or sessions,
//! and cannot act as an access token because its audience never validates
//! under [`crate::core::auth::AuthService::verify_jwt`].

use axum::http::HeaderMap;
use chrono::{Duration, Utc};

use crate::core::auth::{AuthService, Claims};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::extract_user_id;
use crate::models::{AuditEvent, StepUpRequest, StepUpResponse};
use crate::repositories::auth::AuthRepository;
use crate::services::audit::AuditLog;

/// Audit actions — pinned so the transfer-history query picks them up.
pub const STEP_UP_ACTION: &str = "data_transfer_step_up";
pub const STEP_UP_DENIED_ACTION: &str = "data_transfer_step_up_denied";

/// Header carrying the step-up token on gated operations.
pub const STEP_UP_HEADER: &str = "x-step-up";

/// Step-up token lifetime — mirrored from `core::auth`'s mint so the response
/// can report the same expiry the token enforces.
const STEP_UP_TTL_SECS: i64 = 120;

async fn audit_step_up(pool: &DbPool, user_id: i64, action: &'static str, reason: Option<&str>) {
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action,
            resource_type: "data_transfer",
            details: reason.map(|reason| serde_json::json!({ "reason": reason })),
            ..Default::default()
        },
    )
    .await;
}

/// Re-authenticate the caller, then mint the step-up token.
///
/// Password is verified first; when the account has TOTP enabled the code is
/// required as well — a stolen session plus a phished password should not
/// clear a privileged export on a 2FA account. Accounts with no password
/// (passkey-only) fall back to the TOTP check; an account with neither
/// credential can never step up. Failures return a generic 401 — the reason
/// goes to the audit row, never the response.
pub async fn issue_step_up(
    pool: &DbPool,
    access_claims: &Claims,
    request: &StepUpRequest,
) -> Result<StepUpResponse, ApiError> {
    let user_id = extract_user_id(access_claims)?;

    let stored_hash = AuthRepository::password_hash(pool, user_id).await.ok();
    let password_ok = match stored_hash.as_deref() {
        Some(hash) => AuthService::verify_password(&request.password, hash)
            .await
            .unwrap_or(false),
        // No password on file — a wrong guess cannot "verify", but the TOTP
        // path below can still pass on its own.
        None => false,
    };

    let (totp_enabled, stored_secret) = AuthRepository::two_factor_state(pool, user_id).await?;
    let totp_enabled = totp_enabled.unwrap_or(false);
    let totp_ok = if totp_enabled {
        match (request.totp_code.as_deref(), stored_secret.as_deref()) {
            (Some(code), Some(stored)) => {
                match AuthService::decrypt_stored_totp_secret(stored) {
                    Ok(secret) => AuthService::verify_totp_code(&secret, code).unwrap_or(false),
                    Err(error) => {
                        log::warn!("step-up: TOTP secret undecryptable for user {user_id}: {error}");
                        false
                    }
                }
            }
            _ => false,
        }
    } else {
        false
    };

    let passed = if stored_hash.is_some() {
        // Password account: password mandatory, TOTP mandatory when enrolled.
        password_ok && (!totp_enabled || totp_ok)
    } else {
        // Passwordless account: TOTP is the only factor left.
        totp_enabled && totp_ok
    };

    if !passed {
        let reason = match (stored_hash.is_some(), totp_enabled) {
            (false, false) => "account has no step-up credential",
            (true, true) => "password or TOTP verification failed",
            (true, false) => "password verification failed",
            (false, true) => "TOTP verification failed",
        };
        audit_step_up(pool, user_id, STEP_UP_DENIED_ACTION, Some(reason)).await;
        return Err(ApiError::Unauthorized(
            "Re-authentication failed — check your credentials and try again.".to_string(),
        ));
    }

    let token = AuthService::issue_step_up_token(
        user_id,
        access_claims.username.clone(),
        access_claims.sid.clone(),
    )
    .map_err(|error| ApiError::Internal(format!("could not issue step-up token: {error}")))?;

    audit_step_up(pool, user_id, STEP_UP_ACTION, None).await;
    Ok(StepUpResponse {
        step_up_token: token,
        expires_at: (Utc::now() + Duration::seconds(STEP_UP_TTL_SECS)).to_rfc3339(),
    })
}

/// Enforce a valid `X-Step-Up` token on a privileged operation. The token
/// must decode under the step-up audience, name the same user, and carry the
/// same session id as the caller's access token — a token minted by someone
/// else, or on a different device, fails here.
pub fn require_step_up(headers: &HeaderMap, access_claims: &Claims) -> Result<(), ApiError> {
    let token = headers
        .get(STEP_UP_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::Unauthorized(
                "This operation requires recent re-authentication (step-up).".to_string(),
            )
        })?;

    let claims = AuthService::verify_step_up_token(token).map_err(|_| {
        crate::core::metrics::incr(&crate::core::metrics::AUTH_DENIED);
        ApiError::Unauthorized("Step-up token is invalid or expired.".to_string())
    })?;

    if claims.sub != access_claims.sub || claims.sid != access_claims.sid {
        return Err(ApiError::Unauthorized(
            "Step-up token does not belong to this session.".to_string(),
        ));
    }
    Ok(())
}
