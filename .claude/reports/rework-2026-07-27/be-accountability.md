# Backend Accountability Audit — Bookings / Payments / Ledgers

Scope: hotel-app-be/src/{routes,handlers,services,repositories}/{bookings,payments,ledgers,booking_channels}
and repositories/bookings/{lifecycle,complimentary,credits,checkin_advisory}.rs.
All line numbers verified via Grep/Read in this session (2026-07-27); none reused from refs.

## Sweep 1 — Audit coverage enumeration

Command: `grep -n "^pub async fn\|^pub fn" <routes file>` to enumerate mutating endpoints, then
`grep -n "AuditLog::log" <service/repository file>` per domain to check coverage. Full commands run:

```
grep -rn "AuditLog::log" src/repositories/bookings/ src/repositories/payment.rs src/repositories/ledger.rs \
  src/repositories/booking_channels.rs src/services/bookings.rs src/services/payments.rs \
  src/services/ledgers.rs src/services/booking_channels.rs src/handlers/*.rs
```
Hit count: 34 call sites total (bookings: 8, payments: 15, ledgers: 8 via `AuditLog::log_event`, booking_channels: 0).

### Bookings domain — mutation → audit status
| Endpoint (route) | Function | Audited? |
|---|---|---|
| POST /bookings | lifecycle.rs:913 create_booking_handler | YES — `log_booking_created` (lifecycle.rs:1179-1181, post-commit, `let _ =`) |
| PATCH/PUT /bookings/{id} | lifecycle.rs:1249 update_booking_handler | YES — `log_booking_updated` (lifecycle.rs:1885, `let _ =`) but see Finding 1/10 |
| DELETE /bookings/{id}, POST /bookings/void | services/bookings.rs:140 void_booking | YES — `log_booking_voided_tx` in-tx (services/bookings.rs:204) |
| POST /bookings/my-bookings/{id}/cancel | services/bookings.rs:86 cancel_pending_booking_by_guest | YES — `log_booking_voided_tx` in-tx (services/bookings.rs:129) |
| POST /bookings/{id}/checkin, /auto-checkin, /auto-checkin (guest) | services/bookings.rs:292 checkin_booking_flow_for_booking (shared) | YES — `log_event_tx` in-tx (services/bookings.rs:436) |
| POST /bookings/{id}/reactivate | services/bookings.rs:506 reactivate_booking | PARTIAL — `log_event` post-write, **not in a transaction**, result discarded via `let _ =` (line 555) |
| PATCH /bookings/{id}/pre-checkin | lifecycle.rs:2463 pre_checkin_update_handler | **NO** — zero AuditLog reference anywhere in the function |
| POST/PATCH/DELETE /bookings/{id}/complimentary, /convert-credits | complimentary.rs:15,224,382,543 | **NO** — zero `AuditLog::` hits in the entire file (verified: `grep -c AuditLog complimentary.rs` = 0) |
| POST /bookings/book-with-credits | credits.rs:19 book_with_credits_handler | **NO** — zero AuditLog/tx/booking_history in ~228 lines |
| GET/POST /guests/credits (add) | credits.rs:287 add_guest_credits_handler | YES — `log_event` (credits.rs:369) |
| PATCH /guests/{id}/credits/{id} | credits.rs:427 update_guest_credits_handler | **NO** |
| DELETE /guests/{id}/credits/{id} | credits.rs:530 delete_guest_credits_handler | **NO** — and `user_id` isn't even threaded to the handler (routes/bookings.rs:352-359 discards the permission check's returned id) |

### Payments domain — audited functions (15 `AuditLog::` sites in services/payments.rs)
create_payment, record_payment, refund_deposit, revert_deposit_refund, update_payment, delete_payment,
generate_invoice, create_bank_transfer_claim, capture path, approve/reject (`complete_and_confirm`,
`reject_payment_by`), request_payment_receipt, PayPal webhook (`audit_paypal_webhook`) — all audited.
Weakness is not coverage but audit **content** (Finding 7) and post-commit-`?` fragility (Finding 10).

### Ledgers domain — all 8 mutations audited
create/update/delete_customer_ledger, create/update/delete_ledger_payment, void_ledger,
create_ledger_reversal — every one calls `AuditLog::log_event` (services/ledgers.rs, one call per
function, lines 55,104,131,155,195,220,248,272). Coverage is complete; the gap here is
**transactional integrity**, not audit presence (Finding 3).

