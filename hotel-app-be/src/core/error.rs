//! Unified error types for the hotel API
//!
//! This module contains the common error type used across all handlers.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};

tokio::task_local! {
    /// Correlation id of the in-flight request, set by the outermost
    /// application middleware (`record_request_metrics` in `routes/mod.rs`).
    /// `IntoResponse` echoes it into error bodies so a client-reported failure
    /// can be matched to server-side log lines; unset outside request scope
    /// (tests, schedulers) where the field is simply omitted.
    pub(crate) static REQUEST_ID: String
}

/// Echo the in-flight request's correlation id into an error body, when one is
/// in scope. No-op outside request scope.
fn with_request_id(body: Json<serde_json::Value>) -> Json<serde_json::Value> {
    let Json(mut value) = body;
    if let Some(object) = value.as_object_mut()
        && let Ok(id) = REQUEST_ID.try_with(|id| id.clone())
    {
        object.insert("request_id".to_string(), serde_json::Value::String(id));
    }
    Json(value)
}

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
    /// Guest self check-in was refused by the eligibility gates. The body
    /// carries `block_code` — the same stable code
    /// `GuestEkycStatusSummary.auto_checkin_block_code` reports — so the guest
    /// UI renders a localized explanation instead of matching English text.
    AutoCheckinBlocked { block_code: String, message: String },
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
            ApiError::AutoCheckinBlocked { message, .. } => {
                write!(f, "Bad request: {}", message)
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
        // Every body carries a stable snake_case `code` alongside the
        // human-readable `error` so clients can localize or route on the code
        // without matching English text.
        let (status, message, code) = match &self {
            ApiError::Database(msg) => {
                log::error!("Database error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our end. Please try again.".to_string(),
                    "server_error",
                )
            }
            ApiError::Unauthorized(msg) => (
                StatusCode::UNAUTHORIZED,
                polish_message(msg, "You need to sign in to continue."),
                "unauthorized",
            ),
            ApiError::Forbidden(msg) => (
                StatusCode::FORBIDDEN,
                polish_message(msg, "You don't have permission to do that."),
                "forbidden",
            ),
            ApiError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                polish_message(msg, "That request couldn't be processed."),
                "bad_request",
            ),
            ApiError::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                polish_message(msg, "We couldn't find what you were looking for."),
                "not_found",
            ),
            ApiError::Conflict(msg) => (
                StatusCode::CONFLICT,
                polish_message(msg, "That action conflicts with the current state."),
                "conflict",
            ),
            ApiError::Internal(msg) => {
                log::error!("Internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Something went wrong on our end. Please try again.".to_string(),
                    "server_error",
                )
            }
            ApiError::ServiceUnavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                polish_message(msg, "This service is temporarily unavailable."),
                "service_unavailable",
            ),
            ApiError::TooManyRequests(msg) => (
                StatusCode::TOO_MANY_REQUESTS,
                polish_message(msg, "Too many requests. Please slow down and try again."),
                "rate_limited",
            ),
            ApiError::TooManyRequestsRetryAfter(msg, _) => (
                StatusCode::TOO_MANY_REQUESTS,
                polish_message(msg, "Too many requests. Please slow down and try again."),
                "rate_limited",
            ),
            ApiError::ProfileIncomplete(_) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "Complete your profile before making a booking.".to_string(),
                "profile_incomplete",
            ),
            ApiError::TwoFactorEnrollmentRequired => (
                StatusCode::FORBIDDEN,
                "Your role requires two-factor authentication. Ask an administrator to \
                 help you finish setting it up."
                    .to_string(),
                "two_factor_enrollment_required",
            ),
            ApiError::GuestNameTaken => (
                StatusCode::CONFLICT,
                polish_message(
                    "This nickname is already used. Please choose another.",
                    "This nickname is already used. Please choose another.",
                ),
                "guest_name_taken",
            ),
            ApiError::AutoCheckinBlocked { message, .. } => (
                StatusCode::BAD_REQUEST,
                polish_message(message, "That request couldn't be processed."),
                "auto_checkin_blocked",
            ),
        };

        let mut body = serde_json::json!({
            "error": message,
            "code": code,
        });

        // Profile-incomplete errors additionally carry the missing field names
        // so the client can route the guest straight to profile completion,
        // deviating from the uniform `{"error": ..., "code": ...}` body the same
        // way TooManyRequestsRetryAfter deviates below to add its own header.
        if let ApiError::ProfileIncomplete(missing_fields) = &self {
            body["missing_profile_fields"] = serde_json::json!(missing_fields);
        }
        if let ApiError::AutoCheckinBlocked { block_code, .. } = &self {
            body["block_code"] = serde_json::json!(block_code);
        }

        let body = with_request_id(Json(body));

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
        match err {
            // `fetch_one` on a SELECT-by-id surfaces missing rows as RowNotFound;
            // that is a 404, not a server fault. Aggregates and INSERT..RETURNING
            // never produce it, so the blanket mapping is safe.
            sqlx::Error::RowNotFound => ApiError::NotFound("Resource not found".to_string()),
            other => ApiError::Database(other.to_string()),
        }
    }
}

