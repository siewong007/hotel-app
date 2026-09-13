# Legacy flag-only deposit refund — design

Date: 2026-09-13
Status: approved approach (Option A, convert-on-refund), pending spec review

## Problem

Bookings created before the 2026-08-21 payment-integrity rework (commit
`05872a1b`) — or loaded via data import — can carry a **flag-only deposit**:
`bookings.deposit_paid = true` and `deposit_amount > 0` with **no**
`payments(payment_type='deposit', status='completed')` row behind them.

`refund_deposit` (`hotel-app-be/src/repositories/payment.rs`) computes the
refundable ceiling purely from the payments ledger:

    refundable = Σ(deposit payments, completed) − Σ(refund rows, refunded)

For a flag-only deposit this is 0, so Refund Deposit fails with *"No refundable
deposit was collected for this booking"*. The checkout modal's deposit gate
(`CheckoutInvoiceModal.tsx` — "Must be refunded or waived before checkout")
then disables **Proceed to Checkout** forever: no refund row can ever be
created, and the modal's Waive button only flips local React state, so the flag
survives and relocks the next attempt. Result: a fully-paid booking cannot be
checked out. ~2,000 bookings in the local dataset carry flag-only deposits, so
this recurs at every legacy checkout.

## Goals

1. One-click deposit refund works for flag-only legacy deposits.
2. The "payments ledger is the only authority" invariant is preserved and
   strengthened — no client can mint refundable money.
3. Waive becomes a real, persisted operation for deposits that were never
   collected.
4. No schema change; no batch data migration with money side-effects.

## Non-goals

- The `billable_total` (room + tourism tax + extra bed) vs room-only
  `total_amount` divergence between the frontend balance gate, the backend
  checkout guard, and `payment_status` — a separate latent inconsistency,
  intentionally out of scope.
- The pre-existing quirk that `deposit` payments count toward `total_paid` in
  balance math — unchanged by this work.
- Bulk repair of other flag-only bookings; each now self-heals at refund time.

## Design

### Backend: `refund_deposit` conversion (payment.rs)

Inside the existing transaction, after the booking row lock and the
"already refunded" probe, replace the bare `refundable <= 0` rejection with a
legacy-conversion branch.

Current order (kept): `FOR UPDATE` lock → existing active-refund probe →
compute `deposit_sum` and `refunded_sum` → refundable.

New branch, taken only when **all** of:

- `deposit_sum = 0` — no deposit payment rows exist at all
- `refunded_sum = 0` — no active (`status='refunded'`) refund rows exist
  (voided/reverted rows do not count, so a reverted refund still converts —
  correct re-refund semantics)
- `bookings.deposit_paid = true` AND `bookings.deposit_amount > 0`

then:

1. `INSERT INTO payments (uuid, booking_id, amount, payment_method,
   payment_type, status, notes, created_by)` a `deposit`/`completed` row for
   `bookings.deposit_amount`, notes `'Keycard deposit reconciled from booking
   record'`, `payment_method` from the refund request (default `cash`),
   `created_by` = caller — this is the attestation that the cash was
   physically held.
2. `sync_booking_deposit_mirror_tx` — rewrites the mirror canonically (no-op
   values, keeps the invariant honest).
3. Recompute `refundable` (= `deposit_amount`).

Then the existing `deposit_amount > refundable` bound and refund-row insert run
unchanged. Every other `refundable <= 0` case (no flag, flag with null/zero
amount, deposit already refunded) keeps today's error.

Why this does not reopen the hole `05872a1b` closed: `bookings.deposit_*` can
no longer be written from any API — `reconcile_booking_deposit_tx` intercepts
update assertions and ignores bare flag echoes — so a flag-only row is by
definition pre-rework data. The identical money outcome is already reachable
today through the supported two-step (booking update asserts the deposit →
`reconcile` mints the payment row → refund succeeds). The change collapses
that attestation into the refund call where staff actually need it, inside one
audited transaction.

Residual risk, accepted: a user holding refund permission but **not**
`bookings:update` gains the conversion; impact is bounded by
`deposit_amount` and both rows carry `created_by` + distinguishing notes.

### Frontend: persist Waive (CheckoutInvoiceModal.tsx)

The Waive button currently calls only `setDepositWaived(true)`. Change it to
first call `BookingsService.updateBooking(booking.id, { deposit_paid: false,
deposit_amount: 0, payment_note: 'Deposit waived: <reason>' })`.

- Server side, `reconcile_booking_deposit_tx` runs a Waive intent: allowed
  exactly when no completed deposit payment exists (the flag-only case) —
  clears `deposit_paid`/`deposit_amount`/`deposit_paid_at`. The flag stops
  relocking future checkouts and the reason lands in `payment_note`.
- On success: `setDepositWaived(true)` + `invalidateInvoiceState()`.
- On rejection (a real deposit payment exists → "refund or void the payment
  instead", or permission failure): show the error, do **not** unlock — staff
  must refund real money rather than waive it.

`depositWaived` local state still governs the button within the session;
persisting means reopening the modal shows the cleared flag instead of the
deposit section.

### Unblock the stuck room-201 booking (ops, no deploy required)

Two supported options, pick by what physically happened:

- Cash deposit was collected: booking update with `deposit_paid=true,
  deposit_amount=50` (Collect assertion mints the real deposit row) → Refund
  Deposit → checkout.
- No cash was held: booking update with `deposit_paid=false,
  deposit_amount=0` (Waive) → checkout.

After this ships, either case resolves by clicking Refund/Waive normally.

## Error handling

- Conversion runs inside the same tx as the refund — a failure rolls back
  both, leaving the flag and ledger untouched (today's state).
- Distinct audit trail: the conversion row's notes identify it as reconciled,
  and `refund_deposit`'s existing audit event already covers the refund.
- Double-refund is impossible: the conversion branch requires zero active
  refund rows, and the existing probe still rejects a second refund.

## Testing

Backend (integration, `hotel-app-be/tests/` — needs `DATABASE_URL`; the
flag-only state cannot be produced through the API, so tests seed it with
direct SQL):

- flag-only deposit → refund succeeds, creates `deposit`/`completed` +
  `refund`/`refunded` rows, mirror stays consistent.
- second refund on the same booking → "Deposit already refunded".
- flag-only deposit + pre-existing `refunded` row → rejected, no conversion.
- flag-only deposit + `void` refund row → conversion allowed (re-refund).
- refund amount > `deposit_amount` → bound error.
- no flag, no deposit payments → unchanged "No refundable deposit" error.
- checkout after conversion: `ensure_checkout_balance_resolved` passes and
  the modal-visible payment list contains the refund row (gate opens).

Frontend (Vitest): Waive calls `updateBooking` with the waive payload, unlocks
on success, surfaces the error and stays locked on rejection.

## Verification

- `cargo test --all-features` with `DATABASE_URL` (verify run count, not exit
  code), `cargo clippy --all-features -- -D warnings`.
- `bun run typecheck && bun run lint && bun run test`.
- Manual: against dev DB, reproduce a flag-only booking → Refund Deposit →
  Proceed to Checkout enabled → checkout completes.