### Booking-channels domain — 0 of 3 mutations audited
create_channel/update_channel/deactivate_channel (routes/booking_channels.rs) → services/repositories
booking_channels.rs — confirmed 0 hits for `AuditLog` in both files, and none of the three handlers
even accept a `user_id` parameter (Finding 9).

**No-audit-write list (complete for these three domains):** pre_checkin_update_handler;
mark_complimentary_handler; convert_complimentary_to_credits_handler; update_complimentary_handler;
remove_complimentary_handler; book_with_credits_handler; update_guest_credits_handler;
delete_guest_credits_handler; booking_channels create/update/deactivate.

## Sweep 2 — Swallowed errors

Command: `grep -rn "let _ = \|\.ok();\|unwrap_or_default()\|unwrap_or(\|unwrap_or_else(|_|" <domain files>`
Hit count in scope: 9 `let _ =` sites outside AuditLog (listed below) + 2 `.ok()` sites on
`booking_modifications` inserts (complimentary.rs:203,614; lifecycle.rs:1931) + the two dead-code
`#[allow(dead_code)]` functions that are themselves evidence of an abandoned better pattern.

Confirmed NOT a poisoned-transaction case (the historical `let _ =` inside `&mut tx` trap): every
`let _ =`/`.ok()` in this scope operates on `&pool` directly, never `&mut tx` — so none of them can
abort an in-flight transaction. They are still real accountability gaps because the swallowed write
IS the record of what happened:

- lifecycle.rs:1609 `let _ = sqlx::query("UPDATE rooms SET status = $1...")` — inside update_booking_handler's room-move branch; a failed room-status flip after a booking moves rooms leaves the room's status wrong with no error and no log line at all (no `log::warn!`, just discarded).
- lifecycle.rs:1663 `let _ = recompute_payment_status(...)` — after voiding all payments via the update-endpoint's void-like branch; failure leaves `payment_status` stale on a voided booking.
- lifecycle.rs:1807 `let _ = sqlx::query("UPDATE rooms SET status = 'occupied'...")` — same pattern, no `log::warn!`.
- lifecycle.rs:1931 `.execute(&pool).await.ok()` — the generic `booking_modifications` audit-trail insert for ANY update_booking_handler edit; failure is completely invisible.
- lifecycle.rs:1936 `let _ = recompute_payment_status(...)` — end of update_booking_handler; a rate/date change can leave payment_status wrong with zero signal.
- services/bookings.rs:588 `let _ = record_booking_reactivation_modification(...)` — reactivate_booking's own modification-trail write, discarded.
- complimentary.rs:203, :614 `.execute(&pool).await.ok()` — the ONLY trail mark_complimentary_handler / remove_complimentary_handler produce, and it's explicitly discardable.
- repositories/payment.rs:409 `let _ = guest_id;` — not a DB call, a lint-silencing binding; not an accountability issue (verified, noted only to explain why it matched the grep).

