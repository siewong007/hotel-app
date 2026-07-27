//! eKYC data access.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::Row;

use crate::constants::EkycStatus;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::row_mappers;
use crate::models::{
    EkycApplicationSummaryRow, EkycDashboardRow, EkycDecisionHistory, EkycListQuery, EkycNote,
    EkycReasonCode, EkycVerification,
};

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
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

pub struct EkycActionUpdate {
    pub status: String,
    pub set_assignee: bool,
    pub assigned_reviewer_id: Option<i64>,
    pub verification_notes: Option<String>,
    pub set_customer_message: bool,
    pub customer_message: Option<String>,
    pub set_self_checkin: bool,
    pub self_checkin_enabled: bool,
    pub set_potential_duplicate: bool,
    pub potential_duplicate: bool,
    pub set_fraud_suspected: bool,
    pub fraud_suspected: bool,
    pub set_risk_level: bool,
    pub risk_level: Option<String>,
    pub set_risk_score: bool,
    pub risk_score: Option<i32>,
    pub set_risk_flags: bool,
    pub risk_flags: Option<Value>,
    pub decision_reason_code: Option<String>,
    pub decision_reason: Option<String>,
    pub set_verified: bool,
}

pub struct EkycHistoryInsert {
    pub action: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub reason_code: Option<String>,
    pub reason: Option<String>,
    pub details: Option<Value>,
}

pub struct EkycNoteInsert {
    pub note_type: String,
    pub body: String,
    pub customer_visible: bool,
}

/// One reviewer decision applied to an eKYC application.
pub struct EkycReviewAction {
    pub application_id: i64,
    pub actor_id: i64,
    pub expected_version: i32,
    pub update: EkycActionUpdate,
    pub history: EkycHistoryInsert,
    pub note: Option<EkycNoteInsert>,
    pub idempotency_key: Option<String>,
}

