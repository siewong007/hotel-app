//! Re-splitting a group's fixed-amount voucher when its rooms change.
//!
//! A fixed voucher is split once at checkout (`prorate_fixed_discount`) and
//! each room's share is stored on the room as `bookings.group_voucher_share`.
//! When a room later leaves the group the rules are:
//!
//! * A share already **frozen** stays where it is: a room that is paid (or has
//!   money in flight) or has arrived is never re-priced.
//! * A removed **unpaid** room's share moves to the rooms that are still
//!   unpaid, pro-rata by what each still owes, in cents (the same
//!   `prorate_fixed_discount` used at checkout, so the moved cents sum
//!   exactly). It is capped at what those rooms still owe, so no room goes
//!   negative; anything left over is dropped, never carried elsewhere.
//! * A removed **paid** room's share is dropped: the other rooms are never
//!   charged more because a paid room left.
//! * A room added later never takes a share (it is created at list price).
//!
//! Callers hold the group lock ([`BookingGroupRepository::lock_tx`]) for the
//! whole transaction, taken before any booking row, which is the order every
//! payment and cancel path already uses.

use rust_decimal::Decimal;
use serde_json::json;

use super::allocation::prorate_fixed_discount;
use crate::core::db::DbTransaction;
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::services::audit::AuditLog;

/// Booking statuses meaning the guest has arrived (or the stay is over).
pub const ARRIVED_STATUSES: &[&str] =
    &["checked_in", "auto_checked_in", "checked_out", "completed"];

/// Whether a room's voucher share is frozen: it is paid in any part, has a
/// payment that is completed or still in flight, or the guest has arrived.
pub fn share_is_frozen(status: &str, payment_status: &str, has_live_payment: bool) -> bool {
    ARRIVED_STATUSES.contains(&status)
        || !matches!(payment_status, "unpaid" | "unpaid_deposit" | "void" | "")
        || has_live_payment
}

/// Extra voucher discount for each still-unpaid room when `released` leaves a
/// removed room. `owed` is what each recipient still owes before tax; the
/// result never exceeds it (no room goes negative) and sums to
/// `min(released, Σ owed)` exactly. Whatever does not fit is dropped.
pub fn redistribute(released: Decimal, owed: &[Decimal]) -> Vec<Decimal> {
    prorate_fixed_discount(released, owed)
}

/// What [`release_room_share_tx`] did, for tests and the audit trail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShareRelease {
    /// The room had no share, no group, or the voucher is not a fixed amount.
    Nothing,
    /// The room's share was frozen (paid/arrived), so it is simply dropped.
    Dropped { share: Decimal },
    /// The share moved to these rooms; `dropped` is what did not fit.
    Moved {
        share: Decimal,
        moves: Vec<(i64, Decimal)>,
        dropped: Decimal,
    },
}

