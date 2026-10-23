//! Pure money-splitting rules for multi-room bookings. Decided once at
//! creation; each room's share is then persisted on its own booking.

use chrono::NaiveDate;
use rust_decimal::Decimal;

/// Room types locked in a fixed (ascending, de-duplicated) order so two
/// concurrent group checkouts can never deadlock on each other's locks.
pub fn room_type_lock_order(room_type_ids: &[i64]) -> Vec<i64> {
    let mut ids = room_type_ids.to_vec();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// Split a group-level fixed discount across rooms pro-rata by room subtotal.
///
/// Shares are rounded to cents; the rounding remainder goes to the room(s)
/// with the largest subtotal (lowest index on ties) so the shares always sum
/// to `min(discount, Σ subtotals)` exactly. No room's share exceeds its own
/// subtotal and negative inputs are treated as zero.
pub fn prorate_fixed_discount(discount: Decimal, subtotals: &[Decimal]) -> Vec<Decimal> {
    let subtotals: Vec<Decimal> = subtotals.iter().map(|s| (*s).max(Decimal::ZERO)).collect();
    let total: Decimal = subtotals.iter().copied().sum();
    let discount = discount.max(Decimal::ZERO).min(total).round_dp(2);
    if subtotals.is_empty() || total.is_zero() || discount.is_zero() {
        return vec![Decimal::ZERO; subtotals.len()];
    }
    let mut shares: Vec<Decimal> = subtotals
        .iter()
        .map(|subtotal| {
            (discount * *subtotal / total)
                .round_dp_with_strategy(2, rust_decimal::RoundingStrategy::ToZero)
        })
        .collect();
    let mut remainder = discount - shares.iter().copied().sum::<Decimal>();
    let cent = Decimal::new(1, 2);
    let mut order: Vec<usize> = (0..subtotals.len()).collect();
    order.sort_by(|a, b| subtotals[*b].cmp(&subtotals[*a]).then(a.cmp(b)));
    while remainder >= cent {
        let mut placed = false;
        for &index in &order {
            if remainder < cent {
                break;
            }
            if shares[index] + cent <= subtotals[index] {
                shares[index] += cent;
                remainder -= cent;
                placed = true;
            }
        }
        if !placed {
            break;
        }
    }
    shares
}

/// One night of one room in the cart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomNight {
    pub room_index: usize,
    pub date: NaiveDate,
    pub amount: Decimal,
}

/// Default complimentary-credit placement: one credit settles one room-night,
/// cheapest room-nights first (ties: earlier room, then earlier date). Returns
/// the chosen dates per room index (`room_count` entries, each sorted).
pub fn default_credit_assignment(
    credits: usize,
    nights: &[RoomNight],
    room_count: usize,
) -> Vec<Vec<NaiveDate>> {
    let mut sorted: Vec<&RoomNight> = nights
        .iter()
        .filter(|n| n.room_index < room_count)
        .collect();
    sorted.sort_by(|a, b| {
        a.amount
            .cmp(&b.amount)
            .then(a.room_index.cmp(&b.room_index))
            .then(a.date.cmp(&b.date))
    });
    let mut assignment = vec![Vec::new(); room_count];
    for night in sorted.into_iter().take(credits) {
        assignment[night.room_index].push(night.date);
    }
    for dates in &mut assignment {
        dates.sort_unstable();
    }
    assignment
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(value: &str) -> Decimal {
        value.parse().expect("decimal literal")
    }

    #[test]
    fn lock_order_is_sorted_and_unique() {
        assert_eq!(room_type_lock_order(&[7, 2, 7, 5]), vec![2, 5, 7]);
    }

    #[test]
    fn fixed_discount_is_prorated_and_sums_exactly() {
        let shares = prorate_fixed_discount(dec("100"), &[dec("200"), dec("100"), dec("100")]);
        assert_eq!(shares, vec![dec("50"), dec("25"), dec("25")]);

        let shares = prorate_fixed_discount(dec("10"), &[dec("100"), dec("100"), dec("100")]);
        assert_eq!(
            shares.iter().copied().sum::<rust_decimal::Decimal>(),
            dec("10")
        );
        assert_eq!(shares, vec![dec("3.34"), dec("3.33"), dec("3.33")]);
    }

    #[test]
    fn fixed_discount_never_exceeds_room_or_group_subtotal() {
        let shares = prorate_fixed_discount(dec("500"), &[dec("120"), dec("80")]);
        assert_eq!(shares, vec![dec("120"), dec("80")]);
        assert_eq!(
            prorate_fixed_discount(dec("50"), &[]),
            Vec::<rust_decimal::Decimal>::new()
        );
        assert_eq!(
            prorate_fixed_discount(dec("50"), &[dec("0")]),
            vec![dec("0")]
        );
    }

    #[test]
    fn credits_default_to_cheapest_room_nights() {
        let d = |day| NaiveDate::from_ymd_opt(2026, 11, day).unwrap();
        let nights = [
            RoomNight {
                room_index: 0,
                date: d(1),
                amount: dec("200"),
            },
            RoomNight {
                room_index: 0,
                date: d(2),
                amount: dec("250"),
            },
            RoomNight {
                room_index: 1,
                date: d(1),
                amount: dec("120"),
            },
            RoomNight {
                room_index: 1,
                date: d(2),
                amount: dec("150"),
            },
        ];
        assert_eq!(
            default_credit_assignment(3, &nights, 2),
            vec![vec![d(1)], vec![d(1), d(2)]]
        );
        assert_eq!(
            default_credit_assignment(0, &nights, 2),
            vec![vec![], vec![]]
        );
        assert_eq!(default_credit_assignment(9, &nights, 2).concat().len(), 4);
    }
}
