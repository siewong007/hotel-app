//! Staff multi-room booking: 2–5 rooms for one guest and one stay, created
//! atomically and tied together as a `booking_groups` row so the front desk
//! takes one payment and sends one confirmation for the whole group.

use super::lifecycle::{after_booking_created, create_booking_tx};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::{Booking, BookingInput};
use crate::modules::booking_groups::models::{BookingGroup, NewBookingGroup};
use crate::modules::booking_groups::repository::BookingGroupRepository;
use crate::utils::date::parse_date_flexible;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Largest group the front desk can create in one go (matches the portal).
pub const MAX_GROUP_ROOMS: usize = 5;

#[derive(Debug, Deserialize)]
pub struct GroupBookingInput {
    pub bookings: Vec<BookingInput>,
}

#[derive(Debug, Serialize)]
pub struct GroupBookingResponse {
    pub group: BookingGroup,
    pub bookings: Vec<Booking>,
}

/// Shape checks that need no database: room count, one guest, one stay, no
/// repeated room. Per-room rules (availability, dates vs today, rates) are
/// enforced by `create_booking_tx` for each room.
pub fn validate_group_input(input: &GroupBookingInput) -> Result<(), ApiError> {
    let n = input.bookings.len();
    if !(2..=MAX_GROUP_ROOMS).contains(&n) {
        return Err(ApiError::BadRequest(format!(
            "A group booking needs between 2 and {MAX_GROUP_ROOMS} rooms"
        )));
    }
    let first = &input.bookings[0];
    let check_in = parse_date_flexible(&first.check_in_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-in date".to_string()))?;
    let check_out = parse_date_flexible(&first.check_out_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-out date".to_string()))?;
    let mut rooms = HashSet::new();
    for booking in &input.bookings {
        if booking.guest_id != first.guest_id {
            return Err(ApiError::BadRequest(
                "All rooms in a group booking must be for the same guest".to_string(),
            ));
        }
        let same_stay = parse_date_flexible(&booking.check_in_date).ok() == Some(check_in)
            && parse_date_flexible(&booking.check_out_date).ok() == Some(check_out);
        if !same_stay {
            return Err(ApiError::BadRequest(
                "All rooms in a group booking must share the same dates".to_string(),
            ));
        }
        if !rooms.insert(booking.room_id) {
            return Err(ApiError::BadRequest(
                "A room can only appear once in a group booking".to_string(),
            ));
        }
    }
    Ok(())
}

pub async fn create_group_booking_handler(
    pool: &DbPool,
    user_id: i64,
    input: GroupBookingInput,
) -> Result<GroupBookingResponse, ApiError> {
    validate_group_input(&input)?;
    let first = &input.bookings[0];
    let check_in = parse_date_flexible(&first.check_in_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-in date".to_string()))?;
    let check_out = parse_date_flexible(&first.check_out_date)
        .map_err(|_| ApiError::BadRequest("Invalid check-out date".to_string()))?;

    // Lock rooms in a stable order so two overlapping group creates cannot
    // deadlock on each other's room locks.
    let mut order: Vec<usize> = (0..input.bookings.len()).collect();
    order.sort_by_key(|&i| input.bookings[i].room_id);

    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    let mut created: Vec<(usize, Booking)> = Vec::with_capacity(order.len());
    for &i in &order {
        let booking = create_booking_tx(pool, &mut tx, user_id, &input.bookings[i]).await?;
        created.push((i, booking));
    }
    created.sort_by_key(|(i, _)| *i);

    let currency: String = sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(TRIM(currency), ''), 'MYR') FROM bookings WHERE id = $1",
    )
    .bind(created[0].1.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(ApiError::from)?;

    let group = BookingGroupRepository::create_tx(
        &mut tx,
        &NewBookingGroup {
            guest_id: first.guest_id,
            check_in_date: check_in,
            check_out_date: check_out,
            source: "staff".to_string(),
            currency,
            voucher_id: None,
            hold_expires_at: None,
            portal_request_id: None,
            created_by: Some(user_id),
        },
    )
    .await?;
    let ids: Vec<i64> = created.iter().map(|(_, b)| b.id).collect();
    BookingGroupRepository::attach_tx(&mut tx, group.id, &ids).await?;
    let group = BookingGroupRepository::refresh_totals_tx(&mut tx, group.id).await?;
    tx.commit().await.map_err(ApiError::from)?;

    let mut any_confirmed = false;
    for (i, booking) in &created {
        after_booking_created(pool, user_id, &input.bookings[*i], booking).await?;
        any_confirmed |= booking.status == "confirmed";
    }
    if any_confirmed {
        super::emails::try_queue_group_confirmation_email(pool, group.id).await;
    }

    Ok(GroupBookingResponse {
        group,
        bookings: created.into_iter().map(|(_, b)| b).collect(),
    })
}
