use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;
use serde_json::json;
use uuid::Uuid;

use super::availability::{AvailabilityEvent, AvailabilityHub};
use super::models::{
    AnonymousBookingRequest, BookingInsert, BookingQuoteRequest, BookingSearchQuery,
    CreateGuestBookingRequest, GuestBookingConfirmation, GuestBookingOffer, GuestBookingQuote,
    GuestBookingVoucherOptions, NightlyRate, OnlineInventoryAllocation, OnlineInventoryQuery,
    RoomTypeInventory, UpdateOnlineInventoryRequest, VoucherPricing,
};
use super::repository::{
    GuestBookingRepository as Repository, VoucherEligibilityQuery, VoucherRedemptionValues,
};
use super::validation::{
    ValidatedStay, validate_anonymous_guest, validate_client_request_id,
    validate_complimentary_dates, validate_stay,
};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::core::settings_cache;
use crate::models::AuditEvent;
use crate::modules::communications::email_layout::{self, Cta, GuestEmail};
use crate::modules::communications::repository::{CommunicationsRepository, DeliveryValues};
use crate::modules::communications::service as communications_service;
use crate::modules::communications::validation::html_escape;
use crate::modules::consent::models::{ConsentDocument, ConsentSource};
use crate::modules::consent::service::{self as consent_service, ConsentContext, ConsentSubject};
use crate::modules::consent::validation as consent_validation;
use crate::services::audit::AuditLog;
use crate::services::google_identity::ProfileCompletion;
use crate::services::profile::completion_for_guest;
use crate::utils::sanitization::Sanitizer;

const PORTAL_SOURCE: &str = "website";

/// Minimum life of an anonymous booking's access token.
const ANONYMOUS_ACCESS_TOKEN_DAYS: i64 = 14;

/// How far before arrival `POST /guest-portal/verify` starts reissuing a token
/// (`verify_guest_booking` rejects anything earlier). Mirrored here so the two
/// windows can be made to meet.
const VERIFY_REISSUE_WINDOW_DAYS: i64 = 7;

/// When an anonymous booking's access token should lapse.
///
/// The booking is created unpaid, and an anonymous guest has no account to sign
/// in to — so their only routes to paying it are this token and, closer to
/// arrival, re-verifying with their booking number and email. Expiring the
/// token at a flat 14 days would strand a booking made further ahead than that:
/// the token would be gone and `verify` would not yet answer, leaving the guest
/// unable to pay their own reservation. Holding it until the verify window
/// opens makes the two periods meet with no gap.
/// Tourism tax billed to a foreign guest: `rate × billable nights`.
///
/// Matches the staff booking path (`canonical_tourism_tax_for_guest`): local
/// (and anything that is not `foreign`) is not charged, and a same-day stay
/// still bills one night. Room rates stay tax-inclusive; this is the extra
/// per-night levy stored on `bookings.tourism_tax_amount`.
fn tourism_tax_for_type(tourism_type: &str, nights: i64, rate: Decimal) -> Decimal {
    if !tourism_type.eq_ignore_ascii_case("foreign") {
        return Decimal::ZERO;
    }
    rate * Decimal::from(nights.max(1))
}

fn is_foreign_tourist(tourism_type: &str) -> bool {
    tourism_type.eq_ignore_ascii_case("foreign")
}

pub(crate) fn anonymous_access_token_expiry(
    now: chrono::DateTime<chrono::Utc>,
    check_in: NaiveDate,
) -> chrono::DateTime<chrono::Utc> {
    let minimum = now + Duration::days(ANONYMOUS_ACCESS_TOKEN_DAYS);
    let verify_opens = check_in
        .and_hms_opt(0, 0, 0)
        .map(|naive| naive.and_utc() - Duration::days(VERIFY_REISSUE_WINDOW_DAYS));
    match verify_opens {
        Some(verify_opens) if verify_opens > minimum => verify_opens,
        _ => minimum,
    }
}

/// Expiry used when an anonymous create is retried with the same client
/// request id. Keep the original deadline while it is still in the future so
/// a retry cannot extend the unpaid hold; recompute only when the stored
/// value is missing or already past (the token is hashed at rest, so retry
/// always mints a new plaintext token).
fn replay_anonymous_access_token_expiry(
    now: chrono::DateTime<chrono::Utc>,
    check_in: NaiveDate,
    stored_expiry: Option<chrono::DateTime<chrono::Utc>>,
) -> chrono::DateTime<chrono::Utc> {
    match stored_expiry {
        Some(expiry) if expiry > now => expiry,
        _ => anonymous_access_token_expiry(now, check_in),
    }
}

async fn currency(pool: &DbPool) -> String {
    crate::modules::settings::service::get_setting_value(pool, "currency")
        .await
        .ok()
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| value.len() == 3)
        .unwrap_or_else(|| "MYR".to_string())
}

fn base_rate_for_date(room_type: &RoomTypeInventory, date: NaiveDate) -> Decimal {
    use chrono::Datelike;
    match date.weekday() {
        chrono::Weekday::Sat | chrono::Weekday::Sun => {
            room_type.weekend_rate.unwrap_or(room_type.base_price)
        }
        _ => room_type.weekday_rate.unwrap_or(room_type.base_price),
    }
}

async fn nightly_rates(
    pool: &DbPool,
    room_type: &RoomTypeInventory,
    stay: ValidatedStay,
) -> Result<Vec<NightlyRate>, ApiError> {
    let custom_prices = Repository::online_custom_prices_for_stay(
        pool,
        room_type.id,
        stay.check_in_date,
        stay.check_out_date,
    )
    .await?;
    let mut rates = Vec::new();
    let mut date = stay.check_in_date;
    while date < stay.check_out_date {
        let (rate_plan_code, amount) = if let Some(custom_price) = custom_prices.get(&date) {
            ("ONLINE_CUSTOM".to_string(), *custom_price)
        } else if let Some(rate) = Repository::applicable_rate(pool, room_type.id, date).await? {
            rate
        } else {
            ("BASE".to_string(), base_rate_for_date(room_type, date))
        };
        rates.push(NightlyRate {
            date,
            rate_plan_code,
            amount,
        });
        date += Duration::days(1);
    }
    Ok(rates)
}

/// The complimentary-night credits in play for one quote.
#[derive(Debug, Clone, Default)]
struct ComplimentaryContext {
    /// Nights the guest chose to fund with credits (validated, sorted, unique).
    dates: Vec<NaiveDate>,
    /// Credits the guest holds for this room type right now.
    credits_available: i32,
}

/// What the comped nights are worth, at the rates actually quoted for them.
///
/// Nightly rates vary (weekday/weekend, rate plans, online custom prices), so a
/// credit is worth exactly the night it is spent on — never an average.
fn complimentary_discount(nightly_rates: &[NightlyRate], dates: &[NaiveDate]) -> Decimal {
    nightly_rates
        .iter()
        .filter(|rate| dates.contains(&rate.date))
        .fold(Decimal::ZERO, |total, rate| total + rate.amount)
        .round_dp(2)
}

