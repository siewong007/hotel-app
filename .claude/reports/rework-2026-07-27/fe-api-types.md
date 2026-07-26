# FE API-service / Type-contract audit — booking, payment, ledger, invoice

Scope: `hotel-web-fe/src/api/{client,bookings.service,ledger.service,invoices.service,paymentApprovals.service}.ts`,
`hotel-web-fe/src/types/{booking,payment,ledger}.types.ts`, `hotel-app-be/src/models/{booking,payment,ledger}.rs`,
plus the row mappers, query-key factory, query hooks and vite dev proxy that connect them.

All line numbers were obtained by Grep/Read in this session (not reused from stale refs).

## 1. Contract diff — field by field

### Booking (Rust `models/booking.rs:71-129` vs FE `types/booking.types.ts:14-80`)

Rust `Booking` has 47 declared fields; 2 (`pre_checkin_token`, `pre_checkin_token_expires_at`) carry
`#[serde(skip_serializing)]` (row_mappers.rs:172-173), so **45 fields actually reach the wire**.
FE `Booking` interface declares **61 fields**. Compared all 45 × 61.

- **Missing on FE (backend sends, FE has no typed field for it):** `subtotal`, `tax_amount`,
  `discount_amount`, `currency`, `created_by` (all present on the Rust struct and returned by
  `row_to_booking`, `models/row_mappers.rs:137-192`, used by e.g. `repositories/bookings/lifecycle.rs:3158,3467`
  create/update-booking responses). Authoritative side: backend. Consequence: any FE code reading the
  create/update-booking response cannot see the tax/subtotal breakdown or which staff user created it
  without an unchecked cast — these are silently invisible, not merely optional.
- **FE-only fields that no backend mapper ever populates** (verified against both `row_to_booking` and
  `row_to_booking_with_details`, `models/row_mappers.rs:67-192`): `post_type`, `rate_code`,
  `check_in_time`, `check_out_time`, `cancelled_at`, `cancellation_reason`, `number_of_guests`,
  `posted_at`. `check_in_time`/`check_out_time`/`rate_code`/`post_type` genuinely exist as DB columns
  (verified in `database/postgres/migrations/0001_v1_baseline.sql`, `CREATE TABLE public.bookings`) and
  as **input-only** fields on `BookingInput`/`BookingUpdateInput` (`models/booking.rs:139,186,197,198`),
  but no output struct ever returns them. `cancelled_at`/`cancellation_reason`/`posted_at` exist as DB
  columns but are not mapped by ANY Rust struct in the codebase (grep for the exact column name across
  `src/` returns only the two `UPDATE ... SET cancelled_at = CURRENT_TIMESTAMP` write-sites in
  `repositories/bookings/lifecycle.rs:1991,2723`). `number_of_guests` is not a DB column at all (only
  `adults`/`children` exist). Authoritative side: none — these FE fields describe values that can never
  arrive. Consequence: dead/misleading typing; a developer reading the type believes a GET response can
  carry these.
- **Correct on both sides:** the remaining 40 fields (id, guest_id, room_id, dates, status,
  payment_status, payment_method, adults, children, remarks, source, booking_channel_id, ota_reference,
  market_code, discount_percentage, rate_override_weekday/weekend, pre_checkin_completed(_at),
  is_complimentary and its 4 siblings, deposit_paid/amount/paid_at, company_id/name, payment_note,
  daily_rates, cleaning_preference, created_at/updated_at) match by name; optionality is consistent
  (Rust `Option<T>` ↔ FE `field?:`), though see finding on null-vs-undefined below.

### BookingWithDetails (Rust `models/booking.rs:291-356` vs FE `types/booking.types.ts:82-127`, which `extends Booking`)

Rust struct: 54 fields (counted directly from the struct body). FE type: 61 inherited + 44 own
declarations (some overriding the base). Compared both directions.

