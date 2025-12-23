//! Authentication-related models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::user::User;

/// Login request
#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
    pub totp_code: Option<String>,
}

/// Authentication response after login
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: User,
    pub roles: Vec<String>,
    pub permissions: Vec<String>,
    pub is_first_login: bool,
}

/// Refresh token request
#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

/// Refresh token response
#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
}

/// Registration request
#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    pub full_name: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
}

/// Email verification confirmation
#[derive(Debug, Serialize, Deserialize)]
pub struct EmailVerificationConfirm {
    pub token: String,
}

/// Resend verification email request
#[derive(Debug, Serialize, Deserialize)]
pub struct ResendVerificationRequest {
    pub email: String,
}

// Two-Factor Authentication models

/// Request to setup 2FA
#[derive(Debug, Serialize, Deserialize)]
pub struct TwoFactorSetupRequest {
    pub password: String,
}

/// Request to enable 2FA
#[derive(Debug, Serialize, Deserialize)]
pub struct TwoFactorEnableRequest {
    pub code: String,
    pub secret: String,
}

/// Request to disable 2FA
#[derive(Debug, Serialize, Deserialize)]
pub struct TwoFactorDisableRequest {
    pub password: String,
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
#[derive(Debug, Serialize, Deserialize)]
pub struct TwoFactorVerifyRequest {
    pub code: String,
}

/// Request to regenerate backup codes
#[derive(Debug, Serialize, Deserialize)]
pub struct RegenerateBackupCodesRequest {
    pub password: String,
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

/// Input for updating passkey
#[derive(Debug, Serialize, Deserialize)]
pub struct PasskeyUpdateInput {
    pub device_name: String,
}
