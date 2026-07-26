# Backend Booking Domain — Structure & Layering Audit

Scope: `hotel-app-be/src` booking domain (routes/handlers/services/repositories +
`models/booking.rs`, `services/auto_checkin.rs`, `services/night_audit.rs`
booking-touching parts). All line numbers verified in this session via `grep -n`
or limited `Read` calls against the working tree on 2026-07-27; none reused from
`.claude/refs/*.md`.

## 1. File sizes (measured this session)

```
3492  src/repositories/bookings/lifecycle.rs
 725  src/repositories/booking_list.rs
 623  src/services/bookings.rs
 622  src/repositories/bookings/complimentary.rs
 608  src/repositories/bookings/credits.rs
 571  src/models/booking.rs
 392  src/services/auto_checkin.rs
 368  src/routes/bookings.rs
 336  src/repositories/booking.rs
 330  src/repositories/bookings_queries.rs
 317  src/services/night_audit.rs
 277  src/handlers/bookings.rs
 273  src/repositories/booking_channels.rs
 176  src/repositories/bookings/checkin_advisory.rs
  77  src/routes/booking_channels.rs
  39  src/handlers/booking_channels.rs
  31  src/services/booking.rs
  26  src/services/booking_channels.rs
  13  src/repositories/bookings/mod.rs
```

## 2. lifecycle.rs function inventory (complete, 55 functions)

Enumerated with `awk` matching every `^pub async fn|^async fn|^pub fn|^fn` line
(55 hits: 40 `pub`, 15 private — cross-checked against a separate `grep -c`).
Line ranges below are exact (awk-derived start line to the line before the next
signature, or EOF for the last one).

