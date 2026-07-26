//! Pure promotion pricing calculations.
//!
//! This module deliberately has no database, route, or booking-lifecycle dependencies so a
//! future promotion workflow can use the same deterministic calculation for quotes and commits.

// Exercised end-to-end by tests/promotion_pricing.rs but not yet called from a
// production path. `main.rs` re-declares every module, so the bin recompiles this
// crate and reports the whole module dead even though the lib target's tests use it.
#![allow(dead_code)]

use rust_decimal::{Decimal, RoundingStrategy};
use thiserror::Error;

/// The monetary discount configured by a promotion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscountKind {
    /// A percentage of the rounded gross room amount, from 0 through 100 inclusive.
    Percentage { percentage: Decimal },
    /// A fixed monetary amount.
    Fixed { amount: Decimal },
}

/// Discount terms used by the pricing calculation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromotionDiscount {
    pub kind: DiscountKind,
    /// Optional monetary ceiling applied to either discount kind.
    pub cap: Option<Decimal>,
}

impl PromotionDiscount {
    pub const fn percentage(percentage: Decimal, cap: Option<Decimal>) -> Self {
        Self {
            kind: DiscountKind::Percentage { percentage },
            cap,
        }
    }

    pub const fn fixed(amount: Decimal, cap: Option<Decimal>) -> Self {
        Self {
            kind: DiscountKind::Fixed { amount },
            cap,
        }
    }
}

/// Promotion pricing for one night.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NightlyPromotionPricing {
    pub gross: Decimal,
    pub discount: Decimal,
    pub net: Decimal,
}

/// Promotion pricing for the whole stay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionPricing {
    pub gross: Decimal,
    pub discount: Decimal,
    pub net: Decimal,
    pub nights: Vec<NightlyPromotionPricing>,
    pub minor_units: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PromotionPricingError {
    #[error("at least one nightly gross amount is required")]
    NoNights,
    #[error("minor units {minor_units} exceed Decimal's maximum scale of {max_minor_units}")]
    InvalidMinorUnits {
        minor_units: u32,
        max_minor_units: u32,
    },
    #[error("nightly gross amount at index {index} cannot be negative: {amount}")]
    NegativeNightlyGross { index: usize, amount: Decimal },
    #[error("percentage must be between 0 and 100 inclusive: {percentage}")]
    InvalidPercentage { percentage: Decimal },
    #[error("fixed discount amount cannot be negative: {amount}")]
    NegativeFixedAmount { amount: Decimal },
    #[error("discount cap cannot be negative: {cap}")]
    NegativeCap { cap: Decimal },
    #[error("decimal arithmetic overflowed while calculating promotion pricing")]
    ArithmeticOverflow,
    #[error("promotion pricing invariant could not be satisfied")]
    InvariantViolation,
}

/// Calculates a promotion against nightly gross room amounts.
///
/// Monetary inputs and outputs are rounded to `minor_units` using midpoint-away-from-zero. The
/// stay discount is calculated first, then allocated proportionally across nights. Allocation is
/// truncated to minor units and the remaining minor-unit residual is assigned deterministically
/// from the final night backward. This guarantees that nightly totals reconcile with stay totals.
pub fn calculate_promotion_pricing(
    nightly_gross: &[Decimal],
    promotion: PromotionDiscount,
    minor_units: u32,
) -> Result<PromotionPricing, PromotionPricingError> {
    validate_inputs(nightly_gross, promotion, minor_units)?;

    let rounded_nightly_gross = nightly_gross
        .iter()
        .copied()
        .map(|gross| round_money(gross, minor_units))
        .collect::<Vec<_>>();
    let gross = checked_sum(rounded_nightly_gross.iter().copied())?;

    let uncapped_discount = match promotion.kind {
        DiscountKind::Percentage { percentage } => gross
            .checked_mul(percentage)
            .and_then(|value| value.checked_div(Decimal::ONE_HUNDRED))
            .ok_or(PromotionPricingError::ArithmeticOverflow)?,
        DiscountKind::Fixed { amount } => amount,
    };

    let capped_discount = match promotion.cap {
        Some(cap) => min_decimal(uncapped_discount, round_money(cap, minor_units)),
        None => uncapped_discount,
    };
    let discount = min_decimal(round_money(capped_discount, minor_units), gross);
    let nightly_discounts =
        allocate_discount(&rounded_nightly_gross, gross, discount, minor_units)?;

    let nights = rounded_nightly_gross
        .into_iter()
        .zip(nightly_discounts)
        .map(|(night_gross, night_discount)| {
            let net = night_gross
                .checked_sub(night_discount)
                .ok_or(PromotionPricingError::ArithmeticOverflow)?;
            Ok(NightlyPromotionPricing {
                gross: night_gross,
                discount: night_discount,
                net,
            })
        })
        .collect::<Result<Vec<_>, PromotionPricingError>>()?;

    let allocated_discount = checked_sum(nights.iter().map(|night| night.discount))?;
    let net = gross
        .checked_sub(discount)
        .ok_or(PromotionPricingError::ArithmeticOverflow)?;
    let allocated_net = checked_sum(nights.iter().map(|night| night.net))?;

    let nightly_invariants_hold = nights.iter().all(|night| {
        night.discount >= Decimal::ZERO
            && night.discount <= night.gross
            && night.net >= Decimal::ZERO
            && night.gross - night.discount == night.net
    });
    if discount > gross
        || allocated_discount != discount
        || allocated_net != net
        || gross - discount != net
        || !nightly_invariants_hold
    {
        return Err(PromotionPricingError::InvariantViolation);
    }

    Ok(PromotionPricing {
        gross,
        discount,
        net,
        nights,
        minor_units,
    })
}

