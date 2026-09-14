# Deposit Payment Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the tender actually collected for a deposit (not the booking's
payment method), and let staff correct `payment_method` on posted deposit rows.

**Architecture:** New optional `deposit_payment_method` request field flows into
the two places that mint deposit rows (`create_booking`'s `amount_paid` path and
`reconcile_booking_deposit_tx`). `update_payment_tx` relaxes its completed-row
immutability so `payment_method` — and only that field — can change on
`deposit`/`deposit_forfeited` rows. The checkout modal's deposit section gets a
method-only edit form; the check-in dialogs send their existing dropdown value
in the new field. No schema change.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL backend; React/TypeScript/MUI
frontend; Vitest; payment method is free-form `varchar(50)`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-14-deposit-payment-method-design.md`.
- Backend tests need `DATABASE_URL`; verify by actual run count, not exit code.
- Tender method only — NEVER allow `payment_type` recategorization.
- Amount and `payment_date` stay immutable on ALL completed rows. Method stays
  immutable on `booking`/`service`/`damage`/`refund` rows.
- `deposit_payment_method` semantics: present + non-blank (after trim) wins;
  absent/blank falls back to `payment_method`, then `"Cash"`.
- `bookings.deposit_paid`/`deposit_amount` mirror semantics unchanged.
- The shared worktree may carry other sessions' uncommitted work — stage only
  this plan's files.

---

### Task 1: `deposit_payment_method` field + record-path binding

**Files:**
- Modify: `hotel-app-be/src/models/booking.rs` (`BookingInput` ~line 154, `BookingUpdateInput` ~line 211)
- Modify: `hotel-app-be/src/repositories/bookings/lifecycle.rs` (~line 1253 create path, ~line 2772 reconcile bind)
- Test: `hotel-app-be/tests/deposit_checkout_guard.rs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `BookingUpdateInput.deposit_payment_method: Option<String>`,
  `BookingInput.deposit_payment_method: Option<String>` — Tasks 3–4 rely on
  these serde field names; FE sends `deposit_payment_method` in
  `booking_update` payloads.

- [ ] **Step 1: Add the field to both input structs**

In `models/booking.rs`, `BookingInput` (after `pub deposit_amount: Option<f64>,`):

```rust
    /// Tender actually collected for the deposit (cash, card…). When set it —
    /// not `payment_method` (the bill's tender) — lands on the deposit row.
    pub deposit_payment_method: Option<String>,
```

Same line, minus the doc comment difference, on `BookingUpdateInput` after its
`pub deposit_amount: Option<f64>,` (~line 211). Use the same doc comment.

- [ ] **Step 2: Write the failing tests**

In `tests/deposit_checkout_guard.rs` — reuse the file's `update_booking`
helper (`bookings::update_booking_handler` wrapper) and the 986_xxx fixture
block. Add to the file's doc header one line noting it also covers deposit
record-path method binding.

```rust
/// A deposit asserted via `update_booking` records the caller-supplied
/// `deposit_payment_method` — the tender the desk actually collected — not
/// the booking-level `payment_method` (the room bill's tender).
#[tokio::test]
async fn deposit_assertion_records_deposit_payment_method() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    // Reuse the file's existing seed/fixture helpers for a fresh booking in
    // `confirmed` state (e.g. the 986_1xx booking block); pick unused IDs.
    let booking_id = /* fresh booking id per file convention */ 986_999;

    update_booking(
        &pool,
        actor_id,          // per file convention
        booking_id,
        BookingUpdateInput {
            deposit_paid: Some(true),
            deposit_amount: Some(50.0),
            deposit_payment_method: Some("E-Wallet".to_string()),
            payment_method: Some("Debit Card".to_string()), // bill tender — must NOT leak
            ..Default::default()
        },
    )
    .await
    .expect("deposit assertion should succeed");

    let recorded: String = sqlx::query_scalar(
        "SELECT payment_method FROM payments \
         WHERE booking_id = $1 AND payment_type = 'deposit' AND status = 'completed'",
    )
    .bind(booking_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(recorded, "E-Wallet");
}

/// Fallback chain: absent `deposit_payment_method` still records the
/// booking-level `payment_method` (today's behavior), and a blank value is
/// treated as absent.
#[tokio::test]
async fn deposit_assertion_falls_back_when_method_absent_or_blank() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    // Two fresh bookings: one sends no deposit_payment_method, one sends "  ".
    // Assert both rows record the booking-level payment_method.
}
```

