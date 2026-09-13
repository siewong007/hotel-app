# Legacy Flag-Only Deposit Refund — Implementation Plan (revised)

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Refund Deposit work on pre-integrity-rework bookings whose deposit exists only as `bookings.deposit_paid`/`deposit_amount` flags (no `payments` row), and make the checkout modal's Waive persist to the backend.

**Revision note (post-spec):** the original Option-A design (conversion inside `refund_deposit`) was dropped after discovering `refund_deposit_ignores_booking_columns_without_a_payment_row` (`payment_characterization.rs:3211`), a security characterization test enshrining "forged booking columns mint no refundable money". The revised design keeps `refund_deposit`'s ledger-only ceiling untouched and routes the attestation through the already-supported `updateBooking` → `reconcile_booking_deposit_tx` Collect path from the modal. **Zero backend changes.**

**Architecture:** In `CheckoutInvoiceModal.handleRefundDeposit`, compute the refundable amount from the payments list (`Σ deposit/completed − Σ refund/refunded`); when it is short of `charges.depositRefund`, first call `BookingsService.updateBooking({deposit_paid:true, deposit_amount:<flag amount>})` — `reconcile_booking_deposit_tx` Collect mints the missing delta as a real `deposit`/`completed` row under the booking lock — then refund normally. Waive persists via `updateBooking({deposit_paid:false, deposit_amount:0, payment_note:'Deposit waived: <reason>'})` (check-in convention; Waive intent clears flag-only deposits and rejects when a real deposit exists).

**Tech Stack:** React/TS (MUI, Vitest + Testing Library).

## Global Constraints

- Payment behavior change — targeted tests required (AGENTS.md). TDD: failing test first.
- Do not touch the other session's dirty files (help-centre feature); only stage files listed per task.
- No schema change, no backend change → no patch-catalog entry, no backend test changes.

---

### Task 1: Refund + Waive in `CheckoutInvoiceModal`

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`
- Test: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx`

**Interfaces:**
- Consumes: `BookingsService.updateBooking(bookingId: string, updateData: BookingUpdateRequest)` — already imported in the modal (`import { BookingsService } from '../../../api'`) and mocked in the test file.
- `BookingUpdateRequest` fields verified: `deposit_paid?: boolean`, `deposit_amount?: number`, `payment_note?: string` (`src/types/booking.types.ts:180-185`).
- Payments list shape: `CheckoutPaymentRecord{ payment_type?, payment_status, total_amount? }` (`features/invoices/types.ts`); void rows already filtered out by `useCheckoutInvoiceData`.
- Money helpers already imported in modal: `sumMoney`, `subtractMoney`, `isLessMoney`, `toMoneyNumber`.
- Backend contract: Collect mints `requested − recorded` delta as `deposit`/`completed` (notes default `'Keycard deposit'`); Waive clears `deposit_paid/deposit_amount` when no completed deposit row exists, else 400 "A deposit payment of X is recorded…" (`reconcile_booking_deposit_tx`, `lifecycle.rs:2656-2752`).

- [ ] **Step 1: Extend test mocks and write the failing tests**

In `CheckoutInvoiceModal.test.tsx`:

- Hoist `payments` (mutable `CheckoutPaymentRecord[]`), `setDepositRefunded`, `updateBooking`, `refundDeposit` into the `mocks` object; wire the `useCheckoutInvoiceData`/`BookingsService`/`InvoicesService` mock factories to them.
- Parameterize `renderModal` with `overrides: Partial<BookingWithDetails>` merged into the booking fixture.
- New describe `legacy deposit handling` with tests:
  1. **flag-only refund**: `deposit_paid:true, deposit_amount:50`, `payments=[]` → click `Refund RM50.00` → `updateBooking('42',{deposit_paid:true, deposit_amount:50})` called BEFORE `refundDeposit('42','cash',50)` (`invocationCallOrder`), `setDepositRefunded(true)`.
  2. **ledger-backed refund**: `payments=[{payment_type:'deposit', payment_status:'completed', total_amount:50}]` → click Refund → `updateBooking` NOT called; `refundDeposit` called.
  3. **waive persists**: `payments=[booking payment 100 completed]` (balance 0) → fill reason "Lost keycard" → `Waive Deposit` → `updateBooking('42',{deposit_paid:false, deposit_amount:0, payment_note:'Deposit waived: Lost keycard'})` → `Proceed to Checkout` enabled.
  4. **waive rejected**: `updateBooking` rejects → error text shown; `Proceed to Checkout` stays disabled.

