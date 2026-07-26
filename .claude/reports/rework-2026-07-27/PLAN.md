# Booking / Payment / Ledger Rework Plan

**Date:** 2026-07-27
**Scope:** `hotel-app-be` bookings + payments + ledgers (+ invoices, company billing, guest-portal seams) and the matching `hotel-web-fe` surfaces, for both guest and admin flows.
**Source:** 11-dimension audit, 142 findings, reports in `.claude/reports/rework-2026-07-27/`.
**Author's stance:** this is a live hotel system holding real money. Every phase below decomposes or guards existing code. Nothing is rewritten from scratch, and no money policy is decided here.

---

## 0. Executive summary

The three domains are the last on the legacy `routes/ → handlers/ → services/ → repositories/ → models/` layout, and they have degraded past "legacy but coherent" into three specific structural pathologies:

1. **The service layer does not exist for bookings.** `hotel-app-be/src/services/bookings.rs:3` is `pub use crate::repositories::bookings::*;`. The functions that layer "exports" physically live in `repositories/bookings/lifecycle.rs` and import Axum extractors (`lifecycle.rs:17-20`) and call `AuthService::check_permission` directly. There is no seam at which to add a transaction, an audit rule, or a permission rule once.
2. **Money rules are implemented more than once, and the copies disagree.** Four invoice/booking-total calculators exist; two read `bookings.total_amount` and two recompute from `room_types.base_price`. Two booking-creation implementations exist (admin and guest portal); they disagree on tourism tax and rate plans. Three "is this my booking" checks exist and disagree.
3. **`repositories/ledger.rs` has no transactions at all** (verified: `grep -c "begin()"` → `0` over 1282 lines), so every ledger payment write is a read-modify-write race on `paid_amount`.

Total verified: **10 blocker-severity findings**, of which 5 are money-visible and 2 are security-visible. These are fixed in Phases 1–3 *before* any structural work, because a refactor that carries a wrong invoice total forward just moves the bug into a nicer file.

The target is the house `modules/<domain>/{routes,handlers,service,repository,models,validation}.rs` pattern already used by 7 domains — verified against `modules/promotions/` (routes 58, handlers 266, service 773, repository 786, models 256, validation 370) and `modules/support/`. That pattern puts `require_permission_helper` in `handlers.rs` next to the service call, keeps `routes.rs` a pure table, and keeps the repository free of Axum types. It is a 2-hop request path; the payments domain today is a 3-hop path with a 231-line pure pass-through `handlers/payments.rs`.

---

## 1. Target architecture — Backend

### 1.1 Module layout (end state)

```
hotel-app-be/src/modules/
  booking/                  (new — from repositories/bookings/*, services/bookings.rs, handlers/bookings.rs, routes/bookings.rs)
    routes.rs               route table only, no auth logic
    handlers.rs             require_permission_helper + one service call per fn, no SQL
    service.rs              transaction boundaries, audit, permission-or-ownership, state machine
    lifecycle.rs            (service submodule) create / update / status transitions
    checkin.rs              (service submodule) manual + auto check-in, advisory
    complimentary.rs        (service submodule) mark / update / remove / convert-to-credits
    credits.rs              (service submodule) guest credit CRUD + book-with-credits
    repository.rs           plain (pool | &mut tx, args) fns — zero Axum imports
    queries.rs              SQL constants (survivors of bookings_queries.rs)
    models.rs               BookingInput, BookingUpdateInput, responses
    validation.rs           stay-length, date order, status-transition allow-list
    status.rs               THE booking status vocabulary + is_legal_transition()
  payment/                  (new — from services/payments.rs 2011L, repositories/payment.rs 1426L)
    routes.rs / handlers.rs / models.rs / validation.rs
    service/
      recording.rs          create / record / update / delete / summary
      refunds.rs            refund_deposit / revert_deposit_refund
      invoices.rs           generate / preview / numbering (single atomic allocator)
      intake.rs             guest bank-transfer claim + receipt upload
      gateway_paypal.rs     order / capture / webhook reconciliation
      approvals.rs          approve / reject / request-receipt workflow
    repository/             split on the same six seams
  ledger/                   (new — from repositories/ledger.rs 1282L, services/ledgers.rs, handlers/ledgers.rs, routes/ledgers.rs)
    routes.rs / handlers.rs / models.rs / validation.rs
    service.rs              transactions + audit + status-transition guard
    repository.rs           entry CRUD, payment CRUD, summary (netted)
    posting.rs              auto-post from booking checkout (moved out of lifecycle.rs:543-668)
    statement.rs            company AR statement (moved out of repositories/analytics.rs:2228-2459)
```

`modules/mod.rs` gains `pub mod booking; pub mod ledger; pub mod payment;` and `routes/mod.rs::create_router` swaps `.merge(bookings::routes())` (line 217), `.merge(payments::routes())` (219), `.merge(ledgers::routes())` (220) for the `crate::modules::*::routes::routes()` form already used at lines 221-232. The old `routes/`, `handlers/`, `services/`, `repositories/` files for these domains are deleted, not left as shims — the 2026-07-27 user-module rework proved the compat-barrel deletion works and is machine-migratable.

### 1.2 Maintainability

| Rule | Mechanism |
|---|---|
| No file over ~900 lines | `lifecycle.rs` (3492) → six service submodules + repository + queries. `services/payments.rs` (2011) → six service files. `repositories/payment.rs` (1426) → same six seams. `repositories/ledger.rs` (1282) → service/repository/posting/statement. |
| Repository has no HTTP types | `repositories/bookings/checkin_advisory.rs` is the reference shape (plain `(pool, id)`). The 20-odd `*_handler` fns in `lifecycle.rs` / `credits.rs` / `complimentary.rs` lose their `_handler` suffix and their extractors. |
| One hop per layer | Fold `routes/payments.rs`'s inline auth into `handlers.rs` (house pattern) and delete the pass-through layer. |
| No glob re-export as a "layer" | Delete `pub use crate::repositories::bookings::*;`. Explicit named exports only. |
| Delete before restructuring | 669 dead lines in `lifecycle.rs`, ~183 in `repositories/booking.rs`, ~182 in `bookings_queries.rs`, `invoice_booking_details`, `QuickBookingModal.tsx` (944 lines). |

### 1.3 Accountability

| Rule | Mechanism |
|---|---|
| Every multi-table money mutation is one transaction | `pool.begin()` in `service.rs` only. Repository fns take `&mut DbTransaction<'_>` where they participate. `services/bookings.rs::void_booking` (140-229) is the reference: begin → N `_tx` calls → `AuditLog::log_event_tx` → commit. |
| No swallowed money errors | Ban `let _ = <money write>`. Three allowed shapes: `?` (inside tx), `if let Err(e) = … { log::error!(…) }` (explicitly best-effort, post-commit), or a durable `audit_logs` row with `action = "<op>_failed"` for finance reconciliation. |
| Audit is not optional | `services/audit.rs::log_event` currently always returns `Ok(())` (audit.rs:28-48). Inside a transaction use `log_event_tx` with `?`. Add a counter/dead-letter so a systemic audit outage is detectable. |
| Terminal transitions have one door | `status = "voided"` cannot be set through generic `PATCH /bookings/{id}`; it routes to `void_booking`. `status = "void"` cannot be set through `PATCH /ledgers/{id}`; it routes to `POST /ledgers/{id}/void`, which owns `void_at/void_by/void_reason` and the `ledgers:void` permission. |
| Attribution is complete | Every route captures `user_id` from `require_permission_helper` (today `routes/companies.rs:64,73` and `routes/bookings.rs:352-359` discard it). `update_ledger_payment` / `delete_ledger_payment` take and write `updated_by`. `delete_payment` reads amount/method/reference *before* deleting so the audit row can name what was destroyed. |
| Idempotency is enforced by the DB, not by check-then-insert | Partial unique index for "one completed booking payment per booking"; decide (policy) on `invoices.booking_id`. Existing `uq_customer_ledgers_booking_room_charge` (baseline:7678) is the model. |

### 1.4 Manageability — one place per rule

| Rule | Single home |
|---|---|
| Active/blocking booking statuses | `modules/booking/status.rs`. Replaces the literal at `lifecycle.rs:987,1354,3395`, `modules/guest_booking/repository.rs:15`, and the **shorter, wrong** list at `repositories/rooms_queries.rs:176`. |
| Legal status transitions | `modules/booking/status.rs::is_legal_transition(from, to)`, consulted by `update_booking` before it writes an arbitrary string. |
| Guest-cancellable statuses | `is_guest_cancellable_booking` exported once; `services/guest_portal.rs:349-356` calls it instead of re-listing. |
| Billable total of a booking | `PaymentWorkflowSummaryRow::billable_total()` (`models/payment.rs:285-287`) — the one definition. `ensure_checkout_balance_resolved`, `create_generated_invoice`, `calculate_payment_summary` all adopt it. |
| Invoice-number allocation | one atomic `(&mut tx)` allocator, in `modules/payment/service/invoices.rs`. Ledger calls it too. |
| Payment terms lookup | `repositories/company.rs::payment_terms_days(pool, company_name)`; `ledger.rs:347` and `lifecycle.rs:594` both call it. |
| "Is this my booking" | one ownership resolver over `user_guests`/`users.guest_id`; `GET_USER_BOOKINGS_QUERY`'s email join (bookings_queries.rs:135) is replaced by it. |
| Booking creation core | one `create_booking_core(&mut tx, params)` in `modules/booking/service/lifecycle.rs`, parameterized by channel (initial status, pricing source, tax policy). `modules/guest_booking::service::create` and admin create both call it. |

