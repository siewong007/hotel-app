//! eKYC workflows and private document helpers.

use std::fs;
use std::path::PathBuf;

use base64::{Engine as _, engine::general_purpose};
use chrono::{Local, NaiveDate, Utc};
use serde_json::Value;

use crate::core::auth::AuthService;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::middleware::check_permission;
use crate::models::{
    EkycAdminListResponse, EkycApplicationDetail, EkycApplicationSummary,
    EkycApplicationSummaryRow, EkycDashboardMetrics, EkycDashboardRow, EkycDocumentAvailability,
    EkycFieldComparison, EkycListQuery, EkycReasonCode, EkycReviewActionRequest,
    EkycSensitiveRevealRequest, EkycSensitiveRevealResponse, EkycStatusResponse,
    EkycSubmissionRequest, EkycVerification, EkycVerificationUpdate, SelfCheckinRequest,
};
use crate::repositories::ekyc::{
    EkycActionUpdate, EkycHistoryInsert, EkycNoteInsert, EkycRepository, NewEkycVerification,
};
use crate::services::audit::AuditLog;

pub const EKYC_UPLOAD_DIR: &str = "private_uploads/ekyc";
pub const MAX_EKYC_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const REVIEW_SLA_HOURS: i64 = 24;
const REVIEW_SLA_WARNING_HOURS: i64 = 20;

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