/// Resolve and bounds-check the guest's complimentary-night selection.
async fn complimentary_context(
    pool: &DbPool,
    guest_id: Option<i64>,
    room_type_id: i64,
    stay: ValidatedStay,
    requested_dates: Option<&[String]>,
) -> Result<ComplimentaryContext, ApiError> {
    // An anonymous booker holds no account, so there are no credits to spend.
    // Reject an explicit selection rather than silently pricing it at zero
    // discount: the caller asked for money off it is not entitled to.
    let Some(guest_id) = guest_id else {
        if requested_dates.is_some_and(|dates| !dates.is_empty()) {
            return Err(ApiError::BadRequest(
                "Complimentary nights require a signed-in account.".to_string(),
            ));
        }
        return Ok(ComplimentaryContext::default());
    };
    let credits_available =
        Repository::complimentary_credits_available(pool, guest_id, room_type_id).await?;
    let dates = validate_complimentary_dates(requested_dates, stay)?;
    if dates.len() as i32 > credits_available {
        return Err(ApiError::BadRequest(format!(
            "You have {credits_available} complimentary night(s) for this room type but selected {}",
            dates.len()
        )));
    }
    Ok(ComplimentaryContext {
        dates,
        credits_available,
    })
}

/// What the guest owes once credits and any voucher are applied.
///
/// Credits settle their nights first, then the voucher discounts whatever is
/// still payable — so the two can never combine to push the total below zero.
/// Returns `(discount_amount, total_amount)`, where `discount_amount` is the
/// combined discount that keeps `total = subtotal - discount` true for the
/// booking row.
fn settlement(
    subtotal: Decimal,
    complimentary_discount: Decimal,
    voucher: Option<&VoucherPricing>,
) -> (Decimal, Decimal) {
    let payable_subtotal = (subtotal - complimentary_discount).max(Decimal::ZERO);
    let voucher_amount = voucher
        .map(|voucher| voucher_discount(payable_subtotal, voucher))
        .unwrap_or(Decimal::ZERO);
    let discount_amount = (complimentary_discount + voucher_amount).round_dp(2);
    let total_amount = (subtotal - discount_amount).round_dp(2);
    (discount_amount, total_amount)
}

fn voucher_discount(subtotal: Decimal, voucher: &VoucherPricing) -> Decimal {
    let discount = if voucher.discount_type == "percentage" {
        subtotal * voucher.discount_value / Decimal::from(100)
    } else {
        voucher.discount_value
    };
    let discount = voucher
        .max_discount_amount
        .map(|maximum| discount.min(maximum))
        .unwrap_or(discount);
    discount.min(subtotal).max(Decimal::ZERO).round_dp(2)
}

async fn voucher_for_quote(
    pool: &DbPool,
    guest_id: Option<i64>,
    room_type_id: i64,
    stay: ValidatedStay,
    subtotal: Decimal,
    currency: &str,
    voucher_id: Option<i64>,
) -> Result<Option<VoucherPricing>, ApiError> {
    let Some(voucher_id) = voucher_id else {
        return Ok(None);
    };
    // Vouchers are issued to an account, so an anonymous booking can never hold
    // one. Fail loudly instead of quoting the undiscounted total under a
    // voucher the caller believes was applied.
    let Some(guest_id) = guest_id else {
        return Err(ApiError::BadRequest(
            "Vouchers require a signed-in account.".to_string(),
        ));
    };
    Repository::eligible_voucher(
        pool,
        voucher_id,
        VoucherEligibilityQuery {
            guest_id,
            room_type_id,
            check_in: stay.check_in_date,
            check_out: stay.check_out_date,
            nights: (stay.check_out_date - stay.check_in_date).num_days(),
            subtotal,
            currency,
        },
    )
    .await
    .map(Some)
}

async fn quote_for_inventory(
    pool: &DbPool,
    guest_id: Option<i64>,
    room_type: RoomTypeInventory,
    stay: ValidatedStay,
    voucher_id: Option<i64>,
    complimentary: &ComplimentaryContext,
    tourism_type: Option<&str>,
) -> Result<GuestBookingQuote, ApiError> {
    if stay.adults + stay.children > room_type.max_occupancy {
        return Err(ApiError::BadRequest(
            "The selected room type cannot accommodate this party".to_string(),
        ));
    }
    let currency = currency(pool).await;
    let nightly_rates = nightly_rates(pool, &room_type, stay).await?;
    let subtotal = nightly_rates
        .iter()
        .fold(Decimal::ZERO, |total, rate| total + rate.amount)
        .round_dp(2);
    let complimentary_discount = complimentary_discount(&nightly_rates, &complimentary.dates);
    // Voucher eligibility (min-spend and the like) still reads the gross
    // subtotal, so applying credits never changes which vouchers qualify.
    let voucher = voucher_for_quote(
        pool,
        guest_id,
        room_type.id,
        stay,
        subtotal,
        &currency,
        voucher_id,
    )
    .await?;
    let (discount_amount, room_total) =
        settlement(subtotal, complimentary_discount, voucher.as_ref());
    // Room prices are tax-inclusive. `tax_amount` here is tourism tax for a
    // foreign guest, billed on top of the room total (same levy the front
    // desk stores on `bookings.tourism_tax_amount`).
    let nights = (stay.check_out_date - stay.check_in_date).num_days();
    let tax_amount = match tourism_type {
        Some(tourism_type) if is_foreign_tourist(tourism_type) => {
            let rate =
                settings_cache::get_positive_decimal(pool, "tourism_tax_rate", Decimal::from(10))
                    .await;
            tourism_tax_for_type(tourism_type, nights, rate)
        }
        _ => Decimal::ZERO,
    };
    let total_amount = room_total + tax_amount;
    Ok(GuestBookingQuote {
        room_type_id: room_type.id,
        room_type_code: room_type.code,
        room_type_name: room_type.name,
        check_in_date: stay.check_in_date,
        check_out_date: stay.check_out_date,
        adults: stay.adults,
        children: stay.children,
        currency,
        nightly_rates,
        subtotal,
        discount_amount,
        tax_amount,
        total_amount,
        voucher_id: voucher.as_ref().map(|voucher| voucher.voucher_id),
        voucher_name: voucher.map(|voucher| voucher.promotion_name),
        complimentary_nights: complimentary.dates.len() as i32,
        complimentary_dates: complimentary.dates.clone(),
        complimentary_discount,
        credits_available: complimentary.credits_available,
    })
}