/// Release the voucher share of a room that is about to leave its group.
///
/// Call inside the removal transaction, after the group lock and *before* the
/// room's payments are voided (the frozen check reads them). A no-op for
/// rooms outside a group or without a fixed-voucher share.
pub async fn release_room_share_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    actor_user_id: Option<i64>,
) -> Result<ShareRelease, ApiError> {
    let row: Option<(Option<i64>, Decimal, String, String, bool)> = sqlx::query_as(
        r#"
        SELECT b.booking_group_id, b.group_voucher_share, COALESCE(b.status, 'pending'),
               COALESCE(b.payment_status::text, 'unpaid'),
               EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id
                       AND p.status IN ('pending', 'processing', 'completed', 'refunded'))
        FROM bookings b WHERE b.id = $1
        "#,
    )
    .bind(booking_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::from)?;
    let Some((Some(group_id), share, status, payment_status, has_payment)) = row else {
        return Ok(ShareRelease::Nothing);
    };
    if share <= Decimal::ZERO
        || status == "voided"
        || !group_voucher_is_fixed_tx(tx, group_id).await?
    {
        return Ok(ShareRelease::Nothing);
    }
    if share_is_frozen(&status, &payment_status, has_payment) {
        audit_tx(tx, actor_user_id, group_id, booking_id, share, &[], share).await?;
        return Ok(ShareRelease::Dropped { share });
    }

    // Recipients: live rooms that are still entirely unpaid, with no payment
    // in flight and no arrival. Locked in id order.
    let recipients: Vec<(i64, Decimal)> = sqlx::query_as(
        r#"
        SELECT b.id, GREATEST(COALESCE(b.total_amount, 0), 0) FROM bookings b
        WHERE b.booking_group_id = $1 AND b.id <> $2
          AND COALESCE(b.status, 'pending') NOT IN
              ('voided', 'checked_in', 'auto_checked_in', 'checked_out', 'completed', 'no_show')
          AND COALESCE(b.payment_status::text, 'unpaid') IN ('unpaid', 'unpaid_deposit')
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id
                          AND p.status IN ('pending', 'processing', 'completed', 'refunded'))
        ORDER BY b.id
        FOR UPDATE OF b
        "#,
    )
    .bind(group_id)
    .bind(booking_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::from)?;
    let owed: Vec<Decimal> = recipients.iter().map(|(_, owed)| *owed).collect();
    let extras = redistribute(share, &owed);

    // The removed room gives its share up (it is voided right after).
    sqlx::query("UPDATE bookings SET group_voucher_share = 0 WHERE id = $1")
        .bind(booking_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
    shift_allocations_tx(tx, booking_id, -share).await?;

    let mut moves = Vec::new();
    for ((recipient_id, _), extra) in recipients.iter().zip(&extras) {
        if extra.is_zero() {
            continue;
        }
        sqlx::query(
            r#"
            UPDATE bookings SET
                group_voucher_share = group_voucher_share + $2,
                discount_amount = COALESCE(discount_amount, 0) + $2,
                total_amount = total_amount - $2,
                net_revenue = CASE WHEN net_revenue IS NULL THEN NULL ELSE net_revenue - $2 END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            "#,
        )
        .bind(recipient_id)
        .bind(extra)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        shift_allocations_tx(tx, *recipient_id, *extra).await?;
        moves.push((*recipient_id, *extra));
    }
    let moved: Decimal = moves.iter().map(|(_, amount)| *amount).sum();
    let dropped = share - moved;
    audit_tx(
        tx,
        actor_user_id,
        group_id,
        booking_id,
        share,
        &moves,
        dropped,
    )
    .await?;
    Ok(ShareRelease::Moved {
        share,
        moves,
        dropped,
    })
}

async fn group_voucher_is_fixed_tx(
    tx: &mut DbTransaction<'_>,
    group_id: i64,
) -> Result<bool, ApiError> {
    let kind: Option<String> = sqlx::query_scalar(
        r#"
        SELECT p.discount_type::text FROM booking_groups g
        JOIN vouchers v ON v.id = g.voucher_id
        JOIN promotions p ON p.id = v.promotion_id
        WHERE g.id = $1
        "#,
    )
    .bind(group_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::from)?;
    // Promotions store `percentage` or `fixed_amount`; like checkout
    // (`group_voucher_shares`), anything not a percentage is a fixed amount.
    Ok(kind.is_some_and(|kind| kind != "percentage"))
}

