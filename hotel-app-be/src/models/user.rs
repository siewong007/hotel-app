//! User-related models

use crate::constants::UserType;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use validator::Validate;

/// Core user entity
#[derive(Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub is_active: bool,
    pub is_verified: bool,
    pub user_type: Option<UserType>,
    pub two_factor_enabled: Option<bool>,
    #[serde(skip_serializing)]
    pub two_factor_secret: Option<String>,
    #[cfg_attr(
        all(feature = "sqlite", not(feature = "postgres")),
        sqlx(json(nullable))
    )]
    #[serde(skip_serializing)]
    pub two_factor_recovery_codes: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// Manual impl so 2FA secrets can never reach logs via `{:?}`.
impl std::fmt::Debug for User {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("User")
            .field("id", &self.id)
            .field("username", &self.username)
            .field("email", &self.email)
            .field("full_name", &self.full_name)
            .field("phone", &self.phone)
            .field("is_active", &self.is_active)
            .field("is_verified", &self.is_verified)
            .field("user_type", &self.user_type)
            .field("two_factor_enabled", &self.two_factor_enabled)
            .field(
                "two_factor_secret",
                &self.two_factor_secret.as_ref().map(|_| "<redacted>"),
            )
            .field(
                "two_factor_recovery_codes",
                &self.two_factor_recovery_codes.as_ref().map(|_| "<redacted>"),
            )
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

/// User with their roles
#[derive(Debug, Serialize, Deserialize)]
pub struct UserWithRoles {
    pub user: User,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
}

/// User response for API (excludes sensitive fields)
#[derive(Debug, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub is_active: bool,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        UserResponse {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            is_active: user.is_active,
            roles: vec![],
            permissions: vec![],
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}

/// User profile for display
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

/// Input for updating user profile
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct UserProfileUpdate {
    #[validate(length(
        min = 1,
        max = 100,
        message = "Full name must be between 1 and 100 characters"
    ))]
    pub full_name: Option<String>,
    #[validate(email(message = "Invalid email format"))]
    pub email: Option<String>,
    #[validate(length(max = 30, message = "Phone number is too long"))]
    pub phone: Option<String>,
    #[validate(length(max = 2048, message = "Avatar URL is too long"))]
    pub avatar_url: Option<String>,
}

/// Input for changing password
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct PasswordUpdateInput {
    #[validate(length(min = 1, max = 128, message = "Current password is required"))]
    pub current_password: String,
    #[validate(length(
        min = 8,
        max = 128,
        message = "New password must be between 8 and 128 characters"
    ))]
    pub new_password: String,
}

/// Input for creating a new user (admin)
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct UserCreateInput {
    #[validate(length(
        min = 3,
        max = 50,
        message = "Username must be between 3 and 50 characters"
    ))]
    pub username: String,
    #[validate(email(message = "Invalid email format"))]
    pub email: String,
    #[validate(length(
        min = 8,
        max = 128,
        message = "Password must be between 8 and 128 characters"
    ))]
    pub password: String,
    #[validate(length(max = 100, message = "Full name is too long"))]
    pub full_name: Option<String>,
    #[validate(length(max = 30, message = "Phone number is too long"))]
    pub phone: Option<String>,
    pub role_ids: Option<Vec<i64>>,
}

/// Input for updating a user from RBAC administration
#[derive(Debug, Serialize, Deserialize, Validate, Default)]
pub struct UserUpdateInput {
    #[validate(length(
        min = 3,
        max = 50,
        message = "Username must be between 3 and 50 characters"
    ))]
    pub username: Option<String>,
    #[validate(email(message = "Invalid email format"))]
    pub email: Option<String>,
    #[validate(length(max = 100, message = "Full name is too long"))]
    pub full_name: Option<String>,
    #[validate(length(max = 30, message = "Phone number is too long"))]
    pub phone: Option<String>,
    pub is_active: Option<bool>,
    #[validate(length(
        min = 8,
        max = 128,
        message = "Password must be between 8 and 128 characters"
    ))]
    pub password: Option<String>,
}
