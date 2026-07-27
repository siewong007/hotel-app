//! eKYC validation helpers extracted from the service layer.

use std::fs;
use std::path::PathBuf;

use base64::{Engine as _, engine::general_purpose};
use chrono::{NaiveDate, Utc};

use crate::core::error::ApiError;
use crate::utils::sanitization::Sanitizer;
use crate::modules::ekyc::models::{
    EkycFieldComparison, EkycReasonCode, EkycReviewActionRequest, EkycVerification,
};

use super::models::EkycSubmissionRequest;

pub const EKYC_UPLOAD_DIR: &str = "private_uploads/ekyc";
pub const MAX_EKYC_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const REVIEW_SLA_HOURS: i64 = 24;
pub const REVIEW_SLA_WARNING_HOURS: i64 = 20;

pub fn sanitize_document_type(value: &str) -> Result<String, ApiError> {
    let sanitized: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(40)
        .collect();

    if sanitized.is_empty() {
        return Err(ApiError::BadRequest("Invalid document type".to_string()));
    }

    Ok(sanitized)
}

pub fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

pub fn validate_image_bytes(bytes: &[u8]) -> Result<&'static str, ApiError> {
    if bytes.is_empty() || bytes.len() > MAX_EKYC_IMAGE_BYTES {
        return Err(ApiError::BadRequest(
            "File size must be between 1 byte and 10MB".to_string(),
        ));
    }

    image_extension(bytes).ok_or_else(|| {
        ApiError::BadRequest("Only JPEG, PNG, or WebP image files are allowed".to_string())
    })
}

pub fn build_ekyc_filename(
    user_id: i64,
    image_type: &str,
    extension: &str,
) -> Result<String, ApiError> {
    let image_type = sanitize_document_type(image_type)?;
    Ok(format!(
        "{}_{}_{}_{}.{}",
        user_id,
        image_type,
        Utc::now().timestamp(),
        uuid::Uuid::new_v4(),
        extension
    ))
}

pub fn validate_existing_ekyc_path(path: &str, user_id: i64) -> Result<String, ApiError> {
    let prefix = format!("{EKYC_UPLOAD_DIR}/");
    if !path.starts_with(&prefix) {
        return Err(ApiError::BadRequest(
            "Invalid eKYC image reference".to_string(),
        ));
    }

    let filename = &path[prefix.len()..];
    if filename.contains('/')
        || filename.contains('\\')
        || !filename.starts_with(&format!("{user_id}_"))
    {
        return Err(ApiError::BadRequest(
            "Invalid eKYC image reference".to_string(),
        ));
    }

    let full_path = PathBuf::from(EKYC_UPLOAD_DIR).join(filename);
    if !full_path.exists() {
        return Err(ApiError::BadRequest(
            "Referenced eKYC image does not exist".to_string(),
        ));
    }

    Ok(path.to_string())
}

pub fn prepare_ekyc_image_reference(
    value: &str,
    user_id: i64,
    image_type: &str,
) -> Result<String, ApiError> {
    if value.starts_with(EKYC_UPLOAD_DIR) {
        validate_existing_ekyc_path(value, user_id)
    } else if value.starts_with("uploads/") {
        Err(ApiError::BadRequest(
            "Public upload paths are not accepted for eKYC images".to_string(),
        ))
    } else {
        save_base64_image(value, user_id, image_type)
    }
}

pub fn save_base64_image(
    base64_data: &str,
    user_id: i64,
    image_type: &str,
) -> Result<String, ApiError> {
    let upload_dir = PathBuf::from(EKYC_UPLOAD_DIR);
    fs::create_dir_all(&upload_dir)
        .map_err(|e| ApiError::Internal(format!("Failed to create upload directory: {}", e)))?;

    let parts: Vec<&str> = base64_data.split(',').collect();
    let data = if parts.len() == 2 {
        parts[1]
    } else {
        base64_data
    };

    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| ApiError::BadRequest(format!("Invalid base64 data: {}", e)))?;
    let extension = validate_image_bytes(&bytes)?;
    let filename = build_ekyc_filename(user_id, image_type, extension)?;
    let file_path = upload_dir.join(&filename);

    fs::write(&file_path, bytes)
        .map_err(|e| ApiError::Internal(format!("Failed to save image: {}", e)))?;

    Ok(format!("{EKYC_UPLOAD_DIR}/{}", filename))
}

