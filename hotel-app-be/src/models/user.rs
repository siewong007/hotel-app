//! User-related models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// User type enum matching PostgreSQL UserType
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "usertype", rename_all = "lowercase")]
pub enum UserType {
    Staff,
    Guest,
}

/// Core user entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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
    pub two_factor_secret: Option<String>,
    pub two_factor_recovery_codes: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
#[derive(Debug, Serialize, Deserialize)]
pub struct UserProfileUpdate {
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
}

/// Input for changing password
#[derive(Debug, Serialize, Deserialize)]
pub struct PasswordUpdateInput {
    pub current_password: String,
    pub new_password: String,
}

/// Input for creating a new user (admin)
#[derive(Debug, Serialize, Deserialize)]
pub struct UserCreateInput {
    pub username: String,
    pub email: String,
    pub password: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub role_ids: Option<Vec<i64>>,
}
