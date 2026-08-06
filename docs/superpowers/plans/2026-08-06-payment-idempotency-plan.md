# Payment Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate and over-limit booking and ledger payments while preserving legitimate installments and making company-ledger allocation atomic.

**Architecture:** PostgreSQL parent-row locks serialize balance-sensitive writes, while persisted scoped idempotency keys distinguish retries from legitimate additional payments. A new ledger batch endpoint performs company allocation in one transaction; frontend dialogs retain a generated key until success or a material input change.

**Tech Stack:** Rust 1.95, Axum 0.8, SQLx 0.8, PostgreSQL 19, React 19, TypeScript 6, TanStack Query, ky, Vitest.

## Global Constraints

- Preserve partial/installment payments, route permissions, response shapes, and existing accounting semantics.
- Use parameterized PostgreSQL SQL and transactions for every multi-step money mutation.
- Add schema objects to `database/postgres/migrations/0001_v1_baseline.sql`; document an idempotent operator SQL block in `docs/guides/deployment.md`.
- Do not add dependencies.
- Preserve unrelated uncommitted changes already present on `master`, especially `repositories/ledger.rs` and `tests/ledger_characterization.rs`.
- Because this is a shared dirty `master` checkout, do not create intermediate commits containing overlapping user changes; stage or commit only when owned hunks can be isolated safely.

---

## File map

- `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`: nullable idempotency key/fingerprint columns and unique indexes; receipt index scope.
- `docs/guides/deployment.md`: one-time idempotent live-database SQL and verification queries.
- `hotel-app-be/src/models/payment.rs`: required booking payment idempotency keys.
- `hotel-app-be/src/models/ledger.rs`: ledger key, company allocation request, and allocation response DTOs.
- `hotel-app-be/src/models/row_mappers.rs`: decode persisted idempotency keys where payment rows expose them.
- `hotel-app-be/src/repositories/payment.rs`: booking locks, replay lookup, payload comparison, and locked guest/completion guards.
- `hotel-app-be/src/services/payments.rs`: transaction ordering and replay side-effect suppression.
- `hotel-app-be/src/repositories/ledger.rs`: reusable locked payment insertion plus atomic batch allocation.
- `hotel-app-be/src/services/ledgers.rs`: batch orchestration and audit events.
- `hotel-app-be/src/handlers/{payments,ledgers}.rs`, `src/routes/{payments,ledgers}.rs`: request wiring and the new batch endpoint.
- `hotel-app-be/tests/{payment_characterization,ledger_characterization,ledger_service}.rs`: PostgreSQL concurrency and rollback regressions.
- `hotel-web-fe/src/types/ledger.types.ts`: request/response types.
- `hotel-web-fe/src/api/{invoices,ledger}.service.ts`: require keys and call the atomic endpoint.
- `hotel-web-fe/src/utils/idempotency.ts`: dependency-free key creation.
- Payment dialog/page files: retain and rotate keys correctly.
- Frontend service/page tests: payload and retry behavior.

---

### Task 1: Schema and DTO contract

**Files:**
- Modify: `hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql`
- Modify: `hotel-app-be/src/models/payment.rs`
- Modify: `hotel-app-be/src/models/ledger.rs`
- Modify: `hotel-app-be/src/models/row_mappers.rs`
- Test: `hotel-app-be/tests/status_vocabulary.rs`

**Interfaces:**
- `RecordPaymentRequest.idempotency_key: String`
- `PaymentRequest.idempotency_key: String`
- `CustomerLedgerPaymentRequest.idempotency_key: String`
- Persisted payment rows carry `idempotency_fingerprint: Option<String>` internally; it is not added to public response JSON.
- `CompanyLedgerPaymentRequest { ledger_ids: Vec<i64>, payment_amount: f64, payment_method: String, payment_reference: Option<String>, receipt_number: Option<String>, notes: Option<String>, payment_date: Option<String>, idempotency_key: String }`
- `CompanyLedgerPaymentResponse { payments: Vec<CustomerLedgerPayment>, payment_amount: Decimal }`

- [ ] **Step 1: Write the failing live schema-contract test**

Add a PostgreSQL test that queries `information_schema.columns` and
`pg_indexes` after real baseline initialization and requires:

