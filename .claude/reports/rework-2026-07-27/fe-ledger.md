# FE Ledger / City-Ledger Audit — CustomerLedgerPage tree

Scope: `hotel-web-fe/src/features/admin/components/CustomerLedger/**`,
`features/admin/hooks/useLedgers.ts(.test)`, `api/ledger.service.ts(.test)`,
`types/ledger.types.ts`, ledger-touching parts of `features/invoices/**`.
Backend cross-checked in `hotel-app-be/src/repositories/ledger.rs` and the V1
baseline DDL where a FE claim needed a BE-side comparison.

## 1. Inventory: CustomerLedgerPage.tsx (2268 lines)

- Imports (1-138): 10 already-extracted dialogs (`DuplicateLedgerDialog`,
  `VoidLedgerDialog`, `EditLedgerDialog`, `DeleteCompanyDialog`,
  `CreditNoteDialog`, `CompanyFormDialog`, `CreateLedgerDialog`,
  `PaymentDialog`, `CompanyCheckInDialog`, `RecordCompanyPaymentDialog`,
  `CompanyInvoiceDialog`) + 6 presentational components (`LedgerSummaryStrip`,
  `CompanyListPane`, `CompanyDetailHeader`, `CompanyBalanceMeter`,
  `ActiveGuestsRow`, `LedgerEntriesTab`, `CompanyInfoTab`) + the
  `useCustomerLedgerWorkspace` aggregation hook (line 138). **The `components/`
  and `hooks/` decomposition already happened for presentation** — every
  `<Dialog>`/`<Tabs>` node in the JSX return is a child component, not inline
  markup (verified by grepping the return block, lines 1683-2268: the only
  JSX owned directly by the page is a `<Tabs>`/`<Tab>` pair at line ~1899 and
  layout `<Box>`/`<Card>` wrappers).
- State block (143-352, 89 `useState` calls, `grep -c "useState<\|useState("` =
  89): grouped by feature already via comments — create-ledger (153-200),
  edit-ledger (163-168), void (171-174), single-ledger payment (177-195),
  payment-date-edit (222-224), company check-in (227-256, 12 states — the
  single largest block), company register (257-274), company edit (275-293),
  company delete (294-298), company bulk-payment/distribution (299-313),
  company invoice (314-326), credit note (327-333), page-level filters/tabs
  (334-352).
- Handlers (354-1673, ~40 named `handle*`/`load*` functions): grouped 1:1 with
  the state blocks above. Largest: `handleCompanyCheckIn` (528-679, 151
  lines — creates guest, then `api.post('bookings', …)` directly instead of
  `BookingsService`, then `BookingsService.updateBooking`, then
  `BookingsService.checkInGuest`: three sequential unguarded calls, no
  compensation if a later call fails), `handleRecordCompanyPayment` (933-1023,
  91 lines, see §2 finding F1), `handleRegisterCompany` (717-779).
- Hooks: `useEffect` x4 (359, 370, 1527, plus one inside
  `useCustomerLedgerWorkspace.ts`), `useMemo` x5, `useCallback` x4
  (`isVoidedLedger` 917, `getLedgerBalanceDue` 921, `isInvoiceEligible` 925,
  plus one more).
- JSX (1683-2268, 585 lines): thin composition of the extracted children.

**Decomposition target** (naming concrete files, not just "split it up"):
- `hooks/useCompanyCheckIn.ts` — pull state block 227-256 + handlers
  507-679 (`handleOpenCheckInDialog` … `handleCheckOutDateChange`) out
  verbatim; this is the single largest coherent unit (12 states + 6 handlers,
  ~200 lines) and has zero coupling to the ledger-entries tab.
- `hooks/useCompanyPaymentFlow.ts` — state 299-313 + `handleOpenCompanyPaymentDialog`/
  `resetCompanyPaymentForm`/`handleRecordCompanyPayment` (889-1023); fix F1
  (below) belongs here regardless of the extraction.
- `hooks/useCompanyInvoiceFlow.ts` — state 314-326 + 1026-1128
  (`handleOpenCompanyInvoiceDialog` … `handleDownloadCompanyInvoice`); fix F2
  (below) belongs here.
