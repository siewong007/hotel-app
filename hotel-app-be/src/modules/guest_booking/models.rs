use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// A guest's optional smoking / non-smoking room preference.
///
/// Soft by design: it steers `allocate_room_tx` toward rooms whose
/// `rooms.is_smoking` matches, but never removes rooms from availability or
/// refuses a booking. `None` (no preference) is stored as SQL NULL and fills
/// non-smoking rooms first. Stored in `bookings.smoking_preference` as the
/// `as_str` value, which the column's CHECK constraint pins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmokingPreference {
    Smoking,
    NonSmoking,
}

impl SmokingPreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Smoking => "smoking",
            Self::NonSmoking => "non_smoking",
        }
    }

    /// Whether this preference asks for a smoking room.
    pub fn wants_smoking(self) -> bool {
        matches!(self, Self::Smoking)
    }

    /// Whether a room with the given `rooms.is_smoking` value satisfies it.
    pub fn is_met_by(self, room_is_smoking: bool) -> bool {
        self.wants_smoking() == room_is_smoking
    }
}

/// The room `allocate_room_tx` picked, with the attribute the smoking
/// preference is matched against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocatedRoom {
    pub room_id: i64,
    pub is_smoking: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingSearchQuery {
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OnlineInventoryQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    /// Legacy single-date alias kept for frontends deployed before the range
    /// read shipped — `?stay_date=` behaves like `from=to=stay_date`.
    pub stay_date: Option<String>,
}

/// A custom online price exactly as the client sent it — a JSON string
/// (`"149.50"`, what the web client sends) or a JSON number. Kept raw so the
/// service can reject scientific notation (`"1e3"`), more than two decimals
/// and non-positive values with a clear 400, instead of the framework's
/// generic deserialization rejection. Parsed by `service::parse_custom_price`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum CustomPriceInput {
    Text(String),
    Number(serde_json::Number),
}

impl CustomPriceInput {
    /// The client's literal spelling of the price.
    pub fn as_literal(&self) -> String {
        match self {
            Self::Text(text) => text.trim().to_string(),
            Self::Number(number) => number.to_string(),
        }
    }
}

/// Distinguishes an absent JSON field (`None`) from an explicit `null`
/// (`Some(None)`) — `#[serde(default)]` alone folds both into `None`.
fn deserialize_present<'de, T, D>(deserializer: D) -> Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateOnlineInventoryRequest {
    pub walk_in_reserved_rooms: i32,
    pub online_booking_enabled: bool,
    pub custom_price: Option<CustomPriceInput>,
    /// Optimistic-concurrency precondition; same contract as
    /// [`OnlineInventoryCellUpdate::expected_updated_at`].
    #[serde(default, deserialize_with = "deserialize_present")]
    pub expected_updated_at: Option<Option<DateTime<Utc>>>,
}

/// One cell of a bulk online-inventory write. `reset` deletes the allocation
/// row outright (cell returns to defaults); otherwise all three fields are
/// required — the backend never merges partial cell updates.
#[derive(Debug, Clone, Deserialize)]
pub struct OnlineInventoryCellUpdate {
    pub room_type_id: i64,
    pub stay_date: String,
    #[serde(default)]
    pub reset: bool,
    pub walk_in_reserved_rooms: Option<i32>,
    pub online_booking_enabled: Option<bool>,
    pub custom_price: Option<CustomPriceInput>,
    /// Optimistic-concurrency precondition: the cell's `updated_at` as the
    /// client last read it. `null` means "I saw no stored row" — the write
    /// conflicts if another admin created one meanwhile. A timestamp means
    /// the stored row must still carry exactly that `updated_at`. Omitting
    /// the field skips the check (clients predating the precondition).
    #[serde(default, deserialize_with = "deserialize_present")]
    pub expected_updated_at: Option<Option<DateTime<Utc>>>,
}

/// A cell whose stored state no longer matches the client's precondition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OnlineInventoryConflict {
    pub room_type_id: i64,
    pub stay_date: NaiveDate,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BulkUpdateOnlineInventoryRequest {
    pub cells: Vec<OnlineInventoryCellUpdate>,
}

#[derive(Debug, Clone)]
pub struct OnlineInventoryAffectedSpan {
    pub room_type_id: i64,
    pub first_date: NaiveDate,
    pub last_date: NaiveDate,
}

