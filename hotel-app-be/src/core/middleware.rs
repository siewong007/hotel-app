use super::auth::{AuthService, Claims};
use super::db::DbPool;
use super::error::ApiError;
use axum::{
    http::header::HeaderMap,
};

// Extract JWT token from Authorization header
pub async fn extract_claims(headers: &HeaderMap) -> Result<Claims, ApiError> {
    let auth_header = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("Missing authorization header".to_string()))?;

    if !auth_header.starts_with("Bearer ") {
        return Err(ApiError::Unauthorized("Invalid authorization header format".to_string()));
    }

    let token = auth_header.strip_prefix("Bearer ").unwrap();
    AuthService::verify_jwt(token)
        .map_err(|_| ApiError::Unauthorized("Invalid or expired token".to_string()))
}

// Extract user ID from claims
pub fn extract_user_id(claims: &Claims) -> Result<i64, ApiError> {
    claims.sub.parse::<i64>()
        .map_err(|_| ApiError::Unauthorized("Invalid user ID in token".to_string()))
}

// Check if user has permission
// Also checks for :manage permission which implies all actions on that resource
pub async fn check_permission(
    pool: &DbPool,
    user_id: i64,
    permission: &str,
) -> Result<(), ApiError> {
    // First check the exact permission
    let has_permission = AuthService::check_permission(pool, user_id, permission).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if has_permission {
        return Ok(());
    }

    // If not, check for :manage permission on the same resource
    // e.g., guests:update -> also check guests:manage
    if let Some(resource) = permission.split(':').next() {
        let manage_permission = format!("{}:manage", resource);
        let has_manage = AuthService::check_permission(pool, user_id, &manage_permission).await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        if has_manage {
            return Ok(());
        }
    }

    Err(ApiError::Forbidden(format!("Missing permission: {}", permission)))
}

// Check if user has admin role
pub async fn check_admin_role(
    pool: &DbPool,
    user_id: i64,
) -> Result<(), ApiError> {
    let is_admin = AuthService::check_role(pool, user_id, "admin").await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_admin {
        return Err(ApiError::Forbidden("Admin role required".to_string()));
    }

    Ok(())
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

// Helper function to require admin role
pub async fn require_admin_helper(
    pool: &DbPool,
    headers: &HeaderMap,
) -> Result<i64, ApiError> {
    let user_id = require_auth(headers).await?;
    check_admin_role(pool, user_id).await?;
    Ok(user_id)
}

// Helper function to require super admin status
pub async fn require_super_admin_helper(
    pool: &DbPool,
    headers: &HeaderMap,
) -> Result<i64, ApiError> {
    let user_id = require_auth(headers).await?;

    // Check if user is a super admin
    let is_super_admin: bool = sqlx::query_scalar(
        "SELECT is_super_admin FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .unwrap_or(false);

    if !is_super_admin {
        return Err(ApiError::Forbidden(
            "Only super administrators can perform this operation".to_string()
        ));
    }

    Ok(user_id)
}

// Rate limiting configuration
// Note: Rate limiting implementation requires tower_governor 0.8+
// Current version (0.4) has API incompatibilities
// TODO: Upgrade to tower_governor 0.8 or implement custom rate limiting
pub mod rate_limit {
    // Placeholder for rate limiting
    // When implementing, use tower_governor 0.8+ with correct API
}