### 1.5 Efficiency

- `GET_BOOKINGS_BASE_QUERY` (`bookings_queries.rs:5-44`): the `customer_ledgers` correlated subquery appears **5 times** and `SUM(p.amount)` **5 times** per row (verified by grep count). Replace with one `LEFT JOIN LATERAL` per source, reused across the `payment_status` CASE / `total_paid` / `balance_due` expressions.
- `list_customer_ledgers` (ledger.rs:228/244), `list_pending_payments` (payment.rs:638), `list_payment_approval_history` (payment.rs:671): adopt `COUNT(*) OVER()` as `repositories/booking_list.rs` already does.
- `modules/guest_booking::service::search` N+1 (`apply_online_allocation` per room type): fold `online_inventory_allocations` into `list_inventory`'s aggregate, as `list_online_inventory` already does.
- FE: `useBookingsWithDetails()` with no filters (BookingsPage.tsx:236) fetches the **entire booking history** (500/page fan-out) to compute 7 client-side cards, and `invalidateBookingDependencies` re-fetches it on every mutation. Replace with a server-side arrivals/departures/balance-due aggregate.
- FE: `getCustomerLedgerSummary()` already exists, is tested, and has **zero callers**; the page recomputes the same number client-side over a full-table fetch, less correctly.

---

## 2. Target architecture — Frontend

```
hotel-web-fe/src/
  api/
    client.ts               unchanged — all HTTP still goes through ky
    paging.ts               NEW: fetchAllPages() — removes the duplicated fan-out in
                            bookings.service.ts:48-90 and ledger.service.ts:17-66
    bookings.service.ts     typed params (no Record<string,unknown> + `as any`)
    invoices.service.ts     typed returns (today 9/11 methods return `any`)
    ledger.service.ts       normalize errors to APIError like bookings.service.ts does
    queryKeys.ts            ledgers.fullList() vs ledgers.page(params);
                            paymentApprovals.history(page,size) factory added
    queryInvalidation.ts    unchanged; every mutation must route through it
  types/
    payment.types.ts        Invoice rewritten from models/payment.rs:304-332
                            (billing_name/uuid/issue_date/paid_amount/balance_due/currency)
    booking.types.ts        + subtotal/tax_amount/discount_amount/currency/created_by/ekyc_summary
                            − 8 fields no mapper ever emits
    dataTransfer.types.ts   stale comment at :375-377 deleted (root cause of the wrong Invoice type)
  utils/
    money.ts                unchanged — the money authority
    bookingNights.ts        NEW: ONE nights calculation (noon-normalized), replacing 6 copies
  features/bookings/
    hooks/useBookingMutations.ts   void / cancel-mine / create all go through
                                   invalidateBookingDependencies (today 3 bypass it)
    components/Bookings/
      BookingsPage.tsx      ~400 lines: layout + composition
      hooks/useBookingOperationsSummary.ts   server aggregate, not client filters
      dialogs/{Void,Reactivate,Payment,CheckIn,Workflow,Edit,Create}Dialog.tsx
  features/invoices/
    components/CheckoutInvoiceModal.tsx      ~500 lines
    components/ChargesBreakdownTable.tsx     NEW: shared by preview step, confirm step,
                                             and CheckoutInvoicePrintView (3 copies today)
    hooks/{useCheckoutPayments,useDepositResolution}.ts
  features/admin/components/CustomerLedger/
    CustomerLedgerPage.tsx   ~350 lines
    hooks/{useCompanyCheckIn,useCompanyPaymentFlow,useCompanyInvoiceFlow,useCompanyDirectory}.ts
```

**Permission gating (accountability, FE side).** `isAdmin` is already computed at `BookingsPage.tsx:153` from `bookings:update`/`bookings:manage` — the exact permission the backend requires for void/check-in/reactivate (`routes/bookings.rs:165,174,366`) — but it gates only the Edit button (:1799). Void (:1804), Reactivate (:1807), Check-in (:1780,1783) and Payment (:1796) render unconditionally; Payment needs a separate `payments:create` check. FE gating is UX, not security; the backend gate is the real one and stays.

**Guest vs admin parity (manageability).** One `ChargesBreakdownTable` + one backend billable-total means the guest "View Invoice" (`features/bookings/components/MyBookingsPage.tsx` → `InvoiceModal.tsx:40-42` → `GET /invoices/preview`) and the admin checkout invoice cannot disagree. Today they use two different formulas.

---

## 3. Phase table

| # | Title | Size | Behavior change | Risk | Blockers fixed |
|---|---|---|---|---|---|
| 1 | Authorization & PII containment | S | yes | low | 44, 43, 31, 66 |
| 2 | Dead-code deletion + single-source constants | M | **no** | very low | — |
| 3 | One booking total, one invoice total, netted ledger aggregates | M | yes (money display + guest-visible invoice) | high | 57, 105, 30, 95, 96, 93, 106, 108 |
| 4 | Transaction & audit integrity in ledger + booking + payment writes | L | yes (failure modes only) | high | 1, 45, 15, 16, 54, 49, 46, 50, 51, 73 |
| 5 | Integration-test net for the untested money paths | M | **no** | low | — (unblocks 6–8) |
| 6 | `modules/ledger/` extraction | M | **no** | medium | — |
| 7 | `modules/payment/` extraction | L | **no** | medium | — |
| 8 | `modules/booking/` extraction + shared booking-core | XL | **no** | high | 2, 78 |
| 9 | Query & round-trip efficiency | M | no (perf only) | medium | 59, 60, 79, 82, 100, 122 |
| 10 | FE contract layer + god-component decomposition | L | **no** | medium | 118, 119, 120(FE half), 86 |
| 11 | Cross-channel parity (policy-gated) | L | yes | high | 67, 68, 69, 70, 71, 76 |

