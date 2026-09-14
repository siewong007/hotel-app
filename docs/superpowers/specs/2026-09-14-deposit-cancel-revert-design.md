# Deposit restore + cancel/revert — design

Date: 2026-09-14
Status: approved (design)
Related:
- `2026-09-14-deposit-payment-method-design.md` — implemented on branch
  `feat/deposit-payment-method` (fixes the wrong-method root cause; its
  "no delete" decision is superseded by this spec's cancel+revert workflow).
- `2026-09-13-deposit-checkout-guard-design.md` — added the in-house deposit
  void guard this spec partially relaxes.

## Problem

1. On production (VPS `saliminn-db`), seven RM50 keycard deposits were voided
   on 2026-09-13 by user 1000. The rooms' deposits must be restored as **Cash**
   (the voided rows carry notes "Deposit received (Cash)" but wrong
   `payment_method` values — Visa/Debit/Booking.com — caused by the
   deposit-method bug fixed on `feat/deposit-payment-method`).
2. Staff need a supported way to cancel a deposit — recorded in error, never
   collected — that flips the booking's deposit state to "no deposit
   collected", **and** a way to revert the cancellation. Today the only paths
   are refund/forfeit (checkout semantics) or the generic payment void, which
   current `master` refuses for in-house bookings.
3. Restored/cancelled deposits must never count toward bill payments — the
   deposit-is-collateral exclusion already in place must keep holding (no
   "Overpayment" regression).

## Production state verified 2026-09-14

| Room | Booking | Status      | Voided deposit payment id | Amount | Recorded method |
|------|---------|-------------|---------------------------|--------|-----------------|
| 104  | 4722    | checked_in  | 5598                      | 50.00  | Debit Card      |
| 202  | 4794    | checked_in  | 5594                      | 50.00  | Booking.com     |
| 203  | 4795    | checked_in  | 5587                      | 50.00  | Visa Card       |
| 204  | 4796    | checked_in  | 5589                      | 50.00  | Debit Card      |
| 215  | 4715    | checked_in  | 5596                      | 50.00  | Booking.com     |
| 107  | 4783    | checked_out | 5592                      | 50.00  | Cash            |
| 111  | 4382    | checked_out | 5585                      | 50.00  | Debit Card      |

User-confirmed facts: all seven deposits were collected in **cash**; for the
two checked-out stays the RM50 cash was **physically refunded** at checkout.

## Part 1 — Production data fix (one-off SQL, VPS `saliminn-db`)

Run inside one transaction after a table-level backup
(`CREATE TABLE payments_bak_20260914 AS SELECT * FROM payments` and the same
for the touched `bookings` columns):

```sql
BEGIN;
-- Un-void the seven deposit rows and correct the tender to Cash.
UPDATE payments
   SET status = 'completed', payment_method = 'Cash'
 WHERE id IN (5585, 5587, 5589, 5592, 5594, 5596, 5598)
   AND payment_type = 'deposit' AND status = 'void';
-- Resync the booking mirror; deposit_paid_at keeps the original
-- collection timestamp (row created_at), not the restore time.
UPDATE bookings b
   SET deposit_paid = true,
       deposit_amount = 50.00,
       deposit_paid_at = COALESCE(b.deposit_paid_at,
           (SELECT MIN(p.created_at) FROM payments p
             WHERE p.booking_id = b.id AND p.payment_type = 'deposit'
               AND p.status = 'completed')),
       updated_at = CURRENT_TIMESTAMP
 WHERE b.id IN (4722, 4715, 4794, 4795, 4796, 4783, 4382);
-- Refund markers for the two checked-out stays (cash was handed back).
INSERT INTO payments
    (uuid, booking_id, amount, payment_method, payment_type, status, notes, created_by)
VALUES
    (gen_uuidv7(), 4783, 50.00, 'Cash', 'refund', 'refunded', 'Keycard deposit refund', 1000),
    (gen_uuidv7(), 4382, 50.00, 'Cash', 'refund', 'refunded', 'Keycard deposit refund', 1000);
COMMIT;
```

- `payment_status` is unaffected: the `sync_booking_payment_status` trigger
  and `total_paid` exclude `deposit`/`refund`/`deposit_forfeited` rows —
  deposits stay collateral, never bill settlement → no overpayment.
- Checked-out bookings keep `deposit_paid = true / 50.00` on the mirror —
  the existing convention for collected-then-refunded deposits (the mirror
  nets forfeits, never refunds); the refund marker rows balance the ledger.
- Expected result: 5 in-house bookings show a held RM50 deposit (checkout
  gate will require refund/forfeit/waive); 2 checked-out bookings show
  deposit collected + refunded, net zero.
- The void stamps (`processed_at`/`processed_by`) stay on the un-voided rows
  as history of the void. The SQL fix bypasses the audit log — the
  `payments_bak_20260914` snapshot plus this spec are the record of it.

## Part 2 — Cancel deposit (void), relaxed for in-house stays

`repositories/payment.rs::void_payment_tx` currently rejects voiding a
`completed` `deposit` row when the booking is in-house
(`checked_in | auto_checked_in | late_checkout | checked_out | completed`).

New rule, per user decision:

- Deposit void is **allowed** for `pending | reserved | confirmed |
  checked_in | auto_checked_in | late_checkout` bookings.
- Deposit void stays **rejected** for `checked_out | completed` bookings —
  post-checkout corrections go through refund/forfeit; the books are closed.
- Deposit rows are exempt from the "completed payment ⇒ `payments:manage`"
  rule: a deposit is collateral, not settled revenue, and the workflow must
  be usable at the desk. Cancelling rides the route's existing
  `payments:delete` gate. (Accepted risk: a `payments:delete` holder can void
  a collected deposit on an in-house booking — mitigated by the
  `payment_voided` audit snapshot and the revert path, not prevented.)
- All other `void_payment_tx` rules unchanged: `refund` rows still refused
  (revert workflow owns them), terminal statuses still refused, mirror resync
  still runs for deposit/deposit_forfeited voids.

No new route needed for cancel — `DELETE /payments/{id}` already exists,
audit-logs `payment_voided`, and drops the row out of every aggregate.

## Part 3 — Revert endpoint

`POST /payments/revert-deposit-void/{booking_id}`, gated `payments:delete`
(user choice — same gate as cancel).

`PaymentRepository::revert_deposit_void(pool, booking_id) -> i64`:

- Selects the newest `payments` row with `payment_type = 'deposit' AND
  status = 'void'` (`ORDER BY id DESC LIMIT 1`), flips it to `completed`,
  then `sync_booking_deposit_mirror_tx` + `recompute_booking_payment_status`.
- `BadRequest("No voided deposit to revert")` when none exists.
- One row per call — if two cancelled rows exist the desk restores them one
  at a time; an older intentionally-voided row is never resurrected by
  accident. Works on any booking status including checked-out (restoring a
  deposit on a closed stay is a legitimate correction). Flips `status` only;
  the void's `processed_at`/`processed_by` stamps remain as history.
- Service layer mirrors `revert_deposit_refund`: audit event
  `deposit_void_reverted` with `booking_id` + `reverted_payment_id`.
- Route merged in `routes/payments.rs` beside `revert-deposit-refund`;
  regenerate `docs/api/openapi.json` (`openapi_drift` is a CI gate).

## Part 4 — Frontend (CheckoutInvoiceModal deposit section)

- `invoices.service.ts`: add `revertDepositVoid(bookingId)` →
  `POST payments/revert-deposit-void/{id}`. `deletePayment(paymentId)`
  already exists.
- Deposit section gains, gated on `useAuth().hasPermission('payments:delete')`
  and `!readOnly`:
  - **Cancel deposit** — visible while completed deposit row(s) exist.
    Confirm dialog ("marks the deposit as not collected; restorable").
    Voids every completed `deposit` row (usually one) via `deletePayment`,
    then reloads payments. Result: section shows "No deposit collected" and
    the checkout gate no longer holds.
  - **Restore deposit** — visible when no completed deposit exists but
    voided deposit row(s) do (`payment_status === 'void'` rows already arrive
    in the `all-payments` payload; they are just filtered out of the folio).
    Label shows the restorable count; each click calls `revertDepositVoid`
    once (newest voided row). When restored the section returns to
    "Deposit held" and the checkout gate re-arms.
- The folio's deposit group stays read-only — no per-row delete icon; the
  affordance lives in the deposit section so intent is explicit. The existing
  incident-regression test (`getAllByTestId('DeleteIcon')` length) is updated
  to reflect the deliberate new affordance.

## Out of scope

- `deposit_payment_method` plumbing — already implemented on
  `feat/deposit-payment-method`; this spec does not duplicate it. The prod
  fix sets `payment_method = 'Cash'` directly in SQL (same end state).
- New payment statuses or schema changes — `void`/`completed` suffice; the
  payments ledger stays the only deposit authority.
- Per-row delete icon on the deposit folio group; batch revert in one call.

## Testing

- Backend (`DATABASE_URL` required): `void_payment_tx` allows in-house
  deposit void, rejects checked-out deposit void, still rejects refund rows;
  `revert_deposit_void` round-trips status + mirror, errors when none;
  `delete_payment` on a deposit succeeds for a `payments:delete`-only user.
- Frontend: modal shows Cancel under permission, hidden without; confirm →
  delete called → "No deposit collected" + Restore appears; restore calls
  the endpoint and re-arms the gate; the false-Overpayment regression tests
  stay green.
- Prod fix verification: inside the transaction, assert 7 updated deposit
  rows, 7 updated bookings, 2 inserted refunds, then spot-check
  `/payments/workflow-summary/{booking_id}` for one in-house booking.

## Risks

- `payments:delete` (not `payments:manage`) for deposit void/restore is a
  wider grant than the `revert_deposit_refund` precedent — deliberate per
  user; audit + revert mitigate but cannot prevent silent cash leakage.
- `feat/deposit-payment-method` is unmerged; both touch
  `CheckoutInvoiceModal`/`lifecycle.rs` — expect minor merge friction.
- Worktree carries unrelated in-flight edits (PayPal-conflicts work) in
  `handlers/payments.rs`, `routes/payments.rs`, audit files — do not revert.
