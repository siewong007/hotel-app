# Ledger Payment Report Stay Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Return linked booking check-in/check-out dates through ledger APIs and show them in the Company Ledger report, printable customer statement, and printable payment receipt.

**Architecture:** Keep the existing ledger repository and analytics report flow. Add nullable date fields to CustomerLedger, populate them with correlated booking lookups in the shared ledger select, and add the same lookup to the company-statement transaction query. Reuse the existing frontend date formatter and render - for null dates.

**Tech Stack:** Rust, SQLx, PostgreSQL, chrono::NaiveDate, Serde JSON, React, TypeScript, MUI, Vitest.

## Global Constraints

- Preserve route paths, response fields, totals, filters, and status behavior; this is additive only.
- Keep check_in_date and check_out_date nullable for standalone ledger entries.
- Use core/sql_compat.rs helpers only where new SQL needs portable date/current-time expressions; the booking-date lookup itself uses existing columns and no new schema.
- Keep SQL parameterized; the only interpolated SQL remains the existing fixed select fragment and whitelisted report fields.
- Do not add dependencies or migrations.
- Backend integration tests require DATABASE_URL to be configured for the local PostgreSQL test database; verify the real PostgreSQL run by test count, not exit code alone.

---

### Task 1: Add backend regression coverage for shared ledger stay dates

**Files:**
- Modify: hotel-app-be/tests/ledger_service.rs

**Interfaces:**
- Consumes: existing seed_company_billed_booking, cleanup_booking_fixture, ledgers::create_customer_ledger, ledgers::get_customer_ledger, and ledgers::list_customer_ledgers helpers.
- Produces: failing integration coverage proving linked rows return booking dates and standalone rows return None.

- [ ] **Step 1: Write the failing tests**

Add one PostgreSQL test in the existing postgres_tests module using unused 910_xxx fixture ids. Seed a booking with check_in = 2031-04-10 and check_out = 2031-04-13, create a ledger with booking_id: Some(booking_id), and assert all shared ledger reads expose those dates:

~~~~rust
let linked = ledgers::create_customer_ledger(&pool, actor_id, linked_request).await.unwrap();
assert_eq!(linked.check_in_date, Some(check_in));
assert_eq!(linked.check_out_date, Some(check_out));

let fetched = ledgers::get_customer_ledger(&pool, linked.id).await.unwrap();
assert_eq!(fetched.check_in_date, Some(check_in));
assert_eq!(fetched.check_out_date, Some(check_out));

let listed = ledgers::list_customer_ledgers(
    &pool,
    LedgerListQuery { company_name: Some(company_name.to_string()), ..empty_ledger_list_query() },
).await.unwrap();
let listed_linked = listed.data.iter().find(|entry| entry.id == linked.id).unwrap();
assert_eq!(listed_linked.check_in_date, Some(check_in));
assert_eq!(listed_linked.check_out_date, Some(check_out));
~~~~

Create a separate standalone ledger in the same test with booking_id: None and assert check_in_date.is_none() and check_out_date.is_none() after fetching it. Clean up ledger rows before the booking fixture, using the existing helper ordering.

- [ ] **Step 2: Run the focused test to verify it fails**

Run from hotel-app-be:

~~~~bash
cargo test --test ledger_service postgres_ledger_reads_linked_booking_stay_dates -- --exact --nocapture
~~~~

Expected: compilation fails because CustomerLedger has no check_in_date/check_out_date fields (or, after the assertion is adjusted to compile against the current type, the values are None).

- [ ] **Step 3: Commit the failing test**

~~~~bash
git add hotel-app-be/tests/ledger_service.rs
git commit -m "test(ledgers): cover booking stay dates in ledger responses"
~~~~

### Task 2: Populate stay dates in backend ledger responses

**Files:**
- Modify: hotel-app-be/src/models/ledger.rs
- Modify: hotel-app-be/src/models/row_mappers.rs
- Modify: hotel-app-be/src/repositories/ledger.rs

**Interfaces:**
- Consumes: bookings.id, bookings.check_in_date, bookings.check_out_date, and customer_ledgers.booking_id.
- Produces: CustomerLedger with check_in_date: Option<NaiveDate> and check_out_date: Option<NaiveDate> in list, get, create, update, void, reversal, and with-payments responses.