- `hooks/useCompanyDirectory.ts` — company register/edit/delete state+handlers
  (257-298, 717-886) plus `loadCompanies` (428-447); these three handlers share
  no state with the ledger-entries side of the page at all.
- Single-ledger CRUD (create/edit/void/payment/credit-note, ~1130-1673) is
  already the most cohesive remaining block and can stay in the page or move
  to one `useLedgerEntryActions.ts` hook.
- After these four extractions the page component would be state-orchestration
  + JSX composition only, roughly 250-350 lines — comparable to what
  `useCustomerLedgerWorkspace.ts` (226 lines) already achieved for the
  read-side aggregation. This is a size estimate from the line ranges above,
  not a re-count of a hypothetical file.

## 2. Money-display correctness (highest severity — verified against BE)

**F1 — BLOCKER. Bulk "Record Company Payment" reuses one receipt number across
every backend call it makes; the backend rejects duplicates, so paying off
≥2 ledgers with one receipted payment always fails on the 2nd ledger, and the
1st ledger's payment already committed with no rollback.**
`handleRecordCompanyPayment` (CustomerLedgerPage.tsx:965-982) loops over
`selectedLedgersForPayment` and calls
`LedgerService.createLedgerPayment(ledger.id, { …, receipt_number:
companyPaymentForm.receipt_number || undefined, … })` (line 977) — the exact
same `receipt_number` string on every iteration. Backend
`create_ledger_payment` (repositories/ledger.rs:775-793) does a global,
ledger-agnostic uniqueness check: `SELECT EXISTS(SELECT 1 FROM
customer_ledger_payments WHERE LOWER(receipt_number) = LOWER($1))` and returns
`ApiError::BadRequest("Receipt number already exists")` on any hit. So: ledger
#1 in the loop succeeds and inserts a payment row carrying that receipt
number; ledger #2 in the same loop throws immediately. The `try/catch` wraps
the whole loop (933-1022), so the user sees one generic "Failed to record
payment: Receipt number already exists" (line 1019) with no indication that
part of the money was already posted to ledger #1 — a retry with the full
original amount risks overpaying ledger #1 or the admin abandoning the flow
believing nothing was recorded. The client-side pre-check at lines 951-960
(`activeCompanyPayments` scan) cannot catch this because it only knows about
payments loaded before this submission started, not the one this exact loop
is about to create. **This breaks the core promise of the feature** ("record
one payment, distribute it across the company's outstanding entries")
whenever the user supplies a receipt number and more than one ledger needs an
allocation — which is the common case for this dialog.
- Can FE and BE disagree: yes, deterministically, not a race — it fires on
  literally every multi-ledger allocation with a receipt number filled in.
- Recommendation: give each ledger's created payment a distinguishing
  suffix (e.g. `${receiptNumber}-${index}`) or, better, add a batch
  server-side endpoint that performs the whole distribution in one
  transaction and does the receipt-uniqueness check once for the batch.

**F2 — BLOCKER. Generating a "Company Invoice" (Print/Download) never
persists `invoice_number` on the underlying ledger rows — the whole flow is
client-only.**
`CompanyInvoiceDialog`'s only actions are Preview (`handlePreviewInvoice`,
1093-1108, pure state), Print (`handlePrintCompanyInvoice` → `printCompanyInvoice`,
1110-1112) and Download (`handleDownloadCompanyInvoice` → `downloadCompanyInvoice`,
1114-1128). Verified `customerLedgerPrint.ts` end to end (505 lines): it
imports no `api`/`LedgerService`, contains no `await`, and both functions
build an HTML string and either open a hidden `<iframe>` and call
`.print()` (line 20-42, `printHtmlViaIframe`) or trigger a client-side
download — there is no network call anywhere in the file. Grepping the page
for every `LedgerService.` call site (13 call sites total: lines 973, 987,
1216, 1304, 1333, 1363, 1367-1368, 1401, 1414, 1432, 1435, 1454, 1658) shows
none of them touches `invoice_number` for the entries selected in the invoice
dialog — the only `updateCustomerLedger` call (1304) belongs to the unrelated
single-entry Edit dialog. Consequence: `isInvoiceEligible` (925-927, gated on
`!ledger.invoice_number`) will keep classifying the just-invoiced entries as
`ready_to_invoice` forever; `getLedgerUiStatus` will never return `'invoiced'`
for them; the "Invoiced" filter tab and `invoiceFilterCounts.invoiced` will
never count them; and nothing prevents printing/downloading a second,
differently-numbered "invoice" for the same entries next week — there is no
server record that invoice `INV-XXX` was ever issued, so this workflow has
no audit trail and no idempotency guard. Contrast with the credit-note
(`reverseLedger`) and single-entry edit flows, which both do reach the
backend and do persist `invoice_number`/state changes — this makes the gap
easy to miss in review since "issuing an invoice" reads as symmetrical to
those.
- Recommendation: after Print/Download succeeds, call
  `LedgerService.updateCustomerLedger(id, { invoice_number, invoice_date,
  due_date })` for every id in `selectedInvoiceLedgers` (ideally via one new
  batch endpoint, mirroring F1's needs), or the UI copy must stop implying
  the entries are "invoiced" afterward.

**F3 — HIGH. `useCustomerLedgerWorkspace.ts`'s `summary` and
`companyAggregates` sum every ledger's raw `amount`/`paid_amount`/`balance_due`
with no exclusion for voided rows — unlike the backend's own summary
endpoint and unlike the page's own voided-aware helper used two lines away
in the same file tree.**
`summary` (useCustomerLedgerWorkspace.ts:68-94) does
`total_outstanding = sumMoney([total_outstanding, ledger.balance_due])` (line
79) for every ledger in the full list with no status filter.
`companyAggregates` (96-113) does the same per company:
`current.due = sumMoney([current.due, balance])` (line 106) where `balance =
toMoneyNumber(ledger.balance_due)` (line 103) — again unconditional. Compare:
(a) backend `get_ledger_summary` (repositories/ledger.rs:896-932) explicitly
does `FROM customer_ledgers WHERE status NOT IN ('void')` before summing —
the backend's own intended semantics exclude voids from every total; (b) the
DDL (`0001_v1_baseline.sql:2053`) defines `balance_due numeric(10,2) GENERATED
ALWAYS AS ((amount - paid_amount))` — a generated column, and `void_ledger`
(repositories/ledger.rs:935-981) only sets `status='void'`/`void_at`/`void_by`/
`void_reason`; it never touches `amount` or `paid_amount`, so a ledger voided
before being paid keeps its full original `balance_due` forever; (c)
`VoidLedgerDialog.tsx` tells the user "Voiding a ledger entry marks it as void
and **removes its outstanding balance**" (line ~39) — a promise the data
model does not keep, only the page's *own* `getLedgerBalanceDue`
(CustomerLedgerPage.tsx:921-923, `isVoidedLedger(ledger) ? 0 :
toMoneyNumber(ledger.balance_due)`) keeps it, by convention, at the call
sites that use it. `useCustomerLedgerWorkspace.ts` does not import or use
`isVoidedLedger`/`getLedgerBalanceDue` at all.
- Consumers that render the wrong number as a direct result:
  `LedgerSummaryStrip.tsx` "Total Billed"/"Outstanding" stats (lines 32-34,
  reading `summary.total_amount`/`summary.total_outstanding` verbatim);
  `CompanyListPane.tsx:312-317` (`isPositiveMoney(agg.due) ? formatCurrency(agg.due)
  : 'Settled'` — a company whose only debt was a voided, never-paid charge is
  shown owing money instead of "Settled"); `CompanyBalanceMeter.tsx:50,52`
  (due bar); `CustomerLedgerPage.tsx:1753` (`Record payment` menu item enabled
  via `isPositiveMoney(activeAgg.due)` even when no payable ledger actually
  exists for that company — opening the dialog then shows nothing to pay,
  since `handleOpenCompanyPaymentDialog` line 892-896 correctly filters with
  `getLedgerBalanceDue`+`isVoidedLedger`, exposing the inconsistency to the
  user as a confusing empty dialog).
- The characterization-test fixture bakes the wrong assumption in rather than
  catching it: `CustomerLedgerPage.test.tsx:368-381` builds its voided fixture
  entry with `balance_due: 0` explicitly, with a comment ("plus a zeroed-out
  voided entry") that only holds if a ledger happens to be fully paid before
  it's voided — the UI has no such guard (`handleConfirmVoidLedger`,
  1450-1467, voids unconditionally). A void of a `pending` or `partial`
  ledger (the common real case — that's why staff void things) reproduces F3
  and is untested.
- Recommendation: `useCustomerLedgerWorkspace.ts` should route every
  amount/paid/balance accumulation through the same voided-aware getters the
  page already has (or, better, stop recomputing this client-side at all —
  see F5).

**F4 — HIGH. Credit notes (ledger reversals) are never netted against the
original entry in any money aggregate, on either side of the stack — a
company's shown "due" total does not decrease after a credit note is
issued, and "Total Billed"/"Collected" inflate by the reversed amount.**
`create_ledger_reversal` (repositories/ledger.rs:984-1073) inserts a **new**
`customer_ledgers` row with the same `amount` as the original (bound at line
1046, `$13` = `original.amount`), `paid_amount = $13` too (so the reversal row
is immediately self-`'paid'`, `balance_due` generated to 0 for that row), and
`transaction_type` flipped to the opposite of the original (1007-1011,
`is_reversal = TRUE`, `original_transaction_id = ledger_id`). **It never
updates the original row** — its `status`, `amount`, `paid_amount` are
untouched, so its `balance_due` stays exactly what it was. `CreditNoteDialog.tsx`
documents this explicitly: "The original entry stays in the ledger and the
reversal is audit-tracked" — and `reversibleEntries`
(CustomerLedgerPage.tsx:2252, `activeCompanyAllEntries.filter(l =>
!isVoidedLedger(l) && !l.is_reversal)`) allows issuing a credit note against
any still-outstanding, unpaid entry, not only already-settled ones. Neither
aggregate consumer accounts for `transaction_type`: backend
`get_ledger_summary` (896-932) does plain `SUM(amount)`, `SUM(paid_amount)`,
`SUM(balance_due)` with no sign adjustment for credit rows; FE
`useCustomerLedgerWorkspace.ts`'s `summary`/`companyAggregates` (68-113) do
the identical unconditional sum. Net effect for a $500 pending charge that
gets a credit note: original row unchanged (`amount`=500, `balance_due`=500,
still "pending"), reversal row added (`amount`=500, `paid_amount`=500,
`balance_due`=0). Both "Total Billed" figures (BE and FE) now read $1000
instead of a net $500 or $0; "Collected" reads +$500 that was never actually
paid by the customer; and "Outstanding"/company `due` still reads the full
original $500 — **the credit note has zero effect on how much the UI says
the company owes**, contradicting the entire purpose of issuing one.
- This is a correctness defect in the aggregation math (transaction_type sign
  ignored) independent of any business-policy question. Whether the ORIGINAL
  entry should *also* be auto-voided/adjusted when a reversal is posted (so
  its own balance_due drops to 0) is a separate, genuine policy-decision — see
  §6 — and is not assumed here either way.
- Recommendation (mechanical, not a policy call): every SUM in
  `get_ledger_summary` and every accumulation in `useCustomerLedgerWorkspace.ts`
  should multiply by -1 for rows where `transaction_type === 'credit'`
  (or equivalently exclude reversal pairs and use `is_reversal`/
  `original_transaction_id` to net them), whatever the policy decision in §6
  turns out to be.

**Not a bug — confirmed correct pattern:** `CheckoutInvoiceModal.tsx:205-212`
deliberately mirrors `ledger.amount`/`ledger.balance_due` as the display
source of truth for a city-ledger checkout invoice instead of recomputing
from booking charges, with an explicit comment explaining the divergence
risk. `utils/money.ts` uses integer minor-units arithmetic throughout
(`toMinorUnits`/`fromMinorUnits`); no float-rounding bug was found in any FE
money computation in this tree — every `sumMoney`/`subtractMoney`/`minMoney`
call site checked (CustomerLedgerPage.tsx:945-946, 968-981, 1079-1088) uses
the safe helpers correctly. The one plain-JS-number reduction found
(`useCustomerLedgerWorkspace.ts:68-94`) is a correctness/void-exclusion bug
(F3), not a precision bug — it still goes through `sumMoney`/`toMoneyNumber`.

**F5 — MEDIUM, duplication/deadcode.** `LedgerService.getCustomerLedgerSummary()`
(api/ledger.service.ts:164-166, wrapping `GET /ledgers/summary` →
`get_ledger_summary_handler`, which correctly excludes voided rows) is
defined and has its own passing unit test
(`ledger.service.test.ts:251-256`) but is **never called from any page or
component** (`grep -rn getCustomerLedgerSummary hotel-web-fe/src` hits only
its own definition and its own test). The FE instead reimplements the same
number client-side in `useCustomerLedgerWorkspace.ts`, less correctly (F3).
Using the real endpoint for the headline strip would fix F3's "Total
Billed"/"Outstanding" cells for free (though `companyAggregates`'
per-company breakdown still needs a per-company fix or a new grouped
endpoint, since `get_ledger_summary` is hotel-wide only).

## 3. Status derivation — FE vs BE

FE (`helpers.ts:69-82`, `getLedgerUiStatus`) returns one of `'voided' |
'paid' | 'overdue' | 'partial' | 'invoiced' | 'ready_to_invoice' | 'draft'`
(the union is declared at `types.ts:14-22`). Verified the final `return
'draft'` (line 81) is dead: every path reaching it has already passed the
`!isPositiveMoney(balance)` check at line 76 (which returns `'paid'`
first), so `balance` is provably positive by line 80, making
`isPositiveMoney(balance)` at line 80 always true and `'ready_to_invoice'`
always win before `'draft'` is reached. **This is already known and pinned**:
`helpers.test.ts:185-199` has a test explicitly titled "documents that the
'draft' branch is dead code" with the same reasoning. Not re-reporting as a
new discovery, but flagging the follow-on inconsistency below since it
wasn't in that test's scope.

BE `valid_status` CHECK constraint (`0001_v1_baseline.sql:2058`) allows
exactly `'pending' | 'partial' | 'paid' | 'overdue' | 'void'` — five raw
storage values, confirmed by direct DDL read. The FE's 7-value UI union is a
deliberate richer *display* classification layered on top (e.g. splitting
"pending with no balance issue" into `ready_to_invoice`/`invoiced`/`draft`),
not a 1:1 mirror, and that's a reasonable design choice, not a bug per se.

**Mismatch worth flagging:** the backend's *own* `ui_status_clause`
(repositories/ledger.rs:82-92, used by `getLedgersPage`'s `ui_status` filter
— which the FE **does** call, via `useCustomerLedgerWorkspace.ts:184`,
`activeLedgerPageParams.ui_status = entriesStatusFilter` for the per-company
paginated entries tab) has its own `'draft'` arm: `void_at IS NULL AND
COALESCE(balance_due, 0) <= 0 AND status <> 'paid'` (line 91). Unlike the
FE's dead branch, this one is server-side **reachable** — a row with
`balance_due <= 0` (fully offset) whose stored `status` column hasn't been
advanced to `'paid'` (e.g. via a path that doesn't call the `new_status`
logic in `create_ledger_payment`/`update_ledger_payment`/`delete_ledger_payment`,
or a still-`'pending'` row that reaches zero balance some other way) would
match `ui_status=draft` server-side, while the client-side `getLedgerUiStatus`
run against that exact same row would call it `'paid'` (line 76 fires first,
unconditionally, once balance is non-positive). Net effect: if a user ever
filters the paginated entries tab to `ui_status=draft` (the filter dropdown
would need a `'draft'` option wired to `EntryStatusFilter` for this to be
reachable from the UI — `EntryStatusFilter` at `types.ts:24-28` does **not**
currently include `'draft'`, so this is currently unreachable through this
page's own UI, but the backend endpoint and query param accept it and would
silently return zero rows or a different set than a client evaluating the
same rows would expect if any other caller/future filter option used it).
Both sides comment that they "mirror" each other
(repositories/ledger.rs:51-54) but there is no shared source or test
asserting the two stay in lockstep — a duplication/maintainability risk
rather than a live bug today.

## 4. Data flow: query keys, invalidation, pagination

- `useLedgers()` (features/admin/hooks/useLedgers.ts:12-38) → query key
  `ledgerQueryKeys.list()` = `['ledgers','list',{}]`
  (`queryKeys.ts:203`) → `LedgerService.getCustomerLedgers()`
  (api/ledger.service.ts:17-66): fetches **page 1 at page_size=500**, and
  if `total > 500`, fetches **every remaining page in parallel** (lines
  51-60) and concatenates. This is the hook `CustomerLedgerPage.tsx` uses
  (line 98/150) for `ledgers`, which feeds `summary`, `companyAggregates`,
  `companyListRows`, invoice-dialog population, duplicate-detection, and the
  bulk-payment allocation. **This is the unbounded, grows-without-limit
  fetch the task asked to check for**: every page load, and every mutation's
  `loadData()`/`reload()` (which calls `queryClient.invalidateQueries({
  queryKey: ledgerQueryKeys.all })` then `refetch()`,
  useLedgers.ts:22-26), re-fetches the **entire** `customer_ledgers` table
  in pages of 500. As the table grows across years of AR history this scales
  linearly with total row count on every single ledger action (void one
  entry → re-fetch 3000+ rows).
- `useLedgersPage(params, enabled)` (useLedgers.ts:41-49) → key
  `ledgerQueryKeys.list(params)` → `LedgerService.getLedgersPage(params)`
  (api/ledger.service.ts:68-…): real server-side pagination + filters
  (`search`, `status`, `ui_status`, `invoice_state`, `balance_state`, etc).
  **This is properly used** by `useCustomerLedgerWorkspace.ts:189`
  (`activeLedgerPageQuery`) to drive the per-company "Ledger Entries" tab
  (`activeCompanyEntries`/`activeCompanyEntriesTotal`, lines 195-201) — the
  visible entries table itself is not the unbounded-fetch problem; the
  page-level summary strip and the company list's per-row balances are.
- Invalidation: `ledgerQueryKeys.all = ['ledgers']`
  (`queryKeys.ts:25,202`); react-query's default `invalidateQueries` matches
  by key-prefix, so `reload()`'s `invalidateQueries({queryKey:
  ledgerQueryKeys.all})` does correctly also invalidate the paginated
  `useLedgersPage` cache entries (`['ledgers','list',{…params}]` shares the
  `['ledgers']` prefix) — verified by reading the key builders directly, no
  invalidation gap found here. Every ledger-mutating handler in the page
  (`handleCreateLedger` 1225, `handleUpdateLedger` 1311, `handleRecordPayment`
  1371, `handleSavePaymentDate` 1418, `handleDeletePayment` 1437,
  `handleConfirmVoidLedger` 1461, `handleRecordCompanyPayment` 995,
  `handleSubmitCreditNote` 1667, plus the initial-mount effect at 360 and
  `handleCompanyCheckIn` at 641) calls `loadData()` (aliased from `reload` at
  line 149), so mutation → invalidation coverage is consistently wired —
  no missing-invalidation site was found for the `ledgers` cache.
- Company mutations (`handleRegisterCompany`, `handleUpdateCompany`,
  `handleDeleteCompany`, lines 717-886) do **not** use react-query for
  `companies` at all — it's a plain `useState` populated by a manual
  `loadCompanies()` fetch (428-447) — each of the three calls its own
  `await loadCompanies()` afterward (772, 850, 879), which is consistent but
  means `companies` and `ledgers` are two independently-refetched,
  non-cached-together data sources on every mutation.
- Duplicate local type: `useCustomerLedgerWorkspace.ts:20-28` declares its
  own `export interface CustomerLedgerSummary { total_amount: number; … }`,
  same name as `types/ledger.types.ts:171-179`'s
  `CustomerLedgerSummary { total_amount: number | string; … }` (the real
  API-shaped type used by `getCustomerLedgerSummary()`'s return type). Two
  same-named, differently-typed interfaces in the same feature area is a
  duplication/maintainability risk (a future import of the wrong one, or a
  merge, would silently change `number|string` handling).

## 5. Aging / overdue — both sides, cited

- FE: `helpers.ts:66-67` `isDateOverdue = (d) => isHotelDatePast(d)`, used at
  `helpers.ts:77` inside `getLedgerUiStatus`:
  `if (ledger.status === 'overdue' || isDateOverdue(ledger.due_date)) return 'overdue';`
  — i.e. the FE treats a row as overdue if either the stored `status` column
  already says so, or the hotel-local calendar date has passed `due_date`,
  computed live in the browser via `utils/date.ts`'s hotel-timezone helper.
- BE: `repositories/ledger.rs:82-91` `ui_status_clause`'s `'overdue'` arm:
  `void_at IS NULL AND COALESCE(balance_due,0) > 0 AND (status = 'overdue' OR
  due_date < {today})` where `{today}` is `CURRENT_DATE` (server/DB
  timezone) — and `balance_state_clause` (73-79) independently excludes
  `status <> 'overdue' AND due_date >= {today}` from its `'outstanding'`
  bucket, the same logic mirrored a second time. The code comment at lines
  51-54 explicitly states this SQL "mirrors the frontend `getLedgerUiStatus`
  helper" — an intentional, acknowledged dual-implementation, not an
  oversight, but still two hand-maintained copies of the same rule (one in
  Rust-generated SQL, one in TypeScript) with no shared test asserting
  agreement between the `CURRENT_DATE` (DB timezone) and
  `isHotelDatePast`/hotel-settings-timezone (browser-side) definitions of
  "today" stay identical across timezone configurations.

## 6. Policy-decision (not a code call)

Should posting a credit note (F4) also automatically adjust or void the
*original* ledger entry so its own `balance_due` reflects the credit, or
should the original intentionally remain untouched (current behavior) as a
permanent historical record with reconciliation left to a human (e.g. via a
separate manual Void)? Two coherent designs:
(a) Keep current behavior (original untouched) but fix the aggregation math
(F4's mechanical recommendation) so netting happens only in the *totals*,
not the individual row — a company's `due` total correctly nets to zero
while the original row visibly still shows "$500 pending" plus a paired
"$500 credit" line, which is more audit-transparent but means an
entries-table consumer that filters "outstanding entries" only by row
status/balance_due (not by scanning for a paired reversal) would still see
the original as owed.
(b) Have the credit-note action also update the original row's status/paid
fields (or void it) so a single row's own `balance_due` reflects the net
effect, matching what `VoidLedgerDialog`'s copy already promises for the
void case. This changes the row-level audit trail shape and is a genuine
accounts-receivable policy call, not a code decision — do not implement
either without hotel-operations sign-off.

## 7. What CustomerLedgerPage.test.tsx pins

713-line characterization suite (`CustomerLedgerPage.test.tsx:1-8` states the
intent directly): mocks the `api` barrel, `api/client`, currency/router
hooks, print helpers, and all ~10 extracted dialog components + 7
presentational components, while keeping `useCustomerLedgerWorkspace` and
`helpers.ts` **real** so the aggregation/classification logic is exercised
for real against fixture data. Fixtures: 2 companies (`buildCompanies`),
4 ledger rows (`buildLedgers:340-397`) — Acme Corp has one `pending`
($500), one `partial` ($200 due, $100 paid), and one `void` entry
**deliberately pre-zeroed to `balance_due: 0`** (comment at line 337 calls
it "a zeroed-out voided entry" — this is the fixture assumption F3 shows
does not hold for real voided-with-balance rows); Zen Traders has one fully
`paid` + invoiced entry. Tests then assert: computed totals/per-company
aggregates and auto-selection of the highest-balance company (495-521);
company switching, search, due/clear quick filters (522-565); Info-tab
button swap (566-578); that entries search/status-filter/page/page-size
correctly thread into the paginated `useLedgersPage` params object
(579-609, this is the test that pins the `activeLedgerPageParams` shape from
`useCustomerLedgerWorkspace.ts:168-187`); opening the single-entry payment
dialog and loading its history (610-637); print/receipt helper invocation
(638-659); opening company-payment/company-invoice/credit-note dialogs
pre-scoped to the correct eligible-entry subsets via the Create menu
(660-701); opening create-ledger pre-filled for the active company
(702-713+). It does **not** cover: a voided entry with a nonzero balance
(F3), a multi-ledger company payment with a receipt number (F1), a
credit-note issued against an unpaid entry and its effect on aggregates
(F4), or any assertion that Print/Download persists `invoice_number` (F2) —
all four are genuine test-gaps directly tied to the correctness findings
above, not just coverage nice-to-haves.
