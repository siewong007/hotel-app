# Deposit payment method — design

Date: 2026-09-14
Status: approved (design)
Related: `2026-09-13-deposit-checkout-guard-design.md` (whose void guard makes
this correction path necessary — see "Why a method edit, not void+re-record").

## Problem

Deposit rows are recorded with the **booking's** `payment_method` — the
tender/channel chosen for the room bill (e.g. `Debit Card`, `online_banking`)
— not the tender the desk actually collected for the deposit, which is mostly
cash. Both check-in UIs already show a "Deposit Method" dropdown
(`depositMethod`, default `'Cash'`), but its value only reaches
`payment_note` text (`"Deposit received (Cash)"`); it never lands on
`payments.payment_method`. The ledger row says `debit` while the note says
cash — the wrong-method report.

Once posted, the wrong method is unfixable: `update_payment_tx` makes
amount/method/date immutable on `completed` rows, the deposit-checkout-guard
work now blocks voiding in-house deposit rows, and the checkout modal no
longer offers Edit on deposit rows. Wrong rows on the books are permanent.

## Surfaces that write deposit rows

1. `create_booking` (`repositories/bookings/lifecycle.rs` ~1249):
   `input.amount_paid > 0` → `record_checkin_payment_tx` with
   `payment_method = input.payment_method` — the booking-level method.
2. `reconcile_booking_deposit_tx` (~2772): the `deposit_paid`/`deposit_amount`
   assertion mints a deposit row with
   `booking_update.payment_method.unwrap_or("Cash")` — the booking-level
   method (or the room-bill "pay now" method when the check-in modal sends
   `paymentType` under the same field).
3. `POST /payments` (`record_payment`): caller picks the method — already
   correct.
4. `forfeit_deposit`: copies `payment_method` from the latest completed
   deposit — a wrong method propagates into the forfeit row.

## Approved decisions

1. **Scope is the tender method only.** No `payment_type` recategorization
   (booking↔deposit) — that moves money between bill-settling sums.
2. **Correctable afterward.** Method-only edit allowed on completed deposit
   rows; existing wrong rows get a fix path.

## Design

### 1. Record the chosen method — `deposit_payment_method` request field

Add `deposit_payment_method: Option<String>` to `BookingUpdateInput`
(`models/booking.rs` ~211, beside `deposit_amount`) and to `BookingInput`
(~146, beside `amount_paid`).

- `reconcile_booking_deposit_tx` binds
  `booking_update.deposit_payment_method.as_deref()
    .or(booking_update.payment_method.as_deref()).unwrap_or("Cash")`
  — fallback chain preserves today's behavior for callers that don't send it.
- `create_booking` passes
  `input.deposit_payment_method.clone().or(input.payment_method.clone())
    .unwrap_or_else(|| "Cash".to_string())`
  to the `CheckInPaymentRecord` it builds.
- A present-but-blank value is treated as absent (trim → empty → fall back).
  Methods are free-form `varchar(50)` everywhere today; this spec adds no new
  validation.

### 2. Method-only correction — relax `update_payment_tx` for deposit rows

In the `existing_status == "completed"` immutability block
(`repositories/payment.rs` ~1900):

- `amount_changed` and `date_changed` stay rejected for **all** types.
- `method_changed` becomes permitted when `existing_type` is `deposit` or
  `deposit_forfeited`; for `booking`/`service`/`damage` rows it stays
  rejected.
- Refund-type rows and `refunded`/`void` rows stay rejected as today.
- Same-value resubmission stays a permitted no-op (existing rule).

Everything else about the path is unchanged: `PATCH /payments/{id}` gate
(`payments:update`), the booking `FOR UPDATE` lock, `payment_status`
recompute, and the `payment_updated` audit event — which already records
before/after `payment_method`, so corrections are logged for free. The
idempotency fingerprint is recomputed from final values, so a method change
updates the dedup key consistently.

Rationale: method is a descriptive attribute (which till the money went
into), not money movement — rewriting `Debit Card`→`Cash` changes no sum,
and no other correction path remains after the deposit void guard.

### 3. Frontend

- `CheckInDialog` + `EnhancedCheckInModal`: when `depositChoice === 'receive'`,
  send `deposit_payment_method: depositMethod` in the booking update.
  `payment_note` keeps its `"(method)"` text.
- `CheckoutInvoiceModal` deposit section: deposit rows get an **Edit** action
  reopening the existing inline edit form — but for deposit-type rows
  (`deposit`, `deposit_forfeited`) the form shows only the **method
  dropdown** (amount, date, reference hidden; request sends only
  `payment_method`). No delete — that stays removed.
- `BookingUpdate`/check-in TS types gain `deposit_payment_method?: string`.

## Edge cases

- `deposit_forfeited` rows inherit the deposit's method at forfeit time —
  editable by the same rule so the correction propagates.
- Non-completed deposit rows (pending/failed) are already editable —
  unchanged.
- A flag-only deposit asserted via the modal's attest path records with
  `deposit_payment_method` when the caller sends it.
- `LedgerService.updateLedgerPayment` touches
  `customer_ledger_payments`, a different table — untouched.

## Out of scope

- `payment_type` changes; amount/date edits on posted rows.
- A deposit option in the generic `PaymentDialog` (it still posts `booking`
  payments only).
- `bookings.booking_channel_id` (sales channel — a reservation attribute,
  not tender) and `payments.payment_gateway`.
- Backfilling historical wrong-method rows — they're corrected on demand via
  part 2.

## Testing

- `payment_characterization.rs`: completed deposit method update allowed;
  amount/date still rejected; `booking`-type method still rejected;
  `deposit_forfeited` method allowed; blank `deposit_payment_method` falls
  back; reconcile/check-in records the supplied method.
- FE: modal test — deposit-row edit exposes method only; check-in sends
  `deposit_payment_method`.