Ordering rationale: Phase 1 is a live exposure (an unauthenticated endpoint that overwrites any guest's PII) so it precedes the structural cleanup despite being behavior-changing — the exception to "structural first" is deliberate and narrow. Phase 2 then removes 19% of the largest file before anyone reads it. Phase 3 fixes money the customer can see. Phase 4 fixes money the customer cannot see until it goes wrong. Phase 5 buys the safety net that makes 6–8 verifiable at all. 6→7→8 goes cheapest-domain-first so the pattern is proven on 1282 lines before it is applied to 3492.

---

## 4. Per-phase detail

### Phase 1 — Authorization & PII containment (S, behavior change)

**Goal:** close the two authorization holes and the one double-booking window. Nothing else.

**Files:**
- `src/routes/bookings.rs:221-228` + `src/repositories/bookings/lifecycle.rs:2463-2544` — `PATCH /bookings/{id}/pre-checkin` is registered with an explicit `// Public endpoint - no authentication required` comment and the handler takes only a numeric `booking_id`, does one `UPDATE guests` (first/last name, email, phone, ic_number, nationality, address) and one `UPDATE bookings`, non-transactionally, with zero `AuditLog` reference (verified: no `AuditLog|require_auth|check_permission` in 2463-2545). **The FE has no caller** (`BookingsService.preCheckInUpdate`, `api/bookings.service.ts:240`, is dead). Fix: require the booking-scoped `pre_checkin_token` (the column already exists on `bookings`) instead of the bare id, wrap both UPDATEs in one transaction, and add an audit event with before/after guest fields. If the user confirms the feature is abandoned, delete the route and the FE method instead — cheaper and strictly safer.
- `src/repositories/bookings/lifecycle.rs:1274-1278` — `owns_booking` ORs with `bookings:update`, so a non-staff booking owner reaches the full generic update handler. Fix: reject terminal/side-effecting statuses (`voided`, `comp_void`, `checked_in`, `checked_out`) from this endpoint entirely and route them to the functions that own their invariants. The field-level allow-list for non-staff callers is **Policy Q11** — until answered, Phase 1 only blocks the terminal transitions, which is unambiguously correct because a second, non-transactional void path is a defect under any policy.
- `src/repositories/ledger.rs:548-565` — the dynamic SET builder includes `status` with no allow-list, on a route gated by `ledgers:update` (routes/ledgers.rs:89) rather than `ledgers:void` (:155). Fix: reject `status = 'void'` in `update_customer_ledger`.
- `src/repositories/rooms_queries.rs:172-178` — `SEARCH_ROOMS_WITH_DATES_QUERY` blocks `'reserved','confirmed','checked_in','auto_checked_in','pending'` and omits `'pending_payment','pending_confirmation'` (verified against `modules/guest_booking/repository.rs:15`). Front desk can assign a room a guest just reserved online. Fix: use the shared constant introduced in Phase 2 — or inline the two missing statuses now and let Phase 2 dedupe.
- `src/routes/companies.rs:64,73` — capture `user_id` from `require_permission_helper` and thread it into `update_company`/`delete_company` (today hard-coded `user_id: None` at `services/companies.rs:77,99`). `companies.payment_terms_days` feeds ledger `due_date`, so this is ledger-adjacent attribution.

**Verification:**
```
cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/hotel-app-be"
cargo clippy --all-features --all-targets -- -D warnings > /tmp/p1.txt 2>&1; echo "EXIT=$?"
cargo test --all-features > /tmp/p1t.txt 2>&1; echo "EXIT=$?"
# live curl against dev :3030 — record each status:
#  PATCH /api/bookings/{id}/pre-checkin  no token  -> 401/403 (was 200)
#  PATCH /api/bookings/{id} {"status":"voided"} as owner-only user -> 400/403
#  PATCH /api/ledgers/{id} {"status":"void"} with ledgers:update only -> 400
#  POST  /api/ledgers/{id}/void with ledgers:void -> 200, void_by set
#  GET   /api/rooms?check_in_date=&check_out_date= excludes a pending_payment room
```
Add `tests/booking_authz.rs` asserting the two rejections; extend `tests/status_vocabulary.rs` for the shared status list.

**What could go wrong:** the pre-checkin endpoint may have a non-FE consumer (an email link, a kiosk). Grep `pre_checkin_token` usage and `communications` templates before removing; if a link flow exists, tokenize rather than delete. Blocking `voided` on the generic endpoint will break any FE code path that voids via `updateBooking` — grep `BookingsService.updateBooking` for `status: 'voided'` first.

---

### Phase 2 — Dead-code deletion + single-source constants (M, **no behavior change**)

**Goal:** shrink the surface before restructuring it. `git diff` should be almost entirely deletions.

**Deletions (all verified zero-caller):**
- `src/repositories/bookings/lifecycle.rs` — `delete_booking_handler` (1942-2105), `manual_checkin_handler` (2106-2462), `reactivate_booking_handler` (2549-2696). All three carry `#[allow(dead_code)]` at 1941/2105/2548. The same-named functions in `handlers/bookings.rs` (105, 125, 269) call `booking_service::void_booking` / `manual_checkin` / `reactivate_booking` — **verified by reading handlers/bookings.rs:105-133 and 269-277** — so the `lifecycle.rs` copies are unreachable. 664 lines, 19% of the file. Two of them contain bugs (the `manual_checkin_handler` copy has the 2026-07-10b transaction-poisoning `log::warn!`-instead-of-`?` pattern at 2236/2290 that the live path already fixed).
- `src/repositories/booking.rs` — 8 of 10 pub fns (`find_all_with_details`, `find_by_id`, `find_by_id_with_details`, `find_by_guest_id`, `create`, `update_status`, `check_in`, `check_out`, `exists`), ~183 lines. Keep `find_paginated_with_details` and `find_mapped_by_id`.
- `src/repositories/bookings_queries.rs` — `GET_BOOKINGS_QUERY` (50-95), `GET_TODAYS_CHECKINS_QUERY` (195-241), `GET_TODAYS_CHECKOUTS_QUERY` (242-288), `GET_ACTIVE_BOOKINGS_QUERY` (289-330); 182 of 330 lines.
- `src/repositories/payment.rs:1356-1410` — `invoice_booking_details`, `#[allow(dead_code)]`, zero callers, and it joins `users` where the FK targets `guests` (baseline:8195-8199) and decodes DATE as `NaiveDateTime`. Delete rather than fix.
- `src/constants.rs:29` — decide `PaymentStatus::Processing`: it is defended against in 4 guards (`payment.rs:463,513`, `payments.rs:908,1212`) and is never written anywhere. Either remove the vestigial arms or (better, and my recommendation) wire it as a real pre-capture marker in Phase 4 so a crash mid-PayPal-capture is distinguishable from "never attempted". Phase 2 only records the decision; no code change if we keep it.
- `hotel-web-fe/src/features/bookings/components/QuickBookingModal.tsx` (944 lines) + its export at `features/bookings/index.ts:2`. Verified: the barrel export is the only reference anywhere in `src`.
- `hotel-web-fe/.../BookingsPage.tsx` — `complimentaryDialogOpen` (declared :336, set true :590, set false :641) has **no `<Dialog open={complimentaryDialogOpen}>` anywhere in the file** (verified), and `handleMarkComplimentary` (:582) / `canMarkComplimentary` (:981) have no JSX caller. ~80 lines. **This is Policy Q12** — deleting removes a feature someone may have intended; wiring it adds one. Phase 2 deletes only if the user says the feature is not wanted, otherwise it is deferred to Phase 10.

**Consolidations (behavior-preserving):**
- New `src/modules/booking/status.rs` (or `repositories/bookings/status.rs` pre-extraction) holding the active-status list; referenced from `lifecycle.rs:987,1354,3395`, `modules/guest_booking/repository.rs:15` and `rooms_queries.rs:176`. Watch out: `rooms_queries.rs` interpolates into a `const &str`, the others too — keep it a `const &str` so nothing becomes a runtime format.
- `repositories/company.rs::payment_terms_days` — one lookup, called from `ledger.rs:347-356` and `lifecycle.rs:594-604`.
- `const RECOMPUTE_PAYMENT_STATUS_SQL` shared by `recompute_booking_payment_status` (payment.rs:76-109) and `_tx` (111-144), today byte-identical.
- Remove the redundant `|| check_permission(..., "<r>:manage")` clauses at `lifecycle.rs:277,1221,1260` and `services/bookings.rs:155,255,523` — `core/auth.rs:486-495`'s own doc comment says `check_permission` already implies `:manage`. Up to 3 RBAC-cache lookups per decision today.
- `hotel-web-fe/src/utils/bookingNights.ts` — one nights function. 6 divergent copies verified in the audit (`bookingUtils.ts:115`, `BookingsPage.tsx:1003`, `MyBookingsPage.tsx:153`, `EnhancedCheckInModal.tsx:649`, `GuestCheckInVerify.tsx:89`, `guestPortal/booking/utils.ts:47`). Adopt the noon-normalized guest-portal formula (most DST-safe). **`utils/bookingUtils.test.ts` (327 lines) and `guestPortal/booking/utils.test.ts` (108 lines) pin the current behavior — run them before and after; any diff is a real semantic change to surface, not to absorb.**

**Verification:** `cargo clippy --all-features --all-targets -- -D warnings` (redirect to file, read `$?` — never `${PIPESTATUS[0]}`, empty under zsh), `cargo test --all-features`, `bun run typecheck && bun run lint && bun run test` in `hotel-web-fe`. `git diff --stat` must show >1000 deleted lines and near-zero added.

**What could go wrong:** `repositories/bookings/mod.rs:12` is `pub use lifecycle::*;`, so a deleted name could still be referenced through the glob from an unexpected module — `cargo check --all-features` catches it, but also `cargo check --tests` (per lesson 2026-07-12, `cargo check` alone does not compile `tests/`). The status-constant consolidation changes `SEARCH_ROOMS_WITH_DATES_QUERY`'s result set — that is Phase 1's intended fix, so if Phase 1 shipped it, this is a no-op; if not, it is a behavior change and belongs in Phase 1's verification, not here.

---

### Phase 3 — One booking total, one invoice total, netted ledger aggregates (M, behavior change, **money-visible**)

**Goal:** every screen and every guard that quotes an amount for one booking quotes the same amount.

**Backend:**
- `src/services/payments.rs:103-126` `calculate_payment_summary` — verified: `subtotal = pricing.base_price * Decimal::from(nights)`, `tax_amount = Decimal::ZERO`, ignores `discount_amount`, `tourism_tax_amount`, `extra_bed_charge`, `rate_override_*`, `daily_rates`.
- `src/repositories/payment.rs:888-1072` `create_generated_invoice` — same wrong formula, plus `.bind("MYR")` hard-coded currency, and it is **idempotent-forever**: `get_invoice_preview` (services/payments.rs:523-531) returns the first generated invoice on every later call, so a wrong number is cached permanently.
- Both adopt the shape `insert_checkout_invoice` (payment.rs:1287-1326, verified to bind `b.total_amount`) and `billable_total()` (models/payment.rs:285-287) already use.
- `src/repositories/bookings/lifecycle.rs:739-770` `ensure_checkout_balance_resolved` (called from `update_booking_handler:1501`) compares only `bookings.total_amount` vs paid; adopt `billable_total()` so the backend enforces at least what the FE gate at `CheckoutInvoiceModal.tsx:210-213` already enforces.
- `src/repositories/ledger.rs:893-932` `get_ledger_summary` — verified: `SUM(amount)/SUM(paid_amount)/SUM(balance_due)` with `WHERE status NOT IN ('void')` and **no netting by `transaction_type`**. `create_ledger_reversal` (984-1073) inserts a same-amount, self-paid sibling row and never touches the original, so a $500 credit note reads as +$1000 billed / +$500 collected with outstanding unchanged. Fix: sign-net credit rows in `get_ledger_summary` and in `generate_company_ledger_statement` (analytics.rs:2240,2321). Whether the **original row's own balance** should also change is **Policy Q3** — the aggregate fix is correct under either answer and ships now.

**Frontend:**
- `.../CustomerLedger/hooks/useCustomerLedgerWorkspace.ts:68-113` — `summary` and `companyAggregates` sum `balance_due` with no void exclusion, while the backend's own endpoint excludes void and `void_ledger` never zeroes `balance_due` (a GENERATED column, baseline:2053). A voided-unpaid charge shows a company as owing money, contradicting `VoidLedgerDialog`'s own promise. Fix: route accumulation through the existing `isVoidedLedger`/`getLedgerBalanceDue` helpers, apply the same credit-note netting, and prefer `LedgerService.getCustomerLedgerSummary()` (`ledger.service.ts:164-166` — exists, tested at `ledger.service.test.ts:251-256`, zero callers) for the headline strip.
- `.../CustomerLedger/CustomerLedgerPage.tsx:973-980` — verified: the loop passes the **same** `receipt_number` to every `createLedgerPayment` call, and the backend rejects any receipt number that already exists **across all ledgers** (`ledger.rs:775-793`). Ledger #1 commits, ledger #2 throws, one generic toast, no rollback. Fix: per-allocation suffix, or (better) a batch endpoint that distributes in one transaction — the batch endpoint is the right answer and can be built in Phase 4 alongside the ledger transactions; Phase 3 ships the suffix so money stops being half-applied today.
- `features/invoices/utils/chargesCalculation.ts:71-75` recomputes tourism tax from the **current** `hotelSettings.tourism_tax_rate` instead of the booking's frozen `tourism_tax_amount`, so after a rate change the modal pre-fills an amount `record_payment` will reject. Read `booking.tourism_tax_amount`. **`chargesCalculation.test.ts` (258 lines) pins current output including rounding-leak assertions — expect it to fail, and update it deliberately with the new expected values, one assertion at a time.**
- `features/invoices/components/InvoiceModal.tsx` — hard-coded `$` prefix → `useCurrency()`.

**Verification:**
```
# BE: extend tests/invoice_numbering.rs — its seed_booking (117,158-159) sets
# base_price == room_rate == 150 so total_amount == base_price*nights BY CONSTRUCTION,
# which is why no test can see this bug. Add a fixture with a discount + tourism tax +
# extra bed so total_amount != base_price*nights, then assert the generated invoice,
# the payment summary, and the checkout guard all equal bookings.total_amount +
# tourism_tax_amount + extra_bed_charge.
cargo test --all-features invoice > /tmp/p3.txt 2>&1; echo "EXIT=$?"
cargo test --all-features ledger  > /tmp/p3l.txt 2>&1; echo "EXIT=$?"
# FE
bun run test > /tmp/p3fe.txt 2>&1; echo "EXIT=$?"
# live: pick a real dev booking with a discount; assert GET /invoices/preview total ==
# the admin checkout total == GET /payments/booking/{id} balance. Then issue a credit
# note and assert GET /ledgers/summary total_outstanding returns to its pre-reversal value.
```

**What could go wrong (highest-risk phase of the plan):**
- `generate_invoice` is idempotent, so **already-generated invoices keep the wrong total**. Fixing the calculator does not fix history. Whether to regenerate/correct existing invoice rows is a real accounting question → **Policy Q6**. Ship the calculator fix with a query that counts affected rows (`invoices` where `subtotal != booking total`) and hand the number to the user.
- Guest-visible amounts change. A guest who screenshotted an invoice yesterday sees a different total today. Coordinate with the hotel before deploying.
- `chargesCalculation.test.ts`'s rounding assertions exist for a reason (money helpers were added specifically to stop float leaks). Do not "fix" a failing assertion by loosening a comparison.
- Run FE tests **alone** — per lesson 2026-07-26t, overlapping vitest runs on this volume mass-flake the 5s timeout and 41 timeouts look like 41 regressions.

---

### Phase 4 — Transaction & audit integrity (L, behavior change in failure modes)

**Goal:** no money mutation can half-commit, and no money mutation can happen without a durable record of who did it and to what.

**4a — Ledger transactions.** `repositories/ledger.rs` has **zero** `pool.begin()` across 1282 lines (verified). `create_ledger_payment` (730-865) inserts the payment then separately UPDATEs `customer_ledgers.paid_amount`; `update_ledger_payment` (1083-1209) and `delete_ledger_payment` (1212-1281) run 4-5 unbatched statements. Two concurrent payments on one ledger both read the same stale `paid_amount` and the second overwrites the first. Fix: `pool.begin()` + `SELECT … FOR UPDATE` on the ledger row before recomputing; `AuditLog::log_event_tx` inside; add `user_id` to `update_ledger_payment`'s signature and write `updated_by` in both resync UPDATEs (`ledger.rs:1191-1199`, `1261-1269`). Add the batch company-payment endpoint here (Phase 3's suffix workaround becomes unnecessary). Also fix `list_customer_ledgers`' count query `.unwrap_or(0)` (ledger.rs:242) — a transient count failure currently reports `total = 0` next to a non-empty page.

