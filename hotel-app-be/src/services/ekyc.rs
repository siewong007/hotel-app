//! eKYC workflows and private document helpers

use std::fs;
use std::path::PathBuf;

use base64::{Engine as _, engine::general_purpose};
use chrono::{Local, NaiveDate, Utc};

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    EkycStatusResponse, EkycSubmissionRequest, EkycVerification, EkycVerificationUpdate,
    SelfCheckinRequest,
};
use crate::repositories::ekyc::{EkycRepository, NewEkycVerification};

pub const EKYC_UPLOAD_DIR: &str = "private_uploads/ekyc";
pub const MAX_EKYC_IMAGE_BYTES: usize = 10 * 1024 * 1024;

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

    if EkycRepository::exists_for_guest(pool, guest_id).await? {
        return Err(ApiError::BadRequest(
            "You have already submitted an eKYC verification. Please check your status."
                .to_string(),
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
        },
    )
    .await?;

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

pub async fn list_ekyc(pool: &DbPool) -> Result<Vec<EkycVerification>, ApiError> {
    EkycRepository::list_all(pool).await
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

pub async fn update_ekyc(
    pool: &DbPool,
    id: i64,
    admin_id: i64,
    update: EkycVerificationUpdate,
) -> Result<EkycVerification, ApiError> {
    EkycRepository::update_verification(pool, id, admin_id, &update).await
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
        status: verification.status.clone(),
        self_checkin_enabled: verification.self_checkin_enabled,
        submitted_at: verification.submitted_at,
        verified_at: verification.verified_at,
        verification_notes: verification.verification_notes.clone(),
        full_name: verification.full_name.clone(),
        id_type: verification.id_type.clone(),
        id_expiry_date: verification.id_expiry_date,
        verification: Some(verification),
    }
}