- **Missing on FE entirely: `ekyc_summary`.** Rust populates it on every row
  (`models/row_mappers.rs:127`, `GuestEkycStatusSummary::not_submitted(guest_id)` or a real computed
  status) and it is a real, non-trivial payload: `guest_id`, `ekyc_verification_id`, `status`,
  `self_checkin_enabled`, `verified_at`, `can_auto_checkin`, `auto_checkin_block_reason`
  (`models/guest.rs:58-66`). Verified zero references to `ekyc_summary` anywhere in
  `hotel-web-fe/src` and zero eKYC-aware components under `features/bookings`. Authoritative side:
  backend. Consequence: staff-facing booking views cannot see why a guest is/isn't eligible for
  self-checkin even though the backend computes and ships this on every booking-with-details response —
  a real, currently-invisible feature gap, not just a typing nit.
- Everything else lines up 1:1 by name (guest_name/email/type, room_number/type/code, price_per_night
  aliasing `room_rate` via `#[serde(rename = "price_per_night")]` at `models/booking.rs:306`, which FE
  correctly names `price_per_night`, is_posted/posted_date, all the money/complimentary/deposit fields).

### CustomerLedger (Rust `models/ledger.rs:9-65` vs FE `types/ledger.types.ts:13-69`)

Both sides have **exactly 54 fields**, and every field name matches 1:1 (id through void_reason).
This is the cleanest of the four contracts in scope — no missing/extra fields either direction.
Only issue is the money-type ambiguity noted below (applies to `amount`, `paid_amount`, `balance_due`,
`tax_amount`, `service_charge`, `net_amount`).

### CustomerLedgerPayment (Rust `models/ledger.rs:144-156` vs FE `types/ledger.types.ts:142-154`)

Both sides: id, ledger_id, payment_amount, payment_method, payment_reference, payment_date,
receipt_number, receipt_file_url, notes, processed_by, created_at — **10 fields, exact 1:1 match**.
`UpdateLedgerPaymentRequest` (Rust, `models/ledger.rs:175-185`) has no dedicated FE type at all; FE
`LedgerService.updateLedgerPayment` (`api/ledger.service.ts:183-195`) instead inlines an ad hoc object
literal type with the same 5 fields — functionally fine, but means a backend field rename here would
not be caught by the type checker.

### Invoice / InvoicePreview (Rust `models/payment.rs:304-340` vs FE `types/payment.types.ts:3-47`) — SEVERE MISMATCH

Rust `Invoice`: 27 fields (id, uuid, invoice_number, booking_id, user_id, billing_name,
billing_address, billing_email, invoice_date, issue_date, due_date, check_in_date, check_out_date,
number_of_nights, room_number, room_type, subtotal, tax_amount, discount_amount, total_amount,
paid_amount, balance_due, currency, status, notes, created_at, updated_at).
FE `Invoice`: 20 fields (id, invoice_number, booking_id, payment_id, user_id, invoice_date, due_date,
subtotal, service_charge, service_charge_percentage, tax_amount, tax_percentage, keycard_deposit,
total_amount, line_items, customer_name, customer_email, customer_phone, customer_address,
room_number, room_type, check_in_date, check_out_date, number_of_nights, status, pdf_generated,
pdf_path, pdf_generated_at, notes, terms_and_conditions — actually 30 counted, see below).

- **Missing on FE (backend sends, no FE field):** `uuid`, `billing_name`, `billing_address`,
  `billing_email`, `issue_date`, `discount_amount`, `paid_amount`, `balance_due`, `currency`,
  `created_at`, `updated_at` — 11 fields.
- **FE-only, do not exist on the struct at all:** `payment_id`, `service_charge`,
  `service_charge_percentage`, `tax_percentage`, `keycard_deposit`, `line_items`, `customer_name`,
  `customer_email`, `customer_phone`, `customer_address`, `pdf_generated`, `pdf_path`,
  `pdf_generated_at`, `terms_and_conditions` — 14 fields.
- **Name collisions with different backing:** FE `customer_name`/`customer_email`/`customer_address`
  vs Rust `billing_name`/`billing_email`/`billing_address` — these describe the same concept but under
  different keys; a naive FE consumer doing `invoice.customer_name` reads `undefined`, not an error.