```rust
assert!(column_exists(&pool, "payments", "idempotency_key").await);
assert!(column_exists(&pool, "payments", "idempotency_fingerprint").await);
assert!(column_exists(&pool, "customer_ledger_payments", "idempotency_key").await);
assert!(column_exists(&pool, "customer_ledger_payments", "idempotency_fingerprint").await);
assert!(index_is_unique(&pool, "uq_payments_booking_idempotency").await);
assert!(index_is_unique(&pool, "uq_ledger_payments_ledger_idempotency").await);
```

- [ ] **Step 2: Run RED**

Run: `cargo test --all-features --test status_vocabulary payment_idempotency_schema -- --exact --nocapture`

Expected: FAIL because the columns/indexes are absent.

- [ ] **Step 3: Add the minimal schema**

Append nullable key and fingerprint columns to the two table definitions and replace/add indexes:

```sql
-- Add both columns at the end of each table body so fresh and patched schemas converge.
idempotency_key character varying(160),
idempotency_fingerprint character varying(64)

CREATE UNIQUE INDEX uq_payments_booking_idempotency
    ON public.payments USING btree (booking_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> '';

CREATE UNIQUE INDEX uq_ledger_payments_ledger_idempotency
    ON public.customer_ledger_payments USING btree (ledger_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND TRIM(BOTH FROM idempotency_key) <> '';

CREATE UNIQUE INDEX idx_customer_ledger_payments_receipt_unique
    ON public.customer_ledger_payments
    USING btree (ledger_id, lower(TRIM(BOTH FROM receipt_number)))
    WHERE receipt_number IS NOT NULL AND TRIM(BOTH FROM receipt_number) <> '';
```

- [ ] **Step 4: Add DTO fields and validation helper**

Add a shared pure helper near the payment services:

```rust
fn normalized_idempotency_key(value: &str) -> Result<&str, ApiError> {
    let key = value.trim();
    if key.is_empty() || key.len() > 160 {
        return Err(ApiError::BadRequest(
            "Idempotency key must be between 1 and 160 characters".to_string(),
        ));
    }
    Ok(key)
}
```

Expose stored keys/fingerprints only where repositories need comparison; do not add them to existing public response JSON.

- [ ] **Step 5: Run GREEN**

Run the named schema test and `cargo check --all-features`.

---

