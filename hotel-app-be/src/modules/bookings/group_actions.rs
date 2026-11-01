//! Staff group actions on a multi-room booking: cancel all, check in all and
//! check out all. Each reuses the per-room service logic so a group action
//! applies exactly the same rules as acting on every room by hand.
//!
//! * Cancel all and check in all run every room inside ONE transaction under
//!   the group lock: either every eligible room changes or none does.
//! * Check out all runs every room through the per-room checkout (the generic
//!   booking update, which owns the company-ledger posting) after a preflight
//!   that refuses the whole action if any room still has a balance or an
//!   unresolved deposit, so a partial checkout only happens on an unexpected
//!   error — and the error names the rooms already checked out.

use axum::extract::{Extension, Json, Path, State};
use serde::{Deserialize, Serialize};

use super::helpers as booking_service;
use super::models::BookingUpdateInput;
use super::service::{CheckinSourceContext, checkin_booking_in_tx, void_booking_in_tx};
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::modules::booking_groups::repository::BookingGroupRepository;

const IN_HOUSE: &[&str] = &["checked_in", "auto_checked_in", "late_checkout"];
const DEPARTED: &[&str] = &["checked_out", "completed"];

#[derive(Debug, Default, Deserialize)]
pub struct GroupActionRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SkippedRoom {
    pub booking_id: i64,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct GroupActionResult {
    pub booking_group_id: i64,
    pub action: &'static str,
    pub processed: Vec<i64>,
    pub skipped: Vec<SkippedRoom>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupAction {
    Cancel,
    CheckIn,
    CheckOut,
}

impl GroupAction {
    fn name(self) -> &'static str {
        match self {
            GroupAction::Cancel => "cancel",
            GroupAction::CheckIn => "checkin",
            GroupAction::CheckOut => "checkout",
        }
    }
}

/// Which rooms an action targets. Returns (targets, skipped) or an error when
/// the group is in a state the action must refuse outright.
pub fn plan_group_action(
    action: GroupAction,
    rooms: &[(i64, String)],
) -> Result<(Vec<i64>, Vec<SkippedRoom>), ApiError> {
    let mut targets = Vec::new();
    let mut skipped = Vec::new();
    for (id, status) in rooms {
        let s = status.as_str();
        if s == "voided" {
            continue;
        }
        let take = match action {
            // Cancelling a group with a guest in house (or gone) is almost
            // certainly a mistake: refuse and let staff act per room.
            GroupAction::Cancel => {
                if IN_HOUSE.contains(&s) || DEPARTED.contains(&s) {
                    return Err(ApiError::BadRequest(
                        "Some rooms are already checked in or out; cancel the remaining rooms individually."
                            .to_string(),
                    ));
                }
                true
            }
            // Rooms already in house or gone are skipped; anything else goes
            // through the per-room check-in rules (pending → payment required).
            GroupAction::CheckIn => !IN_HOUSE.contains(&s) && !DEPARTED.contains(&s),
            GroupAction::CheckOut => IN_HOUSE.contains(&s),
        };
        if take {
            targets.push(*id);
        } else {
            skipped.push(SkippedRoom {
                booking_id: *id,
                status: status.clone(),
            });
        }
    }
    if targets.is_empty() {
        let msg = match action {
            GroupAction::Cancel => "No rooms in this group can be cancelled.",
            GroupAction::CheckIn => "No rooms in this group are waiting to check in.",
            GroupAction::CheckOut => "No rooms in this group are checked in.",
        };
        return Err(ApiError::BadRequest(msg.to_string()));
    }
    Ok((targets, skipped))
}

async fn group_rooms(pool: &DbPool, group_id: i64) -> Result<Vec<(i64, String)>, ApiError> {
    sqlx::query_as::<_, (i64, String)>(
        "SELECT id, COALESCE(status, 'pending') FROM bookings WHERE booking_group_id = $1 ORDER BY id",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)
}

async fn group_id_for(pool: &DbPool, booking_id: i64) -> Result<i64, ApiError> {
    super::booking_group_id(pool, booking_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Booking is not part of a group".to_string()))
}

/// Run a group action for the group that `booking_id` belongs to. The caller
/// (route) has already enforced `bookings:update`, the same permission the
/// per-room void / check-in / update routes require.
pub async fn run_group_action(
    pool: &DbPool,
    user_id: i64,
    booking_id: i64,
    action: GroupAction,
    reason: Option<String>,
) -> Result<GroupActionResult, ApiError> {
    let group_id = group_id_for(pool, booking_id).await?;
    match action {
        GroupAction::Cancel | GroupAction::CheckIn => {
            run_in_one_tx(pool, user_id, group_id, action, reason).await
        }
        GroupAction::CheckOut => run_checkout(pool, user_id, group_id).await,
    }
}

async fn run_in_one_tx(
    pool: &DbPool,
    user_id: i64,
    group_id: i64,
    action: GroupAction,
    reason: Option<String>,
) -> Result<GroupActionResult, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::from)?;
    BookingGroupRepository::lock_tx(&mut tx, group_id).await?;
    // Plan from the statuses read under the lock.
    let rooms: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, COALESCE(status, 'pending') FROM bookings WHERE booking_group_id = $1 ORDER BY id FOR UPDATE",
    )
    .bind(group_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(ApiError::from)?;
    let (targets, skipped) = plan_group_action(action, &rooms)?;

    for id in &targets {
        // Read inside the tx so each room sees the earlier rooms' writes.
        let booking = super::repository::BookingRepository::find_mapped_by_id(&mut *tx, *id)
            .await?
            .ok_or_else(|| ApiError::NotFound("Booking not found".to_string()))?;
        match action {
            GroupAction::Cancel => {
                let reason = reason.as_deref().or(Some("Group cancelled"));
                void_booking_in_tx(&mut tx, user_id, &booking, reason).await?;
            }
            GroupAction::CheckIn => {
                checkin_booking_in_tx(
                    &mut tx,
                    user_id,
                    booking,
                    None,
                    CheckinSourceContext::manual(),
                )
                .await
                .map_err(|e| room_error(*id, e))?;
            }
            GroupAction::CheckOut => unreachable!(),
        }
    }
    BookingGroupRepository::refresh_totals_tx(&mut tx, group_id).await?;
    tx.commit().await.map_err(ApiError::from)?;

    // Post-commit auxiliary work, exactly as the per-room services do it.
    for id in &targets {
        match action {
            GroupAction::Cancel => {
                if let Err(err) = crate::modules::loyalty::service::reverse_booking_points(
                    pool,
                    *id,
                    Some(user_id),
                    "Booking voided",
                )
                .await
                {
                    log::warn!("Failed to reverse loyalty points for voided booking {id}: {err}");
                }
            }
            GroupAction::CheckIn => {
                if let Err(e) =
                    crate::modules::night_audit::service::backfill_booking_posted_nights(
                        pool, *id, user_id,
                    )
                    .await
                {
                    log::warn!("Failed to backfill posted nights for booking {id}: {e}");
                }
            }
            GroupAction::CheckOut => {}
        }
    }

    Ok(GroupActionResult {
        booking_group_id: group_id,
        action: action.name(),
        processed: targets,
        skipped,
    })
}