Business consequence, summarized: every swallowed write above sits on a **duplicate, weaker path**
(the update-endpoint's inline void/room-move logic, and the complimentary sub-domain) that runs
parallel to a properly-audited primary path elsewhere in the same codebase — see Findings 1, 4, 8.

## Sweep 3 — Transaction boundaries

Command: `grep -n "pool.begin\|tx.commit\|SAVEPOINT" <file>` per repository file, cross-checked by reading
each named multi-step mutation.

| Mutation | One transaction? | Evidence |
|---|---|---|
| create_booking_handler (booking + optional deposit) | YES | lifecycle.rs: `.begin()` then `tx.commit()` (verified around lines 932→1168); audit/history explicitly post-commit by design comment "outside transaction - non-critical" |
| void_booking / cancel_pending_booking_by_guest | YES | services/bookings.rs:106-130, 179-206 — tx wraps void+release_room+void_payments+recompute+history+modification+audit_tx; loyalty-point reversal is post-commit, failure only `log::warn!`ed (services/bookings.rs:208-221) |
| manual/auto check-in (shared flow) | YES | services/bookings.rs:318-480 — one tx across room-check, guest/booking edits, transition, payment, room-occupy, history, audit_tx, self-checkin event; only the night-audit backfill is deliberately post-commit (documented as idempotent) |
| **update_booking_handler generic edit (incl. status→voided)** | **NO** | 636-line function (lifecycle.rs:1249-1885) contains zero `pool.begin()` — every UPDATE, the payments-void, the loyalty reversal, and the audit/history writes are independent pool calls (Finding 1) |
| **reactivate_booking (wired path)** | **NO** | services/bookings.rs:506-591 — 4 independent pool calls, no tx (Finding 8) |
| **pre_checkin_update_handler** | **NO** | 2 independent UPDATEs (guests, then bookings), no tx (Finding 2) |
| **mark/update/remove_complimentary_handler** | **NO** | complimentary.rs — every one issues 2-3 sequential pool statements with no tx (Finding 4) |
| **book_with_credits_handler** | **NO** | credits.rs:19-247, no tx found |
| create_payment / record_payment | record_payment YES (services/payments.rs:197-278 tx); create_payment's own repo call is transactional (repositories/payment.rs:192-242) but the follow-up `recompute_payment_status` at services/payments.rs:149 runs after that commit, outside any tx (Finding 10) |
| approve/reject payment (`complete_and_confirm`, `reject_payment_by`) | YES | services/payments.rs:1555-1608 — full tx incl. audit_tx, with an explicit in-tx "defense in depth" duplicate-completion guard |
| **customer-ledger payment CRUD (create/update/delete_ledger_payment)** | **NO — none of it** | repositories/ledger.rs has ZERO `begin`/`tx.` occurrences in the whole 1282-line file (Finding 3) |
| void_ledger / create_ledger_reversal | NO tx, but each is a single INSERT/UPDATE statement so atomicity is less at risk (still no audit-in-tx guarantee since services/ledgers.rs calls AuditLog::log_event post-write on `pool`) |
| booking-channel CRUD | single-statement repository calls; no tx needed but also no audit (Finding 9) |

No SAVEPOINT usage found anywhere in the three domains (`grep -rn "SAVEPOINT" src/repositories src/services` → 0 hits in this scope) — the codebase's only defense against best-effort-inside-a-transaction is "don't put the risky call inside the transaction at all" (e.g. night-audit backfill, loyalty award/reversal), which is a sound pattern where used, but the update_booking_handler / reactivate_booking / complimentary paths don't use ANY transaction, so it's not a SAVEPOINT gap there — it's a missing transaction entirely.

## Sweep 4 — Permissions

Command:
```
grep -n 'require_permission_helper(&pool, &headers, "' src/routes/{bookings,payments,ledgers,booking_channels}.rs
grep -n "^    ('bookings:\|^    ('payments:\|^    ('ledgers:\|^    ('guests:" database/postgres/data.sql   # expected_system_permissions block, lines 51-185
```
Every permission string used in routes/{bookings,payments,ledgers,booking_channels}.rs
(`bookings:{read,create,update,delete}`, `guests:{read,manage}`, `payments:{read,create,update,delete,
refund,approve}`, `ledgers:{read,create,update,void,manage}`, `settings:update`, `analytics:read`,
`reports:execute`) is present verbatim in `expected_system_permissions` (data.sql:51-185). **No typos
found.**

Routes without a permission gate (enumerated, not an impression):
- `GET /bookings/my-bookings`, `POST /bookings/my-bookings/{id}/cancel` — `require_auth` only. Correct by
  design: ownership is checked inside the service (`user_owns_booking`, `is_guest_cancellable_booking`).
- `POST /bookings/book-with-credits` — `require_auth` only; ownership enforced in-handler via
  `can_book_with_credits_for_guest` (verified credits.rs:24-34). Correct.
- `GET /rate-codes`, `GET /market-codes` — explicitly public, read-only reference data. Not a concern.
- **`PATCH /bookings/{id}/pre-checkin`** — **zero auth, zero permission, zero ownership check** (Finding 2).
- **`PATCH/PUT /bookings/{id}` (update_booking_handler)** — gated on `bookings:update` at the route, but
  the handler's own `owns_booking` OR-bypass (lifecycle.rs:1274) means ANY user who merely owns the
  booking can also reach it with no field restriction — including setting `status: "voided"`
  (Finding 1). This is a real gate, just wider than the route annotation suggests.

## Sweep 5 — Idempotency

| Externally-triggerable mutation | Mechanism | Verdict |
|---|---|---|
| PayPal webhook (`apply_paypal_webhook_event`, services/payments.rs:1141) | Checks `review.status` before acting; `"completed"` → returns `AlreadyApplied` + audits `paypal_webhook_duplicate` (services/payments.rs:1202-1211); mismatched booking/payment-method → audited `ignored` | Solid, explicit idempotency + audit trail (recent commit 214305432 "add audit event support to PayPal webhook handler" matches) |
| Guest bank-transfer claim (`create_bank_transfer_claim`, :735) | `ensure_no_active_booking_payment` SELECT check BEFORE `pool.begin()` for the insert | Check-then-act race window (two near-simultaneous submits could both pass); mitigated in practice because `complete_and_confirm`'s in-tx `has_other_completed_booking_payment_tx` (Finding 13) stops both from being *approved*, but two pending rows can still be created |
| `generate_invoice` (:490) | `find_invoice_by_booking_id` check, then un-transactioned `next_invoice_number` + insert | Check-then-act race; **no unique constraint on `invoices.booking_id`** (only on `invoice_number`, `uuid` — migrations/0001_v1_baseline.sql:5435,5451) so a race can create two distinct invoice numbers for one stay (Finding 12) |
| Company/customer ledger auto-post | Not reached in this scope (no auto-post call found in routes/ledgers.rs or services/ledgers.rs — ledger creation here is always explicit `POST /ledgers`, not webhook-triggered) | N/A to this sweep |

---

## Findings

### 1. [accountability/high] `update_booking_handler` can void a booking through a second, non-transactional path that bypasses `void_booking()`'s guarantees
- File: `hotel-app-be/src/repositories/bookings/lifecycle.rs:1249-1939` (status handling ~1283-1300; void-like branch ~1600-1680)
- The generic PATCH/PUT `/bookings/{id}` accepts `status: "voided"` (only `"cancelled"`/`"comp_cancelled"` are rejected, lifecycle.rs:1285-1290) and is reachable by anyone who merely owns the booking (`owns_booking` OR-bypass, lifecycle.rs:1274, no staff permission required). Once triggered, the void-like side effects (release room via `UPDATE rooms`, void all linked payments, recompute payment status, reverse loyalty points) run as independent, non-transactional statements with **no state-machine guard** preventing e.g. `checked_in → voided`. This duplicates `services/bookings.rs::void_booking` (which IS transactional, in-tx-audited, and permission-gated) with a strictly weaker implementation.
- Failure scenario: a guest PATCHes their own already-checked-in booking to `status: "voided"`; the booking flips to voided and the room is released and payments are voided (each a separate statement — see Finding 10-style partial failure), with no atomicity and, per Sweep 2, several of the trailing steps silently swallowed on error.
- Recommendation: reject `status: "voided"` (and any other terminal-state transition) from the generic update endpoint entirely — route such transitions only through `void_booking()`/reactivate flows that own their invariants; add a state-machine allow-list for `input.status` transitions.

### 2. [accountability/blocker] `pre_checkin_update_handler` is a public, unauthenticated PII-mutation endpoint with zero audit trail
- File: `hotel-app-be/src/routes/bookings.rs:221-228` (route, explicit "Public endpoint" comment), `hotel-app-be/src/repositories/bookings/lifecycle.rs:2463-2544` (handler)
- No `require_auth`, no permission check, no ownership/token verification of any kind — only the numeric `booking_id` path parameter (any pending/confirmed booking). The handler overwrites the linked guest's name, email, phone, IC/passport number, nationality, and address, then flags `pre_checkin_completed`, via two independent non-transactional UPDATEs. Zero `AuditLog` reference in the function.
- Failure scenario: anonymous caller enumerates small integer booking IDs and overwrites another guest's IC number/contact details with attacker-supplied values; nothing in `audit_logs` records that this happened or from where.
- Recommendation: require a booking-scoped verification token/link (not just the numeric id) and add an audit event capturing the pre-change values, even for the "public" self-service flow.

### 3. [accountability/high] Customer-ledger payment CRUD has zero SQL transactions and no row locking — lost-update race on `paid_amount`
- File: `hotel-app-be/src/repositories/ledger.rs:730-865` (`create_ledger_payment`), `:1083-1209` (`update_ledger_payment`), `:1212-1281` (`delete_ledger_payment`)
- Verified: `grep -n "begin\|Transaction\|tx\." src/repositories/ledger.rs` → 0 hits in the entire 1282-line file. Each function does a validating SELECT, then an INSERT/UPDATE/DELETE on `customer_ledger_payments`, then a separate UPDATE recomputing `customer_ledgers.paid_amount`/`status` — 3-5 independent round trips with no `SELECT ... FOR UPDATE`.
- Failure scenario A (partial failure): process/connection drops between the payment-row write and the ledger-recompute UPDATE — the ledger's cached `paid_amount`/`status` is now permanently wrong relative to its own payment rows, with nothing to re-derive it.
- Failure scenario B (lost update): two concurrent `create_ledger_payment` calls on the same ledger both read the same stale `current_paid` before either commits its UPDATE; both individual payment INSERTs succeed, but the second `customer_ledgers` UPDATE overwrites the first's contribution — the ledger's displayed `paid_amount` undercounts a real, recorded payment.
- Recommendation: wrap each function in `pool.begin()`, and `SELECT ... FOR UPDATE` the ledger row before computing the new total.

### 4. [accountability/high] Entire complimentary-booking sub-domain has zero `services/audit.rs` coverage
- File: `hotel-app-be/src/repositories/bookings/complimentary.rs` (all functions: `mark_complimentary_handler:15`, `convert_complimentary_to_credits_handler:224`, `update_complimentary_handler:382`, `remove_complimentary_handler:543`)
- Verified: 0 matches for `AuditLog::` anywhere in this file. `mark_complimentary_handler` can discount a booking to $0 (fully complimentary) or any partial amount, gated only on generic `bookings:update`. The only trail is an `INSERT INTO booking_modifications` whose error is explicitly discarded via `.ok()` (complimentary.rs:203, :614) — so even that fallback can vanish silently, and there's no queryable `audit_logs` row regardless.
- Recommendation: add `AuditLog::log_event` calls (action `booking_marked_complimentary` / `_updated` / `_removed`) capturing before/after total and reason, and propagate the `booking_modifications` insert error instead of `.ok()`.

### 5. [correctness/high] `remove_complimentary_handler` never reverses the credit nights granted by `mark_complimentary_handler` — self-documented gap
- File: `hotel-app-be/src/repositories/bookings/complimentary.rs:600-601` (comment), function body `:543-622`
- The function's own comment reads: `"Remove any credits that were added (if applicable) // Note: This is a simplification - in production you might want more sophisticated tracking"` — and indeed no `guest_complimentary_credits` UPDATE/DELETE occurs in the removal path, only in the granting path (complimentary.rs:160-189).
- Failure scenario: staff marks a booking complimentary (grants N nights of `guest_complimentary_credits` to the guest), then removes complimentary status (booking's charge is restored) — the guest keeps the N credit nights and can redeem them on an unrelated future booking. Because Finding 4 also applies, there is no audit trail to detect this pattern being exploited or repeated.
- Recommendation: this is a real bug, not solely a policy question — the "restore charge" and "restore credits" operations should be atomic and symmetric with the grant. (Whether *removal* should even be allowed after credits may already have been spent elsewhere is a policy question or a hotel-ops decision — flag as policy-decision if pursued.)

### 6. [accountability/medium] Credit-consuming and credit-erasing booking paths are unaudited; DELETE doesn't even receive the actor's id
- File: `hotel-app-be/src/repositories/bookings/credits.rs:19-247` (`book_with_credits_handler`), `:427-530` (`update_guest_credits_handler`), `:530-585` (`delete_guest_credits_handler`); route: `hotel-app-be/src/routes/bookings.rs:352-359`
- `book_with_credits_handler` creates a real booking and consumes guest credit-nights with zero transaction, zero `AuditLog`, and zero `booking_history` row (verified via `awk 'NR==19,NR==247' credits.rs | grep -n "AuditLog\|begin()\|tx.commit\|record_booking_history"` → no output), unlike the properly-audited main `create_booking_handler`. Only `add_guest_credits_handler` (credits.rs:369) calls `AuditLog::log_event`; `update_guest_credits_handler` and `delete_guest_credits_handler` do not. The DELETE route handler (routes/bookings.rs:352-359) discards the `user_id` returned by `require_permission_helper` (`require_permission_helper(...).await?;` with no binding) and never passes it to `handlers::bookings::delete_guest_credits_handler`, so the actor who erased a guest's credit balance cannot be recovered even if audit logging were added later without also changing this call site.
- Recommendation: add `AuditLog::log_event` to all three; thread `user_id` through the DELETE route into the handler.

### 7. [accountability/high] Hard-deleting a payment discards the amount before the audit event can record it
- File: `hotel-app-be/src/repositories/payment.rs:1218-1251` (`PaymentRepository::delete_payment`), `hotel-app-be/src/services/payments.rs:595-626` (`delete_payment` service, audit call at :606-619)
- `delete_payment` issues a genuine SQL `DELETE FROM payments WHERE id = $1` (guarded only against `payment_type = 'refund'`). Before deleting, it selects only `id, payment_type, booking_id` — never `amount`, `payment_method`, or `transaction_reference`. The resulting `payment_deleted` audit event (services/payments.rs:606-619) can therefore only ever contain `{"booking_id": ...}` — the money amount and method of what was destroyed is unrecoverable from the audit trail once the transaction commits.
- Recommendation: select the full row before deleting and include `amount`/`payment_method`/`payment_reference` in the audit `details` JSON.

### 8. [maintainability/accountability/medium] The wired `reactivate_booking` is the weaker of two implementations; a correct, transactional one sits unused as dead code
- File: `hotel-app-be/src/services/bookings.rs:506-591` (wired, via `handlers::bookings::reactivate_booking_handler` → `routes/bookings.rs:361-368`) vs. `hotel-app-be/src/repositories/bookings/lifecycle.rs:2549-2670+` (`#[allow(dead_code)] pub async fn reactivate_booking_handler`, confirmed unused: `grep -rn "lifecycle::reactivate_booking_handler\|reactivate_booking_handler" src/` shows only its own definition as a match besides the routes.rs call into the *other* one)
- The wired version performs its 4 writes (state UPDATE, `AuditLog::log_event`, `record_booking_history`, `record_booking_reactivation_modification`) as independent `pool` calls with two of the three trailing writes' `Result`s discarded via `let _ =` (bookings.rs:555, :588). The dead version at lifecycle.rs:2549 wraps the equivalent operation in `pool.begin()`/`tx.commit()` with `AuditLog::log_event_tx` and `record_booking_history_tx` — i.e., the correct pattern already exists in this file tree.
- Recommendation: replace the wired `reactivate_booking` with the transactional pattern (or delete the dead copy and fix the live one to match); do not let a `#[allow(dead_code)]` shadow of a fix rot next to the bug it fixes.

### 9. [accountability/medium] Booking-channel (OTA source) CRUD has no audit trail and doesn't capture the actor
- File: `hotel-app-be/src/routes/booking_channels.rs:51-77`, `hotel-app-be/src/services/booking_channels.rs` (26 lines, pure passthrough), `hotel-app-be/src/repositories/booking_channels.rs`
- `create_channel`/`update_channel`/`deactivate_channel` are gated on `settings:update` but none of the three handler functions accepts `Extension(user_id)` at all — confirmed by reading both `handlers/booking_channels.rs` (39 lines) and `services/booking_channels.rs` (26 lines) in full. Zero `AuditLog::` references anywhere in the chain.
- Recommendation: thread `user_id` through routes → handlers → services and add `AuditLog::log_event` for create/update/deactivate.

### 10. [accountability/medium] Recurring pattern: a post-commit follow-up call uses `?`, turning an already-committed success into a client-visible failure
- Files/lines: `hotel-app-be/src/repositories/bookings/lifecycle.rs:1168-1176` (`tx.commit()` then `recompute_payment_status(&pool, ...).await?`); `hotel-app-be/src/services/payments.rs:141-149` (`create_payment`, after `PaymentRepository::create_completed_payment`'s own internal commit); `hotel-app-be/src/services/payments.rs:411-420` (`refund_deposit`, after `PaymentRepository::refund_deposit`'s internal commit at `repositories/payment.rs:826`); `hotel-app-be/src/services/payments.rs:455-462` (`revert_deposit_refund`)
- In each case the primary mutation is already transactionally committed by the time the follow-up recompute call runs; because that call is awaited with `?` rather than logged-and-swallowed (contrast with the deliberate post-commit "auxiliary" pattern used for night-audit backfill and loyalty points, which are explicitly documented as safe-to-fail), a transient failure here makes the API return an error for an operation that actually succeeded and was persisted.
- Failure scenario: `create_booking_handler`'s deposit-payment path commits the booking+deposit, then the payment-status recompute call fails (e.g. a momentary pool exhaustion) — the client sees a 500 and, per common UX, may retry booking creation, producing a duplicate booking while the original sits in the DB with a stale `payment_status`.
- Recommendation: treat the recompute call the same as the loyalty/night-audit auxiliary calls — log-and-continue rather than propagate, or move it inside the original transaction.

### 11. [accountability/low-medium] `AuditLog::log_event` can never report a failure, and its 20+ call sites' `let _ =` add no additional risk but also no additional safety
- File: `hotel-app-be/src/services/audit.rs:16-48`
- `log_event` catches every error from `AuditRepository::insert_event` internally, `log::warn!`s it, and always returns `Ok(())` — so every `let _ = AuditLog::log_event(...)` call site in bookings/payments/ledgers (grep count: ~20) is decorative; the swallowing already happened one layer down. An audit-log outage (e.g. `audit_logs` table locked, disk full) is invisible anywhere except a text log line — no counter, no alert, no way to later prove "no audit events were dropped on this date."
- The comment at audit.rs:29-30 ("the audit_logs table may not exist yet... prepared for future migration") is stale — the table is created in the baseline and actively used by every domain in this audit.
- Recommendation: consider a fallback insert path (e.g., a dead-letter table or a metrics counter) so a systemic audit-write outage is detectable, and update the stale comment.

### 12. [correctness/idempotency/medium] `generate_invoice` can create two invoices for one booking under concurrent requests
- File: `hotel-app-be/src/services/payments.rs:490-521`; schema: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql:5435` (`invoices_invoice_number_key UNIQUE`), `:5451` (`invoices_uuid_key UNIQUE`) — no unique constraint on `invoices.booking_id` (only an FK at :8687)
- `generate_invoice` checks `find_invoice_by_booking_id` and, if none exists, allocates `next_invoice_number` and inserts — all as separate, un-transactioned pool calls with no advisory lock. Two concurrent calls (double-click, retried request) can both pass the initial check and each successfully insert a row, consuming two numbers from the invoice sequence for the same stay.
- Recommendation: wrap the check+allocate+insert in a transaction with `SELECT ... FOR UPDATE` on the booking row, or add a unique constraint on `invoices.booking_id` (schema decision — some flows may legitimately need multiple invoices per booking, e.g. corrections, so confirm with hotel ops before adding a hard constraint).

### 13. [test-gap/low] Ledger payment CRUD, complimentary mark/remove, and booking-channel CRUD have no test coverage exercising the failure paths above
- Evidence: none of `create_ledger_payment`/`update_ledger_payment`/`delete_ledger_payment`, `mark_complimentary_handler`/`remove_complimentary_handler`, or booking-channel CRUD appeared in any `tests/*.rs` grep during this audit (spot-checked: `grep -rln "create_ledger_payment\|mark_complimentary_handler\|booking_channels::create" hotel-app-be/tests/` → no matches). These are exactly the functions with the transactional/audit gaps above (Findings 3, 4, 5, 9) — the absence of a test is why the gaps have persisted undetected.
- Recommendation: a live-Postgres test asserting `customer_ledgers.paid_amount` after two concurrent `create_ledger_payment` calls would directly reproduce Finding 3's lost-update.

### 14. [policy-decision] Should a mere booking owner ever be allowed to set `status` directly via the generic update endpoint?
- Two options with different business outcomes: (a) restrict `PATCH/PUT /bookings/{id}` so a non-staff caller (ownership-only, no `bookings:update`/`manage`) can only edit guest-facing fields (contact info, special requests) and never `status`/`room_id`/`deposit_*`, pushing all status transitions through dedicated, invariant-owning endpoints (`void_booking`, `cancel_pending_booking_by_guest`, staff check-in); or (b) keep the current single generic endpoint but add an explicit, tested state-machine guard so only intentionally-allowed transitions succeed for non-staff callers. Both fix Finding 1's authorization surface, but (a) is a bigger API-shape change while (b) is more surgical — this is a product/ops call, not a code-only decision, since it affects what guests are allowed to self-service.