| Fn | Lines | Size | Responsibility | Status |
|---|---|---|---|---|
| `sanitize_ota_reference` | 27-38 | 12 | trim/normalize OTA ref string | live (create) |
| `record_booking_history` | 39-73 | 35 | INSERT booking_history, pool (non-tx), swallows errors to `log::warn!` | live |
| `record_booking_history_tx` | 74-114 | 41 | same, tx variant, propagates errors | live |
| `record_self_checkin_event_tx` | 115-160 | 46 | INSERT self_checkin_events | live (checkin) |
| `reconcile_room_status_after_booking_release` | 161-235 | 75 | recompute a released room's status from remaining bookings | live |
| `billable_nights` | 236-239 | 4 | `max(nights,1)` | live |
| `canonical_tourism_tax_for_guest` | 240-266 | 27 | tourism tax calc from guest.tourism_type | live |
| `get_booking_timeline_handler` | 267-389 | 123 | HTTP-shaped: perm check + timeline read | live |
| `describe_booking_modification_event` | 390-452 | 63 | timeline text formatting | live (timeline) |
| `timeline_json_string` | 453-459 | 7 | json field extract | live (timeline) |
| `format_timeline_date_range` | 460-467 | 8 | date formatting | live (timeline) |
| `format_timeline_date` | 468-542 | 75 | date formatting (large for its purpose) | live (timeline) |
| `auto_post_company_ledger` | 543-668 | 126 | **city-ledger** INSERT for company billing on checkout | live, only caller line 1794 |
| `get_bookings_handler` | 669-690 | 22 | HTTP-shaped: paginated list | live |
| `decimal_to_f64` | 691-694 | 4 | cast helper | live |
| `checkout_balance_due` | 695-702 | 8 | `max(total-paid,0)` | live, unit-tested (773-796) |
| `booking_has_company_billing` | 703-716 | 14 | predicate for checkout-balance-guard exemption | live |
| `completed_booking_payment_total` | 717-738 | 22 | SUM completed, non-refund payments | live |
| `ensure_checkout_balance_resolved` | 739-797 | 59 | blocks checkout unless paid-in-full or company-billed | live |
| `booking_revenue_for_date` | 798-813 | 16 | stats helper | live |
| `get_booking_stats_handler` | 814-885 | 72 | HTTP-shaped: dashboard stats | live |
| `get_my_bookings_handler` | 886-912 | 27 | HTTP-shaped: current user's bookings | live |
| `create_booking_handler` | 913-1203 | **291** | HTTP-shaped: room lock, conflict check, pricing, INSERT, room reserve, deposit payment | live |
| `get_booking_handler` | 1204-1248 | 45 | HTTP-shaped: single booking + perm/ownership | live |
| `update_booking_handler` | 1249-1941 | **693** | HTTP-shaped: perm, validation, pricing recompute, UPDATE, status-dispatch side effects, ledger sync, audit | live — **largest fn in repo** |
| `delete_booking_handler` | 1942-2105 | 164 | full duplicate void flow | **DEAD** (`#[allow(dead_code)]`) |
| `manual_checkin_handler` | 2106-2462 | 357 | full duplicate check-in flow | **DEAD** (`#[allow(dead_code)]`) |
| `pre_checkin_update_handler` | 2463-2548 | 86 | HTTP-shaped: guest pre-checkin form update | live |
| `reactivate_booking_handler` | 2549-2696 | 148 | full duplicate reactivate flow | **DEAD** (`#[allow(dead_code)]`) |
| `user_owns_booking` | 2697-2713 | 17 | ownership predicate | live |
| `void_booking_tx` | 2714-2742 | 29 | core void UPDATE (tx) | live |
| `booking_night_audit_dates` | 2743-2785 | 43 | dates needing night-audit rerun | live |
| `release_room_tx` | 2786-2797 | 12 | room -> available (tx) | live |
| `void_booking_payments_tx` | 2798-2815 | 18 | void linked payments (tx) | live |
| `void_uncompleted_booking_payments_tx` | 2816-2830 | 15 | narrower payment-void variant | live |
| `restore_complimentary_credits_tx` | 2831-2873 | 43 | credit-restore on void | live |
| `record_booking_void_modification_tx` | 2874-2908 | 35 | booking_modifications audit row | live |
| `fetch_room_status` | 2909-2918 | 10 | read helper | live |
| `room_number` | 2919-2928 | 10 | read helper | live |
| `fetch_room_status_tx` | 2929-2943 | 15 | read helper (tx) | live (checkin) |
| `fetch_guest_ic_number_tx` | 2944-2959 | 16 | read helper (tx) | live (checkin) |
| `apply_guest_update_tx` | 2960-3051 | 92 | guest-field patch during checkin | live (checkin) |
| `apply_booking_field_update_tx` | 3052-3115 | 64 | booking-field patch during checkin | live (checkin) |
| `checkin_booking_tx` | 3116-3167 | 52 | atomic `status IN ('confirmed')` → `checked_in` guarded UPDATE | live |
| `confirm_booking_tx` | 3168-3187 | 20 | → `confirmed` | live (payments.rs) |
| `move_booking_to_pending_confirmation_tx` | 3188-3202 | 15 | guarded transition | live (payments.rs) |
| `move_booking_to_pending_payment_tx` | 3203-3217 | 15 | guarded transition | live (payments.rs) |
| `record_checkin_payment_tx` | 3218-3259 | 42 | payment row at check-in | live |
| `record_online_checkin_payment_tx` | 3260-3305 | 46 | auto-post online prepaid balance | live |
| `set_room_occupied_tx` | 3306-3321 | 16 | room -> occupied | live |
| `record_checkin_modification_tx` | 3322-3361 | 40 | booking_modifications row | live |
| `find_reactivation_candidate` | 3362-3383 | 22 | fetch for reactivate | live |
| `has_reactivation_conflict` | 3384-3415 | 32 | conflict check for reactivate | live |
| `confirm_reactivated_booking_and_reserve_room` | 3416-3473 | 58 | guarded `voided`→`confirmed` + reserve room | live |
| `record_booking_reactivation_modification` | 3474-3492 | 19 | audit row | live |

**Dead total: 164 + 357 + 148 = 669 lines, 19.2% of the file.** All three carry
`#[allow(dead_code)]` (verified at lines 1941, 2105-just-before-2106, 2547-just-before-2549)
and zero external callers (`grep -rn <name> src/` outside lifecycle.rs returns
nothing for any of the three — `handlers/bookings.rs` calls `booking_service::void_booking`,
`booking_service::manual_checkin`, `booking_service::reactivate_booking` instead,
all defined in `services/bookings.rs`, not these). The live services/bookings.rs
equivalents already reimplement the same operations transactionally using this
same file's `*_tx` primitives (see §5).

## 3. Proposed decomposition (matches `modules/<domain>/{routes,handlers,service,repository,models,validation}.rs`)

Step 0 (do first, zero risk): delete the three dead functions above (669 lines).
Then split the remaining ~2823 lines:

