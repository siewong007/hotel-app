//! Scenario registry: name → ordered module list. Every scenario includes its
//! dependencies (fixed ids make replays coherent — a scenario's bookings exist
//! because its module list contains the booking section that owns them).
//!
//! Dependency edges that matter:
//!   bookings_history  → bookings_ops + bookings_matrix (FK to bookings)
//!   finance           → bookings_ops + bookings_matrix + anonymous
//!                       (payments/invoices/ledgers FK to bookings; 804125/126
//!                       settle anonymous bookings 802202/802203)
//!   night_audit       → bookings_matrix (posted_nights/details ref 802001-45)
//!   marketing         → bookings_ops + bookings_matrix (voucher redemptions)
//!   loyalty           → finance (points ledger refs payment ids)
//!   webhook_fixtures  → bookings_matrix + anonymous (pending PayPal payments)
//!   audit             → everything its resource_ids point at for coherence
//!   guest_access      → core (portal sessions FK to guests)
//!   auth_extra        → core (extends users)

/// Canonical module execution order. `resolve` always emits modules in this
/// order regardless of the order scenarios were requested.
pub const MODULE_ORDER: &[&str] = &[
    "core",
    "rooms_state",
    "bookings_ops",
    "bookings_matrix",
    "bookings_history",
    "anonymous",
    "availability",
    "operations",
    "night_audit",
    "finance",
    "marketing",
    "loyalty",
    "guest_access",
    "auth_extra",
    "notifications",
    "webhook_fixtures",
    "audit",
];

pub struct Scenario {
    pub name: &'static str,
    pub description: &'static str,
    pub modules: &'static [&'static str],
}

pub const SCENARIOS: &[Scenario] = &[
    Scenario {
        name: "basic",
        description: "Working hotel: staff, inventory, rates, guests, today's front-desk bookings",
        modules: &["core", "rooms_state", "bookings_ops"],
    },
    Scenario {
        name: "availability",
        description: "Inventory grid: allocations, room status spread, sold-out and one-left dates",
        modules: &["core", "rooms_state", "availability"],
    },
    Scenario {
        name: "booking-lifecycle",
        description: "Every booking status: pending through checked_out, no_show, voided, comp stays, anonymous bookings",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "bookings_history",
            "anonymous",
        ],
    },
    Scenario {
        name: "frontdesk",
        description: "Today's operations: arrivals, departures, in-house, housekeeping board, maintenance",
        modules: &["core", "rooms_state", "bookings_ops", "operations"],
    },
    Scenario {
        name: "payments",
        description: "Every payment state, invoices, city ledgers, refund/partial/retry/receipt fixtures",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "anonymous",
            "finance",
            "webhook_fixtures",
        ],
    },
    Scenario {
        name: "webhooks",
        description: "Gateway-replay fixtures: pending PayPal payments with deterministic order ids (no webhook store exists)",
        modules: &[
            "core",
            "rooms_state",
            "bookings_matrix",
            "anonymous",
            "webhook_fixtures",
        ],
    },
    Scenario {
        name: "authentication",
        description: "RBAC users for every role plus locked/inactive/unverified, 2FA-enabled user, portal sessions",
        modules: &["core", "auth_extra", "guest_access"],
    },
    Scenario {
        name: "audit",
        description: "Booking history, room status history, audit markers, night-audit runs, job history",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "bookings_history",
            "anonymous",
            "operations",
            "night_audit",
            "finance",
            "marketing",
            "audit",
        ],
    },
    Scenario {
        name: "notifications",
        description: "Staff notifications with read markers, email delivery states, suppression list",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "marketing",
            "notifications",
        ],
    },
    Scenario {
        name: "edge-cases",
        description: "Boundary fixtures: adjacent/one-night/long stays, max occupancy, aging hold, sold-out date, retry-after-failure, anonymous flows",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "bookings_history",
            "anonymous",
            "availability",
            "finance",
        ],
    },
    Scenario {
        name: "operations",
        description: "Housekeeping board, maintenance tickets, room events, night-audit history",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "operations",
            "night_audit",
        ],
    },
    Scenario {
        name: "marketing",
        description: "Promotions in every status, vouchers/redemptions, segments, email campaigns",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "marketing",
        ],
    },
    Scenario {
        name: "loyalty",
        description: "Members, tiers, points ledger, reward catalog, redemptions, complimentary credits",
        modules: &[
            "core",
            "rooms_state",
            "bookings_ops",
            "bookings_matrix",
            "anonymous",
            "finance",
            "loyalty",
        ],
    },
    Scenario {
        name: "guest-access",
        description: "Anonymous bookings with access tokens, guest-portal sessions, user-guest links",
        modules: &["core", "rooms_state", "anonymous", "guest_access"],
    },
    Scenario {
        name: "full",
        description: "Complete development hotel — every module (same as --all)",
        modules: MODULE_ORDER,
    },
];

/// Resolve requested scenario names to an ordered, deduplicated module list.
/// Unknown names error with the valid list.
pub fn resolve(names: &[String]) -> Result<Vec<&'static str>, String> {
    let mut wanted: Vec<&Scenario> = Vec::new();
    for name in names {
        match SCENARIOS.iter().find(|s| s.name == name.trim()) {
            Some(s) => wanted.push(s),
            None => {
                return Err(format!(
                    "unknown scenario '{name}' — run `seed --list` for valid names"
                ));
            }
        }
    }
    Ok(ordered_modules(
        wanted.iter().flat_map(|s| s.modules.iter().copied()),
    ))
}

/// Every module in canonical order (`--all`, bare `seed`, and `full` converge).
pub fn resolve_all() -> Vec<&'static str> {
    MODULE_ORDER.to_vec()
}

/// Stable-order dedupe against MODULE_ORDER.
fn ordered_modules<'a>(iter: impl Iterator<Item = &'a str>) -> Vec<&'static str> {
    let selected: std::collections::HashSet<&str> = iter.collect();
    MODULE_ORDER
        .iter()
        .copied()
        .filter(|k| selected.contains(k))
        .collect()
}

pub fn list_text() -> String {
    let mut out = String::from("Available scenarios:\n");
    for s in SCENARIOS {
        out.push_str(&format!("  {:<18} {}\n", s.name, s.description));
    }
    out.push_str("\n`seed` with no flags applies `full`; `--all` is equivalent.\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_module_in_scenarios_is_known_and_ordered() {
        for s in SCENARIOS {
            let resolved = ordered_modules(s.modules.iter().copied());
            // No unknown keys, no duplicates, emitted in MODULE_ORDER.
            assert_eq!(resolved.len(), s.modules.len(), "{}", s.name);
        }
    }

    #[test]
    fn unknown_scenario_names_error() {
        assert!(resolve(&["nope".to_string()]).is_err());
    }

    #[test]
    fn resolve_dedupes_and_orders() {
        let modules = resolve(&["payments".to_string(), "basic".to_string()]).unwrap();
        let pos = |k| MODULE_ORDER.iter().position(|m| *m == k).unwrap();
        for pair in modules.windows(2) {
            assert!(pos(pair[0]) < pos(pair[1]));
        }
        assert!(modules.contains(&"finance"));
        assert!(modules.contains(&"core"));
    }

    #[test]
    fn booking_history_runs_after_bookings() {
        let pos = |k| MODULE_ORDER.iter().position(|m| *m == k).unwrap();
        assert!(pos("bookings_history") > pos("bookings_matrix"));
        assert!(pos("bookings_history") > pos("bookings_ops"));
        assert!(pos("finance") > pos("anonymous"));
        assert!(pos("webhook_fixtures") > pos("anonymous"));
    }
}
