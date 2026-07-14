//! Authentication-related models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::rbac::RouteAccessPolicy;
use super::user::UserResponse;
use validator::Validate;

/// Login request
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(length(min = 1, message = "Username is required"))]
    pub username: String,
    #[validate(length(min = 1, message = "Password is required"))]
    pub password: String,
    pub totp_code: Option<String>,
}

/// Authentication response after login
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub user: UserResponse,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub route_policies: Vec<RouteAccessPolicy>,
    pub is_first_login: bool,
}

/// Current user's dynamic access snapshot.
#[derive(Debug, Serialize, Deserialize)]
pub struct AccessSnapshot {
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub route_policies: Vec<RouteAccessPolicy>,
}

/// Refresh token request.
///
/// The refresh token is transported via an `HttpOnly` cookie, not the JSON body,
/// so this struct is constructed server-side from the cookie value.
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct RefreshTokenRequest {
    #[validate(length(min = 32, max = 512, message = "Invalid refresh token"))]
    pub refresh_token: String,
}

/// Refresh token response.
///
/// `access_token` is returned in the JSON body; `refresh_token` is set on an
/// `HttpOnly` cookie by the route handler and is never serialized to the client.
#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshTokenResponse {
    pub access_token: String,
    #[serde(skip_serializing)]
    pub refresh_token: String,
}

/// Registration request
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(length(
        min = 3,
        max = 50,
        message = "Username must be between 3 and 50 characters"
    ))]
    pub username: String,
    #[validate(email(message = "Invalid email format"))]
    pub email: Option<String>,
    #[validate(length(
        min = 8,
        max = 100,
        message = "Password must be at least 8 characters long"
    ))]
    pub password: String,
    pub full_name: Option<String>,
    #[validate(length(min = 1, max = 50, message = "First name is required"))]
    pub first_name: String,
    #[validate(length(min = 1, max = 50, message = "Last name is required"))]
    pub last_name: String,
    #[validate(length(
        min = 8,
        max = 16,
        message = "Phone number must contain between 8 and 15 digits"
    ))]
    pub phone: String,
    #[validate(length(max = 255, message = "Address is too long"))]
    pub address_line1: Option<String>,
}

/// Email verification confirmation
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct EmailVerificationConfirm {
    #[validate(length(min = 32, max = 256, message = "Invalid verification token"))]
    pub token: String,
}

/// Resend verification email request
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct ResendVerificationRequest {
    #[validate(email(message = "Invalid email format"))]
    pub email: String,
}

// Two-Factor Authentication models

/// Request to setup 2FA
#[derive(Debug, Serialize, Deserialize)]
pub struct TwoFactorSetupRequest {}

/// Request to enable 2FA
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct TwoFactorEnableRequest {
    #[validate(length(min = 6, max = 12, message = "Invalid 2FA code"))]
    pub code: String,
}

/// Request to disable 2FA
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct TwoFactorDisableRequest {
    #[validate(length(min = 6, max = 20, message = "Invalid 2FA code"))]
    pub code: String,
}

/// 2FA status response
#[derive(Debug, Serialize, Deserialize)]
pub struct TwoFactorStatusResponse {
    pub enabled: bool,
    pub has_backup_codes: bool,
    pub backup_codes_remaining: usize,
}

/// 2FA verification request
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct TwoFactorVerifyRequest {
    #[validate(length(min = 6, max = 20, message = "Invalid 2FA code"))]
    pub code: String,
}

/// Request to regenerate backup codes
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct RegenerateBackupCodesRequest {
    #[validate(length(min = 6, max = 20, message = "Invalid 2FA code"))]
    pub code: String,
}

// Passkey models

/// Start passkey registration
#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyRegistrationStart {
    pub username: String,
}

/// Finish passkey registration
#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyRegistrationFinish {
    pub username: String,
    pub credential: String,
    pub challenge: String,
    pub device_name: Option<String>,
}

/// Start passkey login
#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyLoginStart {
    pub username: String,
}

/// Finish passkey login
#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyLoginFinish {
    pub username: String,
    pub credential_id: String,
    pub authenticator_data: String,
    pub client_data_json: String,
    pub signature: String,
    pub challenge: String,
}

/// Stored passkey credential
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Passkey {
    pub id: Uuid,
    pub user_id: i64,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: i64,
    pub device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Passkey info for display
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct PasskeyInfo {
    pub id: Uuid,
    pub credential_id: String,
    pub device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Raw passkey info row before credential IDs are encoded for clients.
#[derive(Debug, FromRow)]
pub struct PasskeyInfoRow {
    pub id: Uuid,
    pub credential_id: Vec<u8>,
    pub device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Input for updating passkey
#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyUpdateInput {
    pub device_name: String,
}
