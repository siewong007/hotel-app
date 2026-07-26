//! eKYC service layer.
//!
//! Business workflows for eKYC verification and review.

use chrono::Utc;

use super::validation;
use crate::core::auth::AuthService;
use crate::core::db::{DbPool, hotel_today};
use crate::core::error::ApiError;
use crate::core::middleware::check_permission;
use crate::modules::ekyc::models::{
    EkycAdminCreateRequest, EkycAdminListResponse, EkycApplicationDetail, EkycApplicationSummary,
    EkycApplicationSummaryRow, EkycDashboardMetrics, EkycDocumentAvailability, EkycListQuery,
    EkycReasonCode, EkycReviewActionRequest, EkycSensitiveRevealRequest,
    EkycSensitiveRevealResponse, EkycStatusResponse, EkycSubmissionRequest, EkycVerification,
    EkycVerificationUpdate, SelfCheckinRequest,
};
use crate::repositories::ekyc::{
    AdminApproval, EkycActionUpdate, EkycHistoryInsert, EkycNoteInsert, EkycRepository,
    EkycReviewAction, NewEkycVerification,
};
use crate::services::audit::AuditLog;
use crate::services::auto_checkin;
use crate::models::AuditEvent;

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

    let today = hotel_today(pool).await?;
    let (date_of_birth, id_expiry_date, id_issue_date) = validation::validate_dates(&req, today)?;

    let id_front_path =
        validation::prepare_ekyc_image_reference(&req.id_front_image, user_id, "id_front")?;
    let id_back_path = req
        .id_back_image
        .as_ref()
        .map(|img| validation::prepare_ekyc_image_reference(img, user_id, "id_back"))
        .transpose()?;
    let selfie_path =
        validation::prepare_ekyc_image_reference(&req.selfie_image, user_id, "selfie")?;
    let proof_path = req
        .proof_of_address
        .as_ref()
        .map(|img| validation::prepare_ekyc_image_reference(img, user_id, "proof"))
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
        AuditEvent {
            user_id: Some(user_id),
            action: "ekyc_submitted",
            resource_type: "ekyc_verification",
            resource_id: Some(verification.id),
            details: Some(serde_json::json!({ "status": verification.status })),
            ip_address,
            user_agent,
        },
    )
    .await;

    Ok(validation::status_response(&verification))
}

