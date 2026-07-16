use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct Promotion {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub terms: Option<String>,
    pub status: String,
    pub promotion_kind: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub max_discount_amount: Option<f64>,
    pub currency: String,
    pub claim_starts_at: Option<DateTime<Utc>>,
    pub claim_ends_at: Option<DateTime<Utc>>,
    pub stay_starts_on: Option<NaiveDate>,
    pub stay_ends_on: Option<NaiveDate>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_subtotal: Option<f64>,
    pub claim_limit: Option<i64>,
    pub claimed_count: i64,
    pub per_guest_limit: i32,
    pub is_public: bool,
    pub room_type_ids: Vec<i64>,
    pub version: i64,
    pub created_by: Option<i64>,
    pub updated_by: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Promotion fields safe to expose to guests and public catalogue visitors.
/// Staff actor identifiers deliberately remain on [`Promotion`].
#[derive(Debug, Clone, Serialize)]
pub struct PublicPromotion {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub terms: Option<String>,
    pub status: String,
    pub promotion_kind: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub max_discount_amount: Option<f64>,
    pub currency: String,
    pub claim_starts_at: Option<DateTime<Utc>>,
    pub claim_ends_at: Option<DateTime<Utc>>,
    pub stay_starts_on: Option<NaiveDate>,
    pub stay_ends_on: Option<NaiveDate>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_subtotal: Option<f64>,
    pub claim_limit: Option<i64>,
    pub claimed_count: i64,
    pub per_guest_limit: i32,
    pub is_public: bool,
    pub room_type_ids: Vec<i64>,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Promotion> for PublicPromotion {
    fn from(value: Promotion) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
            name: value.name,
            description: value.description,
            terms: value.terms,
            status: value.status,
            promotion_kind: value.promotion_kind,
            discount_type: value.discount_type,
            discount_value: value.discount_value,
            max_discount_amount: value.max_discount_amount,
            currency: value.currency,
            claim_starts_at: value.claim_starts_at,
            claim_ends_at: value.claim_ends_at,
            stay_starts_on: value.stay_starts_on,
            stay_ends_on: value.stay_ends_on,
            min_nights: value.min_nights,
            max_nights: value.max_nights,
            min_subtotal: value.min_subtotal,
            claim_limit: value.claim_limit,
            claimed_count: value.claimed_count,
            per_guest_limit: value.per_guest_limit,
            is_public: value.is_public,
            room_type_ids: value.room_type_ids,
            version: value.version,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PromotionListResponse {
    pub items: Vec<Promotion>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Serialize)]
pub struct PublicPromotionListResponse {
    pub items: Vec<PublicPromotion>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Serialize)]
pub struct GuestPromotion {
    pub promotion: PublicPromotion,
    pub can_claim: bool,
    pub has_voucher: bool,
}

#[derive(Debug, Serialize)]
pub struct GuestPromotionListResponse {
    pub items: Vec<GuestPromotion>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Voucher {
    pub id: i64,
    pub promotion_id: i64,
    pub guest_id: i64,
    pub promotion_name: String,
    pub promotion_slug: String,
    /// The owning portal guest is allowed to see the full code. Staff lists
    /// receive `None` here and should display `code_masked` instead.
    pub code: Option<String>,
    pub code_masked: String,
    pub status: String,
    pub source: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub claimed_at: Option<DateTime<Utc>>,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct VoucherListResponse {
    pub items: Vec<Voucher>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Deserialize)]
pub struct PromotionListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PromotionInput {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub terms: Option<String>,
    pub promotion_kind: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub max_discount_amount: Option<f64>,
    pub currency: Option<String>,
    pub claim_starts_at: Option<DateTime<Utc>>,
    pub claim_ends_at: Option<DateTime<Utc>>,
    pub stay_starts_on: Option<NaiveDate>,
    pub stay_ends_on: Option<NaiveDate>,
    pub min_nights: Option<i32>,
    pub max_nights: Option<i32>,
    pub min_subtotal: Option<f64>,
    pub claim_limit: Option<i64>,
    pub per_guest_limit: Option<i32>,
    pub is_public: Option<bool>,
    pub room_type_ids: Option<Vec<i64>>,
    pub expected_version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PromotionActionInput {
    pub expected_version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ClaimPromotionInput {
    /// The unique guest/promotion constraint makes repeated claims idempotent;
    /// this client identifier is retained for API compatibility and tracing.
    pub client_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VoucherIssueInput {
    pub promotion_id: i64,
    pub guest_id: i64,
    pub code: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct VoucherRevokeInput {
    pub reason: Option<String>,
}
