//! `ApiError` → `tonic::Status` rendering with google.rpc error details.
//!
//! The REST side of the codebase renders [`ApiError`] into HTTP status codes;
//! this is the gRPC renderer for the same enum. Variant→code mapping is
//! fixed here so both transports express identical error semantics. Detail
//! payloads use `google.rpc` types via tonic-types so structured clients
//! (Connect-ES, grpcurl) can read `ErrorInfo`/`BadRequest`/`RetryInfo`
//! without parsing message strings.

use std::collections::HashMap;
use std::time::Duration;

use tonic::{Code, Status};
use tonic_types::{ErrorDetails, StatusExt};

use crate::core::error::ApiError;

/// Domain reported in `google.rpc.ErrorInfo`. `hotel.local` is a private
/// identifier, not a resolvable hostname — it names the service boundary for
/// clients aggregating errors from multiple backends.
const DOMAIN: &str = "hotel.local";

fn info(reason: &str) -> ErrorDetails {
    ErrorDetails::with_error_info(reason, DOMAIN, HashMap::new())
}

pub fn to_status(err: ApiError) -> Status {
    match err {
        ApiError::Unauthorized(msg) => Status::unauthenticated(msg),
        ApiError::Forbidden(msg) => Status::permission_denied(msg),
        ApiError::NotFound(msg) => Status::not_found(msg),
        ApiError::BadRequest(msg) => Status::with_error_details(
            Code::InvalidArgument,
            msg.clone(),
            ErrorDetails::with_bad_request_violation("", msg),
        ),
        ApiError::Conflict(msg) => {
            Status::with_error_details(Code::AlreadyExists, msg, info("CONFLICT"))
        }
        ApiError::TooManyRequests(msg) => Status::with_error_details(
            Code::ResourceExhausted,
            msg,
            ErrorDetails::with_retry_info(None),
        ),
        ApiError::TooManyRequestsRetryAfter(msg, secs) => Status::with_error_details(
            Code::ResourceExhausted,
            msg,
            ErrorDetails::with_retry_info(Some(Duration::from_secs(secs))),
        ),
        ApiError::ServiceUnavailable(msg) => Status::unavailable(msg),
        ApiError::ProfileIncomplete(fields) => Status::with_error_details(
            Code::FailedPrecondition,
            "Profile is incomplete",
            ErrorDetails::with_error_info(
                "PROFILE_INCOMPLETE",
                DOMAIN,
                fields
                    .into_iter()
                    .enumerate()
                    .map(|(i, f)| (format!("missing_field_{i}"), f))
                    .collect::<HashMap<String, String>>(),
            ),
        ),
        ApiError::TwoFactorEnrollmentRequired => Status::with_error_details(
            Code::FailedPrecondition,
            "Two-factor enrolment is required",
            info("TWO_FACTOR_ENROLLMENT_REQUIRED"),
        ),
        ApiError::GuestNameTaken => Status::with_error_details(
            Code::AlreadyExists,
            "Guest name is already taken",
            info("GUEST_NAME_TAKEN"),
        ),
        ApiError::AutoCheckinBlocked {
            block_code,
            message,
        } => Status::with_error_details(Code::FailedPrecondition, message, info(&block_code)),
        // A failed optimistic-concurrency precondition is gRPC's ABORTED:
        // the client should re-read and retry.
        ApiError::StaleWrite { message, .. } => {
            Status::with_error_details(Code::Aborted, message, info("STALE_WRITE"))
        }
        // Internal failures keep REST's rule verbatim: a generic client-facing
        // message, never the underlying detail (which is logged server-side).
        ApiError::Database(_) | ApiError::Internal(_) => {
            Status::internal("An internal error occurred")
        }
    }
}
