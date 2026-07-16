//! Public API coverage for promotion money calculations.

use hotel_app_be::services::promotion_pricing::{
    PromotionDiscount, PromotionPricing, calculate_promotion_pricing,
};
use rust_decimal::Decimal;

fn assert_reconciled(pricing: &PromotionPricing) {
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
        night.discount >= Decimal::ZERO
            && night.discount <= night.gross
            && night.net >= Decimal::ZERO
            && night.gross - night.discount == night.net
    }));
}

#[test]
fn percentage_rounding_is_reconciled_by_a_deterministic_last_night_residual() {
    let pricing = calculate_promotion_pricing(
        &[Decimal::new(1, 2), Decimal::new(2, 2), Decimal::new(3, 2)],
        PromotionDiscount::percentage(Decimal::from(50), None),
        2,
    )
    .expect("pricing should succeed");

    assert_eq!(pricing.gross, Decimal::new(6, 2));
    assert_eq!(pricing.discount, Decimal::new(3, 2));
    assert_eq!(pricing.net, Decimal::new(3, 2));
    assert_eq!(
        pricing
            .nights
            .iter()
            .map(|night| night.discount)
            .collect::<Vec<_>>(),
        vec![Decimal::ZERO, Decimal::new(1, 2), Decimal::new(2, 2)]
    );
    assert_reconciled(&pricing);
}

#[test]
fn rounded_inputs_and_fixed_discounts_cannot_create_negative_nightly_nets() {
    let pricing = calculate_promotion_pricing(
        &[
            Decimal::new(10_004, 3),
            Decimal::new(10_005, 3),
            Decimal::ZERO,
        ],
        PromotionDiscount::fixed(Decimal::from(99), None),
        2,
    )
    .expect("pricing should succeed");

    // Inputs round to 10.00 and 10.01 before the discount is bounded by the
    // stay gross. The free night must remain exactly free rather than taking a
    // negative allocation.
    assert_eq!(pricing.gross, Decimal::new(2_001, 2));
    assert_eq!(pricing.discount, Decimal::new(2_001, 2));
    assert_eq!(pricing.net, Decimal::ZERO);
    assert_eq!(pricing.nights[0].discount, Decimal::new(1_000, 2));
    assert_eq!(pricing.nights[1].discount, Decimal::new(1_001, 2));
    assert_eq!(pricing.nights[2].discount, Decimal::ZERO);
    assert_reconciled(&pricing);
}

#[test]
fn discount_caps_apply_before_allocation_and_preserve_every_night_total() {
    let pricing = calculate_promotion_pricing(
        &[Decimal::from(80), Decimal::from(20)],
        PromotionDiscount::percentage(Decimal::from(50), Some(Decimal::from(25))),
        2,
    )
    .expect("pricing should succeed");

    assert_eq!(pricing.gross, Decimal::from(100));
    assert_eq!(pricing.discount, Decimal::from(25));
    assert_eq!(pricing.net, Decimal::from(75));
    assert_eq!(pricing.nights[0].discount, Decimal::from(20));
    assert_eq!(pricing.nights[1].discount, Decimal::from(5));
    assert_reconciled(&pricing);
}
