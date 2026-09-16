//! Pure channel-pricing calculations.
//!
//! One deterministic resolver shared by the guest-portal quote, staff booking
//! writes, the preview endpoint, and the pricing matrix. No database or route
//! dependencies — callers map rows into the plain model structs and the engine
//! returns prices, commission, and the snapshot payload a booking persists.
//!
//! Resolution order per stay night:
//!   source rate (caller's existing pipeline output)
//!   → winning channel pricing rule
//!   → min/max clamp → 2dp rounding
//! Promotions then discount the payable nights (existing engine), and the
//! commission is computed on the discounted room revenue.

use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::{Value, json};

use super::models::{ChannelCommissionRule, ChannelPricingRule};

/// Recognized `channel_pricing_rules.rule_type` values.
pub const RULE_TYPES: &[&str] = &[
    "markup_percent",
    "markup_fixed",
    "discount_percent",
    "fixed_price",
    "net_rate",
];

/// Dimension weight: a room-scoped rule outranks a plan-scoped rule at equal
/// priority because inventory is the more concrete axis.
fn specificity(rule: &ChannelPricingRule) -> i32 {
    i32::from(rule.room_type_id.is_some()) * 2 + i32::from(rule.rate_plan_id.is_some())
}

/// True when `rule` governs `date` for this room type / rate plan.
pub fn rule_applies(
    rule: &ChannelPricingRule,
    date: NaiveDate,
    room_type_id: i64,
    rate_plan_id: Option<i64>,
) -> bool {
    rule.is_active
        && rule.effective_from <= date
        && rule.effective_to.is_none_or(|to| date <= to)
        && rule.room_type_id.is_none_or(|id| id == room_type_id)
        && rule.rate_plan_id.is_none_or(|id| Some(id) == rate_plan_id)
}

/// The single winning rule for one night, or `None` when the channel sells at
/// the source rate. Order: priority DESC → specificity DESC → newest first.
pub fn select_rule(
    rules: &[ChannelPricingRule],
    date: NaiveDate,
    room_type_id: i64,
    rate_plan_id: Option<i64>,
) -> Option<&ChannelPricingRule> {
    rules
        .iter()
        .filter(|rule| rule_applies(rule, date, room_type_id, rate_plan_id))
        .max_by_key(|rule| (rule.priority, specificity(rule), rule.created_at, rule.id))
}

/// Clamp to the rule's guardrails and normalize to 2dp; never below zero.
fn clamp_and_round(amount: Decimal, rule: &ChannelPricingRule) -> Decimal {
    let mut price = amount;
    if let Some(min) = rule.min_price {
        price = price.max(min);
    }
    if let Some(max) = rule.max_price {
        price = price.min(max);
    }
    price.max(Decimal::ZERO).round_dp(2)
}

/// One night after the winning channel rule.
#[derive(Debug, Clone, PartialEq)]
pub struct PricedNight {
    pub date: NaiveDate,
    pub source_rate: Decimal,
    /// Guest-facing nightly price; `None` under a net-rate rule (the channel
    /// manages its own sell price).
    pub selling_price: Option<Decimal>,
    /// Nightly net amount under a net-rate rule.
    pub net_rate: Option<Decimal>,
    pub rule_id: Option<i64>,
    pub rule_label: String,
}

/// Apply `rule` to `source_rate`. Returns `PricedNight` minus the date/rule id
/// wiring handled by [`price_night`].
pub fn apply_rule(
    source_rate: Decimal,
    rule: &ChannelPricingRule,
) -> (Option<Decimal>, Option<Decimal>) {
    match rule.rule_type.as_str() {
        "markup_percent" => (
            Some(clamp_and_round(
                source_rate * (Decimal::ONE + rule.value / Decimal::new(100, 0)),
                rule,
            )),
            None,
        ),
        "markup_fixed" => (Some(clamp_and_round(source_rate + rule.value, rule)), None),
        "discount_percent" => (
            Some(clamp_and_round(
                source_rate * (Decimal::ONE - rule.value / Decimal::new(100, 0)),
                rule,
            )),
            None,
        ),
        "fixed_price" => (Some(clamp_and_round(rule.value, rule)), None),
        "net_rate" => (None, Some(clamp_and_round(rule.value, rule))),
        _ => (Some(source_rate.round_dp(2)), None),
    }
}

