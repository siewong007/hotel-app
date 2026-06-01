//! eKYC (Electronic Know Your Customer) handlers
//!
//! Handles identity verification and self-check-in.

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::header,
    response::{Json, Response},
};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{
    EkycStatusResponse, EkycSubmissionRequest, EkycVerification, EkycVerificationUpdate,
    SelfCheckinRequest,
};
use crate::services::ekyc as ekyc_service;

/// Upload single document (multipart/form-data)
pub async fn upload_document_handler(
    State(_pool): State<DbPool>,
    user_id: i64,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ApiError> {
    let upload_dir = PathBuf::from(ekyc_service::EKYC_UPLOAD_DIR);
    fs::create_dir_all(&upload_dir)
        .map_err(|e| ApiError::Internal(format!("Failed to create upload directory: {}", e)))?;

    let mut file_path = String::new();
    let mut document_type = "document".to_string();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("Failed to read multipart field: {}", e)))?
    {
        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "documentType" {
            let raw_document_type = field.text().await.map_err(|e| {
                ApiError::BadRequest(format!("Failed to read document type: {}", e))
            })?;
            document_type = ekyc_service::sanitize_document_type(&raw_document_type)?;
        } else if field_name == "file" {
            let content_type = field.content_type().unwrap_or("").to_string();
            if !matches!(
                content_type.as_str(),
                "image/jpeg" | "image/jpg" | "image/png" | "image/webp"
            ) {
                return Err(ApiError::BadRequest(
                    "Only JPEG, PNG, or WebP image files are allowed".to_string(),
                ));
            }

            let data = field
                .bytes()
                .await
                .map_err(|e| ApiError::BadRequest(format!("Failed to read file data: {}", e)))?;
            let extension = ekyc_service::validate_image_bytes(&data)?;
            let filename = ekyc_service::build_ekyc_filename(user_id, &document_type, extension)?;
            let full_path = upload_dir.join(&filename);

            let mut file = fs::File::create(&full_path)
                .map_err(|e| ApiError::Internal(format!("Failed to create file: {}", e)))?;
            file.write_all(&data)
                .map_err(|e| ApiError::Internal(format!("Failed to write file: {}", e)))?;

            file_path = format!("{}/{}", ekyc_service::EKYC_UPLOAD_DIR, filename);
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
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<EkycSubmissionRequest>,
) -> Result<Json<EkycStatusResponse>, ApiError> {
    Ok(Json(ekyc_service::submit_ekyc(&pool, user_id, req).await?))
}

/// Get user's eKYC status
pub async fn get_ekyc_status_handler(
    State(pool): State<DbPool>,
    user_id: i64,
) -> Result<Json<Option<EkycStatusResponse>>, ApiError> {
    Ok(Json(ekyc_service::get_ekyc_status(&pool, user_id).await?))
}

/// Get all eKYC verifications (admin only)
pub async fn get_all_ekyc_handler(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<EkycVerification>>, ApiError> {
    Ok(Json(ekyc_service::list_ekyc(&pool).await?))
}

/// Get eKYC verification by ID (admin only)
pub async fn get_ekyc_by_id_handler(
    State(pool): State<DbPool>,
    Path(id): Path<i64>,
) -> Result<Json<EkycVerification>, ApiError> {
    Ok(Json(ekyc_service::get_ekyc_by_id(&pool, id).await?))
}

pub async fn get_ekyc_document_handler(
    State(pool): State<DbPool>,
    Path((id, kind)): Path<(i64, String)>,
) -> Result<Response, ApiError> {
    let path = ekyc_service::get_document_path(&pool, id, &kind).await?;
    let prefix = format!("{}/", ekyc_service::EKYC_UPLOAD_DIR);
    if !path.starts_with(&prefix) {
        return Err(ApiError::NotFound("Document not found".to_string()));
    }

    let filename = &path[prefix.len()..];
    if filename.contains('/') || filename.contains('\\') {
        return Err(ApiError::NotFound("Document not found".to_string()));
    }

    let file_path = PathBuf::from(ekyc_service::EKYC_UPLOAD_DIR).join(filename);
    let bytes =
        fs::read(&file_path).map_err(|_| ApiError::NotFound("Document not found".to_string()))?;
    let content_type = match ekyc_service::image_extension(&bytes) {
        Some("jpg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };

    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(bytes))
        .map_err(|e| ApiError::Internal(format!("Failed to build document response: {}", e)))
}

/// Update eKYC verification (admin only)
pub async fn update_ekyc_handler(
    State(pool): State<DbPool>,
    admin_id: i64,
    Path(id): Path<i64>,
    Json(update): Json<EkycVerificationUpdate>,
) -> Result<Json<EkycVerification>, ApiError> {
    Ok(Json(
        ekyc_service::update_ekyc(&pool, id, admin_id, update).await?,
    ))
}

/// Self check-in
pub async fn self_checkin_handler(
    State(pool): State<DbPool>,
    user_id: i64,
    Json(req): Json<SelfCheckinRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(ekyc_service::self_checkin(&pool, user_id, req).await?))
}