### Task 2: Booking payment serialization and replay

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs`
- Modify: `hotel-app-be/src/services/payments.rs`
- Modify: `hotel-app-be/src/handlers/payments.rs`
- Test: `hotel-app-be/tests/payment_characterization.rs`

**Interfaces:**
- `PaymentRepository::lock_booking_for_payment_tx(tx, booking_id) -> Result<(), ApiError>`
- `PaymentRepository::find_idempotent_payment_tx(tx, booking_id, key) -> Result<Option<PaymentEntryRow>, ApiError>`
- `PaymentRepository::record_payment(...)` inserts `idempotency_key` and the canonical fingerprint.

- [ ] **Step 1: Write failing booking concurrency tests**

Add independent PostgreSQL tests proving:

```rust
// Two concurrent RM300 requests against RM300: exactly one succeeds as new,
// one is rejected/replayed, COUNT(*) == 1, SUM(amount) == 300.
// Same key + same payload twice: both calls succeed but return the same id.
// Same key + changed amount: second call returns ApiError::Conflict.
// Different keys for RM100 + RM200: both succeed and settle RM300.
```

Use a test-only trigger with `pg_sleep` to make the former race deterministic,
and always drop it during cleanup.

- [ ] **Step 2: Run RED**

Run each new test by exact name with a real `DATABASE_URL`. Confirm the race test records two rows before implementation and the replay tests fail because no key is persisted.

- [ ] **Step 3: Lock before reading balance**

At the beginning of `services::payments::record_payment`'s transaction:

```rust
PaymentRepository::lock_booking_for_payment_tx(&mut tx, request.booking_id).await?;
```

The helper executes `SELECT id FROM bookings WHERE id = $1 FOR UPDATE` and returns `NotFound` when absent. Only then call `workflow_summary_row`.

- [ ] **Step 4: Implement exact replay and conflict**

Under the booking lock, query `(booking_id, idempotency_key)`. Compare the
stored canonical SHA-256 fingerprint of booking ID, amount, method, type,
reference, notes, and requested payment date. Equality returns the existing row
and a replay flag. Mismatch returns `ApiError::Conflict`.
Only a newly inserted row may recompute status, append booking history, award
loyalty points, or write `payment_recorded` audit data.

- [ ] **Step 5: Harden the older completed-payment path**

Make `create_completed_payment` take the booking lock and apply the same key
semantics before its existing completed-payment check and insert.

- [ ] **Step 6: Run GREEN**

Run all new booking tests plus the existing
`record_payment_recomputes_status_and_confirms_booking_on_full_settlement` test.

---

### Task 3: Guest payment initiation and completion races

**Files:**
- Modify: `hotel-app-be/src/repositories/payment.rs`
- Modify: `hotel-app-be/src/services/payments.rs`
- Test: `hotel-app-be/tests/payment_characterization.rs`

**Interfaces:**
- `has_active_or_completed_booking_payment_tx(&mut DbTransaction, booking_id)`
- `complete_and_confirm` locks the booking before checking other completed payments.

- [ ] **Step 1: Write failing concurrent guest tests**

Create tests that use a barrier/delay to invoke two bank-transfer claims for one
awaiting-payment booking and to complete two legacy pending payments. Assert one
active claim at most and one completed payment at most.

- [ ] **Step 2: Run RED**

Expected: concurrent initiation creates two pending rows, or concurrent legacy
completion allows both rows to pass the pre-check.

- [ ] **Step 3: Move checks under the booking lock**

For bank transfer and PayPal order creation, begin the transaction first, lock
the booking, re-read/validate its payment-awaiting status, then call the
transaction-scoped active-payment query before inserting.

In `complete_and_confirm`, lock the booking before
`has_other_completed_booking_payment_tx` and the status compare-and-swap.

- [ ] **Step 4: Run GREEN**

Run the new guest concurrency tests and existing PayPal webhook/capture characterization tests.

---

### Task 4: Ledger replay and atomic company allocation

**Files:**
- Modify: `hotel-app-be/src/repositories/ledger.rs`
- Modify: `hotel-app-be/src/services/ledgers.rs`
- Modify: `hotel-app-be/src/handlers/ledgers.rs`
- Modify: `hotel-app-be/src/routes/ledgers.rs`
- Test: `hotel-app-be/tests/ledger_characterization.rs`
- Test: `hotel-app-be/tests/ledger_service.rs`

**Interfaces:**
- `repo::create_ledger_payment` keeps its public signature but consumes the request key.
- `repo::create_company_ledger_payment(pool, user_id, request) -> Result<CompanyLedgerPaymentResponse, ApiError>`
- `POST /ledgers/company-payments`, guarded by `ledgers:create`.

- [ ] **Step 1: Write failing ledger replay tests**

Prove exact concurrent RM200 retries with one key create one row, changed payload
conflicts, and two different keys create two legitimate RM200 installments.

- [ ] **Step 2: Write failing batch tests**

Seed two same-company ledgers. Assert one RM700 request allocates RM500 then
RM200 atomically. Install a test-only trigger that fails the second insert and
assert zero payment rows plus unchanged parent balances. Retry a successful
batch and assert the same payment IDs. Add mixed-company, duplicate-ID,
over-limit, and same-receipt-across-ledgers cases.

- [ ] **Step 3: Run RED**

Run the new exact tests with PostgreSQL and verify failures match missing replay
and missing endpoint behavior.

- [ ] **Step 4: Extract one transaction-scoped ledger insertion helper**

Implement a private helper that assumes the ledger row is already locked,
checks replay/payload equality, validates outstanding balance, inserts the
payment with its key and canonical fingerprint, and updates parent totals. Both the single and batch paths
call it; do not duplicate payment math.

- [ ] **Step 5: Implement deterministic batch locking and allocation**

Reject duplicate IDs, retain caller order for allocation, acquire locks in
sorted numeric order, validate one company and payable status, then allocate:

```rust
let allocation = remaining.min(outstanding);
let fingerprint = canonical_company_payment_fingerprint(&request);
```

Store every resulting allocation under
`batch:v1:<sha256(normalized raw batch key)>`, not `${batchKey}:${ledgerId}`.
The former is 73 characters and therefore fits `VARCHAR(160)`. Before replay
or allocation, take a PostgreSQL transaction advisory lock for that stored key
and globally preflight every payment row that carries it; use the shared
canonical complete-request fingerprint to return an exact replay or reject a
conflict. This detects a reused key with completely disjoint ledger membership,
which a ledger-scoped derived key cannot discover. Reject any residual amount
after all selected balances. Commit only after every insert/update succeeds.

- [ ] **Step 6: Wire route, handler, service, and audits**

Add the static `/ledgers/company-payments` route before `/{id}` routes, dispatch
through the thin handler/service layers, and log one batch audit plus one ledger
payment audit per newly created allocation. Replays must not duplicate audits.

- [ ] **Step 7: Run GREEN**

Run the new ledger tests plus all existing ledger characterization/service tests.

---

### Task 5: Frontend stable keys and atomic batch call

**Files:**
- Create: `hotel-web-fe/src/utils/idempotency.ts`
- Create: `hotel-web-fe/src/utils/idempotency.test.ts`
- Modify: `hotel-web-fe/src/types/ledger.types.ts`
- Modify: `hotel-web-fe/src/api/invoices.service.ts`
- Modify: `hotel-web-fe/src/api/ledger.service.ts`
- Modify: `hotel-web-fe/src/api/invoices.service.test.ts`
- Modify: `hotel-web-fe/src/api/ledger.service.test.ts`
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`
- Modify: `hotel-web-fe/src/features/bookings/components/Bookings/BookingsPage.tsx`
- Modify: `hotel-web-fe/src/features/admin/components/CustomerLedger/CustomerLedgerPage.tsx`
- Modify: `hotel-web-fe/src/features/admin/components/CustomerLedger/CustomerLedgerPage.test.tsx`

