//! Guest portal API models.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use super::{Booking, Guest, GuestEkycStatusSummary};

/// Request for verifying a guest booking.
#[derive(Debug, Deserialize)]
pub struct GuestPortalVerifyRequest {
    pub booking_number: String,
    pub email: String,
}

/// Response for guest portal verification.
#[derive(Debug, Serialize)]
pub struct GuestPortalVerifyResponse {
    pub token: String,
    pub expires_at: String,
    pub booking_id: String,
}

/// Guest-facing subset of a booking. Portal endpoints are reachable with only
/// the pre-check-in token, so internal fields (staff remarks, rates, payment
/// state, overrides) must not appear here.
#[derive(Debug, Serialize)]
pub struct GuestPortalBookingView {
    pub id: i64,
    pub booking_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub special_requests: Option<String>,
    pub market_code: Option<String>,
    pub pre_checkin_completed: Option<bool>,
    pub pre_checkin_completed_at: Option<DateTime<Utc>>,
}

impl From<Booking> for GuestPortalBookingView {
    fn from(booking: Booking) -> Self {
        GuestPortalBookingView {
            id: booking.id,
            booking_number: booking.booking_number,
            check_in_date: booking.check_in_date,
            check_out_date: booking.check_out_date,
            status: booking.status,
            adults: booking.adults,
            children: booking.children,
            special_requests: booking.special_requests,
            market_code: booking.market_code,
            pre_checkin_completed: booking.pre_checkin_completed,
            pre_checkin_completed_at: booking.pre_checkin_completed_at,
        }
    }
}

/// Guest-facing subset of a guest profile: the contact/identity fields the
/// pre-check-in form pre-fills, nothing operational (credits, discounts,
/// account flags).
#[derive(Debug, Serialize)]
pub struct GuestPortalGuestView {
    pub full_name: String,
    pub title: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub alt_phone: Option<String>,
    pub ic_number: Option<String>,
    pub nationality: Option<String>,
    pub address_line1: Option<String>,
    pub city: Option<String>,
    pub state_province: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

impl From<Guest> for GuestPortalGuestView {
    fn from(guest: Guest) -> Self {
        GuestPortalGuestView {
            full_name: guest.full_name,
            title: guest.title,
            email: guest.email,
            phone: guest.phone,
            alt_phone: guest.alt_phone,
            ic_number: guest.ic_number,
            nationality: guest.nationality,
            address_line1: guest.address_line1,
            city: guest.city,
            state_province: guest.state_province,
            postal_code: guest.postal_code,
            country: guest.country,
        }
    }
}

/// Response for guest portal booking details.
#[derive(Debug, Serialize)]
pub struct GuestPortalBookingResponse {
    pub booking: GuestPortalBookingView,
    pub guest: GuestPortalGuestView,
    pub ekyc_summary: GuestEkycStatusSummary,
}

// ============================================================================
// Guest portal session login + guest-scoped read views
// ============================================================================

/// Successful portal session response. The raw token is returned exactly once; it is
/// never persisted (only its SHA-256 hash is stored) and never serialized again.
#[derive(Debug, Serialize)]
pub struct GuestPortalLoginResponse {
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub guest: GuestPortalGuestView,
}

/// Wrapper for GET /guest-portal/me.
#[derive(Debug, Serialize)]
pub struct GuestPortalMeResponse {
    pub guest: GuestPortalGuestView,
}

/// One booking row in the guest's booking history.
#[derive(Debug, Serialize)]
pub struct GuestPortalBookingSummary {
    pub booking_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
    pub total_amount: rust_decimal::Decimal,
}

/// Paginated list wrapper used by the guest history endpoints.
#[derive(Debug, Serialize)]
pub struct GuestPortalPage<T> {
    pub items: Vec<T>,
    pub total: i64,
}

/// One transaction row (payment or invoice) in the guest's financial history.
#[derive(Debug, Serialize)]
pub struct GuestPortalTransaction {
    /// "payment" or "invoice".
    pub kind: String,
    pub date: DateTime<Utc>,
    pub amount: rust_decimal::Decimal,
    /// Payment method (payments only, else null).
    pub method: Option<String>,
    pub reference: Option<String>,
    /// Invoice number (invoices only, else null).
    pub invoice_number: Option<String>,
    pub booking_number: Option<String>,
    pub status: Option<String>,
}

/// Membership summary block for GET /guest-portal/me/membership.
#[derive(Debug, Serialize)]
pub struct GuestPortalMembership {
    pub member_number: String,
    pub tier_name: String,
    pub tier_level: i32,
    pub points_balance: i32,
    pub lifetime_points: i32,
    pub status: String,
}

/// One points-activity row for the membership endpoint.
#[derive(Debug, Serialize)]
pub struct GuestPortalPointsActivity {
    pub date: DateTime<Utc>,
    pub transaction_type: String,
    pub points: i32,
    pub balance_after: i32,
}

/// Response for GET /guest-portal/me/membership.
#[derive(Debug, Serialize)]
pub struct GuestPortalMembershipResponse {
    pub membership: Option<GuestPortalMembership>,
    pub recent_activity: Vec<GuestPortalPointsActivity>,
}

/// One tier-benefit row for the benefits endpoint.
#[derive(Debug, Serialize)]
pub struct GuestPortalTierBenefit {
    pub tier_name: String,
    pub discount_percentage: rust_decimal::Decimal,
}

/// One reward-catalog row for the benefits endpoint.
#[derive(Debug, Serialize)]
pub struct GuestPortalReward {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub points_required: i32,
    pub affordable: bool,
}

/// Response for GET /guest-portal/me/benefits.
#[derive(Debug, Serialize)]
pub struct GuestPortalBenefitsResponse {
    pub tier_benefits: Vec<GuestPortalTierBenefit>,
    pub rewards: Vec<GuestPortalReward>,
}

/// Pagination query params for the guest history endpoints.
#[derive(Debug, Deserialize)]
pub struct GuestPortalPageQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

impl GuestPortalPageQuery {
    /// Clamp page to >= 1 and per_page to 1..=100 (default 20), returning
    /// (limit, offset).
    pub fn limit_offset(&self) -> (i64, i64) {
        let per_page = self.per_page.unwrap_or(20).clamp(1, 100);
        let page = self.page.unwrap_or(1).max(1);
        (per_page, (page - 1) * per_page)
    }
}
