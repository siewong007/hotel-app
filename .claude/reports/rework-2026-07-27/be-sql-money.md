# Backend SQL correctness / money typing / query efficiency audit
Domain: booking + payment + ledger backend code (hotel-app-be)
Date: 2026-07-27

## Scope swept

Files (all verified with `wc -l` before reading; all reads used Grep + offset/limit,
no file read whole):
- `src/repositories/bookings/lifecycle.rs` (3492 lines)
- `src/repositories/payment.rs` (1426 lines)
- `src/repositories/ledger.rs` (1282 lines)
- `src/repositories/bookings/complimentary.rs` (622 lines)
- `src/repositories/bookings/credits.rs` (608 lines)
- `src/repositories/booking_list.rs`, `src/repositories/booking.rs`, `src/repositories/bookings_queries.rs`
- `src/services/payments.rs` (2011 lines), `src/services/bookings.rs`, `src/services/ledgers.rs`
- `src/models/booking.rs`, `src/models/payment.rs`, `src/models/ledger.rs`, `src/models/row_mappers.rs`
- DDL: `database/postgres/migrations/0001_v1_baseline.sql` (9619 lines; grepped for
  `CREATE TABLE public.bookings/payments/customer_ledgers/customer_ledger_payments/invoices/payment_receipt_requests`)

## Sweep 1 — Bind / placeholder audit

Method: a Python script (`bind_audit2.py`, kept in scratchpad) matched every
`sqlx::query`/`query_as`/`query_scalar` call in the 5 core repository files,
extracted the immediate string/raw-string literal query text where present,
counted the highest `$N` placeholder, and counted `.bind()` calls before the
next `.execute(`/`.fetch_one(`/`.fetch_all(`/`.fetch_optional(`/`.fetch(`.

- Total `sqlx::query*` call sites found by `grep -c sqlx::query`: 216
  (lifecycle.rs 97, payment.rs 47, ledger.rs 36, complimentary.rs 20, credits.rs 16).
- Regex captured 147 of these directly (69 were `sqlx::query_scalar`, which the
  first regex pass missed — re-run with an expanded pattern).
- Of the 147, 48 were INSERT/UPDATE mutations. All 48 had `max($N) == bind count`.
  (Two apparent "mismatches" were `sqlx::query(&query)` built with a `for p in
  &params { q = q.bind(p) }` loop — false positives of the static text scan, not
  bugs; verified by hand at lifecycle.rs:3037-3044 and lifecycle.rs:3095-3102, and
  the check-in inline duplicates at lifecycle.rs:2236/2290, see Finding 2.)
- Additionally grepped the 69 `query_scalar` sites for adjacent
  INSERT/UPDATE keywords: found 2 real mutations using `query_scalar::<_, i64>`
  with `RETURNING id` (payment.rs:410, credits.rs:177) — both hand-verified,
  binds match placeholders exactly (8/8 and 15/15).
- **Manually hand-verified every dynamically-built query** (`sqlx::query(&query)` /
  `sqlx::query(&query_str)` / `sqlx::query(&existing_query)` / `sqlx::query(&reversal_query)`)
  found via `grep -n "sqlx::query(&"`: lifecycle.rs:2236, 2290, 3037, 3095;
  ledger.rs:228, 244, 392, 434, 596, 970, 1038; credits.rs:483. All matched
  (including ledger.rs:413-471's `create_customer_ledger` INSERT, which uses 33
  distinct placeholders with `$21` deliberately reused 3× for
  created_by/updated_by/cashier_id all bound once to `user_id` — correct
  positional-parameter reuse, not a bug; and ledger.rs:1015-1069's reversal
  INSERT reusing `$13`/`$19` the same way, 31/31 binds correct).

**Result: zero bind/placeholder mismatches found in the three domains.** This
differs from repo history (2026-07-26p, 2026-07-27 lessons) — the domains audited
here are currently clean on this specific defect class.

## Sweep 2 — Type-mapping audit (Rust type vs DDL column type)