| New file | Contents (fn : lines) | Approx size |
|---|---|---|
| `create.rs` | `sanitize_ota_reference` 27-38, `create_booking_handler` 913-1203 (itself needs internal decomposition — see §4) | ~305 |
| `update.rs` | `update_booking_handler` 1249-1941 (needs internal decomposition), `ensure_checkout_balance_resolved` 739-797, `checkout_balance_due` 695-702, `booking_has_company_billing` 703-716, `completed_booking_payment_total` 717-738 | ~815 |
| `checkin.rs` | `checkin_booking_tx` 3116-3167, `confirm_booking_tx` 3168-3187, `move_booking_to_pending_confirmation_tx` 3188-3202, `move_booking_to_pending_payment_tx` 3203-3217, `record_checkin_payment_tx` 3218-3259, `record_online_checkin_payment_tx` 3260-3305, `set_room_occupied_tx` 3306-3321, `record_checkin_modification_tx` 3322-3361, `fetch_guest_ic_number_tx` 2944-2959, `apply_guest_update_tx` 2960-3051, `apply_booking_field_update_tx` 3052-3115, `record_self_checkin_event_tx` 115-160, `pre_checkin_update_handler` 2463-2548 | ~500 |
| `void.rs` | `void_booking_tx` 2714-2742, `booking_night_audit_dates` 2743-2785, `release_room_tx` 2786-2797, `void_booking_payments_tx` 2798-2815, `void_uncompleted_booking_payments_tx` 2816-2830, `restore_complimentary_credits_tx` 2831-2873, `record_booking_void_modification_tx` 2874-2908 | ~195 |
| `reactivate.rs` | `find_reactivation_candidate` 3362-3383, `has_reactivation_conflict` 3384-3415, `confirm_reactivated_booking_and_reserve_room` 3416-3473, `record_booking_reactivation_modification` 3474-3492 | ~130 |
| `room_status.rs` | `reconcile_room_status_after_booking_release` 161-235, `fetch_room_status`/`_tx` 2909-2918/2929-2943, `room_number` 2919-2928 | ~130 |
| `ledger_posting.rs` (candidate: move to `repositories/ledger.rs` instead — see Finding 8) | `auto_post_company_ledger` 543-668 | ~126 |
| `timeline.rs` | `get_booking_timeline_handler` 267-389 + 4 formatting helpers 390-542 | ~275 |
| `queries.rs` / `stats.rs` | `get_bookings_handler` 669-690, `booking_revenue_for_date` 798-813, `get_booking_stats_handler` 814-885, `get_my_bookings_handler` 886-912, `get_booking_handler` 1204-1248, `user_owns_booking` 2697-2713 | ~250 |
| `history.rs` | `record_booking_history`/`_tx` 39-114, `billable_nights` 236-239, `canonical_tourism_tax_for_guest` 240-266, `decimal_to_f64` 691-694 | ~110 |

This yields 9 files of 110-815 lines instead of one 3492-line file. `update.rs`
is still oversized because `update_booking_handler` itself is 693 lines — see §4.

## 4. Internal decomposition needed inside the two giant functions

**`create_booking_handler` (913-1203, 291 lines)** mixes: room row-lock (936-967),
room-status gate (969-978), conflict check (980-1006), pricing/tax calc
(1008-1033), booking-number resolution (1036-1040), sanitization (1047-1056),
INSERT (1068-1119), room-status reserve (1121-1146), and deposit-payment
recording (1148+). Each is independently extractable given it already operates
on one `&mut tx`.

**`update_booking_handler` (1249-1941, 693 lines)** is the worst offender:
permission+ownership check (1257-1278), input parsing/validation (1280-1340),
conflict check (1342-1375), room-status gate (1377-1393), pricing/daily_rates
rebuild (1395-1493), tax calc (1495-1497), checkout-balance guard call
(1501-1509), the UPDATE itself (1511-1582), room-release reconciliation
(1587-1615), a **~230-line inline `match updated_status`** dispatching to room
sync / payment void / loyalty reversal / housekeeping task / invoice generation
/ loyalty award / city-ledger auto-post (1617-1830), night-audit backfill
(1815-1829), customer-ledger delta sync (1832-1875), and audit/modification
logging (1877-1936). This is not one operation, it is ~10; the status-dispatch
block alone is a strong extraction candidate (`apply_status_transition_side_effects`).

## 5. Wrong-layer findings

