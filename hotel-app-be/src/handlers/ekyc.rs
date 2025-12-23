//! eKYC (Electronic Know Your Customer) handlers
//!
//! Handles identity verification and self-check-in.

use axum::{
    extract::{Multipart, Path, State},
    http::HeaderMap,
    Json,
};
use base64::{engine::general_purpose, Engine as _};
use chrono::{NaiveDate, Utc};
use sqlx::PgPool;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::core::error::ApiError;
use crate::core::middleware::require_auth;
use crate::models::{
    EkycStatus, EkycStatusResponse, EkycSubmissionRequest, EkycVerification,
    EkycVerificationUpdate, SelfCheckinEvent, SelfCheckinRequest,
};

/// Helper function to save base64 image to file system
fn save_base64_image(base64_data: &str, user_id: i64, image_type: &str) -> Result<String, ApiError> {
    // Create uploads directory if it doesn't exist
    let upload_dir = PathBuf::from("uploads/ekyc");
    fs::create_dir_all(&upload_dir)
        .map_err(|e| ApiError::Internal(format!("Failed to create upload directory: {}", e)))?;

    // Extract base64 data (remove data:image/jpeg;base64, prefix if present)
    let parts: Vec<&str> = base64_data.split(',').collect();
    let data = if parts.len() == 2 { parts[1] } else { base64_data };

    // Decode base64
    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| ApiError::BadRequest(format!("Invalid base64 data: {}", e)))?;

    // Generate unique filename
    let timestamp = Utc::now().timestamp();
    let filename = format!("{}_{}_{}.jpg", user_id, image_type, timestamp);
    let file_path = upload_dir.join(&filename);

    // Save file
    fs::write(&file_path, bytes)
        .map_err(|e| ApiError::Internal(format!("Failed to save image: {}", e)))?;

    // Return relative path
    Ok(format!("uploads/ekyc/{}", filename))
}

/// Upload single document (multipart/form-data)
pub async fn upload_document_handler(
    State(_pool): State<PgPool>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Get authenticated user ID
    let user_id = require_auth(&headers).await?;

    // Create uploads directory if it doesn't exist
    let upload_dir = PathBuf::from("uploads/ekyc");
    fs::create_dir_all(&upload_dir)
        .map_err(|e| ApiError::Internal(format!("Failed to create upload directory: {}", e)))?;

    let mut file_path = String::new();
    let mut document_type = String::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to read multipart field: {}", e)))?
    {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "documentType" {
            document_type = field
                .text()
                .await
                .map_err(|e| ApiError::BadRequest(format!("Failed to read document type: {}", e)))?;
        } else if field_name == "file" {
            let content_type = field.content_type().unwrap_or("").to_string();

            // Validate file type
            if !content_type.starts_with("image/") {
                return Err(ApiError::BadRequest(
                    "Only image files are allowed".to_string(),
                ));
            }

            let data = field
                .bytes()
                .await
                .map_err(|e| ApiError::BadRequest(format!("Failed to read file data: {}", e)))?;

            // Validate file size (max 10MB)
            if data.len() > 10 * 1024 * 1024 {
                return Err(ApiError::BadRequest(
                    "File size must be less than 10MB".to_string(),
                ));
            }

            // Generate unique filename
            let timestamp = Utc::now().timestamp();
            let extension = if content_type.contains("jpeg") || content_type.contains("jpg") {
                "jpg"
            } else if content_type.contains("png") {
                "png"
            } else {
                "jpg"
            };

            let filename = format!(
                "{}_{}_{}_{}.{}",
                user_id,
                document_type,
                timestamp,
                uuid::Uuid::new_v4(),
                extension
            );
            let full_path = upload_dir.join(&filename);

            // Save file
            let mut file = fs::File::create(&full_path)
                .map_err(|e| ApiError::Internal(format!("Failed to create file: {}", e)))?;
            file.write_all(&data)
                .map_err(|e| ApiError::Internal(format!("Failed to write file: {}", e)))?;

            file_path = format!("uploads/ekyc/{}", filename);
        }
    }

    if file_path.is_empty() {
        return Err(ApiError::BadRequest("No file uploaded".to_string()));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "file_path": file_path,
        "document_type": document_type
    })))
}

