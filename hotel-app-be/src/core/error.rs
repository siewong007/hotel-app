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
    /// Rate limit exceeded (message, optional retry_after_secs)
    TooManyRequests(String),
    /// Rate limit exceeded with Retry-After header
    TooManyRequestsRetryAfter(String, u64),
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
            ApiError::TooManyRequests(msg) => write!(f, "Too many requests: {}", msg),
            ApiError::TooManyRequestsRetryAfter(msg, secs) => {
                write!(f, "Too many requests (retry after {}s): {}", secs, msg)
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
            ApiError::TooManyRequests(msg) => (
                StatusCode::TOO_MANY_REQUESTS,
                polish_message(msg, "Too many requests. Please slow down and try again."),
            ),
            ApiError::TooManyRequestsRetryAfter(msg, _) => (
                StatusCode::TOO_MANY_REQUESTS,
                polish_message(msg, "Too many requests. Please slow down and try again."),
            ),
        };

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