(The file's convention is `BookingUpdateInput { …, ..Default::default() }`
plus `seed_*` fixtures in the 986_xxx ID block — read the existing tests first
and follow their fixture/seeding pattern.)

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd hotel-app-be && cargo test --all-features --test deposit_checkout_guard deposit_assertion
```
Expected: compile error — `no field deposit_payment_method` (field added in
step 1, so instead: remove-field check — run with the field present but the
binding NOT yet changed: test fails asserting `"E-Wallet"` vs `"Debit Card"`).

- [ ] **Step 4: Bind the field in `reconcile_booking_deposit_tx`**

In `lifecycle.rs` (~2772), replace the insert's method bind:

```rust
// Was:
//   .bind(booking_update.payment_method.as_deref().unwrap_or("Cash"))
// Now resolve the deposit tender first:
let deposit_method = booking_update
    .deposit_payment_method
    .as_deref()
    .map(str::trim)
    .filter(|m| !m.is_empty())
    .or(booking_update.payment_method.as_deref())
    .unwrap_or("Cash");
```

then `.bind(deposit_method)` in place of the old expression.

- [ ] **Step 5: Same for `create_booking`**

In `lifecycle.rs` (~1249) where `CheckInPaymentRecord` is built for
`amount_paid`, replace `input.payment_method.clone().unwrap_or_else(|| "Cash".to_string())` with:

```rust
input
    .deposit_payment_method
    .as_deref()
    .map(str::trim)
    .filter(|m| !m.is_empty())
    .map(str::to_string)
    .or_else(|| input.payment_method.clone())
    .unwrap_or_else(|| "Cash".to_string()),
```

- [ ] **Step 6: Run tests + check**

```bash
cd hotel-app-be && cargo test --all-features --test deposit_checkout_guard
cargo check --all-features
```
Expected: all pass (verify run count), check clean.

- [ ] **Step 7: Commit**

```bash
git add hotel-app-be/src/models/booking.rs hotel-app-be/src/repositories/bookings/lifecycle.rs hotel-app-be/tests/deposit_checkout_guard.rs
git commit -m "payments: record deposit tender via deposit_payment_method"
```

---

### Task 2: method-only edit on completed deposit rows

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs` (~line 1906, the `existing_status == "completed"` immutability block; also its doc comment ~1806)
- Test: `hotel-app-be/tests/payment_characterization.rs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PATCH /payments/{id}` accepts `payment_method` changes on
  completed `deposit`/`deposit_forfeited` rows — Task 4's FE edit depends on
  this behavior.

- [ ] **Step 1: Write the failing test**

In `tests/payment_characterization.rs`, after
`completed_payment_amount_method_and_date_are_immutable` (reuse
`seed_idempotency_booking`, `insert_completed_payment`, `payments::update_payment`):

```rust
/// A posted deposit's method is a descriptive attribute (which till the cash
/// went into), not money movement — and with in-house deposit voids guarded
/// it is the only honest correction path. Method edits stay allowed on
/// completed `deposit`/`deposit_forfeited` rows; amount and date remain
/// immutable on every posted type, and bill-settling rows keep full
/// immutability (covered by the test above).
#[tokio::test]
async fn completed_deposit_method_is_correctable_amount_is_not() {
    let Some((pool, _serial_guard)) = setup_pg_pool().await else {
        return;
    };
    let (actor_id, room_type_id, room_id, guest_id, booking_id) =
        (940_710, 940_711, 940_712, 940_713, 940_714);
    seed_idempotency_booking(&pool, actor_id, room_type_id, room_id, guest_id, booking_id).await;
    let payment_id = insert_completed_payment(
        &pool, booking_id, "deposit", d("50.00"), actor_id,
    )
    .await;

    // Method correctable
    payments::update_payment(
        &pool,
        actor_id,
        payment_id,
        UpdatePaymentRequest {
            amount: None,
            payment_method: Some("Cash".to_string()),
            transaction_reference: None,
            notes: None,
            payment_date: None,
        },
    )
    .await
    .expect("method edit on a completed deposit should succeed");
    let stored: String = sqlx::query_scalar(
        "SELECT payment_method FROM payments WHERE id = $1",
    )
    .bind(payment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, "Cash");

    // Amount + date still immutable
    let update_amount = payments::update_payment(
        &pool, actor_id, payment_id,
        UpdatePaymentRequest {
            amount: Some(75.0), payment_method: None,
            transaction_reference: None, notes: None, payment_date: None,
        },
    )
    .await;
    let update_date = payments::update_payment(
        &pool, actor_id, payment_id,
        UpdatePaymentRequest {
            amount: None, payment_method: None, transaction_reference: None,
            notes: None, payment_date: Some("2030-01-01".to_string()),
        },
    )
    .await;
    assert!(matches!(update_amount, Err(ApiError::BadRequest(_))));
    assert!(matches!(update_date, Err(ApiError::BadRequest(_))));

    // deposit_forfeited rows get the same method hatch
    let forfeit_id = insert_completed_payment(
        &pool, booking_id, "deposit_forfeited", d("10.00"), actor_id,
    )
    .await;
    payments::update_payment(
        &pool, actor_id, forfeit_id,
        UpdatePaymentRequest {
            amount: None, payment_method: Some("Visa Card".to_string()),
            transaction_reference: None, notes: None, payment_date: None,
        },
    )
    .await
    .expect("method edit on a completed forfeiture should succeed");
}
```