**Interfaces:**
- `createIdempotencyKey(): string`
- `LedgerService.createCompanyLedgerPayment(request): Promise<CompanyLedgerPaymentResponse>`
- Booking/ledger payment request types require `idempotency_key`.

- [ ] **Step 1: Write failing utility/service tests**

Test that generated keys are non-empty and distinct, booking and single-ledger
services forward the key unchanged, and company payment sends one POST to
`ledgers/company-payments` with ordered ledger IDs rather than N payment POSTs.

- [ ] **Step 2: Run RED**

Run only the three named Vitest files. Expected failures: missing utility/type/API method and old loop call count.

- [ ] **Step 3: Implement the utility and API contracts**

```typescript
export function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
```

Require callers to pass the key; service methods never generate it because that
would change it on an uncertain retry.

- [ ] **Step 4: Retain keys across uncertain failures**

Each payment workflow stores `{ key, fingerprint }`. Reuse the key when the
fingerprint of material fields is unchanged, including after a timeout/error.
Create a new key after confirmed success or when amount, method, reference,
receipt, date, notes, selected ledger IDs, or booking/ledger ID changes.

- [ ] **Step 5: Replace the company loop**

`handleRecordCompanyPayment` calls `createCompanyLedgerPayment` once with the
ordered IDs and total. Keep the existing UI refresh and remaining-balance
behavior; remove the per-ledger loop and client-side allocation.

- [ ] **Step 6: Run GREEN**

Run the focused frontend tests, then `bun run typecheck`.

---

### Task 6: Live-database SQL, full verification, and review

**Files:**
- Modify: `docs/guides/deployment.md`
- Modify: `hotel-app-be/database/README.md` only if its canonical lifecycle wording needs a cross-link.

- [ ] **Step 1: Add the dated operator SQL**

Document `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, drop/recreate the receipt
index with ledger scope, and `CREATE UNIQUE INDEX IF NOT EXISTS` for both
idempotency indexes. Include read-only verification queries against
`information_schema.columns` and `pg_indexes`.

- [ ] **Step 2: Prove schema convergence**

Create two isolated PostgreSQL databases: one from the new baseline/seed and
one from the prior committed baseline/seed plus the operator SQL. Dump both
schemas with owner/privileges removed, confirm both dumps are non-trivial, and
diff them to zero.

- [ ] **Step 3: Run backend verification**

Run:

```bash
cargo fmt --check
cargo check --all-features
cargo clippy --all-features -- -D warnings
DATABASE_URL="$DATABASE_URL" cargo test --all-features
```

Confirm the PostgreSQL suite run count is near the documented full-suite count,
not the skipped ~209-test count.

- [ ] **Step 4: Run frontend verification**

Run:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

- [ ] **Step 5: Inspect only owned diffs**

Run `git diff --stat`, `git diff --check`, and targeted searches for new literal
SQL placeholders, `NOW()`, `fetch(`, `console.log`, and diagnostic triggers.
Confirm pre-existing ledger-status changes remain intact and no unrelated dirty
files were staged or reverted.

- [ ] **Step 6: Request correctness review**

Provide the reviewer the approved design, this plan, and the exact owned diff.
Resolve every Critical/Important payment, transaction, migration, or retry finding
before reporting completion.