DDL verified by grep (see file/line list above). Structs checked:
`Booking` (models/booking.rs:71), `Payment` (models/payment.rs:26),
`Invoice` (models/payment.rs:304), `CustomerLedger` (models/ledger.rs:9),
`CustomerLedgerPayment` (models/ledger.rs:144), plus row-mapper functions in
`models/row_mappers.rs` (`row_to_booking`, `row_to_payment`, `row_to_invoice`,
`row_to_customer_ledger`).

- `Booking.check_in_date/check_out_date: NaiveDate` vs DDL `date NOT NULL` — correct.
- `Booking.total_amount/subtotal: Decimal` vs `numeric(12,2) NOT NULL` — correct.
- `Booking.tax_amount/discount_amount: Option<Decimal>` vs `numeric(12,2) DEFAULT 0`
  (nullable, no NOT NULL) — correct to be Option.
- `Payment` DTO struct fields `subtotal/service_charge/tax_amount/keycard_deposit`
  do **not correspond to any column** in `public.payments` — see Finding 4 (this
  is by design/documented in the code, not a decode bug, but it is a real
  data-loss defect).
- `CustomerLedgerPayment.payment_date: DateTime<Utc>` vs
  `payment_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL` — correct
  (already fixed per lessons.md 2026-07-26r; re-verified live in this session).
- `CustomerLedger.payment_date: Option<DateTime<Utc>>` vs
  `customer_ledgers.payment_date timestamp with time zone` (nullable) — correct.
- `GeneratedInvoiceBookingDetailsRow.check_in/check_out: NaiveDate` (payment.rs:24-25)
  and `PaymentBookingStay.check_in/check_out: NaiveDate` (models/payment.rs:206-207)
  vs `bookings.check_in_date/check_out_date date` — correct (already fixed per
  lessons.md 2026-07-26o; re-verified live in this session).
- **New finding**: `InvoiceBookingDetails.check_in/check_out: chrono::NaiveDateTime`
  (models/payment.rs:295-296), populated by `PaymentRepository::invoice_booking_details`
  (repositories/payment.rs:1357-1410) decoding `b.check_in_date, b.check_out_date`
  (DATE columns) into a `chrono::NaiveDateTime` tuple slot (payment.rs:1378-1379) —
  the exact NaiveDateTime-vs-DATE defect class from lessons.md 2026-07-26o. The
  function is marked `#[allow(dead_code)]` (payment.rs:1356) and has zero callers
  (`grep -rn invoice_booking_details src/` → only its own definition), so it is
  currently inert. See Finding 8.
- All row-mapper reads of money/date columns in `row_mappers.rs::row_to_customer_ledger`,
  `row_to_invoice`, `row_to_payment` use `try_get(...).ok()` / `.unwrap_or_default()`
  — no panicking `Row::get` on money or date columns in the mapper layer.
- **New finding**: `map_workflow_summary_row` (repositories/payment.rs:1413-1425)
  uses panicking `row.get("booking_status")` (payment.rs:1415) with no `COALESCE`
  in the feeding SQL (repositories/payment.rs:754: `b.status AS booking_status`,
  no COALESCE) against `bookings.status`, which has **no NOT NULL constraint** in
  the DDL (`status character varying(30) DEFAULT 'pending'::character varying,`
  — migrations/0001_v1_baseline.sql:1394). `payment_status` on the same line is
  protected by `COALESCE(b.payment_status, 'unpaid')` (payment.rs:755) but
  `booking_status` is not. This struct feeds `billable_total()`, which gates the
  balance-due check in `services::payments::record_payment` (a live, money-critical
  write path). Likelihood is low (no INSERT path in the codebase sets status to
  NULL) but the panic surface exists precisely where the task asked to look.
  See Finding 11.

## Sweep 3 — Missing-object audit

Extracted every table name following FROM/INTO/UPDATE/JOIN in the 7 domain files
(`grep -oE "(FROM|INTO|UPDATE|JOIN) [a-z_]+"`, deduplicated) and every bare
function-call pattern (`grep -noE "[a-z_]+\(\)"`, filtered to exclude Rust
stdlib/chrono/sqlx methods).

