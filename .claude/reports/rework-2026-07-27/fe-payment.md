# FE Payment / Checkout / Invoice Audit — 2026-07-27

Scope: `hotel-web-fe/src/features/invoices/**`, `features/admin/{PaymentApprovalsPage,usePaymentApprovalsQueries,paymentReceiptPdf}`,
`features/guestPortal/components/GuestPaymentPanel.tsx` + PayPal-touching guest portal surfaces,
`api/{invoices,paymentApprovals}.service.ts`, `types/payment.types.ts`, plus the backend
counterparts needed to verify money-figure agreement (`hotel-app-be/src/services/payments.rs`,
`repositories/payment.rs`, `models/payment.rs`, `repositories/bookings/lifecycle.rs`).

All line numbers below were obtained by `grep -n` / limited `Read` in this session (2026-07-27).

---

## 1. Inventory: `CheckoutInvoiceModal.tsx` (1988 lines)

Imports/hooks used: `useState`/`useEffect` (React), `useQueryClient` (react-query),
`useCurrency`, `useCheckoutInvoiceData` (data hook), plus 4 API service classes
(`BookingsService`, `InvoicesService`, `LedgerService`) called directly from inside
the component (lines 226–406).

State inventory (all local `useState`, lines 92–157):
- checkout flow: `loading`, `error`, `checkoutStep` ('preview'|'confirm')
- record-payment form: `showPaymentForm`, `paymentAmount`, `paymentMethod`, `paymentReference`, `paymentNotes`, `paymentDate`, `recordingPayment`
- edit-payment form: `editingPayment`, `editAmount`, `editMethod`, `editReference`, `editNotes`, `editDate`, `updatingPayment`, `deletingPaymentId`
- deposit refund: `refundingDeposit`, `revertingRefund`, `refundPaymentMethod`
- deposit waive: `depositWaived`, `depositWaiveReason`
- daily-rate editing: `editingRates`, `savingRates`

Data comes from `useCheckoutInvoiceData` (hooks/useCheckoutInvoiceData.ts, 193 lines):
hotel settings, room price, guest company/address/phone/IC, `payments`, `depositRefunded`,
`editableDailyRates`, and `reloadPayments`. `useCheckoutFlow` (157 lines) is a *separate*
hook, not called by this component — it's owned by the *parent* pages (BookingsPage,
CustomerLedgerPage, RoomManagementPage via `CheckoutInvoiceModals.tsx`) and its
`confirmCheckout` is passed in as the `onConfirmCheckout` prop. So today: modal owns all
payment/deposit/rate UI-state and mutations; `useCheckoutInvoiceData` owns fetch/derive
of read-only inputs; `useCheckoutFlow` owns only the final booking-status transition +
room-dirty side effect, orchestrated one level up.

Mutations fired directly from this 1988-line file (7 handlers, lines 220–406):
`handleRecordPayment` (POST payments/record-payment or ledger payment), `handleUpdatePayment`
(PATCH payments/:id or ledger payment), `handleDeletePayment` (DELETE payments/:id or ledger
payment), `handleRefundDeposit` (POST payments/refund-deposit/:id), `handleRevertDepositRefund`
(POST payments/revert-deposit-refund/:id), `handleSaveDailyRates` (PATCH booking daily_rates),
`handleConfirmCheckout` (delegates to `onConfirmCheckout` i.e. `useCheckoutFlow.confirmCheckout`).

Rendering duplication (see finding F08): the "preview" step (lines ~713–1610) and the
"confirm" step (lines ~1719–1880) each independently re-render the entire charges
breakdown (room charges, service tax, tourism tax per-night, extra bed, deposit status,
grand total) from the same `charges` object, and `CheckoutInvoicePrintView.tsx` (300
lines) renders a *third* independent copy of the same breakdown (consuming the same
`charges` prop, but with its own per-night tourism-tax date loop).

### Proposed decomposition (concrete files)

- `features/invoices/hooks/useCheckoutPayments.ts` — record/edit/delete payment state
  + handlers (currently CheckoutInvoiceModal.tsx:130–147, 220–334).
- `features/invoices/hooks/useDepositResolution.ts` — refund/revert/waive deposit state
  + handlers (currently lines 148–156, 336–390).