// Convenience conversion from std::io::Error
impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::ApiError;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    async fn body_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        serde_json::from_slice(&bytes).expect("json")
    }

    /// Every variant must emit the stable snake_case `code` the frontend's
    /// error-code → message mapper consumes, paired with its HTTP status.
    /// Renaming a variant or inventing a new one fails here until a code is
    /// assigned — the table is the contract.
    #[tokio::test]
    async fn every_variant_emits_stable_snake_case_code() {
        let cases: Vec<(ApiError, StatusCode, &str)> = vec![
            (
                ApiError::Database("db down".into()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
            ),
            (
                ApiError::Internal("oops".into()),
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
            ),
            (
                ApiError::Unauthorized("no session".into()),
                StatusCode::UNAUTHORIZED,
                "unauthorized",
            ),
            (
                ApiError::Forbidden("not allowed".into()),
                StatusCode::FORBIDDEN,
                "forbidden",
            ),
            (
                ApiError::BadRequest("bad input".into()),
                StatusCode::BAD_REQUEST,
                "bad_request",
            ),
            (
                ApiError::NotFound("missing".into()),
                StatusCode::NOT_FOUND,
                "not_found",
            ),
            (
                ApiError::Conflict("duplicate".into()),
                StatusCode::CONFLICT,
                "conflict",
            ),
            (
                ApiError::ServiceUnavailable("gateway down".into()),
                StatusCode::SERVICE_UNAVAILABLE,
                "service_unavailable",
            ),
            (
                ApiError::TooManyRequests("slow down".into()),
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
            ),
            (
                ApiError::TooManyRequestsRetryAfter("slow down".into(), 30),
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
            ),
            (
                ApiError::ProfileIncomplete(vec!["phone".into()]),
                StatusCode::UNPROCESSABLE_ENTITY,
                "profile_incomplete",
            ),
            (
                ApiError::TwoFactorEnrollmentRequired,
                StatusCode::FORBIDDEN,
                "two_factor_enrollment_required",
            ),
            (
                ApiError::GuestNameTaken,
                StatusCode::CONFLICT,
                "guest_name_taken",
            ),
            (
                ApiError::AutoCheckinBlocked {
                    block_code: "ekyc_pending".into(),
                    message: "eKYC is pending approval.".into(),
                },
                StatusCode::BAD_REQUEST,
                "auto_checkin_blocked",
            ),
        ];

        for (error, expected_status, expected_code) in cases {
            let label = error.to_string();
            let response = error.into_response();
            assert_eq!(response.status(), expected_status, "{label}");
            let json = body_json(response).await;
            assert_eq!(json["code"], expected_code, "{label}");
            assert!(
                json["error"].as_str().is_some_and(|m| !m.is_empty()),
                "{label}: body must carry a non-empty error message"
            );
            let code = json["code"].as_str().unwrap();
            assert!(
                code.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
                "{label}: code {code} must be snake_case"
            );
        }
    }

    #[tokio::test]
    async fn profile_incomplete_keeps_missing_fields_alongside_code() {
        let response =
            ApiError::ProfileIncomplete(vec!["phone".into(), "email".into()]).into_response();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        let json = body_json(response).await;
        assert_eq!(json["code"], "profile_incomplete");
        assert_eq!(
            json["missing_profile_fields"],
            serde_json::json!(["phone", "email"])
        );
        assert!(json["error"].is_string());
    }

    #[tokio::test]
    async fn retry_after_variant_keeps_header_and_carries_code() {
        let response = ApiError::TooManyRequestsRetryAfter("slow down".into(), 42).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()["Retry-After"], "42");
        let json = body_json(response).await;
        assert_eq!(json["code"], "rate_limited");
        assert!(json["error"].is_string());
    }

    #[tokio::test]
    async fn guest_name_taken_is_conflict_with_stable_code() {
        let response = ApiError::GuestNameTaken.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let json = body_json(response).await;
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