/// Reject values that cannot fit their `ekyc_verifications` column.
///
/// `EkycSubmissionRequest` carries no `validator` derive, so without this an
/// over-long field reaches Postgres and surfaces as a 500 ("value too long for
/// type character varying") rather than a 400 the caller can act on. Bounds
/// mirror the column widths in `0001_v1_baseline.sql`.
pub fn validate_submission_field_lengths(req: &EkycSubmissionRequest) -> Result<(), ApiError> {
    let checks: [(&str, Option<&str>, usize); 8] = [
        ("full_name", Some(req.full_name.as_str()), 255),
        ("id_type", Some(req.id_type.as_str()), 80),
        ("id_number", Some(req.id_number.as_str()), 255),
        ("nationality", req.nationality.as_deref(), 100),
        ("phone", req.phone.as_deref(), 50),
        ("email", req.email.as_deref(), 255),
        ("id_issuing_country", req.id_issuing_country.as_deref(), 100),
        // current_address is TEXT (unbounded in Postgres); cap it anyway so a
        // multi-megabyte string cannot be parked in the review queue.
        ("current_address", req.current_address.as_deref(), 2000),
    ];

    for (field, value, max) in checks {
        let Some(value) = value else { continue };
        // Count characters, not bytes: the column limits are in characters and
        // a non-ASCII name must not be rejected for being multi-byte.
        if value.chars().count() > max {
            return Err(ApiError::BadRequest(format!(
                "{field} must be {max} characters or fewer"
            )));
        }
    }

    // Check what will actually be STORED, not what was sent: `full_name` is
    // persisted post-sanitization, so a name made entirely of control
    // characters passes a raw `trim().is_empty()` check and then lands in the
    // compliance record as an empty string.
    if Sanitizer::sanitize_guest_name(&req.full_name).is_empty() {
        return Err(ApiError::BadRequest("full_name is required".to_string()));
    }
    if req.id_number.trim().is_empty() {
        return Err(ApiError::BadRequest("id_number is required".to_string()));
    }
    // `sanitize_phone` keeps only digits and a leading '+', so a phone of pure
    // punctuation silently becomes "". Reject rather than store a blank.
    if let Some(phone) = req.phone.as_deref()
        && !phone.trim().is_empty()
        && Sanitizer::sanitize_phone(phone).is_empty()
    {
        return Err(ApiError::BadRequest(
            "phone must contain at least one digit".to_string(),
        ));
    }

    Ok(())
}

pub fn validate_dates(
    req: &EkycSubmissionRequest,
    today: NaiveDate,
) -> Result<(NaiveDate, NaiveDate, Option<NaiveDate>), ApiError> {
    validate_date_strings(
        &req.date_of_birth,
        &req.id_expiry_date,
        &req.id_issue_date,
        today,
    )
}

/// Shared date parsing/validation for both the guest-facing submission and the
/// admin-initiated creation flow. `today` is the hotel business day
/// (`core::db::hotel_today`), threaded in because this fn is sync.
pub fn validate_date_strings(
    date_of_birth: &str,
    id_expiry_date: &str,
    id_issue_date: &Option<String>,
    today: NaiveDate,
) -> Result<(NaiveDate, NaiveDate, Option<NaiveDate>), ApiError> {
    let date_of_birth = NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date of birth. Use YYYY-MM-DD".to_string()))?;
    let id_expiry_date = NaiveDate::parse_from_str(id_expiry_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid ID expiry date. Use YYYY-MM-DD".to_string()))?;
    let id_issue_date = if let Some(date_str) = id_issue_date {
        Some(
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|_| {
                ApiError::BadRequest("Invalid ID issue date. Use YYYY-MM-DD".to_string())
            })?,
        )
    } else {
        None
    };

    if id_expiry_date <= today {
        return Err(ApiError::BadRequest(
            "ID expiry date must be in the future".to_string(),
        ));
    }

    Ok((date_of_birth, id_expiry_date, id_issue_date))
}