- `features/invoices/components/ChargesBreakdownTable.tsx` — one presentational
  component taking `{ charges, booking, hotelSettings, editableDailyRates?, editable?,
  onRateChange? }`, used by the preview step, the confirm step, *and* passed into
  `CheckoutInvoicePrintView` instead of each re-deriving the per-night rows.
  This directly removes the triplicated per-night date loop (F08).
  Fold `useEditableDailyRates` (currently split between `useCheckoutInvoiceData.ts`'s
  init effect at lines 144–163 and the modal's `handleSaveDailyRates`) into a single
  `features/invoices/hooks/useEditableDailyRates.ts`.
- `CheckoutInvoiceModal.tsx` shrinks to: step state, the two remaining hooks above,
  `useCheckoutInvoiceData`, and the confirm-checkout orchestration glue — should land
  well under 500 lines.

---

## 2. Money-figure correctness: client vs backend

| Figure (FE) | FE source | BE source of truth | Can disagree? |
|---|---|---|---|
| Room charges / service tax split | `chargesCalculation.ts:55-65` — derives tax-inclusive `roomSubtotal` from `editableDailyRates` → `booking.daily_rates` → `price_per_night × nights`, then splits by **current** `hotelSettings.service_tax_rate` | `bookings.total_amount` (frozen at booking time) is the only value the backend checks (`checkout_balance_due`, lifecycle.rs:694-699); the room/tax **split** shown is never validated server-side | **Yes, cosmetically**: if `service_tax_rate` changes after booking, the room-vs-tax line-item split shown on the invoice no longer matches what was actually charged, though the *sum* stays anchored to the booking's real total. Low severity (display only). |
| Tourism tax | `chargesCalculation.ts:71-75` — `multiplyMoney(hotelSettings.tourism_tax_rate, nights)` using the **current live** rate, only gated on `guest_tourism_type==='foreign' \|\| is_tourist` | `bookings.tourism_tax_amount` — a column frozen at booking time (`models/payment.rs:262-289`, `PaymentWorkflowSummaryRow.billable_total() = total_amount + tourism_tax_amount + extra_bed_charge`); this is what `record_payment`'s balance guard (services/payments.rs:225-238) actually enforces | **Yes, materially** (see F03/F04 below). `BookingWithDetails.tourism_tax_amount` exists in the FE type (`types/booking.types.ts:30`) but `chargesCalculation.ts` never reads it — it recomputes from today's hotel-settings rate instead of the frozen value. |
| Extra bed charge | `chargesCalculation.ts:77-79` — reads `booking.extra_bed_charge` directly (frozen), then splits tax via current `service_tax_rate` | same `extra_bed_charge` column, used raw in `billable_total()` | Sum agrees; only the tax/charge *split within* extra-bed can drift with `service_tax_rate` (same cosmetic caveat as row 1). |
| Deposit / deposit refund | `chargesCalculation.ts:67-69` — `booking.deposit_amount` if `booking.deposit_paid` | `PaymentRepository::refund_deposit` (repositories/payment.rs:785) drives the real refund row | Agrees (both read the frozen booking column). |
| Grand total / balance due (non-ledger) | `charges.grandTotal` minus completed `payments` sum (CheckoutInvoiceModal.tsx:126-134, 205-213) | `PaymentWorkflowSummaryRow.billable_total() - total_paid` (models/payment.rs:285-289), enforced in `record_payment` | **Can disagree** because `charges.grandTotal` includes a live-recomputed tourism tax while the backend guard uses the frozen column (F04). |
| "Fully paid, may checkout" gate (`requiresFullPaymentBeforeCheckout`) | `CheckoutInvoiceModal.tsx:210-213`, uses `charges.grandTotal` (room+tourism tax+extra bed) | Server-side checkout guard `ensure_checkout_balance_resolved` (lifecycle.rs:739-770, invoked from `update_booking_handler` at line 1501) compares **only** `bookings.total_amount` vs `total_paid` — it does **not** add `tourism_tax_amount`/`extra_bed_charge` | **Yes, materially** — see F02: the FE is stricter than the DB. A client that skips the FE gate (direct API call, a different UI, a future regression) can transition a booking to `checked_out` while tourism tax / extra-bed charges are still unpaid. |
| Guest-facing invoice total (`InvoiceModal.tsx`) | Backend `get_invoice_preview`/`create_generated_invoice` (repositories/payment.rs:888-985): `subtotal = room_type.base_price × nights`; `service_charge = subtotal × room_type.service_charge_percentage / 100`; `tax_amount` hardcoded `Decimal::ZERO`; deposit = `room_type.keycard_deposit_amount` | Same booking's *real* charge is `bookings.total_amount` (which may reflect `daily_rates`/rate overrides) `+ tourism_tax_amount + extra_bed_charge` | **Yes, materially** — see F01. This is a wholly separate computation from `chargesCalculation.ts`, uses the room **type's** current base price (not the booking's actual price), and always omits tourism tax / extra bed. |

Float/rounding: `chargesCalculation.ts` and the JSX both route every computation through
`hotel-web-fe/src/utils/money.ts` (`divideMoney`/`multiplyMoney`/`sumMoney`/`subtractMoney`,
integer-minor-unit rounding) — correct pattern, and it's unit-tested exhaustively in
`chargesCalculation.test.ts` (12 cases incl. rounding-leak checks). The one exception is
`handleSaveDailyRates` (F09), which bypasses these helpers with plain JS `+`/`/`.

---

## 3. Guest vs admin payment path comparison

| | Guest (`GuestPaymentPanel.tsx`) | Admin (`CheckoutInvoiceModal.tsx` → `InvoicesService.recordPayment`) |
|---|---|---|
| Endpoint (bank transfer) | `POST guest-portal/me/payments/bank-transfer` or `guest-portal/booking/:token/payments/bank-transfer` → `services::payments::create_bank_transfer_claim` (services/payments.rs:733) | `POST payments/record-payment` → `services::payments::record_payment` (services/payments.rs:187) |
| Endpoint (online/card) | PayPal only: `.../payments/paypal/create-order` + `.../paypal/capture` → `create_paypal_order`/`capture_paypal_payment` (services/payments.rs:805, 882) | No PayPal path; admin methods come from `hotelSettings.payment_methods` (CheckoutInvoiceModal.tsx:1519-1524) — cash/card/bank transfer/DuitNow etc., recorded as already-completed. |
| Amount | **Guest never sends an amount.** `GuestPaymentPanel`'s own doc comment (lines 14-16) states this; the backend always charges `booking.total_amount` (`create_bank_transfer_claim`/`create_paypal_order`, PendingPaymentValues `amount: booking.total_amount`). Server-authoritative. | Admin **types a free-form amount** (`paymentAmount` state), bounded client-side by `isGreaterMoney(paymentAmount, balanceDue)` (line 1564) and server-side by `record_payment`'s `amount > balance_due + tolerance` check (services/payments.rs:233) using `billable_total()`. |
| Can guest submit an amount admin UI would reject? | No — guest can't submit an amount at all (booking total only), so there's no guest-side overpayment vector. | N/A |
| Can admin submit something the guest path would never produce? | Yes by design: **editing** an existing payment (`handleUpdatePayment`) has no upper-bound check at all (F03) — an admin (or a compromised admin session) can set a payment's amount to anything positive with zero relation to the balance. The guest path has no equivalent "edit my payment" capability, so this asymmetry is admin-only exposure. | |
| Methods allowed | `bank_transfer`, `paypal` only (gated by `config.paypal_enabled`) | Whatever `hotelSettings.payment_methods` lists (cash, card, bank transfer, DuitNow, etc., free text from settings) |
| Validation depth | Backend fully owns amount + booking-state validation (`ensure_booking_awaiting_payment`, `ensure_no_active_booking_payment`) | Backend validates amount only on **create** (`record_payment`), not on **update** (F03) |

---

## 4. PayPal end-to-end map

1. **FE — create order**: `GuestPaymentPanel.createOrder` (GuestPaymentPanel.tsx:140-158)
   calls `GuestPortalDashboardService.createPaypalOrder` / `GuestPortalService.createPaypalOrder`
   → `POST guest-portal/me/payments/paypal/create-order` (guestPortalDashboard.service.ts:141-150)
   or `POST guest-portal/booking/:token/payments/paypal/create-order`
   (api/guestPortal.service.ts:57-59).
2. **BE — create order**: `services::payments::create_paypal_order` (services/payments.rs:805-873):
   guards `ensure_booking_awaiting_payment` + `ensure_no_active_booking_payment`, inserts a
   `pending` payment row, calls `paypal_client::create_order`, stores the PayPal order id.
   On PayPal API failure, `release_failed_paypal_payment` (line 1016) moves the local row to a
   terminal state so the guest isn't blocked from retrying — good.
3. **FE — approve**: PayPal's own SDK button fires `onApprove` (GuestPaymentPanel.tsx:160-189)
   once the guest approves the order **on PayPal's side**; this is where our actual capture is
   triggered — the money is not yet captured before this call.
4. **FE → BE — capture**: `onApprove` calls `capturePaypalOrder` →
   `POST guest-portal/me/payments/paypal/capture` (guestPortalDashboard.service.ts:153-165) or the
   token variant (guestPortal.service.ts:63-72) → `services::payments::capture_paypal_payment`
   (services/payments.rs:882-1010).
5. **BE — capture handling**: verifies the payment belongs to the booking, is idempotent on
   retry (returns the same success if `status=='completed'`, line ~964), validates PayPal's
   echoed `custom_id` matches `"{booking_id}:{payment_id}"`, and — importantly — validates the
   *captured amount* against the stored payment row's amount (`verify_captured_against_stored`).
   On mismatch it does **not** mark the payment failed (to avoid inviting a second charge); it
   logs a `paypal_capture_conflict` audit event and returns `ApiError::Conflict` with an explicit
   "please do not pay again" message (lines ~955-975).
6. **FE on capture failure**: `onApprove`'s catch sets `paypalError` via a generic
   `errorMessage(error, 'Unable to confirm your PayPal payment.')` (line 183) — the ky client's
   `beforeError` hook (`api/client.ts:227-249`) does rewrite `error.message` to the backend's
   explicit message when present, so the "flagged for hotel staff, do not pay again" text likely
   does surface, both inline and via the global notification toast. **Not independently verified
   live in this session** (no dev server run) — flagged as unverified rather than assumed.
7. **Staff-side conflict visibility**: already implemented — `usePaypalConflictEvents`
   (`usePaymentApprovalsQueries.ts:77-103`) polls the audit log for
   `paypal_webhook_conflict`/`paypal_capture_conflict` and `PaymentApprovalsPage.tsx:205-236`
   renders a banner of the last 30 days' conflicts, gated on `payments:read` + `audit:read`. This
   already covers the intent of the open tracker item "Expose PayPal conflict banner to payment
   approvers" — worth re-checking whether that tracker item is stale.

### Capture-succeeds-but-callback-fails: the two real gaps found

- **F05/F06 (accountability, high)**: if the *client's* network drops between step 3 (PayPal-side
  approval) and step 4 (our capture call) — i.e. before our backend ever calls PayPal's capture
  API — **no money has moved yet**, but the local `pending` payment row persists and
  `ensure_no_active_booking_payment` (services/payments.rs:724-729) then blocks the guest from
  starting a fresh attempt with a generic `Conflict` error. `GuestPaymentPanel` has no
  "resume/retry this pending payment" affordance (its `pendingPaypalPaymentId` is in-memory
  React state, lost on reload) — the guest is stuck.
- **F05 (accountability, high)**: on the staff side, that same stuck-`pending` PayPal row is
  indistinguishable in `PaymentApprovalsPage.tsx`'s table from a legitimate bank-transfer claim
  except for the `payment_method` text column — the "Approve" button (rendered unconditionally,
  PaymentApprovalsPage.tsx:305-320) is not gated by method, and `approve_payment`
  (services/payments.rs:1409-1425) performs no PayPal-side re-verification before completing the
  payment and confirming the booking. A staff member who clicks Approve on a paypal-method row
  (whether genuinely still-processing or a permanently-orphaned no-capture row) confirms the
  booking with **zero money actually collected**, with nothing in the UI or the approval
  endpoint distinguishing that case from a real bank-transfer proof-of-payment review.

---

## 5. Data flow / invalidation

- `CheckoutInvoiceModal.invalidateInvoiceState` (lines 119-125) invalidates
  `invoices.preview`, `invoices.payments`, `bookings.detail`, `bookings.paymentWorkflow`,
  `bookings.all` for the specific booking after every non-ledger payment mutation — correct for
  the booking-scoped views. It does **not** invalidate `dashboard.all`/`analytics.all` (contrast
  with `invalidatePaymentApprovalDependencies`, `api/queryInvalidation.ts:54-62`, which does), so
  a payment recorded via the checkout modal can leave the admin dashboard/revenue widgets showing
  a stale total until their own `staleTime` lapses. Lower severity than a stale *balance-due*
  (which IS invalidated correctly) but worth folding into the same helper for consistency.
- Ledger-view payments (`isLedgerView && ledger`) call `reloadPayments()` +
  `onLedgerPaymentsChanged?.()` instead of query invalidation — a parent-callback pattern, not a
  cache bug, but it means the ledger and non-ledger paths use two different mechanisms to achieve
  the same "refresh after payment" goal (duplication of *approach*, not of logic).
- No optimistic updates of money were found in this dimension — `setPayments(prev => [...prev,
  newPayment])` etc. all happen *after* the awaited mutation resolves (e.g.
  CheckoutInvoiceModal.tsx:236-241), which is the correct (pessimistic) pattern for money.
- `PaymentApprovalsService.approve`/`.reject` are wrapped in `withRetry({maxAttempts:2})`
  (api/paymentApprovals.service.ts:28-33, 52-60). Verified this is safe against double-approval:
  `utils/retry.ts`'s `shouldRetry` does not retry on 4xx (except 429), and a second `approve` call
  on an already-completed payment returns 400 ("Only pending payments can be approved") which is
  correctly not retried. The remaining edge case (network drop *after* the first attempt's commit
  but before the response arrives) surfaces that same 400 as the **final, user-visible error**
  even though the approval actually succeeded — a misleading failure message, not a double-money
  bug. Noted as low-severity UX/accountability gap, not filed as a top finding.

---

## 6. What the tests pin

- `chargesCalculation.test.ts` (258 lines, 12 cases): exhaustively pins the room/tax split,
  hourly-stay handling, the price fallback chain (price_per_night → roomPrice → total/nights),
  `editableDailyRates` precedence, deposit-only-when-collected, tourism tax only for foreign
  guests, extra-bed tax-exclusive split, and a full reconciliation to `grandTotal`. It does **not**
  pin agreement with the backend's `billable_total()`/tourism-tax-column semantics (F04) — that
  gap is invisible to this test file by construction, since it only tests the pure function
  against hand-built `booking` fixtures.
- `useCheckoutFlow.test.tsx` (228 lines, 13 cases): pins open/close state, the default vs
  injected `updateBooking` call, room-dirty payload shape (incl. late-checkout note text),
  `setRoomDirty`/`applyLateCheckout` flags, custom `successMessage`, and error re-throw/fallback
  behavior on `updateBooking` failure. It does **not** cover `RoomsService.updateRoomStatus`
  failing after `updateBooking` succeeds (F10/test-gap).
- `usePaymentApprovalsQueries.test.tsx` (261 lines): pins `usePendingPayments` pagination,
  `useApprovePayment`/`useRejectPayment` invalidation (incl. "no invalidation on failure"),
  `usePaymentApprovalHistory`, `useRequestPaymentReceipt`, and — thoroughly — the 30-day dual-
  action `usePaypalConflictEvents` merge/sort behavior. No test distinguishes approving a
  `bank_transfer` vs a `paypal` pending entry (matches F05: the code itself makes no distinction).
- `invoices.service.test.ts`: only covers `revertDepositRefund`'s success/error/APIError paths;
  `recordPayment`/`updatePayment`/`deletePayment`/`refundDeposit`/`getInvoicePreview` have no
  service-level tests in this file.
- `GuestPaymentPanel.tsx` has **no test file at all** (F11) — verified via `find
  hotel-web-fe/src -iname "*GuestPaymentPanel*"` returning only the component itself.

---

## Findings summary (see structured output for the canonical list)

F01 correctness — guest invoice (InvoiceModal.tsx) computes totals via a wholly different,
simpler backend formula (room_type.base_price × nights, no tourism tax/extra bed) than the
admin checkout invoice.

F02 correctness — server checkout guard omits tourism_tax_amount/extra_bed_charge from the
balance-due check it enforces; FE is the only place enforcing the fuller amount.

F03 accountability — editing an existing payment has no amount/balance validation on FE or BE.

F04 correctness — client recomputes tourism tax from the *current* hotel setting instead of the
booking's frozen `tourism_tax_amount`, causing potential disagreement with backend validation.

F05 accountability — Payment Approvals "Approve" is not gated by payment_method; approving a
PayPal claim performs no gateway re-verification.

F06 accountability/test-gap — no guest-side recovery path for a PayPal order approved-but-never-
captured due to a dropped network call.

F07 maintainability — CheckoutInvoiceModal.tsx god-file decomposition (see section 1).

F08 duplication — charges-breakdown rendering (incl. per-night tax loops) duplicated 3x across
CheckoutInvoiceModal (preview + confirm steps) and CheckoutInvoicePrintView.

F09 correctness — handleSaveDailyRates uses raw float math instead of the file's own money
helpers.

F10 test-gap — no test for updateBooking-succeeds/updateRoomStatus-fails partial checkout
failure.

F11 test-gap — GuestPaymentPanel has zero test coverage.

F12 duplication/low — InvoiceModal.tsx hardcodes "$" instead of using useCurrency().

F13 accountability — reloadPayments swallows fetch errors silently, risking a false "no
payments" / full-balance-due display.
