# Deposit Checkout Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the checkout folio from counting held deposits as bill payments (the false "Overpayment" that led an admin to void a deposit), and enforce — server-side — that a collected deposit is refunded or forfeited before checkout.

**Architecture:** New `payments.payment_type` value `deposit_forfeited` (schema patch `0024`) marks money the hotel keeps; every bill-settling SQL sum excludes it alongside `refund`/`deposit`. A new `POST /api/payments/forfeit-deposit/{booking_id}` (gate `payments:refund`, reason required) writes the row under the booking `FOR UPDATE` lock. `update_booking`'s checkout transition gains an unresolved-deposit guard, and `void_payment_tx` refuses completed deposit rows once the booking is in-house. The frontend splits deposit rows out of the bill-payments list and adds a Forfeit action.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL backend (`hotel-app-be`), React/TS/MUI frontend (`hotel-web-fe`), PostgreSQL patch catalog (`database/postgres/patches/` + `manifest.tsv`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-13-deposit-checkout-guard-design.md`
- Repo conventions: `AGENTS.md` + `CLAUDE.md`. Backend tests need `DATABASE_URL`; verify by **run count**, not exit code.
- The worktree is shared/dirty — stage only files this plan touches.
- Refundable/unresolved deposit formula, used identically everywhere:
  `max(Σ(deposit,completed), deposit_paid ? deposit_amount : 0) − Σ(refund rows, non-void) − Σ(deposit_forfeited,completed)`, floored at 0.
- `record_payment`'s caller-supplied-type whitelist (`services/payments.rs:~262`: `booking|deposit|service|damage`) stays unchanged — `deposit_forfeited` is written ONLY by the forfeit endpoint.
- Do NOT change `!= 'refund'`-only sums (`lifecycle.rs:783,804`, `night_audit.rs:1069`) — those count "money collected", where forfeits correctly belong.
- Commit style: `git log --oneline -5` for voice; footer `Generated with [Devin](https://devin.ai)` + `Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>`.

---

### Task 1: Schema — widen `payments_payment_type_check` + update `sync_booking_payment_status()` (patch 0024)

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql` (constraint at ~line 3894; function body at ~lines 815-856)
- Create: `hotel-app-be/database/postgres/patches/0024_deposit_forfeited.sql`
- Modify: `hotel-app-be/database/postgres/patches/manifest.tsv` (append row)
- Modify: `.github/workflows/deploy.yml` (both patch lists: the `cp` block ~line 207 and the file-list block ~line 245)
- Modify: `deploy/deploy.sh` (patch list)
- Modify: `deploy/deploy-staging.sh` (patch list — unenforced, easy to forget)
- Modify: `.github/workflows/deploy-staging.yml` (patch list — unenforced)
- Modify: `hotel-app-be/tests/postgres_patch_lifecycle.rs` — two `version BETWEEN 2 AND 23` (~lines 573, 1792) → `AND 24`; expected-revision list inside `assert_expected_revisions` (~line 665) gains the 0024 row; `revisions.len()` assertion `22` → `23`
- Test: `hotel-app-be/tests/postgres_patch_catalog.rs` (already enforces manifest↔deploy registration)

**Interfaces:**
- Produces: `payment_type='deposit_forfeited'` accepted by the CHECK; DB trigger treats it as non-settling money (like `deposit`).

- [ ] **Step 1: Baseline edits**

In `0001_v1_baseline.sql` line ~3894, widen the CHECK:

```sql
    CONSTRAINT payments_payment_type_check CHECK (((payment_type)::text = ANY ((ARRAY['booking'::character varying, 'deposit'::character varying, 'service'::character varying, 'damage'::character varying, 'refund'::character varying, 'deposit_forfeited'::character varying])::text[]))),
```

In the baseline `sync_booking_payment_status()` body (~line 834) change:

```sql
       AND COALESCE(payment_type, 'booking') NOT IN ('refund', 'deposit', 'deposit_forfeited');
