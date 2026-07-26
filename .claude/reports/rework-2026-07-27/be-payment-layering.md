# Backend Payment Domain — Structure & Layering Audit

Scope: `hotel-app-be/src/{routes,handlers,services,repositories,models}/payments*.rs`
and related (paypal_client, payment_receipt_scheduler, invoice_numbers, and every
cross-domain caller found by grep). All line numbers verified in this session via
Grep/Read against the working tree (2026-07-27); none reused from `.claude/refs/`.

## 1. Function inventory (enumeration method: `grep -n "pub fn\|pub async fn"`)

### `services/payments.rs` (2011 lines) — 27 pub fns (+1 pub `as_str` on an enum)

| Group | Fns (line: name) | Lines | Size |
|---|---|---|---|
| **Recording** | 128 create_payment, 187 record_payment, 316 get_all_payments, 327 get_payment_workflow_summary, 486 get_payment, 553 update_payment, 595 delete_payment, 92 recompute_payment_status, 96 recompute_payment_status_tx, 103 calculate_payment_summary | 128–626, 92–101, 103–126 | ~560 |
| **Refunds** | 390 refund_deposit, 455 revert_deposit_refund | 390–484 | ~95 |
| **Invoices** | 490 generate_invoice, 523 get_invoice_preview, 549 get_user_invoices, 635 ensure_invoice_for_booking, 648 ensure_invoice_for_booking_tx | 490–669 | ~180 |
| **Guest-payment intake (bank transfer + PayPal order)** | 695 guest_payment_config, 735 create_bank_transfer_claim, 805 create_paypal_order, 711 ensure_booking_awaiting_payment, 724 ensure_no_active_booking_payment | 692–878 | ~186 |
| **PayPal capture/webhook (gateway reconciliation)** | 882 capture_paypal_payment, 1016 release_failed_paypal_payment, 1031 verify_captured_amount, 1063 verify_captured_against_stored, 1141 apply_paypal_webhook_event, 1197 apply_webhook_capture_completed, 1322 apply_webhook_capture_denied, 1379 audit_paypal_webhook | 882–1405 | ~524 |
| **Approvals workflow** | 1409 approve_payment, 1436 request_payment_receipt, 1548 complete_and_confirm, 1707 reject_payment, 1718 reject_expired_receipt_requests, 1737 reject_payment_by, 1823 list_pending_payments, 1835 list_payment_approval_history | 1409–1844 | ~436 |
| **Receipts (file storage)** | 1846 receipt_extension, 1861 save_payment_receipt, 1921 load_payment_receipt | 1846–1944 | ~99 |
| **Notifications (cross-cutting, embedded here)** | 23 queue_paid_online_booking_room_assignment, 82 try_queue_..., 1479 queue_payment_receipt_request_notification, 1622 queue_payment_rejected_notification, 1673 try_queue_payment_rejected_notification | 23–90, 1479–1703 | ~270 |

### `repositories/payment.rs` (1426 lines) — 34 pub fns, all on `impl PaymentRepository`

| Group | Fns (line) | Lines |
|---|---|---|
| **Status/summary** | 45 paid_online_booking_room_assignment, 76 recompute_booking_payment_status, 111 recompute_booking_payment_status_tx, 146 payment_booking_stay, 165 room_pricing, 744 workflow_summary_row | 45–184, 744–783 |
| **Recording** | 186 create_completed_payment, 270 record_payment, 314 insert_payment, 365 list_payment_entries, 1135 update_payment, 1218 delete_payment, 871 find_by_booking_id | 186–383, 1135–1251, 871–886 |
| **Guest-intake pending rows + CAS transitions** | 393 insert_pending_payment_tx, 436 set_payment_gateway_order, 455 mark_payment_completed_tx, 477 mark_payment_rejected_tx, 503 mark_payment_failed_tx, 528 has_active_or_completed_booking_payment, 551 has_other_completed_booking_payment_tx | 393–571 |
| **Approvals/receipts** | 575 get_payment_for_review, 605 list_pending_payments, 647 list_payment_approval_history, 679 save_receipt_file, 696 receipt_file, 710 request_receipt, 736 expired_receipt_request_payment_ids | 575–742 |
| **Refunds** | 785 refund_deposit, 837 revert_deposit_refund | 785–868 |
| **Invoices** | 888 create_generated_invoice, 1073 enriched_invoice_by_booking_id (private), 1103 find_invoice_by_booking_id, 1110 find_user_invoices, 1253 existing_invoice_number, 1269 ledger_invoice_number, 1287 insert_checkout_invoice, 1330 find_invoice_by_number, 1356 invoice_booking_details (`#[allow(dead_code)]`, zero callers — see Finding 8) | 888–1410 |