**5a. Repository files contain full HTTP handlers, not repository functions.**
`repositories/bookings/lifecycle.rs:17-20` imports `axum::extract::{Extension,
Path, Query, State}`, `axum::http::HeaderMap`, `axum::response::Json`, and
`crate::core::middleware::require_auth` (line 7). Every `*_handler`-suffixed
function (get_booking_timeline_handler, get_bookings_handler,
get_booking_stats_handler, get_my_bookings_handler, create_booking_handler,
get_booking_handler, update_booking_handler, pre_checkin_update_handler, plus
the three dead ones) takes Axum extractors directly and performs its own
`AuthService::check_permission` calls (lines 274-277, 1218-1221, 1257-1260,
1956-1959, 2114-2117, 2577-2580). This is not confined to lifecycle.rs — the
same shape exists in `repositories/bookings/credits.rs` (`book_with_credits_handler`
19, `get_guests_with_credits_handler` 247, `add_guest_credits_handler` 287,
`update_guest_credits_handler` 427, `delete_guest_credits_handler` 530) and
`repositories/bookings/complimentary.rs` (`mark_complimentary_handler` 15,
`convert_complimentary_to_credits_handler` 224, `get_complimentary_bookings_handler`
297, `get_complimentary_summary_handler` 337, `update_complimentary_handler` 382,
`remove_complimentary_handler` 543). By contrast `repositories/bookings/checkin_advisory.rs`
does it correctly: `checkin_advisory` (64) and `checkin_advisory_for_guest` (83)
take plain `(pool, id)` args with no Axum/auth coupling — this is the shape the
rework should converge on.

**5b. The "service layer" for most of the booking domain is a bare glob re-export.**
`services/bookings.rs:3`: `pub use crate::repositories::bookings::*;`. This
single line is what makes `booking_service::create_booking_handler`,
`get_booking_handler`, `update_booking_handler`, `get_bookings_handler`,
`get_booking_stats_handler`, `get_my_bookings_handler`,
`get_booking_timeline_handler`, `pre_checkin_update_handler`,
`book_with_credits_handler`, `mark_complimentary_handler`, etc. resolve at all —
`handlers/bookings.rs` (e.g. lines 20, 46, 52, 59, 79, 87, 96-102, 159-160) calls
them as if they were service functions, but they are executing repository-file
code with zero intervening service-layer logic. Only 8 of the ~30 names exposed
through `booking_service::` are real functions physically defined in
`services/bookings.rs` (`can_book_with_credits_for_guest`, `cancel_pending_booking_by_guest`,
`void_booking`, `manual_checkin`, `checkin_booking_flow`, `reactivate_booking`,
plus 2 private helpers) — everything else handlers call "through the service" is
actually the repository.