(`d()` exists in `deposit_checkout_guard.rs` — in this file use whatever
Decimal construction the neighbors use, e.g. `Decimal::from_str("50.00").unwrap()`
or `Decimal::new(5000, 2)`; `UpdatePaymentRequest`, `ApiError`,
`payments::update_payment`, `insert_completed_payment` are already imported
in this file — verify.)

- [ ] **Step 2: Run to verify it fails**

```bash
cd hotel-app-be && cargo test --all-features --test payment_characterization completed_deposit_method
```
Expected: FAIL — "Amount, method and payment date are immutable…".

- [ ] **Step 3: Relax the immutability block**

In `repositories/payment.rs` (~1906), inside `if existing_status == "completed"`,
change the rejection condition:

```rust
        if existing_status == "completed" {
            let amount_changed = request.amount.is_some() && final_amount != existing_amount;
            let method_changed =
                request.payment_method.is_some() && final_payment_method != existing.payment_method;
            let date_changed = request.payment_date.is_some()
                && final_payment_date != existing.payment_date.as_deref();
            // Deposit rows are collateral, not bill settlement — and with
            // in-house deposit voids guarded, a method edit is the only
            // honest correction path. Amount/date stay immutable on every
            // posted type; method stays immutable on bill-settling types.
            let deposit_like = matches!(existing_type, "deposit" | "deposit_forfeited");
            if amount_changed || date_changed || (method_changed && !deposit_like) {
                return Err(ApiError::BadRequest(
                    "Amount, method and payment date are immutable once a payment is posted — \
                     void the payment and record a new one instead"
                        .to_string(),
                ));
            }
        }
```

Also update the block's doc comment (~1806, "A completed payment's
amount/method/date can never be rewritten — corrections go through a
void + re-record…") to note the deposit-method exception.

- [ ] **Step 4: Run tests**

```bash
cd hotel-app-be && cargo test --all-features --test payment_characterization
```
Expected: all pass including the unchanged
`completed_payment_amount_method_and_date_are_immutable` (booking-type rows
keep full immutability). Verify run count.

- [ ] **Step 5: Commit**

```bash
git add hotel-app-be/src/repositories/payment.rs hotel-app-be/tests/payment_characterization.rs
git commit -m "payments: allow method-only edit on posted deposit rows"
```

---

### Task 3: FE types + check-in dialogs send `deposit_payment_method`

**Files:**
- Modify: `hotel-web-fe/src/types/booking.types.ts` (`BookingUpdateRequest` ~line 180, and the create-booking request interface beside `amount_paid`)
- Modify: `hotel-web-fe/src/features/bookings/components/Bookings/dialogs/CheckInDialog.tsx` (~line 122)
- Modify: `hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.tsx` (~line 611)

**Interfaces:**
- Consumes: Task 1's `deposit_payment_method` serde field.
- Produces: nothing downstream.

- [ ] **Step 1: Type the field**

In `booking.types.ts`, `BookingUpdateRequest` after `deposit_amount?: number;`:

```ts
  /** Tender actually collected for the deposit (not the bill's method). */
  deposit_payment_method?: string;
```

Find the create-booking request interface in the same file (the one carrying
`amount_paid`) and add the same field + comment after its `deposit_amount`.

- [ ] **Step 2: Send it from `CheckInDialog`**

In `CheckInDialog.tsx` inside `if (depositChoice === 'receive')` (~line 119),
after the `payment_note` line:

```ts
        bookingUpdate.deposit_payment_method = depositMethod;
```

- [ ] **Step 3: Send it from `EnhancedCheckInModal`**

In `EnhancedCheckInModal.tsx` inside `if (depositChoice === 'receive')`
(~line 608), after the `payment_note` line:

```ts
        paymentFields.deposit_payment_method = depositMethod;
```

