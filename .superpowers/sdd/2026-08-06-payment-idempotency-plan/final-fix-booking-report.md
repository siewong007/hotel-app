# Final Corrective Report — Booking Payment Transactions

## Scope

Corrected the final booking-payment review findings on top of `1077c467a`: update/delete serialization, transaction-reference replay validation, approval/rejection lock order, and atomic legacy completed-payment recomputation. Public routes, HTTP methods, handler response JSON, ledger code, frontend code, and desktop code were not changed.

## Implementation

- Update and delete now resolve the parent booking, begin one transaction, lock the booking, lock/refetch the payment, validate and mutate it, recompute the booking payment status, and commit atomically. Updating a completed booking payment cannot make collected booking money exceed the billable total.
- Booking-payment creates, updates, deletes, approvals, and rejections use booking-before-payment lock order. Rejection now revalidates the locked payment after acquiring the booking lock, matching approval/capture ordering.
- Non-empty transaction references take transaction-scoped advisory locks before lookup, covering the absent-row race across different bookings. Updates lock old and proposed references in deterministic order before locking/refetching the payment, reject another owner, and atomically refresh the canonical fingerprint. The stored fingerprint must match exactly; a changed amount, method, type, reference, notes, requested date, another booking, or a legacy/null fingerprint returns `ApiError::Conflict`.
- The older `create_payment` path now owns the transaction around booking lock, exact replay lookup, insert, booking payment-status recomputation, and commit. A replay commits only its read transaction and exits before notification, loyalty, and audit side effects.
- Update keeps its existing `PaymentEntryRow::into_response()` body. Delete keeps `{ success, message, deleted_id }`; its audit continues to contain the affected booking ID.

## RED evidence

Against disposable PostgreSQL container `codex-payment-final-fix` (the existing `hotel-db` was not used):

- The transaction-reference tests all failed: changed material replayed the original row, another booking replayed it, and a null legacy fingerprint replayed it.
- The forced legacy recompute failure left one committed payment row, proving insert and recompute were separate; retry would encounter the stale replay row.
- In the advisory-gated create/update race, both operations succeeded and the completed total reached RM400 on a RM300 booking.
- In the advisory-gated create/delete race, the booking ended `confirmed` with only RM200 collected against RM300.
- In the advisory-gated approve/reject race, PostgreSQL returned `deadlock detected` because rejection held payment then waited for booking while approval held booking then waited for payment.

## GREEN and verification evidence

- `DATABASE_URL=... cargo test --test payment_characterization -- --nocapture`: 22 passed, 3 pre-existing ignored, 0 failed.
- Create/update final state: update succeeded, the create re-read RM100 outstanding and returned `BadRequest`; completed total RM200, booking `pending`, payment status `partial`.
- Create/delete final state: both valid serialized operations succeeded; completed total RM200, booking `pending`, payment status `partial`.
- Approve/reject: no database deadlock, exactly one terminal transition and one terminal audit; the loser returned the normal stale-state error.
- Forced recompute failure left zero payment rows; retry of the same request inserted one row and recomputed the booking to `paid`.
- Exact transaction-reference replay returned the original row. Changed canonical material, another booking, and a null fingerprint all returned conflict.
- A fully settling payment replayed under a new key before the zero-balance guard. Deterministic reference races produced one owner in all three cases: create/create, update/create, and update/update.
- Updating keyed payment material refreshed its fingerprint atomically: the old payload conflicted and the new material replayed.
- `cargo test --tests --no-run`: all backend integration targets compiled.
- `cargo check --all-features`: passed.
- `cargo clippy --all-features --all-targets -- -D warnings`: passed.
- The disposable database had zero remaining `payment_characterization_*` triggers/functions after the focused suite.

## Files and commit

- `hotel-app-be/src/repositories/payment.rs`
- `hotel-app-be/src/services/payments.rs`
- `hotel-app-be/tests/payment_characterization.rs`
- Implementation commit: `0f0e555598a2b8d518e5851c59cc3d09b6461e6f` (`fix(payments): serialize booking payment mutations`)
- Review-fix commit: `28d6bc5678b14369ff8aa52c837a35f692018fba` (`fix(payments): serialize reference ownership`)

## Fresh review

- The first read-only review of `1077c467a..f33522c0` found that updates could bypass global reference ownership, full-settlement reference replay occurred after balance validation, concurrent reference claims lacked coverage, and the rollback test disabled a production trigger.
- The follow-up commit centralizes advisory ownership across record/create/update, refreshes update fingerprints, moves replay/conflict before balance validation, adds three deterministic reference-claim races, and forces recompute failure without disabling the production trigger.

## Preserved work and known exclusions

- Unrelated dirty ledger, analytics, reporting, and frontend files were neither edited nor staged.
- The three pre-existing ignored payment characterization defects remain outside this corrective scope: legacy total calculation, gateway verification during manual approval, and deposit-refund bounds.