```

Also update the function's comment lines (~826-828) to mention forfeited deposits.

- [ ] **Step 2: Write patch `0024_deposit_forfeited.sql`**

Follow the house pattern from `0005_booking_status_enforcement.sql`: `DO $$` blocks that compare `pg_get_constraintdef`/`pg_get_functiondef` literally — replace when it matches the old definition, no-op when already current, `RAISE EXCEPTION` on drift. Two blocks:

1. `payments_payment_type_check`: old def has the 5-element ARRAY; current def has the 6-element ARRAY above (the exact `pg_get_constraintdef` rendering — copy the baseline text).
2. `sync_booking_payment_status()`: `pg_get_functiondef` comparison between the old body (`NOT IN ('refund', 'deposit')`) and new body (`NOT IN ('refund', 'deposit', 'deposit_forfeited')`); replace via `CREATE OR REPLACE FUNCTION` with the full new body copied verbatim from the edited baseline (including its comments).

Header comment: explains that `deposit_forfeited` rows are completed payments the hotel kept (not collateral, not bill settlement), and that the trigger exclusion keeps them from marking charges paid.

- [ ] **Step 3: Register the patch**

- `manifest.tsv` append: `1<TAB>24<TAB>deposit-forfeited<TAB>sha256:<sha256 of file><TAB>0024_deposit_forfeited.sql`
  - checksum: `shasum -a 256 database/postgres/patches/0024_deposit_forfeited.sql` — verify against `apply-patches.sh`'s checksum method if it differs.
- `deploy.yml`: add `cp …/0024_deposit_forfeited.sql …` after the 0023 line in the `cp` block, and `database/patches/0024_deposit_forfeited.sql \` after 0023 in the file-list block.
- `deploy/deploy.sh`, `deploy/deploy-staging.sh`, `.github/workflows/deploy-staging.yml`: same addition wherever 0023 is named.
- `postgres_patch_lifecycle.rs`: `BETWEEN 2 AND 23` → `BETWEEN 2 AND 24` (two places), add the 0024 entry to the expected-revisions list in `assert_expected_revisions`, `revisions.len()` 22 → 23.

- [ ] **Step 4: Verify**

Run: `cd hotel-app-be && cargo test --all-features --test postgres_patch_catalog`
Expected: PASS (validates manifest↔deploy wiring).
Run: `cargo test --all-features --test postgres_patch_lifecycle` with `DATABASE_URL` set — confirm it actually ran (nonzero test count).

- [ ] **Step 5: Commit**

`git add` the 8 touched paths; commit `db: add deposit_forfeited payment type (patch 0024)`.

---

### Task 2: Exclude `deposit_forfeited` from every bill-settling SQL sum

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs` (lines ~385, ~391, ~422, ~428, ~1225)
- Modify: `hotel-app-be/src/repositories/bookings_queries.rs` (8 occurrences, lines ~21-29 and ~70-78)
- Modify: `hotel-app-be/src/repositories/bookings/lifecycle.rs` (lines ~3032, ~3040)
- Modify: `hotel-app-be/src/services/payments.rs` (line ~950)
- Modify: `hotel-app-be/src/services/booking_emails.rs` (line ~373)

**Interfaces:**
- Consumes: the new `deposit_forfeited` type from Task 1.
- Produces: `total_paid`/`balance_due`/`payment_status`/`v_settled`/`receipt paid` sums identical for all existing rows; a `deposit_forfeited` row never reduces a balance or marks a bill paid.

- [ ] **Step 1: Replace the exclusion list everywhere it appears**

In each file replace every literal occurrence of:

```sql
NOT IN ('refund', 'deposit')
```

with:

```sql
NOT IN ('refund', 'deposit', 'deposit_forfeited')
```

Use `replace_all` on that exact substring per file — it appears 5× in `payment.rs`, 8× in `bookings_queries.rs`, 2× in `lifecycle.rs`, 1× in `services/payments.rs`, 1× in `booking_emails.rs`. Do NOT touch the `!= 'refund'` collected-money checks (`lifecycle.rs:~783,~804`, `night_audit.rs:~1069`).

Update the adjacent comments that say "excluding refunds and held deposits" to mention forfeited deposits.

