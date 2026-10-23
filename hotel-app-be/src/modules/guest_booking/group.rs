//! Multi-room guest bookings: one checkout, several rooms.
//!
//! Every room becomes an ordinary single-room booking (priced, allocated and
//! stored exactly like a one-room portal booking) and all of them are linked
//! to one `booking_groups` row. The whole cart is allocated inside ONE
//! transaction with the cart's room types locked in ascending id order, so
//! either every room is reserved or none is, and two concurrent carts can
//! never deadlock. Each room carries its own subtotal, tourism tax (per
//! room-night) and extra-bed charge, so a later single-room cancel or refund
//! touches only that booking.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::availability::{AvailabilityEvent, AvailabilityHub};
use super::models::{
    AnonymousGuestDetails, BookingInsert, BookingQuoteRequest, GuestBookingConfirmation,
    GuestBookingQuote,
};
use super::repository::GuestBookingRepository as Repository;
use super::service::{
    self, PORTAL_SOURCE, PortalBookingMail, channel_economics, portal_booking_mail,
    profile_incomplete_error,
};
use super::validation::{
    validate_anonymous_guest, validate_client_request_id, validate_smoking_preference,
    validate_stay,
};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::modules::booking_groups::MAX_ROOMS_PER_GUEST_BOOKING;
use crate::modules::booking_groups::models::{BookingGroup, NewBookingGroup};
use crate::modules::booking_groups::repository::BookingGroupRepository;
use crate::modules::communications::repository::{CommunicationsRepository, DeliveryValues};
use crate::modules::communications::service as communications_service;
use crate::modules::consent::models::{ConsentAcceptance, ConsentDocument, ConsentSource};
use crate::modules::consent::service::{self as consent_service, ConsentContext, ConsentSubject};
use crate::modules::consent::validation as consent_validation;
use crate::modules::profile::service::completion_for_guest;
use crate::services::audit::AuditLog;
use crate::utils::sanitization::Sanitizer;

// ---------------------------------------------------------------- requests