- [ ] **Step 2: Run tests to verify they fail**

`cd hotel-web-fe && bun run test -- CheckoutInvoiceModal`
Expected: FAIL — `updateBooking` never called (waive is local-only; refund goes straight to `refundDeposit`).

- [ ] **Step 3: Implement**

In `CheckoutInvoiceModal.tsx`:

1. `handleRefundDeposit` (~line 380): before calling `refundDeposit`, compute
   ```ts
   const recordedDeposit = sumMoney(payments
     .filter((p) => (p.payment_type || '').toLowerCase() === 'deposit' && p.payment_status === 'completed')
     .map((p) => toMoneyNumber(p.total_amount)));
   const refundedDeposit = sumMoney(payments
     .filter((p) => (p.payment_type || '').toLowerCase() === 'refund' && p.payment_status === 'refunded')
     .map((p) => toMoneyNumber(p.total_amount)));
   if (isLessMoney(subtractMoney(recordedDeposit, refundedDeposit), charges.depositRefund)) {
     await BookingsService.updateBooking(booking.id, {
       deposit_paid: true,
       deposit_amount: charges.depositRefund,
     });
   }
   ```
   (No `payment_note` — keeps the booking's existing note; the minted row gets the default 'Keycard deposit' note plus `created_by`.)

2. Add `const [waivingDeposit, setWaivingDeposit] = useState(false);` near the deposit state (~line 163) and `handleWaiveDeposit`:
   ```ts
   const handleWaiveDeposit = async () => {
     if (!booking || !depositWaiveReason.trim()) return;
     try {
       setWaivingDeposit(true);
       const reason = depositWaiveReason.trim();
       await BookingsService.updateBooking(booking.id, {
         deposit_paid: false,
         deposit_amount: 0,
         payment_note: booking.payment_note
           ? `${booking.payment_note} | Deposit waived: ${reason}`
           : `Deposit waived: ${reason}`,
       });
       setDepositWaived(true);
       invalidateInvoiceState();
     } catch (err) {
       setError(err instanceof Error && err.message ? err.message : 'Failed to waive deposit');
     } finally {
       setWaivingDeposit(false);
     }
   };
   ```

3. Waive button (~line 1212): `onClick={handleWaiveDeposit}`, `disabled={!depositWaiveReason.trim() || waivingDeposit}`, `startIcon={waivingDeposit ? <CircularProgress size={14} /> : undefined}`.

4. Remove the Undo button in the persisted-waived block (~lines 1245-1256): a persisted waive cannot be undone client-side — restoring the deposit would mint a collection row for money nobody attested; staff re-collect explicitly via booking edit instead.

- [ ] **Step 4: Run tests to verify they pass**

`cd hotel-web-fe && bun run test -- CheckoutInvoiceModal` → PASS (all four + existing idempotency suites).

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx \
        hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx
git commit -m "fix(invoices): unblock legacy flag-only deposits at checkout refund"
```

---

### Task 2: Verification gates

- [ ] **Step 1: Frontend gates**

```bash
cd hotel-web-fe
bun run typecheck && bun run lint && bun run test
```

- [ ] **Step 2: Backend sanity (untouched)**

`cargo check --all-features` — confirm the backend still compiles (no changes made, cheap confirmation). Skip full backend test suite — `payment.rs` is untouched and its characterization tests are unchanged.

- [ ] **Step 3: Manual smoke (optional, dev DB)**

On a `checked_in` flag-only booking: open checkout modal → Refund Deposit → one click → deposit row minted + refund row written → proceed enabled. Waive path: reason → Waive → flag cleared server-side → proceed enabled.