fn validate_inputs(
    nightly_gross: &[Decimal],
    promotion: PromotionDiscount,
    minor_units: u32,
) -> Result<(), PromotionPricingError> {
    if minor_units > Decimal::MAX_SCALE {
        return Err(PromotionPricingError::InvalidMinorUnits {
            minor_units,
            max_minor_units: Decimal::MAX_SCALE,
        });
    }
    if nightly_gross.is_empty() {
        return Err(PromotionPricingError::NoNights);
    }
    if let Some((index, amount)) = nightly_gross
        .iter()
        .copied()
        .enumerate()
        .find(|(_, amount)| *amount < Decimal::ZERO)
    {
        return Err(PromotionPricingError::NegativeNightlyGross { index, amount });
    }

    match promotion.kind {
        DiscountKind::Percentage { percentage }
            if percentage < Decimal::ZERO || percentage > Decimal::ONE_HUNDRED =>
        {
            return Err(PromotionPricingError::InvalidPercentage { percentage });
        }
        DiscountKind::Fixed { amount } if amount < Decimal::ZERO => {
            return Err(PromotionPricingError::NegativeFixedAmount { amount });
        }
        _ => {}
    }

    if let Some(cap) = promotion.cap
        && cap < Decimal::ZERO
    {
        return Err(PromotionPricingError::NegativeCap { cap });
    }

    Ok(())
}

fn allocate_discount(
    nightly_gross: &[Decimal],
    gross: Decimal,
    discount: Decimal,
    minor_units: u32,
) -> Result<Vec<Decimal>, PromotionPricingError> {
    if discount == Decimal::ZERO || gross == Decimal::ZERO {
        return Ok(vec![Decimal::ZERO; nightly_gross.len()]);
    }

    let mut allocations = Vec::with_capacity(nightly_gross.len());
    for night_gross in nightly_gross {
        let proportional_share = discount
            .checked_mul(*night_gross)
            .and_then(|value| value.checked_div(gross))
            .ok_or(PromotionPricingError::ArithmeticOverflow)?;
        allocations.push(min_decimal(
            proportional_share.round_dp_with_strategy(minor_units, RoundingStrategy::ToZero),
            *night_gross,
        ));
    }

    let allocated = checked_sum(allocations.iter().copied())?;
    let mut residual = discount
        .checked_sub(allocated)
        .ok_or(PromotionPricingError::ArithmeticOverflow)?;

    for (allocation, night_gross) in allocations.iter_mut().zip(nightly_gross).rev() {
        if residual == Decimal::ZERO {
            break;
        }
        let available = night_gross
            .checked_sub(*allocation)
            .ok_or(PromotionPricingError::ArithmeticOverflow)?;
        let addition = min_decimal(residual, available);
        *allocation = allocation
            .checked_add(addition)
            .ok_or(PromotionPricingError::ArithmeticOverflow)?;
        residual = residual
            .checked_sub(addition)
            .ok_or(PromotionPricingError::ArithmeticOverflow)?;
    }

    if residual != Decimal::ZERO {
        return Err(PromotionPricingError::InvariantViolation);
    }

    Ok(allocations)
}