/// One room line in the cart.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GroupRoomRequest {
    pub room_type_id: i64,
    pub adults: Option<i32>,
    pub children: Option<i32>,
    /// Extra beds for this room (0 when absent). Only for room types that
    /// allow them, up to the type's `max_extra_beds`.
    #[serde(default)]
    pub extra_beds: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GroupQuoteRequest {
    pub check_in_date: String,
    pub check_out_date: String,
    pub rooms: Vec<GroupRoomRequest>,
    /// `local` / `foreign`; anonymous carts send it, signed-in carts fall back
    /// to the profile.
    #[serde(default)]
    pub tourism_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnonymousGroupBookingRequest {
    pub client_request_id: String,
    pub check_in_date: String,
    pub check_out_date: String,
    pub rooms: Vec<GroupRoomRequest>,
    pub expected_total: Decimal,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
    #[serde(default)]
    pub smoking_preference: Option<String>,
    pub guest: AnonymousGuestDetails,
    #[serde(default)]
    pub consents: Vec<ConsentAcceptance>,
    #[serde(default)]
    pub marketing_opt_in: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GuestGroupBookingRequest {
    pub client_request_id: String,
    pub check_in_date: String,
    pub check_out_date: String,
    pub rooms: Vec<GroupRoomRequest>,
    pub expected_total: Decimal,
    pub special_requests: Option<String>,
    pub cleaning_preference: Option<bool>,
    #[serde(default)]
    pub smoking_preference: Option<String>,
    #[serde(default)]
    pub consents: Vec<ConsentAcceptance>,
}

// --------------------------------------------------------------- responses

#[derive(Debug, Clone, Serialize)]
pub struct GroupRoomQuote {
    /// Position in the cart (0-based), echoed so the portal can map errors.
    pub index: usize,
    pub quote: GuestBookingQuote,
    pub extra_bed_count: i32,
    pub extra_bed_charge: Decimal,
    /// `quote.total_amount + extra_bed_charge`.
    pub room_total: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupRoomTypeAvailability {
    pub room_type_id: i64,
    pub requested: i64,
    pub available: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupQuote {
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub currency: String,
    pub room_count: usize,
    pub max_rooms: usize,
    pub rooms: Vec<GroupRoomQuote>,
    pub availability: Vec<GroupRoomTypeAvailability>,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    /// Tourism tax across every room-night.
    pub tax_amount: Decimal,
    pub extra_bed_charge: Decimal,
    /// What the guest pays for the whole cart.
    pub total_amount: Decimal,
    pub hold_release_hours: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupBookingConfirmation {
    pub group_id: i64,
    pub group_number: String,
    pub status: String,
    pub payment_status: String,
    pub check_in_date: NaiveDate,
    pub check_out_date: NaiveDate,
    pub currency: String,
    pub room_count: i32,
    pub subtotal: Decimal,
    pub discount_amount: Decimal,
    pub tax_amount: Decimal,
    pub total_amount: Decimal,
    pub hold_expires_at: Option<DateTime<Utc>>,
    pub rooms: Vec<GuestBookingConfirmation>,
    /// Anonymous carts only: the access token (issued on the lead room) that
    /// lets the guest pay and track the booking with no account.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

// ------------------------------------------------------------------ pricing

struct ExtraBedPolicy {
    allows: bool,
    max: i32,
    charge: Decimal,
}

async fn extra_bed_policy(pool: &DbPool, room_type_id: i64) -> Result<ExtraBedPolicy, ApiError> {
    let row = sqlx::query(
        "SELECT COALESCE(allows_extra_bed, false) AS allows, COALESCE(max_extra_beds, 0) AS max_beds, \
                COALESCE(extra_bed_charge, 0) AS charge FROM room_types WHERE id = $1",
    )
    .bind(room_type_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(|| ApiError::NotFound("Room type not found".to_string()))?;
    Ok(ExtraBedPolicy {
        allows: row.try_get("allows").map_err(ApiError::from)?,
        max: row.try_get("max_beds").map_err(ApiError::from)?,
        charge: row.try_get("charge").map_err(ApiError::from)?,
    })
}

/// Extra-bed charge for one room: beds × the type's per-bed charge × nights.
pub fn extra_bed_total(beds: i32, per_bed_per_night: Decimal, nights: i64) -> Decimal {
    (Decimal::from(beds.max(0)) * per_bed_per_night * Decimal::from(nights.max(1))).round_dp(2)
}

/// Requested rooms per room type, in ascending room-type order.
pub fn rooms_per_type(rooms: &[GroupRoomRequest]) -> BTreeMap<i64, i64> {
    let mut counts = BTreeMap::new();
    for room in rooms {
        *counts.entry(room.room_type_id).or_insert(0) += 1;
    }
    counts
}

/// Cart-shape rules that need no database: 1..=MAX rooms.
pub fn validate_cart_shape(rooms: &[GroupRoomRequest]) -> Result<(), ApiError> {
    if rooms.is_empty() {
        return Err(ApiError::BadRequest(
            "Add at least one room to your booking".to_string(),
        ));
    }
    if rooms.len() > MAX_ROOMS_PER_GUEST_BOOKING {
        return Err(ApiError::BadRequest(format!(
            "A booking can hold at most {MAX_ROOMS_PER_GUEST_BOOKING} rooms"
        )));
    }
    Ok(())
}

/// Price a whole cart. Each room is quoted at list price through the same
/// `quote()` a single-room booking uses, plus its extra beds. Availability is
/// checked per room type against the number of rooms of that type in the cart.
pub async fn quote_group(
    pool: &DbPool,
    guest_id: Option<i64>,
    request: &GroupQuoteRequest,
) -> Result<GroupQuote, ApiError> {
    validate_cart_shape(&request.rooms)?;
    let stay = validate_stay(
        pool,
        &request.check_in_date,
        &request.check_out_date,
        Some(1),
        Some(0),
    )
    .await?;
    let nights = (stay.check_out_date - stay.check_in_date).num_days();

    let mut availability = Vec::new();
    for (room_type_id, requested) in rooms_per_type(&request.rooms) {
        let available = Repository::available_count(
            pool,
            room_type_id,
            stay.check_in_date,
            stay.check_out_date,
        )
        .await?;
        availability.push(GroupRoomTypeAvailability {
            room_type_id,
            requested,
            available,
        });
    }
    if let Some(short) = availability.iter().find(|a| a.requested > a.available) {
        return Err(ApiError::Conflict(format!(
            "Only {} room(s) of this type are left for your dates (room type {}). Please reduce the quantity.",
            short.available, short.room_type_id
        )));
    }

    let mut rooms = Vec::with_capacity(request.rooms.len());
    for (index, room) in request.rooms.iter().enumerate() {
        let quote = service::quote(
            pool,
            guest_id,
            BookingQuoteRequest {
                room_type_id: room.room_type_id,
                check_in_date: request.check_in_date.clone(),
                check_out_date: request.check_out_date.clone(),
                adults: room.adults,
                children: room.children,
                voucher_id: None,
                complimentary_dates: None,
                tourism_type: request.tourism_type.clone(),
            },
        )
        .await
        .map_err(|error| room_error(index, error))?;
        let beds = room.extra_beds.unwrap_or(0);
        let extra_bed_charge = if beds > 0 {
            let policy = extra_bed_policy(pool, room.room_type_id).await?;
            if !policy.allows || beds > policy.max {
                return Err(ApiError::BadRequest(format!(
                    "Room {}: this room type allows at most {} extra bed(s)",
                    index + 1,
                    if policy.allows { policy.max } else { 0 }
                )));
            }
            extra_bed_total(beds, policy.charge, nights)
        } else if beds < 0 {
            return Err(ApiError::BadRequest(
                "Extra beds cannot be negative".to_string(),
            ));
        } else {
            Decimal::ZERO
        };
        let room_total = (quote.total_amount + extra_bed_charge).round_dp(2);
        rooms.push(GroupRoomQuote {
            index,
            quote,
            extra_bed_count: beds,
            extra_bed_charge,
            room_total,
        });
    }

    let sum = |f: &dyn Fn(&GroupRoomQuote) -> Decimal| {
        rooms
            .iter()
            .map(f)
            .fold(Decimal::ZERO, |a, b| a + b)
            .round_dp(2)
    };
    Ok(GroupQuote {
        check_in_date: stay.check_in_date,
        check_out_date: stay.check_out_date,
        currency: rooms
            .first()
            .map(|room| room.quote.currency.clone())
            .unwrap_or_default(),
        room_count: rooms.len(),
        max_rooms: MAX_ROOMS_PER_GUEST_BOOKING,
        subtotal: sum(&|room| room.quote.subtotal),
        discount_amount: sum(&|room| room.quote.discount_amount),
        tax_amount: sum(&|room| room.quote.tax_amount),
        extra_bed_charge: sum(&|room| room.extra_bed_charge),
        total_amount: sum(&|room| room.room_total),
        hold_release_hours: rooms.first().and_then(|room| room.quote.hold_release_hours),
        rooms,
        availability,
    })
}

fn room_error(index: usize, error: ApiError) -> ApiError {
    match error {
        ApiError::BadRequest(message) => {
            ApiError::BadRequest(format!("Room {}: {message}", index + 1))
        }
        ApiError::Conflict(message) => ApiError::Conflict(format!("Room {}: {message}", index + 1)),
        other => other,
    }
}

// ----------------------------------------------------------------- creation

/// Who is booking: a signed-in guest, or a new anonymous profile.
enum Booker {
    Guest { guest_id: i64 },
    Anonymous(Box<super::validation::ValidatedAnonymousGuest>),
}

struct GroupCreate<'a> {
    request_id: String,
    check_in_date: &'a str,
    check_out_date: &'a str,
    rooms: &'a [GroupRoomRequest],
    expected_total: Decimal,
    special_requests: Option<&'a str>,
    cleaning_preference: Option<bool>,
    smoking_preference: Option<&'a str>,
    consents: &'a [ConsentAcceptance],
    ip_address: Option<String>,
    user_agent: Option<String>,
}

/// Request id of the n-th room of a cart (`bookings.portal_request_id` is
/// varchar(128) and keyed per guest).
pub fn member_request_id(request_id: &str, index: usize) -> String {
    let base: String = request_id.chars().take(120).collect();
    format!("{base}#r{}", index + 1)
}

fn conflict_for_taken_room(index: usize, room_type_name: &str) -> ApiError {
    ApiError::Conflict(format!(
        "Room {} ({room_type_name}) was just booked by someone else. Please review your cart — nothing was charged and no rooms were held.",
        index + 1
    ))
}

async fn create_group_inner(
    pool: &DbPool,
    hub: &AvailabilityHub,
    booker: Booker,
    input: GroupCreate<'_>,
) -> Result<GroupBookingConfirmation, ApiError> {
    let smoking_preference = validate_smoking_preference(input.smoking_preference)?;
    let quote_guest = match &booker {
        Booker::Guest { guest_id } => Some(*guest_id),
        Booker::Anonymous(_) => None,
    };
    let tourism_type = match &booker {
        Booker::Guest { .. } => None,
        Booker::Anonymous(guest) => Some(guest.tourism_type.clone()),
    };
    let group_quote = quote_group(
        pool,
        quote_guest,
        &GroupQuoteRequest {
            check_in_date: input.check_in_date.to_string(),
            check_out_date: input.check_out_date.to_string(),
            rooms: input.rooms.to_vec(),
            tourism_type,
        },
    )
    .await?;
    if group_quote.total_amount != input.expected_total.round_dp(2) {
        return Err(ApiError::Conflict(
            "The booking price changed. Please review the refreshed total.".to_string(),
        ));
    }

    let booking_channel_id = Repository::direct_booking_channel(pool).await?;
    let special_requests = input
        .special_requests
        .map(Sanitizer::sanitize_notes)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut economics = Vec::with_capacity(group_quote.rooms.len());
    for room in &group_quote.rooms {
        economics.push(channel_economics(pool, booking_channel_id, &room.quote).await?);
    }
    let hold_expires_at = group_quote
        .hold_release_hours
        .filter(|hours| *hours > 0)
        .map(|hours| Utc::now() + Duration::hours(i64::from(hours)));
    let (actor_user_id, contact_email, contact_name, language) = match &booker {
        Booker::Guest { guest_id } => {
            let contact = Repository::guest_contact(pool, *guest_id).await?;
            (
                contact.actor_user_id,
                contact
                    .email
                    .clone()
                    .filter(|email| !email.trim().is_empty()),
                contact.nick_name.clone(),
                contact.language_preference.clone(),
            )
        }
        Booker::Anonymous(guest) => (
            None,
            Some(guest.email.clone()),
            guest.nick_name.clone(),
            Some(consent_validation::preferred_locale(input.consents)),
        ),
    };

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let room_type_ids: Vec<i64> = input.rooms.iter().map(|room| room.room_type_id).collect();
    BookingGroupRepository::lock_room_types_tx(&mut tx, &room_type_ids).await?;

    let guest_id = match &booker {
        Booker::Guest { guest_id } => *guest_id,
        Booker::Anonymous(guest) => {
            Repository::insert_anonymous_guest_tx(
                &mut tx,
                guest,
                language.as_deref().unwrap_or("en"),
            )
            .await?
        }
    };
    let group = BookingGroupRepository::create_tx(
        &mut tx,
        &NewBookingGroup {
            guest_id,
            check_in_date: group_quote.check_in_date,
            check_out_date: group_quote.check_out_date,
            source: PORTAL_SOURCE.to_string(),
            currency: group_quote.currency.clone(),
            voucher_id: None,
            hold_expires_at,
            portal_request_id: Some(input.request_id.clone()),
            created_by: actor_user_id,
        },
    )
    .await?;

    let mut booking_ids = Vec::with_capacity(group_quote.rooms.len());
    for (room, (commission_amount, net_revenue, snapshot)) in
        group_quote.rooms.iter().zip(economics)
    {
        let quote = &room.quote;
        Repository::ensure_online_room_available_tx(
            &mut tx,
            quote.room_type_id,
            quote.check_in_date,
            quote.check_out_date,
        )
        .await
        .map_err(|_| conflict_for_taken_room(room.index, &quote.room_type_name))?;
        let allocated = Repository::allocate_room_tx(
            &mut tx,
            quote.room_type_id,
            quote.check_in_date,
            quote.check_out_date,
            smoking_preference,
        )
        .await
        .map_err(|_| conflict_for_taken_room(room.index, &quote.room_type_name))?;
        let first_rate = quote
            .nightly_rates
            .first()
            .map(|rate| rate.amount)
            .ok_or_else(|| {
                ApiError::BadRequest("A booking requires at least one night".to_string())
            })?;
        let daily_rates = json!(
            quote
                .nightly_rates
                .iter()
                .map(|rate| (rate.date.to_string(), rate.amount))
                .collect::<BTreeMap<_, _>>()
        );
        let preference_note =
            super::validation::smoking_preference_note(smoking_preference, allocated.is_smoking);
        let booking_number = crate::modules::bookings::helpers::generate_booking_number_for_date(
            quote.check_in_date,
        );
        let insert = BookingInsert {
            portal_request_id: member_request_id(&input.request_id, room.index),
            guest_id,
            actor_user_id,
            room_id: allocated.room_id,
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
            special_requests: special_requests.clone(),
            cleaning_preference: input.cleaning_preference,
            smoking_preference,
            internal_notes: preference_note.clone(),
            booking_channel_id,
            nightly_rates: daily_rates,
            complimentary_reason: None,
            settled_by_credits: false,
            is_tourist: quote.tax_amount > Decimal::ZERO,
            tourism_tax_amount: quote.tax_amount,
            commission_amount,
            net_revenue,
            channel_pricing_snapshot: snapshot,
        };
        let booking_id = Repository::insert_booking_tx(&mut tx, &insert).await?;
        if room.extra_bed_count > 0 {
            sqlx::query(
                "UPDATE bookings SET extra_bed_count = $1, extra_bed_charge = $2 WHERE id = $3",
            )
            .bind(room.extra_bed_count)
            .bind(room.extra_bed_charge)
            .bind(booking_id)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        }
        Repository::mark_room_reserved_tx(&mut tx, allocated.room_id).await?;
        crate::modules::bookings::record_booking_history_tx(
            &mut tx,
            booking_id,
            None,
            "pending_payment",
            actor_user_id,
            Some(
                "Booking created in guest portal as part of a multi-room booking (pending payment)",
            ),
            json!({
                "source": PORTAL_SOURCE,
                "guest_id": guest_id,
                "room_type_id": quote.room_type_id,
                "portal_request_id": input.request_id,
                "booking_group_id": group.id,
                "group_number": group.group_number,
                "room_index": room.index + 1,
                "smoking_preference": smoking_preference.map(|preference| preference.as_str()),
                "smoking_preference_met": preference_note.is_none(),
                "anonymous": matches!(booker, Booker::Anonymous(_)),
            }),
        )
        .await?;
        let subject = match &booker {
            Booker::Guest { .. } => ConsentSubject::guest(guest_id).with_booking(booking_id),
            Booker::Anonymous(_) => ConsentSubject::anonymous_booking(guest_id, booking_id),
        };
        consent_service::record_tx(
            &mut tx,
            subject,
            input.consents,
            ConsentSource::OnlineBooking,
            &ConsentContext {
                ip_address: input.ip_address.clone(),
                user_agent: input.user_agent.clone(),
            },
        )
        .await?;
        booking_ids.push(booking_id);
    }
    BookingGroupRepository::attach_tx(&mut tx, group.id, &booking_ids).await?;
    let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id).await?;

    let lead_booking_id = booking_ids[0];
    let access = match &booker {
        Booker::Anonymous(_) => {
            let token = crate::modules::guest_portal::service::generate_session_token();
            let expires_at =
                service::anonymous_access_token_expiry(Utc::now(), group.check_in_date);
            Repository::issue_access_token_tx(&mut tx, lead_booking_id, &token, expires_at).await?;
            Some((token, expires_at))
        }
        Booker::Guest { .. } => None,
    };

    AuditLog::log_event_tx(
        &mut tx,
        AuditEvent {
            user_id: actor_user_id,
            action: "guest_portal.group_booking_created",
            resource_type: "booking_group",
            resource_id: Some(group.id),
            details: Some(json!({
                "group_number": group.group_number,
                "booking_ids": booking_ids,
                "room_count": booking_ids.len(),
                "check_in_date": group.check_in_date,
                "check_out_date": group.check_out_date,
                "total_amount": group_quote.total_amount.to_string(),
                "currency": group.currency,
                "guest_id": guest_id,
                "anonymous": access.is_some(),
            })),
            ip_address: input.ip_address.clone(),
            user_agent: input.user_agent.clone(),
        },
    )
    .await?;

    if let Some(email) = contact_email.as_deref() {
        let rooms_label = rooms_label(&group_quote);
        let (subject, body_html, body_text) = portal_booking_mail(PortalBookingMail {
            guest_name: &contact_name,
            booking_number: &group.group_number,
            room_type_name: &rooms_label,
            check_in: group.check_in_date,
            check_out: group.check_out_date,
            currency: &group.currency,
            total: group_quote.total_amount,
            settled_by_credits: false,
            anonymous: access.is_some(),
            access_token: access.as_ref().map(|(token, _)| token.as_str()),
            locale: crate::core::i18n::mail_locale(pool, language.as_deref()).await,
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
                idempotency_key: &format!("booking-group-confirmation:{}", group.id),
            },
        )
        .await?;
    }

    tx.commit().await.map_err(ApiError::from)?;

    for (room_type_id, _) in rooms_per_type(input.rooms) {
        let remaining = Repository::available_count(
            pool,
            room_type_id,
            group.check_in_date,
            group.check_out_date,
        )
        .await?;
        hub.publish(AvailabilityEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: "availability_changed",
            reason: "booking_created",
            room_type_id: Some(room_type_id),
            check_in_date: Some(group.check_in_date),
            check_out_date: Some(group.check_out_date),
            remaining_rooms: Some(remaining),
        });
    }

    let mut confirmation = confirmation_for(pool, &group, group_quote.total_amount).await?;
    if let Some((token, expires_at)) = access {
        confirmation.access_token = Some(token);
        confirmation.access_token_expires_at = Some(expires_at);
    }
    Ok(confirmation)
}

/// "2 × Deluxe, 1 × Suite" — the room line of the confirmation email.
fn rooms_label(quote: &GroupQuote) -> String {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for room in &quote.rooms {
        match counts
            .iter_mut()
            .find(|(name, _)| *name == room.quote.room_type_name)
        {
            Some((_, count)) => *count += 1,
            None => counts.push((room.quote.room_type_name.clone(), 1)),
        }
    }
    counts
        .into_iter()
        .map(|(name, count)| format!("{count} × {name}"))
        .collect::<Vec<_>>()
        .join(", ")
}

async fn confirmation_for(
    pool: &DbPool,
    group: &BookingGroup,
    payable_total: Decimal,
) -> Result<GroupBookingConfirmation, ApiError> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM bookings WHERE booking_group_id = $1 ORDER BY id")
            .bind(group.id)
            .fetch_all(pool)
            .await
            .map_err(ApiError::from)?;
    let mut rooms = Vec::with_capacity(ids.len());
    for id in ids {
        rooms.push(Repository::confirmation_by_id(pool, id).await?);
    }
    Ok(GroupBookingConfirmation {
        group_id: group.id,
        group_number: group.group_number.clone(),
        status: group.status.clone(),
        payment_status: group.payment_status.clone(),
        check_in_date: group.check_in_date,
        check_out_date: group.check_out_date,
        currency: group.currency.clone(),
        room_count: group.room_count,
        subtotal: group.subtotal,
        discount_amount: group.discount_amount,
        tax_amount: group.tourism_tax_amount,
        total_amount: payable_total,
        hold_expires_at: group.hold_expires_at,
        rooms,
        access_token: None,
        access_token_expires_at: None,
    })
}

/// What the guest owes for a stored group: room totals (pre-tax) + tourism
/// tax + extra beds across live rooms.
async fn payable_total(pool: &DbPool, group_id: i64) -> Result<Decimal, ApiError> {
    let total: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_amount + COALESCE(tourism_tax_amount, 0) + COALESCE(extra_bed_charge, 0)), 0) \
         FROM bookings WHERE booking_group_id = $1 AND status <> 'voided'",
    )
    .bind(group_id)
    .fetch_one(pool)
    .await
    .map_err(ApiError::from)?;
    Ok(total.round_dp(2))
}