**5c. Two enforcement models for the same state machine coexist.** The `*_tx`
primitives (checkin_booking_tx:3116, confirm_booking_tx:3168,
move_booking_to_pending_confirmation_tx:3188, move_booking_to_pending_payment_tx:3203,
confirm_reactivated_booking_and_reserve_room:3416, void_booking_tx:2714) each
guard their `UPDATE bookings SET status = ...` with an explicit
`WHERE status IN (...)` / `WHERE status = '<required-from>'` predicate and are
called from services/bookings.rs inside a transaction — a real, atomic,
allow-listed transition. `update_booking_handler`'s own `UPDATE bookings SET
status = $2 ...` (1517-1546) has no such guard: `new_status` is whatever the
caller supplied (default: unchanged), the only two rejected values are the
literal strings `'cancelled'` and `'comp_cancelled'` (1293-1302), and every
other target status is accepted unconditionally, with reactive side effects
chosen afterward by an ad hoc `match updated_status { "voided" => ..,
"checked_out"|"completed" => .., "checked_in"|"auto_checked_in" => .., _ => {} }`
(1633-1813) that has no `else` branch flagging an unrecognized/illegal status.
There is no single source of truth for "which (from, to) status pairs are
legal" in the booking domain.

## 6. Duplication

**6a. "Active booking statuses" list copy-pasted 4 times (plus one variant) in
lifecycle.rs**, vs. centralized once in the guest module:
`modules/guest_booking/repository.rs:15`:
`const ACTIVE_BOOKING_STATUSES: &str = "'reserved', 'confirmed', 'checked_in', 'auto_checked_in', 'pending', 'pending_payment', 'pending_confirmation'";`
reused at lines 249, 310, 534. The admin/legacy path has no equivalent constant
and hand-repeats the identical literal at `lifecycle.rs:987` (create conflict
check), `1354` (update conflict check), `2596` (dead reactivate_booking_handler),
`3395` (has_reactivation_conflict, live), plus a 4-value variant at `852`
(`'pending', 'confirmed', 'checked_in', 'auto_checked_in'` for stats). A future
status addition (e.g. a new hold/pre-auth state) requires hunting every literal
by hand; guest and admin paths can silently diverge on "what counts as active."

**6b. Room-availability/conflict-check logic is independently reimplemented**
between the admin path (`lifecycle.rs:1350-1359`, a 3-clause `OR` decomposition
of half-open-interval overlap) and the guest path
(`modules/guest_booking/repository.rs:129-131`, `249`, `306-310`, `531-534`, a
single `check_in_date < $end AND check_out_date > $start` predicate). Manually
verified both formulas are logically equivalent for standard half-open
intervals (checked identical-range, back-to-back, and containment cases), so
this is not a proven bug today, but it is the same business rule maintained in
two independently-editable forms — a future rule change (e.g. a cleaning-buffer
between bookings) edited in one path and not the other would silently diverge
guest vs. staff booking behavior.

**6c. Redundant permission re-checks** (also an efficiency issue, §7).

## 7. Accountability & efficiency

**7a. `update_booking_handler` has no transaction boundary at all** (accountability,
high). Grepped lines 1249-1941 for `pool.begin\|&mut tx\|&mut \*tx\|DbTransaction`:
zero matches. The function performs, as a sequence of independent `&pool` calls:
the `bookings` UPDATE (1511-1582), room-status reconciliation (1587-1615),
payment voiding on a `voided` transition (1648-1665), loyalty-point reversal
(1667-1680), housekeeping-task creation and invoice generation on
`checked_out`/`completed` (1733-1804), loyalty-point award (1763-1776),
city-ledger auto-post (1791-1804), night-audit backfill (1817-1829), and
`customer_ledgers.amount` delta sync (1843-1875). Nearly every one of these is
wrapped in `if let Err(e) = ... { log::warn!(...) }` — a failure is logged but
never rolled back or surfaced to the caller, and the primary `bookings` row is
already committed by the time any of them runs. Contrast with
`services/bookings.rs::void_booking` (140-230) and
`checkin_booking_flow_for_booking` (292-502), both of which open one
`pool.begin()` and commit only after every write succeeds, with an explicit
code comment ("mirrors `void_booking`" at line 239) about why. A crash or DB
blip between the `bookings` UPDATE and the payment-void UPDATE at line
1648-1653 leaves a booking marked `voided` with its payments still `completed`
— an inconsistent money state that surfaces only as a `log::warn!` line, not an
error.

**7b. Redundant RBAC checks, live and dead.** `core/auth.rs:486-495`'s doc
comment states `check_permission` already "Check[s] whether a user holds a
permission (or the implied `<resource>:manage`)" (delegates to
`rbac_cache::has_permission`). Despite that, the pattern
`check_permission(pool,user,"bookings:X").await.unwrap_or(false) ||
check_permission(pool,user,"bookings:manage").await.unwrap_or(false)` — which
performs a second, already-redundant lookup — appears at 6 **live** call sites:
`services/bookings.rs:155` (void_booking), `255` (manual_checkin), `523`
(reactivate_booking); `repositories/bookings/lifecycle.rs:277`
(get_booking_timeline_handler), `1221` (get_booking_handler), `1260`
(update_booking_handler) — plus 3 more inside the dead functions (1959, 2117,
2580). Five of the six live sites are additionally *preceded* by an equivalent
`require_permission_helper` call already made in `routes/bookings.rs` (e.g.
line 128 `get_booking` route calls `require_permission_helper(...,
"bookings:read")` then `handlers::bookings::get_booking_handler` → eventually
`lifecycle.rs:1218` checks `"bookings:read"` again, then ORs in `"bookings:manage"`
again) — a single `PATCH /bookings/{id}` request performs 3 RBAC-cache lookups
to answer one permission question.

**7c. Best-effort audit trail on the highest-traffic mutation.**
`record_booking_history` (39-73, the non-tx/pool variant used by
`update_booking_handler` at line 1618) swallows its own INSERT failure with
`log::warn!` only (65-71). `update_booking_handler` also discards
`AuditLog::log_booking_updated`'s result with `let _ =` (line 1885). Both the
booking-history and audit-log trails for booking edits can silently go missing
on transient DB errors with no operator-visible signal beyond a log line.

## 8. Ledger logic embedded in the booking file

`auto_post_company_ledger` (543-668, 126 lines), `booking_has_company_billing`
(703-716), `completed_booking_payment_total` (717-738), and
`ensure_checkout_balance_resolved` (739-797) collectively ~220 lines of
`customer_ledgers`/`payments` business rules living inside
`repositories/bookings/lifecycle.rs` rather than `repositories/ledger.rs`. The
only caller of `auto_post_company_ledger` is `update_booking_handler:1794`, so
it could move wholesale. (This connects to already-tracked backlog items
"Cascade booking void to city ledger as a reversal row" and "Post adjustment
row when booking total changes on a paid ledger" — the delta-sync block at
lifecycle.rs:1843-1875 that updates `customer_ledgers.amount` in place, with no
adjustment row, is the code those tracker items refer to; not re-listed here as
a separate finding.)

## 9. Dead code beyond the three functions

**9a. `repositories/booking.rs`: 8 of 10 `pub fn`s are unreferenced anywhere in
`src/`** (checked every one individually with
`grep -rn "BookingRepository::<fn>" src/` excluding the defining file):
`find_all_with_details` (117-141), `find_by_id` (142-163),
`find_by_id_with_details` (185-210), `find_by_guest_id` (211-240), `create`
(241-278), `update_status` (281-292), `check_in` (295-309), `check_out`
(312-326), `exists` (329-336ish) — ~183 of 336 lines. Only
`find_paginated_with_details` (called from `lifecycle.rs:674`) and
`find_mapped_by_id` (called from `services/booking.rs:28`) are live.

**9b. `repositories/bookings_queries.rs`: 4 of 8 SQL constants are
unreferenced**: `GET_BOOKINGS_QUERY` (50-95), `GET_TODAYS_CHECKINS_QUERY`
(195-241), `GET_TODAYS_CHECKOUTS_QUERY` (242-288), `GET_ACTIVE_BOOKINGS_QUERY`
(289-330) — 182 of 330 lines, checked via `grep -rn <CONST> src/` outside the
defining file.

Combined, three files in this domain (`lifecycle.rs`, `booking.rs`,
`bookings_queries.rs`) carry >1000 lines of confirmed dead code — deleting it
first, before any restructuring, shrinks the rework surface by roughly a
quarter with zero behavior risk (still worth a `cargo check --all-features`
pass after, since `#[allow(dead_code)]` suppresses the compiler's own signal).

