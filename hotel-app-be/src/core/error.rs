//! Unified error types for the hotel API
//!
//! This module contains the common error type used across all handlers.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};

/// API Error type used across all handlers
#[derive(Debug)]
pub enum ApiError {
    /// Database operation failed
    Database(String),
    /// Authentication required or failed
    Unauthorized(String),
    /// User lacks permission for this action
    Forbidden(String),
    /// Invalid request data
    BadRequest(String),
    /// Resource not found
    NotFound(String),
    /// Resource already exists (conflict)
    Conflict(String),
    /// Internal server error
    Internal(String),
    /// A dependency (e.g. an unconfigured or unreachable payment gateway) is
    /// temporarily unavailable.
    ServiceUnavailable(String),
    /// Rate limit exceeded (message, optional retry_after_secs)
    TooManyRequests(String),
    /// Rate limit exceeded with Retry-After header
    TooManyRequestsRetryAfter(String, u64),
    /// A guest tried to book before supplying the contact details bookings require.
    /// Carries the missing field names so the client can route them to completion.
    ProfileIncomplete(Vec<String>),
    /// A sign-in succeeded but the account's role requires two-factor
    /// authentication and no factor is enrolled, with the enrolment grace
    /// period already expired. Stable `code` so the sign-in page can route to
    /// enrolment without matching English text.
    TwoFactorEnrollmentRequired,
    /// Anonymous booking nickname collides with `idx_guests_nick_name_unique`
    /// (or the pre-rename `idx_guests_full_name_unique`). Stable `code` so the
    /// public form can highlight the nickname without matching English text.
    GuestNameTaken,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Database(msg) => write!(f, "Database error: {}", msg),
            ApiError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            ApiError::Forbidden(msg) => write!(f, "Forbidden: {}", msg),
            ApiError::BadRequest(msg) => write!(f, "Bad request: {}", msg),
            ApiError::NotFound(msg) => write!(f, "Not found: {}", msg),
            ApiError::Conflict(msg) => write!(f, "Conflict: {}", msg),
            ApiError::Internal(msg) => write!(f, "Internal error: {}", msg),
            ApiError::ServiceUnavailable(msg) => write!(f, "Service unavailable: {}", msg),
            ApiError::TooManyRequests(msg) => write!(f, "Too many requests: {}", msg),
            ApiError::TooManyRequestsRetryAfter(msg, secs) => {
                write!(f, "Too many requests (retry after {}s): {}", secs, msg)
            }
            ApiError::ProfileIncomplete(fields) => {
                write!(f, "Profile incomplete: missing {}", fields.join(", "))
            }
            ApiError::GuestNameTaken => write!(f, "Conflict: nickname taken"),
            ApiError::TwoFactorEnrollmentRequired => {
                write!(f, "Forbidden: two-factor enrolment required")
            }
        }
    }
}

impl std::error::Error for ApiError {}

