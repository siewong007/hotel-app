use super::auth::{AuthService, Claims};
use super::db::DbPool;
use super::error::ApiError;
use axum::http::header::HeaderMap;

// Extract JWT token from Authorization header
pub async fn extract_claims(headers: &HeaderMap) -> Result<Claims, ApiError> {
    let auth_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("Missing authorization header".to_string()))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| ApiError::Unauthorized("Invalid authorization header format".to_string()))?;
    AuthService::verify_jwt(token).map_err(|_| {
        // Counts tokens that were PRESENTED and failed verification (forged,
        // tampered, or expired). A missing header is deliberately not counted:
        // unauthenticated probes of public routes are routine noise, whereas a
        // bad token is a signal worth thresholding on.
        crate::core::metrics::incr(&crate::core::metrics::AUTH_DENIED);
        ApiError::Unauthorized("Invalid or expired token".to_string())
    })
}

// Extract user ID from claims
pub fn extract_user_id(claims: &Claims) -> Result<i64, ApiError> {
    claims
        .sub
        .parse::<i64>()
        .map_err(|_| ApiError::Unauthorized("Invalid user ID in token".to_string()))
}

/// Check if a user holds `permission`.
///
/// The `<resource>:manage` implication is resolved one layer down, inside
/// [`AuthService::check_permission`] (see `core::rbac_cache::has_permission`),
/// so this function must NOT re-derive it — doing so cost a second cache
/// lookup on every denial for no behavioural difference.
pub async fn check_permission(
    pool: &DbPool,
    user_id: i64,
    permission: &str,
) -> Result<(), ApiError> {
    let has_permission = AuthService::check_permission(pool, user_id, permission)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if has_permission {
        return Ok(());
    }

    // Authorization-boundary probing is otherwise invisible: a 403 writes no
    // audit row and, before this, no log line. WARN (not INFO) so it survives
    // the production RUST_LOG=warn setting.
    crate::core::metrics::incr(&crate::core::metrics::PERMISSION_DENIED);
    log::warn!("Permission denied: user {user_id} lacks '{permission}'");

    Err(ApiError::Forbidden(format!(
        "Missing permission: {}",
        permission
    )))
}

/// True when the user is flagged `users.is_super_admin`.
///
/// Super admins are the ceiling of the authorization hierarchy: they bypass
/// the role-priority and permission-superset guards in
/// [`crate::services::rbac`], and they alone may mutate system roles and the
/// permission catalogue. Soft-deleted and deactivated accounts never qualify.
pub async fn is_super_admin(pool: &DbPool, user_id: i64) -> Result<bool, ApiError> {
    sqlx::query_scalar::<_, bool>(
        "SELECT is_super_admin FROM users \
         WHERE id = $1 AND is_active = true AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map(|flag| flag.unwrap_or(false))
    .map_err(|e| ApiError::Database(e.to_string()))
}

pub async fn check_any_permission(
    pool: &DbPool,
    user_id: i64,
    permissions: &[&str],
) -> Result<(), ApiError> {
    for permission in permissions {
        match check_permission(pool, user_id, permission).await {
            Ok(()) => return Ok(()),
            Err(ApiError::Forbidden(_)) => {}
            Err(err) => return Err(err),
        }
    }

    Err(ApiError::Forbidden(format!(
        "Missing one of required permissions: {}",
        permissions.join(", ")
    )))
}

// Helper function to create authenticated user from request
pub async fn require_auth(headers: &HeaderMap) -> Result<i64, ApiError> {
    let claims = extract_claims(headers).await?;
    extract_user_id(&claims)
}

// Helper function to require permission
pub async fn require_permission_helper(
    pool: &DbPool,
    headers: &HeaderMap,
    permission: &str,
) -> Result<i64, ApiError> {
    let user_id = require_auth(headers).await?;
    check_permission(pool, user_id, permission).await?;
    Ok(user_id)
}

pub async fn require_any_permission_helper(
    pool: &DbPool,
    headers: &HeaderMap,
    permissions: &[&str],
) -> Result<i64, ApiError> {
    let user_id = require_auth(headers).await?;
    check_any_permission(pool, user_id, permissions).await?;
    Ok(user_id)
}

/// Reject a known user id that is not a super admin.
///
/// Callers already hold the actor id from `require_permission_helper`, so a
/// separate headers-taking wrapper would only re-parse the token.
pub async fn ensure_super_admin(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
    if is_super_admin(pool, user_id).await? {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "Only super administrators can perform this operation".to_string(),
        ))
    }
}