`services/invoice_numbers.rs` (91 lines, 3 pub fns) + `repositories/invoice_numbers.rs`
(137 lines, 5 pub fns) are the invoice-number allocator; treated separately in §3.

## 2. Entry-point map

| Entry point | Path taken | Permission gate |
|---|---|---|
| `GET/POST/PATCH/DELETE /payments*`, `/invoices*` | `routes/payments.rs` (inline closures) → `handlers/payments.rs` (pure pass-through) → `services/payments.rs` | `require_permission_helper` inline in `routes/payments.rs:80,89,98,107,…` (`payments:read/create/update/delete/refund/approve`) |
| `GET/PUT/POST /admin/payments/*` (queue, approve, reject, request-receipt, receipt download) | same chain | `PAYMENTS_READ`/`PAYMENTS_APPROVE` in `routes/payments.rs:200,209,218,227,237,248` |
| `POST /webhooks/paypal` | `routes/webhooks.rs:20` → `handlers/webhooks.rs:26` → `services::payments::apply_paypal_webhook_event` (`webhooks.rs:152`) | **None** — deliberately unauthenticated; trust comes from PayPal signature verification (`paypal_client::verify_webhook_signature`), documented at `handlers/webhooks.rs:1-6` |
| `POST /guest-portal/me/payments/paypal/create-order`+`/capture`, `/guest-portal/booking/{token}/payments/paypal/*` | `routes/guest_portal.rs:73-95` → `handlers/guest_portal.rs:232-303` → `services/guest_portal.rs:499-561` → `services::payments::create_paypal_order` / `capture_paypal_payment` | Guest session (`require_guest_session`) or booking token (`require_valid_token`) — **bypasses RBAC and bypasses `routes/payments.rs`+`handlers/payments.rs` entirely**, as expected for guest-initiated flows |
| Bank-transfer claim / receipt upload (guest) | `services/guest_portal.rs:472-543` → `services::payments::create_bank_transfer_claim` / `save_payment_receipt`, **or directly** `crate::repositories::payment::PaymentRepository::get_payment_for_review` at `guest_portal.rs:488` and `:535` | Guest session/token — see Finding 6 (layer-skip) |
| Checkout invoice generation (internal) | `repositories/bookings/lifecycle.rs:1751` → `services::payments::ensure_invoice_for_booking` (non-tx) | N/A (internal, best-effort; see Finding 3) |
| `bookings.payment_status` resync after void/edit (internal) | `repositories/bookings/lifecycle.rs:1175,1663,1936,2397` → **`crate::handlers::payments::recompute_payment_status`** (repo calling a *handler*) → `services::payments::recompute_payment_status_tx`/non-tx | N/A internal; see Finding 4 (inverted layering + swallowed errors) |
| Overdue receipt auto-reject (scheduled) | `services/payment_receipt_scheduler.rs:10` (`tokio::spawn` loop, 15 min poll) → `services::payments::reject_expired_receipt_requests` | N/A, system actor (`user_id: None`) |
| Company-ledger invoice numbering (internal) | `repositories/ledger.rs:411,1013` → `services::invoice_numbers::next_invoice_number` directly (does **not** go through `services::payments::ensure_invoice_for_booking_tx`) | N/A; see Finding 7 (duplication) |

Every HTTP-facing route in `routes/payments.rs` does carry a `require_permission_helper`
call before reaching the handler — no missing-permission-check finding on this domain's
own routes. The webhook's lack of a permission check is intentional and documented.

## 3. Invoice-number allocation — mechanism and failure mode

- **Allocator**: `services::invoice_numbers::next_invoice_number` (`services/invoice_numbers.rs:19-26`)
  calls `repo::current_month_max_invoice_sequence` (`repositories/invoice_numbers.rs:37-60`),
  a `MAX(seq)+1` scan over `invoices` UNION `customer_ledgers` for the current
  `TO_CHAR(CURRENT_DATE,'YYYYMM')` prefix. **No sequence object, no `SELECT … FOR UPDATE`,
  no `pg_advisory_xact_lock`** anywhere in `invoice_numbers.rs`, `payment.rs`, or `ledger.rs`
  (grepped for `pg_advisory|FOR UPDATE`, zero hits).
- **Not gap-free / not race-free by construction**, but protected from silent duplication by
  two real UNIQUE constraints: `invoices_invoice_number_key` and
  `customer_ledgers_invoice_number_key` (`database/postgres/migrations/0001_v1_baseline.sql:5203,5435`).
  A collision therefore surfaces as a hard DB error (`ApiError::Database`, generic 500 —
  `core/error.rs:172-176` has no `unique_violation` special-case), not silent corruption.