## 10. Naming footgun

`services/booking.rs` (singular, 31 lines: `generate_booking_number_for_date`,
dead `generate_booking_number` at line 22 `#[allow(dead_code)]`,
`fetch_booking_by_id`) vs. `services/bookings.rs` (plural, 623 lines, the real
service layer). `lifecycle.rs:13` imports the singular module as `booking_svc`;
`services/bookings.rs:13` imports the same singular module as `booking_service`
— and `handlers/bookings.rs:8` separately uses the name `booking_service` to
mean the *plural* module. Three different aliasing conventions for two
similarly-named modules in the same domain.

## 11. Test coverage

`tests/booking_service.rs` (1899 lines) has solid live-Postgres coverage
including fault-injection (`install_audit_failure_trigger`,
`install_checkin_audit_failure_trigger`) proving `void_booking` and
`checkin_booking_flow` roll back atomically on a late audit-insert failure, plus
concurrency tests for void/checkin/reactivation/creation. `tests/ledger_service.rs`
covers `update_booking_handler`'s checkout-ledger-posting and rate-change
scenarios on the happy path (`postgres_checkout_auto_posts_company_ledger_and_syncs_total_delta`,
`postgres_void_booking_leaves_auto_posted_ledger_row_untouched`). **No test
exercises `update_booking_handler` under partial failure** (no
`install_*_failure_trigger`-style test for it), which is notable precisely
because — per §7a — it is the one booking mutation with no transaction to roll
back in the first place; its siblings that DO have such tests also have the
transaction that makes the test meaningful.

## Summary of decisions vs. facts

Everything above is a structural/architectural finding, not a business-policy
question — no policy-decision items in this dimension's scope (the money-policy
ambiguities here, e.g. "should void reverse the city ledger", are already
tracked in `docs/ongoing-dev.md` and out of scope for this layering audit).