/// Move `delta` of voucher discount on/off a room's per-night voucher
/// allocation rows (the redemption record), keeping each row within
/// `0 ..= gross`, then re-total the redemption. Positive deltas fill the
/// nights with the most room left first; negative deltas come off the
/// partly discounted nights first, so nights fully covered by credits are
/// touched last.
async fn shift_allocations_tx(
    tx: &mut DbTransaction<'_>,
    booking_id: i64,
    delta: Decimal,
) -> Result<(), ApiError> {
    if delta.is_zero() {
        return Ok(());
    }
    let rows: Vec<(i64, i64, Decimal, Decimal)> = sqlx::query_as(
        "SELECT id, redemption_id, gross_amount, discount_amount \
         FROM voucher_redemption_allocations WHERE booking_id = $1 \
         ORDER BY stay_date, id FOR UPDATE",
    )
    .bind(booking_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::from)?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut order: Vec<usize> = (0..rows.len()).collect();
    if delta > Decimal::ZERO {
        order.sort_by(|a, b| {
            (rows[*b].2 - rows[*b].3)
                .cmp(&(rows[*a].2 - rows[*a].3))
                .then(a.cmp(b))
        });
    } else {
        order.sort_by_key(|index| (rows[*index].3 >= rows[*index].2, *index));
    }
    let mut left = delta.abs();
    let mut redemptions = std::collections::BTreeSet::new();
    for index in order {
        if left.is_zero() {
            break;
        }
        let (id, redemption_id, gross, discount) = rows[index];
        let room = if delta > Decimal::ZERO {
            gross - discount
        } else {
            discount
        };
        let step = left.min(room.max(Decimal::ZERO));
        if step.is_zero() {
            continue;
        }
        let new_discount = if delta > Decimal::ZERO {
            discount + step
        } else {
            discount - step
        };
        sqlx::query(
            "UPDATE voucher_redemption_allocations SET discount_amount = $2, net_amount = gross_amount - $2 WHERE id = $1",
        )
        .bind(id)
        .bind(new_discount)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
        redemptions.insert(redemption_id);
        left -= step;
    }
    for redemption_id in redemptions {
        sqlx::query(
            r#"
            UPDATE voucher_redemptions r SET
                discount_amount = s.discount, net_total = s.gross - s.discount
            FROM (SELECT SUM(gross_amount) AS gross, SUM(discount_amount) AS discount
                  FROM voucher_redemption_allocations WHERE redemption_id = $1) s
            WHERE r.id = $1
            "#,
        )
        .bind(redemption_id)
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;
    }
    Ok(())
}

async fn audit_tx(
    tx: &mut DbTransaction<'_>,
    actor_user_id: Option<i64>,
    group_id: i64,
    booking_id: i64,
    share: Decimal,
    moves: &[(i64, Decimal)],
    dropped: Decimal,
) -> Result<(), ApiError> {
    AuditLog::log_event_tx(
        tx,
        AuditEvent {
            user_id: actor_user_id,
            action: "booking_group.voucher_resplit",
            resource_type: "booking_group",
            resource_id: Some(group_id),
            details: Some(json!({
                "removed_booking_id": booking_id,
                "share": share.to_string(),
                "moved": moves.iter().map(|(id, amount)| json!({
                    "booking_id": id, "amount": amount.to_string()
                })).collect::<Vec<_>>(),
                "dropped": dropped.to_string(),
            })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(value: &str) -> Decimal {
        value.parse().unwrap()
    }

    #[test]
    fn paid_or_arrived_rooms_are_frozen() {
        assert!(share_is_frozen("confirmed", "paid", false));
        assert!(share_is_frozen("confirmed", "partial", false));
        assert!(share_is_frozen("pending_confirmation", "unpaid", true));
        assert!(share_is_frozen("checked_in", "unpaid", false));
        assert!(share_is_frozen("auto_checked_in", "unpaid", false));
        assert!(!share_is_frozen("pending_payment", "unpaid", false));
        assert!(!share_is_frozen("confirmed", "unpaid", false));
    }

    #[test]
    fn released_share_splits_in_cents_and_sums_exactly() {
        let extras = redistribute(d("33.33"), &[d("100"), d("100"), d("100")]);
        assert_eq!(extras.iter().copied().sum::<Decimal>(), d("33.33"));
        assert!(extras.iter().all(|x| x.scale() <= 2));
    }

    #[test]
    fn released_share_is_capped_at_what_is_still_owed() {
        // 50 released, but the rooms only owe 10 + 5: nobody goes negative,
        // and the 35 that does not fit is dropped.
        let extras = redistribute(d("50"), &[d("10"), d("5")]);
        assert_eq!(extras, vec![d("10"), d("5")]);
    }

    #[test]
    fn nothing_to_receive_drops_the_share() {
        assert!(redistribute(d("40"), &[]).is_empty());
        assert_eq!(redistribute(d("40"), &[d("0")]), vec![d("0")]);
    }
}
