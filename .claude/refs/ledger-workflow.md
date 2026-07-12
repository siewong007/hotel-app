# Ledger Workflow (reference)

Extracted from CLAUDE.md on 2026-07-05. Line anchors were valid then — verify with
Grep before relying on them (`grep -n "fn <name>" hotel-app-be/src/handlers/ledgers.rs`).

**Routes** (`hotel-app-be/src/routes/ledgers.rs`) — gated by ledger-specific RBAC permissions: `ledgers:read` for list/detail/summary/payment reads, `ledgers:create` for ledger/payment creation, `ledgers:update` for edits/payment-date changes, `ledgers:void` for voids/reversals, and `ledgers:manage` for destructive deletes. As with other RBAC resources, `ledgers:manage` implies all ledger actions.

**Data model** (`models/ledger.rs`):
- `customer_ledgers` — company info, `description`, `expense_type`, `amount`, `paid_amount`, `balance_due` (DB-derived), `status` ∈ {pending, partial, paid, overdue, cancelled}, `due_date`, `invoice_number`, optional `booking_id`/`guest_id`, accounting fields (`folio_type`, `transaction_type`, `post_type`, `is_reversal`, `original_transaction_id`, `void_at/by/reason`).
- `customer_ledger_payments` — running payment history per ledger.

Key handlers in `handlers/ledgers.rs`:

- **`create_customer_ledger_handler`** (ledgers.rs:479) — resolves `due_date` (caller → company `payment_terms_days` → 30-day fallback from posting date/today), allocates next `invoice_number` via `services::invoice_numbers::next_invoice_number`, inserts with status `pending`.
- **`create_ledger_payment_handler`** (ledgers.rs:1188) — validates positive amount + non-cancelled ledger, inserts payment row, updates ledger's `paid_amount` + `payment_method`/`payment_reference`, recomputes status: `paid_amount ≥ amount` → `paid`, > 0 → `partial`, else `pending`.
- **`update_ledger_payment_handler`** (ledgers.rs:1801) — patches payment date and re-syncs ledger's `payment_date` to `MAX(payments.payment_date)`.
- **`void_ledger_handler`** (ledgers.rs:1479) — stamps `void_at/by/reason` + status `cancelled`. Refuses if already voided.
- **`create_ledger_reversal_handler`** (ledgers.rs:1640) — inserts a sibling row with `is_reversal=TRUE`, `original_transaction_id` back-pointer, opposite `transaction_type` (debit↔credit), description prefixed `REVERSAL:`, status `paid`. Refuses to reverse a reversal.

**Booking → Ledger integration**: When a company-billed booking transitions to `checked_out`/`completed`, the backend calls `auto_post_company_ledger` to insert a `room_charge` row with `folio_type='city_ledger'`, `transaction_type='debit'`, `due_date = today + payment_terms_days`. Subsequent edits to the booking total propagate as a *delta* to that ledger row's `amount` (bookings.rs:1531) — preserving extras, skipping cancelled/over-paid rows.

**The backend is the sole authority for company ledger rows**: company room charges are created only by `auto_post_company_ledger` on the `checked_out`/`completed` transition. The frontend (`CustomerLedgerPage.handleConfirmCompanyCheckout`) just submits the checkout (`updateBooking({status:'checked_out'})`) and renders the result — it does **not** compute amounts, allocate invoice numbers, or insert ledger rows. Duplicate/concurrent postings are made impossible by the partial unique index `uq_customer_ledgers_booking_room_charge` (PostgreSQL: `database/schema.sql`; SQLite: `database/sqlite_schema.sql` section 5), not by an application-level check.

**Frontend**: `hotel-web-fe/src/api/ledger.service.ts` wraps endpoints; `features/admin/hooks/useLedgers.ts` mirrors `useBookings` (server pagination, debounced search, request-id guard); `features/admin/hooks/useLedgerData.ts` is the older non-paginated variant — `CustomerLedgerPage.tsx` uses `useLedgers`.
