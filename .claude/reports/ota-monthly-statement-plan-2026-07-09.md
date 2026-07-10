# Plan: Monthly OTA Statement Report (Agoda-style)

Date: 2026-07-09. Target format: photographed Agoda.com June-2026 statement —
header "Statement Date: DD.MM.YYYY" + "<Platform> — <Month Year>", columns:
Ref No | Name | Amount | Comm(25%) | Tax | Amount Paid | Check in date | Check out date.

Verified from the sample: **Amount Paid = Amount − Comm − Tax** on every legible row
(86.40 − 14.69 − 1.18 = 70.53; 259.20 − 44.06 − 3.52 = 211.62). So "Amount Paid" is the
expected OTA remittance, not recorded payments.
NOTE: header says "Comm(25%)" but every row's commission is 17% of Amount
(14.69 / 86.40 = 0.17). The 25% is presumably applied to a different base (net rate).
Commission must stay config-driven per channel — do NOT hard-code 25% or 17%.

## What already exists (verified 2026-07-09)

- `booking_channels` table (schema.sql:5873): channel_type incl. 'ota',
  default_commission_type ('none'|'percentage'|'fixed_amount'), value, scope
  ('per_booking'|'per_night'). Agoda etc. seeded in system_settings.
- `bookings`: booking_channel_id, commission_*_override, commission_amount,
  net_revenue, plus legacy source/channel/commission_rate (schema.sql:1767).
- Backend report `channel_net_revenue` (alias `ota_commission`):
  src/repositories/channel_net_revenue.rs (821 lines), dispatched at
  src/repositories/analytics.rs:823, served by GET /reports/generate
  (src/routes/analytics.rs:28, guarded by analytics:read OR reports:execute).
  Emits per-row gross/commission/net/service_tax/tourism_tax + by_channel aggregates.
- FE: ModernReportsPage.tsx has a report-type registry, channel/platform filters
  already exist for channel_net_revenue, and a print-preview pipeline
  (createReportPrintStyles + print window). ReportType union in
  src/features/reports/hooks/useReportData.ts:8.

## Gaps vs the sample

1. **Ref No** — the OTA's own reference (e.g. 1973097274) is stored NOWHERE on
   bookings (no ota_reference/external_reference column; grepped schema + src).
2. **Amount Paid** — not in the report payload (derivable as amount − comm − tax).
3. **Statement presentation** — no per-platform monthly statement layout
   (statement date header, one table per OTA, one row per booking, totals row).

## Open business decisions (money math — confirm before implementing, rubric #3)

- D1: Commission formula per channel. Sample's effective rate (17%) ≠ label (25%).
  Proposal: keep channel-config-driven percentage of gross; label shows configured %.
- D2: "Amount Paid" = computed remittance (Amount − Comm − Tax, matches sample) vs
  actual completed payments from `payments`. Proposal: computed, matching sample.
- D3: Which bookings appear: by check-OUT month (statement-like), incl./excl.
  cancelled & no-show. Proposal: checked_out/completed bookings with
  check_out_date in the month; exclude cancelled.
- D4 (user 2026-07-09: "report for different booking type should be separated"):
  statements are always one-per-channel, never merged. Remaining sub-question:
  default scope = OTA-type channels only (commissioned platforms), with
  direct/corporate/walk-in available via filter? Proposal: yes — OTA channels
  by default since non-commissioned types have no Comm/Amount-Paid semantics.

## Implementation steps

### Phase 1 — schema (dual-DB, Leak #2 checklist)
- `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ota_reference VARCHAR(100);`
  in database/schema.sql (idempotent section) AND new
  database/sqlite_migrations/015_bookings_ota_reference.sql.

### Phase 2 — backend
- Models + create/update booking handlers accept optional `ota_reference`
  (Sanitizer on input; audit unchanged paths).
- New report_type `ota_monthly_statement` in repositories/analytics.rs dispatch →
  new fn in channel_net_revenue.rs (or sibling module) that REUSES the existing
  raw-row fetch + commission resolution, then:
  - one row per BOOKING (existing rows are per booking-night for posted data —
    must aggregate),
  - row fields: ref_no (ota_reference, fallback booking_number), guest_name,
    amount (gross incl. per D1 base), commission, tax (service+tourism per D1),
    amount_paid (per D2), check_in_date, check_out_date,
  - SEPARATED per booking type: `statements: [{platform, channel_id, channel_type,
    rows, totals}]` — one statement object per channel; bookings are never mixed
    across platforms in one table. Ordering: OTAs first (by gross desc), then
    direct/corporate/walk-in if included,
  - `statement_date` = generation date via sql_compat::current_date semantics
    (chrono in Rust is fine — no SQL needed),
  - filters: booking_channel_id/platform_name (reuse ReportQuery), period =
    start/end of selected month.
- No new route/proxy needed (reuses /reports/generate + existing permissions).
- param!/sql_compat for ANY new SQL; verify every referenced column against BOTH
  DDLs (lesson 2026-07-07); no SELECT *.

### Phase 3 — frontend
- Add 'ota_monthly_statement' to ReportType union (useReportData.ts:8) and to the
  report registry/menu in ModernReportsPage.tsx with: month picker (maps to
  start/end date) + channel selector (reuse existing channel filter UI).
- New statement renderer: ONE statement block per channel, each with its own
  header (hotel name, Statement Date, "<Platform> — <Month YYYY>"), its own
  8-column table and totals row. On screen: one section (or tab) per platform;
  in print: `page-break-before` so each platform's statement starts on a fresh
  page. Channel selector filters to a single platform's statement when the user
  wants just one (e.g. only Agoda to reconcile against Agoda's own statement).
- Booking form: "OTA Ref No" text field, visible when selected channel is
  type 'ota'; goes through existing booking service types in src/types/.
- Types via src/api ReportsService — no raw fetch; dates via utils/date.ts.

### Phase 4 — verification (rubric #2)
- `cargo check --all-features` + `cargo clippy --all-features -- -D warnings`.
- `bun run typecheck && bun run lint && bun run test`.
- SQLite smoke: scratch DB, seed a channel+booking+ota_reference, curl
  /reports/generate?report_type=ota_monthly_statement — confirm row math
  (amount − comm − tax = amount_paid) and grouping.
- Print preview screenshot vs sample image.

Est. touch set: schema.sql, 1 new sqlite migration, models/booking(+channel) files,
handlers/bookings.rs (create/update), repositories/{analytics,channel_net_revenue}.rs,
FE useReportData.ts, ModernReportsPage.tsx (+1 new statement component), booking
form component, types. No CI/route/proxy changes.
