//! eKYC (Electronic Know Your Customer) models.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

use super::guest::GuestUpdateInput;

/// eKYC submission request from a guest-facing flow.
#[derive(Debug, Serialize, Deserialize)]
pub struct EkycSubmissionRequest {
    pub selfie_image: String,
    pub id_front_image: String,
    pub id_back_image: Option<String>,
    pub id_type: String,
    pub id_number: String,
    pub full_name: String,
    pub date_of_birth: String,
    pub nationality: Option<String>,
    pub address: Option<String>,
    pub id_expiry_date: String,
    pub id_issue_date: Option<String>,
    pub id_issuing_country: Option<String>,
    pub proof_of_address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub current_address: Option<String>,
}

/// Admin-initiated eKYC creation request (front-desk verifies a walk-in's
/// documents in person). Produces an already-approved verification.
#[derive(Debug, Serialize, Deserialize)]
pub struct EkycAdminCreateRequest {
    pub guest_id: i64,
    pub selfie_image: String,
    pub id_front_image: String,
    pub id_back_image: Option<String>,
    pub id_type: String,
    pub id_number: String,
    pub full_name: String,
    pub date_of_birth: String,
    pub nationality: Option<String>,
    pub id_expiry_date: String,
    pub id_issue_date: Option<String>,
    pub id_issuing_country: Option<String>,
    pub proof_of_address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub current_address: Option<String>,
    /// Whether the customer may use self/kiosk check-in. Defaults to true.
    pub self_checkin_enabled: Option<bool>,
}

/// Full eKYC verification row. Do not return this directly to customer-facing APIs.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EkycVerification {
    pub id: i64,
    pub user_id: i64,
    pub guest_id: Option<i64>,
    pub status: String,
    pub assigned_reviewer_id: Option<i64>,
    pub reviewer_claimed_at: Option<DateTime<Utc>>,
    pub full_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub nationality: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub current_address: Option<String>,
    pub id_type: Option<String>,
    pub id_number: Option<String>,
    pub id_issuing_country: Option<String>,
    pub id_issue_date: Option<NaiveDate>,
    pub id_expiry_date: Option<NaiveDate>,
    pub id_front_image_path: Option<String>,
    pub id_back_image_path: Option<String>,
    pub selfie_image_path: Option<String>,
    pub proof_of_address_path: Option<String>,
    pub provider_name: Option<String>,
    pub provider_verification_result: Option<String>,
    pub provider_raw_response: Option<Value>,
    pub ocr_data: Option<Value>,
    pub user_entered_data: Option<Value>,
    pub document_authenticity_result: Option<String>,
    pub face_match_score: Option<f64>,
    pub face_match_passed: Option<bool>,
    pub liveness_score: Option<f64>,
    pub liveness_passed: Option<bool>,
    pub duplicate_check_result: Option<String>,
    pub watchlist_result: Option<String>,
    pub ip_address: Option<String>,
    pub device_fingerprint: Option<String>,
    pub geolocation: Option<String>,
    pub submission_metadata: Option<Value>,
    pub auto_verified: Option<bool>,
    pub auto_verification_details: Option<Value>,
    pub manual_review_required: Option<bool>,
    pub risk_level: Option<String>,
    pub risk_score: Option<i32>,
    pub risk_flags: Option<Value>,
    pub recommended_action: Option<String>,
    pub potential_duplicate: Option<bool>,
    pub fraud_suspected: Option<bool>,
    pub verification_notes: Option<String>,
    pub customer_message: Option<String>,
    pub decision_reason_code: Option<String>,
    pub decision_reason: Option<String>,
    pub verified_by: Option<i64>,
    pub verified_at: Option<DateTime<Utc>>,
    pub self_checkin_enabled: Option<bool>,
    pub self_checkin_activated_at: Option<DateTime<Utc>>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Guest-facing status response. Sensitive data and internal notes are omitted.
