use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;
use serde_json::json;
use uuid::Uuid;

use super::availability::{AvailabilityEvent, AvailabilityHub};
use super::models::{
    BookingInsert, BookingQuoteRequest, BookingSearchQuery, CreateGuestBookingRequest,
    GuestBookingConfirmation, GuestBookingOffer, GuestBookingQuote, NightlyRate,
    OnlineInventoryAllocation, OnlineInventoryQuery, RoomTypeInventory,
    UpdateOnlineInventoryRequest, VoucherPricing,
};
use super::repository::GuestBookingRepository as Repository;
use super::validation::{ValidatedStay, validate_client_request_id, validate_stay};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::communications::repository::CommunicationsRepository;
use crate::modules::communications::validation::html_escape;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;

const PORTAL_SOURCE: &str = "website";

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
    let mut rates = Vec::new();
    let mut date = stay.check_in_date;
    while date < stay.check_out_date {
        let (rate_plan_code, amount) =
            if let Some(rate) = Repository::applicable_rate(pool, room_type.id, date).await? {
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
    guest_id: i64,
    room_type_id: i64,
    stay: ValidatedStay,
    subtotal: Decimal,
    currency: &str,
    voucher_id: Option<i64>,
) -> Result<Option<VoucherPricing>, ApiError> {
    let Some(voucher_id) = voucher_id else {
        return Ok(None);
    };
    Repository::eligible_voucher(
        pool,
        voucher_id,
        guest_id,
        room_type_id,
        stay.check_in_date,
        stay.check_out_date,
        (stay.check_out_date - stay.check_in_date).num_days(),
        subtotal,
        currency,
    )
    .await
    .map(Some)
}

async fn quote_for_inventory(
    pool: &DbPool,
    guest_id: i64,
    room_type: RoomTypeInventory,
    stay: ValidatedStay,
    voucher_id: Option<i64>,
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
    let discount_amount = voucher
        .as_ref()
        .map(|voucher| voucher_discount(subtotal, voucher))
        .unwrap_or(Decimal::ZERO);
    // Room prices are configured tax-inclusive throughout the existing booking
    // workflow. Keep the tax component explicit without charging it twice.
    let tax_amount = Decimal::ZERO;
    let total_amount = (subtotal - discount_amount + tax_amount).round_dp(2);
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

pub async fn search(
    pool: &DbPool,
    guest_id: i64,
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
        let quote = quote_for_inventory(pool, guest_id, room_type, stay, None).await?;
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

pub async fn quote(
    pool: &DbPool,
    guest_id: i64,
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
    quote_for_inventory(pool, guest_id, room_type, stay, request.voucher_id).await
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
    let stay_date = NaiveDate::parse_from_str(stay_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid stay date. Use YYYY-MM-DD".to_string()))?;
    Repository::upsert_online_inventory(
        pool,
        room_type_id,
        stay_date,
        request.walk_in_reserved_rooms,
        request.online_booking_enabled,
        actor_id,
    )
    .await?;
    Repository::list_online_inventory(pool, stay_date)
        .await?
        .into_iter()
        .find(|allocation| allocation.room_type_id == room_type_id)
        .ok_or_else(|| ApiError::NotFound("Room type not found".to_string()))
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool: &DbPool,
    hub: &AvailabilityHub,
    guest_id: i64,
    request: CreateGuestBookingRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GuestBookingConfirmation, ApiError> {
    let request_id = validate_client_request_id(&request.client_request_id)?;
    if let Some(existing) = Repository::find_by_request_id(pool, guest_id, &request_id).await? {
        return Ok(existing);
    }

    let quote = quote(
        pool,
        guest_id,
        BookingQuoteRequest {
            room_type_id: request.room_type_id,
            check_in_date: request.check_in_date.clone(),
            check_out_date: request.check_out_date.clone(),
            adults: request.adults,
            children: request.children,
            voucher_id: request.voucher_id,
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
                guest_id,
                request.room_type_id,
                quote.check_in_date,
                quote.check_out_date,
                (quote.check_out_date - quote.check_in_date).num_days(),
                quote.subtotal,
                &quote.currency,
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
        total_amount: quote.total_amount,
        currency: quote.currency.clone(),
        special_requests,
        cleaning_preference: request.cleaning_preference,
        booking_channel_id,
        nightly_rates: daily_rates,
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

    if let Some(voucher) = voucher_to_redeem.as_ref() {
        Repository::redeem_voucher_tx(
            &mut tx,
            voucher,
            booking_id,
            guest_id,
            contact.actor_user_id,
            quote.subtotal,
            quote.discount_amount,
            quote.total_amount,
        )
        .await?;
    }

    Repository::mark_room_reserved_tx(&mut tx, room_id, &booking_number).await?;
    crate::repositories::bookings::record_booking_history_tx(
        &mut tx,
        booking_id,
        None,
        "pending",
        contact.actor_user_id,
        Some("Booking created in guest portal (pending payment)"),
        json!({
            "source": PORTAL_SOURCE,
            "guest_id": guest_id,
            "room_type_id": request.room_type_id,
            "portal_request_id": request_id,
        }),
    )
    .await?;
    AuditLog::log_event_tx(
        &mut tx,
        contact.actor_user_id,
        "guest_portal.booking_created",
        "booking",
        Some(booking_id),
        Some(json!({
            "booking_number": booking_number,
            "room_type_id": request.room_type_id,
            "check_in_date": quote.check_in_date,
            "check_out_date": quote.check_out_date,
            "total_amount": quote.total_amount.to_string(),
            "currency": quote.currency,
        })),
        ip_address,
        user_agent,
    )
    .await?;

    if let Some(email) = contact
        .email
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let subject = format!("Booking received {booking_number}");
        let body_html = format!(
            "<p>Dear {},</p><p>Your reservation <strong>{}</strong> has been received and is pending payment.</p>\
             <p>{} · {} to {} · {} {}</p>\
             <p>Please complete payment to confirm your booking. You can pay online from your guest portal or complete a bank transfer.</p>",
            html_escape(&contact.full_name),
            html_escape(&booking_number),
            html_escape(&quote.room_type_name),
            quote.check_in_date,
            quote.check_out_date,
            html_escape(&quote.currency),
            quote.total_amount,
        );
        CommunicationsRepository::insert_delivery_tx(
            &mut tx,
            None,
            "booking_confirmation",
            guest_id,
            "booking_confirmation",
            email,
            &subject,
            &body_html,
            None,
            None,
            &format!("booking-confirmation:{booking_id}"),
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
}