/// Submit eKYC verification
pub async fn submit_ekyc_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<EkycSubmissionRequest>,
) -> Result<Json<EkycStatusResponse>, ApiError> {
    // Get authenticated user ID
    let user_id = require_auth(&headers).await?;

    // Get user type and guest_id
    let user_info: (String, Option<i64>) =
        sqlx::query_as("SELECT user_type::text, guest_id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    // Only guest users can submit eKYC
    if user_info.0 != "guest" {
        return Err(ApiError::BadRequest(
            "Only guest users can submit eKYC verification".to_string(),
        ));
    }

    let guest_id = user_info
        .1
        .ok_or_else(|| ApiError::BadRequest("User account not linked to guest profile".to_string()))?;

    // Check if guest already has an eKYC submission
    let existing: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM ekyc_verifications WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    if existing.is_some() {
        return Err(ApiError::BadRequest(
            "You have already submitted an eKYC verification. Please check your status.".to_string(),
        ));
    }

    // Parse date strings
    let date_of_birth = NaiveDate::parse_from_str(&req.date_of_birth, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid date_of_birth format. Use YYYY-MM-DD".to_string()))?;

    let id_expiry_date = NaiveDate::parse_from_str(&req.id_expiry_date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid id_expiry_date format. Use YYYY-MM-DD".to_string()))?;

    let id_issue_date = if let Some(date_str) = &req.id_issue_date {
        Some(
            NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                .map_err(|_| ApiError::BadRequest("Invalid id_issue_date format. Use YYYY-MM-DD".to_string()))?,
        )
    } else {
        None
    };

    // Validate expiry date is in the future
    if id_expiry_date <= Utc::now().date_naive() {
        return Err(ApiError::BadRequest(
            "ID expiry date must be in the future".to_string(),
        ));
    }

    // Check if images are file paths (from new upload endpoint) or base64 (legacy)
    let id_front_path = if req.id_front_image.starts_with("uploads/") {
        req.id_front_image.clone()
    } else {
        save_base64_image(&req.id_front_image, user_id, "id_front")?
    };

    let id_back_path = req
        .id_back_image
        .as_ref()
        .map(|img| {
            if img.starts_with("uploads/") {
                Ok(img.clone())
            } else {
                save_base64_image(img, user_id, "id_back")
            }
        })
        .transpose()?;

    let selfie_path = if req.selfie_image.starts_with("uploads/") {
        req.selfie_image.clone()
    } else {
        save_base64_image(&req.selfie_image, user_id, "selfie")?
    };

    let proof_path = req
        .proof_of_address
        .as_ref()
        .map(|img| {
            if img.starts_with("uploads/") {
                Ok(img.clone())
            } else {
                save_base64_image(img, user_id, "proof")
            }
        })
        .transpose()?;

    // Insert eKYC verification record with guest_id (already validated above)
    let verification: EkycVerification = sqlx::query_as(
        r#"
        INSERT INTO ekyc_verifications (
            user_id, guest_id, full_name, date_of_birth, nationality, phone, email,
            current_address, id_type, id_number, id_issuing_country, id_issue_date,
            id_expiry_date, id_front_image_path, id_back_image_path, selfie_image_path,
            proof_of_address_path, status, face_match_passed, auto_verified,
            self_checkin_enabled, submitted_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(guest_id)
    .bind(&req.full_name)
    .bind(date_of_birth)
    .bind(&req.nationality)
    .bind(&req.phone)
    .bind(&req.email)
    .bind(&req.current_address)
    .bind(&req.id_type)
    .bind(&req.id_number)
    .bind(&req.id_issuing_country)
    .bind(id_issue_date)
    .bind(id_expiry_date)
    .bind(&id_front_path)
    .bind(id_back_path)
    .bind(&selfie_path)
    .bind(proof_path)
    .bind(EkycStatus::Pending)
    .bind(false)
    .bind(false)
    .bind(false)
    .bind(Utc::now())
    .bind(Utc::now())
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(EkycStatusResponse {
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
    }))
}

/// Get user's eKYC status
pub async fn get_ekyc_status_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
) -> Result<Json<Option<EkycStatusResponse>>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Get guest_id from user
    let guest_id: Option<i64> = sqlx::query_scalar("SELECT guest_id FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let guest_id =
        guest_id.ok_or_else(|| ApiError::BadRequest("User not linked to guest profile".to_string()))?;

    // Get eKYC by guest_id
    let verification: Option<EkycVerification> =
        sqlx::query_as("SELECT * FROM ekyc_verifications WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(verification.map(|v| EkycStatusResponse {
        id: v.id,
        status: v.status.clone(),
        self_checkin_enabled: v.self_checkin_enabled,
        submitted_at: v.submitted_at,
        verified_at: v.verified_at,
        verification_notes: v.verification_notes.clone(),
        full_name: v.full_name.clone(),
        id_type: v.id_type.clone(),
        id_expiry_date: v.id_expiry_date,
        verification: Some(v),
    })))
}