- **Three independent call sites, only one is transaction-atomic**:
  1. `services/payments.rs:499` `generate_invoice` — calls `next_invoice_number(pool)` on the
     bare pool, THEN calls `PaymentRepository::create_generated_invoice` (`repositories/payment.rs:888`)
     which opens **its own separate transaction**. The number-read and the insert are two
     different transactions — a classic TOCTOU window.
  2. `services/payments.rs:648-668` `ensure_invoice_for_booking_tx` — the one correct
     implementation: read and insert share the caller's transaction (`&mut **tx` throughout).
     **Zero callers outside `services/payments.rs` itself** (grepped `ensure_invoice_for_booking_tx`
     across `src/`) — the doc comment at `payments.rs:628-634` says it exists so the invoice
     "commits atomically with the company ledger posting", but nothing in the ledger domain
     actually calls it (see next point).
  3. `repositories/ledger.rs:411` and `:1013` — both call `next_invoice_number(pool)` directly
     on the bare pool inside functions that do the rest of their work on `pool` too (no
     transaction wrapping either call site, confirmed by reading the surrounding code), i.e.
     the SAME non-atomic pattern as (1), duplicated independently in the ledger domain instead
     of reusing (2).
- **Proven failure mode, by the codebase's own test**: `tests/invoice_numbering.rs:362-438`
  `concurrent_generation_never_commits_duplicate_numbers` runs two concurrent
  `generate_invoice`-equivalent calls for two different bookings in the same month and
  asserts only `successes >= 1` (`tests/invoice_numbering.rs:399-402`) — i.e. the test itself
  documents that **one of the two concurrent invoice-generation attempts is allowed to fail**
  with no retry. This is accepted/known behavior, not a hypothesis.
- **Failure mode at the call site that matters most (checkout)**: `ensure_invoice_for_booking`
  is invoked from `repositories/bookings/lifecycle.rs:1751-1761` inside a comment that says
  "Best-effort: failure here must not block the checkout itself" and only `log::warn!`s on
  error — checkout completes with **no invoice row** for that booking.
- **Safety net exists but uses a different numbering rule**: `services::invoice_numbers::backfill_missing_booking_invoices`
  runs at process startup (`main.rs:197-202`) and at the end of every night-audit run
  (`services/night_audit.rs:75-82`), and will eventually create the missing invoice. But its
  month key is `TO_CHAR(b.created_at, 'YYYYMM')` — the **booking's creation month**
  (`repositories/invoice_numbers.rs:62-68`) — whereas the live path numbers by
  `CURRENT_DATE` at generation time. A booking created in one month and checked out (and
  backfilled) in a later month gets an invoice number stamped with the **earlier** month,
  potentially numbered lower than invoices already issued for the later month in the
  meantime. This is a genuine numbering-integrity gap; which month should govern a
  backfilled invoice is a business/accounting call, not a code default to guess (see
  Finding 3, filed as `policy-decision` for that sub-part).

## 4. Approvals workflow (guest bank-transfer / PayPal) — end to end

State lives entirely in `payments.status` (`pending → completed|void|failed`, plus the
unreachable `processing` — Finding 9) and `payment_receipt_requests` (`requested_at`,
`uploaded_at`, `receipt_path`).

1. **Guest creates a claim**: `create_bank_transfer_claim` (`payments.rs:735`, guarded by
   `ensure_booking_awaiting_payment` + `ensure_no_active_booking_payment`) inserts a
   `pending` row and moves the booking to `pending_confirmation`, one transaction
   (`payments.rs:743-793`).
2. **Guest creates a PayPal order**: `create_paypal_order` (`payments.rs:805`) inserts a
   `pending` row first (so its id can be embedded in PayPal's `custom_id`), commits, then
   calls PayPal; on PayPal failure the local row is moved to `failed` via
   `release_failed_paypal_payment` (`payments.rs:1016`) so the guest can retry.
3. **Guest captures**: `capture_paypal_payment` (`payments.rs:882`) validates payment↔booking
   ownership, is idempotent on an already-`completed` row, verifies `custom_id` and the
   captured amount/currency against the **payment row's stored amount** (not the live
   booking total — `verify_captured_against_stored`, `payments.rs:1063`), then calls the
   shared `complete_and_confirm` (`payments.rs:1548`) which CAS-completes the payment,
   confirms the booking, and audits, all in one transaction.