#[derive(Debug, Clone)]
pub struct BulkOnlineInventoryOutcome {
    pub allocations: Vec<OnlineInventoryAllocation>,
    pub spans: Vec<OnlineInventoryAffectedSpan>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OnlineInventoryAllocation {
    pub room_type_id: i64,
    pub room_type_code: String,
    pub room_type_name: String,
    pub stay_date: NaiveDate,
    pub physical_available_rooms: i64,
    pub walk_in_reserved_rooms: i32,
    pub online_booking_enabled: bool,
    pub custom_price: Option<Decimal>,
    /// Effective nightly rate without the custom override: the applicable rate
    /// plan for the date, else the weekday/weekend/base fallback — the price a
    /// guest pays when `custom_price` is null.
    pub standard_price: Decimal,
    /// An `online_inventory_allocations` row exists for this cell, even if it
    /// stores defaults — distinguishes configured cells from untouched ones.
    pub is_override: bool,
    pub online_available_rooms: i64,
    /// When the stored row last changed; `null` when no row exists. Echoed
    /// back as `expected_updated_at` so a stale save is refused with 409.
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BookingQuoteRequest {
    pub room_type_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub voucher_id: Option<i64>,
    /// Nights the guest wants to fund with complimentary-night credits, as
    /// `YYYY-MM-DD` strings. The guest picks the specific nights (mirroring the
    /// staff `book-with-credits` flow) because nightly rates vary, so which
    /// night is comped changes what is owed.
    #[serde(default)]
    pub complimentary_dates: Option<Vec<String>>,
    /// `local` or `foreign`. Anonymous quotes send this so tourism tax can be
    /// priced before a guest row exists. Authenticated quotes fall back to the
    /// guest profile when it is omitted.
    #[serde(default)]
    pub tourism_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateGuestBookingRequest {
    pub client_request_id: String,
    pub room_type_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub voucher_id: Option<i64>,
    #[serde(default)]
    pub complimentary_dates: Option<Vec<String>>,
    pub expected_total: Decimal,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
    /// `smoking`, `non_smoking`, or absent / `no_preference` for none.
    /// Validated by `validate_smoking_preference`; soft (never blocks).
    #[serde(default)]
    pub smoking_preference: Option<String>,
    /// Consent taken on the booking form. The Booking Terms and the Privacy
    /// Notice are mandatory; the request is refused before any row is written
    /// if either is missing, refused, or pinned to a superseded version.
    #[serde(default)]
    pub consents: Vec<crate::modules::consent::models::ConsentAcceptance>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NightlyRate {
    pub date: NaiveDate,
    pub rate_plan_code: String,
    pub amount: Decimal,
    /// Channel pricing rule that produced this rate — internal linkage only,
    /// never serialized to guests.
    #[serde(skip_serializing)]
    pub rule_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingOffer {
    pub room_type_id: i64,
    pub room_type_code: String,
    pub room_type_name: String,
    pub description: Option<String>,
    pub max_occupancy: i32,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub images: Vec<String>,
    pub features: Vec<String>,
    pub available_rooms: i64,
    pub currency: String,
    pub nightly_rates: Vec<NightlyRate>,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
}

/// Public marketing-facing room type — no pricing or availability fields.
#[derive(Debug, Clone, Serialize)]
pub struct PublicRoomType {
    pub id: i64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub images: Vec<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingQuote {
    pub room_type_id: i64,
    pub room_type_code: String,
    pub room_type_name: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub adults: i32,
    pub children: i32,
    pub currency: String,
    pub nightly_rates: Vec<NightlyRate>,
    pub subtotal: Decimal,
    /// Total discount: complimentary nights plus any voucher. `total_amount`
    /// is always `subtotal - discount_amount + tax_amount`.
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
    pub voucher_id: Option<i64>,
    pub voucher_name: Option<String>,
    /// The nights being funded by credits, and what they are worth. Broken out
    /// of `discount_amount` so the guest can see credits and voucher separately.
    pub complimentary_dates: Vec<NaiveDate>,
    pub complimentary_nights: i32,
    pub complimentary_discount: Decimal,
    /// Credits the guest currently holds for this room type (not this quote).
    pub credits_available: i32,
    /// Hours an unpaid online booking keeps its room before the hold is
    /// released (`None` when auto-release is off). Shown at the review step so
    /// the terms' "holding period shown at the time of booking" is real.
    pub hold_release_hours: Option<i32>,
    /// Whether the applied voucher permits cancelling the booking
    /// (`None` when no voucher is applied). The review step warns on `false`.
    pub voucher_is_cancellable: Option<bool>,
    /// Shared-engine pricing for the applied voucher; `create()` persists its
    /// nightly split. Internal only — never serialized to the guest.
    #[serde(skip)]
    pub voucher_pricing: Option<crate::modules::promotions::pricing::PromotionPricing>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingVoucherOptions {
    pub quote: GuestBookingQuote,
    pub eligible_voucher_ids: Vec<i64>,
}

/// Contact details an anonymous booker supplies inline, standing in for the
/// account a signed-in booking would read them from.
#[derive(Debug, Clone, Deserialize)]
pub struct AnonymousGuestDetails {
    pub first_name: String,
    /// Accepted so an older client's payload still deserializes, then
    /// deliberately discarded: `validate_anonymous_guest` forces the stored
    /// last name to `None` rather than let a crafted body occupy the unique
    /// identifier with "First Last". Never read on purpose.
    #[allow(dead_code)]
    pub last_name: Option<String>,
    /// Required, unlike a front-desk booking: it is the only way to send the
    /// confirmation and the only factor (with the booking number) that lets the
    /// guest retrieve the booking again.
    pub email: String,
    pub phone: Option<String>,
    /// `local` or `foreign`. Never defaulted anywhere in the booking path —
    /// it decides whether tourism tax applies, so a silent default is a money
    /// error rather than a convenience.
    pub tourism_type: String,
}

/// A booking created without an account.
///
/// Deliberately has no `voucher_id` and no `complimentary_dates`: discounts and
/// rewards belong to an account, and an anonymous booking pays list price.
#[derive(Debug, Clone, Deserialize)]
pub struct AnonymousBookingRequest {
    pub client_request_id: String,
    pub room_type_id: i64,
    pub check_in_date: String,
    pub check_out_date: String,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    pub expected_total: Decimal,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
    /// `smoking`, `non_smoking`, or absent / `no_preference` for none.
    /// Validated by `validate_smoking_preference`; soft (never blocks).
    #[serde(default)]
    pub smoking_preference: Option<String>,
    pub guest: AnonymousGuestDetails,
    /// Consent taken on the booking form. The Booking Terms and the Privacy
    /// Notice are mandatory; the request is refused before any row is written
    /// if either is missing, refused, or pinned to a superseded version.
    #[serde(default)]
    pub consents: Vec<crate::modules::consent::models::ConsentAcceptance>,
    /// Optional marketing opt-in, recorded through the notification consent
    /// ledger rather than `consent_records`.
    #[serde(default)]
    pub marketing_opt_in: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GuestBookingConfirmation {
    pub booking_id: i64,
    pub booking_number: String,
    pub room_type_name: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub status: String,
    pub payment_status: String,
    pub currency: String,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
    pub created_at: DateTime<Utc>,
    /// The smoking preference recorded on the booking (`smoking` /
    /// `non_smoking`), or `None` for no preference. Echoed so the portal's
    /// confirmation summary shows what was asked for — never which room.
    pub smoking_preference: Option<String>,
    /// Booking-scoped access token, returned only for an anonymous booking so
    /// the guest can pay and track this one booking with no account. A
    /// session-authenticated booking authenticates by session and gets `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct RoomTypeInventory {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub description: Option<String>,
    pub base_price: Decimal,
    pub weekday_rate: Option<Decimal>,
    pub weekend_rate: Option<Decimal>,
    pub max_occupancy: i32,
    pub bed_type: Option<String>,
    pub bed_count: Option<i32>,
    pub images: Vec<String>,
    pub features: Vec<String>,
    pub available_rooms: i64,
}

#[derive(Debug, Clone)]
pub struct VoucherPricing {
    pub voucher_id: i64,
    pub promotion_id: i64,
    pub promotion_name: String,
    pub discount_type: String,
    pub discount_value: Decimal,
    pub max_discount_amount: Option<Decimal>,
    /// `promotions.is_cancellable` — `false` means redeeming this voucher
    /// locks the booking against cancellation. Surfaced on the quote so the
    /// review step can warn before the guest commits.
    pub is_cancellable: bool,
}

#[derive(Debug, Clone)]
pub struct GuestContact {
    pub actor_user_id: Option<i64>,
    pub nick_name: String,
    pub email: Option<String>,
    /// `guests.language_preference` — first hop of the mail-locale chain.
    pub language_preference: Option<String>,
}

#[derive(Debug, Clone)]
pub struct BookingInsert {
    pub portal_request_id: String,
    pub guest_id: i64,
    pub actor_user_id: Option<i64>,
    pub room_id: i64,
    pub booking_number: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub adults: i32,
    pub children: i32,
    pub room_rate: Decimal,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub total_amount: Decimal,
    pub currency: String,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
    /// `None` = no preference (stored as NULL).
    pub smoking_preference: Option<SmokingPreference>,
    /// Staff-only note written to `bookings.internal_notes`, e.g. when the
    /// allocated room could not satisfy the smoking preference.
    pub internal_notes: Option<String>,
    pub booking_channel_id: Option<i64>,
    pub nightly_rates: serde_json::Value,
    /// Set when credits funded at least one night; drives `is_complimentary`
    /// and the staff-visible `complimentary_reason` on the booking row.
    pub complimentary_reason: Option<String>,
    /// A stay fully covered by credits has nothing to pay, so it is booked
    /// straight to confirmed/paid instead of the normal pending-payment flow.
    pub settled_by_credits: bool,
    /// Foreign guests are billed tourism tax on top of `total_amount`.
    pub is_tourist: bool,
    pub tourism_tax_amount: Decimal,
    /// Channel economics frozen at write time (None when unattributed).
    pub commission_amount: Option<Decimal>,
    pub net_revenue: Option<Decimal>,
    pub channel_pricing_snapshot: Option<serde_json::Value>,
}