/// Get all eKYC verifications (admin only)
pub async fn get_all_ekyc_handler(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<EkycVerification>>, ApiError> {
    let verifications: Vec<EkycVerification> = sqlx::query_as(
        r#"
        SELECT * FROM ekyc_verifications
        ORDER BY
            CASE status
                WHEN 'pending' THEN 1
                WHEN 'under_review' THEN 2
                WHEN 'approved' THEN 3
                WHEN 'rejected' THEN 4
                WHEN 'expired' THEN 5
            END,
            submitted_at DESC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(verifications))
}

/// Get eKYC verification by ID (admin only)
pub async fn get_ekyc_by_id_handler(
    State(pool): State<PgPool>,
    Path(id): Path<i64>,
) -> Result<Json<EkycVerification>, ApiError> {
    let verification: EkycVerification =
        sqlx::query_as("SELECT * FROM ekyc_verifications WHERE id = $1")
            .bind(id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?
            .ok_or_else(|| ApiError::NotFound("eKYC verification not found".to_string()))?;

    Ok(Json(verification))
}

/// Update eKYC verification (admin only)
pub async fn update_ekyc_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(update): Json<EkycVerificationUpdate>,
) -> Result<Json<EkycVerification>, ApiError> {
    let admin_id = require_auth(&headers).await?;

    // Build dynamic update query
    let mut query = String::from("UPDATE ekyc_verifications SET ");
    let mut updates = Vec::new();
    let mut param_count = 1;

    updates.push(format!("status = ${}", param_count));
    param_count += 1;

    if update.verification_notes.is_some() {
        updates.push(format!("verification_notes = ${}", param_count));
        param_count += 1;
    }

    if update.face_match_score.is_some() {
        updates.push(format!("face_match_score = ${}", param_count));
        param_count += 1;
    }

    if update.face_match_passed.is_some() {
        updates.push(format!("face_match_passed = ${}", param_count));
        param_count += 1;
    }

    if update.self_checkin_enabled.is_some() {
        updates.push(format!("self_checkin_enabled = ${}", param_count));
        param_count += 1;
    }

    updates.push(format!("verified_by = ${}", param_count));
    param_count += 1;

    updates.push(format!("verified_at = ${}", param_count));
    param_count += 1;

    updates.push(format!("updated_at = ${}", param_count));
    param_count += 1;

    query.push_str(&updates.join(", "));
    query.push_str(&format!(" WHERE id = ${} RETURNING *", param_count));

    let mut query_builder = sqlx::query_as::<_, EkycVerification>(&query).bind(&update.status);

    if let Some(notes) = &update.verification_notes {
        query_builder = query_builder.bind(notes);
    }

    if let Some(score) = update.face_match_score {
        query_builder =
            query_builder.bind(rust_decimal::Decimal::from_f32_retain(score).unwrap());
    }

    if let Some(passed) = update.face_match_passed {
        query_builder = query_builder.bind(passed);
    }

    if let Some(enabled) = update.self_checkin_enabled {
        query_builder = query_builder.bind(enabled);
    }

    query_builder = query_builder
        .bind(admin_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .bind(id);

    let verification = query_builder
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(verification))
}

/// Self check-in
pub async fn self_checkin_handler(
    State(pool): State<PgPool>,
    headers: HeaderMap,
    Json(req): Json<SelfCheckinRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = require_auth(&headers).await?;

    // Check if user has approved eKYC
    let ekyc: Option<(i64, bool)> = sqlx::query_as(
        "SELECT id, self_checkin_enabled FROM ekyc_verifications WHERE user_id = $1 AND status = 'approved'",
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (ekyc_id, self_checkin_enabled) = ekyc
        .ok_or_else(|| ApiError::Forbidden("eKYC verification required for self check-in".to_string()))?;

    if !self_checkin_enabled {
        return Err(ApiError::Forbidden(
            "Self check-in not enabled for your account".to_string(),
        ));
    }

    // Verify booking belongs to user
    let booking: Option<(i64, i64)> = sqlx::query_as(
        r#"
        SELECT b.id, b.room_id
        FROM bookings b
        INNER JOIN guests g ON b.guest_id = g.id
        INNER JOIN users u ON g.email = u.email
        WHERE b.id = $1 AND u.id = $2 AND b.status = 'confirmed'
        "#,
    )
    .bind(req.booking_id)
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    let (booking_id, room_id) = booking
        .ok_or_else(|| ApiError::NotFound("Booking not found or not confirmed".to_string()))?;

    // Get room number
    let room_number: String = sqlx::query_scalar("SELECT room_number FROM rooms WHERE id = $1")
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    // Update booking status to checked_in
    sqlx::query(
        r#"
        UPDATE bookings
        SET status = 'checked_in',
            actual_checkin = CURRENT_TIMESTAMP
        WHERE id = $1
        "#,
    )
    .bind(booking_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    // Record self check-in event
    let event: SelfCheckinEvent = sqlx::query_as(
        r#"
        INSERT INTO self_checkin_events (
            booking_id, ekyc_verification_id, user_id, checked_in_at,
            room_key_issued, digital_key_sent, device_type, checkin_location, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        "#,
    )
    .bind(booking_id)
    .bind(ekyc_id)
    .bind(user_id)
    .bind(Utc::now())
    .bind(true)
    .bind(true)
    .bind(&req.device_type)
    .bind(&req.checkin_location)
    .bind(Utc::now())
    .fetch_one(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "booking_id": booking_id,
        "room_number": room_number,
        "digital_key_sent": event.digital_key_sent,
        "checked_in_at": event.checked_in_at,
        "message": format!("Successfully checked in to room {}. Your digital key has been sent.", room_number)
    })))
}