pub fn normalize_action(action: &str) -> Result<&'static str, ApiError> {
    match action.trim() {
        "claim" => Ok("claim"),
        "assign" => Ok("assign"),
        "reassign" => Ok("reassign"),
        "add_internal_note" => Ok("add_internal_note"),
        "request_resubmission" => Ok("request_resubmission"),
        "approve" => Ok("approve"),
        "reject" => Ok("reject"),
        "escalate" => Ok("escalate"),
        "hold" => Ok("hold"),
        "release_hold" => Ok("release_hold"),
        "mark_potential_duplicate" => Ok("mark_potential_duplicate"),
        "mark_fraud" => Ok("mark_fraud"),
        "override_decision" => Ok("override_decision"),
        _ => Err(ApiError::BadRequest("Unsupported eKYC action".to_string())),
    }
}

pub fn permission_for_action(action: &str) -> &'static str {
    match action {
        "claim" | "assign" | "reassign" => "ekyc:assign",
        "approve" => "ekyc:approve",
        "reject" => "ekyc:reject",
        "escalate" => "ekyc:escalate",
        "request_resubmission" => "ekyc:request_resubmission",
        "override_decision" => "ekyc:override",
        _ => "ekyc:review",
    }
}

pub fn target_status_for_action(
    action: &str,
    current: &EkycVerification,
    input: &EkycReviewActionRequest,
) -> Result<String, ApiError> {
    match action {
        "claim" => Ok("in_review".to_string()),
        "assign" | "reassign" | "add_internal_note" => Ok(current.status.clone()),
        "request_resubmission" => Ok("additional_information_required".to_string()),
        "approve" => Ok("approved".to_string()),
        "reject" => Ok("rejected".to_string()),
        "escalate" | "mark_potential_duplicate" | "mark_fraud" => Ok("escalated".to_string()),
        "hold" => Ok("on_hold".to_string()),
        "release_hold" => Ok("in_review".to_string()),
        "override_decision" => {
            let target = input.target_status.as_deref().ok_or_else(|| {
                ApiError::BadRequest("Manual override requires a target status".to_string())
            })?;
            match normalize_status(target).as_str() {
                "approved" | "rejected" | "escalated" | "additional_information_required" => {
                    Ok(normalize_status(target))
                }
                _ => Err(ApiError::BadRequest(
                    "Unsupported manual override target status".to_string(),
                )),
            }
        }
        _ => Err(ApiError::BadRequest("Unsupported eKYC action".to_string())),
    }
}

pub fn normalize_status(status: &str) -> String {
    match status {
        "pending" => "submitted",
        "under_review" | "in_progress" => "in_review",
        "verified" => "approved",
        other => other,
    }
    .to_string()
}

pub fn validate_transition(from: &str, to: &str, action: &str) -> Result<(), ApiError> {
    let from = normalize_status(from);
    let to = normalize_status(to);
    if from == to {
        return Ok(());
    }

    if matches!(from.as_str(), "expired" | "void") {
        return Err(ApiError::Conflict(
            "Expired or void eKYC applications cannot be changed".to_string(),
        ));
    }

    if matches!(from.as_str(), "approved" | "rejected") && action != "override_decision" {
        return Err(ApiError::Conflict(
            "Final eKYC decisions require a controlled manual override".to_string(),
        ));
    }

    let allowed = match action {
        "claim" => {
            matches!(
                from.as_str(),
                "submitted" | "automated_review" | "pending_manual_review" | "escalated"
            ) && to == "in_review"
        }
        "request_resubmission" => !matches!(from.as_str(), "approved" | "rejected"),
        "approve" | "reject" => matches!(
            from.as_str(),
            "submitted" | "automated_review" | "pending_manual_review" | "in_review" | "escalated"
        ),
        "escalate" | "mark_potential_duplicate" | "mark_fraud" => {
            !matches!(from.as_str(), "approved" | "rejected")
        }
        "hold" => {
            matches!(
                from.as_str(),
                "submitted" | "pending_manual_review" | "in_review" | "escalated"
            ) && to == "on_hold"
        }
        "release_hold" => from == "on_hold" && to == "in_review",
        "override_decision" => true,
        _ => true,
    };

    if allowed {
        Ok(())
    } else {
        Err(ApiError::Conflict(format!(
            "Invalid eKYC transition from {} to {}",
            from, to
        )))
    }
}