- [ ] **Step 4: Verify**

```bash
cd hotel-web-fe && bun run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/types/booking.types.ts hotel-web-fe/src/features/bookings/components/Bookings/dialogs/CheckInDialog.tsx hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.tsx
git commit -m "fe: send deposit tender as deposit_payment_method at check-in"
```

---

### Task 4: checkout modal — method-only edit on deposit rows

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx` (deposit section ~line 1657; `handleUpdatePayment` ~line 364; edit-form blocks ~1511/1714)
- Test: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx`

**Interfaces:**
- Consumes: `isDepositLikePayment` from `../utils/payments` (already imported
  at line 45); `InvoicesService.updatePayment(paymentId, { payment_method })`;
  `editingPayment`/`editMethod`/`setEditMethod`/`handleStartEdit`/
  `handleCancelEdit`/`handleUpdatePayment` state;
  `hotelSettings.payment_methods` dropdown options (existing edit form).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

In `CheckoutInvoiceModal.test.tsx`, in the `deposit display + forfeit`
describe block — follow the existing test patterns (they render the modal
with a booking + payments fixture; find how a deposit payment row fixture is
built there):

```ts
it('lets staff correct a deposit row method — method-only form', async () => {
  // Render with a completed `deposit` payment row, click its Edit button,
  // assert: Method dropdown visible; amount/date/reference inputs absent;
  // no Delete affordance on the row.
  // Save → InvoicesService.updatePayment called with { payment_method: 'Cash' }
  // and NO amount/payment_date/transaction_reference keys.
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd hotel-web-fe && bun run test -- CheckoutInvoiceModal
```
Expected: FAIL — no edit affordance on deposit rows.

- [ ] **Step 3: Implement**

In the deposit row map (~line 1664), inside the right-most `Grid`:

1. When `editingPayment?.id === p.id`, replace the row content with a
   constrained inline form — reuse the existing edit-form markup but render
   **only** the Method `Select` plus Save/Cancel buttons (no amount, date,
   reference, or notes fields). Extract the existing form's Method-select JSX
   verbatim so option rendering stays identical.
2. When not editing, render an Edit `IconButton` (same icon/size as the bill
   rows' edit button at ~1626) that calls the existing `handleStartEdit(p)` —
   but **no** Delete button.
3. In `handleUpdatePayment` (~line 364): the early return is
   `if (!editingPayment || !isPositiveMoney(editAmount)) return;` — change to
   also admit deposit rows, then branch:

```ts
    if (!editingPayment) return;
    const depositLike = isDepositLikePayment(editingPayment);
    if (!depositLike && !isPositiveMoney(editAmount)) return;
    // …
    if (!isLedgerView && depositLike) {
      // Method-only correction: amount/date stay immutable on posted rows.
      const updatedPayment = await InvoicesService.updatePayment(editingPayment.id, {
        payment_method: editMethod,
      });
      setPayments(prev => prev.map(p => p.id === editingPayment.id ? updatedPayment : p));
      invalidateInvoiceState();
      handleCancelEdit();
      return;
    }
```

(In ledger view the deposit section may not render or ledger payments are a
different table — check `isLedgerView` handling; if deposits never appear in
ledger view, keep the `!isLedgerView` condition and assert that in review.)

- [ ] **Step 4: Run modal tests**

```bash
cd hotel-web-fe && bun run test -- CheckoutInvoiceModal
```
Expected: all pass, including the new test.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx
git commit -m "fe: method-only edit affordance on deposit rows"
```

---

### Task 5: full gates

**Files:** none — verification only.

- [ ] **Step 1: Backend**

```bash
cd hotel-app-be
cargo clippy --all-features -- -D warnings
cargo test --all-features
```
Expected: clippy clean; suite green — verify the run count shows a real full
run (hundreds of tests across all binaries incl. `payment_characterization`
and `deposit_checkout_guard`), not lib-only.

- [ ] **Step 2: Frontend**

```bash
cd hotel-web-fe
bun run typecheck && bun run lint && bun run test && bun run build
```
Expected: all clean. Known-flaky: `PortalBookingPage*` tests sit near the 5s
timeout boundary and can flake under CPU contention — re-run failed files in
isolation before treating a timeout as a regression.

- [ ] **Step 3: Final review**

- `git status` clean; only this plan's files changed.
- No route/permission changes → `docs/api/openapi.json` untouched (the drift
  test in the cargo suite proves it).
- Spot-check: no `payment_type` mutability slipped in; amount/date still
  rejected on completed rows of every type.
