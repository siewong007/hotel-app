# Ledger Workflow (reference)

Rewritten 2026-07-12 (13-agent scan, independent verifier confirmed). Line anchors
re-verified by direct grep 2026-07-26 — verify again with
`grep -n "fn <name>" hotel-app-be/src/repositories/ledger.rs` before relying on
them; anchors rot as code moves.

**Architecture** (unlike bookings, the service layer here does nothing):
- `routes/ledgers.rs` — RBAC gate (`require_permission_helper` with `LEDGERS_READ`/`CREATE`/`UPDATE`/`VOID`/`MANAGE` consts) + dispatch to `handlers::ledgers::*`.
- `handlers/ledgers.rs` (134 lines) — thin wrappers, call straight into `services::ledgers`.
- `services/ledgers.rs` — sanitizes free-text input and threads `user_id` for audit logging (added 2026-07-12), then delegates into `repositories::ledger as repo`; domain logic still lives in the repository layer (contrast `services/bookings.rs`, which holds permission/ownership logic — see `booking-workflow.md`).

**Routes** (`hotel-app-be/src/routes/ledgers.rs`) — `ledgers:read` for list/detail/summary/payment reads, `ledgers:create` for ledger/payment creation, `ledgers:update` for edits/payment-date changes, `ledgers:void` for both void AND reversal endpoints, `ledgers:manage` for destructive deletes. `ledgers:manage` implies all ledger actions (RBAC convention repo-wide).

**Data model** (`models/ledger.rs`):
- `customer_ledgers` — company info, `description`, `expense_type`, `amount`, `paid_amount`, `balance_due` (DB-derived), `status` ∈ {pending, partial, paid, overdue, cancelled}, `due_date`, `invoice_number`, optional `booking_id`/`guest_id`, accounting fields (`folio_type`, `transaction_type`, `post_type`, `is_reversal`, `original_transaction_id`, `void_at/by/reason`).
- `customer_ledger_payments` — running payment history per ledger.


- **`create_customer_ledger`** (ledger.rs:318) — resolves `due_date`: caller's value → else the named company's `payment_terms_days` (looked up by `company_name`) → else `default_payment_terms_days` (settings-cache helper, ledger.rs:34). Allocates `invoice_number` via `services::invoice_numbers::next_invoice_number`, inserts with hardcoded status `'pending'` and `paid_amount=0`.
- **`create_ledger_payment`** (ledger.rs:726) — validates positive amount + non-cancelled ledger, inserts payment row, recomputes `paid_amount` and status: `new_total_paid ≥ total_amount` → `paid`, `> 0` → `partial`, else `pending` (ledger.rs:794).
- **`update_ledger_payment`** (ledger.rs:1079) — always applies `payment_date`; `payment_amount`/`payment_method`/`payment_reference`/`notes` applied only when provided; re-syncs ledger's `paid_amount`/`status`/`payment_date` from the resulting payment set.
- **`void_ledger`** (ledger.rs:931) — refuses if `void_at`/voided flag is already set (ledger.rs:947: `"Ledger is already voided"`); stamps void fields + status `cancelled`.
- **`create_ledger_reversal`** (ledger.rs:980) — refuses to reverse a reversal (`original.is_reversal` check, ledger.rs:996); inserts a sibling row with opposite `transaction_type` (debit↔credit, ledger.rs:1003), `original_transaction_id` back-pointer, description prefixed `"REVERSAL: "` (ledger.rs:1045), status hardcoded `'paid'`.

**Booking → Ledger integration**: When a booking with company billing transitions to `checked_out`/`completed`, `repositories/bookings/lifecycle.rs`'s `auto_post_company_ledger` (lifecycle.rs:530) inserts a `room_charge` row with `folio_type='city_ledger'`, `transaction_type='debit'` — see `booking-workflow.md` for the full call chain and idempotency mechanism (pre-check + unique-index backstop, not application-level locking). Subsequent booking-total edits propagate as a *delta* to that ledger row's `amount` (lifecycle.rs:1829-1850) — preserving extras, restricted to `pending`/`partial` `room_charge` rows.


**Frontend**: `hotel-web-fe/src/api/ledger.service.ts` (`LedgerService`) wraps endpoints; `features/admin/hooks/useLedgers.ts` exports two hooks — `useLedgers()` (non-paginated, used by `CustomerLedgerPage.tsx`) and `useLedgersPage()` (paginated, `placeholderData: keepPreviousData`). The older `useLedgerData.ts` non-paginated variant referenced by a prior version of this doc no longer exists in the tree — `useLedgers` is now the only hook `CustomerLedgerPage.tsx` (2265 lines) imports.