- Root cause found: `hotel-web-fe/src/types/dataTransfer.types.ts:375-377` carries a comment claiming
  "`Invoice` (API response) is a booking/guest JOIN (customer_name, room_number, ...)" — that shape does
  not exist anywhere in the current backend (`services/payments.rs:490-551`, `get_invoice_preview`/
  `get_user_invoices`, both return the real `billing_name`-shaped struct). This comment is itself stale
  and is the likely historical source of the wrong FE type.
- **Why this hasn't caused a visible incident:** `InvoicesService` (see §3) returns `Promise<any>` for
  every invoice/payment method, so the `Invoice` type is never actually applied to the real response —
  it is decorative. This is worse than a caught mismatch: it gives false confidence that a contract
  exists.

## 2. `any` / `as any` usage

Counted in the 4 in-scope service files + the 3 domains' hooks directories
(`features/bookings/hooks`, `features/invoices/hooks`, `features/admin/hooks`), excluding `*.test.ts`.

- **`api/invoices.service.ts`** — 9 of 11 methods return `Promise<any>`/`Promise<any[]>`:
  `getInvoicePreview:6-8`, `generateInvoice:22-24`, `recordPayment:46,54`, `getBookingPayments:68`,
  `refundDeposit:100,106`, `revertDepositRefund:120,122`, `getUserInvoices:136`, `updatePayment:158,169`,
  `deletePayment:183,185`. This is the money-mutation surface for the entire checkout flow
  (`CheckoutInvoiceModal.tsx`, 1988 lines) and it has **zero** compile-time contract. This is a real
  contract hole, not a style nit: a backend field rename on any of these responses is invisible to `tsc`.
- **`api/bookings.service.ts`** — 6 `any` sites, all internal to the two hand-rolled
  pagination-flattening methods (`getAllBookings:56,59,69`, `getBookingsPage:341,344,346`) plus one
  double-cast `bookings as any as BookingWithDetails[]:374`. These are lower risk (internal to a single
  function, final return type is still checked) but the double-cast at :374 is a smell — it exists to
  force an unrelated shape (`Booking[]` widened to `BookingWithDetails[]`) past the checker rather than
  reconciling the two types.
- **`api/ledger.service.ts`** — 3 `any` sites (`getCustomerLedgers:43`, `getLedgersPage:105`), same
  pagination-loop pattern as bookings.service.ts.
