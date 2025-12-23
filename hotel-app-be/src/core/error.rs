//! Unified error types for the hotel API
//!
//! This module contains the common error type used across all handlers.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response, Json},
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
    /// Internal server error
    Internal(String),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Database(msg) => write!(f, "Database error: {}", msg),
            ApiError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            ApiError::Forbidden(msg) => write!(f, "Forbidden: {}", msg),
            ApiError::BadRequest(msg) => write!(f, "Bad request: {}", msg),
            ApiError::NotFound(msg) => write!(f, "Not found: {}", msg),
            ApiError::Internal(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::Database(msg) => (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", msg)),
            ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        let body = Json(serde_json::json!({
            "error": message
        }));

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