pub fn validate_reason(
    action: &str,
    input: &EkycReviewActionRequest,
    reason_codes: &[EkycReasonCode],
) -> Result<(), ApiError> {
    let required = matches!(
        action,
        "approve"
            | "reject"
            | "escalate"
            | "request_resubmission"
            | "reassign"
            | "hold"
            | "override_decision"
            | "mark_potential_duplicate"
            | "mark_fraud"
    );
    if !required {
        return Ok(());
    }

    let code = input.reason_code.as_deref().map(str::trim).unwrap_or("");
    if code.is_empty() {
        return Err(ApiError::BadRequest(
            "A reason code is required for this eKYC action".to_string(),
        ));
    }

    let reason_code = reason_codes
        .iter()
        .find(|reason| reason.code == code)
        .ok_or_else(|| ApiError::BadRequest("Unknown eKYC reason code".to_string()))?;

    let details = input.reason.as_deref().map(str::trim).unwrap_or("");
    if reason_code.requires_details && details.len() < 5 {
        return Err(ApiError::BadRequest(
            "A detailed explanation is required for this reason code".to_string(),
        ));
    }

    Ok(())
}

pub fn customer_message_for_action(
    action: &str,
    input: &EkycReviewActionRequest,
    reason_codes: &[EkycReasonCode],
) -> Option<String> {
    if action != "request_resubmission" {
        return None;
    }

    input
        .customer_message
        .as_deref()
        .map(|message| sanitize_text(message, 1000))
        .or_else(|| {
            input.reason_code.as_ref().and_then(|code| {
                reason_codes
                    .iter()
                    .find(|reason| &reason.code == code)
                    .and_then(|reason| reason.customer_message_template.clone())
            })
        })
}

pub fn enforce_assignment_rules(
    action: &str,
    actor_id: i64,
    current: &EkycVerification,
    input: &EkycReviewActionRequest,
) -> Result<(), ApiError> {
    match action {
        "claim" if current.assigned_reviewer_id.is_some() => Err(ApiError::Conflict(
            "This eKYC application is already assigned".to_string(),
        )),
        "assign" | "reassign" if input.assigned_reviewer_id.is_none() => Err(ApiError::BadRequest(
            "A reviewer is required for assignment".to_string(),
        )),
        "approve" | "reject" | "request_resubmission" | "hold" | "escalate"
            if current.assigned_reviewer_id.is_some()
                && current.assigned_reviewer_id != Some(actor_id) =>
        {
            Err(ApiError::Forbidden(
                "Only the assigned reviewer can perform this eKYC action".to_string(),
            ))
        }
        _ => Ok(()),
    }
}

pub fn sensitive_field_value(
    application: &EkycVerification,
    field: &str,
) -> Result<Option<String>, ApiError> {
    match field {
        "id_number" => Ok(application.id_number.clone()),
        "full_name" => Ok(application.full_name.clone()),
        "date_of_birth" => Ok(application.date_of_birth.map(|date| date.to_string())),
        "email" => Ok(application.email.clone()),
        "phone" => Ok(application.phone.clone()),
        "current_address" => Ok(application.current_address.clone()),
        "ip_address" => Ok(application.ip_address.clone()),
        _ => Err(ApiError::BadRequest(
            "Unsupported sensitive eKYC field".to_string(),
        )),
    }
}

pub fn sanitize_text(value: &str, max_len: usize) -> String {
    ammonia::clean(value.trim())
        .chars()
        .take(max_len)
        .collect::<String>()
}