- 19 distinct table names found: `booking_history, booking_modifications,
  bookings, companies, customer_ledger_payments, customer_ledgers,
  guest_complimentary_credits, guests, invoices, night_audit_details,
  night_audit_posted_nights, night_audit_runs, payment_receipt_requests,
  payments, room_types, rooms, self_checkin_events, user_guests, users`.
  Every one has a matching `CREATE TABLE public.<name> (` in
  `database/postgres/migrations/0001_v1_baseline.sql` (checked individually with
  `grep -c`). **Zero missing tables.**
- Only real SQL function call found: `gen_uuidv7()` (repositories/payment.rs:225,
  331, 342, 416, 812). Confirmed defined at
  `migrations/0001_v1_baseline.sql:326: CREATE FUNCTION public.gen_uuidv7()`.
  **Zero missing functions.**

## Sweep 4 — Efficiency

### Finding 3 (efficiency, high): hot booking-list query recomputes the same
correlated subquery 5, 5, and 3 times per row

`GET_BOOKINGS_BASE_QUERY` (repositories/bookings_queries.rs:5-44) backs the main
paginated `GET /bookings` list (wired at repositories/bookings/lifecycle.rs:669-689
`get_bookings_handler` → `BookingRepository::find_paginated_with_details` →
`booking_list::build_booking_list_query`, repositories/booking.rs:16-22). Counting
literal substring repeats inside the constant:
- `SELECT cl.paid_amount FROM customer_ledgers ... ORDER BY cl.created_at DESC LIMIT 1`
  appears **5 times** (payment_status CASE ×2, total_paid, balance_due numerator ×2).
- `SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id AND p.status = 'completed'`
  appears **5 times**.
- `SELECT cl.amount FROM customer_ledgers ...` appears **3 times**.
- Total correlated subqueries in the SELECT list: **17** (`grep -o "(SELECT"` count).

Every one of these subqueries is re-executed per output row by Postgres (they are
not deduplicated by the planner across independent subquery expressions). This
query runs on every page load of the bookings table for every filter/sort
combination. The same value could be computed once per row via a `LATERAL` join
or a `WITH` CTE and reused across the `payment_status`, `total_paid`, and
`balance_due` expressions. Contributing factor: `customer_ledgers` has an index
on `booking_id` alone (`idx_customer_ledgers_booking`, baseline:6537) but no
composite covering `(booking_id, post_type, created_at)`, and `payments` has
`idx_payments_booking` (baseline:7146) alone, not `(booking_id, status)`.

### Finding 5 (efficiency, medium): count-plus-page double round trip in 3 list
endpoints, unlike the already-fixed booking list

