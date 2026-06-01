//! eKYC data access

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;

use crate::constants::EkycStatus;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{EkycVerification, EkycVerificationUpdate, SelfCheckinEvent};

pub struct NewEkycVerification<'a> {
    pub user_id: i64,
    pub guest_id: i64,
    pub full_name: &'a str,
    pub date_of_birth: NaiveDate,
    pub nationality: &'a Option<String>,
    pub phone: &'a Option<String>,
    pub email: &'a Option<String>,
    pub current_address: &'a Option<String>,
    pub id_type: &'a str,
    pub id_number: &'a str,
    pub id_issuing_country: &'a Option<String>,
    pub id_issue_date: Option<NaiveDate>,
    pub id_expiry_date: NaiveDate,
    pub id_front_path: &'a str,
    pub id_back_path: Option<String>,
    pub selfie_path: &'a str,
    pub proof_path: Option<String>,
}

pub struct EkycRepository;

impl EkycRepository {
    pub async fn user_type_and_guest_id(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(String, Option<i64>), ApiError> {
        sqlx::query_as("SELECT user_type::text, guest_id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn guest_id_for_user(pool: &DbPool, user_id: i64) -> Result<Option<i64>, ApiError> {
        sqlx::query_scalar("SELECT guest_id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn exists_for_guest(pool: &DbPool, guest_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM ekyc_verifications WHERE guest_id = $1)",
        )
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn insert_verification(
        pool: &DbPool,
        data: NewEkycVerification<'_>,
    ) -> Result<EkycVerification, ApiError> {
        sqlx::query_as(
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
        .bind(data.user_id)
        .bind(data.guest_id)
        .bind(data.full_name)
        .bind(data.date_of_birth)
        .bind(data.nationality)
        .bind(data.phone)
        .bind(data.email)
        .bind(data.current_address)
        .bind(data.id_type)
        .bind(data.id_number)
        .bind(data.id_issuing_country)
        .bind(data.id_issue_date)
        .bind(data.id_expiry_date)
        .bind(data.id_front_path)
        .bind(data.id_back_path)
        .bind(data.selfie_path)
        .bind(data.proof_path)
        .bind(EkycStatus::Pending)
        .bind(false)
        .bind(false)
        .bind(false)
        .bind(Utc::now())
        .bind(Utc::now())
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_by_guest(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<EkycVerification>, ApiError> {
        sqlx::query_as("SELECT * FROM ekyc_verifications WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn list_all(pool: &DbPool) -> Result<Vec<EkycVerification>, ApiError> {
        sqlx::query_as(
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
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<EkycVerification>, ApiError> {
        sqlx::query_as("SELECT * FROM ekyc_verifications WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn document_path(
        pool: &DbPool,
        id: i64,
        column: &str,
    ) -> Result<Option<String>, ApiError> {
        let query = format!("SELECT {column} FROM ekyc_verifications WHERE id = $1");
        sqlx::query_scalar(&query)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map(|value: Option<Option<String>>| value.flatten())
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn update_verification(
        pool: &DbPool,
        id: i64,
        admin_id: i64,
        update: &EkycVerificationUpdate,
    ) -> Result<EkycVerification, ApiError> {
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
            query_builder = query_builder.bind(Decimal::from_f32_retain(score).unwrap_or_default());
        }
        if let Some(passed) = update.face_match_passed {
            query_builder = query_builder.bind(passed);
        }
        if let Some(enabled) = update.self_checkin_enabled {
            query_builder = query_builder.bind(enabled);
        }

        query_builder
            .bind(admin_id)
            .bind(Utc::now())
            .bind(Utc::now())
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn approved_self_checkin_for_user(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Option<(i64, bool)>, ApiError> {
        sqlx::query_as(
            "SELECT id, self_checkin_enabled FROM ekyc_verifications WHERE user_id = $1 AND status = 'approved'",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn confirmed_booking_for_user(
        pool: &DbPool,
        booking_id: i64,
        user_id: i64,
    ) -> Result<Option<(i64, i64)>, ApiError> {
        sqlx::query_as(
            r#"
            SELECT b.id, b.room_id
            FROM bookings b
            INNER JOIN guests g ON b.guest_id = g.id
            INNER JOIN users u ON g.email = u.email
            WHERE b.id = $1 AND u.id = $2 AND b.status = 'confirmed'
            "#,
        )
        .bind(booking_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn room_number(pool: &DbPool, room_id: i64) -> Result<String, ApiError> {
        sqlx::query_scalar("SELECT room_number FROM rooms WHERE id = $1")
            .bind(room_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn mark_booking_checked_in(pool: &DbPool, booking_id: i64) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            UPDATE bookings
            SET status = 'checked_in',
                actual_checkin = CURRENT_TIMESTAMP
            WHERE id = $1
            "#,
        )
        .bind(booking_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn insert_self_checkin_event(
        pool: &DbPool,
        booking_id: i64,
        ekyc_id: i64,
        user_id: i64,
        checked_in_at: DateTime<Utc>,
        device_type: &Option<String>,
        checkin_location: &Option<String>,
    ) -> Result<SelfCheckinEvent, ApiError> {
        sqlx::query_as(
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
        .bind(checked_in_at)
        .bind(true)
        .bind(true)
        .bind(device_type)
        .bind(checkin_location)
        .bind(Utc::now())
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }
}