pub async fn submit_ekyc(
    pool: &DbPool,
    user_id: i64,
    req: EkycSubmissionRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EkycStatusResponse, ApiError> {
    let (user_type, guest_id) = EkycRepository::user_type_and_guest_id(pool, user_id).await?;
    if user_type != "guest" {
        return Err(ApiError::BadRequest(
            "Only guest users can submit eKYC verification".to_string(),
        ));
    }

    let guest_id = guest_id.ok_or_else(|| {
        ApiError::BadRequest("Your account is not linked to a guest profile".to_string())
    })?;

    if EkycRepository::exists_open_for_guest(pool, guest_id).await? {
        return Err(ApiError::BadRequest(
            "You already have an active eKYC verification. Please check your status.".to_string(),
        ));
    }

    let date_of_birth = NaiveDate::parse_from_str(&req.date_of_birth, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date of birth. Use YYYY-MM-DD".to_string()))?;
    let id_expiry_date = NaiveDate::parse_from_str(&req.id_expiry_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid ID expiry date. Use YYYY-MM-DD".to_string()))?;
    let id_issue_date = if let Some(date_str) = &req.id_issue_date {
        Some(
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|_| {
                ApiError::BadRequest("Invalid ID issue date. Use YYYY-MM-DD".to_string())
            })?,
        )
    } else {
        None
    };

    if id_expiry_date <= Local::now().date_naive() {
        return Err(ApiError::BadRequest(
            "ID expiry date must be in the future".to_string(),
        ));
    }

    let id_front_path = prepare_ekyc_image_reference(&req.id_front_image, user_id, "id_front")?;
    let id_back_path = req
        .id_back_image
        .as_ref()
        .map(|img| prepare_ekyc_image_reference(img, user_id, "id_back"))
        .transpose()?;
    let selfie_path = prepare_ekyc_image_reference(&req.selfie_image, user_id, "selfie")?;
    let proof_path = req
        .proof_of_address
        .as_ref()
        .map(|img| prepare_ekyc_image_reference(img, user_id, "proof"))
        .transpose()?;

    let verification = EkycRepository::insert_verification(
        pool,
        NewEkycVerification {
            user_id,
            guest_id,
            full_name: &req.full_name,
            date_of_birth,
            nationality: &req.nationality,
            phone: &req.phone,
            email: &req.email,
            current_address: &req.current_address,
            id_type: &req.id_type,
            id_number: &req.id_number,
            id_issuing_country: &req.id_issuing_country,
            id_issue_date,
            id_expiry_date,
            id_front_path: &id_front_path,
            id_back_path,
            selfie_path: &selfie_path,
            proof_path,
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        Some(user_id),
        "ekyc_submitted",
        "ekyc_verification",
        Some(verification.id),
        Some(serde_json::json!({ "status": verification.status })),
        ip_address,
        user_agent,
    )
    .await;

    Ok(status_response(verification))
}

pub async fn get_ekyc_status(
    pool: &DbPool,
    user_id: i64,
) -> Result<Option<EkycStatusResponse>, ApiError> {
    let guest_id = EkycRepository::guest_id_for_user(pool, user_id)
        .await?
        .ok_or_else(|| {
            ApiError::BadRequest("Your account is not linked to a guest profile".to_string())
        })?;

    Ok(EkycRepository::find_by_guest(pool, guest_id)
        .await?
        .map(status_response))
}

pub async fn admin_dashboard(pool: &DbPool) -> Result<EkycDashboardMetrics, ApiError> {
    Ok(dashboard_from_row(
        EkycRepository::dashboard_metrics(pool).await?,
    ))
}

pub async fn list_admin_applications(
    pool: &DbPool,
    actor_id: i64,
    params: EkycListQuery,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EkycAdminListResponse, ApiError> {
    check_permission(pool, actor_id, "ekyc:read").await?;
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(25).clamp(1, 100);
    let offset = (page - 1) * page_size;
    let sort_column = sort_column(params.sort_by.as_deref());
    let sort_direction = sort_direction(params.sort_order.as_deref());

    let (total, rows) = EkycRepository::list_admin(
        pool,
        &params,
        sort_column,
        sort_direction,
        page_size,
        offset,
    )
    .await?;
    let metrics = dashboard_from_row(EkycRepository::dashboard_metrics(pool).await?);

    EkycRepository::insert_access_event(
        pool,
        None,
        actor_id,
        "application_list_viewed",
        serde_json::json!({ "page": page, "page_size": page_size }),
        ip_address,
        user_agent,
    )
    .await?;

    let total_pages = if total == 0 {
        0
    } else {
        (total + page_size - 1) / page_size
    };

    Ok(EkycAdminListResponse {
        data: rows.into_iter().map(summary_from_row).collect(),
        metrics,
        total,
        page,
        page_size,
        total_pages,
    })
}

pub async fn get_admin_application(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EkycApplicationDetail, ApiError> {
    check_permission(pool, actor_id, "ekyc:read").await?;
    let include_provider_raw =
        AuthService::check_permission(pool, actor_id, "ekyc:view_provider_raw")
            .await
            .unwrap_or(false);

    let application = get_ekyc_by_id(pool, id).await?;
    let detail = detail_from_record(pool, application, include_provider_raw).await?;

    EkycRepository::insert_access_event(
        pool,
        Some(id),
        actor_id,
        "application_viewed",
        serde_json::json!({ "application_id": id }),
        ip_address,
        user_agent,
    )
    .await?;

    Ok(detail)
}

pub async fn list_ekyc(pool: &DbPool) -> Result<Vec<EkycApplicationSummary>, ApiError> {
    let params = EkycListQuery {
        status: None,
        submission_from: None,
        submission_to: None,
        risk_level: None,
        verification_method: None,
        assigned_reviewer_id: None,
        nationality: None,
        country: None,
        document_type: None,
        provider_result: None,
        manual_review_required: None,
        search: None,
        sort_by: None,
        sort_order: None,
        page: Some(1),
        page_size: Some(100),
    };
    let (_total, rows) =
        EkycRepository::list_admin(pool, &params, "e.submitted_at", "DESC", 100, 0).await?;
    Ok(rows.into_iter().map(summary_from_row).collect())
}

pub async fn get_ekyc_by_id(pool: &DbPool, id: i64) -> Result<EkycVerification, ApiError> {
    EkycRepository::find_by_id(pool, id)
        .await?
        .ok_or_else(|| ApiError::NotFound("eKYC verification not found".to_string()))
}

pub async fn get_document_path(pool: &DbPool, id: i64, kind: &str) -> Result<String, ApiError> {
    let column = match kind {
        "id-front" => "id_front_image_path",
        "id-back" => "id_back_image_path",
        "selfie" => "selfie_image_path",
        "proof-of-address" => "proof_of_address_path",
        _ => return Err(ApiError::BadRequest("Invalid document type".to_string())),
    };

    EkycRepository::document_path(pool, id, column)
        .await?
        .ok_or_else(|| ApiError::NotFound("Document not found".to_string()))
}

pub async fn record_document_download(
    pool: &DbPool,
    actor_id: i64,
    application_id: i64,
    kind: &str,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), ApiError> {
    check_permission(pool, actor_id, "ekyc:download_documents").await?;
    EkycRepository::insert_access_event(
        pool,
        Some(application_id),
        actor_id,
        "document_downloaded",
        serde_json::json!({ "document_kind": kind }),
        ip_address.clone(),
        user_agent.clone(),
    )
    .await?;

    AuditLog::log_event(
        pool,
        Some(actor_id),
        "ekyc_document_downloaded",
        "ekyc_verification",
        Some(application_id),
        Some(serde_json::json!({ "document_kind": kind })),
        ip_address,
        user_agent,
    )
    .await
}

pub async fn update_ekyc(
    pool: &DbPool,
    id: i64,
    admin_id: i64,
    update: EkycVerificationUpdate,
) -> Result<EkycVerification, ApiError> {
    EkycRepository::update_verification_legacy(pool, id, admin_id, &update).await
}

pub async fn apply_review_action(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: EkycReviewActionRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EkycApplicationDetail, ApiError> {
    let action = normalize_action(&input.action)?;
    let permission = permission_for_action(action);
    check_permission(pool, actor_id, permission).await?;

    if let Some(key) = input.idempotency_key.as_deref()
        && EkycRepository::idempotency_key_exists(pool, id, actor_id, key).await?
    {
        return get_admin_application(pool, actor_id, id, ip_address, user_agent).await;
    }

    let current = get_ekyc_by_id(pool, id).await?;
    let reason_codes = EkycRepository::reason_codes(pool).await.unwrap_or_default();
    validate_reason(action, &input, &reason_codes)?;

    let next_status = target_status_for_action(action, &current, &input)?;
    validate_transition(&current.status, &next_status, action)?;

    enforce_assignment_rules(action, actor_id, &current, &input)?;
    enforce_high_risk_checker(pool, action, actor_id, &current).await?;

    let reason_code = input.reason_code.clone();
    let reason = input.reason.clone();
    let note_body = input.note.as_ref().map(|note| sanitize_text(note, 4000));
    let customer_message = customer_message_for_action(action, &input, &reason_codes);
    let set_customer_message = matches!(action, "request_resubmission");
    let set_verified = matches!(next_status.as_str(), "approved" | "rejected");
    let mut risk_flags = risk_rules(current.risk_flags.as_ref());

    let (
        set_assignee,
        assigned_reviewer_id,
        set_potential_duplicate,
        potential_duplicate,
        set_fraud_suspected,
        fraud_suspected,
        set_risk_level,
        risk_level,
        set_risk_score,
        risk_score,
        set_risk_flags,
    ) = match action {
        "claim" => (
            true,
            Some(actor_id),
            false,
            false,
            false,
            false,
            false,
            None,
            false,
            None,
            false,
        ),
        "assign" | "reassign" => (
            true,
            input.assigned_reviewer_id,
            false,
            false,
            false,
            false,
            false,
            None,
            false,
            None,
            false,
        ),
        "mark_potential_duplicate" => {
            add_unique_rule(&mut risk_flags, "duplicate_identity");
            (
                false,
                None,
                true,
                true,
                false,
                false,
                true,
                Some("high".to_string()),
                true,
                Some(current.risk_score.unwrap_or(0).max(80)),
                true,
            )
        }
        "mark_fraud" => {
            add_unique_rule(&mut risk_flags, "suspected_fraud");
            (
                false,
                None,
                true,
                true,
                true,
                true,
                true,
                Some("critical".to_string()),
                true,
                Some(current.risk_score.unwrap_or(0).max(95)),
                true,
            )
        }
        _ => (
            false, None, false, false, false, false, false, None, false, None, false,
        ),
    };

    let note = note_body.map(|body| EkycNoteInsert {
        note_type: input
            .note_type
            .clone()
            .unwrap_or_else(|| "internal".to_string()),
        body,
        customer_visible: false,
    });

    let updated = EkycRepository::apply_review_action(
        pool,
        id,
        actor_id,
        input.expected_version,
        EkycActionUpdate {
            status: next_status.clone(),
            set_assignee,
            assigned_reviewer_id,
            verification_notes: input.note.as_ref().map(|note| sanitize_text(note, 4000)),
            set_customer_message,
            customer_message,
            set_self_checkin: matches!(action, "approve"),
            self_checkin_enabled: input.self_checkin_enabled.unwrap_or(false),
            set_potential_duplicate,
            potential_duplicate,
            set_fraud_suspected,
            fraud_suspected,
            set_risk_level,
            risk_level,
            set_risk_score,
            risk_score,
            set_risk_flags,
            risk_flags: if set_risk_flags {
                Some(serde_json::json!(risk_flags))
            } else {
                None
            },
            decision_reason_code: reason_code.clone(),
            decision_reason: reason.clone(),
            set_verified,
        },
        EkycHistoryInsert {
            action: action.to_string(),
            from_status: Some(current.status.clone()),
            to_status: Some(next_status.clone()),
            reason_code,
            reason,
            details: Some(serde_json::json!({
                "assigned_reviewer_id": assigned_reviewer_id,
                "self_checkin_enabled": input.self_checkin_enabled,
                "target_status": input.target_status
            })),
        },
        note,
        input.idempotency_key,
    )
    .await?;

    AuditLog::log_event(
        pool,
        Some(actor_id),
        &format!("ekyc_{}", action),
        "ekyc_verification",
        Some(id),
        Some(serde_json::json!({
            "from_status": current.status,
            "to_status": updated.status,
            "reason_code": updated.decision_reason_code
        })),
        ip_address.clone(),
        user_agent.clone(),
    )
    .await?;

    let include_provider_raw =
        AuthService::check_permission(pool, actor_id, "ekyc:view_provider_raw")
            .await
            .unwrap_or(false);
    detail_from_record(pool, updated, include_provider_raw).await
}

pub async fn reveal_sensitive_field(
    pool: &DbPool,
    actor_id: i64,
    id: i64,
    input: EkycSensitiveRevealRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EkycSensitiveRevealResponse, ApiError> {
    check_permission(pool, actor_id, "ekyc:reveal_sensitive").await?;
    if input.reason.trim().len() < 5 {
        return Err(ApiError::BadRequest(
            "A reason is required to reveal sensitive eKYC data".to_string(),
        ));
    }

    let application = get_ekyc_by_id(pool, id).await?;
    let field = input.field.trim();
    let value = sensitive_field_value(&application, field)?;

    EkycRepository::reveal_sensitive_field(
        pool,
        id,
        actor_id,
        field,
        &sanitize_text(&input.reason, 1000),
        value.clone(),
    )
    .await?;

    AuditLog::log_event(
        pool,
        Some(actor_id),
        "ekyc_sensitive_reveal",
        "ekyc_verification",
        Some(id),
        Some(serde_json::json!({
            "field": field,
            "reason": sanitize_text(&input.reason, 1000),
            "value_present": value.is_some()
        })),
        ip_address,
        user_agent,
    )
    .await?;

    Ok(EkycSensitiveRevealResponse {
        field: field.to_string(),
        value,
    })
}

pub async fn reason_codes(pool: &DbPool) -> Result<Vec<EkycReasonCode>, ApiError> {
    EkycRepository::reason_codes(pool).await
}

pub async fn export_admin_applications_csv(
    pool: &DbPool,
    actor_id: i64,
    params: EkycListQuery,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<String, ApiError> {
    check_permission(pool, actor_id, "ekyc:export").await?;
    let (_total, rows) =
        EkycRepository::list_admin(pool, &params, "e.submitted_at", "DESC", 10_000, 0).await?;
    EkycRepository::insert_access_event(
        pool,
        None,
        actor_id,
        "applications_exported",
        serde_json::json!({ "format": "csv", "max_rows": 10000 }),
        ip_address.clone(),
        user_agent.clone(),
    )
    .await?;
    AuditLog::log_event(
        pool,
        Some(actor_id),
        "ekyc_exported",
        "ekyc_verification",
        None,
        Some(serde_json::json!({ "format": "csv" })),
        ip_address,
        user_agent,
    )
    .await?;

    let mut csv = String::from(
        "application_id,status,risk_level,risk_score,full_name,email_masked,phone_masked,id_type,id_number_masked,nationality,country,provider_result,assigned_reviewer,submitted_at,updated_at\n",
    );
    for row in rows {
        let summary = summary_from_row(row);
        csv.push_str(&csv_row(&[
            summary.application_id,
            summary.status,
            summary.risk_level,
            summary.risk_score.to_string(),
            summary.full_name.unwrap_or_default(),
            summary.email_masked.unwrap_or_default(),
            summary.phone_masked.unwrap_or_default(),
            summary.id_type.unwrap_or_default(),
            summary.id_number_masked.unwrap_or_default(),
            summary.nationality.unwrap_or_default(),
            summary.country.unwrap_or_default(),
            summary.provider_verification_result.unwrap_or_default(),
            summary.assigned_reviewer_name.unwrap_or_default(),
            summary
                .submitted_at
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
            summary.updated_at.to_rfc3339(),
        ]));
    }
    Ok(csv)
}

pub async fn self_checkin(
    pool: &DbPool,
    user_id: i64,
    req: SelfCheckinRequest,
) -> Result<serde_json::Value, ApiError> {
    let (ekyc_id, self_checkin_enabled) =
        EkycRepository::approved_self_checkin_for_user(pool, user_id)
            .await?
            .ok_or_else(|| {
                ApiError::Forbidden("eKYC verification required for self check-in".to_string())
            })?;

    if !self_checkin_enabled {
        return Err(ApiError::Forbidden(
            "Self check-in not enabled for your account".to_string(),
        ));
    }

    let (booking_id, room_id) =
        EkycRepository::confirmed_booking_for_user(pool, req.booking_id, user_id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Booking not found or not confirmed".to_string()))?;
    let room_number = EkycRepository::room_number(pool, room_id).await?;

    EkycRepository::mark_booking_checked_in(pool, booking_id).await?;
    let checked_in_at = Utc::now();
    let event = EkycRepository::insert_self_checkin_event(
        pool,
        booking_id,
        ekyc_id,
        user_id,
        checked_in_at,
        &req.device_type,
        &req.checkin_location,
    )
    .await?;

    Ok(serde_json::json!({
        "success": true,
        "booking_id": booking_id,
        "room_number": room_number,
        "digital_key_sent": event.digital_key_sent,
        "checked_in_at": event.checked_in_at,
        "message": format!("Successfully checked in to room {}. Your digital key has been sent.", room_number)
    }))
}

fn status_response(verification: EkycVerification) -> EkycStatusResponse {
    EkycStatusResponse {
        id: verification.id,
        status: verification.status,
        self_checkin_enabled: verification.self_checkin_enabled,
        submitted_at: verification.submitted_at,
        verified_at: verification.verified_at,
        full_name: verification.full_name,
        id_type: verification.id_type,
        id_expiry_date: verification.id_expiry_date,
        customer_message: verification.customer_message,
        verification: None,
    }
}

fn dashboard_from_row(row: EkycDashboardRow) -> EkycDashboardMetrics {
    EkycDashboardMetrics {
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

fn summary_from_row(row: EkycApplicationSummaryRow) -> EkycApplicationSummary {
    let submitted_at = row.submitted_at;
    EkycApplicationSummary {
        id: row.id,
        application_id: application_id(row.id),
        user_id: row.user_id,
        guest_id: row.guest_id,
        status: row.status,
        assigned_reviewer_id: row.assigned_reviewer_id,
        assigned_reviewer_name: row.assigned_reviewer_name,
        full_name: row.full_name,
        email_masked: row.email.as_deref().map(mask_email),
        phone_masked: row.phone.as_deref().map(mask_phone),
        id_type: row.id_type,
        id_number_masked: row.id_number.as_deref().map(mask_identifier),
        nationality: row.nationality,
        country: row.id_issuing_country,
        provider_name: row.provider_name,
        provider_verification_result: row.provider_verification_result,
        manual_review_required: row.manual_review_required.unwrap_or(false),
        risk_level: row.risk_level.unwrap_or_else(|| "medium".to_string()),
        risk_score: row.risk_score.unwrap_or(0),
        triggered_risk_rules: risk_rules(row.risk_flags.as_ref()),
        recommended_action: row.recommended_action,
        potential_duplicate: row.potential_duplicate.unwrap_or(false),
        fraud_suspected: row.fraud_suspected.unwrap_or(false),
        self_checkin_enabled: row.self_checkin_enabled.unwrap_or(false),
        submitted_at,
        verified_at: row.verified_at,
        updated_at: row.updated_at,
        nearing_sla: submitted_at.is_some_and(|at| {
            let age = Utc::now().signed_duration_since(at).num_hours();
            (REVIEW_SLA_WARNING_HOURS..REVIEW_SLA_HOURS).contains(&age)
        }),
        overdue_sla: submitted_at
            .is_some_and(|at| Utc::now().signed_duration_since(at).num_hours() >= REVIEW_SLA_HOURS),
        version: row.version,
    }
}

async fn detail_from_record(
    pool: &DbPool,
    record: EkycVerification,
    include_provider_raw: bool,
) -> Result<EkycApplicationDetail, ApiError> {
    let summary = summary_from_row(EkycApplicationSummaryRow {
        id: record.id,
        user_id: record.user_id,
        guest_id: record.guest_id,
        status: record.status.clone(),
        assigned_reviewer_id: record.assigned_reviewer_id,
        assigned_reviewer_name: None,
        full_name: record.full_name.clone(),
        email: record.email.clone(),
        phone: record.phone.clone(),
        id_type: record.id_type.clone(),
        id_number: record.id_number.clone(),
        nationality: record.nationality.clone(),
        id_issuing_country: record.id_issuing_country.clone(),
        provider_name: record.provider_name.clone(),
        provider_verification_result: record.provider_verification_result.clone(),
        manual_review_required: record.manual_review_required,
        risk_level: record.risk_level.clone(),
        risk_score: record.risk_score,
        risk_flags: record.risk_flags.clone(),
        recommended_action: record.recommended_action.clone(),
        potential_duplicate: record.potential_duplicate,
        fraud_suspected: record.fraud_suspected,
        self_checkin_enabled: record.self_checkin_enabled,
        submitted_at: record.submitted_at,
        verified_at: record.verified_at,
        updated_at: record.updated_at,
        version: record.version,
    });

    let history = EkycRepository::history(pool, record.id).await?;
    let notes = EkycRepository::notes(pool, record.id).await?;
    let differences = differences_for_record(&record);
    let provider_raw_response_available = record.provider_raw_response.is_some();
    let provider_raw_response = if include_provider_raw {
        record.provider_raw_response.clone()
    } else {
        None
    };

    Ok(EkycApplicationDetail {
        summary,
        date_of_birth_masked: record.date_of_birth.map(|_| "****-**-**".to_string()),
        current_address_masked: record.current_address.as_deref().map(mask_address),
        id_issuing_country: record.id_issuing_country,
        id_issue_date: record.id_issue_date,
        id_expiry_date: record.id_expiry_date,
        document_authenticity_result: record.document_authenticity_result,
        face_match_score: record.face_match_score,
        face_match_passed: record.face_match_passed,
        liveness_score: record.liveness_score,
        liveness_passed: record.liveness_passed,
        duplicate_check_result: record.duplicate_check_result,
        watchlist_result: record.watchlist_result,
        ip_address_masked: record.ip_address.as_deref().map(mask_ip),
        device_fingerprint: record.device_fingerprint,
        geolocation: record.geolocation,
        submission_metadata: record.submission_metadata,
        ocr_data: record.ocr_data,
        user_entered_data: record.user_entered_data,
        provider_raw_response,
        provider_raw_response_available,
        verification_notes: record.verification_notes,
        customer_message: record.customer_message,
        decision_reason_code: record.decision_reason_code,
        decision_reason: record.decision_reason,
        documents: EkycDocumentAvailability {
            id_front: record.id_front_image_path.is_some(),
            id_back: record.id_back_image_path.is_some(),
            selfie: record.selfie_image_path.is_some(),
            proof_of_address: record.proof_of_address_path.is_some(),
        },
        differences,
        history,
        notes,
    })
}

fn sort_column(sort_by: Option<&str>) -> &'static str {
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

fn sort_direction(sort_order: Option<&str>) -> &'static str {
    if sort_order.is_some_and(|value| value.eq_ignore_ascii_case("asc")) {
        "ASC"
    } else {
        "DESC"
    }
}

fn application_id(id: i64) -> String {
    format!("EKYC-{id:06}")
}

fn normalize_action(action: &str) -> Result<&'static str, ApiError> {
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

fn permission_for_action(action: &str) -> &'static str {
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

fn target_status_for_action(
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

fn normalize_status(status: &str) -> String {
    match status {
        "pending" => "submitted",
        "under_review" | "in_progress" => "in_review",
        "verified" => "approved",
        other => other,
    }
    .to_string()
}

fn validate_transition(from: &str, to: &str, action: &str) -> Result<(), ApiError> {
    let from = normalize_status(from);
    let to = normalize_status(to);
    if from == to {
        return Ok(());
    }

    if matches!(from.as_str(), "expired" | "cancelled") {
        return Err(ApiError::Conflict(
            "Expired or cancelled eKYC applications cannot be changed".to_string(),
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

fn validate_reason(
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

fn customer_message_for_action(
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

fn enforce_assignment_rules(
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

async fn enforce_high_risk_checker(
    pool: &DbPool,
    action: &str,
    actor_id: i64,
    current: &EkycVerification,
) -> Result<(), ApiError> {
    if !matches!(action, "approve" | "override_decision") {
        return Ok(());
    }

    let high_risk = matches!(
        current.risk_level.as_deref(),
        Some("high") | Some("critical")
    ) || current.risk_score.unwrap_or_default() >= 80;
    if !high_risk {
        return Ok(());
    }

    if current.assigned_reviewer_id == Some(actor_id) {
        let can_override = AuthService::check_permission(pool, actor_id, "ekyc:override")
            .await
            .unwrap_or(false);
        if !can_override {
            return Err(ApiError::Forbidden(
                "High-risk approval requires a different authorised checker or override permission"
                    .to_string(),
            ));
        }
    }

    Ok(())
}

fn sensitive_field_value(
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

fn differences_for_record(record: &EkycVerification) -> Vec<EkycFieldComparison> {
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

fn json_string(value: Option<&Value>, key: &str) -> Option<String> {
    value?
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn risk_rules(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|rules| {
            rules
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn add_unique_rule(rules: &mut Vec<String>, rule: &str) {
    if !rules.iter().any(|existing| existing == rule) {
        rules.push(rule.to_string());
    }
}

fn sanitize_text(value: &str, max_len: usize) -> String {
    ammonia::clean(value.trim())
        .chars()
        .take(max_len)
        .collect::<String>()
}

fn mask_identifier(value: &str) -> String {
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

fn mask_email(value: &str) -> String {
    let Some((name, domain)) = value.split_once('@') else {
        return mask_identifier(value);
    };
    let first = name.chars().next().unwrap_or('*');
    format!("{first}***@{domain}")
}

fn mask_phone(value: &str) -> String {
    let digits: String = value.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() <= 4 {
        return "****".to_string();
    }
    format!("***{}", &digits[digits.len() - 4..])
}

fn mask_address(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        "Address on file".to_string()
    }
}

fn mask_ip(value: &str) -> String {
    if let Some((prefix, _)) = value.rsplit_once('.') {
        format!("{prefix}.***")
    } else {
        "masked".to_string()
    }
}

fn csv_row(values: &[String]) -> String {
    let escaped = values
        .iter()
        .map(|value| format!("\"{}\"", value.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(",");
    format!("{escaped}\n")
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
    fn blocks_direct_final_status_changes_without_override() {
        let err = validate_transition("approved", "rejected", "reject").unwrap_err();
        assert!(matches!(err, ApiError::Conflict(_)));
    }

    #[test]
    fn allows_controlled_override_from_final_status() {
        assert!(validate_transition("approved", "rejected", "override_decision").is_ok());
    }
}
