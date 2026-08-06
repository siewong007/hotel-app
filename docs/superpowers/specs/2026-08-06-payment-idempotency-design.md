# Payment Idempotency and Concurrency Design

## Goal

Prevent accidental duplicate or over-limit payments for normal bookings and
customer ledgers while preserving legitimate partial and installment payments.
Company payments spanning several ledger entries must commit completely or not
at all.

## Existing behavior to preserve

- A booking or ledger may have several legitimate partial payment rows.
- Payment routes, permission names, response fields, and existing payment
  history remain available.
- Booking, deposit, refund, guest portal, PayPal, and ledger payment types keep
  their current accounting meaning.
- Existing rows remain readable; new columns are nullable for legacy data.

## Chosen approach

Use both serialization and idempotency because neither solves the problem
alone:

1. Lock the parent booking or ledger before reading its balance and writing a
   payment.
2. Require a client-generated idempotency key for staff-created booking and
   ledger payments.
3. Persist the key on the resulting payment row with a scoped unique index.
4. Return the original payment for an exact replay; reject reuse of a key with
   different payment data.
5. Allocate a company payment across ledger entries in one database
   transaction.

A lock-only solution still records a retried partial payment twice. A
one-payment-per-charge constraint would break supported installment payments.

## Database changes

Add nullable `idempotency_key VARCHAR(160)` and
`idempotency_fingerprint VARCHAR(64)` columns to `payments` and
`customer_ledger_payments`. The fingerprint is a canonical SHA-256 digest of
the material request fields and makes replay checks independent of
database-generated timestamps. Add partial unique indexes on
`(booking_id, idempotency_key)` and `(ledger_id, idempotency_key)` when the key
is non-null and non-empty. Nullable columns keep legacy imports and internal
historical rows compatible; the relevant HTTP create endpoints enforce a
non-empty key for new staff payments.

Change ledger receipt uniqueness from global receipt number uniqueness to
`(ledger_id, lower(trim(receipt_number)))`. This prevents the same receipt from
being recorded twice against one charge while allowing one real company receipt
to be allocated across several ledger entries.

Apply schema changes to the V1 baseline and an idempotent live-database patch,
and document both in `database/README.md` as required by the repository's
PostgreSQL contract.

## Booking payment flow

`record_payment` starts a transaction, locks the booking row with `FOR UPDATE`,
then checks for an existing row with the same booking and idempotency key. A
matching fingerprint returns the stored row without changing balances, status, booking
history, loyalty points, or audit state. A mismatched payload returns `409
Conflict`.

If the key is new, the service computes the outstanding billable balance while
the booking remains locked, validates the amount, inserts the payment, and
recomputes booking payment status before committing. This prevents two full
payments from both observing the same unpaid balance.

The older completed-payment endpoint follows the same booking lock and
idempotency rules. Transaction references remain secondary duplicate evidence;
within a locked booking, reusing a non-empty reference for different payment
data is rejected.

Guest bank-transfer and PayPal-order creation move their active-payment check
inside a transaction holding the same booking lock. Payment approval, capture,
and webhook completion also lock the booking before checking for another
completed payment, preventing two pending legacy rows from completing
concurrently.

## Ledger payment flow

The existing ledger `FOR UPDATE` lock remains the serialization point. Before
balance validation or insertion, the repository checks `(ledger_id,
idempotency_key)`. A matching fingerprint returns the original payment;
changed data with the same key returns `409 Conflict`. A new key proceeds through the existing
positive-amount, void-state, receipt, and outstanding-balance checks.

## Atomic company payment allocation

Add one ledger-domain endpoint accepting:

- ordered ledger IDs selected by the user;
- total payment amount;
- payment method, reference, receipt, date, and notes;
- one idempotency key for the whole company payment.

The backend rejects duplicate ledger IDs, loads and locks all selected ledger
rows in sorted ID order to avoid deadlocks, verifies that they belong to the
same company and are payable, and allocates the supplied total in the caller's
original ledger order up to each outstanding balance. Every allocation stores
the fixed-size key `batch:v1:<sha256(normalized raw batch key)>`; it is 73
characters, so it fits `VARCHAR(160)`. The transaction first takes a
PostgreSQL transaction advisory lock for that stored key, then globally
preflights every allocation carrying it. Every persisted row must have the same
canonical fingerprint of the complete ordered batch request. The preflight
therefore catches a reused raw key even when its new ledger membership is
completely disjoint, while the fingerprint detects changed membership, order,
or payment data. All payment rows and parent ledger updates commit in one
transaction. Any validation, insert, or update failure rolls everything back.

An exact retry returns the previously created allocation rows. Reusing the
batch key with different ledgers or payment data returns `409 Conflict`.

The frontend replaces its sequential request loop with this endpoint.

## Frontend behavior

Payment dialogs create an idempotency key when a submission is first prepared.
They retain that key after timeouts or unknown failures so a user retry is safe.
They rotate it only after confirmed success or when the material payment inputs
change. The existing in-flight button disabling remains a usability guard, not
the correctness mechanism.

No new dependency is required; use `crypto.randomUUID()` with the repository's
existing timestamp/random fallback pattern.

## Error handling

- Missing or blank key: `400 Bad Request`.
- Same key and exact stored payment: return the original success response.
- Same key with different payment data: `409 Conflict`.
- Payment exceeds the locked outstanding balance: `400 Bad Request`.
- Batch contains mixed companies, duplicate ledger IDs, void entries, or an
  amount above selected outstanding balance: `400 Bad Request`.
- Database uniqueness remains the final concurrency backstop and is translated
  to an idempotent replay or conflict rather than an opaque database error.

## Testing

PostgreSQL integration tests must prove:

- two concurrent full booking payments cannot both commit;
- an exact booking-payment retry returns one row;
- an idempotency key reused with changed data conflicts;
- a concurrent guest claim/order creates at most one active payment;
- two legacy pending payments cannot both complete;
- an exact ledger partial-payment retry returns one row;
- separate idempotency keys still allow legitimate partial installments;
- company allocation commits every row atomically;
- a forced mid-batch failure leaves no allocation rows or parent updates;
- retrying a completed batch returns the original allocations;
- one receipt may span multiple ledgers but cannot duplicate on one ledger.

Frontend tests verify stable key reuse after an error and one atomic batch API
call instead of a per-ledger loop. Final verification includes focused tests,
the full PostgreSQL-backed backend suite with run-count validation, backend
check/clippy, and frontend typecheck/lint/tests/build.