async fn apply_online_allocation(
    pool: &DbPool,
    mut room_type: RoomTypeInventory,
    stay: ValidatedStay,
) -> Result<RoomTypeInventory, ApiError> {
    let (walk_in_reserved_rooms, online_booking_enabled) = Repository::online_allocation_for_stay(
        pool,
        room_type.id,
        stay.check_in_date,
        stay.check_out_date,
    )
    .await?;
    room_type.available_rooms = if online_booking_enabled {
        (room_type.available_rooms - walk_in_reserved_rooms).max(0)
    } else {
        0
    };
    Ok(room_type)
}

/// Price every bookable room type for a stay.
///
/// `guest_id` is `None` for an anonymous (not signed-in) booker, who is quoted
/// undiscounted list prices — no vouchers, no complimentary credits.
pub async fn search(
    pool: &DbPool,
    guest_id: Option<i64>,
    query: BookingSearchQuery,
) -> Result<Vec<GuestBookingOffer>, ApiError> {
    let stay = validate_stay(
        pool,
        &query.check_in_date,
        &query.check_out_date,
        query.adults,
        query.children,
    )
    .await?;
    let room_types = Repository::list_inventory(
        pool,
        stay.check_in_date,
        stay.check_out_date,
        stay.adults + stay.children,
    )
    .await?;
    let mut offers = Vec::with_capacity(room_types.len());
    for room_type in room_types {
        let room_type = apply_online_allocation(pool, room_type, stay).await?;
        if room_type.available_rooms == 0 {
            continue;
        }
        let images = room_type.images.clone();
        let features = room_type.features.clone();
        let description = room_type.description.clone();
        let max_occupancy = room_type.max_occupancy;
        let bed_type = room_type.bed_type.clone();
        let bed_count = room_type.bed_count;
        let available_rooms = room_type.available_rooms;
        // Search prices the stay as-is; credits are chosen later, on the
        // selected room type, so no per-room-type credit lookup happens here.
        let quote = quote_for_inventory(
            pool,
            guest_id,
            room_type,
            stay,
            None,
            &ComplimentaryContext::default(),
            None,
        )
        .await?;
        offers.push(GuestBookingOffer {
            room_type_id: quote.room_type_id,
            room_type_code: quote.room_type_code,
            room_type_name: quote.room_type_name,
            description,
            max_occupancy,
            bed_type,
            bed_count,
            images,
            features,
            available_rooms,
            currency: quote.currency,
            nightly_rates: quote.nightly_rates,
            subtotal: quote.subtotal,
            discount_amount: quote.discount_amount,
            tax_amount: quote.tax_amount,
            total_amount: quote.total_amount,
        });
    }
    Ok(offers)
}

/// Price one selected room type. `guest_id` is `None` for an anonymous booker.
pub async fn quote(
    pool: &DbPool,
    guest_id: Option<i64>,
    request: BookingQuoteRequest,
) -> Result<GuestBookingQuote, ApiError> {
    let stay = validate_stay(
        pool,
        &request.check_in_date,
        &request.check_out_date,
        request.adults,
        request.children,
    )
    .await?;
    let room_type = Repository::find_inventory(
        pool,
        request.room_type_id,
        stay.check_in_date,
        stay.check_out_date,
        stay.adults + stay.children,
    )
    .await?;
    let room_type = apply_online_allocation(pool, room_type, stay).await?;
    if room_type.available_rooms == 0 {
        return Err(ApiError::Conflict(
            "This room type is reserved for walk-in guests or unavailable online".to_string(),
        ));
    }
    let complimentary = complimentary_context(
        pool,
        guest_id,
        room_type.id,
        stay,
        request.complimentary_dates.as_deref(),
    )
    .await?;
    let tourism_type =
        resolve_quote_tourism_type(pool, guest_id, request.tourism_type.as_deref()).await?;
    quote_for_inventory(
        pool,
        guest_id,
        room_type,
        stay,
        request.voucher_id,
        &complimentary,
        tourism_type.as_deref(),
    )
    .await
}

async fn resolve_quote_tourism_type(
    pool: &DbPool,
    guest_id: Option<i64>,
    requested: Option<&str>,
) -> Result<Option<String>, ApiError> {
    if let Some(requested) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(Some(requested.to_string()));
    }
    let Some(guest_id) = guest_id else {
        return Ok(None);
    };
    Repository::guest_tourism_type(pool, guest_id).await
}

pub async fn quote_with_eligible_vouchers(
    pool: &DbPool,
    guest_id: i64,
    request: BookingQuoteRequest,
) -> Result<GuestBookingVoucherOptions, ApiError> {
    let quote = quote(
        pool,
        Some(guest_id),
        BookingQuoteRequest {
            voucher_id: None,
            ..request
        },
    )
    .await?;
    let eligible_voucher_ids = Repository::eligible_voucher_ids(
        pool,
        VoucherEligibilityQuery {
            guest_id,
            room_type_id: quote.room_type_id,
            check_in: quote.check_in_date,
            check_out: quote.check_out_date,
            nights: (quote.check_out_date - quote.check_in_date).num_days(),
            subtotal: quote.subtotal,
            currency: &quote.currency,
        },
    )
    .await?;
    Ok(GuestBookingVoucherOptions {
        quote,
        eligible_voucher_ids,
    })
}

