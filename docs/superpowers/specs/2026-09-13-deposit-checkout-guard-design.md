# Deposit checkout guard — design

Date: 2026-09-13
Status: approved (design)
Related: `2026-09-13-legacy-deposit-refund-design.md` (flag-only deposits;
this spec builds on the mint-on-attest path it established).

## Incident

An admin checking out a booking saw an **"Overpayment"** amount in the
checkout modal footer, concluded the deposit payment row was a mistaken
duplicate, and deleted it. The guest's deposit was never refunded and the
checkout completed cleanly.

## Root cause

1. `CheckoutInvoiceModal.tsx` computes
   `balanceDue = charges.grandTotal − Σ(payments where status='completed')`
   (lines ~213–224). That sum **includes `payment_type='deposit'` rows**,
   while the backend's `total_paid` deliberately excludes them — a deposit is
   collateral, not bill settlement (`repositories/payment.rs`,
   `workflow_summary_row`, `NOT IN ('refund','deposit')`). Guest pays the room
   bill in full while a deposit is held → `balanceDue < 0` → the footer renders
   `Overpayment` (line ~1726).
2. Deposit rows render in the same green "Payments" list as bill payments with
   working Edit/Delete buttons.
3. `delete_payment` voids the row; `sync_booking_deposit_mirror_tx` then
   clears `bookings.deposit_paid/deposit_amount`. The modal's deposit gate
   reads that mirror via `charges.depositRefund` → the whole "must refund or
   waive before checkout" section and the confirm-button disable disappear.
4. The backend checkout guard (`ensure_checkout_balance_resolved`,
   `repositories/bookings/lifecycle.rs:818`, called at :1585) checks only
   `balance_due > 0`. **No server-side deposit check exists** — the gate was
   only ever a disabled button in one modal.

A nastier variant of the same bug: guest pays part of the bill plus a held
deposit → modal shows "Fully Paid" and hides Record Payment, so a real
outstanding balance can't be collected through the modal.

## Current deposit model (what this design preserves)

- `payments` rows are the only money authority:
  `payment_type='deposit' AND status='completed'` = held collateral;
  `payment_type='refund' AND status='refunded'` = returned.
- `bookings.deposit_paid/deposit_amount/deposit_paid_at` are a synced read
  mirror for the UI — never a source for money decisions.
- Refund ceiling: `Σ(deposit,completed) − Σ(refund,refunded)`, computed under
  a `FOR UPDATE` booking lock (`PaymentRepository::refund_deposit`).
- Flag-only legacy deposits (`deposit_paid=true` with no row) are resolved by
  the modal's attest-then-refund path: `updateBooking` asserts the amount,
  `reconcile_booking_deposit_tx` mints the missing row under lock, then
  `refund_deposit` draws on it.