- [ ] **Step 2: Verify compile**

Run: `cd hotel-app-be && cargo check --all-features`
Expected: clean (string-only change).

- [ ] **Step 3: Commit**

`git commit -m "payments: exclude deposit_forfeited from bill-settling sums"`.

---

### Task 3: Workflow summary gains `deposit_forfeited`; deposit mirror subtracts forfeits

**Files:**
- Modify: `hotel-app-be/src/models/payment.rs` — `PaymentWorkflowSummary` (~line 209) and `PaymentWorkflowSummaryRow` (~line 282): add `pub deposit_forfeited: Decimal` after `deposit_refunded`
- Modify: `hotel-app-be/src/repositories/payment.rs` — `workflow_summary_row` SQL (~line 1211-1238), `map_workflow_summary_row` (~line 2064), `refund_deposit` ceiling (~lines 1291-1312), `sync_booking_deposit_mirror_tx` (~lines 1962-1983)
- Modify: `hotel-app-be/src/services/payments.rs` — `get_payment_workflow_summary` warnings/next_action (~lines 499-520)
- Modify: `hotel-web-fe/src/types/payment.types.ts` — `PaymentWorkflowSummary` add `deposit_forfeited: number | string` after `deposit_refunded`

**Interfaces:**
- Produces: `PaymentWorkflowSummaryRow.deposit_forfeited: Decimal`; `PaymentWorkflowSummary.deposit_forfeited` in the JSON; refund ceiling that shrinks on forfeit; mirror = "deposit still held and refundable".

- [ ] **Step 1: Summary row + mapping**

In `workflow_summary_row` SQL add after `deposit_refunded`:

```sql
                COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.id AND p.status = 'completed'
                      AND COALESCE(p.payment_type, 'booking') = 'deposit_forfeited'), 0) AS deposit_forfeited,
```

In `map_workflow_summary_row` add `deposit_forfeited: row_mappers::get_decimal(row, "deposit_forfeited"),`. Add the field to both structs and to the `PaymentWorkflowSummary` construction in `get_payment_workflow_summary`.

- [ ] **Step 2: Warnings + next_action**

In `get_payment_workflow_summary` replace both `row.deposit_collected > row.deposit_refunded` checks with:

```rust
row.deposit_collected - row.deposit_refunded - row.deposit_forfeited > Decimal::ZERO
```

- [ ] **Step 3: Refund ceiling**

In `PaymentRepository::refund_deposit` the refundable query becomes:

```sql
SELECT
    COALESCE((SELECT SUM(amount) FROM payments
              WHERE booking_id = $1 AND payment_type = 'deposit' AND status = 'completed'), 0)
    - COALESCE((SELECT SUM(amount) FROM payments
              WHERE booking_id = $1 AND payment_type = 'refund' AND status = 'refunded'), 0)
    - COALESCE((SELECT SUM(amount) FROM payments
              WHERE booking_id = $1 AND payment_type = 'deposit_forfeited' AND status = 'completed'), 0)
```

- [ ] **Step 4: Mirror sync**

In `sync_booking_deposit_mirror_tx` the inner select becomes "still
refundable". Forfeit rows are positive amounts that must be subtracted, so
a single `SUM` over both types is wrong — filter them apart:

```sql
FROM (SELECT COALESCE(SUM(amount) FILTER (WHERE payment_type = 'deposit'), 0)
           - COALESCE(SUM(amount) FILTER (WHERE payment_type = 'deposit_forfeited'), 0)
             AS total
      FROM payments
      WHERE booking_id = $1 AND status = 'completed'
        AND payment_type IN ('deposit', 'deposit_forfeited')) s
```

Update the doc comment: mirror now means "held and still refundable".

- [ ] **Step 5: Verify**

`cargo check --all-features` clean; `bun run typecheck` clean.

- [ ] **Step 6: Commit**

`git commit -m "payments: track forfeited deposits in summary and deposit mirror"`.

---

