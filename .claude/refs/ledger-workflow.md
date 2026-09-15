# Ledger Workflow (reference)

Rewritten 2026-09-15 against `origin/master` (`923c12bfd`). Every anchor below was
produced by `grep -n "fn <name>" hotel-app-be/src/repositories/ledger.rs` on that
commit — re-verify before relying on one. The previous version (2026-07-12, anchors
"re-verified" 2026-07-26) had drifted by up to +809 lines on four of five anchors.

**Architecture** — unlike bookings, the service layer here holds no domain logic:

- `routes/ledgers.rs` — RBAC gate (`require_permission_helper` with `LEDGERS_READ`/`CREATE`/`UPDATE`/`VOID`/`MANAGE` consts) + dispatch to `handlers::ledgers::*`.
- `handlers/ledgers.rs` (144 lines) — thin wrappers into `services::ledgers`.
- `services/ledgers.rs` (368 lines) — sanitizes free text and threads `user_id` for audit logging, then delegates to `repositories::ledger as repo`. Domain logic stays in the repository (contrast `services/bookings.rs`, which does own permission/ownership logic — see `booking-workflow.md`).
- `repositories/ledger.rs` (2076 lines).

**Routes** — `ledgers:read` for list/detail/summary/payment reads, `ledgers:create`
for ledger/payment creation, `ledgers:update` for edits and payment-date changes,
`ledgers:void` for both void AND reversal endpoints, `ledgers:manage` for
destructive deletes. `ledgers:manage` implies all ledger actions (repo-wide RBAC
convention).

**Data model** (`models/ledger.rs`):

- `customer_ledgers` — company info, `description`, `expense_type`, `amount`, `paid_amount`, `balance_due` (DB-derived), `status` ∈ {pending, partial, paid, overdue, void} (the `valid_status` CHECK allows `void`, **not** `cancelled`), `due_date`, `invoice_number`, optional `booking_id`/`guest_id`, accounting fields (`folio_type`, `transaction_type`, `post_type`, `is_reversal`, `original_transaction_id`, `void_at/by/reason`).
- `customer_ledger_payments` — running payment history per ledger.

Key functions (`repositories/ledger.rs`):

- **`list_customer_ledgers`** (:147), **`get_customer_ledger`** (:274), **`get_customer_ledger_with_payments`** (:291).
- **`create_customer_ledger`** (:319) — resolves `due_date`: caller's value → else the named company's `payment_terms_days` (looked up by `company_name`) → else `default_payment_terms_days` (:40 — `settings_cache::get_positive_i32(pool, "default_payment_terms_days", 30)`, so the final fallback is 30 days). Allocates `invoice_number` via `services::invoice_numbers::next_invoice_number`, inserts with hardcoded status `'pending'` and `paid_amount = 0`.
- **`update_customer_ledger`** (:513), **`delete_customer_ledger`** (:854).
- **`create_ledger_payment`** (:1352) — validates a positive amount against a non-voided ledger, inserts the payment row, then recomputes `paid_amount` and status: `new_total_paid ≥ total_amount` → `paid`, `> 0` → `partial`, else `pending`. The `_with_outcome` variant (:1324) is the `pub(crate)` core both callers share.
- **`create_company_ledger_payment`** (:1607) — company-wide allocation across entries in one transaction (`_with_outcome` core at :1454).
- **`get_ledger_payments`** (:1620), **`get_ledger_summary`** (:1648).
- **`void_ledger`** (:1687) — refuses if already voided; stamps void fields + status `void`.
- **`create_ledger_reversal`** (:1763) — refuses to reverse a reversal (`original.is_reversal` check); inserts a sibling row with opposite `transaction_type` (debit↔credit), an `original_transaction_id` back-pointer, description prefixed `"REVERSAL: "`, status hardcoded `'paid'`.
- **`update_ledger_payment`** (:1888) — always applies `payment_date`; `payment_amount`/`payment_method`/`payment_reference`/`notes` only when provided; re-syncs the ledger's `paid_amount`/`status`/`payment_date` from the resulting payment set.
- **`delete_ledger_payment`** (:2009).

**Booking → Ledger integration**: when a company-billed booking transitions to
`checked_out`/`completed`, `repositories/bookings/lifecycle.rs`'s
**`auto_post_company_ledger`** (lifecycle.rs:549) inserts a `room_charge` row with
`folio_type='city_ledger'`, `transaction_type='debit'` — see `booking-workflow.md`
for the call chain and idempotency mechanism (pre-check at lifecycle.rs:569 plus a
unique-index backstop, not application-level locking). Later booking-total edits
propagate as a *delta* to that ledger row's `amount` (lifecycle.rs:1649),
restricted to `pending`/`partial` `room_charge` rows so user-added extras survive.
Voiding a booking voids its open **unpaid** ledger rows in the same transaction
(`void_booking_ledgers_tx`, lifecycle.rs:2459); rows with `paid_amount > 0` stay
open for reconciliation.

> `customer_ledgers.net_amount` is written by `public.generate_folio_number()`, wired
> as `trigger_generate_folio_number BEFORE INSERT ON public.customer_ledgers` (baseline
> :8324) and guarded on `IF NEW.net_amount IS NULL`. It does **not** recompute on
> UPDATE, so any amount edit must set `net_amount` explicitly or it silently desyncs.

**Frontend**: `src/api/ledger.service.ts` (`LedgerService`) wraps the endpoints;
`features/admin/hooks/useLedgers.ts` exports `useLedgers()` (non-paginated, used by
`CustomerLedgerPage.tsx`) and `useLedgersPage()` (paginated,
`placeholderData: keepPreviousData`). The page is
`features/admin/components/CustomerLedger/CustomerLedgerPage.tsx` (2162 lines).
Note the split: `features/customer-ledger/` holds only `api.ts`, `types.ts`,
`constants.ts` and its barrel — the page itself lives under `features/admin/`.
