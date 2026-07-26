# Backend Ledger / City-Ledger / Invoicing — Layering Audit

Scope: `routes/ledgers.rs`, `handlers/ledgers.rs`, `services/ledgers.rs`,
`repositories/ledger.rs`, `models/ledger.rs`, ledger-touching parts of
`repositories/analytics.rs`, `services/companies.rs`, `auto_post_company_ledger`
in `repositories/bookings/lifecycle.rs`. All line numbers below were obtained by
Grep/Read in this session (paths are relative to `hotel-app-be/`).

## 1. Function inventory — `src/repositories/ledger.rs` (1282 lines)

Private helper: `default_payment_terms_days` (line 34-36) — thin wrapper over
`settings_cache::get_positive_i32`.

| Group | Fn | Lines | Responsibility |
|---|---|---|---|
| List/filter predicates | `invoice_state_clause` | 57-63 | builds `AND(...)` fragment for uninvoiced/invoiced |
| | `balance_state_clause` | 73-79 | builds fragment for outstanding/clear |
| | `ui_status_clause` | 82-93 | builds fragment for the 7 UI badge states (balance-first, not raw `status`) |
| | `list_customer_ledgers` | 146-270 | paginated list, dynamic WHERE/ORDER BY, binds all filters |
| Ledger CRUD | `get_customer_ledger` | 273-287 | fetch by id |
| | `get_customer_ledger_with_payments` | 290-315 | fetch + join payment history |
| | `create_customer_ledger` | 318-476 | resolve due_date (caller → company terms → global default), dedupe-by-content check for booking_id, insert `status='pending'`/`paid_amount=0` |
| | `update_customer_ledger` | 479-674 | dynamic SET-clause builder over ~18 optional fields incl. raw `status` and `amount` |
| | `delete_customer_ledger` | 677-727 | blocks delete if `status='paid'` or `paid_amount>0` |
| Payments & allocation | `create_ledger_payment` | 730-865 | validates amount/voided/overpayment/dup receipt, inserts payment row, then a **separate** UPDATE recomputing `paid_amount`/`status` |
| | `get_ledger_payments` | 868-893 | list payments for a ledger |
| | `update_ledger_payment` | 1083-1209 | edits one payment, then 2 more SELECTs + 1 UPDATE to resync the ledger |
| | `delete_ledger_payment` | 1212-1282 | deletes one payment, then 2 SELECTs + 1 UPDATE to resync the ledger |
| Summary | `get_ledger_summary` | 896-932 | global totals/counts, `WHERE status NOT IN ('void')` |
| Void & reversal | `void_ledger` | 935-981 | refuses if already voided; sets `void_at/void_by/void_reason/status='void'` |
| | `create_ledger_reversal` | 984-1077 | refuses to reverse a reversal; **inserts a new row**, never touches the original |

13 `pub async fn` + 3 `pub fn` (SQL-fragment builders) + 1 private helper = 17
items total, matching the earlier `grep -n "^pub .*fn"` count of 16 `pub` items.

## 2. `services/ledgers.rs` (286 lines) — quantified contribution

All 13 functions map 1:1 to the 13 repository functions above. Breakdown:

- **5 of 13 (38%) are pure 1-line passthroughs**, zero added value: `list_customer_ledgers` (10-15), `get_customer_ledger` (17-22), `get_customer_ledger_with_payments` (24-29), `get_ledger_payments` (175-180), `get_ledger_summary` (182-184).
- **6 of 13 (46%) are audit-log-only wrappers**: `delete_customer_ledger` (124-145), `create_ledger_payment` (147-173), `void_ledger` (186-209), `create_ledger_reversal` (211-237), `update_ledger_payment` (239-262), `delete_ledger_payment` (264-286) — call the repo fn, then `AuditLog::log_event` (fire-and-forget, see §7), return.
- **2 of 13 (15%) add real logic**: `create_customer_ledger` (31-73) and `update_customer_ledger` (75-122) sanitize 6 free-text fields each via `Sanitizer` before calling the repo, then audit-log.

No function in this file threads permission/ownership checks (unlike
`services/bookings.rs`) — RBAC is entirely route-level in `routes/ledgers.rs`.
`handlers/ledgers.rs` (134 lines, 13 fns) is 100% mechanical: every handler is a
1-3 line `Json(svc::fn(...).await?)` wrapper with no branching.

## 3. `customer_ledgers.balance_due` — DB-derived, confirmed