4. **Async reconciliation**: `apply_paypal_webhook_event` (`payments.rs:1141`) is the
   idempotent counterpart for captures whose synchronous response never reached the server —
   every branch (already-applied / conflict / ignored / applied) is audited via
   `audit_paypal_webhook` (`payments.rs:1379`), and a real disagreement between PayPal and
   local state is deliberately left unresolved for staff (`ConflictFlagged`) rather than
   guessed at.
5. **Staff approves/rejects**: `approve_payment` (`payments.rs:1409`) → `complete_and_confirm`;
   `reject_payment`/`reject_payment_by` (`payments.rs:1707-1820`) CAS-voids the row, resets
   the booking to `pending_payment`, and best-effort emails the guest
   (`try_queue_payment_rejected_notification`, swallows its own errors by design — commented
   as "must never undo a staff rejection that has already been committed").
6. **Staff can also just request a receipt** without rejecting (`request_payment_receipt`,
   `payments.rs:1436`) — repeatable, audited, guest gets an email.
7. **Auto-expiry**: `payment_receipt_scheduler.rs` polls every 15 min and calls
   `reject_expired_receipt_requests` (`payments.rs:1718`), which rejects (as `actor_user_id: None`)
   any pending bank-transfer claim whose requested receipt sat unuploaded >24h.

This subsystem is the most carefully reasoned part of the domain — every race the code
authors considered is commented and CAS-guarded. It is also the part with the least test
coverage (Finding 12).

## 5. Duplication / wrong-layer findings (see full list below for all categories)

- `recompute_booking_payment_status` (`repositories/payment.rs:76-109`) and
  `recompute_booking_payment_status_tx` (`repositories/payment.rs:111-144`) contain
  byte-identical SQL (the same multi-branch `CASE`), differing only in binding to `pool` vs
  `&mut **tx`. Both sides cited, both verified by direct read.
- Invoice-number read+insert atomicity duplicated 3 ways — both sides (payments vs ledger)
  cited in §3.
- `handlers/payments.rs` (231 lines) is 100% pass-through (every fn: unwrap extractors → one
  call into `services::payments::X` → rewrap `Json`) while `routes/payments.rs` inlines the
  permission checks that the house `modules/<domain>/handlers.rs` pattern normally owns
  (confirmed against `modules/promotions/routes.rs:1-58`, a pure route table, and
  `modules/promotions/handlers.rs:96-101`, which owns `require_permission_helper`). Both
  sides of this comparison read and cited.

## Findings

See the StructuredOutput returned alongside this report for the ranked, categorized
finding list (14 findings: correctness x2, accountability x3, maintainability x4,
duplication x2, deadcode x2, test-gap x1, policy-decision x1). All findings cite
`file:line` verified in this session.

## Recommended decomposition target (matching `modules/<domain>/` house pattern)

```
modules/payments/
  routes.rs        # pure route table (like modules/promotions/routes.rs)
  handlers.rs       # require_permission_helper + extractor unwrap + call service (collapses
                     # today's routes/payments.rs + handlers/payments.rs three-hop into two)
  recording.rs      # create_payment, record_payment, get_all_payments, get_payment,
                     # update_payment, delete_payment, calculate_payment_summary,
                     # recompute_payment_status(_tx)
  refunds.rs        # refund_deposit, revert_deposit_refund
  invoices.rs        # generate_invoice, get_invoice_preview, get_user_invoices,
                     # ensure_invoice_for_booking(_tx)  [+ invoice_numbers.rs merged in]
  gateway_paypal.rs  # create_paypal_order, capture_paypal_payment,
                     # apply_paypal_webhook_event + the two apply_webhook_* helpers,
                     # verify_captured_amount/_against_stored, release_failed_paypal_payment
                     # (paypal_client.rs stays a separate low-level HTTP adapter)
  approvals.rs       # create_bank_transfer_claim, approve_payment, reject_payment(_by),
                     # complete_and_confirm, request_payment_receipt,
                     # reject_expired_receipt_requests, list_pending_payments,
                     # list_payment_approval_history
  receipts.rs        # save_payment_receipt, load_payment_receipt, receipt_extension
  repository.rs      # today's repositories/payment.rs, split along the same seams
  models.rs
  validation.rs
```

Every sub-module still funnels through one `PaymentRepository`-equivalent (or split
per seam) — the point is cohesion per file, not necessarily one-repo-per-file.
`services/guest_portal.rs`'s two direct `PaymentRepository::get_payment_for_review`
calls (Finding 8) should gain a `payments::get_payment_for_review` service wrapper as
part of this move, not be left reaching into whichever new repository module ends up
owning that function.
