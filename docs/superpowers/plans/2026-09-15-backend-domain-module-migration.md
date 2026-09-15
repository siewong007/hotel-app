# Backend Domain Module Migration — Implementation Plan

> **For agentic workers:** Execute domain-by-domain in the order below. One domain per commit.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every remaining flat-by-layer backend domain into `src/modules/<domain>/`,
preserving all public routes, response shapes, permissions, and business behavior.

**Architecture:** Existing convention (verified against `modules/teams`, `modules/settings`):
each routed domain is `src/modules/<domain>/{mod.rs, routes.rs, handlers.rs, service.rs,
repository.rs, models.rs, validation.rs}` — flat files, only the files the domain needs.
`consent` is the precedent for an internal (routeless) module. `ekyc` shows the partial-migration
state this plan finishes (its `repository.rs`/`models.rs` are re-export shims).

**Tech Stack:** Rust 1.95 edition 2024, Axum 0.8, SQLx 0.9 (runtime-checked `sqlx::query()`).

## Global Constraints

- No changes to route paths, HTTP methods, status codes, response fields, permission names,
  storage keys, or column meanings (AGENTS.md safety rules).
- `cargo check --all-features` must pass after every domain; `cargo clippy --all-features --
  -D warnings` before the final commit.
- One domain per commit. Move code before rewriting it. No behavior edits inside a move.
- Tests reference lib paths (`hotel_app_be::services::X`); update them in the same commit as
  the domain move.
- `models/mod.rs` keeps working as the flat index: `pub use crate::modules::<d>::models::*`
  replaces `pub mod <d>;` + `pub use <d>::*;` so `crate::models::Foo` call sites don't churn.
- `routes/mod.rs` keeps `create_router` and its helpers (`extract_client_ip`,
  `CLIENT_TIMEZONE_HEADER`, `enforce_active_session`, …) — those are app-level composition,
  not a domain. Domain merges switch to `crate::modules::<d>::routes::routes()`.

## Permanent shared/infra residents (do NOT move)

| File | Why |
|---|---|
| `core/` | cross-cutting infra (mandated) |
| `utils/` | pure helpers (mandated) |
| `services/audit.rs` + `repositories/audit.rs` | mandated global audit writer; consumed by ~every domain |
| `models/common.rs`, `models/row_mappers.rs` | shared row-mapping/common DTOs across domains |
| `models/audit.rs` | `AuditEvent` is consumed by the global audit service and many domains |
| `services/invoice_numbers.rs` + `repositories/invoice_numbers.rs` | invoice-number infra consumed by ledgers, night_audit, payments, bookings lifecycle |
| `services/account_emails.rs` | account-notification composer over `modules::communications`; used by auth, profile, guest_portal |
| `services/google_identity.rs` | identity-provider client used by auth service/repo and profile |
| `constants.rs`, `main.rs`, `lib.rs`, `bin/` | app composition |

## Migration inventory (24 routed domains + ekyc completion)

Order = leaf/low-risk first; coupled financial domains last. Module name = route file name.