pub async fn list_online_inventory(
    pool: &DbPool,
    query: OnlineInventoryQuery,
) -> Result<Vec<OnlineInventoryAllocation>, ApiError> {
    let stay_date = NaiveDate::parse_from_str(query.stay_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid stay date. Use YYYY-MM-DD".to_string()))?;
    Repository::list_online_inventory(pool, stay_date).await
}

pub async fn update_online_inventory(
    pool: &DbPool,
    room_type_id: i64,
    stay_date: &str,
    request: UpdateOnlineInventoryRequest,
    actor_id: i64,
) -> Result<OnlineInventoryAllocation, ApiError> {
    if request.walk_in_reserved_rooms < 0 {
        return Err(ApiError::BadRequest(
            "Walk-in reserve cannot be negative".to_string(),
        ));
    }
    if let Some(custom_price) = request.custom_price {
        if custom_price <= Decimal::ZERO {
            return Err(ApiError::BadRequest(
                "Custom online price must be greater than zero".to_string(),
            ));
        }
        if custom_price.scale() > 2 {
            return Err(ApiError::BadRequest(
                "Custom online price can have at most two decimal places".to_string(),
            ));
        }
    }
    let stay_date = NaiveDate::parse_from_str(stay_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid stay date. Use YYYY-MM-DD".to_string()))?;
    Repository::upsert_online_inventory(
        pool,
        room_type_id,
        stay_date,
        request.walk_in_reserved_rooms,
        request.online_booking_enabled,
        request.custom_price,
        actor_id,
    )
    .await?;
    Repository::list_online_inventory(pool, stay_date)
        .await?
        .into_iter()
        .find(|allocation| allocation.room_type_id == room_type_id)
        .ok_or_else(|| ApiError::NotFound("Room type not found".to_string()))
}

/// Maps an incomplete profile-completion verdict into the 422 the booking
/// guard returns, carrying the missing field names for the client.
fn profile_incomplete_error(completion: ProfileCompletion) -> ApiError {
    ApiError::ProfileIncomplete(
        completion
            .missing_fields
            .into_iter()
            .map(str::to_string)
            .collect(),
    )
}

pub async fn create(
    pool: &DbPool,
    hub: &AvailabilityHub,
    guest_id: i64,
    request: CreateGuestBookingRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestBookingConfirmation, ApiError> {
    let request_id = validate_client_request_id(&request.client_request_id)?;
    consent_validation::validate_locales(&request.consents)?;
    consent_validation::require_consents(&request.consents, consent_validation::BOOKING_REQUIRED)?;
    if let Some(existing) = Repository::find_by_request_id(pool, guest_id, &request_id).await? {
        return Ok(existing);
    }

    let completion = completion_for_guest(pool, guest_id).await?;
    if !completion.complete {
        return Err(profile_incomplete_error(completion));
    }

    let quote = quote(
        pool,
        Some(guest_id),
        BookingQuoteRequest {
            room_type_id: request.room_type_id,
            check_in_date: request.check_in_date.clone(),
            check_out_date: request.check_out_date.clone(),
            adults: request.adults,
            children: request.children,
            voucher_id: request.voucher_id,
            complimentary_dates: request.complimentary_dates.clone(),
            tourism_type: None,
        },
    )
    .await?;
    if quote.total_amount != request.expected_total.round_dp(2) {
        return Err(ApiError::Conflict(
            "The booking price changed. Please review the refreshed total.".to_string(),
        ));
    }

    let contact = Repository::guest_contact(pool, guest_id).await?;
    let booking_channel_id = Repository::direct_booking_channel(pool).await?;
    let voucher_to_redeem = if let Some(voucher_id) = quote.voucher_id {
        Some(
            Repository::eligible_voucher(
                pool,
                voucher_id,
                VoucherEligibilityQuery {
                    guest_id,
                    room_type_id: request.room_type_id,
                    check_in: quote.check_in_date,
                    check_out: quote.check_out_date,
                    nights: (quote.check_out_date - quote.check_in_date).num_days(),
                    subtotal: quote.subtotal,
                    currency: &quote.currency,
                },
            )
            .await?,
        )
    } else {
        None
    };
    let special_requests = request
        .special_requests
        .as_deref()
        .map(Sanitizer::sanitize_notes)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let first_rate = quote
        .nightly_rates
        .first()
        .map(|rate| rate.amount)
        .ok_or_else(|| ApiError::BadRequest("A booking requires at least one night".to_string()))?;
    let daily_rates = json!(
        quote
            .nightly_rates
            .iter()
            .map(|rate| (rate.date.to_string(), rate.amount))
            .collect::<std::collections::BTreeMap<_, _>>()
    );
    let booking_number =
        crate::services::booking::generate_booking_number_for_date(quote.check_in_date);
    let stay_nights = (quote.check_out_date - quote.check_in_date).num_days();
    let complimentary_reason = (quote.complimentary_nights > 0).then(|| {
        let dates = quote
            .complimentary_dates
            .iter()
            .map(|date| date.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Guest portal: {} of {} night(s) funded by complimentary credits for {} (dates: {})",
            quote.complimentary_nights, stay_nights, quote.room_type_name, dates
        )
    });
    let settled_by_credits = quote.complimentary_nights > 0 && quote.total_amount <= Decimal::ZERO;
    let booking_status = if settled_by_credits {
        "confirmed"
    } else {
        "pending_payment"
    };

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    Repository::ensure_online_room_available_tx(
        &mut tx,
        request.room_type_id,
        quote.check_in_date,
        quote.check_out_date,
    )
    .await?;
    let room_id = Repository::allocate_room_tx(
        &mut tx,
        request.room_type_id,
        quote.check_in_date,
        quote.check_out_date,
    )
    .await?;
    let insert = BookingInsert {
        portal_request_id: request_id.clone(),
        guest_id,
        actor_user_id: contact.actor_user_id,
        room_id,
        booking_number: booking_number.clone(),
        check_in_date: quote.check_in_date,
        check_out_date: quote.check_out_date,
        adults: quote.adults,
        children: quote.children,
        room_rate: first_rate,
        subtotal: quote.subtotal,
        discount_amount: quote.discount_amount,
        total_amount: quote.total_amount - quote.tax_amount,
        currency: quote.currency.clone(),
        special_requests,
        cleaning_preference: request.cleaning_preference,
        booking_channel_id,
        nightly_rates: daily_rates,
        complimentary_reason,
        settled_by_credits,
        is_tourist: quote.tax_amount > Decimal::ZERO,
        tourism_tax_amount: quote.tax_amount,
    };
    let booking_id = match Repository::insert_booking_tx(&mut tx, &insert).await {
        Ok(booking_id) => booking_id,
        Err(error) => {
            let _ = tx.rollback().await;
            if let Some(existing) =
                Repository::find_by_request_id(pool, guest_id, &request_id).await?
            {
                return Ok(existing);
            }
            return Err(error);
        }
    };

    if quote.complimentary_nights > 0 {
        Repository::redeem_complimentary_credits_tx(
            &mut tx,
            guest_id,
            request.room_type_id,
            quote.complimentary_nights,
        )
        .await?;
    }

    if let Some(voucher) = voucher_to_redeem.as_ref() {
        Repository::redeem_voucher_tx(
            &mut tx,
            VoucherRedemptionValues {
                voucher,
                booking_id,
                guest_id,
                actor_user_id: contact.actor_user_id,
                subtotal: quote.subtotal,
                discount_amount: quote.discount_amount,
                total_amount: quote.total_amount,
            },
        )
        .await?;
    }

    Repository::mark_room_reserved_tx(&mut tx, room_id, &booking_number).await?;
    crate::repositories::bookings::record_booking_history_tx(
        &mut tx,
        booking_id,
        None,
        booking_status,
        contact.actor_user_id,
        Some(if settled_by_credits {
            "Booking created in guest portal (settled with complimentary credits)"
        } else {
            "Booking created in guest portal (pending payment)"
        }),
        json!({
            "source": PORTAL_SOURCE,
            "guest_id": guest_id,
            "room_type_id": request.room_type_id,
            "portal_request_id": request_id,
            "complimentary_nights": quote.complimentary_nights,
        }),
    )
    .await?;
    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: contact.actor_user_id,
            action: "guest_portal.booking_created",
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(json!({
                "booking_number": booking_number,
                "room_type_id": request.room_type_id,
                "check_in_date": quote.check_in_date,
                "check_out_date": quote.check_out_date,
                "total_amount": quote.total_amount.to_string(),
                "currency": quote.currency,
                "complimentary_nights": quote.complimentary_nights,
                "complimentary_discount": quote.complimentary_discount.to_string(),
            })),
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;
    consent_service::record_tx(
        &mut tx,
        ConsentSubject::guest(guest_id).with_booking(booking_id),
        &request.consents,
        ConsentSource::OnlineBooking,
        &ConsentContext {
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;

    if let Some(email) = contact
        .email
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let (subject, body_html, body_text) = portal_booking_mail(PortalBookingMail {
            guest_name: &contact.full_name,
            booking_number: &booking_number,
            room_type_name: &quote.room_type_name,
            check_in: quote.check_in_date,
            check_out: quote.check_out_date,
            currency: &quote.currency,
            total: quote.total_amount,
            settled_by_credits,
            anonymous: false,
            access_token: None,
        });
        CommunicationsRepository::insert_delivery_tx(
            &mut tx,
            DeliveryValues {
                campaign_id: None,
                kind: "booking_confirmation",
                guest_id,
                topic: "booking_confirmation",
                recipient_email: email,
                subject: &subject,
                body_html: &body_html,
                body_text: Some(&body_text),
                voucher_id: None,
                idempotency_key: &format!("booking-confirmation:{booking_id}"),
            },
        )
        .await?;
    }

    tx.commit().await.map_err(ApiError::from)?;
    let confirmation = Repository::confirmation_by_id(pool, booking_id).await?;
    let remaining_rooms = Repository::available_count(
        pool,
        request.room_type_id,
        quote.check_in_date,
        quote.check_out_date,
    )
    .await?;
    hub.publish(AvailabilityEvent {
        event_id: Uuid::new_v4().to_string(),
        event_type: "availability_changed",
        reason: "booking_created",
        room_type_id: Some(request.room_type_id),
        check_in_date: Some(quote.check_in_date),
        check_out_date: Some(quote.check_out_date),
        remaining_rooms: Some(remaining_rooms),
    });
    Ok(confirmation)
}

/// Create a booking for someone with no account.
///
/// Anonymous bookings are quoted at list price. Vouchers, complimentary-night
/// credits and loyalty all belong to an account, so `quote` is called with no
/// guest and the request body carries no way to ask for them.
///
/// A fresh guest profile is always created rather than matched to an existing
/// one by email. Matching would let anyone book using somebody else's address
/// and then read — and through pre-check-in, rewrite — that person's stored
/// profile with the access token this returns.
pub async fn create_anonymous(
    pool: &DbPool,
    hub: &AvailabilityHub,
    request: AnonymousBookingRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestBookingConfirmation, ApiError> {
    let request_id = validate_client_request_id(&request.client_request_id)?;
    let guest = validate_anonymous_guest(&request.guest)?;

    // Checked before the idempotent-replay branch below, so a replayed request
    // that has dropped its consent cannot reissue an access token either.
    consent_validation::validate_locales(&request.consents)?;
    consent_validation::require_consents(&request.consents, consent_validation::BOOKING_REQUIRED)?;

    // Idempotent retry: same client request id, same email. The stored
    // access token is hashed, so the original plaintext cannot be recovered
    // — mint a replacement so a lost first response can still pay.
    if let Some(mut existing) =
        Repository::find_anonymous_by_request_id(pool, &request_id, &guest.email).await?
    {
        let access_token = crate::services::guest_portal::generate_session_token();
        let access_token_expires_at = replay_anonymous_access_token_expiry(
            chrono::Utc::now(),
            existing.check_in_date,
            existing.access_token_expires_at,
        );
        crate::repositories::guest_portal::GuestPortalRepository::update_precheckin_token(
            pool,
            existing.booking_id,
            &access_token,
            access_token_expires_at,
        )
        .await?;
        existing.access_token = Some(access_token);
        existing.access_token_expires_at = Some(access_token_expires_at);
        return Ok(existing);
    }

    let quote = quote(
        pool,
        None,
        BookingQuoteRequest {
            room_type_id: request.room_type_id,
            check_in_date: request.check_in_date.clone(),
            check_out_date: request.check_out_date.clone(),
            adults: request.adults,
            children: request.children,
            voucher_id: None,
            complimentary_dates: None,
            tourism_type: Some(guest.tourism_type.clone()),
        },
    )
    .await?;
    if quote.total_amount != request.expected_total.round_dp(2) {
        return Err(ApiError::Conflict(
            "The booking price changed. Please review the refreshed total.".to_string(),
        ));
    }

    let booking_channel_id = Repository::direct_booking_channel(pool).await?;
    let special_requests = request
        .special_requests
        .as_deref()
        .map(Sanitizer::sanitize_notes)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let first_rate = quote
        .nightly_rates
        .first()
        .map(|rate| rate.amount)
        .ok_or_else(|| ApiError::BadRequest("A booking requires at least one night".to_string()))?;
    let daily_rates = json!(
        quote
            .nightly_rates
            .iter()
            .map(|rate| (rate.date.to_string(), rate.amount))
            .collect::<std::collections::BTreeMap<_, _>>()
    );
    let booking_number =
        crate::services::booking::generate_booking_number_for_date(quote.check_in_date);
    let access_token = crate::services::guest_portal::generate_session_token();
    let access_token_expires_at =
        anonymous_access_token_expiry(chrono::Utc::now(), quote.check_in_date);

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    Repository::ensure_online_room_available_tx(
        &mut tx,
        request.room_type_id,
        quote.check_in_date,
        quote.check_out_date,
    )
    .await?;
    let room_id = Repository::allocate_room_tx(
        &mut tx,
        request.room_type_id,
        quote.check_in_date,
        quote.check_out_date,
    )
    .await?;
    let language_preference = consent_validation::preferred_locale(&request.consents);
    let guest_id =
        Repository::insert_anonymous_guest_tx(&mut tx, &guest, &language_preference).await?;
    let insert = BookingInsert {
        portal_request_id: request_id.clone(),
        guest_id,
        // Nobody on staff created this row, and the booker holds no user
        // account, so every actor column stays NULL.
        actor_user_id: None,
        room_id,
        booking_number: booking_number.clone(),
        check_in_date: quote.check_in_date,
        check_out_date: quote.check_out_date,
        adults: quote.adults,
        children: quote.children,
        room_rate: first_rate,
        subtotal: quote.subtotal,
        discount_amount: quote.discount_amount,
        total_amount: quote.total_amount - quote.tax_amount,
        currency: quote.currency.clone(),
        special_requests,
        cleaning_preference: request.cleaning_preference,
        booking_channel_id,
        nightly_rates: daily_rates,
        // No credits, so never a complimentary reason and never settled by them.
        complimentary_reason: None,
        settled_by_credits: false,
        is_tourist: is_foreign_tourist(&guest.tourism_type),
        tourism_tax_amount: quote.tax_amount,
    };
    let booking_id = Repository::insert_booking_tx(&mut tx, &insert).await?;
    Repository::issue_access_token_tx(&mut tx, booking_id, &access_token, access_token_expires_at)
        .await?;
    Repository::mark_room_reserved_tx(&mut tx, room_id, &booking_number).await?;
    crate::repositories::bookings::record_booking_history_tx(
        &mut tx,
        booking_id,
        None,
        "pending_payment",
        None,
        Some("Booking created on the website without an account (pending payment)"),
        json!({
            "source": PORTAL_SOURCE,
            "guest_id": guest_id,
            "room_type_id": request.room_type_id,
            "portal_request_id": request_id,
            "anonymous": true,
        }),
    )
    .await?;
    // Consent joins this transaction: the guest row, the booking and the consent
    // that authorised them commit together or not at all.
    consent_service::record_tx(
        &mut tx,
        ConsentSubject::anonymous_booking(guest_id, booking_id),
        &request.consents,
        ConsentSource::OnlineBooking,
        &ConsentContext {
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;

    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: None,
            action: "guest_portal.anonymous_booking_created",
            resource_type: "booking",
            resource_id: Some(booking_id),
            details: Some(json!({
                "booking_number": booking_number,
                "room_type_id": request.room_type_id,
                "check_in_date": quote.check_in_date,
                "check_out_date": quote.check_out_date,
                "total_amount": quote.total_amount.to_string(),
                "currency": quote.currency,
                "guest_id": guest_id,
            })),
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;

    // The booking number and email are the only way back to this booking once
    // the access token lapses, so the confirmation must always carry both.
    let (subject, body_html, body_text) = portal_booking_mail(PortalBookingMail {
        guest_name: &guest.nick_name,
        booking_number: &booking_number,
        room_type_name: &quote.room_type_name,
        check_in: quote.check_in_date,
        check_out: quote.check_out_date,
        currency: &quote.currency,
        total: quote.total_amount,
        settled_by_credits: false,
        anonymous: true,
        access_token: Some(&access_token),
    });
    CommunicationsRepository::insert_delivery_tx(
        &mut tx,
        DeliveryValues {
            campaign_id: None,
            kind: "booking_confirmation",
            guest_id,
            topic: "booking_confirmation",
            recipient_email: &guest.email,
            subject: &subject,
            body_html: &body_html,
            body_text: Some(&body_text),
            voucher_id: None,
            idempotency_key: &format!("booking-confirmation:{booking_id}"),
        },
    )
    .await?;

    tx.commit().await.map_err(ApiError::from)?;

    // Outside the booking transaction on purpose: failing to store a mailing
    // preference must not roll back a booking the guest is about to pay for.
    // The binding consent is already committed above in `consent_records`.
    if let Err(error) = communications_service::record_signup_marketing_consent(
        pool,
        guest_id,
        request.marketing_opt_in,
        "online_booking",
        Some(ConsentDocument::PrivacyNotice.current_version()),
        ip_address.clone(),
        user_agent.clone(),
    )
    .await
    {
        log::warn!("Failed to record marketing preference for guest {guest_id}: {error}");
    }

    let mut confirmation = Repository::confirmation_by_id(pool, booking_id).await?;
    confirmation.access_token = Some(access_token);
    confirmation.access_token_expires_at = Some(access_token_expires_at);

    let remaining_rooms = Repository::available_count(
        pool,
        request.room_type_id,
        quote.check_in_date,
        quote.check_out_date,
    )
    .await?;
    hub.publish(AvailabilityEvent {
        event_id: Uuid::new_v4().to_string(),
        event_type: "availability_changed",
        reason: "booking_created",
        room_type_id: Some(request.room_type_id),
        check_in_date: Some(quote.check_in_date),
        check_out_date: Some(quote.check_out_date),
        remaining_rooms: Some(remaining_rooms),
    });
    Ok(confirmation)
}

fn money_label(currency: &str, amount: Decimal) -> String {
    let currency = currency.trim();
    if currency.is_empty() {
        format!("{amount:.2}")
    } else {
        format!("{currency} {amount:.2}")
    }
}

struct PortalBookingMail<'a> {
    guest_name: &'a str,
    booking_number: &'a str,
    room_type_name: &'a str,
    check_in: NaiveDate,
    check_out: NaiveDate,
    currency: &'a str,
    total: Decimal,
    settled_by_credits: bool,
    anonymous: bool,
    /// Booking access token for anonymous pending-payment deep links.
    /// Logged-in portal bookings leave this `None`.
    access_token: Option<&'a str>,
}

fn portal_booking_mail(mail: PortalBookingMail<'_>) -> (String, String, String) {
    let PortalBookingMail {
        guest_name,
        booking_number,
        room_type_name,
        check_in,
        check_out,
        currency,
        total,
        settled_by_credits,
        anonymous,
        access_token,
    } = mail;
    let hotel = email_layout::hotel_display_name();
    let stay_in = check_in.format("%d %b %Y").to_string();
    let stay_out = check_out.format("%d %b %Y").to_string();
    let total_label = money_label(currency, total);
    let details = email_layout::details_table(&[
        ("Booking", booking_number),
        ("Room", room_type_name),
        ("Check-in", &stay_in),
        ("Check-out", &stay_out),
        ("Total", &total_label),
    ]);
    let view_url = email_layout::absolute_url("/portal");
    // Prefer a token deep-link into the pre-arrival payment form. The frontend
    // captures `?token=` into sessionStorage and strips it from the URL.
    // Fall back to the booking-number lookup page only when no token exists.
    let pay_url = match access_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(token) => email_layout::absolute_url(&format!("/guest-checkin/form?token={}", token)),
        None => email_layout::absolute_url("/guest-checkin"),
    };

    let (subject, heading, preheader, intro_html, closing_html, intro_text, closing_text, cta) =
        if settled_by_credits {
            (
                format!("{hotel} reservation confirmed {booking_number}"),
                "Reservation confirmed",
                format!("Your {hotel} reservation {booking_number} is confirmed."),
                format!(
                    "<p>Dear {},</p><p>Your reservation <strong>{}</strong> is confirmed and fully covered by complimentary nights.</p>",
                    html_escape(guest_name),
                    html_escape(booking_number),
                ),
                "<p>There is nothing left to pay. You can view this booking any time in your guest portal.</p>\
                 <p>If this message is not in your Primary inbox, check Spam and Promotions and mark it as not spam so the next one arrives.</p>"
                    .to_string(),
                format!(
                    "Dear {guest_name},\nYour reservation {booking_number} is confirmed and fully covered by complimentary nights."
                ),
                "There is nothing left to pay. You can view this booking any time in your guest portal.\nIf this message is not in your Primary inbox, check Spam and Promotions and mark it as not spam so the next one arrives."
                    .to_string(),
                Cta {
                    label: "View your booking",
                    url: &view_url,
                },
            )
        } else {
            let spam_html = "<p>If this message is not in your Primary inbox, check Spam and Promotions and mark it as not spam so the next one arrives.</p>";
            let spam_text = "If this message is not in your Primary inbox, check Spam and Promotions and mark it as not spam so the next one arrives.";
            let closing_html = if anonymous {
                format!(
                    "<p>Please complete payment to confirm this stay.</p>\
                     <p>To view it later, use booking number <strong>{}</strong> with this email address.</p>\
                     {spam_html}",
                    html_escape(booking_number),
                )
            } else {
                format!(
                    "<p>Please complete payment to confirm this stay. You can pay online from your guest portal or complete a bank transfer.</p>\
                     {spam_html}"
                )
            };
            let closing_text = if anonymous {
                format!(
                    "Please complete payment to confirm this stay.\nTo view it later, use booking number {booking_number} with this email address.\n{spam_text}"
                )
            } else {
                format!(
                    "Please complete payment to confirm this stay. You can pay online from your guest portal or complete a bank transfer.\n{spam_text}"
                )
            };
            let cta_url = if anonymous { &pay_url } else { &view_url };
            (
                format!("{hotel} reservation {booking_number}"),
                "Reservation received",
                format!("Your {hotel} reservation {booking_number} is pending payment."),
                format!(
                    "<p>Dear {},</p><p>Your reservation <strong>{}</strong> has been received and is pending payment.</p>",
                    html_escape(guest_name),
                    html_escape(booking_number),
                ),
                closing_html,
                format!(
                    "Dear {guest_name},\nYour reservation {booking_number} has been received and is pending payment."
                ),
                closing_text,
                Cta {
                    label: "Complete payment",
                    url: cta_url,
                },
            )
        };

    let inner_html = format!("{intro_html}{details}{closing_html}");
    let inner_text = format!(
        "{intro_text}\n\nBooking: {booking_number}\nRoom: {room_type_name}\nCheck-in: {stay_in}\nCheck-out: {stay_out}\nTotal: {total_label}\n\n{closing_text}"
    );
    let rendered = email_layout::render(GuestEmail {
        preheader: &preheader,
        heading,
        inner_html: &inner_html,
        inner_text: &inner_text,
        cta: Some(cta),
    });
    (subject, rendered.html, rendered.text)
}

#[cfg(test)]
mod tourism_tax_tests {
    use super::*;

    #[test]
    fn local_and_blank_tourism_types_are_not_charged() {
        assert_eq!(
            tourism_tax_for_type("local", 3, Decimal::from(10)),
            Decimal::ZERO
        );
        assert_eq!(
            tourism_tax_for_type("", 3, Decimal::from(10)),
            Decimal::ZERO
        );
        assert_eq!(
            tourism_tax_for_type("LOCAL", 1, Decimal::from(10)),
            Decimal::ZERO
        );
    }

    #[test]
    fn foreign_guests_pay_the_nightly_rate_times_nights() {
        assert_eq!(
            tourism_tax_for_type("foreign", 2, Decimal::from(10)),
            Decimal::from(20)
        );
        assert_eq!(
            tourism_tax_for_type("Foreign", 1, Decimal::from(10)),
            Decimal::from(10)
        );
    }

    #[test]
    fn a_zero_night_stay_still_bills_one_night_of_tourism_tax() {
        assert_eq!(
            tourism_tax_for_type("foreign", 0, Decimal::from(10)),
            Decimal::from(10)
        );
    }

    #[test]
    fn guest_facing_total_adds_tourism_tax_on_top_of_the_room_total() {
        let room = Decimal::from(250);
        let tax = tourism_tax_for_type("foreign", 2, Decimal::from(10));
        assert_eq!(room + tax, Decimal::from(270));
        assert_eq!(
            room + tourism_tax_for_type("local", 2, Decimal::from(10)),
            room
        );
    }
}

#[cfg(test)]
mod anonymous_access_token_expiry_tests {
    use super::*;

    fn at(date: &str) -> chrono::DateTime<chrono::Utc> {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap()
            .and_utc()
    }

    fn day(date: &str) -> NaiveDate {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn near_stay_keeps_the_flat_minimum() {
        // Arrival is soon, so 14 days already outlasts the verify window.
        let expiry = anonymous_access_token_expiry(at("2026-09-05"), day("2026-09-10"));
        assert_eq!(expiry, at("2026-09-05") + Duration::days(14));
    }

    #[test]
    fn distant_stay_holds_until_verify_can_reissue() {
        // Booked three months out: the token must survive until verify opens,
        // or the guest has no way to pay in between.
        let expiry = anonymous_access_token_expiry(at("2026-09-05"), day("2026-12-01"));
        assert_eq!(
            expiry,
            day("2026-11-24").and_hms_opt(0, 0, 0).unwrap().and_utc()
        );
    }

    #[test]
    fn the_two_windows_never_leave_a_gap() {
        let now = at("2026-09-05");
        for offset in [0_i64, 1, 7, 13, 14, 15, 30, 90] {
            let check_in = day("2026-09-05") + Duration::days(offset);
            let expiry = anonymous_access_token_expiry(now, check_in);
            let verify_opens = check_in.and_hms_opt(0, 0, 0).unwrap().and_utc()
                - Duration::days(VERIFY_REISSUE_WINDOW_DAYS);
            assert!(
                expiry >= verify_opens
                    || expiry >= check_in.and_hms_opt(0, 0, 0).unwrap().and_utc(),
                "gap for check-in in {offset} days: token dies {expiry}, verify opens {verify_opens}"
            );
        }
    }

    #[test]
    fn idempotent_retry_keeps_an_unexpired_deadline() {
        let now = at("2026-09-05");
        let stored = now + Duration::days(20);
        assert_eq!(
            replay_anonymous_access_token_expiry(now, day("2026-12-01"), Some(stored)),
            stored
        );
    }

    #[test]
    fn idempotent_retry_recomputes_when_the_stored_deadline_is_gone_or_past() {
        let now = at("2026-09-05");
        let check_in = day("2026-12-01");
        let expected = anonymous_access_token_expiry(now, check_in);
        assert_eq!(
            replay_anonymous_access_token_expiry(now, check_in, None),
            expected
        );
        assert_eq!(
            replay_anonymous_access_token_expiry(now, check_in, Some(now - Duration::seconds(1))),
            expected
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentage_voucher_is_capped() {
        let voucher = VoucherPricing {
            voucher_id: 1,
            promotion_id: 2,
            promotion_name: "Deal".to_string(),
            discount_type: "percentage".to_string(),
            discount_value: Decimal::from(25),
            max_discount_amount: Some(Decimal::from(10)),
        };
        assert_eq!(
            voucher_discount(Decimal::from(100), &voucher),
            Decimal::from(10)
        );
    }

    #[test]
    fn fixed_voucher_cannot_make_total_negative() {
        let voucher = VoucherPricing {
            voucher_id: 1,
            promotion_id: 2,
            promotion_name: "Deal".to_string(),
            discount_type: "fixed_amount".to_string(),
            discount_value: Decimal::from(250),
            max_discount_amount: None,
        };
        assert_eq!(
            voucher_discount(Decimal::from(100), &voucher),
            Decimal::from(100)
        );
    }

    fn date(day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, day).expect("valid test date")
    }

    fn rate(day: u32, amount: i64) -> NightlyRate {
        NightlyRate {
            date: date(day),
            rate_plan_code: "BASE".to_string(),
            amount: Decimal::from(amount),
        }
    }

    #[test]
    fn complimentary_discount_uses_the_rate_of_each_comped_night() {
        // A weekend night costs more than a weekday night, so comping night 2
        // must credit 300 — not the 200 average of the three nights.
        let rates = vec![rate(10, 100), rate(11, 300), rate(12, 200)];
        assert_eq!(
            complimentary_discount(&rates, &[date(11)]),
            Decimal::from(300)
        );
    }

    #[test]
    fn complimentary_discount_ignores_dates_outside_the_quoted_nights() {
        let rates = vec![rate(10, 100), rate(11, 300)];
        assert_eq!(complimentary_discount(&rates, &[date(20)]), Decimal::ZERO);
    }

    #[test]
    fn credits_covering_every_night_leave_nothing_to_pay() {
        let rates = vec![rate(10, 100), rate(11, 300)];
        let comped = complimentary_discount(&rates, &[date(10), date(11)]);
        let (discount, total) = settlement(Decimal::from(400), comped, None);
        assert_eq!(discount, Decimal::from(400));
        assert_eq!(total, Decimal::ZERO);
    }

    #[test]
    fn percentage_voucher_discounts_only_what_credits_left_payable() {
        // 400 stay, one 300 night comped -> 100 payable, 25% off that is 25.
        let voucher = VoucherPricing {
            voucher_id: 1,
            promotion_id: 2,
            promotion_name: "Deal".to_string(),
            discount_type: "percentage".to_string(),
            discount_value: Decimal::from(25),
            max_discount_amount: None,
        };
        let (discount, total) = settlement(Decimal::from(400), Decimal::from(300), Some(&voucher));
        assert_eq!(discount, Decimal::from(325));
        assert_eq!(total, Decimal::from(75));
    }

    #[test]
    fn credits_and_voucher_together_never_produce_a_negative_total() {
        let voucher = VoucherPricing {
            voucher_id: 1,
            promotion_id: 2,
            promotion_name: "Deal".to_string(),
            discount_type: "fixed_amount".to_string(),
            discount_value: Decimal::from(500),
            max_discount_amount: None,
        };
        let (discount, total) = settlement(Decimal::from(400), Decimal::from(300), Some(&voucher));
        assert_eq!(discount, Decimal::from(400));
        assert_eq!(total, Decimal::ZERO);
    }

    #[test]
    fn a_stay_with_no_credits_prices_exactly_as_before() {
        let voucher = VoucherPricing {
            voucher_id: 1,
            promotion_id: 2,
            promotion_name: "Deal".to_string(),
            discount_type: "percentage".to_string(),
            discount_value: Decimal::from(10),
            max_discount_amount: None,
        };
        let (discount, total) = settlement(Decimal::from(400), Decimal::ZERO, Some(&voucher));
        assert_eq!(discount, Decimal::from(40));
        assert_eq!(total, Decimal::from(360));
    }

    #[test]
    fn incomplete_profile_renders_as_422_with_missing_fields() {
        // ApiError has no status_code() helper — assert on the real rendered
        // response so this test tracks IntoResponse rather than a fabricated API.
        use axum::response::IntoResponse;

        let completion = ProfileCompletion {
            complete: false,
            missing_fields: vec!["phone"],
        };
        let error = profile_incomplete_error(completion);

        match &error {
            ApiError::ProfileIncomplete(fields) => {
                assert_eq!(fields, &vec!["phone".to_string()]);
            }
            other => panic!("expected ApiError::ProfileIncomplete, got {other:?}"),
        }

        let response = error.into_response();
        assert_eq!(
            response.status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn anonymous_pending_mail_is_branded_and_tells_the_guest_how_to_pay() {
        unsafe {
            std::env::set_var("PUBLIC_BASE_URL", "https://saliminn.my");
            std::env::set_var("SMTP_FROM_NAME", "Salim Inn");
        }
        let (subject, html, text) = portal_booking_mail(PortalBookingMail {
            guest_name: "Paul <Wong>",
            booking_number: "BK-20260908-6eed1312",
            room_type_name: "Deluxe King",
            check_in: NaiveDate::from_ymd_opt(2026, 9, 8).unwrap(),
            check_out: NaiveDate::from_ymd_opt(2026, 9, 9).unwrap(),
            currency: "MYR",
            total: Decimal::ZERO,
            settled_by_credits: false,
            anonymous: true,
            access_token: Some("deadbeefcafebabe"),
        });
        assert!(subject.contains("Salim Inn"));
        assert!(subject.contains("BK-20260908-6eed1312"));
        assert!(html.contains("Salim Inn"));
        assert!(html.contains("<table"));
        assert!(html.contains("Deluxe King"));
        assert!(html.contains("08 Sep 2026"));
        assert!(html.contains("MYR 0.00"));
        assert!(html.contains("Complete payment"));
        assert!(html.contains("https://saliminn.my/guest-checkin/form?token=deadbeefcafebabe"));
        assert!(!html.contains("https://saliminn.my/guest-checkin\""));
        assert!(html.contains("Paul &lt;Wong&gt;"));
        assert!(!html.contains("Paul <Wong>"));
        assert!(text.contains("Salim Inn"));
        assert!(text.contains("Complete payment"));
        assert!(!text.contains("<table"));
        assert!(
            html.contains(
                "If this message is not in your Primary inbox, check Spam and Promotions"
            )
        );
        assert!(
            text.contains(
                "If this message is not in your Primary inbox, check Spam and Promotions"
            )
        );
    }

    #[test]
    fn credit_settled_mail_is_a_confirmation_not_a_payment_nudge() {
        unsafe {
            std::env::set_var("PUBLIC_BASE_URL", "https://saliminn.my");
        }
        let (subject, html, _) = portal_booking_mail(PortalBookingMail {
            guest_name: "Guest",
            booking_number: "BK-1",
            room_type_name: "Deluxe King",
            check_in: NaiveDate::from_ymd_opt(2026, 9, 8).unwrap(),
            check_out: NaiveDate::from_ymd_opt(2026, 9, 9).unwrap(),
            currency: "MYR",
            total: Decimal::ZERO,
            settled_by_credits: true,
            anonymous: false,
            access_token: None,
        });
        assert!(subject.contains("confirmed"));
        assert!(html.contains("View your booking"));
        assert!(html.contains("https://saliminn.my/portal"));
        assert!(!html.contains("pending payment"));
    }
}