- **`api/paymentApprovals.service.ts` / `api/client.ts`** — 0 `any` usages. Fully typed.
- **Hooks:** `features/bookings/hooks/useBookingQueries.ts:22,32` cast `params as any` /
  `filters as any` when calling `BookingsService.getBookingsPage`/`getBookingsWithDetails` — **this one
  is hiding a real gap**: the hook's own param type is `type BookingsPageParams = Record<string,
  unknown>` (`useBookingQueries.ts:17`), a deliberately untyped bag, while the service methods it calls
  have specific, named 13-key parameter interfaces (`api/bookings.service.ts:308-321`). A misspelled or
  renamed filter key (e.g. `roomNumber` vs `room_number`) compiles cleanly, is silently dropped by the
  service's manual `if (params.x)` allow-list, and produces a query that quietly ignores that filter —
  no error anywhere in the chain. Other hook-level `any` usages (`useCheckInFormData.ts:12,46`,
  `useEnhancedCheckInModalState.ts:38,42`, `useCheckoutFlow.ts:138`) are local UI-state/catch-clause
  uses, not response-contract holes.

## 3. Service-layer consistency

- **client.ts usage:** all four services route exclusively through `api` (the shared `ky` instance from
  `api/client.ts`) — zero raw `fetch(` calls found in any of the four files.
- **Error handling is NOT consistent across the four services:**
  - `bookings.service.ts` and `invoices.service.ts` wrap every call in `try { } catch (error) { if
    (error instanceof HTTPError) {...throw new APIError(...)} }`, normalizing failures to `APIError`.
  - `ledger.service.ts` and `paymentApprovals.service.ts` have **no try/catch anywhere** — they only
    wrap calls in `withRetry(...)` and let ky's raw `HTTPError` propagate. A caller that does
    `catch (e) { if (e instanceof APIError) ... }` (a pattern used elsewhere in the app) will silently
    fail to match a `LedgerService`/`PaymentApprovalsService` error.
  - Net effect: the same logical failure (e.g. a 409 conflict) surfaces as an `APIError` from one
    service and a bare ky `HTTPError` from another, depending only on which of the four files made the
    call.
- **Duplicated endpoint-string logic, not endpoint strings themselves:** `getAllBookings`
  (`bookings.service.ts:48-90`) and `getCustomerLedgers` (`ledger.service.ts:17-66`) each independently
  implement "fetch page 1 at pageSize=500, then `Promise.all` the remaining pages" — the same algorithm,
  copy-pasted, with no shared helper. A future fix to the pagination-fan-out logic (e.g. a max-page
  safety cap, or switching to cursor pagination) has to be made twice and can easily be made once.
- **Dead service methods (defined here, zero callers anywhere in `hotel-web-fe/src`, verified by
  grepping the full tree excluding this file and `*.test.ts`):**
  - `BookingsService.preCheckInUpdate` (`bookings.service.ts:240-255`) — backend route is real and wired:
    `PATCH /bookings/{id}/pre-checkin` (`routes/bookings.rs:57`, handler
    `pre_checkin_update_handler`).
  - `BookingsService.convertComplimentaryToCredits` (`bookings.service.ts:428-446`) — backend route real:
    `POST /bookings/{id}/convert-credits` (`routes/bookings.rs:62-63`, handler
    `convert_complimentary_to_credits_handler`).
  - `InvoicesService.getUserInvoices` (`invoices.service.ts:136-150`) — backend route real: `GET
    /invoices` (`routes/payments.rs:72`, handler `get_user_invoices_handler`).
  - `LedgerService.getCustomerLedgerSummary` (`ledger.service.ts:164-166`) — backend route real and
    fully working (`routes/ledgers.rs:29`, `handlers/ledgers.rs:87`, `repositories/ledger.rs:896`,
    a proper SQL `SUM`/`COUNT FILTER` aggregate). See §5/§6 — this one matters more than the others
    because a much more expensive workaround exists in its place.

## 4. Dev proxy check

`hotel-web-fe/vite.config.ts:18` defines `PROXY_PREFIXES = ['/api', '/uploads', '/health', '/ws']`.
Every domain in scope (bookings, ledgers, invoices, payments, admin/payments) is namespaced under the
single `/api` prefix at request-build time (`src/desktop/runtimeApi.ts:180-189`,
`ROOT_API_PREFIXES`/`withApiPrefix`, which rewrites any relative service call like `'bookings'` or
`'admin/payments/pending'` to `/api/bookings`, `/api/admin/payments/pending`, etc. before it leaves the
browser). Because the proxy list is a single generic `/api` catch-all rather than one prefix per domain,
**there is no missing-prefix risk for this architecture** — confirmed no gap.

## 5. Query architecture — key inventory (bookings / ledgers / invoices / paymentApprovals)

Factory: `hotel-web-fe/src/api/queryKeys.ts`. Config: `hotel-web-fe/src/api/queryConfig.ts`
(`staleTime`: realtime 15s / short 30s / standard 60s / long 5m / static 10m;
`gcTime`: standard 15m / long 30m; global defaults `staleTime: standard`, `gcTime: standard`,
`refetchOnWindowFocus: false`).

| Key | Factory site | Consumer(s) | staleTime used |
|---|---|---|---|
| `bookings.page(params)` | `queryKeys.ts:39` | `useBookingsPage`, `useBookingQueries.ts:22` | `short` (`useBookingQueries.ts:25`) |
| `bookings.withDetails(filters)` | `queryKeys.ts:40` | `useBookingsWithDetails`, `useBookingQueries.ts:32` | `short` (`:34`) |
| `bookings.list(filters)` | `queryKeys.ts:38` | `useAllBookings`, `useBookingQueries.ts:41` | `short` (`:43`) |
| `bookings.mine()` | `queryKeys.ts:41` | `useBookingQueries.ts:49` | `short` (`:52`) |
| `bookings.stats()` | `queryKeys.ts:42` | `useBookingQueries.ts:58` | `standard` (`:61`) |
| `bookings.detail(id)` | `queryKeys.ts:43` | `useBookingQueries.ts:67`; invalidated at `:138,154,168,180,203` | `short` (`:70`) |
| `bookings.timeline(id)` | `queryKeys.ts:44` | `useBookingQueries.ts:76`; invalidated `:139,155,169` | `short` (`:79`) |
| `bookings.paymentWorkflow(id)` | `queryKeys.ts:45` | `useBookingQueries.ts:85`, also read directly `:227` | `realtime` (`:88,229`) — correctly the tightest staleTime of any key in scope, appropriate for a money-balance field |
| `invoices.preview(bookingId)` | `queryKeys.ts:209` | `InvoiceModal.tsx:41`; invalidated `useBookingQueries.ts:141,156,182,204`, `CheckoutInvoiceModal.tsx:121` | `short` (`InvoiceModal.tsx:44`) |
| `invoices.payments(bookingId)` | `queryKeys.ts:210` | `useCheckoutInvoiceData.ts:69`; invalidated `CheckoutInvoiceModal.tsx:122` | `0` (`useCheckoutInvoiceData.ts:71`) — always refetch, correct for checkout-time payment history |
| `ledgers.list(params?)` | `queryKeys.ts:203` | **Two different hooks share this one key-builder for two different query shapes:** `useLedgers()` (`features/admin/hooks/useLedgers.ts:15`, no params → full-table fetch via `getCustomerLedgers`) and `useLedgersPage(params)` (`useLedgers.ts:46`, paginated/filtered via `getLedgersPage`) | `standard` for the full-list form (`useLedgers.ts:17`) vs `short` for the paginated form (`useLedgers.ts:47`) — **inconsistent staleness for the same key namespace** |
| `ledgers.payments(id)` | `queryKeys.ts:205` | `useCheckoutInvoiceData.ts:56` | `0` (`:58`) |
| `paymentApprovals.pending(page, perPage)` | `queryKeys.ts:214-215`, factory method | `usePendingPayments`, `usePaymentApprovalsQueries.ts:32` | `short` (`:36`) |
| `paymentApprovals.history` | **no factory method** — hand-built at call site: `[...queryKeys.paymentApprovals.all, 'history', page, pageSize]` (`usePaymentApprovalsQueries.ts:54`) | `usePaymentApprovalHistory` | `short` (`:58`) |
| `paymentApprovals.paypalConflicts` | `queryKeys.ts:216` | `usePaypalConflictEvents`, `usePaymentApprovalsQueries.ts:79` | `short` (`:101`) |

Findings from this inventory:

- **Inconsistent key construction:** `paymentApprovals.pending` and `.paypalConflicts` are factory
  methods; `.history` (same file, same resource family, added later) is a raw array literal built at
  the call site instead of a sibling factory method — the exact "array shape differs" pattern called
  out in the brief.
- **Overlapping/duplicate data under one key prefix, inconsistent staleness:** `ledgers.list` backs two
  materially different queries (full unpaginated table vs a filtered page) with two different
  `staleTime`s (60s vs 30s) for what is conceptually the same underlying resource. A mutation that calls
  `queryClient.invalidateQueries({queryKey: queryKeys.ledgers.all})` (which is what actually happens —
  see `useLedgers.ts:23` `reload()`, aliased to `loadData` in `CustomerLedgerPage.tsx:149` and called
  after every ledger/payment mutation) invalidates both by prefix match, so invalidation itself is not
  broken, but the two queries independently decide differently how long to trust a cache hit before that
  invalidation arrives.
- **staleTime for money data is otherwise well-judged:** `bookings.paymentWorkflow` uses `realtime`
  (15s), and both ledger/invoice payment-history queries force `staleTime: 0` (always refetch) at the
  moment they matter most (checkout). This is the correct pattern — the inconsistency is narrow (just
  the ledgers full-list-vs-page split and the payment-approvals history key), not systemic.

## 6. The concrete, verified efficiency/duplication finding behind the ledger summary

`features/admin/components/CustomerLedger/hooks/useCustomerLedgerWorkspace.ts:68-113` computes
`total_amount`/`total_paid`/`total_outstanding`/`pending_count`/`partial_count`/`overdue_count` (the
exact shape of `CustomerLedgerSummary`, `types/ledger.types.ts:171-179`) by summing **every ledger row**
client-side in JS (`sumMoney`/`toMoneyNumber` from `utils/money.ts`), fed by `useLedgers()`
(`features/admin/hooks/useLedgers.ts:11-27`) which calls `LedgerService.getCustomerLedgers()`
(`api/ledger.service.ts:17-66`) — a method that fetches ALL ledger rows by paging 500 at a time and
`Promise.all`-ing every remaining page. Meanwhile `repositories/ledger.rs:895-928` already computes this
exact aggregate server-side with one indexed `SUM`/`COUNT FILTER` query, exposed at `GET /ledgers/summary`
and wrapped by `LedgerService.getCustomerLedgerSummary()` (`api/ledger.service.ts:164-166`) — which,
per §3, has **zero callers**. As the ledger table grows, the client-side path degrades (more pages to
fan out, more JSON to parse, more floating-point summation in the browser) while the server-side path
stays O(1) round trips. This is the single highest-value "make drift/inefficiency impossible" target in
this audit: delete the client-side aggregation, call the existing summary endpoint, and the money-summary
tiles on `CustomerLedgerPage.tsx` get both cheaper and provably-correct (DB-side `Decimal` `SUM`, not
browser-side float summation via `toMoneyNumber`).

## 7. Money- and date-type representation

- **Dates:** confirmed clean — grepped `booking.types.ts`/`payment.types.ts`/`ledger.types.ts` for `:
  Date` (JS `Date` object typing); zero hits. Every date/datetime field on both sides is `string`
  (Rust `NaiveDate`/`DateTime<Utc>` → ISO string; FE always `string`). No Date-object mismatch anywhere
  in scope.
- **Money — real wire-format inconsistency, not just an FE typing choice:** `rust_decimal` is built
  with `serde` but **not** `serde-float` (verified directly:
  `target/release/.fingerprint/rust_decimal-*/lib-rust_decimal.json` → `["default","maths","serde","std"]`
  for every instance in the dep graph). With `serde-float` absent, `Decimal`'s documented serde
  behavior for a human-readable format (JSON) is to serialize as a **string** (e.g. `"123.45"`) to
  preserve precision — this was confirmed from the enabled-feature evidence, not from independently
  executing the serializer in this session, so treat the *specific string-vs-number claim* as inferred
  from well-established, documented crate behavior rather than directly observed output. By contrast,
  fields typed as plain `f64` in the Rust models (`BookingStats.total_revenue`,
  `BookingRevenuePoint.revenue`, `models/booking.rs:42-58`) serialize as ordinary JSON numbers. Both
  kinds of field appear in booking-adjacent responses. FE compensates by typing nearly every money field
  in `Booking`/`CustomerLedger`/`Invoice` as a blanket `number | string` union — which is a safe union
  but erases the information a reader needs (which representation does *this* field actually use), and
  would not catch a future refactor that flips a specific field between `Decimal` and `f64` (the
  `.claude/rules/lessons.md` 2026-07-26o and 2026-07-26s entries record two separate incidents in this
  exact codebase where a Rust type/column mismatch on a money or date field shipped silently past
  `cargo check`/clippy/the full test suite). `utils/money.ts` (`toMoneyNumber`/`sumMoney`) does
  correctly normalize both representations before arithmetic, which is why this has not visibly broken
  money math yet — but it is defense-in-depth around an admittedly ambiguous contract, not a fix for the
  contract itself.
- **`Option<T>` vs FE optional (not nullable) properties:** none of the structs checked
  (`Booking`, `BookingWithDetails`, `CustomerLedger`, `Invoice`) use
  `#[serde(skip_serializing_if = "Option::is_none")]` on their `Option<T>` fields (only two fields on
  `Booking` use the different, unconditional `#[serde(skip_serializing)]` to hide a security-sensitive
  token, `models/booking.rs:106-110`). Default serde behavior for a plain `Option<T>` field is to
  serialize `None` as JSON `null`, with the key always present — never an omitted key. The FE types
  represent almost all of these as `field?: T` (optional key, typed as `T | undefined`, not
  `T | null`) rather than `field: T | null`. The one place in scope that gets this right is
  `GuestPaymentConfig`/`GuestBankDetails` (`types/payment.types.ts:71-82`, `string | null`), proving the
  correct pattern is already known in this codebase, just not applied consistently. Practical risk is
  currently dampened for money fields specifically because `utils/money.ts` treats `null` and
  `undefined` identically, but the same imprecision on non-money optional string/date fields
  (`company_name`, `remarks`, `payment_note`, `due_date`, etc.) has no equivalent safety net.