- Waive (`updateBooking deposit_paid:false, deposit_amount:0`) is **rejected**
  by the backend when a completed deposit row exists ("refund or void the
  payment instead of clearing the flag"). Waive means "never collected".
- `void_payment_tx` already refuses refund rows; voiding any `completed`
  payment requires `payments:manage`.

## Approved decisions

- **Enforcement**: hard block in the backend — the `checked_out`/`completed`
  transition is rejected while an unresolved deposit exists. Resolution
  (refund / forfeit / waive) is a separate prior call, not a checkout-payload
  field.
- **Forfeit**: first-class action that keeps the money on the books.
- **Delete affordance**: removed from deposit rows in the folio UI, plus a
  server-side void guard after check-in.

## Design

### 1. Frontend — fix the false "Overpayment" and deposit row affordances

`CheckoutInvoiceModal.tsx`:

- `paymentRowsTotal`, the payment-amount prefill effect, and the
  record-payment cap (`isGreaterMoney(paymentAmount, balanceDue)`) all switch
  to a single `settledPaymentsTotal` that counts only
  `status='completed' AND payment_type NOT IN ('deposit','deposit_forfeited')`
  — identical to the backend `total_paid` predicate. (Refund rows carry
  `status='refunded'` so they were already excluded.)
- `completedPayments` splits into bill payments vs deposit-type rows.
  Deposit rows render in their own labeled group — "Held deposit
  (refundable)" / "Deposit forfeited" — **without** Edit or Delete icons.
  Edit is removed as well as delete: deposit amounts change only through
  refund/forfeit, not inline edits.
- The "Overpayment" footer label stays; after the fix it can only appear for
  a genuine bill overpayment.

Deposit section of the modal:

- "Refund {amount}" unchanged (attest-mint path retained).
- "Waive" relabeled to its real meaning: deposit was recorded but never
  collected — allowed only when no completed deposit row exists (backend
  already enforces this).
- New **"Forfeit"** action beside it: shown when a refundable deposit exists;
  amount defaults to the refundable balance (editable for partial forfeit),
  reason required → calls the forfeit endpoint. Copy example: "Keep the
  deposit (lost keycard, damage): …".
- A `depositForfeited` UI state tracks forfeiture so the Confirm gate
  (`depositRefund > 0 && !depositRefunded && !depositWaived && !depositForfeited`)
  releases only after a real resolution.

### 2. Backend — `deposit_forfeited` payment type + forfeit endpoint

**Schema** (the only DB change): widen `payments_payment_type_check` to
include `'deposit_forfeited'`. Per the patch-catalog contract this means:

- edit the CHECK in `database/postgres/migrations/0001_v1_baseline.sql`;
- add `database/postgres/patches/0019_<name>.sql` (idempotent
  `ALTER TABLE … DROP CONSTRAINT / ADD CONSTRAINT`) and register it in
  `patches/manifest.tsv`;
- name the patch in `.github/workflows/deploy.yml`, `deploy/deploy.sh`,
  `deploy/deploy-staging.sh`, `.github/workflows/deploy-staging.yml`
  (`tests/postgres_patch_catalog.rs` enforces the first three);
- bump `tests/postgres_patch_lifecycle.rs` in its four hardcoded spots
  (`version BETWEEN 2 AND 19` twice, expected-revision list,
  `revisions.len()`).

**Endpoint**: `POST /api/payments/forfeit-deposit/{booking_id}`
`{amount, reason}` gated on `payments:refund` (same routine desk gate as
refund; `payments:manage` implies it). Behaviour:

- requires a non-empty `reason`;
- serializes on the booking `FOR UPDATE` lock, same as `refund_deposit`;
- rejects when `amount <= 0`, or `amount > refundable`, where

      refundable = Σ(deposit,completed) − Σ(refund,refunded)
                 − Σ(deposit_forfeited,completed)

- inserts `payments(payment_type='deposit_forfeited', status='completed',
  notes='Deposit forfeited: <reason>')` — the row stays `completed` because
  the cash really was collected; only its refundable status changes;
- audit-logs `payment_deposit_forfeited` with amount + reason;
- resyncs the deposit mirror.

`record_payment`'s caller-supplied-type whitelist
(`booking|deposit|service|damage`, `services/payments.rs:~262`) stays
unchanged — `deposit_forfeited` rows are written exclusively by the forfeit
endpoint, which is the only path that attaches a required reason.

**Read-path updates** (each subtracts the forfeited sum):

- `PaymentRepository::refund_deposit` refundable ceiling.
- `sync_booking_deposit_mirror_tx`: mirror becomes "deposit still held and
  refundable" = `Σ(deposit,completed) − Σ(deposit_forfeited,completed)`.
  A full forfeit clears `deposit_paid`, which releases the modal's gate
  without any extra flag plumbing.
- `workflow_summary_row` + `get_payment_workflow_summary`: add
  `deposit_forfeited`; the "Collected deposit has not been fully refunded"
  warning and "Refund deposit" next-action key off
  `collected − refunded − forfeited > 0`.

Partial forfeit is supported for free by the amount parameter — the
remainder stays refundable and still blocks checkout until refunded.

### 3. Backend — checkout deposit guard

Extend `ensure_checkout_balance_resolved` (or a sibling
`ensure_checkout_deposit_resolved` invoked at the same call site,
`lifecycle.rs:~1585`): on transition to `checked_out`/`completed` from a
non-terminal status, block when

    unresolved = Σ(deposit,completed) − Σ(refund,refunded)
               − Σ(deposit_forfeited,completed)
    unresolved > 0
    OR (booking.deposit_paid AND booking.deposit_amount > recorded deposit)
        -- flag-only legacy deposits with no rows behind them

with `ApiError::BadRequest("Refund, forfeit, or waive the collected deposit
of {amount} before checkout")` — actionable, and never the word
"overpayment".

- The guard reads pre-update state at the existing call site (before
  `reconcile_booking_deposit_tx` at :1712), so a waive folded into the
  checkout request itself does not satisfy it — resolution is a prior call,
  matching how the modal already works (waive/refund/forfeit first, then
  Confirm).
- **Not** exempted by company billing — a corporate booking can still hold a
  keycard deposit.
- `late_checkout` and night audit are unaffected (audit only marks
  `late_checkout`, never transitions to `checked_out`).

### 4. Backend — void guard on deposit rows

In `void_payment_tx` (`repositories/payment.rs:~1900`), refuse to void a
`completed` `deposit` row when the booking is in-house or later
(`checked_in`, `auto_checked_in`, `late_checkout`, `checked_out`,
`completed`):

    "Deposit payments can't be voided after check-in — refund or forfeit
     the deposit instead."

Pre-stay statuses (`pending`, `confirmed`, …) keep the existing
`payments:manage` void path for genuine entry mistakes. `deposit_forfeited`
rows are deliberately **not** covered: a `payments:manage` void of a forfeit
row is the un-forfeit escape hatch — it re-opens the deposit as refundable,
which the checkout guard then re-blocks. Safe direction. Same precedent as
the existing refund-row refusal.

## Non-goals

- Auto-posting forfeited deposits as a revenue/charge line on the invoice —
  the `deposit_forfeited` row keeps the money visible and auditable;
  revenue-recognition reporting can build on it later.
- An un-void endpoint for the incident's deleted row — it survives as
  `status='void'` with a full audit snapshot; restoring it is manual SQL or
  re-recording the deposit.
- Refactoring the mirror or the flag-only attest path.

## Edge cases

- **Flag-only legacy deposit**: guard blocks via the mirror clause; admin
  refunds (modal mints the row first) or waives (`recorded = 0` → waive
  allowed). Covered.
- **Partial forfeit**: remainder still refundable → still blocks.
- **Forfeit then change of mind**: a `payments:manage` void of the
  `deposit_forfeited` row re-opens the refundable deposit; the checkout
  guard re-blocks until it is refunded or re-forfeited.
- **Concurrent refund + forfeit**: both serialize on the booking lock.
- **Booking void**: `void_booking_payments_tx` voids all payment rows
  including deposits — unchanged; a voided booking owes no checkout refund.
- **Company billing**: balance guard bypassed as today, deposit guard not.

## Testing

Backend integration tests (need `DATABASE_URL`; payments + booking state
transitions are on the AGENTS.md test-required list):

- checkout rejected while a completed deposit is unrefunded; succeeds after
  `refund_deposit`; succeeds after `forfeit_deposit`; partial forfeit leaves
  the remainder blocking;
- flag-only deposit (`deposit_paid` + amount, no row) blocks checkout;
- forfeit rejects: amount > refundable, empty reason, second forfeit past
  ceiling, forfeit when none held;
- voiding a completed deposit rejected on `checked_in`, allowed on
  `confirmed`;
- `payments_payment_type_check` accepts `deposit_forfeited` (covered by any
  forfeit insert).

Frontend (vitest):

- checkout modal balance excludes deposit-type rows: full bill payment +
  held deposit ⇒ "Fully Paid", not "Overpayment"; partial bill payment +
  deposit ⇒ correct remaining balance and Record Payment still offered;
- deposit rows render labeled with no delete control; forfeit flow wires the
  gate release.

Gates: `cargo check`, `cargo clippy -- -D warnings`, `cargo test` with
`DATABASE_URL`; `bun run typecheck && bun run lint && bun run test`;
`HOTEL_APP_UPDATE_OPENAPI=1 cargo test --test openapi_drift` (new route);
patch-catalog + lifecycle tests.