// ---------- Masking helpers ----------

pub fn mask_identifier(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 4 {
        return "****".to_string();
    }
    format!(
        "{}{}",
        "*".repeat(chars.len().saturating_sub(4)),
        chars[chars.len() - 4..].iter().collect::<String>()
    )
}

pub fn mask_email(value: &str) -> String {
    let Some((name, domain)) = value.split_once('@') else {
        return mask_identifier(value);
    };
    let first = name.chars().next().unwrap_or('*');
    format!("{first}***@{domain}")
}

pub fn mask_phone(value: &str) -> String {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() <= 4 {
        return "****".to_string();
    }
    format!("***{}", &digits[digits.len() - 4..])
}

pub fn mask_address(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        "Address on file".to_string()
    }
}

pub fn mask_ip(value: &str) -> String {
    if let Some((prefix, _)) = value.rsplit_once('.') {
        format!("{prefix}.***")
    } else {
        "masked".to_string()
    }
}

// ---------- Mapping/transformation helpers ----------

pub fn application_id(id: i64) -> String {
    format!("EKYC-{id:06}")
}

pub fn sort_column(sort_by: Option<&str>) -> &'static str {
    match sort_by.unwrap_or("submitted_at") {
        "application_id" | "id" => "e.id",
        "status" => "e.status",
        "risk_level" => "e.risk_level",
        "risk_score" => "e.risk_score",
        "full_name" => "e.full_name",
        "assigned_reviewer" => "reviewer.full_name",
        "updated_at" => "e.updated_at",
        _ => "e.submitted_at",
    }
}

pub fn sort_direction(sort_order: Option<&str>) -> &'static str {
    if sort_order.is_some_and(|value| value.eq_ignore_ascii_case("asc")) {
        "ASC"
    } else {
        "DESC"
    }
}