## 8. Proposed target

1. **Kill the `any` boundary in `invoices.service.ts` first** — it is the single highest-leverage fix
   in this audit (§2/§3): give every method a real return type built from the *actual* Rust shapes
   (`billing_name`-based `Invoice`, not the `customer_name`-based fantasy type), and delete/replace
   `types/payment.types.ts`'s `Invoice`/`InvoicePreview` to match. Do this before anything else in this
   area — right now the type system asserts something the runtime doesn't deliver, which is worse than
   no type at all.
2. **Generate FE types from the Rust models instead of hand-writing them**, or at minimum add a CI check
   that fails loudly on drift. Two realistic options for this codebase (Rust backend + hand-rolled ky
   services, no OpenAPI layer today):
   - Adopt `ts-rs` (or `specta`) on the handful of structs that cross the wire for these three domains
     (`Booking`, `BookingWithDetails`, `Payment`, `Invoice`, `PaymentWorkflowSummary`, `CustomerLedger`,
     `CustomerLedgerPayment`, and their `*Request`/`*Response` siblings) — annotate them once, run the
     exporter in `cargo test`/CI, and commit the generated `.ts` under
     `hotel-web-fe/src/types/generated/`. Hand-written types stay for pure-FE-only shapes (form state,
     UI-only unions like `BookingEditFormData`).
   - If a full codegen adoption is too large a lift right now, the cheaper interim step is a **contract
     test**: a backend integration test (or a script run in CI) that serializes one real instance of each
     struct in scope and asserts the JSON key set against a checked-in `.json` fixture, so any field
     rename/add/remove on the Rust side fails a build instead of silently drifting from the hand-written
     FE type. This directly targets the two mismatches proven in §1 (Invoice, Booking).
