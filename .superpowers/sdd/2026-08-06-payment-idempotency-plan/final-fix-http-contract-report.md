# Final HTTP Contract Fix Report

## Scope

Corrected the last payment-idempotency HTTP contract finding on top of
`50c228329a1521f9f7e46149df132bc62b4292f6`. Missing JSON
`idempotency_key` fields now reach the existing domain validator and return the
same HTTP 400 response as blank and over-160-character keys. No route, auth,
permission, frontend, desktop, dependency, payment math, or replay behavior was
changed.

## Implementation

- Added field-level `#[serde(default)]` only to `PaymentRequest`,
  `RecordPaymentRequest`, `CustomerLedgerPaymentRequest`, and
  `CompanyLedgerPaymentRequest`.
- Kept each Rust field as `String`; typed Rust/frontend callers still require a
  key, while a missing JSON field deserializes as an empty string solely so
  `normalized_idempotency_key` can return the established `ApiError::BadRequest`.
- Did not add a global `JsonRejection` mapping. Unrelated malformed JSON retains
  Axum's HTTP 422 extractor behavior.

## PostgreSQL Router Coverage

Added `hotel-app-be/tests/payment_http_contract.rs`. It exercises the production
router with a real PostgreSQL staff user, seeded receptionist RBAC role, persisted
refresh session, and session-bound JWT for all four staff payment creation paths:

- `POST /api/payments/record-payment`
- `POST /api/payments`
- `POST /api/ledgers/{id}/payments`
- `POST /api/ledgers/company-payments`

Each path proves missing, whitespace-only, and 161-byte keys return HTTP 400 with
`{"error":"Idempotency key must be between 1 and 160 characters."}`. Valid keys
reach the normal domain path: the legacy fixture-backed payment returns HTTP 200,
and the other three deliberately absent resources return domain HTTP 404. A
separate malformed non-key body remains HTTP 422.

The legacy success fixture pre-cleans its fixed IDs, serializes within the test
binary, removes the created payment/audit/history/room-event rows before asserting,
and passed twice consecutively by exact name.

## RED / GREEN Evidence

Disposable PostgreSQL 19 container: `hotel-payment-http-contract-20260806`, database
`payment_http_contract`, port `55437`. Fresh baseline and seed were applied; the
shared `hotel-db` container was never accessed.

- RED: the exact record-payment router test returned HTTP 422 with Axum's
  `missing field idempotency_key` rejection instead of the required HTTP 400.
- GREEN: `cargo test --all-features --test payment_http_contract -- --nocapture`
  passed 5/5 tests.
- Repeat-isolation check: the exact legacy route test passed twice consecutively.
- `cargo test --all-features --no-run`: exit 0; all library, binary, and 20
  integration-test executables compiled, including `payment_http_contract`.
- `cargo check --all-features`: exit 0.
- `cargo clippy --all-features -- -D warnings`: exit 0.
- `git diff --cached --check`: exit 0 before commit.

## Independent Review

A fresh read-only scoped reviewer inspected the exact staged diff. Its first
verdict was approve with one Minor test-hardening finding: assertions could have
prevented legacy fixture cleanup after a failure. The test was changed to pre-clean
fixed IDs and perform assertions only after cleanup. The follow-up verdict was
**Approve**, with no findings.

## Commit and Dirty-Worktree Isolation

Implementation commit: `ee93ee07` (`fix(payments): map missing retry keys to bad request`).

Only the two annotations in the already-dirty `models/ledger.rs` were hunk-staged.
The existing stay-date model/mapper/repository/test changes and all analytics,
reporting, frontend, and plan-file changes remained unstaged and were not modified
or committed by this fix.