pub fn risk_rules(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .map(|rules| {
            rules
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub fn add_unique_rule(rules: &mut Vec<String>, rule: &str) {
    if !rules.iter().any(|existing| existing == rule) {
        rules.push(rule.to_string());
    }
}

pub fn differences_for_record(record: &EkycVerification) -> Vec<EkycFieldComparison> {
    let mut comparisons = Vec::new();
    let ocr = record.ocr_data.as_ref();
    push_comparison(
        &mut comparisons,
        "full_name",
        record.full_name.clone(),
        json_string(ocr, "full_name"),
    );
    push_comparison(
        &mut comparisons,
        "date_of_birth",
        record.date_of_birth.map(|date| date.to_string()),
        json_string(ocr, "date_of_birth"),
    );
    push_comparison(
        &mut comparisons,
        "id_number",
        record.id_number.as_deref().map(mask_identifier),
        json_string(ocr, "id_number").map(|value| mask_identifier(&value)),
    );
    push_comparison(
        &mut comparisons,
        "id_expiry_date",
        record.id_expiry_date.map(|date| date.to_string()),
        json_string(ocr, "id_expiry_date"),
    );
    comparisons
}

fn push_comparison(
    comparisons: &mut Vec<EkycFieldComparison>,
    field: &str,
    submitted_value: Option<String>,
    extracted_value: Option<String>,
) {
    if submitted_value.is_none() && extracted_value.is_none() {
        return;
    }

    let matches = submitted_value
        .as_deref()
        .zip(extracted_value.as_deref())
        .is_some_and(|(left, right)| left.eq_ignore_ascii_case(right));

    comparisons.push(EkycFieldComparison {
        field: field.to_string(),
        submitted_value,
        extracted_value,
        matches,
    });
}

fn json_string(value: Option<&serde_json::Value>, key: &str) -> Option<String> {
    value?
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
}

pub fn csv_row(values: &[String]) -> String {
    let escaped = values
        .iter()
        .map(|value| format!("\"{}\"", value.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(",");
    format!("{escaped}\n")
}

pub fn status_response(
    verification: &EkycVerification,
) -> crate::modules::ekyc::models::EkycStatusResponse {
    crate::modules::ekyc::models::EkycStatusResponse {
        id: verification.id,
        status: verification.status.clone(),
        self_checkin_enabled: verification.self_checkin_enabled,
        submitted_at: verification.submitted_at,
        verified_at: verification.verified_at,
        full_name: verification.full_name.clone(),
        id_type: verification.id_type.clone(),
        id_expiry_date: verification.id_expiry_date,
        customer_message: verification.customer_message.clone(),
        verification: None,
    }
}

pub fn dashboard_from_row(
    row: &crate::modules::ekyc::models::EkycDashboardRow,
) -> crate::modules::ekyc::models::EkycDashboardMetrics {
    crate::modules::ekyc::models::EkycDashboardMetrics {
        total_submitted: row.total_submitted,
        pending_review: row.pending_review,
        under_manual_review: row.under_manual_review,
        approved: row.approved,
        rejected: row.rejected,
        resubmission_required: row.resubmission_required,
        escalated_high_risk: row.escalated_high_risk,
        average_processing_minutes: row.average_processing_minutes,
        nearing_sla: row.nearing_sla,
        daily_trend: row.daily_trend,
        weekly_trend: row.weekly_trend,
        monthly_trend: row.monthly_trend,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_identity_numbers_by_default() {
        assert_eq!(mask_identifier("A123456789"), "******6789");
        assert_eq!(mask_identifier("123"), "****");
    }

    #[test]
    fn masks_long_identifier_correctly() {
        assert_eq!(mask_identifier("12345678"), "****5678");
        assert_eq!(mask_identifier("ab"), "****");
    }

    #[test]
    fn masks_email_address() {
        assert_eq!(mask_email("john.doe@example.com"), "j***@example.com");
        assert_eq!(mask_email("a@b.co"), "a***@b.co");
    }

    #[test]
    fn masks_email_without_at_sign_falls_back_to_identifier_masking() {
        // Falls back to mask_identifier which shows last 4 chars
        assert_eq!(mask_email("notanemail"), "******mail");
    }

    #[test]
    fn masks_phone_number() {
        assert_eq!(mask_phone("+60123456789"), "***6789");
        assert_eq!(mask_phone("12345"), "***2345");
        assert_eq!(mask_phone("12"), "****");
    }

    #[test]
    fn masks_address() {
        assert_eq!(mask_address("123 Main St"), "Address on file");
        assert_eq!(mask_address(""), "");
    }

    #[test]
    fn masks_ip_address() {
        assert_eq!(mask_ip("192.168.1.1"), "192.168.1.***");
        assert_eq!(mask_ip("10.0.0.5"), "10.0.0.***");
    }

    #[test]
    fn blocks_direct_final_status_changes_without_override() {
        let err = validate_transition("approved", "rejected", "reject").unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
    }

    #[test]
    fn allows_controlled_override_from_final_status() {
        assert!(validate_transition("approved", "rejected", "override_decision").is_ok());
    }

    #[test]
    fn blocks_expired_applications() {
        let err = validate_transition("expired", "in_review", "claim").unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
    }

    #[test]
    fn blocks_void_applications() {
        let err = validate_transition("void", "submitted", "reassign").unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
    }

    #[test]
    fn allows_same_status_noop() {
        assert!(validate_transition("in_review", "in_review", "claim").is_ok());
    }

    #[test]
    fn claim_from_submitted_is_valid() {
        assert!(validate_transition("submitted", "in_review", "claim").is_ok());
    }

    #[test]
    fn hold_from_submitted_is_valid() {
        assert!(validate_transition("submitted", "on_hold", "hold").is_ok());
    }

    #[test]
    fn release_hold_from_on_hold_is_valid() {
        assert!(validate_transition("on_hold", "in_review", "release_hold").is_ok());
    }

    #[test]
    fn release_hold_from_wrong_status_fails() {
        let err = validate_transition("submitted", "in_review", "release_hold").unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
    }

    #[test]
    fn image_extension_detects_jpeg() {
        assert_eq!(image_extension(&[0xff, 0xd8, 0xff, 0x00]), Some("jpg"));
    }

    #[test]
    fn image_extension_detects_png() {
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\n"), Some("png"));
    }

    #[test]
    fn image_extension_detects_webp() {
        let riff_data = b"RIFF\x00\x00\x00\x00WEBP";
        assert_eq!(image_extension(riff_data), Some("webp"));
    }

    #[test]
    fn image_extension_unknown_format() {
        assert_eq!(image_extension(b"GIF89a"), None);
    }

    #[test]
    fn sanitize_document_type_removes_invalid_chars() {
        assert_eq!(sanitize_document_type("passport").unwrap(), "passport");
        assert_eq!(
            sanitize_document_type("national-id_card").unwrap(),
            "national-id_card"
        );
    }

    #[test]
    fn sanitize_document_type_rejects_empty() {
        let err = sanitize_document_type("").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));
    }

    #[test]
    fn sanitize_document_type_truncates() {
        let long = "a".repeat(100);
        let result = sanitize_document_type(&long).unwrap();
        assert_eq!(result.len(), 40);
    }

    #[test]
    fn application_id_formats_correctly() {
        assert_eq!(application_id(1), "EKYC-000001");
        assert_eq!(application_id(123456), "EKYC-123456");
    }

    #[test]
    fn sort_column_defaults_to_submitted_at() {
        assert_eq!(sort_column(None), "e.submitted_at");
    }

    #[test]
    fn sort_column_maps_fields() {
        assert_eq!(sort_column(Some("status")), "e.status");
        assert_eq!(sort_column(Some("risk_level")), "e.risk_level");
        assert_eq!(sort_column(Some("assigned_reviewer")), "reviewer.full_name");
    }

    #[test]
    fn sort_direction_defaults_desc() {
        assert_eq!(sort_direction(None), "DESC");
        assert_eq!(sort_direction(Some("invalid")), "DESC");
    }

    #[test]
    fn sort_direction_case_insensitive() {
        assert_eq!(sort_direction(Some("asc")), "ASC");
        assert_eq!(sort_direction(Some("ASC")), "ASC");
    }

    #[test]
    fn csv_row_escapes_commas_and_quotes() {
        let row = csv_row(&["hello".to_string(), "world".to_string()]);
        assert_eq!(row, "\"hello\",\"world\"\n");
    }

    #[test]
    fn csv_row_handles_embedded_quotes() {
        let row = csv_row(&[r#"he"llo"#.to_string()]);
        assert_eq!(row, "\"he\"\"llo\"\n");
    }

    #[test]
    fn normalize_action_returns_ok_for_known() {
        assert_eq!(normalize_action("claim").unwrap(), "claim");
        assert_eq!(normalize_action("  approve  ").unwrap(), "approve");
        assert_eq!(
            normalize_action("override_decision").unwrap(),
            "override_decision"
        );
    }

    #[test]
    fn normalize_action_rejects_unknown() {
        let err = normalize_action("invalid_action").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));
    }

    #[test]
    fn permission_for_action_maps_correctly() {
        assert_eq!(permission_for_action("claim"), "ekyc:assign");
        assert_eq!(permission_for_action("approve"), "ekyc:approve");
        assert_eq!(permission_for_action("reject"), "ekyc:reject");
        assert_eq!(permission_for_action("add_internal_note"), "ekyc:review");
        assert_eq!(permission_for_action("unknown"), "ekyc:review");
    }

    #[test]
    fn risk_rules_parses_json_array() {
        let json = serde_json::json!(["rule1", "rule2"]);
        let rules = risk_rules(Some(&json));
        assert_eq!(rules, vec!["rule1", "rule2"]);
    }

    #[test]
    fn risk_rules_returns_empty_for_null() {
        assert!(risk_rules(None).is_empty());
    }

    #[test]
    fn add_unique_rule_adds_once() {
        let mut rules = vec!["existing".to_string()];
        add_unique_rule(&mut rules, "new");
        assert_eq!(rules.len(), 2);
        add_unique_rule(&mut rules, "new");
        assert_eq!(rules.len(), 2);
    }
}