#[derive(Debug, Serialize, Deserialize)]
pub struct EkycStatusResponse {
    pub id: i64,
    pub status: String,
    pub self_checkin_enabled: Option<bool>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub verified_at: Option<DateTime<Utc>>,
    pub full_name: Option<String>,
    pub id_type: Option<String>,
    pub id_expiry_date: Option<NaiveDate>,
    pub customer_message: Option<String>,
    pub verification: Option<EkycVerification>,
}

/// Legacy input for updating an eKYC verification.
#[derive(Debug, Serialize, Deserialize)]
pub struct EkycVerificationUpdate {
    pub status: String,
    pub verification_notes: Option<String>,
    pub face_match_score: Option<f32>,
    pub face_match_passed: Option<bool>,
    pub self_checkin_enabled: Option<bool>,
    pub reason_code: Option<String>,
    pub reason: Option<String>,
    pub expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct EkycListQuery {
    pub status: Option<String>,
    pub submission_from: Option<NaiveDate>,
    pub submission_to: Option<NaiveDate>,
    pub risk_level: Option<String>,
    pub verification_method: Option<String>,
    pub assigned_reviewer_id: Option<i64>,
    pub nationality: Option<String>,
    pub country: Option<String>,
    pub document_type: Option<String>,
    pub provider_result: Option<String>,
    pub manual_review_required: Option<bool>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct EkycApplicationSummaryRow {
    pub id: i64,
    pub user_id: i64,
    pub guest_id: Option<i64>,
    pub status: String,
    pub assigned_reviewer_id: Option<i64>,
    pub assigned_reviewer_name: Option<String>,
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub id_type: Option<String>,
    pub id_number: Option<String>,
    pub nationality: Option<String>,
    pub id_issuing_country: Option<String>,
    pub provider_name: Option<String>,
    pub provider_verification_result: Option<String>,
    pub manual_review_required: Option<bool>,
    pub risk_level: Option<String>,
    pub risk_score: Option<i32>,
    pub risk_flags: Option<Value>,
    pub recommended_action: Option<String>,
    pub potential_duplicate: Option<bool>,
    pub fraud_suspected: Option<bool>,
    pub self_checkin_enabled: Option<bool>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub verified_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Serialize)]
pub struct EkycApplicationSummary {
    pub id: i64,
    pub application_id: String,
    pub user_id: i64,
    pub guest_id: Option<i64>,
    pub status: String,
    pub assigned_reviewer_id: Option<i64>,
    pub assigned_reviewer_name: Option<String>,
    pub full_name: Option<String>,
    pub email_masked: Option<String>,
    pub phone_masked: Option<String>,
    pub id_type: Option<String>,
    pub id_number_masked: Option<String>,
    pub nationality: Option<String>,
    pub country: Option<String>,
    pub provider_name: Option<String>,
    pub provider_verification_result: Option<String>,
    pub manual_review_required: bool,
    pub risk_level: String,
    pub risk_score: i32,
    pub triggered_risk_rules: Vec<String>,
    pub recommended_action: Option<String>,
    pub potential_duplicate: bool,
    pub fraud_suspected: bool,
    pub self_checkin_enabled: bool,
    pub submitted_at: Option<DateTime<Utc>>,
    pub verified_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub nearing_sla: bool,
    pub overdue_sla: bool,
    pub version: i32,
}

#[derive(Debug, Serialize, FromRow)]
pub struct EkycDashboardRow {
    pub total_submitted: i64,
    pub pending_review: i64,
    pub under_manual_review: i64,
    pub approved: i64,
    pub rejected: i64,
    pub resubmission_required: i64,
    pub escalated_high_risk: i64,
    pub average_processing_minutes: Option<f64>,
    pub nearing_sla: i64,
    pub daily_trend: i64,
    pub weekly_trend: i64,
    pub monthly_trend: i64,
}

#[derive(Debug, Serialize)]
pub struct EkycDashboardMetrics {
    pub total_submitted: i64,
    pub pending_review: i64,
    pub under_manual_review: i64,
    pub approved: i64,
    pub rejected: i64,
    pub resubmission_required: i64,
    pub escalated_high_risk: i64,
    pub average_processing_minutes: Option<f64>,
    pub nearing_sla: i64,
    pub daily_trend: i64,
    pub weekly_trend: i64,
    pub monthly_trend: i64,
}

#[derive(Debug, Serialize)]
pub struct EkycAdminListResponse {
    pub data: Vec<EkycApplicationSummary>,
    pub metrics: EkycDashboardMetrics,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct EkycDecisionHistory {
    pub id: i64,
    pub application_id: i64,
    pub actor_id: Option<i64>,
    pub actor_name: Option<String>,
    pub action: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub reason_code: Option<String>,
    pub reason: Option<String>,
    pub details: Option<Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct EkycNote {
    pub id: i64,
    pub application_id: i64,
    pub note_type: String,
    pub body: String,
    pub customer_visible: bool,
    pub created_by: i64,
    pub created_by_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct EkycDocumentAvailability {
    pub id_front: bool,
    pub id_back: bool,
    pub selfie: bool,
    pub proof_of_address: bool,
}

#[derive(Debug, Serialize)]
pub struct EkycFieldComparison {
    pub field: String,
    pub submitted_value: Option<String>,
    pub extracted_value: Option<String>,
    pub matches: bool,
}

#[derive(Debug, Serialize)]
pub struct EkycApplicationDetail {
    pub summary: EkycApplicationSummary,
    pub date_of_birth_masked: Option<String>,
    pub current_address_masked: Option<String>,
    pub id_issuing_country: Option<String>,
    pub id_issue_date: Option<NaiveDate>,
    pub id_expiry_date: Option<NaiveDate>,
    pub document_authenticity_result: Option<String>,
    pub face_match_score: Option<f64>,
    pub face_match_passed: Option<bool>,
    pub liveness_score: Option<f64>,
    pub liveness_passed: Option<bool>,
    pub duplicate_check_result: Option<String>,
    pub watchlist_result: Option<String>,
    pub ip_address_masked: Option<String>,
    pub device_fingerprint: Option<String>,
    pub geolocation: Option<String>,
    pub submission_metadata: Option<Value>,
    pub ocr_data: Option<Value>,
    pub user_entered_data: Option<Value>,
    pub provider_raw_response: Option<Value>,
    pub provider_raw_response_available: bool,
    pub verification_notes: Option<String>,
    pub customer_message: Option<String>,
    pub decision_reason_code: Option<String>,
    pub decision_reason: Option<String>,
    pub documents: EkycDocumentAvailability,
    pub differences: Vec<EkycFieldComparison>,
    pub history: Vec<EkycDecisionHistory>,
    pub notes: Vec<EkycNote>,
}

#[derive(Debug, Deserialize)]
pub struct EkycReviewActionRequest {
    pub action: String,
    pub expected_version: i32,
    pub reason_code: Option<String>,
    pub reason: Option<String>,
    pub customer_message: Option<String>,
    pub assigned_reviewer_id: Option<i64>,
    pub note: Option<String>,
    pub note_type: Option<String>,
    pub target_status: Option<String>,
    pub self_checkin_enabled: Option<bool>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EkycSensitiveRevealRequest {
    pub field: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct EkycSensitiveRevealResponse {
    pub field: String,
    pub value: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct EkycReasonCode {
    pub code: String,
    pub label: String,
    pub category: String,
    pub requires_details: bool,
    pub customer_message_template: Option<String>,
    pub is_active: bool,
}

/// Self check-in request.
#[derive(Debug, Serialize, Deserialize)]
pub struct SelfCheckinRequest {
    pub booking_id: i64,
    pub selfie_image: Option<String>,
    pub signature_image: Option<String>,
    pub guest_update: Option<GuestUpdateInput>,
    pub device_type: Option<String>,
    pub checkin_location: Option<String>,
}