`repositories/booking_list.rs` was already rewritten to use `COUNT(*) OVER()` on
the single data query (comment at booking_list.rs:291-292: "single round-trip...
evaluated over the full filtered set"), consumed at `repositories/booking.rs:97-106`
(only falls back to a second query when the page is empty). By contrast, three
other list endpoints in the same domains still issue two separate round trips
with duplicated WHERE-clause bindings:
- `repositories/ledger.rs::list_customer_ledgers` — `count_sql` (line 221) and
  `data_sql` (line 222-224) each run separately (lines 228 and 244), both bound
  with the same 11 parameters.
- `repositories/payment.rs::list_pending_payments` (line 605) — `list_sql`
  (610-628) then a separate `SELECT COUNT(*) FROM payments WHERE status='pending'`
  (line 638).
- `repositories/payment.rs::list_payment_approval_history` (line 647) — `list_sql`
  (652-664) then a separate COUNT (line 671).

None of these is a correctness bug, but the fix pattern already exists in the
same codebase (booking_list.rs) and was not applied to the sibling domains.

### Finding 6 (efficiency, low-medium): ledger list has no index on its default
sort column or on the columns used by every derived-status filter

`list_customer_ledgers` (repositories/ledger.rs:146-260) defaults `sort_col` to
`created_at` (line 165) when no `sort_by` is given, and its `invoice_state_clause`
/`balance_state_clause`/`ui_status_clause` helpers (ledger.rs:56-93) all test
`invoice_number IS NULL`/`IS NOT NULL`. Baseline indexes on `customer_ledgers`
(migrations/0001_v1_baseline.sql:6523-6607) cover `booking_id, company_name,
department_code, due_date, folio_number, folio_type, guest_id, posting_date,
room_number, status, transaction_code` — there is **no index on `created_at`**
(unlike `bookings`, which has `idx_bookings_created_at` at baseline:6397) and
**no index on `invoice_number`**, despite it being tested in every one of the
three derived-status WHERE clauses.

### Finding 7 (efficiency, low): payment-approval queue query has no supporting
index for its filter or sort columns

`list_payment_approval_history` (repositories/payment.rs:647-677) filters
`p.payment_method IN ('bank_transfer','paypal') AND p.status IN ('completed','void')`
and orders by `p.processed_at DESC NULLS LAST, p.created_at DESC` (line 662-663).
Baseline indexes on `payments` (migrations/0001_v1_baseline.sql:7146-7174) cover
`booking_id, created_at, gateway_payment_intent_id, status, transaction_id` — none
cover `payment_method` or `processed_at`, so this admin review-queue query can
only use the single-column `status` index (or a seq scan) and must sort
`processed_at` without index support.

## Sweep 5 — Money math

### Finding 1 (correctness, blocker): four different "how much does this booking
cost" calculations exist; two of them ignore the booking's actual charges

Two of the payment/invoice code paths in this domain compute the amount from
`room_types.base_price × nights` (the room type's *generic* price), completely
ignoring the specific booking's `total_amount`, `discount_amount`,
`discount_percentage`, `rate_override_weekday/weekend`, `tourism_tax_amount`, and
`extra_bed_charge` — all of which are stored per-booking precisely because a
booking's actual charge routinely differs from the room type's base price.

- **Wrong #1** — `services::payments::calculate_payment_summary`
  (services/payments.rs:103-126): `subtotal = pricing.base_price *
  Decimal::from(nights)` (line 111, `pricing` from `room_pricing` reading
  `room_types.base_price`), `service_charge = subtotal * pct / 100`,
  `tax_amount = Decimal::ZERO` (line 113), `total = subtotal + service_charge +
  tax + keycard_deposit` (line 114). Used by `create_payment`
  (services/payments.rs:128-185), routed at `POST /payments`
  (routes/payments.rs:52,84-90). No confirmed frontend caller was found
  (`grep -rn "'payments'"` / `api.post(\`payments\`)` across hotel-web-fe found
  none), so current live blast radius via the web app is unclear — but it is a
  reachable, RBAC-presumed-gated endpoint that would charge/record the wrong
  amount the moment anything calls it.
- **Wrong #2** — `PaymentRepository::create_generated_invoice`
  (repositories/payment.rs:888-1072): `booking_details` query (902-918) reads
  `check_in/check_out` from `bookings` but never selects `total_amount`,
  `discount_amount`, `tourism_tax_amount`, `extra_bed_charge`, or `room_rate`.
  `pricing_row` (943-954) reads only `rt.base_price, rt.keycard_deposit_amount,
  rt.service_charge_percentage` from `room_types`. `subtotal = base_price *
  nights` (961), `total = subtotal + service_charge + 0 + keycard_deposit` (964),
  hardcoded `currency = "MYR"` (bind at line 1024) regardless of
  `bookings.currency`. This IS confirmed live: `generate_invoice`
  (services/payments.rs:490-520) is called by `get_invoice_preview`
  (services/payments.rs:523-547) as a create-if-missing fallback, routed at
  `GET /invoices/preview/{booking_id}` (routes/payments.rs:70,149-155). The
  frontend calls this from `hotel-web-fe/src/features/invoices/components/InvoiceModal.tsx`
  (confirmed via `invoices/preview` grep hit) and
  `CustomerLedgerPage.tsx`/`CompanyInvoiceDialog.tsx`.
  `InvoiceModal.tsx` renders `invoice.subtotal` (line 209),
  `invoice.tax_amount` (228), and `invoice.total_amount` (251) **directly from
  this response**. Because `generate_invoice` first checks
  `find_invoice_by_booking_id` and returns the existing row if present
  (services/payments.rs:495-497), a wrong invoice generated once for a booking is
  **permanent** — it is never recomputed even if staff later notice the booking's
  real total differs.
- **Correct #1** — `PaymentRepository::insert_checkout_invoice`
  (repositories/payment.rs:1287-1326), the real checkout-time invoice writer:
  `subtotal, total_amount) ... SELECT ..., b.total_amount, b.total_amount, ...`
  (lines 1301-1307) — uses the booking's own stored total directly.
- **Correct #2** — `PaymentWorkflowSummaryRow::billable_total()`
  (models/payment.rs:285-287): `self.total_amount + self.tourism_tax_amount +
  self.extra_bed_charge`, fed by `workflow_summary_row`
  (repositories/payment.rs:744-783, `SELECT b.total_amount, ... FROM bookings b`)
  and used by `services::payments::record_payment` (services/payments.rs:187-...,
  balance check at line 225-230) — the staff manual-payment-recording path
  correctly bases the balance check on the booking's real total.

**Business impact**: any booking with a discount, a rate-plan price different
from the room type's default, a rate override, tourism tax, or an extra bed will
get a WRONG invoice preview total (and, if `create_payment`/`POST /payments` is
ever wired up on the frontend, a wrong payment amount) whenever no checkout
invoice already exists for it. This is not a policy question — the correct
answer (use the booking's own stored charge) is already implemented twice in the
same codebase; the other two call sites simply never adopted it.

### Finding 4 (correctness, medium): payment amount breakdown is computed but
never persisted; every re-fetch silently returns $0 for it

`PaymentRepository::create_completed_payment` (repositories/payment.rs:186-268)
builds its `Payment` response directly from the in-memory `PaymentSummary`
(comment at lines 244-247: "the breakdown fields ... were never actually stored
by this path"). `INSERT INTO payments` (221-227) only writes the single `amount`
column. `row_mappers::row_to_payment` (models/row_mappers.rs:207-237), used by
`PaymentRepository::find_by_booking_id` (repositories/payment.rs:871-886, backing
`GET /payments/booking/{id}`, routes/payments.rs:49) hardcodes
`subtotal/service_charge/tax_amount/keycard_deposit` to `Decimal::ZERO`
(row_mappers.rs:217-220) because there is nowhere in the schema to read them
back from. `get_invoice_preview` embeds this same zeroed `Payment` into its
`InvoicePreview.payment` field (services/payments.rs:533,542-546). Checked the
only confirmed frontend readers of that field
(`hotel-web-fe/src/features/invoices/components/InvoiceModal.tsx:264-271`) and
they only read `payment_status`/`payment_method`/`transaction_reference`, not the
zeroed breakdown fields — so current on-screen impact is none, but the API
contract is broken for any other consumer (a receipts PDF, a future mobile
client, a reporting query) that reads those fields expecting real values.

## Deadcode findings

### Finding 2 (deadcode, high — with a latent correctness bug inside):
`repositories/bookings/lifecycle.rs::manual_checkin_handler` (lines 2106-2462,
357 lines) is entirely unreachable

`grep -rn "manual_checkin_handler" src/` finds exactly 3 hits: its own
definition here, plus `handlers/bookings.rs:125` (a *different* function of the
same name) and `routes/bookings.rs:176`, which calls
`handlers::bookings::manual_checkin_handler` → `services::bookings::manual_checkin`
(services/bookings.rs:242) — the live path. The `lifecycle.rs` copy is exported
via `repositories/bookings/mod.rs:12 pub use lifecycle::*;` but has zero call
sites anywhere in `src/`, so it is dead despite being `pub` (glob re-exports
routinely suppress Rust's dead-code lint, matching the repo's own documented
"compiles clean, still dead" pattern from lessons.md 2026-07-26).

This dead copy contains the exact "swallow the error inside a Postgres
transaction" bug documented in lessons.md 2026-07-10b: at lines 2230-2248 and
2284-2301, a guest-field UPDATE and a booking-field UPDATE run on `&mut *tx`
(the check-in transaction opened at line 2140) and on failure only
`log::warn!(...)` (2242-2246, 2296-2300) — never propagated — which would poison
the transaction and surface as a misleading "current transaction is aborted"
error on the *next* statement (the `checked_in` status flip at line 2318). The
live code path does not have this bug: `services/bookings.rs:363-371` calls
`booking_repo::apply_guest_update_tx` (repositories/bookings/lifecycle.rs:2960-3047)
and `apply_booking_field_update_tx` (lifecycle.rs:3052-3105) with `.await?`,
correctly propagating any failure. The dead function duplicates their SQL-building
logic inline instead of calling them. Recommendation: delete the dead function;
if it is ever resurrected (e.g. by copy-paste into a new endpoint), the swallowed-error
bug would resurface.

### Finding 9 (deadcode, low): `GET_BOOKINGS_QUERY` constant
(repositories/bookings_queries.rs:50-90, 41 lines) is an unused duplicate of
`GET_BOOKINGS_BASE_QUERY`

`grep -rn "GET_BOOKINGS_QUERY\b" src/` finds only its own definition. Comment at
line 47 says "kept for backward compat" but nothing references it.

### Finding 8 (deadcode, low, contains 2 latent bugs):
`PaymentRepository::invoice_booking_details` (repositories/payment.rs:1356-1410)

Marked `#[allow(dead_code)]` (line 1356), zero callers anywhere in `src/`.
Contains two bugs that would fire immediately if it were ever called: (a) the
NaiveDateTime-vs-DATE decode mismatch described in Sweep 2 above; (b) the query
(payment.rs:1385-1392) joins `JOIN users u ON b.guest_id = u.id` — but
`bookings.guest_id` references `guests`, not `users` (see `bookings.guest_id
bigint NOT NULL` and the `guests` table used everywhere else in this file, e.g.
payment.rs:909 `JOIN guests g ON b.guest_id = g.id`) — so even fixing the date
type would still join against the wrong table.

## Test-gap finding

### Finding 10 (test-gap, high): the only end-to-end test for
`generate_invoice`/`calculate_payment_summary` cannot detect Finding 1

`tests/invoice_numbering.rs::seed_booking` (lines 107-170) inserts
`room_types.base_price = 150.00` (line 117) and
`bookings.room_rate = 150.00, subtotal = 300.00, total_amount = 300.00` (lines
158-159) for a 2-night stay — i.e. the fixture keeps the room type's base price
and the booking's actual charge numerically identical on purpose (no discount,
no tourism tax, no extra bed, no rate override). The regression test built on
this fixture (`generate_invoice_returns_enriched_invoice_and_is_idempotent`,
lines 555-610) asserts `invoice.check_in_date`/`check_out_date` and
`summary.subtotal == Decimal::new(300, 0)` — but since `base_price * nights`
and `booking.total_amount` are the same number by construction, this test
passes identically whether `create_generated_invoice`/`calculate_payment_summary`
correctly use the booking's total or incorrectly use the room type's base price.
No test in the repository seeds a booking with a discount, rate override,
tourism tax, or extra-bed charge and asserts the resulting invoice/payment total
against the booking's `total_amount`.

## Minor / lower-confidence observations (not reported as top findings)

- `services/ledgers.rs` and `services/payments.rs` audit-log calls are all
  `let _ = AuditLog::log_event(...)` (fire-and-forget) — consistent with the
  rest of the codebase; not domain-specific, not re-reported here.
- `repositories/ledger.rs::list_customer_ledgers`'s count query result is
  `.unwrap_or(0)` (line 242) — a failed COUNT silently reports "0 ledgers" rather
  than surfacing an error. Low severity, folded into Finding 5's writeup rather
  than a separate entry.
- The `balance_state_clause`'s `'clear'` branch (ledger.rs:73-79) does not
  special-case `void_at`, so a voided ledger whose `amount`/`paid_amount` were
  never adjusted at void time (confirmed: `void_ledger`, ledger.rs:934-981, only
  sets `void_at/void_by/void_reason/status`, never touches `amount`/`paid_amount`)
  keeps a nonzero raw `balance_due` and would not match `balance_state=clear`,
  even though the API's returned `balance_due` for that row is force-zeroed to 0
  by `row_to_customer_ledger` (row_mappers.rs:363-367) whenever `status='void'`.
  Not reported as a top finding: the `ui_status_clause`'s dedicated `'voided'`
  branch (ledger.rs:85) is checked independently and the frontend's
  `getLedgerUiStatus` is documented to mirror this special-casing, so real-world
  impact is unverified and plausibly already handled correctly on the FE side.