/// Admin-initiated creation of an already-approved eKYC verification for a guest.
/// Front-desk staff verify the customer's documents in person; the resulting
/// record is `approved` with self check-in enabled so the customer can check in
/// directly. A login-disabled guest portal account is provisioned if the guest
/// doesn't already have one (eKYC requires a NOT NULL user_id).
pub async fn admin_create_verification(
    pool: &DbPool,
    actor_id: i64,
    req: EkycAdminCreateRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<EkycApplicationDetail, ApiError> {
    check_permission(pool, actor_id, "ekyc:approve").await?;

    if !EkycRepository::guest_exists(pool, req.guest_id).await? {
        return Err(ApiError::BadRequest("Guest not found".to_string()));
    }

    if EkycRepository::exists_open_for_guest(pool, req.guest_id).await? {
        return Err(ApiError::BadRequest(
            "This guest already has an active eKYC verification.".to_string(),
        ));
    }

    let today = hotel_today(pool).await?;
    let (date_of_birth, id_expiry_date, id_issue_date) = validation::validate_date_strings(
        &req.date_of_birth,
        &req.id_expiry_date,
        &req.id_issue_date,
        today,
    )?;

    // Images are uploaded by the admin via /ekyc/upload-document, so the stored
    // path is tied to the admin's (actor) user id.
    let id_front_path =
        validation::prepare_ekyc_image_reference(&req.id_front_image, actor_id, "id_front")?;
    let id_back_path = req
        .id_back_image
        .as_ref()
        .map(|img| validation::prepare_ekyc_image_reference(img, actor_id, "id_back"))
        .transpose()?;
    let selfie_path =
        validation::prepare_ekyc_image_reference(&req.selfie_image, actor_id, "selfie")?;
    let proof_path = req
        .proof_of_address
        .as_ref()
        .map(|img| validation::prepare_ekyc_image_reference(img, actor_id, "proof"))
        .transpose()?;

    // Resolve (or provision) the guest's portal account to satisfy the FK.
    let user_id = match EkycRepository::find_guest_user(pool, req.guest_id).await? {
        Some(id) => id,
        None => EkycRepository::provision_guest_user(pool, req.guest_id, &req.full_name).await?,
    };

    let self_checkin_enabled = req.self_checkin_enabled.unwrap_or(true);

    let verification = EkycRepository::insert_admin_verification(
        pool,
        NewEkycVerification {
            user_id,
            guest_id: req.guest_id,
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
        AdminApproval {
            self_checkin_enabled,
            verified_by: actor_id,
            decision_reason: Some("Verified at front desk by staff".to_string()),
        },
    )
    .await?;

    EkycRepository::insert_decision_history(
        pool,
        verification.id,
        actor_id,
        EkycHistoryInsert {
            action: "admin_create".to_string(),
            from_status: None,
            to_status: Some(verification.status.clone()),
            reason_code: None,
            reason: Some("Verified at front desk by staff".to_string()),
            details: Some(serde_json::json!({
                "self_checkin_enabled": self_checkin_enabled,
                "provisioned_user_id": user_id
            })),
        },
    )
    .await?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "ekyc_admin_created",
            resource_type: "ekyc_verification",
            resource_id: Some(verification.id),
            details: Some(serde_json::json!({
                "guest_id": req.guest_id,
                "status": verification.status,
                "self_checkin_enabled": self_checkin_enabled
            })),
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await;

    get_admin_application(pool, actor_id, verification.id, ip_address, user_agent).await
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
        .as_ref()
        .map(validation::status_response))
}

pub async fn admin_dashboard(pool: &DbPool) -> Result<EkycDashboardMetrics, ApiError> {
    let row = EkycRepository::dashboard_metrics(pool).await?;
    Ok(validation::dashboard_from_row(&row))
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
    let sort_column = validation::sort_column(params.sort_by.as_deref());
    let sort_direction = validation::sort_direction(params.sort_order.as_deref());

    let (total, rows) = EkycRepository::list_admin(
        pool,
        &params,
        sort_column,
        sort_direction,
        page_size,
        offset,
    )
    .await?;
    let metrics = admin_dashboard(pool).await?;

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
        AuditEvent {
            user_id: Some(actor_id),
            action: "ekyc_document_downloaded",
            resource_type: "ekyc_verification",
            resource_id: Some(application_id),
            details: Some(serde_json::json!({ "document_kind": kind })),
            ip_address,
            user_agent,
        },
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
    let action = validation::normalize_action(&input.action)?;
    let permission = validation::permission_for_action(action);
    check_permission(pool, actor_id, permission).await?;

    if let Some(key) = input.idempotency_key.as_deref()
        && EkycRepository::idempotency_key_exists(pool, id, actor_id, key).await?
    {
        return get_admin_application(pool, actor_id, id, ip_address, user_agent).await;
    }

    let current = get_ekyc_by_id(pool, id).await?;
    let reason_codes = EkycRepository::reason_codes(pool).await.unwrap_or_default();
    validation::validate_reason(action, &input, &reason_codes)?;

    let next_status = validation::target_status_for_action(action, &current, &input)?;
    validation::validate_transition(&current.status, &next_status, action)?;

    validation::enforce_assignment_rules(action, actor_id, &current, &input)?;

    let reason_code = input.reason_code.clone();
    let reason = input.reason.clone();
    let note_body = input
        .note
        .as_ref()
        .map(|note| validation::sanitize_text(note, 4000));
    let customer_message = validation::customer_message_for_action(action, &input, &reason_codes);
    let set_customer_message = matches!(action, "request_resubmission");
    let set_verified = matches!(next_status.as_str(), "approved" | "rejected");
    let mut risk_flags = validation::risk_rules(current.risk_flags.as_ref());

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
            validation::add_unique_rule(&mut risk_flags, "duplicate_identity");
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
            validation::add_unique_rule(&mut risk_flags, "suspected_fraud");
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
        EkycReviewAction {
            application_id: id,
            actor_id,
            expected_version: input.expected_version,
            update: EkycActionUpdate {
                status: next_status.clone(),
                set_assignee,
                assigned_reviewer_id,
                verification_notes: input
                    .note
                    .as_ref()
                    .map(|note| validation::sanitize_text(note, 4000)),
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
            history: EkycHistoryInsert {
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
            idempotency_key: input.idempotency_key,
        },
    )
    .await?;

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: &format!("ekyc_{}", action),
            resource_type: "ekyc_verification",
            resource_id: Some(id),
            details: Some(serde_json::json!({
                "from_status": current.status,
                "to_status": updated.status,
                "reason_code": updated.decision_reason_code
            })),
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
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
    let value = validation::sensitive_field_value(&application, field)?;

    EkycRepository::reveal_sensitive_field(
        pool,
        id,
        actor_id,
        field,
        &validation::sanitize_text(&input.reason, 1000),
        value.clone(),
    )
    .await?;

    AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_id),
            action: "ekyc_sensitive_reveal",
            resource_type: "ekyc_verification",
            resource_id: Some(id),
            details: Some(serde_json::json!({
                "field": field,
                "reason": validation::sanitize_text(&input.reason, 1000),
                "value_present": value.is_some()
            })),
            ip_address,
            user_agent,
        },
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
        AuditEvent {
            user_id: Some(actor_id),
            action: "ekyc_exported",
            resource_type: "ekyc_verification",
            resource_id: None,
            details: Some(serde_json::json!({ "format": "csv" })),
            ip_address,
            user_agent,
        },
    )
    .await?;

    let mut csv = String::from(
        "application_id,status,risk_level,risk_score,full_name,email_masked,phone_masked,id_type,id_number_masked,nationality,country,provider_result,assigned_reviewer,submitted_at,updated_at\n",
    );
    for row in rows {
        let summary = summary_from_row(row);
        csv.push_str(&validation::csv_row(&[
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
    let response = auto_checkin::auto_checkin_for_user(
        pool,
        user_id,
        req.booking_id,
        req.device_type,
        req.checkin_location,
    )
    .await?;

    Ok(serde_json::json!({
        "success": response.success,
        "booking_id": response.booking_id,
        "room_number": response.room_number,
        "digital_key_sent": response.digital_key_sent,
        "checked_in_at": response.checked_in_at,
        "message": response.message
    }))
}

// Helper functions

fn summary_from_row(row: EkycApplicationSummaryRow) -> EkycApplicationSummary {
    let submitted_at = row.submitted_at;
    EkycApplicationSummary {
        id: row.id,
        application_id: validation::application_id(row.id),
        user_id: row.user_id,
        guest_id: row.guest_id,
        status: row.status,
        assigned_reviewer_id: row.assigned_reviewer_id,
        assigned_reviewer_name: row.assigned_reviewer_name,
        full_name: row.full_name,
        email_masked: row.email.as_deref().map(validation::mask_email),
        phone_masked: row.phone.as_deref().map(validation::mask_phone),
        id_type: row.id_type,
        id_number_masked: row.id_number.as_deref().map(validation::mask_identifier),
        nationality: row.nationality,
        country: row.id_issuing_country,
        provider_name: row.provider_name,
        provider_verification_result: row.provider_verification_result,
        manual_review_required: row.manual_review_required.unwrap_or(false),
        risk_level: row.risk_level.unwrap_or_else(|| "medium".to_string()),
        risk_score: row.risk_score.unwrap_or(0),
        triggered_risk_rules: validation::risk_rules(row.risk_flags.as_ref()),
        recommended_action: row.recommended_action,
        potential_duplicate: row.potential_duplicate.unwrap_or(false),
        fraud_suspected: row.fraud_suspected.unwrap_or(false),
        self_checkin_enabled: row.self_checkin_enabled.unwrap_or(false),
        submitted_at,
        verified_at: row.verified_at,
        updated_at: row.updated_at,
        nearing_sla: submitted_at.is_some_and(|at| {
            let age = Utc::now().signed_duration_since(at).num_hours();
            (validation::REVIEW_SLA_WARNING_HOURS..validation::REVIEW_SLA_HOURS).contains(&age)
        }),
        overdue_sla: submitted_at.is_some_and(|at| {
            Utc::now().signed_duration_since(at).num_hours() >= validation::REVIEW_SLA_HOURS
        }),
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
    let differences = validation::differences_for_record(&record);
    let provider_raw_response_available = record.provider_raw_response.is_some();
    let provider_raw_response = if include_provider_raw {
        record.provider_raw_response.clone()
    } else {
        None
    };

    Ok(EkycApplicationDetail {
        summary,
        date_of_birth_masked: record.date_of_birth.map(|_| "****-**-**".to_string()),
        current_address_masked: record
            .current_address
            .as_deref()
            .map(validation::mask_address),
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
        ip_address_masked: record.ip_address.as_deref().map(validation::mask_ip),
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
