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
    pub is_cancellable: bool,
    /// Staff-only operations reference code; never exposed on public reads.
    pub internal_code: Option<String>,
    /// Staff-only campaign objective tag; never exposed on public reads.
    pub objective: Option<String>,
    pub room_type_ids: Vec<i64>,
    /// Booking channels the campaign's vouchers may be redeemed on. Empty =
    /// every channel.
    pub booking_channel_ids: Vec<i64>,
    /// Loyalty tiers allowed to claim or be issued the campaign's vouchers.
    /// Empty = every guest.
    pub loyalty_tier_ids: Vec<i64>,
    /// Derived lifecycle: stored status plus `scheduled`/`live`/`expired`
    /// resolution for published rows. Never persisted.
    pub lifecycle: String,
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
    pub is_cancellable: bool,
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
            is_cancellable: value.is_cancellable,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim_unavailable_reason: Option<String>,
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
    /// `promotions.is_cancellable` — a non-cancellable voucher locks the
    /// booking against cancellation, so the guest must see it before applying.
    pub is_cancellable: bool,
    /// Display name of the owning guest (`guests.nick_name`). Only populated
    /// for staff/admin reads; guest-facing queries leave it `None`.
    pub guest_name: Option<String>,
    /// Why the voucher was revoked. Staff/admin reads only — guest-facing
    /// queries leave it `None`.
    pub revocation_reason: Option<String>,
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
    /// Optional voucher-list filter; promotion and guest lists ignore it.
    pub promotion_id: Option<i64>,
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
    pub is_cancellable: Option<bool>,
    pub room_type_ids: Option<Vec<i64>>,
    pub internal_code: Option<String>,
    pub objective: Option<String>,
    pub booking_channel_ids: Option<Vec<i64>>,
    pub loyalty_tier_ids: Option<Vec<i64>>,
    pub expected_version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PromotionActionInput {
    pub expected_version: Option<i64>,
    /// Optional operator note recorded in the audit event (e.g. cancel reason).
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClaimPromotionInput {
    /// The unique guest/promotion constraint makes repeated claims idempotent;
    /// this client identifier is retained for API compatibility and tracing.
    pub client_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoucherIssueInput {
    pub promotion_id: i64,
    pub guest_id: i64,
    pub code: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoucherRevokeInput {
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VoucherSummaryDiscount {
    pub currency: String,
    pub amount: f64,
}

/// Aggregate counters for the staff voucher dashboard. `expired` and
/// `expiring_soon` are overlapping subsets of `available` (the persisted
/// status never changes), so `available + redeemed + revoked == total`.
#[derive(Debug, Serialize)]
pub struct VoucherSummary {
    pub total: i64,
    pub available: i64,
    pub redeemed: i64,
    pub revoked: i64,
    /// `available` rows whose `expires_at` is already past.
    pub expired: i64,
    /// `available` rows expiring within the next 7 days.
    pub expiring_soon: i64,
    /// `voucher_redemptions` rows with status `applied`.
    pub redemption_count: i64,
    /// Sum of applied `discount_amount` grouped by the promotion's currency.
    pub discount_given: Vec<VoucherSummaryDiscount>,
}

#[derive(Debug, Serialize)]
pub struct TargetingChannelOption {
    pub id: i64,
    pub name: String,
    pub channel_type: String,
}

#[derive(Debug, Serialize)]
pub struct TargetingTierOption {
    pub id: i64,
    pub code: Option<String>,
    pub name: String,
}

/// Pick-list values for the campaign editor's channel/tier targeting controls.
#[derive(Debug, Serialize)]
pub struct TargetingOptionsResponse {
    pub channels: Vec<TargetingChannelOption>,
    pub loyalty_tiers: Vec<TargetingTierOption>,
}

#[derive(Debug, Serialize)]
pub struct CampaignVoucherFunnel {
    pub total: i64,
    pub available: i64,
    pub redeemed: i64,
    pub revoked: i64,
    /// `available` rows whose `expires_at` is already past.
    pub expired: i64,
    pub guest_claims: i64,
    pub admin_issues: i64,
}

#[derive(Debug, Serialize)]
pub struct CampaignRedemptionTotals {
    pub applied: i64,
    pub reversed: i64,
    pub gross_subtotal: f64,
    pub discount_amount: f64,
    pub net_total: f64,
    pub bookings: i64,
    pub guests: i64,
    /// applied / total vouchers; `null` when the campaign issued none.
    pub conversion_rate: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct CampaignPerNightTotals {
    pub nights: i64,
    pub gross_amount: f64,
    pub discount_amount: f64,
    pub net_amount: f64,
}

#[derive(Debug, Serialize)]
pub struct CampaignChannelMixRow {
    pub channel_id: Option<i64>,
    pub name: String,
    pub channel_type: Option<String>,
    pub redemptions: i64,
    pub net_total: f64,
}

/// Per-campaign performance over `vouchers`, `voucher_redemptions`, and
/// `voucher_redemption_allocations`. Everything here is counted from real
/// rows — there are no impression or click metrics to fabricate.
#[derive(Debug, Serialize)]
pub struct CampaignPerformance {
    pub promotion_id: i64,
    pub currency: String,
    pub vouchers: CampaignVoucherFunnel,
    pub redemptions: CampaignRedemptionTotals,
    pub per_night: CampaignPerNightTotals,
    pub channel_mix: Vec<CampaignChannelMixRow>,
}

#[cfg(test)]
mod tests {
    use super::{ClaimPromotionInput, VoucherIssueInput, VoucherRevokeInput};

    #[test]
    fn voucher_inputs_reject_mass_assignment_fields() {
        assert!(
            serde_json::from_value::<ClaimPromotionInput>(serde_json::json!({
                "client_request_id": "claim-1",
                "guest_id": 99
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VoucherIssueInput>(serde_json::json!({
                "promotion_id": 1,
                "guest_id": 2,
                "status": "redeemed"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<VoucherRevokeInput>(serde_json::json!({
                "reason": "test",
                "revoked_by": 99
            }))
            .is_err()
        );
    }
}