/// Normalize a client-facing error message into one consistent product voice:
/// trimmed, free of leaked internal prefixes, sentence-cased, and ending with
/// terminal punctuation. Call sites supply the wording; this guarantees the
/// mechanical polish so every pop-out reads the same way.
fn polish_message(raw: &str, fallback: &str) -> String {
    let mut msg = raw.trim();

    // Strip internal "Category: " prefixes that occasionally leak from
    // Display/`format!` into client text (e.g. "Bad request: ...").
    for prefix in [
        "Error: ",
        "Bad request: ",
        "Bad Request: ",
        "Internal error: ",
        "Database error: ",
        "Conflict: ",
        "Not found: ",
        "Unauthorized: ",
        "Forbidden: ",
    ] {
        if let Some(stripped) = msg.strip_prefix(prefix) {
            msg = stripped.trim();
        }
    }

    if msg.is_empty() {
        return fallback.to_string();
    }

    // Sentence-case the first character (leave acronyms like "2FA"/"ID" alone
    // by only uppercasing, never lowercasing the rest).
    let mut out = String::with_capacity(msg.len() + 1);
    let mut chars = msg.chars();
    if let Some(first) = chars.next() {
        out.extend(first.to_uppercase());
        out.push_str(chars.as_str());
    }

    // Ensure a single terminal punctuation mark.
    if !out.ends_with(['.', '!', '?']) {
        out.push('.');
    }
    out
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::Database(msg) => {
                log::error!("Database error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our end. Please try again.".to_string(),
                )
            }
            ApiError::Unauthorized(msg) => (
                StatusCode::UNAUTHORIZED,
                polish_message(msg, "You need to sign in to continue."),
            ),
            ApiError::Forbidden(msg) => (
                StatusCode::FORBIDDEN,
                polish_message(msg, "You don't have permission to do that."),
            ),
            ApiError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                polish_message(msg, "That request couldn't be processed."),
            ),
            ApiError::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                polish_message(msg, "We couldn't find what you were looking for."),
            ),
            ApiError::Conflict(msg) => (
                StatusCode::CONFLICT,
                polish_message(msg, "That action conflicts with the current state."),
            ),
            ApiError::Internal(msg) => {
                log::error!("Internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our end. Please try again.".to_string(),
                )
            }
            ApiError::ServiceUnavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                polish_message(msg, "This service is temporarily unavailable."),
            ),
            ApiError::TooManyRequests(msg) => (
                StatusCode::TOO_MANY_REQUESTS,
                polish_message(msg, "Too many requests. Please slow down and try again."),
            ),
            ApiError::TooManyRequestsRetryAfter(msg, _) => (
                StatusCode::TOO_MANY_REQUESTS,
                polish_message(msg, "Too many requests. Please slow down and try again."),
            ),
            ApiError::ProfileIncomplete(_) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "Complete your profile before making a booking.".to_string(),
            ),
            ApiError::TwoFactorEnrollmentRequired => (
                StatusCode::FORBIDDEN,
                "Your role requires two-factor authentication. Ask an administrator to \
                 help you finish setting it up."
                    .to_string(),
            ),
            ApiError::GuestNameTaken => (
                StatusCode::CONFLICT,
                polish_message(
                    "This nickname is already used. Please choose another.",
                    "This nickname is already used. Please choose another.",
                ),
            ),
        };

        // Profile-incomplete errors carry the missing field names so the client
        // can route the guest straight to profile completion, deviating from the
        // uniform `{"error": ...}` body the same way TooManyRequestsRetryAfter
        // deviates below to add its own header.
        if let ApiError::ProfileIncomplete(missing_fields) = &self {
            let body = Json(serde_json::json!({
                "error": message,
                "code": "profile_incomplete",
                "missing_profile_fields": missing_fields
            }));
            return (status, body).into_response();
        }

        if let ApiError::TwoFactorEnrollmentRequired = &self {
            let body = Json(serde_json::json!({
                "error": message,
                "code": "two_factor_enrollment_required"
            }));
            return (status, body).into_response();
        }

        if let ApiError::GuestNameTaken = &self {
            let body = Json(serde_json::json!({
                "error": message,
                "code": "guest_name_taken"
            }));
            return (status, body).into_response();
        }

        let body = Json(serde_json::json!({
            "error": message
        }));

        // Add Retry-After header for rate limit errors
        if let ApiError::TooManyRequestsRetryAfter(_, secs) = &self {
            let mut response = (status, body).into_response();
            response.headers_mut().insert(
                "Retry-After",
                axum::http::HeaderValue::from_str(&secs.to_string()).unwrap(),
            );
            return response;
        }

        (status, body).into_response()
    }
}

// Convenience conversion from sqlx::Error
impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::Database(err.to_string())
    }
}

// Convenience conversion from std::io::Error
impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}

#[cfg(test)]
mod guest_name_taken_tests {
    use super::ApiError;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    #[tokio::test]
    async fn guest_name_taken_is_conflict_with_stable_code() {
        let response = ApiError::GuestNameTaken.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
        assert_eq!(json["code"], "guest_name_taken");
        assert!(
            json["error"]
                .as_str()
                .unwrap()
                .to_lowercase()
                .contains("nickname")
        );
    }
}