async fn replay(pool: &DbPool, group_id: i64) -> Result<GroupBookingConfirmation, ApiError> {
    let group = BookingGroupRepository::find_by_id(pool, group_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;
    let total = payable_total(pool, group.id).await?;
    confirmation_for(pool, &group, total).await
}

/// Signed-in multi-room checkout (list price; vouchers and credits across a
/// cart arrive in a follow-up).
pub async fn create_for_guest(
    pool: &DbPool,
    hub: &AvailabilityHub,
    guest_id: i64,
    request: GuestGroupBookingRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GroupBookingConfirmation, ApiError> {
    let request_id = validate_client_request_id(&request.client_request_id)?;
    validate_cart_shape(&request.rooms)?;
    consent_validation::validate_locales(&request.consents)?;
    consent_validation::require_consents(&request.consents, consent_validation::BOOKING_REQUIRED)?;
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM booking_groups WHERE guest_id = $1 AND portal_request_id = $2",
    )
    .bind(guest_id)
    .bind(&request_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;
    if let Some(group_id) = existing {
        return replay(pool, group_id).await;
    }
    let completion = completion_for_guest(pool, guest_id).await?;
    if !completion.complete {
        return Err(profile_incomplete_error(completion));
    }
    create_group_inner(
        pool,
        hub,
        Booker::Guest { guest_id },
        GroupCreate {
            request_id,
            check_in_date: &request.check_in_date,
            check_out_date: &request.check_out_date,
            rooms: &request.rooms,
            expected_total: request.expected_total,
            special_requests: request.special_requests.as_deref(),
            cleaning_preference: request.cleaning_preference,
            smoking_preference: request.smoking_preference.as_deref(),
            consents: &request.consents,
            ip_address,
            user_agent,
        },
    )
    .await
}

/// Multi-room checkout with no account (list price, like a single-room
/// anonymous booking). A fresh guest profile is always created.
pub async fn create_anonymous(
    pool: &DbPool,
    hub: &AvailabilityHub,
    request: AnonymousGroupBookingRequest,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<GroupBookingConfirmation, ApiError> {
    let request_id = validate_client_request_id(&request.client_request_id)?;
    let guest = validate_anonymous_guest(&request.guest)?;
    validate_cart_shape(&request.rooms)?;
    consent_validation::validate_locales(&request.consents)?;
    consent_validation::require_consents(&request.consents, consent_validation::BOOKING_REQUIRED)?;

    // Idempotent retry keyed on request id + email (no stable guest id
    // exists for an anonymous booker). The token is hashed at rest, so a
    // replay mints a fresh one on the lead room.
    let existing: Option<(i64, i64, NaiveDate)> = sqlx::query_as(
        r#"
        SELECT g.id, MIN(b.id), g.check_in_date FROM booking_groups g
        JOIN guests gu ON gu.id = g.guest_id
        JOIN bookings b ON b.booking_group_id = g.id
        WHERE g.portal_request_id = $1 AND LOWER(TRIM(gu.email)) = LOWER(TRIM($2))
          AND gu.deleted_at IS NULL
        GROUP BY g.id, g.check_in_date
        "#,
    )
    .bind(&request_id)
    .bind(&guest.email)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?;
    if let Some((group_id, lead_booking_id, check_in)) = existing {
        let mut confirmation = replay(pool, group_id).await?;
        let token = crate::modules::guest_portal::service::generate_session_token();
        let expires_at = service::anonymous_access_token_expiry(Utc::now(), check_in);
        crate::modules::guest_portal::repository::GuestPortalRepository::update_precheckin_token(
            pool,
            lead_booking_id,
            &token,
            expires_at,
        )
        .await?;
        confirmation.access_token = Some(token);
        confirmation.access_token_expires_at = Some(expires_at);
        return Ok(confirmation);
    }

    let marketing_opt_in = request.marketing_opt_in;
    let confirmation = create_group_inner(
        pool,
        hub,
        Booker::Anonymous(Box::new(guest)),
        GroupCreate {
            request_id,
            check_in_date: &request.check_in_date,
            check_out_date: &request.check_out_date,
            rooms: &request.rooms,
            expected_total: request.expected_total,
            special_requests: request.special_requests.as_deref(),
            cleaning_preference: request.cleaning_preference,
            smoking_preference: request.smoking_preference.as_deref(),
            consents: &request.consents,
            ip_address: ip_address.clone(),
            user_agent: user_agent.clone(),
        },
    )
    .await?;

    // Outside the booking transaction, as for single-room bookings.
    if let Some(guest_id) = group_guest_id(pool, confirmation.group_id).await?
        && let Err(error) = communications_service::record_signup_marketing_consent(
            pool,
            guest_id,
            marketing_opt_in,
            "online_booking",
            Some(ConsentDocument::PrivacyNotice.current_version()),
            ip_address,
            user_agent,
        )
        .await
    {
        log::warn!("Failed to record marketing preference for guest {guest_id}: {error}");
    }
    Ok(confirmation)
}

async fn group_guest_id(pool: &DbPool, group_id: i64) -> Result<Option<i64>, ApiError> {
    sqlx::query_scalar("SELECT guest_id FROM booking_groups WHERE id = $1")
        .bind(group_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::from)
}

/// A signed-in guest's own group (IDOR-safe: scoped to the session guest).
pub async fn get_for_guest(
    pool: &DbPool,
    guest_id: i64,
    group_id: i64,
) -> Result<GroupBookingConfirmation, ApiError> {
    let group = BookingGroupRepository::find_for_guest(pool, group_id, guest_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;
    let total = payable_total(pool, group.id).await?;
    confirmation_for(pool, &group, total).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(room_type_id: i64) -> GroupRoomRequest {
        GroupRoomRequest {
            room_type_id,
            adults: Some(2),
            children: None,
            extra_beds: None,
        }
    }

    #[test]
    fn cart_must_hold_one_to_five_rooms() {
        assert!(validate_cart_shape(&[]).is_err());
        assert!(validate_cart_shape(&[room(1)]).is_ok());
        assert!(validate_cart_shape(&vec![room(1); 5]).is_ok());
        assert!(validate_cart_shape(&vec![room(1); 6]).is_err());
    }

    #[test]
    fn rooms_are_counted_per_type_in_ascending_order() {
        let counts = rooms_per_type(&[room(9), room(3), room(9)]);
        assert_eq!(counts.into_iter().collect::<Vec<_>>(), vec![(3, 1), (9, 2)]);
    }

    #[test]
    fn member_request_ids_are_distinct_and_bounded() {
        let long = "x".repeat(128);
        let first = member_request_id(&long, 0);
        let fifth = member_request_id(&long, 4);
        assert_ne!(first, fifth);
        assert!(first.chars().count() <= 128 && fifth.ends_with("#r5"));
    }

    #[test]
    fn extra_beds_bill_per_bed_per_night() {
        let charge: Decimal = "50.00".parse().unwrap();
        assert_eq!(extra_bed_total(2, charge, 3), "300.00".parse().unwrap());
        assert_eq!(extra_bed_total(0, charge, 3), Decimal::ZERO);
    }
}