- [ ] **Step 1: Add nullable model fields and mapper coverage**

Add the two fields next to booking_id in CustomerLedger and initialize them in both the manual FromRow implementation and row_to_customer_ledger:

~~~~rust
pub check_in_date: Option<NaiveDate>,
pub check_out_date: Option<NaiveDate>,
~~~~

Use row.try_get("check_in_date")? in FromRow and row.try_get("check_in_date").ok() in the tolerant row mapper, matching the existing date-field conventions.

- [ ] **Step 2: Add correlated booking date expressions to the shared ledger select**

Extend LEDGER_SELECT_FIELDS and GET_LEDGER_BY_ID_QUERY with fixed expressions that work in both SELECT and existing RETURNING clauses:

~~~~sql
(SELECT b.check_in_date FROM bookings b WHERE b.id = customer_ledgers.booking_id) AS check_in_date,
(SELECT b.check_out_date FROM bookings b WHERE b.id = customer_ledgers.booking_id) AS check_out_date,
~~~~

Do not change count queries, filters, ordering, mutation bindings, or any ledger accounting columns.

- [ ] **Step 3: Run the focused backend test to verify it passes**

Run:

~~~~bash
cargo test --test ledger_service postgres_ledger_reads_linked_booking_stay_dates -- --exact --nocapture
~~~~

Expected: PASS, with linked rows returning the seeded NaiveDate values and standalone rows returning None.

- [ ] **Step 4: Commit the backend ledger response change**

~~~~bash
git add hotel-app-be/src/models/ledger.rs hotel-app-be/src/models/row_mappers.rs hotel-app-be/src/repositories/ledger.rs
git commit -m "feat(ledgers): include linked booking stay dates"
~~~~

### Task 3: Add the Company Ledger report backend fields

**Files:**
- Modify: hotel-app-be/src/repositories/analytics.rs
- Modify: hotel-app-be/tests/audit_analytics_settings.rs
- Modify: hotel-web-fe/src/types/report.types.ts

**Interfaces:**
- Consumes: customer_ledgers.booking_id and the two booking date columns.
- Produces: each company_statement.transactions[] item with nullable check_in_date and check_out_date strings in the existing %d/%m/%y report format; the TypeScript CompanyLedgerTransaction mirror matches that shape.

- [ ] **Step 1: Extend the existing analytics regression fixture and assertions**

Give the non-void fixture ledger a seeded booking id and booking row with dates 2031-05-10 and 2031-05-12, then assert the statement transaction contains:

~~~~rust
assert_eq!(transactions[0]["check_in_date"].as_str(), Some("10/05/31"));
assert_eq!(transactions[0]["check_out_date"].as_str(), Some("12/05/31"));
~~~~

Keep the void-row exclusion and totals assertions unchanged. Add a standalone ledger row to the fixture or assert an existing no-booking row emits JSON null, and verify both date fields are null for it. Clean up the new booking after deleting the ledger fixtures.

- [ ] **Step 2: Run the focused analytics test to verify it fails**

Run:

~~~~bash
cargo test --test audit_analytics_settings analytics_company_ledger_statement_decodes_ledger_and_payment_timestamps -- --exact --nocapture
~~~~

Expected: FAIL because the report transaction currently has no booking-date fields.

- [ ] **Step 3: Add the report query fields and JSON serialization**

In generate_company_ledger_statement, add a LEFT JOIN bookings b ON b.id = customer_ledgers.booking_id, select b.check_in_date and b.check_out_date, decode them as Option<NaiveDate>, and add them to the existing transaction JSON using the same %d/%m/%y formatting as invoice_date and due_date:

~~~~rust
"check_in_date": check_in_date.map(|date| date.format("%d/%m/%y").to_string()),
"check_out_date": check_out_date.map(|date| date.format("%d/%m/%y").to_string()),
~~~~

Add matching optional fields to CompanyLedgerTransaction in report.types.ts.

- [ ] **Step 4: Run the focused analytics test to verify it passes**

Run the same cargo test --test audit_analytics_settings command and expect PASS.