**4b — Booking update transaction.** `update_booking_handler` (lifecycle.rs:1249-1941, 693 lines, the largest fn in the repo) has **zero** `begin()/tx` (verified by awk over the exact range) while voiding payments (1648-1665), reversing loyalty points (1667-1680) and auto-posting to `customer_ledgers` (1791-1804) as independent `&pool` calls each wrapped in `log::warn!`. Fix: one transaction around the `bookings` UPDATE + its money-relevant side effects, following `services/bookings.rs::void_booking` (begin 179 → commit 206). Post-commit auxiliaries (invoice generation, night-audit backfill) stay best-effort **but get a durable failure record**: `auto_post_company_ledger` failing at checkout (1791-1804) currently means the company is never billed and it is discoverable only by grepping logs — write an `audit_logs` row with `action = "company_ledger_post_failed"`. Also add the status-transition allow-list (`is_legal_transition`) so a `checked_in → voided` jump is rejected rather than dispatched through a partial `match` with no `else` arm (1633-1813).

**4c — Payment idempotency.** `create_completed_payment` (payment.rs:186-241) does `SELECT … WHERE status='completed'` then INSERT inside one transaction, but under READ COMMITTED both concurrent transactions pass the check. Back it with a **partial unique index** (`WHERE payment_type='booking' AND status='completed'`) or a `FOR UPDATE` on the booking row — the CAS pattern in `mark_payment_completed_tx` (payment.rs:455) is the in-repo model. Route **all** invoice-number allocation through the one atomic `(&mut tx)` allocator: today `services/payments.rs:499` and `repositories/ledger.rs:411,1013` each read `MAX+1` on the bare pool and INSERT separately, and `ensure_invoice_for_booking_tx` (payments.rs:648) — the only correct one — has zero external callers. Retry once on unique-violation instead of surfacing a raw 500 (`core/error.rs:172-176` has no `unique_violation` case). Fix `tests/invoice_numbering.rs:399-402`, which asserts only `successes >= 1` — i.e. the suite currently *licenses* the race. Also: the three `let _ = crate::handlers::payments::recompute_payment_status(…)` calls at `lifecycle.rs:1663,1936,2397` (a repository calling a handler) become service calls with `log::warn!`; and the post-commit `?` at `lifecycle.rs:1174` / `payments.rs:149,420,462` becomes log-and-continue so an already-committed payment never returns an error the client will retry.

**4d — Audit coverage.** `repositories/bookings/complimentary.rs` has **0** `AuditLog::` references in 622 lines (verified by count) while `mark_complimentary_handler` can discount a booking to $0; its only trail is a `booking_modifications` INSERT whose error is discarded with `.ok()` (:203, :614). `remove_complimentary_handler` self-documents that it never reverses the granted credit nights (:600-601) — a guest marked-then-unmarked keeps free nights. `services/booking_channels.rs` (26 lines) never accepts a `user_id` at all. `delete_payment` (payment.rs:1218-1251) SELECTs only `id, payment_type, booking_id` before `DELETE`, so the audit event at `services/payments.rs:606-619` cannot say what was destroyed. `modules/settings/service.rs:42-78`'s auto-checkin/late-checkout batch UPDATEs booking and room status with no history row and no audit. Seven `let _ = AuditLog::log_event(…)` sites in `services/payments.rs` (168, 297, 422, 464, 504, 577, 606) swallow silently while the approvals paths in the same file use `?` — pick one policy per file; silent-with-no-log survives nowhere. Replace the wired non-transactional `reactivate_booking` (services/bookings.rs:506-591, 2 of 3 trailing writes `let _ =`) with the transactional pattern from the dead `lifecycle.rs:2549` copy before Phase 2 deletes it — **so 4d must read that function before Phase 2 removes it, or Phase 2 must preserve it in the commit message/diff.**