/// Extra fields applied when an admin creates an already-approved verification.
pub struct AdminApproval {
    pub self_checkin_enabled: bool,
    pub verified_by: i64,
    pub decision_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GuestEkycSummaryRecord {
    pub verification_id: i64,
    pub user_id: i64,
    pub guest_id: i64,
    pub status: String,
    pub self_checkin_enabled: bool,
    pub verified_at: Option<DateTime<Utc>>,
}

/// Build a unique, deterministic username/email pair for a provisioned guest
/// account. The account is a login-disabled anchor for the eKYC `user_id` FK, so
/// it uses a stable per-guest placeholder rather than the guest's real email —
/// the guest id keeps both values collision-free against the UNIQUE constraints
/// (the real email is still stored on the verification and guest profile).
pub fn synthesize_guest_credentials(guest_id: i64) -> (String, String) {
    (
        format!("guest_{guest_id}"),
        format!("guest_{guest_id}@ekyc.local"),
    )
}

pub struct EkycRepository;

impl EkycRepository {
    pub async fn user_type_and_guest_id(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<(String, Option<i64>), ApiError> {
        let query = "SELECT user_type::text, guest_id FROM users WHERE id = $1";
        sqlx::query_as(query)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn guest_id_for_user(pool: &DbPool, user_id: i64) -> Result<Option<i64>, ApiError> {
        let query = "SELECT guest_id FROM users WHERE id = $1";

        sqlx::query_scalar(query)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn latest_guest_summary_record(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<GuestEkycSummaryRecord>, ApiError> {
        let query = r#"
                SELECT id, user_id, guest_id, status,
                       COALESCE(self_checkin_enabled, false) AS self_checkin_enabled,
                       verified_at
                FROM ekyc_verifications
                WHERE guest_id = $1
                ORDER BY COALESCE(submitted_at, created_at) DESC, updated_at DESC, id DESC
                LIMIT 1
            "#;

        let row = sqlx::query(query)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        row.map(|row| {
            Ok(GuestEkycSummaryRecord {
                verification_id: row.try_get("id")?,
                user_id: row.try_get("user_id")?,
                guest_id: row.try_get("guest_id")?,
                status: row.try_get("status")?,
                self_checkin_enabled: row_mappers::get_bool(&row, "self_checkin_enabled"),
                verified_at: row.try_get("verified_at").ok().flatten(),
            })
        })
        .transpose()
        .map_err(|e: sqlx::Error| ApiError::Database(e.to_string()))
    }

    /// Batched form of `latest_guest_summary_record` — one round trip for a set
    /// of guest ids instead of one query per guest. Returns only the guests
    /// that have at least one verification row; callers fall back to
    /// `GuestEkycStatusSummary::not_submitted` for ids missing from the result.
    pub async fn latest_guest_summary_records(
        pool: &DbPool,
        guest_ids: &[i64],
    ) -> Result<Vec<GuestEkycSummaryRecord>, ApiError> {
        if guest_ids.is_empty() {
            return Ok(Vec::new());
        }

        let query = r#"
                SELECT DISTINCT ON (guest_id)
                       id, user_id, guest_id, status,
                       COALESCE(self_checkin_enabled, false) AS self_checkin_enabled,
                       verified_at
                FROM ekyc_verifications
                WHERE guest_id = ANY($1)
                ORDER BY guest_id, COALESCE(submitted_at, created_at) DESC, updated_at DESC, id DESC
            "#;

        let rows = sqlx::query(query)
            .bind(guest_ids)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))?;

        rows.into_iter()
            .map(|row| {
                Ok(GuestEkycSummaryRecord {
                    verification_id: row.try_get("id")?,
                    user_id: row.try_get("user_id")?,
                    guest_id: row.try_get("guest_id")?,
                    status: row.try_get("status")?,
                    self_checkin_enabled: row_mappers::get_bool(&row, "self_checkin_enabled"),
                    verified_at: row.try_get("verified_at").ok().flatten(),
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Whether the guest already has a verification that blocks a new one.
    ///
    /// `additional_information_required` is deliberately NOT blocking: it is the
    /// status a reviewer sets to ask the guest for a better photo, so treating
    /// it as open would make the one status literally named "additional
    /// information required" the one status that prevents supplying it.
    ///
    /// `rejected`, `expired` and `void` are likewise non-blocking terminal
    /// states — that predates this list gaining `additional_information_required`
    /// — so a guest whose documents were not accepted may submit a fresh set
    /// rather than being stranded. The frontend matches this
    /// (`IdentitySection.tsx` marks only the in-flight and approved states as
    /// blocking); if a hard rejection should ever require front-desk
    /// involvement, it has to change in BOTH places.
    pub async fn exists_open_for_guest(pool: &DbPool, guest_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM ekyc_verifications
                WHERE guest_id = $1
                  AND status NOT IN (
                      'rejected',
                      'expired',
                      'void',
                      'additional_information_required'
                  )
            )
            "#,
        )
        .bind(guest_id)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Void the guest's outstanding `additional_information_required` rows
    /// because a replacement submission is about to be inserted.
    ///
    /// Without this, self-resubmission leaves the superseded row in the review
    /// queue forever: `dashboard_metrics` buckets it under
    /// `resubmission_required` and `list_admin` still lists it, so a reviewer
    /// sees two live applications for one guest. `void` is used rather than
    /// deleting so the earlier attempt stays auditable, and it is already in
    /// `exists_open_for_guest`'s non-blocking list and the `valid_ekyc_status`
    /// CHECK constraint.
    pub async fn supersede_information_requests(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<u64, ApiError> {
        let result = sqlx::query(
            r#"
            UPDATE ekyc_verifications
            SET status = 'void',
                updated_at = CURRENT_TIMESTAMP
            WHERE guest_id = $1
              AND status = 'additional_information_required'
            "#,
        )
        .bind(guest_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
        Ok(result.rows_affected())
    }

    pub async fn insert_verification(
        pool: &DbPool,
        data: NewEkycVerification<'_>,
    ) -> Result<EkycVerification, ApiError> {
        let user_entered_data = serde_json::json!({
            "full_name": data.full_name,
            "date_of_birth": data.date_of_birth,
            "nationality": data.nationality,
            "phone": data.phone,
            "email": data.email,
            "current_address": data.current_address,
            "id_type": data.id_type,
            "id_issuing_country": data.id_issuing_country,
            "id_issue_date": data.id_issue_date,
            "id_expiry_date": data.id_expiry_date
        });
        let metadata = serde_json::json!({
            "user_agent": data.user_agent
        });

        sqlx::query_as(
            r#"
            INSERT INTO ekyc_verifications (
                user_id, guest_id, full_name, date_of_birth, nationality, phone, email,
                current_address, id_type, id_number, id_issuing_country, id_issue_date,
                id_expiry_date, id_front_image_path, id_back_image_path, selfie_image_path,
                proof_of_address_path, status, provider_verification_result,
                user_entered_data, ip_address, submission_metadata, face_match_passed,
                liveness_passed, auto_verified, manual_review_required, risk_level,
                risk_score, risk_flags, recommended_action, self_checkin_enabled,
                submitted_at, updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
                $27, $28, $29, $30, $31, $32, $33
            )
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
        .bind(EkycStatus::Submitted.to_string())
        .bind("pending")
        .bind(user_entered_data)
        .bind(data.ip_address)
        .bind(metadata)
        .bind(false)
        .bind(false)
        .bind(false)
        .bind(true)
        .bind("medium")
        .bind(35_i32)
        .bind(serde_json::json!(["manual_review_required"]))
        .bind("manual_review")
        .bind(false)
        .bind(Utc::now())
        .bind(Utc::now())
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Insert an admin-created verification that is already approved (front-desk
    /// staff verified the customer's documents in person). Mirrors
    /// `insert_verification` but lands in the `approved` state with self check-in
    /// enabled and the reviewer stamped.
    pub async fn insert_admin_verification(
        pool: &DbPool,
        data: NewEkycVerification<'_>,
        approval: AdminApproval,
    ) -> Result<EkycVerification, ApiError> {
        let user_entered_data = serde_json::json!({
            "full_name": data.full_name,
            "date_of_birth": data.date_of_birth,
            "nationality": data.nationality,
            "phone": data.phone,
            "email": data.email,
            "current_address": data.current_address,
            "id_type": data.id_type,
            "id_issuing_country": data.id_issuing_country,
            "id_issue_date": data.id_issue_date,
            "id_expiry_date": data.id_expiry_date
        });
        let metadata = serde_json::json!({
            "user_agent": data.user_agent,
            "source": "admin_created"
        });

        sqlx::query_as(
            r#"
            INSERT INTO ekyc_verifications (
                user_id, guest_id, full_name, date_of_birth, nationality, phone, email,
                current_address, id_type, id_number, id_issuing_country, id_issue_date,
                id_expiry_date, id_front_image_path, id_back_image_path, selfie_image_path,
                proof_of_address_path, status, provider_verification_result,
                user_entered_data, ip_address, submission_metadata, face_match_passed,
                liveness_passed, auto_verified, manual_review_required, risk_level,
                risk_score, risk_flags, recommended_action, self_checkin_enabled,
                self_checkin_activated_at, verified_by, verified_at, decision_reason,
                submitted_at, updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
                $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37
            )
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
        .bind(EkycStatus::Approved.to_string())
        .bind("manual")
        .bind(user_entered_data)
        .bind(data.ip_address)
        .bind(metadata)
        .bind(true)
        .bind(true)
        .bind(false)
        .bind(false)
        .bind("low")
        .bind(5_i32)
        .bind(serde_json::json!([]))
        .bind("approve")
        .bind(approval.self_checkin_enabled)
        .bind(if approval.self_checkin_enabled {
            Some(Utc::now())
        } else {
            None
        })
        .bind(approval.verified_by)
        .bind(Utc::now())
        .bind(approval.decision_reason)
        .bind(Utc::now())
        .bind(Utc::now())
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Record a decision-history row outside of the review-action transaction
    /// (used by admin-create).
    pub async fn insert_decision_history(
        pool: &DbPool,
        application_id: i64,
        actor_id: i64,
        history: EkycHistoryInsert,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO ekyc_decision_history (
                application_id, actor_id, action, from_status, to_status,
                reason_code, reason, details, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(application_id)
        .bind(actor_id)
        .bind(&history.action)
        .bind(&history.from_status)
        .bind(&history.to_status)
        .bind(&history.reason_code)
        .bind(&history.reason)
        .bind(&history.details)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
        Ok(())
    }

    /// Whether a guest profile exists.
    pub async fn guest_exists(pool: &DbPool, guest_id: i64) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM guests WHERE id = $1)")
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// The id of an existing guest-type portal user linked to this guest, if any.
    pub async fn find_guest_user(pool: &DbPool, guest_id: i64) -> Result<Option<i64>, ApiError> {
        let query =
            "SELECT id FROM users WHERE guest_id = $1 AND user_type = 'guest' ORDER BY id LIMIT 1";
        sqlx::query_scalar(query)
            .bind(guest_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    /// Provision a minimal, login-disabled guest portal account linked to the
    /// given guest so an eKYC verification (which requires a NOT NULL user_id)
    /// can be created for a walk-in customer.
    pub async fn provision_guest_user(
        pool: &DbPool,
        guest_id: i64,
        full_name: &str,
    ) -> Result<i64, ApiError> {
        let (username, email) = synthesize_guest_credentials(guest_id);
        let full_name = if full_name.trim().is_empty() {
            format!("Guest {guest_id}")
        } else {
            full_name.to_string()
        };
        let query = "INSERT INTO users (username, email, full_name, user_type, guest_id, is_active, is_verified) \
                       VALUES ($1, $2, $3, 'guest', $4, false, true) RETURNING id";
        sqlx::query_scalar(query)
            .bind(username)
            .bind(email)
            .bind(full_name)
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_by_guest(
        pool: &DbPool,
        guest_id: i64,
    ) -> Result<Option<EkycVerification>, ApiError> {
        sqlx::query_as(
            r#"
            SELECT
                id, user_id, guest_id, status, assigned_reviewer_id, reviewer_claimed_at,
                full_name, date_of_birth, nationality, phone, email, current_address,
                id_type, id_number, id_issuing_country, id_issue_date, id_expiry_date,
                id_front_image_path, id_back_image_path, selfie_image_path, proof_of_address_path,
                provider_name, provider_verification_result, provider_raw_response,
                ocr_data, user_entered_data, document_authenticity_result,
                face_match_score, face_match_passed, liveness_score, liveness_passed,
                duplicate_check_result, watchlist_result, ip_address, device_fingerprint,
                geolocation, submission_metadata, auto_verified, auto_verification_details,
                manual_review_required, risk_level, risk_score, risk_flags, recommended_action,
                potential_duplicate, fraud_suspected, verification_notes, customer_message,
                decision_reason_code, decision_reason, verified_by, verified_at,
                self_checkin_enabled, self_checkin_activated_at, submitted_at, version,
                created_at, updated_at
            FROM ekyc_verifications
            WHERE guest_id = $1
            ORDER BY submitted_at DESC, id DESC
            LIMIT 1
            "#,
        )
        .bind(guest_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Option<EkycVerification>, ApiError> {
        sqlx::query_as(
            r#"
            SELECT
                id, user_id, guest_id, status, assigned_reviewer_id, reviewer_claimed_at,
                full_name, date_of_birth, nationality, phone, email, current_address,
                id_type, id_number, id_issuing_country, id_issue_date, id_expiry_date,
                id_front_image_path, id_back_image_path, selfie_image_path, proof_of_address_path,
                provider_name, provider_verification_result, provider_raw_response,
                ocr_data, user_entered_data, document_authenticity_result,
                face_match_score, face_match_passed, liveness_score, liveness_passed,
                duplicate_check_result, watchlist_result, ip_address, device_fingerprint,
                geolocation, submission_metadata, auto_verified, auto_verification_details,
                manual_review_required, risk_level, risk_score, risk_flags, recommended_action,
                potential_duplicate, fraud_suspected, verification_notes, customer_message,
                decision_reason_code, decision_reason, verified_by, verified_at,
                self_checkin_enabled, self_checkin_activated_at, submitted_at, version,
                created_at, updated_at
            FROM ekyc_verifications WHERE id = $1
            "#,
        )
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Database(e.to_string()))
    }

    pub async fn list_admin(
        pool: &DbPool,
        params: &EkycListQuery,
        sort_column: &str,
        sort_direction: &str,
        page_size: i64,
        offset: i64,
    ) -> Result<(i64, Vec<EkycApplicationSummaryRow>), ApiError> {
        let count_query = list_query("COUNT(*) AS count", "", "");
        let data_query = list_query(
            r#"
            e.id, e.user_id, e.guest_id, e.status, e.assigned_reviewer_id,
            reviewer.full_name AS assigned_reviewer_name, e.full_name, e.email, e.phone,
            e.id_type, e.id_number, e.nationality, e.id_issuing_country, e.provider_name,
            e.provider_verification_result, e.manual_review_required, e.risk_level,
            e.risk_score, e.risk_flags, e.recommended_action, e.potential_duplicate,
            e.fraud_suspected, e.self_checkin_enabled, e.submitted_at, e.verified_at,
            e.updated_at, e.version
            "#,
            &format!("ORDER BY {sort_column} {sort_direction}, e.id DESC"),
            "LIMIT $14 OFFSET $15",
        );

        let exact_search = normalized_search(params.search.as_deref());
        let like_search = exact_search.as_ref().map(|search| format!("%{}%", search));

        let total_row = bind_count_filters(
            sqlx::query(&count_query),
            params,
            &exact_search,
            &like_search,
        )
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to count eKYC applications: {}", e)))?;
        let total = total_row
            .try_get::<i64, _>("count")
            .map_err(|e| ApiError::Database(format!("Failed to read eKYC count: {}", e)))?;

        let rows = bind_data_filters(
            sqlx::query_as::<_, EkycApplicationSummaryRow>(&data_query),
            params,
            &exact_search,
            &like_search,
        )
        .bind(page_size)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to list eKYC applications: {}", e)))?;

        Ok((total, rows))
    }

    pub async fn dashboard_metrics(pool: &DbPool) -> Result<EkycDashboardRow, ApiError> {
        let query = r#"
            SELECT
                COUNT(*)::BIGINT AS total_submitted,
                COALESCE(SUM(CASE WHEN status IN ('submitted', 'automated_review', 'pending_manual_review') THEN 1 ELSE 0 END), 0)::BIGINT AS pending_review,
                COALESCE(SUM(CASE WHEN status IN ('pending_manual_review', 'in_review', 'on_hold') THEN 1 ELSE 0 END), 0)::BIGINT AS under_manual_review,
                COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0)::BIGINT AS approved,
                COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0)::BIGINT AS rejected,
                COALESCE(SUM(CASE WHEN status = 'additional_information_required' THEN 1 ELSE 0 END), 0)::BIGINT AS resubmission_required,
                COALESCE(SUM(CASE WHEN status = 'escalated' OR risk_level IN ('high', 'critical') THEN 1 ELSE 0 END), 0)::BIGINT AS escalated_high_risk,
                AVG(CASE WHEN verified_at IS NOT NULL AND submitted_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (verified_at - submitted_at)) / 60.0
                    ELSE NULL END)::float8 AS average_processing_minutes,
                COALESCE(SUM(CASE WHEN submitted_at <= CURRENT_TIMESTAMP - INTERVAL '20 hours'
                         AND submitted_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
                         AND status NOT IN ('approved', 'rejected', 'expired', 'void')
                    THEN 1 ELSE 0 END), 0)::BIGINT AS nearing_sla,
                COALESCE(SUM(CASE WHEN submitted_at::date = CURRENT_DATE THEN 1 ELSE 0 END), 0)::BIGINT AS daily_trend,
                COALESCE(SUM(CASE WHEN submitted_at >= CURRENT_TIMESTAMP - INTERVAL '7 days' THEN 1 ELSE 0 END), 0)::BIGINT AS weekly_trend,
                COALESCE(SUM(CASE WHEN submitted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days' THEN 1 ELSE 0 END), 0)::BIGINT AS monthly_trend
            FROM ekyc_verifications
            "#;

        sqlx::query_as(query)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to load eKYC dashboard: {}", e)))
    }

    pub async fn history(
        pool: &DbPool,
        application_id: i64,
    ) -> Result<Vec<EkycDecisionHistory>, ApiError> {
        sqlx::query_as(
            r#"
            SELECT h.id, h.application_id, h.actor_id, u.full_name AS actor_name, h.action,
                   h.from_status, h.to_status, h.reason_code, h.reason, h.details, h.created_at
            FROM ekyc_decision_history h
            LEFT JOIN users u ON u.id = h.actor_id
            WHERE h.application_id = $1
            ORDER BY h.created_at DESC, h.id DESC
            "#,
        )
        .bind(application_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to load eKYC history: {}", e)))
    }

    pub async fn notes(pool: &DbPool, application_id: i64) -> Result<Vec<EkycNote>, ApiError> {
        sqlx::query_as(
            r#"
            SELECT n.id, n.application_id, n.note_type, n.body, n.customer_visible,
                   n.created_by, u.full_name AS created_by_name, n.created_at, n.updated_at
            FROM ekyc_notes n
            LEFT JOIN users u ON u.id = n.created_by
            WHERE n.application_id = $1
            ORDER BY n.created_at DESC, n.id DESC
            "#,
        )
        .bind(application_id)
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to load eKYC notes: {}", e)))
    }

    pub async fn reason_codes(pool: &DbPool) -> Result<Vec<EkycReasonCode>, ApiError> {
        sqlx::query_as(
            r#"
            SELECT code, label, category, requires_details, customer_message_template, is_active
            FROM ekyc_reason_codes
            WHERE is_active = true
            ORDER BY category, label
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to load eKYC reason codes: {}", e)))
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

    pub async fn idempotency_key_exists(
        pool: &DbPool,
        application_id: i64,
        actor_id: i64,
        key: &str,
    ) -> Result<bool, ApiError> {
        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM ekyc_idempotency_keys
                WHERE application_id = $1 AND actor_id = $2 AND idempotency_key = $3
            )
            "#,
        )
        .bind(application_id)
        .bind(actor_id)
        .bind(key)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to check idempotency key: {}", e)))
    }

    pub async fn apply_review_action(
        pool: &DbPool,
        action: EkycReviewAction,
    ) -> Result<EkycVerification, ApiError> {
        let EkycReviewAction {
            application_id,
            actor_id,
            expected_version,
            update,
            history,
            note,
            idempotency_key,
        } = action;
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        let updated = sqlx::query_as::<_, EkycVerification>(
            r#"
            UPDATE ekyc_verifications
            SET status = $1,
                assigned_reviewer_id = CASE WHEN $2 THEN $3 ELSE assigned_reviewer_id END,
                reviewer_claimed_at = CASE
                    WHEN $2 AND $3 IS NOT NULL AND reviewer_claimed_at IS NULL THEN CURRENT_TIMESTAMP
                    ELSE reviewer_claimed_at
                END,
                verification_notes = COALESCE($4, verification_notes),
                customer_message = CASE WHEN $5 THEN $6 ELSE customer_message END,
                self_checkin_enabled = CASE WHEN $7 THEN $8 ELSE self_checkin_enabled END,
                self_checkin_activated_at = CASE
                    WHEN $7 AND $8 THEN CURRENT_TIMESTAMP
                    WHEN $7 AND NOT $8 THEN NULL
                    ELSE self_checkin_activated_at
                END,
                potential_duplicate = CASE WHEN $9 THEN $10 ELSE potential_duplicate END,
                fraud_suspected = CASE WHEN $11 THEN $12 ELSE fraud_suspected END,
                risk_level = CASE WHEN $13 THEN $14 ELSE risk_level END,
                risk_score = CASE WHEN $15 THEN $16 ELSE risk_score END,
                risk_flags = CASE WHEN $17 THEN $18 ELSE risk_flags END,
                decision_reason_code = $19,
                decision_reason = $20,
                verified_by = CASE WHEN $21 THEN $22 ELSE verified_by END,
                verified_at = CASE WHEN $21 THEN CURRENT_TIMESTAMP ELSE verified_at END,
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $23 AND version = $24
            RETURNING *
            "#,
        )
        .bind(&update.status)
        .bind(update.set_assignee)
        .bind(update.assigned_reviewer_id)
        .bind(&update.verification_notes)
        .bind(update.set_customer_message)
        .bind(&update.customer_message)
        .bind(update.set_self_checkin)
        .bind(update.self_checkin_enabled)
        .bind(update.set_potential_duplicate)
        .bind(update.potential_duplicate)
        .bind(update.set_fraud_suspected)
        .bind(update.fraud_suspected)
        .bind(update.set_risk_level)
        .bind(&update.risk_level)
        .bind(update.set_risk_score)
        .bind(update.risk_score)
        .bind(update.set_risk_flags)
        .bind(&update.risk_flags)
        .bind(&update.decision_reason_code)
        .bind(&update.decision_reason)
        .bind(update.set_verified)
        .bind(actor_id)
        .bind(application_id)
        .bind(expected_version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| {
            ApiError::Conflict(
                "This eKYC application changed while you were reviewing it. Refresh and try again."
                    .to_string(),
            )
        })?;

        sqlx::query(
            r#"
            INSERT INTO ekyc_decision_history (
                application_id, actor_id, action, from_status, to_status,
                reason_code, reason, details, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(application_id)
        .bind(actor_id)
        .bind(&history.action)
        .bind(&history.from_status)
        .bind(&history.to_status)
        .bind(&history.reason_code)
        .bind(&history.reason)
        .bind(&history.details)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        if let Some(note) = note {
            sqlx::query(
                r#"
                INSERT INTO ekyc_notes (
                    application_id, note_type, body, customer_visible,
                    created_by, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                "#,
            )
            .bind(application_id)
            .bind(note.note_type)
            .bind(note.body)
            .bind(note.customer_visible)
            .bind(actor_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        }

        if let Some(key) = idempotency_key {
            sqlx::query(
                r#"
                INSERT INTO ekyc_idempotency_keys (
                    application_id, actor_id, idempotency_key, action, created_at
                )
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                "#,
            )
            .bind(application_id)
            .bind(actor_id)
            .bind(key)
            .bind(&history.action)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        }

        tx.commit().await.map_err(ApiError::from)?;
        Ok(updated)
    }

    pub async fn reveal_sensitive_field(
        pool: &DbPool,
        application_id: i64,
        actor_id: i64,
        field: &str,
        reason: &str,
        value: Option<String>,
    ) -> Result<(), ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;

        sqlx::query(
            r#"
            INSERT INTO ekyc_sensitive_reveals (
                application_id, actor_id, field_name, reason, created_at
            )
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(application_id)
        .bind(actor_id)
        .bind(field)
        .bind(reason)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        sqlx::query(
            r#"
            INSERT INTO ekyc_access_events (
                application_id, actor_id, action, details, created_at
            )
            VALUES ($1, $2, 'sensitive_reveal', $3, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(application_id)
        .bind(actor_id)
        .bind(serde_json::json!({
            "field": field,
            "reason": reason,
            "value_present": value.is_some()
        }))
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        tx.commit().await.map_err(ApiError::from)
    }

    pub async fn insert_access_event(
        pool: &DbPool,
        application_id: Option<i64>,
        actor_id: i64,
        action: &str,
        details: Value,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            INSERT INTO ekyc_access_events (
                application_id, actor_id, action, details, ip_address, user_agent, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(application_id)
        .bind(actor_id)
        .bind(action)
        .bind(details)
        .bind(ip_address)
        .bind(user_agent)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| ApiError::Database(format!("Failed to record eKYC access event: {}", e)))
    }
}

fn list_query(select_clause: &str, order_clause: &str, page_clause: &str) -> String {
    format!(
        r#"
        SELECT {select_clause}
        FROM ekyc_verifications e
        LEFT JOIN users reviewer ON reviewer.id = e.assigned_reviewer_id
        WHERE ($1 IS NULL OR e.status = $1)
          AND ($2 IS NULL OR DATE(e.submitted_at) >= $2)
          AND ($3 IS NULL OR DATE(e.submitted_at) <= $3)
          AND ($4 IS NULL OR e.risk_level = $4)
          AND ($5 IS NULL OR e.provider_name = $5)
          AND ($6 IS NULL OR e.assigned_reviewer_id = $6)
          AND ($7 IS NULL OR e.nationality = $7)
          AND ($8 IS NULL OR e.id_issuing_country = $8)
          AND ($9 IS NULL OR e.id_type = $9)
          AND ($10 IS NULL OR e.provider_verification_result = $10)
          AND ($11 IS NULL OR e.manual_review_required = $11)
          AND (
              $12 IS NULL
              OR CAST(e.id AS TEXT) = $12
              OR LOWER(COALESCE(e.full_name, '')) LIKE LOWER($13)
              OR LOWER(COALESCE(e.email, '')) LIKE LOWER($13)
              OR COALESCE(e.phone, '') LIKE $13
              OR COALESCE(e.id_number, '') = $12
              OR CAST(e.user_id AS TEXT) = $12
          )
        {order_clause}
        {page_clause}
        "#
    )
}

fn normalized_search(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_start_matches("EKYC-").to_string())
}

fn bind_count_filters<'q>(
    query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    params: &'q EkycListQuery,
    exact_search: &'q Option<String>,
    like_search: &'q Option<String>,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    query
        .bind(
            params
                .status
                .as_ref()
                .filter(|status| status.as_str() != "all"),
        )
        .bind(params.submission_from)
        .bind(params.submission_to)
        .bind(
            params
                .risk_level
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .verification_method
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(params.assigned_reviewer_id)
        .bind(
            params
                .nationality
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .country
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .document_type
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .provider_result
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(params.manual_review_required)
        .bind(exact_search.as_ref())
        .bind(like_search.as_ref())
}

fn bind_data_filters<'q>(
    query: sqlx::query::QueryAs<
        'q,
        sqlx::Postgres,
        EkycApplicationSummaryRow,
        sqlx::postgres::PgArguments,
    >,
    params: &'q EkycListQuery,
    exact_search: &'q Option<String>,
    like_search: &'q Option<String>,
) -> sqlx::query::QueryAs<'q, sqlx::Postgres, EkycApplicationSummaryRow, sqlx::postgres::PgArguments>
{
    query
        .bind(
            params
                .status
                .as_ref()
                .filter(|status| status.as_str() != "all"),
        )
        .bind(params.submission_from)
        .bind(params.submission_to)
        .bind(
            params
                .risk_level
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .verification_method
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(params.assigned_reviewer_id)
        .bind(
            params
                .nationality
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .country
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .document_type
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(
            params
                .provider_result
                .as_ref()
                .filter(|value| value.as_str() != "all"),
        )
        .bind(params.manual_review_required)
        .bind(exact_search.as_ref())
        .bind(like_search.as_ref())
}

#[cfg(test)]
mod tests {
    use super::synthesize_guest_credentials;

    #[test]
    fn synthesize_guest_credentials_is_unique_and_deterministic_per_guest() {
        let (username, email) = synthesize_guest_credentials(42);
        assert_eq!(username, "guest_42");
        assert_eq!(email, "guest_42@ekyc.local");

        // Same guest → same credentials (idempotent), different guest → different.
        assert_eq!(synthesize_guest_credentials(42), (username, email));
        let (other_username, other_email) = synthesize_guest_credentials(43);
        assert_ne!(other_username, "guest_42");
        assert_ne!(other_email, "guest_42@ekyc.local");
    }
}
