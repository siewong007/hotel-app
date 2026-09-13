//! Derived campaign lifecycle.
//!
//! Stored `promotions.status` stays `{draft, published, paused, cancelled,
//! archived}`; the lifecycle operators see is derived from the claim window so
//! a published campaign resolves to `scheduled` / `live` / `expired` without a
//! status-writer job or a redundant column. `draft`, `paused`, `cancelled`,
//! and `archived` pass through unchanged.

use chrono::{DateTime, Utc};

/// Every value the admin list filter accepts: stored statuses plus the three
/// derived states of a published campaign.
pub const LIFECYCLES: &[&str] = &[
    "draft",
    "scheduled",
    "live",
    "paused",
    "expired",
    "cancelled",
    "archived",
];

pub fn lifecycle_for(
    status: &str,
    claim_starts_at: Option<DateTime<Utc>>,
    claim_ends_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> &'static str {
    if status != "published" {
        return match status {
            "draft" => "draft",
            "paused" => "paused",
            "cancelled" => "cancelled",
            _ => "archived",
        };
    }
    if claim_starts_at.is_some_and(|starts_at| starts_at > now) {
        return "scheduled";
    }
    if claim_ends_at.is_some_and(|ends_at| ends_at < now) {
        return "expired";
    }
    "live"
}

/// SQL predicate for an admin list filter. The input is validated against
/// [`LIFECYCLES`] first, so each arm returns a fixed literal clause — no user
/// input is ever interpolated.
pub fn lifecycle_clause(lifecycle: &str) -> Option<&'static str> {
    match lifecycle {
        "draft" | "paused" | "cancelled" | "archived" => Some(match lifecycle {
            "draft" => "p.status = 'draft'",
            "paused" => "p.status = 'paused'",
            "cancelled" => "p.status = 'cancelled'",
            _ => "p.status = 'archived'",
        }),
        "scheduled" => Some("p.status = 'published' AND p.claim_starts_at > CURRENT_TIMESTAMP"),
        "expired" => Some("p.status = 'published' AND p.claim_ends_at < CURRENT_TIMESTAMP"),
        "live" => Some(
            "p.status = 'published' \
             AND (p.claim_starts_at IS NULL OR p.claim_starts_at <= CURRENT_TIMESTAMP) \
             AND (p.claim_ends_at IS NULL OR p.claim_ends_at >= CURRENT_TIMESTAMP)",
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn non_published_statuses_pass_through() {
        let now = Utc::now();
        for (status, expected) in [
            ("draft", "draft"),
            ("paused", "paused"),
            ("cancelled", "cancelled"),
            ("archived", "archived"),
        ] {
            assert_eq!(lifecycle_for(status, None, None, now), expected);
        }
    }

    #[test]
    fn published_resolves_against_the_claim_window() {
        let now = Utc::now();
        assert_eq!(lifecycle_for("published", None, None, now), "live");
        assert_eq!(
            lifecycle_for(
                "published",
                Some(now + Duration::days(1)),
                Some(now + Duration::days(10)),
                now,
            ),
            "scheduled"
        );
        assert_eq!(
            lifecycle_for(
                "published",
                Some(now - Duration::days(10)),
                Some(now - Duration::days(1)),
                now,
            ),
            "expired"
        );
        // Open start that already passed with an open end stays live.
        assert_eq!(
            lifecycle_for(
                "published",
                Some(now - Duration::days(1)),
                None,
                now,
            ),
            "live"
        );
    }

    #[test]
    fn every_lifecycle_maps_to_a_clause() {
        for lifecycle in LIFECYCLES {
            assert!(
                lifecycle_clause(lifecycle).is_some(),
                "{lifecycle} must map to a filter clause"
            );
        }
        assert!(lifecycle_clause("nonsense").is_none());
    }
}