fn round_money(value: Decimal, minor_units: u32) -> Decimal {
    value.round_dp_with_strategy(minor_units, RoundingStrategy::MidpointAwayFromZero)
}

fn checked_sum(
    values: impl IntoIterator<Item = Decimal>,
) -> Result<Decimal, PromotionPricingError> {
    values.into_iter().try_fold(Decimal::ZERO, |sum, value| {
        sum.checked_add(value)
            .ok_or(PromotionPricingError::ArithmeticOverflow)
    })
}

fn min_decimal(left: Decimal, right: Decimal) -> Decimal {
    if left <= right { left } else { right }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_invariants(pricing: &PromotionPricing) {
        assert!(pricing.discount <= pricing.gross);
        assert_eq!(pricing.gross - pricing.discount, pricing.net);
        assert_eq!(
            pricing
                .nights
                .iter()
                .map(|night| night.gross)
                .sum::<Decimal>(),
            pricing.gross
        );
        assert_eq!(
            pricing
                .nights
                .iter()
                .map(|night| night.discount)
                .sum::<Decimal>(),
            pricing.discount
        );
        assert_eq!(
            pricing
                .nights
                .iter()
                .map(|night| night.net)
                .sum::<Decimal>(),
            pricing.net
        );
        assert!(pricing.nights.iter().all(|night| {
            night.discount <= night.gross
                && night.gross - night.discount == night.net
                && night.net >= Decimal::ZERO
        }));
    }

    #[test]
    fn calculates_percentage_discount_with_a_cap() {
        let pricing = calculate_promotion_pricing(
            &[Decimal::from(100), Decimal::from(100)],
            PromotionDiscount::percentage(Decimal::from(25), Some(Decimal::from(30))),
            2,
        )
        .expect("pricing should succeed");

        assert_eq!(pricing.gross, Decimal::from(200));
        assert_eq!(pricing.discount, Decimal::from(30));
        assert_eq!(pricing.net, Decimal::from(170));
        assert_eq!(pricing.nights[0].discount, Decimal::from(15));
        assert_eq!(pricing.nights[1].discount, Decimal::from(15));
        assert_invariants(&pricing);
    }

    #[test]
    fn calculates_fixed_discount_with_a_cap() {
        let pricing = calculate_promotion_pricing(
            &[Decimal::from(80), Decimal::from(20)],
            PromotionDiscount::fixed(Decimal::from(50), Some(Decimal::from(20))),
            2,
        )
        .expect("pricing should succeed");

        assert_eq!(pricing.discount, Decimal::from(20));
        assert_eq!(pricing.nights[0].discount, Decimal::from(16));
        assert_eq!(pricing.nights[1].discount, Decimal::from(4));
        assert_invariants(&pricing);
    }

    #[test]
    fn caps_discount_at_the_gross_amount() {
        let pricing = calculate_promotion_pricing(
            &[Decimal::from(40), Decimal::from(60)],
            PromotionDiscount::fixed(Decimal::from(500), None),
            2,
        )
        .expect("pricing should succeed");

        assert_eq!(pricing.discount, Decimal::from(100));
        assert_eq!(pricing.net, Decimal::ZERO);
        assert_eq!(pricing.nights[0].discount, Decimal::from(40));
        assert_eq!(pricing.nights[1].discount, Decimal::from(60));
        assert_invariants(&pricing);
    }

    #[test]
    fn assigns_fixed_allocation_residual_to_the_last_night() {
        let pricing = calculate_promotion_pricing(
            &[
                Decimal::new(3_333, 2),
                Decimal::new(3_333, 2),
                Decimal::new(3_334, 2),
            ],
            PromotionDiscount::fixed(Decimal::from(10), None),
            2,
        )
        .expect("pricing should succeed");

        assert_eq!(
            pricing
                .nights
                .iter()
                .map(|night| night.discount)
                .collect::<Vec<_>>(),
            vec![
                Decimal::new(333, 2),
                Decimal::new(333, 2),
                Decimal::new(334, 2)
            ]
        );
        assert_eq!(pricing.nights[0].net, Decimal::from(30));
        assert_eq!(pricing.nights[1].net, Decimal::from(30));
        assert_eq!(pricing.nights[2].net, Decimal::from(30));
        assert_invariants(&pricing);
    }

    #[test]
    fn rounds_the_stay_discount_before_allocating_it() {
        let pricing = calculate_promotion_pricing(
            &[Decimal::new(5, 2), Decimal::new(5, 2), Decimal::new(5, 2)],
            PromotionDiscount::percentage(Decimal::from(10), None),
            2,
        )
        .expect("pricing should succeed");

        assert_eq!(pricing.gross, Decimal::new(15, 2));
        assert_eq!(pricing.discount, Decimal::new(2, 2));
        assert_eq!(pricing.nights[0].discount, Decimal::ZERO);
        assert_eq!(pricing.nights[1].discount, Decimal::ZERO);
        assert_eq!(pricing.nights[2].discount, Decimal::new(2, 2));
        assert_invariants(&pricing);
    }

    #[test]
    fn honors_zero_minor_unit_rounding() {
        let pricing = calculate_promotion_pricing(
            &[Decimal::new(150, 2)],
            PromotionDiscount::fixed(Decimal::new(50, 2), None),
            0,
        )
        .expect("pricing should succeed");

        assert_eq!(pricing.gross, Decimal::from(2));
        assert_eq!(pricing.discount, Decimal::from(1));
        assert_eq!(pricing.net, Decimal::from(1));
        assert_invariants(&pricing);
    }

    #[test]
    fn zero_gross_produces_zero_discount_and_net() {
        let pricing = calculate_promotion_pricing(
            &[Decimal::ZERO, Decimal::ZERO],
            PromotionDiscount::fixed(Decimal::from(10), None),
            2,
        )
        .expect("pricing should succeed");

        assert_eq!(pricing.gross, Decimal::ZERO);
        assert_eq!(pricing.discount, Decimal::ZERO);
        assert_eq!(pricing.net, Decimal::ZERO);
        assert_invariants(&pricing);
    }

    #[test]
    fn validates_invalid_inputs() {
        assert_eq!(
            calculate_promotion_pricing(&[], PromotionDiscount::fixed(Decimal::ONE, None), 2),
            Err(PromotionPricingError::NoNights)
        );
        assert_eq!(
            calculate_promotion_pricing(
                &[Decimal::NEGATIVE_ONE],
                PromotionDiscount::fixed(Decimal::ONE, None),
                2
            ),
            Err(PromotionPricingError::NegativeNightlyGross {
                index: 0,
                amount: Decimal::NEGATIVE_ONE,
            })
        );
        assert_eq!(
            calculate_promotion_pricing(
                &[Decimal::ONE],
                PromotionDiscount::percentage(Decimal::new(10_001, 2), None),
                2
            ),
            Err(PromotionPricingError::InvalidPercentage {
                percentage: Decimal::new(10_001, 2),
            })
        );
        assert_eq!(
            calculate_promotion_pricing(
                &[Decimal::ONE],
                PromotionDiscount::fixed(Decimal::NEGATIVE_ONE, None),
                2
            ),
            Err(PromotionPricingError::NegativeFixedAmount {
                amount: Decimal::NEGATIVE_ONE,
            })
        );
        assert_eq!(
            calculate_promotion_pricing(
                &[Decimal::ONE],
                PromotionDiscount::fixed(Decimal::ONE, Some(Decimal::NEGATIVE_ONE)),
                2
            ),
            Err(PromotionPricingError::NegativeCap {
                cap: Decimal::NEGATIVE_ONE,
            })
        );
        assert_eq!(
            calculate_promotion_pricing(
                &[Decimal::ONE],
                PromotionDiscount::fixed(Decimal::ONE, None),
                Decimal::MAX_SCALE + 1
            ),
            Err(PromotionPricingError::InvalidMinorUnits {
                minor_units: Decimal::MAX_SCALE + 1,
                max_minor_units: Decimal::MAX_SCALE,
            })
        );
    }

    #[test]
    fn returns_an_error_when_gross_sum_overflows() {
        assert_eq!(
            calculate_promotion_pricing(
                &[Decimal::MAX, Decimal::ONE],
                PromotionDiscount::fixed(Decimal::ONE, None),
                2
            ),
            Err(PromotionPricingError::ArithmeticOverflow)
        );
    }
}
