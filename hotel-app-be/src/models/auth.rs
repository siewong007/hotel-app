//! Authentication-related models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::rbac::RouteAccessPolicy;
use super::user::UserResponse;
use crate::utils::sanitization::Sanitizer;
use validator::{Validate, ValidationError, ValidationErrors};

/// Login request
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(length(min = 1, message = "Username is required"))]
    pub username: String,
    #[validate(length(min = 1, message = "Password is required"))]
    pub password: String,
    pub totp_code: Option<String>,
}

/// Google Identity Services credential exchange request.
#[allow(dead_code)]
#[derive(Deserialize, Validate)]
pub struct GoogleLoginRequest {
    #[validate(length(min = 1, message = "Google credential is required"))]
    pub credential: String,
}

// A Google credential is a bearer token and must not appear in debug logs.
impl std::fmt::Debug for GoogleLoginRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleLoginRequest")
            .field("credential", &"<redacted>")
            .finish()
    }
}

/// Guest contact details supplied after Google sign-in.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct CompleteGuestProfileRequest {
    #[validate(
        length(max = 50, message = "First name must be at most 50 characters"),
        custom(function = "validate_trimmed_guest_name")
    )]
    pub first_name: String,
    #[validate(
        length(max = 50, message = "Last name must be at most 50 characters"),
        custom(function = "validate_trimmed_guest_name")
    )]
    pub last_name: String,
    #[validate(custom(function = "validate_guest_phone"))]
    pub phone: String,
    #[validate(length(max = 255, message = "Address is too long"))]
    pub address_line1: Option<String>,
}

impl CompleteGuestProfileRequest {
    #[allow(dead_code)]
    pub fn normalize_and_validate(&mut self) -> Result<(), ValidationErrors> {
        self.first_name = Sanitizer::sanitize_guest_name(&self.first_name);
        self.last_name = Sanitizer::sanitize_guest_name(&self.last_name);
        self.phone = Sanitizer::sanitize_phone(&self.phone);
        self.address_line1 = self
            .address_line1
            .take()
            .map(|address| Sanitizer::sanitize_text(address.trim()))
            .filter(|address| !address.is_empty());

        self.validate()
    }
}

fn validate_trimmed_guest_name(value: &str) -> Result<(), ValidationError> {
    if Sanitizer::sanitize_guest_name(value).is_empty() {
        return Err(ValidationError::new("required"));
    }

    Ok(())
}

fn validate_guest_phone(value: &str) -> Result<(), ValidationError> {
    let value = value.trim();
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_digit() || matches!(character, '+' | ' ' | '-' | '(' | ')')
        })
        || value.matches('+').count() > 1
        || value.find('+').is_some_and(|index| index != 0)
    {
        return Err(ValidationError::new("invalid_phone"));
    }

    let phone = Sanitizer::sanitize_phone(value);
    let digits = phone.trim_start_matches('+');

    if (8..=15).contains(&digits.len())
        && digits.chars().all(|character| character.is_ascii_digit())
    {
        Ok(())
    } else {
        Err(ValidationError::new("invalid_phone"))
    }
}

#[cfg(test)]
mod google_guest_profile_tests {
    use super::CompleteGuestProfileRequest;
    use validator::Validate;

    fn request(first_name: &str, last_name: &str, phone: &str) -> CompleteGuestProfileRequest {
        CompleteGuestProfileRequest {
            first_name: first_name.to_string(),
            last_name: last_name.to_string(),
            phone: phone.to_string(),
            address_line1: None,
        }
    }

    #[test]
    fn complete_guest_profile_rejects_whitespace_only_names() {
        assert!(request("  ", "Rahman", "+60123456789").validate().is_err());
        assert!(request("Aisha", "\t", "+60123456789").validate().is_err());
    }

    #[test]
    fn complete_guest_profile_rejects_a_phone_without_digits() {
        assert!(
            request("Aisha", "Rahman", "phone-number")
                .validate()
                .is_err()
        );
    }

    #[test]
    fn complete_guest_profile_rejects_letters_in_a_phone_number() {
        assert!(
            request("Aisha", "Rahman", "abc12345678")
                .validate()
                .is_err()
        );
    }

    #[test]
    fn complete_guest_profile_requires_eight_to_fifteen_phone_digits() {
        assert!(request("Aisha", "Rahman", "1234567").validate().is_err());
        assert!(
            request("Aisha", "Rahman", "1234567890123456")
                .validate()
                .is_err()
        );
        assert!(request("Aisha", "Rahman", "12345678").validate().is_ok());
        assert!(
            request("Aisha", "Rahman", "123456789012345")
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn complete_guest_profile_normalizes_a_formatted_valid_phone() {
        let mut input = request(" Aisha ", " Rahman ", "+60 (12) 345-6789");

        input.normalize_and_validate().unwrap();

        assert_eq!(input.first_name, "Aisha");
        assert_eq!(input.last_name, "Rahman");
        assert_eq!(input.phone, "+60123456789");
    }
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
    /// Set only when this login consumed a 2FA recovery code: how many
    /// recovery codes remain afterwards, so the client can warn the user
    /// to regenerate when the supply runs low.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_codes_remaining: Option<usize>,
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

/// A currently active login session, backed by a rotating refresh-token record.
/// The refresh-token value itself is never included in this response.
#[derive(Debug, Serialize, Deserialize)]
pub struct UserSessionInfo {
    pub id: String,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub is_current: bool,
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
    // The 64-hex-char challenge minted by /2fa/setup (AuthService::generate_refresh_token);
    // proves the enable follows a setup on this account within the challenge TTL.
    #[validate(length(equal = 64, message = "Invalid challenge code"))]
    pub challenge_code: String,
}

/// Request to disable 2FA
#[derive(Debug, Serialize, Deserialize, Validate)]
pub struct TwoFactorDisableRequest {
    // Accepts either a 6-digit TOTP code or a 23-char dashed recovery code
    // (XXXXX-XXXXX-XXXXX-XXXXX as produced by generate_backup_codes).
    #[validate(length(min = 6, max = 32, message = "Invalid 2FA code"))]
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
    /// Step-up re-authentication. A passkey is a permanent credential that
    /// satisfies 2FA on its own, so minting one must cost more than an
    /// already-open session — otherwise any hijacked session becomes a
    /// durable, 2FA-bypassing account takeover.
    #[serde(default)]
    pub password: Option<String>,
    /// Alternative to `password` for accounts with 2FA enabled.
    #[serde(default)]
    pub totp_code: Option<String>,
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
