use crate::auth::{AuthService, Claims};
use crate::handlers::ApiError;
use sqlx::PgPool;
use axum::{
    extract::{Request, FromRequestParts},
    http::{request::Parts, StatusCode, header::HeaderMap},
    async_trait,
    Extension,
};

// Extension for database pool
pub struct DatabasePool(pub PgPool);

// Extension for authenticated user ID
pub struct AuthenticatedUser(pub i64);

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
pub async fn check_permission(
    pool: &PgPool,
    user_id: i64,
    permission: &str,
) -> Result<(), ApiError> {
    let has_permission = AuthService::check_permission(pool, user_id, permission).await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !has_permission {
        return Err(ApiError::Unauthorized(format!("Missing permission: {}", permission)));
    }

    Ok(())
}

// Check if user has admin role
pub async fn check_admin_role(
    pool: &PgPool,
    user_id: i64,
) -> Result<(), ApiError> {
    let is_admin = AuthService::check_role(pool, user_id, "admin").await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    if !is_admin {
        return Err(ApiError::Unauthorized("Admin role required".to_string()));
    }

    Ok(())
}

// Middleware extractor for authenticated users with permission check
#[derive(Clone)]
pub struct RequirePermission {
    pub pool: PgPool,
    pub permission: &'static str,
}

#[async_trait]
impl<S> FromRequestParts<S> for RequirePermission
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // This is a placeholder - actual permission checking will be done in route handlers
        // We'll use a different approach with route-specific middleware
        Err(ApiError::Internal("Permission middleware not implemented this way".to_string()))
    }
}

// Helper function to create authenticated user from request
pub async fn require_auth(headers: &HeaderMap) -> Result<i64, ApiError> {
    let claims = extract_claims(headers).await?;
    extract_user_id(&claims)
}

// Helper function to require permission
pub async fn require_permission_helper(
    pool: &PgPool,
    headers: &HeaderMap,
    permission: &str,
) -> Result<i64, ApiError> {
    let user_id = require_auth(headers).await?;
    check_permission(pool, user_id, permission).await?;
    Ok(user_id)
}

// Helper function to require admin role
pub async fn require_admin_helper(
    pool: &PgPool,
    headers: &HeaderMap,
) -> Result<i64, ApiError> {
    let user_id = require_auth(headers).await?;
    check_admin_role(pool, user_id).await?;
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