`database/postgres/migrations/0001_v1_baseline.sql:2053`:
```
balance_due numeric(10,2) GENERATED ALWAYS AS ((amount - paid_amount)),
```
It is a virtual generated column — no code anywhere writes it directly (a write
would be rejected by Postgres). `valid_paid_amount` CHECK (line 2056) enforces
`0 <= paid_amount <= amount` at the DB level; `valid_status` CHECK (line 2058)
restricts `status` to `pending|partial|paid|overdue|void` — note `draft` and
`ready_to_invoice`, two of the seven UI badge states in `ui_status_clause`
(line 82-93), are **never** real `status` values — they are purely
balance-derived UI labels.

### Every write site for `status` / `amount` / `paid_amount`

| Path | File:line | Sets | Recomputes correctly? |
|---|---|---|---|
| Create | ledger.rs:426 (INSERT) | `status='pending'`, `paid_amount=0` (hardcoded) | n/a |
| Generic update | ledger.rs:555-558 (`status`), :547-550 (`amount`) | caller-supplied `status` (any string, DB-CHECK-limited) and/or `amount` | **No** — does not recompute `status` when `amount` changes (see §6) |
| Record payment | ledger.rs:842-850 | `paid_amount=new_total_paid`, `status` derived (paid/partial/pending) | Yes, but as a **separate UPDATE** from the payment INSERT (no transaction, see §7) |
| Edit payment | ledger.rs:1191-1199 | `paid_amount`, `status` recomputed from `SUM(payment_amount)` | Yes, but across 5 unbatched statements, no transaction; does **not** set `updated_by` |
| Delete payment | ledger.rs:1261-1269 | `paid_amount`, `status` recomputed | Same as above; no `updated_by` |
| Void | ledger.rs:957-964 | `status='void'`, `void_at/by/reason` | Sets status via dedicated path |
| Reversal | ledger.rs:1017-1032 | New row only: `status='paid'` (hardcoded), `paid_amount=amount` (i.e. reversal is always "fully paid") | Original row's `status`/`amount`/`paid_amount` **untouched** |
| Booking checkout auto-post | lifecycle.rs:630-646 (INSERT) | `status` defaults to column default `'pending'`, `paid_amount` defaults to `0.00` | n/a |
| Booking edit delta-sync | lifecycle.rs:1846-1853 | `amount = amount + delta`, guarded to `status IN ('pending','partial')` | Silently **skips** `paid`/`overdue`/`void` rows (see §5) |

## 4. Void & reversal semantics

- `void_ledger` (ledger.rs:935-981) only refuses when `void_at` is already set
  (line 943-952). **It does not check `paid_amount > 0`** — a ledger that has
  already collected partial or full payment can be voided with no reversal of
  the collected money and no block, unlike `delete_customer_ledger` which
  explicitly refuses when `paid_amount > 0` ("Mark it as voided instead.",
  ledger.rs:698-703). After voiding, `get_ledger_summary` (ledger.rs:908,
  `WHERE status NOT IN ('void')`) and `generate_company_ledger_statement`
  (analytics.rs:2240, 2321, same filter) **exclude the voided row entirely**
  from all aggregate reporting — so any `paid_amount` already collected on a
  now-voided ledger simply disappears from every total the app shows. This is a
  business-policy gap (see Finding L-1), not something code should silently
  decide.
- `create_ledger_reversal` (ledger.rs:984-1077) inserts a **new** row with
  opposite `transaction_type`, `is_reversal=TRUE`, `original_transaction_id`
  back-pointer, `status` hardcoded to `'paid'`, `paid_amount = amount` (i.e. the
  reversal itself is booked as fully settled). **It never updates the original
  ledger row** — the original keeps its own `status`/`amount`/`paid_amount`
  exactly as it was. So after a reversal, both the original debit and the
  reversal credit are live, non-void rows.
