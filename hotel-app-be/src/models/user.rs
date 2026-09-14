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
    #[serde(skip_serializing)]
    #[sqlx(default)]
    pub google_subject: Option<String>,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub is_active: bool,
    pub is_verified: bool,
    pub user_type: Option<UserType>,
    pub two_factor_enabled: Option<bool>,
    #[serde(skip_serializing)]
    pub two_factor_secret: Option<String>,
    #[serde(skip_serializing)]
    pub two_factor_recovery_codes: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(default)]
    pub last_login_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub is_locked: bool,
    #[sqlx(default)]
    pub locked_until: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub failed_login_attempts: i32,
    #[sqlx(default)]
    pub is_super_admin: bool,
}

// Manual impl so 2FA secrets can never reach logs via `{:?}`.
impl std::fmt::Debug for User {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("User")
            .field("id", &self.id)
            .field("username", &self.username)
            .field("email", &self.email)
            .field(
                "google_subject",
                &self.google_subject.as_ref().map(|_| "<redacted>"),
            )
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
                &self
                    .two_factor_recovery_codes
                    .as_ref()
                    .map(|_| "<redacted>"),
            )
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::User;
    use sqlx::{FromRow, postgres::PgPoolOptions};

    #[tokio::test]
    async fn user_projection_defaults_an_omitted_google_subject() {
        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            eprintln!(
                "Skipping user projection compatibility test because DATABASE_URL is not set"
            );
            return;
        };
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .expect("failed to connect to PostgreSQL test database");

        let user = sqlx::query(
            "SELECT 1::BIGINT AS id, 'guest'::VARCHAR AS username, \
                    'guest@example.com'::VARCHAR AS email, NULL::VARCHAR AS full_name, \
                    NULL::VARCHAR AS phone, true AS is_active, true AS is_verified, \
                    NULL::VARCHAR AS user_type, NULL::BOOLEAN AS two_factor_enabled, \
                    NULL::VARCHAR AS two_factor_secret, NULL::VARCHAR[] AS two_factor_recovery_codes, \
                    CURRENT_TIMESTAMP AS created_at, CURRENT_TIMESTAMP AS updated_at",
        )
        .fetch_one(&pool)
        .await
        .expect("selecting a user projection without google_subject must succeed");
        let user = User::from_row(&user)
            .expect("a User must decode from a projection without google_subject");

        assert_eq!(user.google_subject, None);
    }
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
    #[serde(default)]
    pub last_login_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub is_locked: bool,
    #[serde(default)]
    pub is_verified: bool,
    #[serde(default)]
    pub is_super_admin: bool,
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
            last_login_at: user.last_login_at,
            is_locked: user.is_locked,
            is_verified: user.is_verified,
            is_super_admin: user.is_super_admin,
        }
    }
}

/// Server-side filters for the staff directory (`GET /users/directory`).
/// `status` is one of `active`, `suspended`, `locked`; `role` matches a role
/// name. All filters are optional and combine with AND.
#[derive(Debug, Deserialize)]
pub struct StaffDirectoryQuery {
    pub search: Option<String>,
    pub status: Option<String>,
    pub role: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

/// One staff directory row: account + status + assigned role names.
#[derive(Debug, Serialize, FromRow)]
pub struct StaffDirectoryEntry {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub is_active: bool,
    pub is_verified: bool,
    pub is_locked: bool,
    pub is_super_admin: bool,
    pub last_login_at: Option<DateTime<Utc>>,
    pub roles: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct StaffDirectoryResponse {
    pub data: Vec<StaffDirectoryEntry>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

/// Invite a staff member: creates the account without a password and returns a
/// one-time acceptance link for the administrator to deliver out of band.
#[derive(Debug, Deserialize, Validate)]
pub struct InviteUserInput {
    #[validate(length(
        min = 3,
        max = 50,
        message = "Username must be between 3 and 50 characters"
    ))]
    pub username: String,
    #[validate(email(message = "Invalid email format"))]
    pub email: String,
    #[validate(length(max = 100, message = "Full name is too long"))]
    pub full_name: Option<String>,
    #[validate(length(max = 30, message = "Phone number is too long"))]
    pub phone: Option<String>,
    pub role_ids: Option<Vec<i64>>,
}

#[derive(Debug, Serialize)]
pub struct InviteUserResponse {
    pub user: UserResponse,
    pub invite_url: String,
    pub expires_at: DateTime<Utc>,
}

/// Public invite acceptance: the token proves the invite, the password becomes
/// the account's first credential. Only accounts created by `invite` (password
/// still NULL) qualify.
#[derive(Debug, Deserialize, Validate)]
pub struct AcceptInviteInput {
    #[validate(length(min = 32, max = 255, message = "Invalid invite token"))]
    pub token: String,
    #[validate(length(
        min = 8,
        max = 128,
        message = "Password must be between 8 and 128 characters"
    ))]
    pub password: String,
}

/// User profile for display
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub email_configured: bool,
    pub is_verified: bool,
    pub user_type: Option<UserType>,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub profile_complete: bool,
    #[sqlx(default)]
    pub missing_profile_fields: Vec<String>,
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