### Task 4: `PaymentRepository::forfeit_deposit` + integration test

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs` — add `forfeit_deposit` next to `refund_deposit` (~line 1337)
- Test: `hotel-app-be/tests/payment_characterization.rs` (reuse its booking/seed helpers; check `tests/common/` for shared setup)

**Interfaces:**
- Produces: `pub async fn forfeit_deposit(pool: &DbPool, user_id: i64, booking_id: i64, amount: Decimal, reason: &str) -> Result<PaymentEntryRow, ApiError>` — consumed by Task 5's service.

- [ ] **Step 1: Write failing tests** (in `tests/payment_characterization.rs`, same style as the existing deposit/refund cases):

- forfeit of the full collected deposit inserts a `deposit_forfeited`/`completed` row and zeroes the refund ceiling (a subsequent `refund_deposit` returns "No refundable deposit…");
- partial forfeit leaves `collected − forfeited` refundable;
- `amount > refundable` → `BadRequest("…cannot exceed the refundable deposit…")`;
- `amount <= 0` and empty reason → `BadRequest`.

Run: `cargo test --all-features --test payment_characterization` with `DATABASE_URL` — new tests FAIL (function missing).

- [ ] **Step 2: Implement** (model on `refund_deposit`, same lock + ceiling):

```rust
    /// Record that the hotel keeps part or all of a held deposit (lost
    /// keycard, damage). Inserts a `deposit_forfeited` row that stays
    /// `completed` — the cash really was collected — while shrinking the
    /// refundable ceiling and the booking's deposit mirror. Serialized with
    /// refunds on the booking FOR UPDATE lock.
    pub async fn forfeit_deposit(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
        amount: Decimal,
        reason: &str,
    ) -> Result<PaymentEntryRow, ApiError> {
        let mut tx = pool.begin().await.map_err(ApiError::from)?;
        let booking_locked = sqlx::query("SELECT id FROM bookings WHERE id = $1 FOR UPDATE")
            .bind(booking_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(ApiError::from)?;
        if booking_locked.is_none() {
            return Err(ApiError::NotFound("Booking not found".to_string()));
        }

        let refundable_deposit = sqlx::query_scalar::<_, Decimal>(
            "SELECT \
                COALESCE((SELECT SUM(amount) FROM payments \
                          WHERE booking_id = $1 AND payment_type = 'deposit' AND status = 'completed'), 0) \
                - COALESCE((SELECT SUM(amount) FROM payments \
                          WHERE booking_id = $1 AND payment_type = 'refund' AND status = 'refunded'), 0) \
                - COALESCE((SELECT SUM(amount) FROM payments \
                          WHERE booking_id = $1 AND payment_type = 'deposit_forfeited' AND status = 'completed'), 0)",
        )
        .bind(booking_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        if refundable_deposit <= Decimal::ZERO {
            return Err(ApiError::BadRequest(
                "No refundable deposit was collected for this booking".to_string(),
            ));
        }
        if amount > refundable_deposit {
            return Err(ApiError::BadRequest(format!(
                "Forfeit amount cannot exceed the refundable deposit of {refundable_deposit}"
            )));
        }

        // Carry the tender the deposit was originally collected in — the
        // row records kept money, not a new payment.
        let deposit_method: String = sqlx::query_scalar(
            "SELECT payment_method FROM payments \
             WHERE booking_id = $1 AND payment_type = 'deposit' AND status = 'completed' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(booking_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?
        .unwrap_or_else(|| "cash".to_string());

        let row = sqlx::query_as::<_, PaymentEntryRow>(
            r#"
            INSERT INTO payments (
                uuid, booking_id, amount, payment_method, payment_type,
                status, notes, created_by
            )
            VALUES (gen_uuidv7(), $1, $2, $3, 'deposit_forfeited', 'completed', $4, $5)
            RETURNING id, booking_id, amount::text AS total_amount, payment_method, payment_type,
                      status AS payment_status, NULL::text AS transaction_reference, notes,
                      created_at::date::text AS payment_date, created_at
            "#,
        )
        .bind(booking_id)
        .bind(decimal_to_db(amount))
        .bind(&deposit_method)
        .bind(format!("Deposit forfeited: {reason}"))
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        Self::sync_booking_deposit_mirror_tx(&mut tx, booking_id).await?;
        tx.commit().await.map_err(ApiError::from)?;
        Ok(row)
    }
```

(`payment_method` is copied from the original deposit row — no money moves at forfeit; the row documents which tender was retained.)

- [ ] **Step 3: Run tests** — new cases PASS with `DATABASE_URL`.

- [ ] **Step 4: Commit** — `payments: add deposit forfeit repository op`.

---

### Task 5: Forfeit service + handler + route (`payments:refund` gate)

**Files:**
- Modify: `hotel-app-be/src/services/payments.rs` — add `forfeit_deposit` after `refund_deposit` (~line 597)
- Modify: `hotel-app-be/src/handlers/payments.rs` — add `forfeit_deposit_handler` after `revert_deposit_refund_handler`
- Modify: `hotel-app-be/src/routes/payments.rs` — add route + constant

**Interfaces:**
- Consumes: `PaymentRepository::forfeit_deposit` (Task 4).
- Produces: `POST /api/payments/forfeit-deposit/{booking_id}` body `{amount: number, reason: string}` → `200` with the payment row JSON; consumed by Task 8's `InvoicesService.forfeitDeposit`.

- [ ] **Step 1: Service** — mirror `refund_deposit`; parse `amount`/`reason` from the JSON body the same way; validate `reason.trim()` non-empty (`"A forfeit reason is required"`), `amount > 0`; call the repo; `recompute_payment_status`; audit `payment_deposit_forfeited` with `booking_id`, `amount`, `reason`.

- [ ] **Step 2: Handler** — same shape as `revert_deposit_refund_handler` but takes `Json(body): Json<serde_json::Value>`.

- [ ] **Step 3: Route** in `routes/payments.rs`:

```rust
        .route(
            "/payments/forfeit-deposit/{booking_id}",
            post(forfeit_deposit),
        )
```

Route-wrapper fn next to `refund_deposit` (~line 132): `require_permission_helper(&pool, &headers, PAYMENTS_REFUND)` then dispatch. A comment noting forfeit is checkout-side money handling, same gate as refund.

- [ ] **Step 4: HTTP contract test** — in `tests/payment_http_contract.rs` (or characterization): unauthenticated → 401; `payments:create`-only user → 403; `payments:refund` holder succeeds. Verify against how that test file seeds roles.

- [ ] **Step 5: Regenerate OpenAPI** — `HOTEL_APP_UPDATE_OPENAPI=1 cargo test --all-features --test openapi_drift` (new route must land in `docs/api/openapi.json`).

- [ ] **Step 6: Commit** — `payments: POST /payments/forfeit-deposit endpoint`.

---

### Task 6: Checkout guard — unresolved deposit blocks `checked_out`/`completed`

**Files:**
- Modify: `hotel-app-be/src/repositories/bookings/lifecycle.rs` — extend `ensure_checkout_balance_resolved` (~line 818) or add `ensure_checkout_deposit_resolved` called at the same site (~line 1585)
- Test: `tests/booking_service.rs` or a new `tests/deposit_checkout_guard.rs`

**Interfaces:**
- Consumes: `PaymentWorkflowSummaryRow.deposit_forfeited` (Task 3).
- Produces: transition to `checked_out`/`completed` returns `400` with `Refund, forfeit, or waive the collected deposit of {amount} before checkout` while unresolved.

- [ ] **Step 1: Failing tests** — checkout (`update_booking status='checked_out'`) is rejected while a completed deposit is unrefunded; succeeds after `refund_deposit`; succeeds after `forfeit_deposit`; flag-only booking (`deposit_paid=true, deposit_amount>0`, no rows) is rejected; partial forfeit still rejects the remainder.

- [ ] **Step 2: Implement** — inside `ensure_checkout_balance_resolved`, after the balance check, still gated by `is_checkout_transition`, reuse the already-fetched `summary` row (currently consumed via `.map(|s| s.total_paid)` — bind it to a variable first):

```rust
    // Flag-only legacy deposits carry the assertion on the booking mirror
    // with no payment rows behind it — the held amount is whichever is
    // larger: the ledger's recorded deposits or the mirror's assertion.
    let deposit_held = summary
        .deposit_collected
        .max(if existing_booking.deposit_paid {
            existing_booking.deposit_amount.unwrap_or(Decimal::ZERO)
        } else {
            Decimal::ZERO
        });
    let unresolved_deposit = (deposit_held
        - summary.deposit_refunded
        - summary.deposit_forfeited)
        .max(Decimal::ZERO);
    if unresolved_deposit > Decimal::ZERO {
        return Err(ApiError::BadRequest(format!(
            "Refund, forfeit, or waive the collected deposit of {} before checkout",
            unresolved_deposit.round_dp(2)
        )));
    }
```

(The mirror is never trusted to *create* refundable money — it can only
*add* a block here, and refund/forfeit/waive all still resolve through the
ledger. This is the Global Constraints formula with `collected ∨ mirror`.)

The guard is NOT exempted by company billing. Update the function's doc comment to cover both balance and deposit resolution.

- [ ] **Step 3: Run tests** — PASS with `DATABASE_URL`.

- [ ] **Step 4: Commit** — `bookings: block checkout while a deposit is unresolved`.

---

### Task 7: Void guard — completed deposit rows refuse void once in-house

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs` — `void_payment_tx` (~line 1900)
- Test: `tests/payment_characterization.rs` (or the Task 6 file)

**Interfaces:**
- Produces: voiding a `completed` `payment_type='deposit'` row on a booking whose status is `checked_in`/`auto_checked_in`/`late_checkout`/`checked_out`/`completed` → `400`; pre-stay statuses keep the existing `payments:manage` path. `deposit_forfeited` rows stay voidable by `payments:manage` (the un-forfeit hatch).

- [ ] **Step 1: Failing tests** — void deposit on `checked_in` booking → error; void same deposit on `confirmed` booking → succeeds (with `payments:manage` caller, matching existing tests' permission setup).

- [ ] **Step 2: Implement** — in `void_payment_tx`, after the existing `refund`/`terminal` checks:

```rust
        if existing.payment_type.as_deref() == Some("deposit")
            && existing.payment_status.as_deref() == Some("completed")
        {
            let in_house_or_later: Option<String> = sqlx::query_scalar(
                "SELECT status FROM bookings WHERE id = $1",
            )
            .bind(booking_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(ApiError::from)?;
            if matches!(
                in_house_or_later.as_deref(),
                Some("checked_in")
                    | Some("auto_checked_in")
                    | Some("late_checkout")
                    | Some("checked_out")
                    | Some("completed")
            ) {
                return Err(ApiError::BadRequest(
                    "Deposit payments can't be voided after check-in — \
                     refund or forfeit the deposit instead"
                        .to_string(),
                ));
            }
        }
```

- [ ] **Step 3: Run tests** — PASS.

- [ ] **Step 4: Commit** — `payments: refuse deposit voids once a booking is in-house`.

---

### Task 8: FE service + type

**Files:**
- Modify: `hotel-web-fe/src/api/invoices.service.ts` — add `forfeitDeposit` after `refundDeposit` (~line 70)
- Modify: `hotel-web-fe/src/types/payment.types.ts` — `PaymentWorkflowSummary` add `deposit_forfeited: number | string;` (if not already added in Task 3)

**Interfaces:**
- Produces: `InvoicesService.forfeitDeposit(bookingId: string|number, amount: number, reason: string): Promise<any>` → POST `payments/forfeit-deposit/{id}` json `{amount, reason}` — consumed by Task 9.

- [ ] **Step 1: Implement** mirroring `refundDeposit` (same `toApiError` wrap, message `'Failed to forfeit deposit'`).

- [ ] **Step 2: `bun run typecheck`** — clean.

- [ ] **Step 3: Commit** — `fe: forfeitDeposit API binding`.

---

### Task 9: CheckoutInvoiceModal — honest balance + deposit group + Forfeit action

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/utils/chargesCalculation.ts` (or a new `features/invoices/utils/payments.ts`) — export helpers
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`
- Test: extend/duplicate the modal's existing test if present (`grep CheckoutInvoiceModal hotel-web-fe/src --include=*.test*`), else a focused utils test

**Interfaces:**
- Consumes: `InvoicesService.forfeitDeposit` (Task 8).
- Produces:
  - `isDepositLikePayment(p: CheckoutPaymentRecord): boolean` — `['deposit','deposit_forfeited'].includes((p.payment_type||'').toLowerCase())`
  - `settledPaymentsTotal(payments: CheckoutPaymentRecord[]): number` — sum of `status='completed'` non-deposit-like rows (mirrors backend `total_paid`)

- [ ] **Step 1: Failing utils test** — a completed deposit row + a completed booking payment equal to the bill ⇒ settled total = bill only; a `deposit_forfeited` row is excluded too.

- [ ] **Step 2: Wire the modal**

- `paymentRowsTotal` → `settledPaymentsTotal(payments)`; same helper in the prefill effect (~line 198-211) and the record-payment cap (`isGreaterMoney(paymentAmount, balanceDue)` stays, now correct).
- `completedPayments` → `payments.filter(p => p.payment_status === 'completed' && !isDepositLikePayment(p))`; add `depositPayments = payments.filter(p => p.payment_status === 'completed' && isDepositLikePayment(p))`.
- Deposit rows render in their own labeled block (e.g. below the bill-payments list, inside the Payments box): each shows method, date, amount, and a Chip — `Deposit held` for `deposit`, `Deposit forfeited` for `deposit_forfeited` — with **no** Edit/Delete buttons.
- New state: `const [depositForfeited, setDepositForfeited] = useState(false);` reset in the open effect (~line 190) and — for un-forfeit — cleared when a forfeit row is voided in `handleDeletePayment` (mirror the existing refunded-reset).
- `handleForfeitDeposit`: requires `forfeitReason.trim()`; computes refundable like `handleRefundDeposit` (recorded − refunded); calls `InvoicesService.forfeitDeposit(booking.id, amount, reason)`; on success `setDepositForfeited(remaining <= 0)` (full forfeit only), `reloadPayments()`, `invalidateInvoiceState()`. On failure `setError(...)`.
- Deposit section UI: next to Refund/Waive, add a Forfeit row — reason `TextField` + amount `TextField` defaulting to `charges.depositRefund` + `Forfeit` button (`color="warning"`). Show Forfeit only when `recordedDeposit > 0` (flag-only deposits use Waive); update the Waive caption to "Deposit recorded but never collected".
- Gate expression (lines ~2101, ~2109): `… && !depositRefunded && !depositWaived && !depositForfeited`.
- `depositRefunded` detection in `useCheckoutInvoiceData.reloadPayments` already keys on refund rows — no change.

- [ ] **Step 3: Tests** — utils test passes; if a modal test exists add: bill fully paid + deposit held ⇒ footer "Fully Paid" (not "Overpayment"), deposit row has no delete button.

- [ ] **Step 4: Gates** — `bun run typecheck && bun run lint && bun run test`.

- [ ] **Step 5: Commit** — `fe: stop counting deposits as bill payments; add forfeit action`.

---

### Task 10: Full gates + drift checks

- [ ] **Step 1:** `cd hotel-app-be && cargo clippy --all-features -- -D warnings`
- [ ] **Step 2:** `cargo test --all-features` with `DATABASE_URL` — verify run count is the real suite (~500+), not the lib-only ~209.
- [ ] **Step 3:** `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test && bun run build`
- [ ] **Step 4:** confirm `docs/api/openapi.json` diff contains only the forfeit route; `git status` shows only this plan's files staged/committed.
- [ ] **Step 5:** Final commit / push per session norms (do not push unless asked).

## Out of scope (from spec)

- Auto-posting forfeited deposits as an invoice revenue line.
- Un-void endpoint for the incident's deleted row (manual SQL or re-record).
- Mirror/flag-only attest-path refactors.