- [ ] **Step 5: Commit the report backend change**

~~~~bash
git add hotel-app-be/src/repositories/analytics.rs hotel-app-be/tests/audit_analytics_settings.rs hotel-web-fe/src/types/report.types.ts
git commit -m "feat(reports): include booking stay dates in company ledger"
~~~~

### Task 4: Render stay dates in report and printable ledger outputs

**Files:**
- Modify: hotel-web-fe/src/features/reports/components/ModernReportsPage.tsx
- Modify: hotel-web-fe/src/features/admin/components/CustomerLedger/customerLedgerPrint.ts
- Test: hotel-web-fe/src/features/admin/components/CustomerLedger/customerLedgerPrint.test.ts

**Interfaces:**
- Consumes: CompanyLedgerTransaction.check_in_date, CompanyLedgerTransaction.check_out_date, CustomerLedger.check_in_date, CustomerLedger.check_out_date, and formatDateForDisplay.
- Produces: visible Check-in/Check-out columns and printable Check-in/Check-out values, with - when dates are absent.

- [ ] **Step 1: Write failing frontend output tests**

Add framework-free tests around the existing HTML-producing print functions. Stub the iframe DOM path, call printCompanyStatement and printSingleReceipt with one linked ledger and one standalone ledger, and assert the generated document HTML contains the headings and formatted linked dates plus - for missing dates. Keep the test fixture minimal and reuse the existing CustomerLedger shape.

The assertions should include the observable output strings:

~~~~ts
expect(html).toContain('Check-in');
expect(html).toContain('Check-out');
expect(html).toContain('Apr 10, 2031');
expect(html).toContain('Apr 13, 2031');
expect(html).toContain('-');
~~~~

- [ ] **Step 2: Run the focused frontend test to verify it fails**

Run from hotel-web-fe:

~~~~bash
bun run test src/features/admin/components/CustomerLedger/customerLedgerPrint.test.ts
~~~~

Expected: FAIL because the print HTML currently has no stay-date headings or values.

- [ ] **Step 3: Render the report and print fields**

In renderCompanyLedgerStatement, add Check-in and Check-out header cells beside the existing transaction date/details and render txn.check_in_date || '-' and txn.check_out_date || '-'. Update the total row colSpan to cover the new columns.

In printCompanyStatement, add Check-in and Check-out columns beside the existing ledger date and render formatDateForDisplay(entry.check_in_date) and formatDateForDisplay(entry.check_out_date). In printSingleReceipt, add Check-in Date and Check-out Date detail rows, always using the formatter so standalone entries render -.

- [ ] **Step 4: Run the focused frontend test to verify it passes**

Run the same Vitest command and expect PASS.

- [ ] **Step 5: Commit the frontend presentation change**

~~~~bash
git add hotel-web-fe/src/features/reports/components/ModernReportsPage.tsx hotel-web-fe/src/features/admin/components/CustomerLedger/customerLedgerPrint.ts hotel-web-fe/src/features/admin/components/CustomerLedger/customerLedgerPrint.test.ts
git commit -m "feat(ledger): display booking stay dates in reports and prints"
~~~~

### Task 5: Run full verification and inspect the final diff

**Files:**
- Verify: all files changed by Tasks 1–4

- [ ] **Step 1: Run backend formatting and focused integration coverage**

~~~~bash
cargo fmt --all -- --check
cargo test --test ledger_service --test audit_analytics_settings -- --nocapture
~~~~

Confirm the output includes the real PostgreSQL test counts, not only skipped tests.

- [ ] **Step 2: Run frontend gates**

~~~~bash
bun run test
bun run typecheck
bun run lint
~~~~

- [ ] **Step 3: Inspect the final diff and status**

~~~~bash
git diff --check
git status --short
git diff --stat
~~~~

Confirm only the ledger stay-date implementation, tests, and its plan/spec documentation are present; confirm no migration, lockfile, route, total, filter, or status changes slipped in.

- [ ] **Step 4: Commit any remaining implementation edits**

~~~~bash
git add hotel-app-be hotel-web-fe
git commit -m "feat(ledger): complete stay dates in payment reports"
~~~~