- `get_ledger_summary` (ledger.rs:896-909) computes `SUM(amount)`,
  `SUM(paid_amount)`, `SUM(balance_due)` with **no sign/netting by
  `transaction_type`**. Since a reversal's `amount` equals the original's
  `amount` and both rows pass the `status NOT IN ('void')` filter, a reversed
  entry **inflates** `total_amount` and `total_paid` by the reversed amount
  instead of netting it to zero (only `total_outstanding` is unaffected,
  because the reversal's own `balance_due` is 0). See Finding L-2.

## 5. Booking → ledger auto-posting

- **Idempotency**: two layers. App-level pre-check
  (`SELECT EXISTS(...) WHERE booking_id=$1 AND post_type='room_charge' AND
  is_reversal=false`, lifecycle.rs:553-561, `.unwrap_or(false)` on error) plus a
  DB-level backstop: `uq_customer_ledgers_booking_room_charge` — a **partial
  unique index** on `booking_id` `WHERE post_type='room_charge' AND
  is_reversal=false AND booking_id IS NOT NULL`
  (`0001_v1_baseline.sql:7678`). The unique index is the real guarantee against
  a concurrent double-post race; the pre-check is an optimization to avoid
  hitting it.
- **Failure mode**: the checkout call site (lifecycle.rs:1794-1804) treats a
  failed `auto_post_company_ledger` as fire-and-forget —
  `log::warn!` only, checkout still succeeds. There is no retry/reconciliation
  job. If the INSERT fails for any transient reason, the company is simply
  never billed for that stay and nothing downstream is aware.
- **Delta-sync on booking edit** (lifecycle.rs:1832-1875): applies `amount =
  amount + delta` guarded by `status IN ('pending','partial') AND post_type =
  'room_charge' AND amount+delta > 0 AND amount+delta >= paid_amount`. Rows
  that are `paid`, `overdue`, or `void` are **silently skipped** — `Ok(_) =>
  {}` at line 1867 does not distinguish "no ledger row exists" from
  "ledger row exists but is paid/overdue, so the delta was dropped". If a
  company-billed booking's total is increased *after* its ledger row is marked
  paid, the increase is never posted anywhere.
- **Booking voided after posting**: `services::bookings::void_booking`
  (bookings.rs:140-229) runs a real transaction
  (`void_booking_tx`/`release_room_tx`/`void_booking_payments_tx`/
  `restore_complimentary_credits_tx`/`recompute_payment_status_tx`, all inside
  one `tx`) but **never references `customer_ledgers` at all**. This is
  independently confirmed by `tests/ledger_service.rs:25-36`, which has a test
  named `postgres_void_booking_leaves_auto_posted_ledger_row_untouched` with a
  doc comment explicitly calling this out as "CURRENT behavior... not an
  assertion of intended policy" and flagging it as a known product gap. This
  audit corroborates that finding independently (see Finding L-1).

## 6. Wrong-layer code and duplication (verified, not assumed)

- **`generate_company_ledger_statement`** (analytics.rs:2228-2459, 231 lines)
  is 100% `customer_ledgers`/`customer_ledger_payments` domain logic (per-company
  AR statement, aging buckets 31-60/61-90/91-120/120+, its own
  `status NOT IN ('void')` filtering) living inside
  `repositories/analytics.rs` instead of the ledger domain. It is dispatched
  from a `match params.report_type.as_str()` block at analytics.rs:565-589
  (`"company_ledger_statement" => generate_company_ledger_statement(...)`).
  This repo already has the right precedent for factoring exactly this kind of
  thing out: `channel_net_revenue.rs` (`src/repositories/channel_net_revenue.rs`,
  1142 lines) is dispatched from the same `match` block
  (analytics.rs:594-597, `crate::repositories::channel_net_revenue::generate(...)`)
  but lives in its own file. `generate_company_ledger_statement` should follow
  that precedent, not stay inline.
- **Permission mismatch from the duplication**: `/reports/generate` (the only
  caller of `generate_company_ledger_statement`) is gated by
  `analytics:read` OR `reports:execute`
  (`routes/analytics.rs:72`, `require_any_permission_helper`), while every
  other read of `customer_ledgers` goes through `routes/ledgers.rs`'s
  `ledgers:read` gate (`routes/ledgers.rs:18,53,70,79,107,116`). A user with
  generic analytics/report access but **no** `ledgers:read` permission can pull
  a full per-company AR statement (contact info, invoice numbers, aging
  balances) that the ledger-specific RBAC model was designed to gate. Verified
  by reading both route files directly.
- **Duplicated business rule**: the "resolve a company's payment-terms days for
  a due_date, falling back to `default_payment_terms_days`" rule is implemented
  twice, independently, with the identical SQL string
  `"SELECT payment_terms_days FROM companies WHERE company_name = $1 LIMIT 1"`:
  once in `repositories/ledger.rs:347-356` (inside `create_customer_ledger`)
  and once in `repositories/bookings/lifecycle.rs:594-604` (inside
  `auto_post_company_ledger`). `repositories/company.rs` — the natural home for
  a `get_payment_terms_days(pool, company_name)` helper — has no such function;
  it only has CRUD (`repositories/company.rs:23,48,113,170`).

## 7. Additional accountability findings (not explicitly asked for, but load-bearing)

- **No explicit transactions on multi-statement ledger mutations.** CLAUDE.md's
  CONTRIBUTING.md conventions say "Transactions for multi-step mutations", and
  `services/audit.rs` even exposes a transaction-aware `log_event_tx`
  (audit.rs:50-57) for exactly this purpose — but nothing in the ledger domain
  uses `pool.begin()`. `create_ledger_payment` (ledger.rs:814-862) does an
  INSERT into `customer_ledger_payments` then a **separate** UPDATE of
  `customer_ledgers` as two independent pooled connections; `update_ledger_payment`
  and `delete_ledger_payment` each run 4-5 unbatched statements. If the process
  crashes or a connection is lost between the payment write and the ledger
  resync, a payment can exist with the ledger's `paid_amount`/`status` never
  updated to reflect it (or vice versa for the delete path).
- **`update_ledger_payment`/`delete_ledger_payment` never set `updated_by`** on
  the ledger row they resync (ledger.rs:1191-1199, 1261-1269) — contrast
  `create_ledger_payment`, which does set `updated_by=$6` (ledger.rs:849).
  `update_ledger_payment`'s repository signature (ledger.rs:1083-1088) doesn't
  even accept a `user_id` parameter; the service layer's `user_id` is used only
  for the audit-log call (services/ledgers.rs:239-262), never reaching the row
  itself.
- **`update_customer_ledger` (PATCH `/ledgers/{id}`, gated only by
  `ledgers:update`) can set `status='void'` directly**, bypassing the dedicated
  `ledgers:void`-gated `/ledgers/{id}/void` endpoint entirely: `status:
  Option<String>` (models/ledger.rs:121) has no application-level allow-list,
  so a caller with `ledgers:update` (not `ledgers:void`) can PATCH
  `{"status": "void"}` and the DB `valid_status` CHECK will accept it — but
  `void_at`, `void_by`, and `void_reason` are **not** set by this path, so the
  ledger ends up "voided" by the `status` column (matching
  `ui_status_clause`'s `status = 'void'` branch, ledger.rs:85) with none of
  the audit fields the dedicated void endpoint populates.
- **`services/companies.rs::update_company`/`delete_company` never receive a
  `user_id`** (companies.rs:53-88, 90-110) — both audit-log calls hard-code
  `user_id: None` (companies.rs:77, 99). The route layer actually discards the
  user id `require_permission_helper` already returns:
  `routes/companies.rs:64` and `:73` call
  `require_permission_helper(...).await?;` without capturing the return value
  (contrast `routes/companies.rs:54`, `create_company`, which does
  `let user_id = require_permission_helper(...)`). Since a company's
  `payment_terms_days` directly drives ledger `due_date` calculation (§6), an
  unattributed edit to that field is a real gap adjacent to the ledger domain.

## 8. Test coverage

`tests/ledger_service.rs` (899 lines, 4 live-Postgres tests) covers: checkout
auto-post + delta-sync (Scenarios 1+4), void-booking-leaves-ledger-untouched
(Scenario 3, documents the gap in §5), payment recording with exact Decimal
math (Scenario 2+5), and company CRUD (Scenario 6). Confirmed by
`grep -rn "void_ledger\|create_ledger_reversal\|update_ledger_payment\|delete_ledger_payment\|update_customer_ledger\|delete_customer_ledger" tests/` — **zero
hits** for actual calls to any of `void_ledger`, `create_ledger_reversal`,
`update_ledger_payment`, `delete_ledger_payment`, `update_customer_ledger`, or
`delete_customer_ledger`. These are exactly the money-mutating paths flagged
above (status-bypass, no-transaction, missing `updated_by`, reversal-not-netted)
and none of them has a single test.

## 9. Decomposition target

House pattern reference sizes: `modules/communications/repository.rs` = 1180
lines, `modules/support/service.rs` = 1088 lines — both larger than a naive
split would produce here, and `repositories/ledger.rs` (1282) is only modestly
above the biggest existing single-file repository. **The rework is primarily a
move + one extraction, not a line-count-driven split:**

- `modules/ledger/routes.rs` ← `routes/ledgers.rs` (unchanged content)
- `modules/ledger/handlers.rs` ← `handlers/ledgers.rs` (unchanged, still purely mechanical)
- `modules/ledger/service.rs` ← `services/ledgers.rs` — while moving, decide (policy, not code) how to close the `status='void'` bypass (§7) and whether payment edits should thread `user_id` into `updated_by`
- `modules/ledger/repository.rs` ← `repositories/ledger.rs`, kept as one file (matches house norm); internally it already groups cleanly into the 5 sections in §1 and could get `// ---- section ----` banners like the existing filter-predicate block already has
- `modules/ledger/models.rs` ← `models/ledger.rs` (pure DTOs, no changes needed)
- **New**: extract `generate_company_ledger_statement` out of `repositories/analytics.rs` into `modules/ledger/repository.rs` (or a `modules/ledger/statement.rs` sibling, mirroring `channel_net_revenue.rs`'s precedent), called from `analytics.rs`'s dispatcher exactly as `channel_net_revenue::generate` already is
- The company payment-terms lookup (§6) is a good candidate for a shared
  `repositories/company.rs::get_payment_terms_days` used by both
  `modules/ledger/repository.rs` and `repositories/bookings/lifecycle.rs`