3. **Fix the `Option<T>` → nullable mapping at the codegen/generation boundary**, not field-by-field:
   whichever of the two options above is chosen, the generator (or the contract-test fixture) should
   assert `T | null` for every `Option<T>` field unless the Rust side explicitly adds
   `skip_serializing_if`. This retires the systemic issue in §7 in one place instead of 150+ individual
   field annotations.
4. **Standardize money wire format** at the Rust source rather than papering over it on the FE: either
   (a) wrap `BookingStats.total_revenue`/`BookingRevenuePoint.revenue` in `Decimal` so every money field
   in scope has one representation, or (b) keep the split but have the codegen tool tag `Decimal` fields
   as `MoneyString` and plain numeric fields as `number`, so the *type name itself* (not a blanket
   `number | string` union) tells a reader which one a given field is. Either way, funnel all reads
   through `utils/money.ts` (already true almost everywhere) and add an ESLint rule banning direct
   arithmetic (`+`, `-`, `.toFixed(`) on any field typed as `MoneyString`/`Decimal`-sourced without
   going through it first.
5. **Add the missing `queryKeys.paymentApprovals.history(page, pageSize)` factory method** (§5) and
   split `ledgers.list` into two named factory entries (`ledgers.fullList()` and
   `ledgers.page(params)`) with one shared `staleTime` policy decision instead of two hooks silently
   picking different values for the same key prefix.
6. **Delete the client-side ledger summary aggregation** (§6) and call the already-working
   `GET /ledgers/summary` via `LedgerService.getCustomerLedgerSummary()` instead — this is a pure win
   (less code, cheaper, and moves money arithmetic into Postgres `Decimal` math instead of browser
   floats) and does not require any of the larger codegen work above to ship immediately.
7. **Pick one error-shape convention for all four services** (§3) — either every service method
   normalizes to `APIError`, or none do and all callers handle ky's `HTTPError` directly. Right now it
   silently depends on which file you're calling into.