fn room_error(booking_id: i64, err: ApiError) -> ApiError {
    match err {
        ApiError::BadRequest(msg) => ApiError::BadRequest(format!(
            "Booking {booking_id}: {msg} No rooms were changed."
        )),
        other => other,
    }
}

async fn run_checkout(
    pool: &DbPool,
    user_id: i64,
    group_id: i64,
) -> Result<GroupActionResult, ApiError> {
    let rooms = group_rooms(pool, group_id).await?;
    let (targets, skipped) = plan_group_action(GroupAction::CheckOut, &rooms)?;

    // Preflight: the same balance/deposit guard the per-room checkout applies,
    // for every room, before any room is touched.
    let checkout_input = BookingUpdateInput {
        status: Some("checked_out".to_string()),
        ..Default::default()
    };
    for id in &targets {
        let booking = booking_service::fetch_booking_by_id(pool, *id).await?;
        let billable_total =
            crate::modules::payments::repository::PaymentRepository::workflow_summary_row(
                pool, *id,
            )
            .await?
            .map(|s| s.billable_total())
            .unwrap_or(booking.total_amount);
        super::lifecycle::ensure_checkout_balance_resolved(
            pool,
            *id,
            &booking,
            &checkout_input,
            "checked_out",
            billable_total,
        )
        .await
        .map_err(|e| match e {
            ApiError::BadRequest(msg) => ApiError::BadRequest(format!(
                "Booking {}: {msg} No rooms were checked out.",
                booking.booking_number
            )),
            other => other,
        })?;
    }

    let mut done = Vec::new();
    for id in &targets {
        let input = BookingUpdateInput {
            status: Some("checked_out".to_string()),
            ..Default::default()
        };
        if let Err(e) = super::lifecycle::update_booking_handler(
            State(pool.clone()),
            Extension(user_id),
            Path(*id),
            Json(input),
        )
        .await
        {
            if done.is_empty() {
                return Err(e);
            }
            return Err(ApiError::BadRequest(format!(
                "Checked out bookings {done:?}, then booking {id} failed: {e}. Check out the remaining rooms individually."
            )));
        }
        done.push(*id);
    }

    Ok(GroupActionResult {
        booking_group_id: group_id,
        action: GroupAction::CheckOut.name(),
        processed: done,
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rooms(list: &[&str]) -> Vec<(i64, String)> {
        list.iter()
            .enumerate()
            .map(|(i, s)| (i as i64 + 1, s.to_string()))
            .collect()
    }

    #[test]
    fn cancel_refuses_when_a_room_is_in_house() {
        assert!(
            plan_group_action(GroupAction::Cancel, &rooms(&["confirmed", "checked_in"])).is_err()
        );
    }

    #[test]
    fn cancel_ignores_voided_rooms() {
        let (t, s) = plan_group_action(
            GroupAction::Cancel,
            &rooms(&["confirmed", "voided", "pending"]),
        )
        .unwrap();
        assert_eq!(t, vec![1, 3]);
        assert!(s.is_empty());
    }

    #[test]
    fn checkin_skips_rooms_already_in_house() {
        let (t, s) =
            plan_group_action(GroupAction::CheckIn, &rooms(&["checked_in", "confirmed"])).unwrap();
        assert_eq!(t, vec![2]);
        assert_eq!(s[0].booking_id, 1);
    }

    #[test]
    fn checkout_targets_in_house_rooms_only() {
        let (t, s) = plan_group_action(
            GroupAction::CheckOut,
            &rooms(&["checked_in", "confirmed", "late_checkout"]),
        )
        .unwrap();
        assert_eq!(t, vec![1, 3]);
        assert_eq!(s.len(), 1);
        assert!(plan_group_action(GroupAction::CheckOut, &rooms(&["confirmed"])).is_err());
    }
}