/// Human-readable label for a rule (`"markup +10%"`, `"net rate"`), or `"BASE"`.
pub fn rule_label(rule: &ChannelPricingRule) -> String {
    match rule.rule_type.as_str() {
        "markup_percent" => format!("markup +{}%", rule.value.normalize()),
        "markup_fixed" => format!("markup +{}", rule.value.normalize()),
        "discount_percent" => format!("discount -{}%", rule.value.normalize()),
        "fixed_price" => format!("fixed {}", rule.value.normalize()),
        "net_rate" => "net rate".to_string(),
        _ => rule.rule_type.clone(),
    }
}

/// Resolve one stay night through the channel's rules.
pub fn price_night(
    date: NaiveDate,
    source_rate: Decimal,
    rules: &[ChannelPricingRule],
    room_type_id: i64,
    rate_plan_id: Option<i64>,
) -> PricedNight {
    match select_rule(rules, date, room_type_id, rate_plan_id) {
        Some(rule) => {
            let (selling_price, net_rate) = apply_rule(source_rate, rule);
            PricedNight {
                date,
                source_rate: source_rate.round_dp(2),
                selling_price,
                net_rate,
                rule_id: Some(rule.id),
                rule_label: rule_label(rule),
            }
        }
        None => PricedNight {
            date,
            source_rate: source_rate.round_dp(2),
            selling_price: Some(source_rate.round_dp(2)),
            net_rate: None,
            rule_id: None,
            rule_label: "BASE".to_string(),
        },
    }
}

/// The commission configuration resolved for a stay: a dated commission rule
/// covering `as_of` (priority DESC → newest first) beats the channel default.
#[derive(Debug, Clone, PartialEq)]
pub struct CommissionConfig {
    pub commission_type: String,
    pub value: Decimal,
    pub scope: String,
}

/// Commission owed for `base` (the room revenue actually charged) over
/// `nights`. Percentage applies to the base; fixed amounts honor their scope.
pub fn commission_amount(config: &CommissionConfig, base: Decimal, nights: i64) -> Decimal {
    match config.commission_type.as_str() {
        "percentage" => (base * config.value / Decimal::new(100, 0)).round_dp(2),
        "fixed_amount" if config.scope == "per_night" => {
            (config.value * Decimal::from(nights.max(0))).round_dp(2)
        }
        "fixed_amount" => config.value.round_dp(2),
        _ => Decimal::ZERO,
    }
}

/// Pick the commission rule covering `as_of`: highest priority wins, ties go
/// to the most recently created active rule.
pub fn select_commission_rule(
    rules: &[ChannelCommissionRule],
    as_of: NaiveDate,
) -> Option<CommissionConfig> {
    rules
        .iter()
        .filter(|rule| {
            rule.is_active
                && rule.effective_from <= as_of
                && rule.effective_to.is_none_or(|to| as_of <= to)
        })
        .max_by_key(|rule| (rule.priority, rule.created_at, rule.id))
        .map(|rule| CommissionConfig {
            commission_type: rule.commission_type.clone(),
            value: rule.value,
            scope: rule.scope.clone(),
        })
}

/// Resolved economics for one stay on one channel.
#[derive(Debug, Clone)]
pub struct ChannelQuote {
    pub nights: Vec<PricedNight>,
    /// Sum of nightly selling prices; `None` when any night is channel-managed
    /// (net-rate rule) and no actual sell price was supplied.
    pub selling_subtotal: Option<Decimal>,
    /// Total net rate across nights when every night is net-priced.
    pub net_subtotal: Option<Decimal>,
    pub commission: CommissionConfig,
    /// Estimated commission for the stay.
    pub commission_amount: Option<Decimal>,
    /// Estimated hotel net revenue — room revenue minus commission.
    pub net_revenue: Option<Decimal>,
}