**Verification:** fault-injection tests in the style already present in `tests/booking_service.rs` (`install_audit_failure_trigger`, `install_checkin_audit_failure_trigger`) proving rollback; a concurrent test (two `create_ledger_payment` calls on one ledger, asserting `paid_amount` equals the sum — this reproduces 4a's race directly); a concurrent `create_completed_payment` test asserting exactly one wins; the `invoice_numbering.rs` concurrency test tightened from `>= 1` to `== 2`. Join `pg_serial_lock` (booking_service.rs:13-17) for any test installing triggers. `cargo test --all-features` bare, exit code read from a file.

**What could go wrong:** adding a unique index to `payments` on a live DB will fail if duplicates already exist — count them first (`SELECT booking_id, count(*) … HAVING count(*) > 1`) and get a decision on the existing rows before creating the index. Every schema change here needs the full baseline discipline from lesson 2026-07-24/26c: three-phase edit of `0001_v1_baseline.sql`, a dated idempotent patch in `database/postgres/patches/`, the `hotel-desktop/src-tauri/database/postgres/` mirror, and a scratch `postgres:19beta2` fresh-vs-patched `pg_dump` diff that comes back **empty**. Tightening transactions can surface latent lock contention — the ledger `FOR UPDATE` serializes payments per ledger row, which is correct but slower under a bulk company payment; the batch endpoint mitigates it.

---

### Phase 5 — Integration-test net for the untested money paths (M, **no behavior change**)

**Goal:** make phases 6–8 verifiable. Today `cargo test --all-features` is green while `record_payment`, `approve_payment`, `reject_payment`, `capture_paypal_payment`, `create_paypal_order`, `apply_paypal_webhook_event`, `complete_and_confirm`, `create_bank_transfer_claim`, `refund_deposit`, `revert_deposit_refund`, `void_ledger`, `create_ledger_reversal`, `update_ledger_payment`, `delete_ledger_payment`, `update_customer_ledger`, `delete_customer_ledger` are **never called by any test** (audit grep; consistent with 13 test files / 9288 lines that pass anyway). A green suite currently proves nothing about the money paths.

**New files:** `hotel-app-be/tests/payment_approvals.rs` (bank-transfer claim → approve → booking confirmed; claim → reject → booking back to `pending_payment`; PayPal order → capture → idempotent retry; concurrent double-approve → exactly one completion), `hotel-app-be/tests/payment_refunds.rs` (refund_deposit / revert round-trip incl. ledger effect), extend `hotel-app-be/tests/ledger_service.rs` (void, reversal-netting, payment edit/delete, `updated_by`). FE: `GuestPaymentPanel.test.tsx` (372-line component, 3 real call sites, **zero tests**), and the four missing `CustomerLedgerPage.test.tsx` scenarios — note its existing voided fixture (340-397) is built with `balance_due: 0` pre-zeroed, which sidesteps the real bug rather than exercising it; add a voided-with-balance fixture.

**Use of existing characterization tests:** `BookingsPage.test.tsx` (610), `CustomerLedgerPage.test.tsx` (713), `useCheckoutFlow.test.tsx` (228), `chargesCalculation.test.ts` (258), `bookingUtils.test.ts` (327), `helpers.test.ts` (208), `ledger.service.test.ts` (346) already pin rendering, filtering, sorting, pagination, modal hand-off and pure money math. Phases 10–11 must keep these **green and unmodified** through every extraction; a diff to them is the signal that a "pure refactor" changed behavior. Where they do need to change (Phase 3's rounding expectations), change them in the same commit as the deliberate behavior change with the reason in the message.

**Verification:** the new tests must **fail** first against pre-Phase-3/4 code (or be written to assert current-and-correct behavior only), then pass. `cargo test --all-features` bare. Run FE vitest alone.

**What could go wrong:** PayPal tests need the gateway stubbed; if `paypal_client.rs` has no injection seam, adding one is real work — scope it explicitly rather than skipping the PayPal tests. Fixed-id fixtures: grep the whole target test file for every id you intend to use (lesson 2026-07-27) — `cargo` runs test fns concurrently in one binary and the existing ranges are 910/920/930/950/980_xxx.

---

### Phase 6 — `modules/ledger/` extraction (M, **no behavior change**)

Move `repositories/ledger.rs` (1282), `services/ledgers.rs` (286), `handlers/ledgers.rs` (134), `routes/ledgers.rs` (167) into `modules/ledger/` per §1.1. Fold `routes/ledgers.rs`'s inline `require_permission_helper` calls into `handlers.rs` (house pattern). Move `auto_post_company_ledger` + `booking_has_company_billing` + `completed_booking_payment_total` + `ensure_checkout_balance_resolved` (`lifecycle.rs:543-668,703-797`, ~220 lines of `customer_ledgers` knowledge) into `modules/ledger/posting.rs` — the booking side then calls one named posting fn. Move `generate_company_ledger_statement` (`repositories/analytics.rs:2228-2459`, 231 lines of pure ledger logic) into `modules/ledger/statement.rs`, dispatched from `analytics.rs`'s match block exactly as `channel_net_revenue::generate` already is (analytics.rs:594-597). `services/ledgers.rs`'s thinness (5 of 13 fns are 1-line passthroughs) is fine to carry over — `modules/settings/service.rs` is 86 lines — but the Phase 1/4 guards (void-status rejection, `updated_by` threading, transactions) must land in the new `service.rs`, not be lost in the move.

`routes/mod.rs:220` `.merge(ledgers::routes())` → `.merge(crate::modules::ledger::routes::routes())`. **No URL changes** — the FE contract is untouched, so `hotel-web-fe` needs no edit.

**Verification:** `cargo clippy --all-features --all-targets -- -D warnings`; `cargo test --all-features` (Phase 5's ledger tests are the real proof); live curl every `/ledgers/*` and `/companies/*` route for identical status + body vs a pre-refactor capture; `git diff --stat` shows moves, not rewrites (`git diff -M50%` to confirm rename detection).

**What could go wrong:** `LEDGER_SELECT_FIELDS` and the `ui_status_clause` string builders (ledger.rs:91) are format-interpolated; a move that reflows them silently changes SQL. Diff the generated SQL, not just the Rust. `analytics.rs`'s dispatcher is permission-gated differently (`analytics:read`/`reports:execute` at routes/analytics.rs:72 vs `ledgers:read`) — moving the code must **not** change the gate in this phase; that is Policy Q9.

---

### Phase 7 — `modules/payment/` extraction (L, **no behavior change**)

Split `services/payments.rs` (2011, 27 pub fns) and `repositories/payment.rs` (1426, 34 pub fns on one impl) along the **same six seams** in one coordinated change (they share request/response types, so splitting them independently doubles the work): recording / refunds / invoices / intake / gateway_paypal / approvals. Delete `handlers/payments.rs` (231 lines of pure pass-through) and fold `routes/payments.rs`'s per-route `require_permission_helper` calls (e.g. :80,:89,:98,:107) into the new `handlers.rs`, matching `modules/promotions/handlers.rs:96-101,116-122`. Add the missing service wrapper for `get_payment_for_review` so `services/guest_portal.rs:487-490,534-537` stops importing `repositories::payment` directly. `payment_receipt_scheduler.rs`, `paypal_client.rs`, `invoice_numbers.rs` move under the module or stay as siblings — either is fine; pick one and be consistent.

**Verification:** as Phase 6, plus a live curl matrix over all ~20 payment routes recording status codes for authorized / unauthorized / unauthenticated callers (the auth-check relocation from routes to handlers is the one thing that can silently regress). Phase 5's `payment_approvals.rs` and `payment_refunds.rs` are the behavioral proof.

**What could go wrong:** moving auth from a route closure to a handler is exactly the class of change where one route silently loses its gate. Enumerate the routes and their permission strings from `git show HEAD:src/routes/payments.rs` and machine-diff against the new `handlers.rs` — do not eyeball it (the lesson from the 166-call-site param-struct refactor: machine-diff call sites, don't trust compile+tests).

---

### Phase 8 — `modules/booking/` extraction + shared booking-core (XL, **no behavior change**)

The big one. `lifecycle.rs` is 3492 lines before Phase 2 and ~2830 after. Split per §1.1 into `service/{lifecycle,checkin,complimentary,credits}.rs` + `repository.rs` + `queries.rs` + `status.rs`, and **delete `pub use crate::repositories::bookings::*;`**. The mechanical core of the work: for each of the ~20 `*_handler` fns in `lifecycle.rs`/`credits.rs`/`complimentary.rs`, drop the `_handler` suffix, replace the Axum extractors with plain args (`repositories/bookings/checkin_advisory.rs:64,83` is the in-repo reference shape), and move the `AuthService::check_permission` calls up into `handlers.rs`. Use the destructuring technique from lesson 2026-07-27: for any signature change, `let Params { a, b, .. } = params;` as the first line and leave the body byte-identical, then machine-diff every call site against `git show HEAD:<file>`.

Then extract `create_booking_core(&mut tx, params)` — availability check, price resolution, initial-status decision, INSERT — and have **both** the admin path (`lifecycle.rs:913-1202`) and `modules/guest_booking::service::create` (service.rs:366-597) call it. Today the guest module reimplements availability, allocation, pricing and INSERT independently, sharing only `record_booking_history_tx` (service.rs:506). **Important scoping:** Phase 8 extracts the core with the channel differences **preserved as explicit parameters** (tourism-tax policy, rate-plan policy, initial status, stay-limit policy). Unifying those values is Phase 11 and requires the policy answers. Extraction without unification is the honest no-behavior-change step, and it makes Phase 11 a one-line-per-rule change instead of a second rewrite.

Also in scope: `bookings.status` has no `NOT NULL` in the DDL (baseline:1394) and `map_workflow_summary_row` uses panicking `row.get("booking_status")` (payment.rs:1415) on it while the adjacent `payment_status` is `COALESCE`d (:755) — add the `COALESCE`. Rename or fold `services/booking.rs` (31 lines, singular, aliased three different ways: `booking_svc` at lifecycle.rs:13, `booking_service` in two other files meaning two different modules).

**Verification:** `cargo clippy --all-features --all-targets -- -D warnings`; `cargo test --all-features` — `tests/booking_service.rs` (1899 lines) and `tests/status_vocabulary.rs` (384) are the safety net and must stay green and **unmodified**; live curl over every `/bookings/*` route; FE untouched (no URL change) so `bun run test` green is a further check that the contract held.

**What could go wrong:** highest-cost, highest-blast-radius phase. Mitigations: it comes **after** the money bugs are fixed and after Phase 5's tests exist, so a regression is detectable; it comes after Phases 6 and 7 have proven the extraction recipe twice on smaller domains. Do it in one worktree, one session, no concurrent sessions in this tree (lesson 2026-07-26l — a shared tree produced files reverting mid-session). `git commit -- <explicit paths>` and check `git diff --cached --stat` before committing (lesson 2026-07-26r).

---

### Phase 9 — Query & round-trip efficiency (M, no behavior change beyond latency)

- `bookings_queries.rs:5-44` — LATERAL-join the `customer_ledgers` and `SUM(payments)` subqueries (5 and 5 repetitions verified) instead of repeating them per expression.
- `ledger.rs:228/244`, `payment.rs:638`, `payment.rs:671` — `COUNT(*) OVER()` per `repositories/booking_list.rs`.
- `modules/guest_booking`: fold `online_allocation_for_stay` into `list_inventory` (N+1 on every public search).
- FE: new server-side arrivals/departures/balance-due aggregate replacing `useBookingsWithDetails()`'s unbounded fetch (BookingsPage.tsx:236 → 7 client filter memos at 1085-1119, re-fetched by `invalidateBookingDependencies` on every mutation). Point the ledger summary strip at `getCustomerLedgerSummary()` and add a grouped-by-company balance endpoint so `CompanyListPane` stops needing the full table.
- `useUnifiedBookingData.ts:17-52` — replace `queryClient.fetchQuery({staleTime: 0})` + local `useState` with `useQuery` + `enabled`.
- `api/paging.ts::fetchAllPages` shared by `bookings.service.ts:48-90` and `ledger.service.ts:17-66`, then retire both call sites where a server aggregate replaces them.

**Verification:** `EXPLAIN (ANALYZE, BUFFERS)` before/after on the dev DB for each rewritten query, recorded in the commit; assert identical result sets (`EXCEPT` both directions returns empty); `cargo test --all-features`; FE `bun run test` alone.

**What could go wrong:** a LATERAL rewrite of a 17-subquery expression is easy to get subtly wrong (NULL vs 0 for a booking with no ledger row). The `EXCEPT`-both-ways check against the old query on real dev data is the gate; do not ship on "looks right".

---

### Phase 10 — FE contract layer + god-component decomposition (L, **no behavior change**)

- Rewrite `types/payment.types.ts`'s `Invoice`/`InvoicePreview` from `models/payment.rs:304-332` (they share almost no field names today: `billing_name` vs `customer_name`, plus 14 FE fields that do not exist and 11 real fields missing). Delete the stale comment at `types/dataTransfer.types.ts:375-377` that caused it.
- Type all 11 `invoices.service.ts` methods (9 return `any` today, including every money mutation). Type `useBookingsPage`/`useBookingsWithDetails` params against the service's real 13-key interface instead of `Record<string, unknown>` + `as any`. Map `Option<T>` to `T | null` (required key), not `T?` — no `skip_serializing_if` exists on these structs so the key is always present as `null`.
- Add `ekyc_summary` to `BookingWithDetails` and surface `can_auto_checkin`/`auto_checkin_block_reason` in the check-in UI (computed on every response at `row_mappers.rs:67-129`, zero FE references).
- Normalize error handling: `ledger.service.ts` and `paymentApprovals.service.ts` let raw ky `HTTPError` escape while `bookings.service.ts`/`invoices.service.ts` normalize to `APIError`. Pick `APIError` everywhere.
- `queryKeys.ts`: split `ledgers.list()` into `fullList()` / `page(params)` (same key, two shapes, two staleTimes today) and add `paymentApprovals.history(page, size)`.
- Decompose per §2: `BookingsPage.tsx` 2719 → ~400 + 7 dialog components + `useBookingOperationsSummary`; `CustomerLedgerPage.tsx` 2268 (89 `useState`) → ~350 + 4 hooks (`useCompanyCheckIn` — including the 151-line `handleCompanyCheckIn`, `useCompanyPaymentFlow`, `useCompanyInvoiceFlow`, `useCompanyDirectory` — none of these four groups share state with the entries tab); `CheckoutInvoiceModal.tsx` 1988 → ~500 + `useCheckoutPayments` + `useDepositResolution` + shared `ChargesBreakdownTable` (the per-night tourism-tax loop is written three times: CheckoutInvoiceModal.tsx:954-985, :1748-1770, CheckoutInvoicePrintView.tsx:191-213).
- Unify the two check-in implementations: `EnhancedCheckInModal.tsx` (1968 lines, with `useCheckInFormData`/`useEnhancedCheckInModalState`) vs `BookingsPage.tsx`'s inline `ci*`-prefixed dialog (state 213-225, handlers 741-836, JSX 2576-2718) — same payment/deposit/waive concepts, two implementations.
- `handleSaveDailyRates` (CheckoutInvoiceModal.tsx:392-406) uses raw float `+` and `/` in a file where everything else uses `utils/money.ts`; switch to `sumMoney`/`divideMoney`.

**Verification:** `bun run typecheck && bun run lint && bun run test` (alone). The 610-line `BookingsPage.test.tsx`, 713-line `CustomerLedgerPage.test.tsx`, 228-line `useCheckoutFlow.test.tsx` and 208-line `helpers.test.ts` must stay green **without edits** — that is the definition of "no behavior change" for this phase. Typing `any` → real types will surface latent mismatches as compile errors; each one is a finding to report, not a `as any` to add.

**What could go wrong:** typing `invoices.service.ts` honestly may reveal the backend returns something different from `models/payment.rs` for some route — that is a Phase 3/7 bug surfacing late, not a typing problem. `useCheckoutFlow.test.tsx` has no case where `updateBooking` succeeds and the follow-up `updateRoomStatus` fails; add it here (the booking is checked out server-side but the UI says failure).

---

### Phase 11 — Cross-channel parity (L, behavior change, **gated on policy answers**)

Nothing in this phase can start before the user answers Q1, Q2, Q4, Q5, Q7, Q8. It is the phase where guest and admin start producing the same money for the same room. Scope, once decided:

- **Tourism tax on guest-portal bookings.** Verified: `modules/guest_booking/repository.rs:559-569` binds `tax_amount` to a literal `0` and its column list contains **no** `is_tourist` / `tourism_tax_amount`, while the admin path calls `canonical_tourism_tax_for_guest` (lifecycle.rs:240-265, called at 1009 and 1496) and `bookings_queries.rs:112,120` bills `total_amount + tourism_tax_amount + extra_bed_charge` at checkout. A foreign tourist booking online is not charged a government-mandated tax. (Q8)
- **Rate plans / stay limits**, per Q7 and Q4.
- **One ownership resolver**: `GET_USER_BOOKINGS_QUERY`'s `WHERE g.email = $1` (bookings_queries.rs:135) replaced by the `user_guests`/`users.guest_id` resolution `user_owns_booking` uses (lifecycle.rs:2697-2712). Two guest records sharing a family/corporate email currently leak each other's bookings; a user linked via `user_guests` with a different account email sees none of their own.
- **One guest-facing surface**: pick `/guest-portal/me/bookings` (session-auth, `guest_id`-based, matches `modules/guest_booking`) as canonical and deprecate `/bookings/my-bookings`, or vice versa (Q10).
- **Void cascade to ledger** (Q1) and **partial online payments** (Q5) land here.

**Verification:** the parity test the audit says is missing — seed one foreign-tourism-type guest and one room/date pair, create a booking through **each** path, and assert the resulting `total_amount` + `tourism_tax_amount` agree (or assert the documented divergence, if that is the decision). Plus live curl of both `my bookings` surfaces for a guest with a shared email and for a `user_guests`-linked guest with a different email.

**What could go wrong:** this phase changes what guests are charged. It must not ship without hotel sign-off, and if Q8's answer is "yes, charge it", the follow-up question of whether to retro-bill existing online bookings is an accounting action, not a deploy.

---

## 5. Blocker list (fix before or independently of any refactor)

Every entry below was re-verified in this session by direct Read/Grep, not taken on the subagent's word.

| # | Location | Defect |
|---|---|---|
| B1 | `hotel-app-be/src/routes/bookings.rs:221` + `repositories/bookings/lifecycle.rs:2463` | Unauthenticated public endpoint overwrites any guest's name/email/phone/IC/nationality/address by numeric booking id; zero audit; two non-transactional UPDATEs. FE has no caller. |
| B2 | `hotel-app-be/src/repositories/bookings/lifecycle.rs:1274` | `owns_booking` OR-bypass lets a non-staff booking owner reach the generic update handler, including `status:"voided"` — a second void path with no transaction, no state machine and weaker audit than `void_booking`. |
| B3 | `hotel-app-be/src/repositories/bookings/lifecycle.rs:1249` | 693-line handler mutates bookings + payments + loyalty + `customer_ledgers` with **zero** `begin()/tx` (verified over 1249-1941). |
| B4 | `hotel-app-be/src/repositories/ledger.rs:730` | `repositories/ledger.rs` has **zero** transactions in 1282 lines; concurrent ledger payments lost-update `paid_amount`. |
| B5 | `hotel-app-be/src/services/payments.rs:110` + `repositories/payment.rs:898` | Invoice/payment totals computed from `room_types.base_price * nights` with `tax_amount = ZERO`, ignoring discount / tourism tax / extra bed / rate override; the wrong one is live via `GET /invoices/preview` and cached permanently by `generate_invoice`'s idempotency. |
| B6 | `hotel-app-be/src/repositories/ledger.rs:896` | `get_ledger_summary` does not net credit/reversal rows; a $500 credit note reads as +$1000 billed, +$500 collected, outstanding unchanged. |
| B7 | `hotel-app-be/src/repositories/ledger.rs:555` | `PATCH /ledgers/{id}` can set `status='void'` under `ledgers:update`, bypassing `ledgers:void` and leaving `void_at/void_by/void_reason` NULL. |
| B8 | `hotel-app-be/src/repositories/payment.rs:198` | `create_completed_payment`'s check-then-insert has no backing unique constraint → two concurrent staff payments can both complete. |
| B9 | `hotel-app-be/src/repositories/bookings/lifecycle.rs:1077` | `adults` is a **literal `1`** in the INSERT VALUES clause; `BookingInput` has no adults/children field; FE sends `number_of_guests` which serde drops. Verified by reading the INSERT and the struct. |
| B10 | `hotel-app-be/src/repositories/rooms_queries.rs:176` | Admin room search omits `pending_payment`/`pending_confirmation` from its blocking-status list → front desk can double-book a room a guest just reserved online. |
| B11 | `hotel-web-fe/.../CustomerLedgerPage.tsx:973` | Bulk company payment passes the same `receipt_number` to every ledger; backend uniqueness is global, so ledger #1 commits and ledger #2 throws with no rollback. |
| B12 | `hotel-web-fe/.../customerLedgerPrint.ts` | "Generate Company Invoice" Print/Download performs **no API call** (verified: no service import, no `await` in 505 lines) — `invoice_number` is never persisted, entries never become invoiced. |
| B13 | `hotel-web-fe/.../useCustomerLedgerWorkspace.ts:79` | Client summary sums `balance_due` with no void exclusion; `void_ledger` never zeroes the GENERATED `balance_due`, so a voided-unpaid charge shows as money owed, contradicting the backend endpoint and the Void dialog's own text. |
| B14 | `hotel-web-fe/.../PaymentApprovalsPage.tsx:323` | Approve renders for every pending row (only "Request receipt" is `payment_method === 'bank_transfer'`-gated); `approve_payment` checks only `status == 'pending'` and never re-verifies with PayPal → a $0-collected booking can be confirmed. |

B1, B2, B7, B10 → Phase 1. B5, B6, B11, B13 → Phase 3. B3, B4, B8 → Phase 4. B9, B12, B14 → gated on Policy Q13/Q6/Q2 respectively (each has a real either/or), then Phase 3 or 4.

---

## 6. Policy questions the user must decide

These are hotel-operations and accounting decisions. No default is applied and no phase that depends on one starts before it is answered.

**Q1 — When a booking is voided, what happens to its auto-posted city-ledger row?**
Verified: `services/bookings.rs::void_booking`'s transaction (begin 179 → commit 206) never references `customer_ledgers`; `tests/ledger_service.rs:25-36` documents the behavior and declines to assert it as intended.
- (A) Auto-void or reverse the linked `room_charge` row. Outcome: the company is never billed for a cancelled stay; AR reflects reality automatically; a legitimate cancellation fee must be posted as a new explicit charge.
- (B) Leave the row and flag it for finance review. Outcome: cancellation fees survive by default; AR shows charges for voided bookings until someone acts, and today nobody is told to.

**Q2 — May a ledger entry that already has collected payments be voided?**
Verified: `void_ledger` (ledger.rs:935-981) refuses only if already voided; it never checks `paid_amount`, unlike `delete_customer_ledger` which blocks at `paid_amount > 0`. `get_ledger_summary` then excludes void entirely, so collected money vanishes from every total.
- (A) Block voiding once `paid_amount > 0`; require an explicit refund/reversal first. Outcome: collected money can never disappear from reporting; staff have an extra step on genuine mistakes.
- (B) Keep allowing it, but report voided-with-payments in a distinct bucket. Outcome: staff flexibility retained; a new reporting line must be built and watched.

**Q3 — Does a credit note also adjust the original entry's own balance?**
Verified: `create_ledger_reversal` (ledger.rs:984-1073) inserts a sibling row and never updates the original; `CreditNoteDialog` states the original stays. (The aggregate-netting fix in Phase 3 is correct under either answer.)
- (A) Original row untouched; only totals net. Outcome: cleanest per-row audit trail; any consumer scanning single rows for "outstanding" shows the original as owed unless it also checks for a paired reversal.
- (B) Credit note also adjusts/voids the original. Outcome: row-level balances read correctly everywhere; the historical row no longer shows what was originally billed.

**Q4 — A company-billed booking's total increases after its ledger row is already `paid`/`overdue`. What is billed?**
Verified: the delta-sync UPDATE (`lifecycle.rs:1846-1853`) is restricted to `status IN ('pending','partial')` and the `Ok(_) => {}` arm at :1867 cannot distinguish "no row" from "row excluded", so the increase is silently never billed.
- (A) Post a supplementary adjustment ledger row for the delta. Outcome: the hotel collects; the company gets a second invoice line after settlement.
- (B) Keep it off the ledger and only alert finance. Outcome: no surprise post-settlement charges; the hotel absorbs the delta unless someone acts on the alert.

**Q5 — Can guests pay a deposit online, or is online full-payment-only?**
Verified: `create_bank_transfer_claim` (payments.rs:735) and the PayPal order both size off the entire `total_amount`; admin `record_payment` supports arbitrary partials and only auto-confirms when the balance settles.
- (A) Allow partial/deposit online. Outcome: higher conversion; more bookings sitting part-paid, and a payment-awaiting state the portal must render and chase.
- (B) Full payment only online. Outcome: simpler reconciliation; guests who want to pay a deposit must phone the hotel.

**Q6 — Existing invoices carry the wrong total (B5). Fix history or only fix new ones?**
- (A) Only new invoices are correct. Outcome: zero disruption; issued invoices stay under-billed and the books are internally inconsistent.
- (B) Identify and reissue the affected invoices. Outcome: books correct; guests/companies receive corrected invoices for past stays. (Related: does "Generate Company Invoice" Print/Download **issue** an invoice — persisting `invoice_number`, per B12 — or is it a preview? The UI currently implies issue and does neither.)

**Q7 — Should admin-created bookings apply rate plans?**
Verified: `create_booking_handler` (lifecycle.rs:913-1202) references neither `rate_plans` nor `room_rates`; the guest path prices via `applicable_rate`/`nightly_rates`.
- (A) Uniform pricing — admin applies the active rate plan. Outcome: same room, same date, same price on every channel; walk-in staff lose the flat-rate default.
- (B) Rate plans stay an online-only promotional mechanism. Outcome: online promos don't leak into walk-in pricing; the two channels legitimately quote different prices and staff must know why.

**Q8 — Tourism tax on guest-portal bookings (B-class, verified).** Online bookings are never charged `tourism_tax_amount`; admin bookings are. This looks like an omission rather than a policy, but the correction is a money change: (A) charge it on the online channel going forward; (B) charge it going forward **and** retro-bill existing online bookings for foreign guests; (C) confirm online is deliberately exempt. Outcomes differ in tax-compliance exposure and in whether existing guests receive a new charge.

**Q9 — Should a report-viewer with `analytics:read`/`reports:execute` (routes/analytics.rs:72) be able to pull full per-company AR statements — contact details, invoice numbers, aging balances — without `ledgers:read` (routes/ledgers.rs:18)?** (A) Require `ledgers:read` additionally. (B) Confirm report-viewers are intended to see AR. Outcome differs in who inside the hotel can see which companies owe money.

**Q10 — Two guest-facing "my bookings" surfaces exist** (`/bookings/my-bookings` with the email join vs `/guest-portal/me/bookings` with `guest_id`). Which is canonical? Outcome: whichever is retired, its consumers must be migrated; keeping both means maintaining two ownership models indefinitely.

**Q11 — Should a non-staff booking owner be able to change status / room / deposit fields at all via `PATCH /bookings/{id}`?** (A) Narrow field allow-list (contact info, special requests) with all state changes on dedicated endpoints. (B) One endpoint with an explicit tested transition allow-list for non-staff. Outcome differs in how much guest self-service the API offers.

**Q12 — "Mark existing booking complimentary" from the bookings list**: the handlers and mutation exist but the dialog is never rendered (verified: no `<Dialog open={complimentaryDialogOpen}>`). Delete the ~80 lines, or wire the button? Outcome: a real capability either goes away or appears.

**Q13 — Guest count (B9).** `adults` is hard-coded to `1` on every admin-created booking and the FE's `number_of_guests` is dropped. Fixing it is engineering; the question is whether occupancy affects **price** (extra-person charges, occupancy-based rates). If it does, correcting the field changes what bookings cost and needs a pricing rule; if it does not, this is a pure data-integrity fix and I will just do it.

**Q14 — PayPal approvals (B14).** Should staff be able to manually approve a PayPal claim without gateway re-verification? (A) Hide/relabel Approve for `payment_method = 'paypal'`, forcing a capture retry or a reject. (B) Have `approve_payment` re-query PayPal for non-bank-transfer methods before completing. Outcome: (A) is cheap and safe but removes a manual escape hatch; (B) keeps the hatch and costs a gateway integration.

---

## 7. Verification strategy

**Per-phase gates (all run bare or redirected — never ending in a pipe, and never `${PIPESTATUS[0]}`, which is empty under this zsh):**
```
cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/hotel-app-be"
cargo clippy --all-features --all-targets -- -D warnings > /tmp/clippy.txt 2>&1; echo "EXIT=$?"
cargo test --all-features > /tmp/test.txt 2>&1; echo "EXIT=$?"

cd "/Volumes/APPLE EXTERNAL SSD /Personal Projects/hotel-app/hotel-web-fe"
bun run typecheck > /tmp/tc.txt 2>&1; echo "EXIT=$?"
bun run lint      > /tmp/lint.txt 2>&1; echo "EXIT=$?"
bun run test      > /tmp/fetest.txt 2>&1; echo "EXIT=$?"
```
`--all-targets` matters: CI does not pass it, so `items_after_test_module` and broken test targets stay invisible without it. `cargo check` alone does not compile `tests/`.

**Additional gates by change class:**
- **Any SQL/schema change** (Phase 4's indexes, Phase 9's rewrites): edit `database/postgres/migrations/0001_v1_baseline.sql` in its three phases (CREATE TABLE body / `ADD CONSTRAINT …_pkey` / `ADD CONSTRAINT …_fkey`), ship a dated idempotent patch in `database/postgres/patches/`, mirror to `hotel-desktop/src-tauri/database/postgres/`, then prove convergence: scratch-install the new trio, scratch-install the old trio + patch, `pg_dump --schema-only --no-owner --no-privileges` both, strip `\restrict` lines, **diff must be empty**. Compilation and the test suite cannot see a baseline that will not install.
- **Any query rewrite**: `EXCEPT` in both directions against the old query on real dev data must return empty; `EXPLAIN (ANALYZE, BUFFERS)` before/after recorded.
- **Any route/permission relocation** (Phases 6–8): machine-diff the route→permission mapping against `git show HEAD:src/routes/<domain>.rs`; live curl each route as authorized / under-permissioned / unauthenticated.
- **Any signature change**: destructure at the top of the callee, then machine-diff every call site's positional args against its HEAD version. Audit writes swallow their own errors, so a mis-mapped field is silent.
- **FE tests run alone.** Two concurrent vitest runs in this tree starve the 5s timeout and produce dozens of fake failures.
- **Money paths get a live check**, not just a green suite: after Phase 3, one real dev booking with a discount must show the same total in the guest invoice, the admin checkout invoice, and the payment balance guard.
- **Adversarial review is mandatory for Phases 1, 3, 4, 8** (auth / money / schema), by a fresh-context agent that re-derives from the diff rather than reading the implementer's report. Every prior instance of this in the repo's history caught something all five green gates missed.

**Working-tree hygiene:** one session per tree (use a worktree), `git diff --cached --stat` before every commit, `git commit -- <explicit paths>`, and after any volume anomaly re-grep an exact substring of each recent edit and confirm `git status` shows it modified.

---

## 8. Claims I verified / could not verify

### Verified this session by direct Read/Grep

| Claim | Evidence |
|---|---|
| `services/bookings.rs:3` is `pub use crate::repositories::bookings::*;` | read lines 1-20 |
| `update_booking_handler` (lifecycle.rs:1249-1941) has zero transaction usage | `awk 'NR>=1249&&NR<=1941 && /begin\(\)\|&mut \*tx\|DbTransaction\|tx\.commit/'` → empty |
| `owns_booking` OR-bypass at lifecycle.rs:1274-1278 | read 1249-1300; only `cancelled`/`comp_cancelled` rejected, `voided` accepted |
| `PATCH /bookings/{id}/pre-checkin` is unauthenticated | read routes/bookings.rs:221-228, comment "Public endpoint - no authentication required" |
| pre-checkin handler has no audit / auth | `awk NR>=2463&&NR<=2545 && /AuditLog|require_auth|check_permission/` → empty |
| The three `lifecycle.rs` `_handler` fns are dead | `#[allow(dead_code)]` at 1941/2105/2548; **and** `handlers/bookings.rs:105,125,269` verified to call `booking_service::void_booking`/`manual_checkin`/`reactivate_booking` |
| `calculate_payment_summary` uses `base_price * nights`, `tax_amount = ZERO` | read services/payments.rs:103-126 |
| `create_generated_invoice` same, plus `.bind("MYR")` | grep over payment.rs:888-1075 |
| `insert_checkout_invoice` uses `b.total_amount` | grep over payment.rs:1287-1330 |
| `adults` is a literal `1` in the booking INSERT; `BookingInput` has no adults field | read the INSERT VALUES clause and models/booking.rs:133-163 |
| `repositories/ledger.rs` has zero `begin()` | `grep -c` → 0 |
| `get_ledger_summary` excludes void, does not net by `transaction_type` | read the full SQL |
| `void_ledger` never checks `paid_amount` | read 935-981 |
| `update_customer_ledger`'s SET builder includes `status` with no allow-list | read 548-565 |
| `ledgers:update` guards PATCH, `ledgers:void` guards /void | read routes/ledgers.rs:20,21,89,155 |
| `record_payment` validates against `billable_total()`; `update_payment` does not | read payments.rs:215-240 and 553-565 |
| Guest `insert_booking_tx` binds `tax_amount` literal 0, no `is_tourist`/`tourism_tax_amount` columns | read repository.rs:552-575 |
| `SEARCH_ROOMS_WITH_DATES_QUERY` omits `pending_payment`/`pending_confirmation` | read rooms_queries.rs:172-178 vs `ACTIVE_BOOKING_STATUSES` at guest_booking/repository.rs:15 |
| Base booking query repeats each subquery 5× | `grep -c` over lines 5-44: `FROM customer_ledgers cl` = 5, `SUM(p.amount)` = 5 |
| `QuickBookingModal.tsx` (944 lines) has only its barrel export as a reference | `grep -rn` over `src` |
| `complimentaryDialogOpen` is never rendered | grep shows only 336 / 590 / 641; no `<Dialog open={complimentaryDialogOpen}>` |
| `voidBooking` is called directly at BookingsPage.tsx:538 followed only by `reloadBookingData` | grep of both symbols |
| `invalidateBookingDependencies` invalidates 10 key families incl. ledgers/invoices/dashboard | read api/queryInvalidation.ts |
| `summaryBookingsQuery = useBookingsWithDetails()` with no filters | BookingsPage.tsx:236 |
| `customerLedgerPrint.ts` has no service import and no `await` | grep of imports and `await` |
| Bulk company payment reuses one `receipt_number` across ledgers | read CustomerLedgerPage.tsx:963-982 |
| `get_invoice_preview` returns the first-generated invoice forever | read services/payments.rs:523-531 |
| Approve is ungated; only "Request receipt" checks `bank_transfer` | grep PaymentApprovalsPage.tsx:307-347 |
| House module pattern shape | `wc -l` on `modules/promotions/*` and `modules/support/*`; read `modules/mod.rs`, `modules/promotions/mod.rs`, `routes/mod.rs:211-240` |
| File sizes for all god files, BE and FE | `wc -l` |
| Test inventory: 13 BE files / 9288 lines, 15 FE in-scope files / 3791 lines | `wc -l` |

### Corrected

- **Finding 3's evidence was ambiguous, conclusion holds.** A bare `grep -rn <name> src/` for the three "dead" functions returns hits in `handlers/bookings.rs` and `routes/bookings.rs` — but those are **same-named functions in a different module**. I read `handlers/bookings.rs:105-133` and `:269-277` to confirm they delegate to `services/bookings.rs`, not to `lifecycle.rs`. The dead-code conclusion is correct; the plan states the stronger evidence so nobody re-litigates it.
- **Finding 84's line numbers.** `setComplimentaryDialogOpen(true)` is at BookingsPage.tsx:**590** (not "582-591" as a range containing the set); `handleMarkComplimentary` starts at 582. Conclusion (dead dialog) holds.
- **Finding 93 has a partial guard the finding omits.** There *is* a client-side receipt-existence check before the loop (against already-fetched payments). It does not help: the collision is between iteration 1's freshly-inserted payment and iteration 2 of the same loop. Blocker stands, with the correct mechanism stated.

### Could not verify / deliberately not verified

- **Nothing was executed.** I did not run `cargo clippy`, `cargo test`, or `bun run test`. The audit reports all five gates green at `EXIT=0` (776 FE tests); I am relying on that claim and every phase re-establishes it as its own gate.
- **`repositories/booking.rs`'s 8 dead fns and `bookings_queries.rs`'s 4 dead constants** — I verified the file sizes and accepted the audit's zero-caller greps rather than re-running nine of them. Phase 2 must re-verify each with `cargo check --all-features --tests` before deleting; that is a compiler check, not a judgment call.
- **`repositories/analytics.rs:2228-2459` `generate_company_ledger_statement`** — not read this session. Its existence and dispatch pattern come from the audit. Phase 6 must confirm the line range before moving it.
- **The `rust_decimal` feature-flag claim** (Decimal serializes as string, `BookingStats.total_revenue: f64` as number) rests on a `target/release/.fingerprint/` artifact, which is build state and can be stale. Re-derive from `Cargo.toml`/`Cargo.lock` before acting on Finding 131.
- **`PaymentStatus::Processing` never written** — accepted from the audit's grep, not re-run.
- **Whether `pre_checkin_token` is used by any live consumer** (email link, kiosk) — unknown, and it decides whether Phase 1 tokenizes or deletes the endpoint. Must be grepped (`pre_checkin_token`, `communications` templates) as Phase 1's first step.
- **Whether duplicate completed payments already exist in production** — must be counted on the live DB before Phase 4 creates the partial unique index.
- **The audit's claim that the tracker task "Expose PayPal conflict banner to payment approvers" is already implemented** — plausible from the cited code, not verified here. Re-check against the task's original intent before closing task #3.
- **All performance claims** (N+1 counts, EXPLAIN costs) are structural reads, not measurements. Phase 9 must measure.