| # | Domain | Files moved | Cross-deps to fix | Risk |
|---|--------|-------------|-------------------|------|
| 1 | search | routes, handlers, services/search, repositories/search, models/search | none inbound | low |
| 2 | housekeeping | + models/housekeeping | maintenance svc imports its repo | low |
| 3 | maintenance | + repositories/maintenance, models/maintenance | uses housekeeping repo | low |
| 4 | booking_channels | + repositories/booking_channels, models/booking_channel | channel_net_revenue uses its repo | low |
| 5 | audit (viewing) | routes, handlers only | svc/repo/models stay global | low |
| 6 | rates | + repositories/rate, models/rate | — | low |
| 7 | companies | + repositories/company, models/company | — | low |
| 8 | profile | services/profile | uses user/passkey/guest repos, account_emails, google_identity | med |
| 9 | users | + repositories/user, models/user | users↔rbac svc cycle; uses auth/passkey/rbac repos, models::auth | med |
| 10 | rbac | + repositories/rbac, models/rbac | uses user repo, users svc | med |
| 11 | passkey | + repositories/passkey | svc used by auth | med |
| 12 | two_factor | services/two_factor | uses user + audit repos | med |
| 13 | rooms | + repositories/rooms_queries, models/room | routes uses modules::guest_booking | med |
| 14 | guests | + repositories/guest, models/guest | repo used by auth/profile/guest_portal svcs | med |
| 15 | analytics | + repositories/analytics + channel_net_revenue, models/analytics | channel_net_revenue only consumer | med |
| 16 | night_audit | + repositories/night_audit, models/night_audit, services/night_audit_scheduler (→ scheduler.rs) | main.rs spawn call | med |
| 17 | auth | + repositories/auth, models/auth, services/turnstile (→ turnstile.rs) | biggest inbound surface: consent, settings modules; routes uses turnstile | high |
| 18 | payments | + repositories/payment, models/payment, services/paypal_client (→ paypal.rs), services/payment_receipt_scheduler (→ receipt_scheduler.rs) | main.rs spawn; guest_portal/bookings/ledgers use it | high |
| 19 | payment_retry | + repositories/payment_retry, models/payment_retry | svc↔handler intra-dep; used by payments | med |
| 20 | webhooks | routes, handlers | uses payments svc + paypal client | low |
| 21 | guest_portal | + repositories/guest_portal + guest_portal_session, models/guest_portal | coupled: consent, ekyc, guest_booking, support modules; payments/bookings svcs; rate limits | high |
| 22 | bookings | routes, handlers, services/bookings + booking + auto_checkin + booking_emails + unpaid_hold_scheduler, repositories/booking + booking_list + bookings_queries + bookings/{lifecycle,credits,complimentary,checkin_advisory}, models/booking | largest domain; repos import handlers::payments + services::* (existing layer violations, keep) | high |
| 23 | ledgers | + repositories/ledger, models/ledger | repo uses payments + invoice_numbers svcs | med |
| 24 | data_transfer | + repositories/data_transfer, models/data_transfer, services/data_transfer_jobs (→ jobs.rs), data_transfer_step_up (→ step_up.rs) | step-up auth flow; job runs | high |
| 25 | ekyc completion | repositories/ekyc → modules/ekyc/repository.rs (replace shim), models/ekyc → merge into modules/ekyc/models.rs | auto_checkin svc + 3 test files import flat paths | med |
| 26 | promotion_pricing | services/promotion_pricing → modules/promotions/pricing.rs | sole consumer: modules::guest_booking | low |

## Per-domain recipe

1. `mkdir src/modules/<domain>`; `git mv` each flat file to its module name
   (`routes.rs`, `handlers.rs`, `service.rs`, `repository.rs`, `models.rs`; extra files keep
   descriptive names like `scheduler.rs`, `jobs.rs`, `pricing.rs`). Multi-file repositories
   become `repository/` submodules only when needed (bookings).
2. Write `modules/<domain>/mod.rs` with `pub mod` decls (copy teams' doc style briefly).
3. In moved files, rewrite own-domain imports `crate::{routes,handlers,services,repositories}::<d>`
   → `super::{routes,handlers,service,repository}`; other domains' moved paths →
   `crate::modules::<d2>::{service,…}`; unmoved paths stay flat until their turn.
4. Repo-wide regex rewrites for the moved paths (`crate::services::<d>` →
   `crate::modules::<d>::service`, etc.) across `src/`, `src/bin/`, `tests/`, `main.rs`.
5. `models/mod.rs`: `pub mod <d>;` → delete; `pub use <d>::*;` →
   `pub use crate::modules::<d>::models::*;`. Fix any `crate::models::<d>::Type`
   path-qualified uses to the module path.
6. `routes/mod.rs`: delete `pub mod <d>;`, switch merge to `crate::modules::<d>::routes::routes()`.
7. `services/mod.rs`, `handlers/mod.rs`, `repositories/mod.rs`: drop the moved decls.
8. `modules/mod.rs`: add `pub mod <d>;`.
9. `cargo check --all-features` → fix fallout → commit
   `refactor(be): migrate <domain> to modules/<domain>`.

## Verification (final)

- `cargo check --all-features`, `cargo clippy --all-features -- -D warnings`, `cargo test
  --all-features` (no DATABASE_URL locally — PG suites skip; judge by compile + unit tests).
- `rg "crate::(routes|handlers|services|repositories)::(search|housekeeping|…)"` → empty
  except intentional leftovers (audit/invoice_numbers/account_emails/google_identity).
- `rg "hotel_app_be::(routes|handlers)::" tests/` → empty.
- `routes/mod.rs` merge count unchanged (38); `docs/api/openapi.json` untouched (no route
  changes → openapi_drift stays green).
- Update CLAUDE.md/AGENTS.md module list + counts; this file records final inventory.

## Execution log

(checkboxes filled as domains land)

- [ ] 1 search …
