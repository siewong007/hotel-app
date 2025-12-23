//! eKYC (Electronic Know Your Customer) models

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use super::guest::GuestUpdateInput;

/// eKYC status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type)]
#[sqlx(type_name = "varchar", rename_all = "snake_case")]
pub enum EkycStatus {
    Pending,
    InProgress,
    Verified,
    Rejected,
    Expired,
}

/// eKYC submission request
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

/// eKYC verification record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EkycVerification {
    pub id: i64,
    pub user_id: i64,
    pub status: String,
    pub selfie_url: Option<String>,
    pub id_front_url: Option<String>,
    pub id_back_url: Option<String>,
    pub id_type: Option<String>,
    pub id_number: Option<String>,
    pub full_name: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub nationality: Option<String>,
    pub address: Option<String>,
    pub verification_notes: Option<String>,
    pub verified_by: Option<i64>,
    pub verified_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub self_checkin_enabled: Option<bool>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub id_expiry_date: Option<NaiveDate>,
}

/// eKYC status response
#[derive(Debug, Serialize, Deserialize)]
pub struct EkycStatusResponse {
    pub id: i64,
    pub status: String,
    pub self_checkin_enabled: Option<bool>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub verified_at: Option<DateTime<Utc>>,
    pub verification_notes: Option<String>,
    pub full_name: Option<String>,
    pub id_type: Option<String>,
    pub id_expiry_date: Option<NaiveDate>,
    pub verification: Option<EkycVerification>,
}

/// Input for updating eKYC verification
#[derive(Debug, Serialize, Deserialize)]
pub struct EkycVerificationUpdate {
    pub status: String,
    pub verification_notes: Option<String>,
    pub face_match_score: Option<f32>,
    pub face_match_passed: Option<bool>,
    pub self_checkin_enabled: Option<bool>,
}

/// Self check-in request
#[derive(Debug, Serialize, Deserialize)]
pub struct SelfCheckinRequest {
    pub booking_id: i64,
    pub selfie_image: Option<String>,
    pub signature_image: Option<String>,
    pub guest_update: Option<GuestUpdateInput>,
    pub device_type: Option<String>,
    pub checkin_location: Option<String>,
}

/// Self check-in event record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SelfCheckinEvent {
    pub id: i64,
    pub booking_id: i64,
    pub ekyc_verification_id: Option<i64>,
    pub user_id: Option<i64>,
    pub checked_in_at: Option<DateTime<Utc>>,
    pub room_key_issued: Option<bool>,
    pub digital_key_sent: Option<bool>,
    pub device_type: Option<String>,
    pub checkin_location: Option<String>,
    pub event_type: Option<String>,
    pub event_data: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}