impl ChannelQuote {
    /// What a booking write persists on `bookings.channel_pricing_snapshot`.
    pub fn snapshot(&self, channel_id: i64) -> Value {
        json!({
            "channel_id": channel_id,
            "rule_ids": self.nights.iter().filter_map(|night| night.rule_id).collect::<Vec<_>>(),
            "selling_subtotal": self.selling_subtotal.map(|value| value.to_string()),
            "net_subtotal": self.net_subtotal.map(|value| value.to_string()),
            "commission_type": self.commission.commission_type,
            "commission_value": self.commission.value.to_string(),
            "commission_scope": self.commission.scope,
            "commission_amount": self.commission_amount.map(|value| value.to_string()),
            "net_revenue": self.net_revenue.map(|value| value.to_string()),
        })
    }
}

/// Resolve a whole stay: per-night selling prices plus the commission config
/// in force at `as_of` (the check-in/booking date governs the stay's terms).
///
/// `discount_total` is the promotion/credit discount already applied to the
/// room subtotal — commission is computed on the amount actually charged.
/// `actual_selling` lets a net-rate channel reconcile a recorded sell price:
/// commission becomes `selling − net_subtotal` when provided.
pub fn resolve_stay(
    nights: Vec<PricedNight>,
    commission: CommissionConfig,
    discount_total: Decimal,
    actual_selling: Option<Decimal>,
) -> ChannelQuote {
    let all_net = !nights.is_empty() && nights.iter().all(|night| night.net_rate.is_some());
    let selling_subtotal = if nights.iter().all(|night| night.selling_price.is_some()) {
        Some(
            nights
                .iter()
                .filter_map(|night| night.selling_price)
                .fold(Decimal::ZERO, |total, price| total + price)
                .round_dp(2),
        )
    } else {
        actual_selling.map(|price| price.round_dp(2))
    };
    let net_subtotal = if all_net {
        Some(
            nights
                .iter()
                .filter_map(|night| night.net_rate)
                .fold(Decimal::ZERO, |total, rate| total + rate)
                .round_dp(2),
        )
    } else {
        None
    };

    let stay_nights = nights.len() as i64;
    let (commission_amt, net_revenue) = if all_net {
        match selling_subtotal {
            // Recorded sell price reconciles the spread: commission = sell − net.
            Some(selling) => {
                let spread = (selling - discount_total - net_subtotal.unwrap_or(Decimal::ZERO))
                    .max(Decimal::ZERO)
                    .round_dp(2);
                (
                    Some(spread),
                    Some((selling - discount_total - spread).round_dp(2)),
                )
            }
            None => (None, net_subtotal),
        }
    } else {
        match selling_subtotal {
            Some(selling) => {
                let base = (selling - discount_total).max(Decimal::ZERO).round_dp(2);
                let amount = commission_amount(&commission, base, stay_nights);
                (Some(amount), Some((base - amount).round_dp(2)))
            }
            None => (None, None),
        }
    };

    ChannelQuote {
        nights,
        selling_subtotal,
        net_subtotal,
        commission,
        commission_amount: commission_amt,
        net_revenue,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use rust_decimal::Decimal;

    #[allow(clippy::too_many_arguments)]
    fn rule(
        id: i64,
        rule_type: &str,
        value: &str,
        priority: i32,
        room_type_id: Option<i64>,
        rate_plan_id: Option<i64>,
        from: &str,
        to: Option<&str>,
    ) -> ChannelPricingRule {
        ChannelPricingRule {
            id,
            channel_id: 7,
            room_type_id,
            rate_plan_id,
            rule_type: rule_type.to_string(),
            value: value.parse().unwrap(),
            effective_from: NaiveDate::parse_from_str(from, "%Y-%m-%d").unwrap(),
            effective_to: to.map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap()),
            min_price: None,
            max_price: None,
            priority,
            is_active: true,
            reason: None,
            created_by: None,
            updated_by: None,
            created_at: Utc
                .with_ymd_and_hms(2026, 1, id as u32 % 28 + 1, 0, 0, 0)
                .unwrap(),
            updated_at: Utc::now(),
        }
    }

    fn date(day: &str) -> NaiveDate {
        NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn markup_percent_adds_to_source() {
        let r = rule(1, "markup_percent", "10", 0, None, None, "2026-01-01", None);
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[r], 5, None);
        assert_eq!(night.selling_price, Some(Decimal::new(33000, 2)));
        assert_eq!(night.rule_id, Some(1));
    }

    #[test]
    fn markup_fixed_adds_per_night() {
        let r = rule(1, "markup_fixed", "20", 0, None, None, "2026-01-01", None);
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[r], 5, None);
        assert_eq!(night.selling_price, Some(Decimal::new(32000, 2)));
    }

    #[test]
    fn discount_percent_subtracts() {
        let r = rule(
            1,
            "discount_percent",
            "5",
            0,
            None,
            None,
            "2026-01-01",
            None,
        );
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[r], 5, None);
        assert_eq!(night.selling_price, Some(Decimal::new(28500, 2)));
    }

    #[test]
    fn fixed_price_replaces_source() {
        let r = rule(1, "fixed_price", "330", 0, None, None, "2026-01-01", None);
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[r], 5, None);
        assert_eq!(night.selling_price, Some(Decimal::new(33000, 2)));
    }

    #[test]
    fn net_rate_has_no_selling_price() {
        let r = rule(1, "net_rate", "255", 0, None, None, "2026-01-01", None);
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[r], 5, None);
        assert_eq!(night.selling_price, None);
        assert_eq!(night.net_rate, Some(Decimal::new(25500, 2)));
    }

    #[test]
    fn min_max_clamp_bounds_price() {
        let mut floor = rule(
            1,
            "discount_percent",
            "50",
            0,
            None,
            None,
            "2026-01-01",
            None,
        );
        floor.min_price = Some(Decimal::new(280, 0));
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[floor], 5, None);
        assert_eq!(night.selling_price, Some(Decimal::new(28000, 2)));

        let mut ceiling = rule(2, "markup_percent", "50", 0, None, None, "2026-01-01", None);
        ceiling.max_price = Some(Decimal::new(350, 0));
        let night = price_night(
            date("2026-03-01"),
            Decimal::new(300, 0),
            &[ceiling],
            5,
            None,
        );
        assert_eq!(night.selling_price, Some(Decimal::new(35000, 2)));
    }

    #[test]
    fn higher_priority_wins() {
        let low = rule(1, "markup_percent", "5", 0, None, None, "2026-01-01", None);
        let high = rule(
            2,
            "markup_percent",
            "10",
            10,
            None,
            None,
            "2026-01-01",
            None,
        );
        let night = price_night(
            date("2026-03-01"),
            Decimal::new(300, 0),
            &[low, high],
            5,
            None,
        );
        assert_eq!(night.selling_price, Some(Decimal::new(33000, 2)));
    }

    #[test]
    fn scoped_rule_beats_channel_wide_at_equal_priority() {
        let rules = [
            rule(1, "markup_percent", "5", 0, None, None, "2026-01-01", None),
            rule(
                2,
                "markup_percent",
                "10",
                0,
                Some(5),
                None,
                "2026-01-01",
                None,
            ),
        ];
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &rules, 5, None);
        assert_eq!(night.rule_id, Some(2));
        // Another room type falls back to the channel-wide rule.
        let other = price_night(date("2026-03-01"), Decimal::new(300, 0), &rules, 9, None);
        assert_eq!(other.rule_id, Some(1));
    }

    #[test]
    fn window_bounds_resolution() {
        let r = rule(
            1,
            "markup_percent",
            "10",
            0,
            None,
            None,
            "2026-03-01",
            Some("2026-03-31"),
        );
        assert!(select_rule(std::slice::from_ref(&r), date("2026-03-15"), 5, None).is_some());
        assert!(select_rule(std::slice::from_ref(&r), date("2026-03-31"), 5, None).is_some());
        assert!(select_rule(std::slice::from_ref(&r), date("2026-04-01"), 5, None).is_none());
    }

    #[test]
    fn inactive_rule_is_skipped() {
        let mut r = rule(1, "markup_percent", "10", 0, None, None, "2026-01-01", None);
        r.is_active = false;
        let night = price_night(date("2026-03-01"), Decimal::new(300, 0), &[r], 5, None);
        assert_eq!(night.rule_id, None);
        assert_eq!(night.selling_price, Some(Decimal::new(30000, 2)));
    }

    #[test]
    fn commission_percentage_of_base() {
        let cfg = CommissionConfig {
            commission_type: "percentage".to_string(),
            value: Decimal::new(15, 0),
            scope: "per_booking".to_string(),
        };
        assert_eq!(
            commission_amount(&cfg, Decimal::new(33000, 2), 1),
            Decimal::new(4950, 2)
        );
    }

    #[test]
    fn commission_fixed_scopes() {
        let per_booking = CommissionConfig {
            commission_type: "fixed_amount".to_string(),
            value: Decimal::new(25, 0),
            scope: "per_booking".to_string(),
        };
        assert_eq!(
            commission_amount(&per_booking, Decimal::new(900, 0), 3),
            Decimal::new(25, 0)
        );
        let per_night = CommissionConfig {
            commission_type: "fixed_amount".to_string(),
            value: Decimal::new(25, 0),
            scope: "per_night".to_string(),
        };
        assert_eq!(
            commission_amount(&per_night, Decimal::new(900, 0), 3),
            Decimal::new(75, 0)
        );
    }

    #[test]
    fn stay_quote_computes_net_revenue() {
        let r = rule(1, "markup_percent", "10", 0, None, None, "2026-01-01", None);
        let nights = vec![
            price_night(
                date("2026-03-01"),
                Decimal::new(300, 0),
                std::slice::from_ref(&r),
                5,
                None,
            ),
            price_night(date("2026-03-02"), Decimal::new(300, 0), &[r], 5, None),
        ];
        let cfg = CommissionConfig {
            commission_type: "percentage".to_string(),
            value: Decimal::new(15, 0),
            scope: "per_booking".to_string(),
        };
        let quote = resolve_stay(nights, cfg, Decimal::ZERO, None);
        assert_eq!(quote.selling_subtotal, Some(Decimal::new(66000, 2)));
        assert_eq!(quote.commission_amount, Some(Decimal::new(9900, 2)));
        assert_eq!(quote.net_revenue, Some(Decimal::new(56100, 2)));
    }

    fn no_commission() -> CommissionConfig {
        CommissionConfig {
            commission_type: "none".to_string(),
            value: Decimal::ZERO,
            scope: "per_booking".to_string(),
        }
    }

    #[test]
    fn net_rate_stay_uses_net_subtotal() {
        let r = rule(1, "net_rate", "255", 0, None, None, "2026-01-01", None);
        let nights = vec![
            price_night(
                date("2026-03-01"),
                Decimal::new(300, 0),
                std::slice::from_ref(&r),
                5,
                None,
            ),
            price_night(date("2026-03-02"), Decimal::new(300, 0), &[r], 5, None),
        ];
        let quote = resolve_stay(nights, no_commission(), Decimal::ZERO, None);
        assert_eq!(quote.selling_subtotal, None);
        assert_eq!(quote.net_subtotal, Some(Decimal::new(51000, 2)));
        assert_eq!(quote.commission_amount, None);
        assert_eq!(quote.net_revenue, Some(Decimal::new(51000, 2)));
    }

    #[test]
    fn net_rate_with_recorded_sell_shows_spread() {
        let r = rule(1, "net_rate", "255", 0, None, None, "2026-01-01", None);
        let nights = vec![price_night(
            date("2026-03-01"),
            Decimal::new(300, 0),
            &[r],
            5,
            None,
        )];
        let quote = resolve_stay(
            nights,
            no_commission(),
            Decimal::ZERO,
            Some(Decimal::new(330, 0)),
        );
        assert_eq!(quote.commission_amount, Some(Decimal::new(7500, 2)));
        assert_eq!(quote.net_revenue, Some(Decimal::new(25500, 2)));
    }
}
