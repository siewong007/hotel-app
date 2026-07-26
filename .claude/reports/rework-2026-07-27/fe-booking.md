# Frontend Booking Surface Audit (admin + guest)

Scope: `hotel-web-fe/src/features/bookings/**`, `features/rooms/components/UnifiedBooking/**`,
`features/rooms/components/UpdateCheckoutDateDialog.tsx`, `features/rooms/hooks/useUnifiedBookingData.ts`,
`features/guestPortal/booking/**`, `utils/bookingUtils.ts`, `types/booking.types.ts`,
`api/bookings.service.ts`, `features/bookings/hooks/*`.

All line numbers below were obtained via Grep/Read in this session (2026-07-27); re-verify before
relying on them if this report is read later.

## File sizes (wc -l, verified this session)

| File | Lines |
|---|---|
| `features/bookings/components/Bookings/BookingsPage.tsx` | 2719 |
| `features/bookings/components/EnhancedCheckInModal.tsx` | 1968 (not in the original god-file list — should be added) |
| `features/rooms/components/UnifiedBooking/UnifiedBookingModal.tsx` | 1247 |
| `features/bookings/components/QuickBookingModal.tsx` | 944 (dead — see Finding 3) |
| `features/bookings/components/MyBookingsPage.tsx` | 874 |
| `api/bookings.service.ts` | 721 |
| `features/bookings/components/Bookings/BookingsPage.test.tsx` | 610 |
| `features/rooms/components/UnifiedBooking/components/*` (10 files) | 1128 total, already decomposed |
| `utils/bookingUtils.ts` | 392 |
| `types/booking.types.ts` | 297 |
| `features/bookings/hooks/useBookingQueries.ts` | 237 |
| `features/rooms/components/UpdateCheckoutDateDialog.tsx` | 262 |
| `features/bookings/hooks/useBookings.ts` | 191 |
| `features/guestPortal/booking/PortalBookingPage.tsx` | 232 |
| `features/bookings/hooks/useCheckInFormData.ts` | 89 |
| `features/rooms/hooks/useUnifiedBookingData.ts` | 81 |
| `features/bookings/hooks/useEnhancedCheckInModalState.ts` | 81 |
| `features/guestPortal/booking/utils.ts` | 74 |

Good news already in place: `features/bookings/hooks/useBookings.ts` already extracts ALL filter/sort/
pagination state and the four underlying queries (bookings page, rooms, stats, guests) out of
`BookingsPage.tsx`. `UnifiedBookingModal` already has a `components/` subfolder with 10 presentational
pieces. The remaining god-files are genuinely the orchestration/handler/JSX layer, not the whole feature.

---

## BookingsPage.tsx responsibility inventory (2719 lines)

Hook counts (grepped `useState(`/`useMemo(`/`useEffect(`/`useCallback(` in this file only —
excludes the ~15 more state values already moved into `useBookings()`):
- **27** local `useState` (lines 213–352): check-in form fields (9), workflow dialog (2), create/edit
  dialog (6 incl. `bookingDetailsOpen`, `bookingView`), void dialog (3), reactivate dialog (2),
  **complimentary dialog (5 — see Finding 4, entirely dead)**, payment dialog (2)
- **15** `useMemo` (lines 285, 312, 992–1131): active companies, edit-channel lookup, stats card
  config, `todayIso`, month options, pagination state, 7 view-filter derivations, `selectedBooking`
- **4** `useEffect` (241, 305, 445, 1137): permission-gated companies preload, edit-channel sync,
  available-rooms refetch on edit-date change, selected-booking auto-repair on view change
- **3** `useCallback` (1057, 1069, 1073): balance/eligibility predicates
- **5** mutation hooks wired in (154–158): `useUpdateBooking`, `useReactivateBookingMutation`,
  `useMarkBookingComplimentaryMutation`, `useRecordPaymentMutation`, `useCheckInGuestMutation`
- **1** direct (non-mutation-hook) service call: `BookingsService.voidBooking` at line 538 — see Finding 1

### Line-range map of responsibilities

| Lines | Responsibility |
|---|---|
| 1–142 | Imports, module types (`BookingView`, `SummaryStatCard`), `getErrorMessage`, `addMonthsToDateOnly` |
| 144–211 | Component setup: `isAdmin` perm flag, 5 mutation hooks, `useCheckoutFlow`, `useBookings()` (filters/pagination/base queries) |
| 213–365 | 27 local `useState` for 7 different dialogs' form fields |
| 367–443 | `reloadBookingData`, `handleEditBooking` (builds edit form state + fetches room-type config + available rooms) |
| 445–463 | `useEffect` refetching available rooms when edit dialog dates change |
| 465–527 | `handleUpdateBooking` (edit submit) |
| 528–557 | Void handlers — `handleVoidBooking`, `handleConfirmVoid` (bypasses mutation hook, Finding 1) |
| 559–579 | Reactivate handlers |
| 581–654 | **Complimentary handlers — entirely dead, Finding 4** |
| 655–740 | Payment-status update handlers |
| 741–836 | Check-in handlers (`handleCheckIn`, `handleConfirmCheckIn`) — duplicates `EnhancedCheckInModal`, Finding 8 |
| 837–871 | `handleViewInvoice`, `handleViewWorkflow` (ensureQueryData fetchers) |
| 873–931 | `getWorkflowEventIndicator` — presentation mapping (icon/label per timeline event type) |
| 932–999 | `canCheckIn`/`isEarlyCheckIn`/`canCheckOut`/`canVoid`/`canMarkComplimentary`/`canReactivate` eligibility predicates + `stats` memo |
| 1001–1056 | Date/format helpers (`getNights` — Finding 6, `formatShortDate`, `getGuestInitials`, `getBookingBalance`, `getBillingChipLabel`) |
| 1057–1130 | Balance/night-audit predicates + 7 client-filtered "view" memos (`arrivingBookings` … `visibleBookings`) — Finding 2 |
| 1131–1201 | `selectedBooking` memo, `useEffect` auto-select, in-house guest count, outstanding-due sums |
| 1156–1201 | `selectBookingView`, `handleTakePaymentAction`, `statusDotColor` |
| 1202–1278 | `summaryStatCards` array construction |
| 1279–1828 | **Main render**: header, filter row, summary-card grid, booking card list + pagination, selected-booking detail aside (buttons at 1780–1815 — Finding 5) |
| 1829–1987 | Workflow timeline `<Dialog>` JSX |
| 1989–2038 | `<UnifiedBookingModal>` embed (create) |
| 2039–2347 | Edit Booking `<Dialog>` JSX (~300 lines, admin-only form) |
| 2348–2385 | Void `<Dialog>` JSX |
| 2386–2408 | Reactivate `<Dialog>` JSX |
| 2409–2575 | Payment-update `<Dialog>` JSX |
| 2576–2718 | Check-in `<Dialog>` JSX (~140 lines) |

### Decomposition proposal (concrete file targets)

1. **`hooks/useBookingActionDialogs.ts`** — move all void/reactivate/complimentary/payment-status
   handler logic (lines 528–740, ~210 lines) plus their `useState` (277–352) out of the container.
   Return `{ open, target, submit, ... }` per dialog. Fold in the fix for Finding 1 (route void
   through a new `useVoidBookingMutation()` that calls `invalidateBookingDependencies`) and delete
   the dead complimentary block per Finding 4 (or wire it to a real trigger — a product decision).
2. **`hooks/useBookingViews.ts`** — move `operationsBookings`/`arrivingBookings`/`departingBookings`/
   `inHouseBookings`/`upcomingBookings`/`dueBookings`/`normalDueBookings`/`companyDueBookings`/
   `visibleBookings`/`selectBookingView` (lines 1057–1201) into a dedicated hook. This is also the
   right place to fix Finding 2 (replace the full-table `useBookingsWithDetails()` source with a
   real backend aggregate).
3. **`components/BookingSummaryCards.tsx`** — `summaryStatCards` construction (1202–1278) + the
   summary-card grid JSX (~1330–1408), presentational only.
4. **`components/BookingListPanel.tsx`** — the booking-card list + pagination JSX (~1408–1687).
5. **`components/BookingDetailPanel.tsx`** — the right-hand selected-booking aside (~1687–1828),
   including the action-button row; this is the natural place to add the permission gating from
   Finding 5.
6. **`components/WorkflowTimelineDialog.tsx`** — lines 1829–1987 plus `getWorkflowEventIndicator`
   (873–931).
7. **`components/EditBookingDialog.tsx`** — lines 2039–2347 plus `handleEditBooking`/
   `handleUpdateBooking` (374–527); this alone removes ~350 JSX lines and ~10 of the 27 `useState`.
8. **`components/VoidBookingDialog.tsx`**, **`ReactivateBookingDialog.tsx`**,
   **`RecordPaymentDialog.tsx`** — lines 2348–2408, 2409–2575 respectively, small self-contained dialogs.
9. **Check-in**: do not just relocate lines 2576–2718 into a `CheckInDialog.tsx` — first resolve
   Finding 8 (unify with `EnhancedCheckInModal.tsx` instead of shipping a second implementation).

Net effect: `BookingsPage.tsx` container would shrink to composition + the 4 queries from
`useBookings()` + wiring the extracted hooks/dialogs — plausibly under 400 lines.

---

## UnifiedBookingModal.tsx vs QuickBookingModal.tsx (Finding 3)

Both implement an independent "create a booking" flow: guest lookup/creation, room availability
check, rate/tax computation, extra-bed charge, tourism-tax preview, and a call to
`BookingsService.createBooking`. Compared field-for-field:

- Guest creation: both call guest-creation APIs directly with first/last name, email, phone, IC.
- Rate math: both compute `nights × rate + extra_bed_charge + tourism_tax` client-side as a preview
  (`UnifiedBookingModal.tsx:813-827`, `QuickBookingModal.tsx` around its own local state).
- Submit payload: both build a `BookingCreateRequest`-shaped object and call
  `BookingsService.createBooking` directly (`UnifiedBookingModal.tsx:583`; `QuickBookingModal.tsx:342`).

**However, `QuickBookingModal.tsx` is dead code.** Verified via:
- `grep -rln "QuickBookingModal" src --include="*.tsx"` outside its own file: zero hits.
- It is re-exported from `features/bookings/index.ts:2`, but nothing imports that barrel export either.
- `git log -1` on the file shows its last change was today's commit `beb34e040` ("restructure user
  module... remove HotelAPIService compat layer") — a purely mechanical import rewrite
  (`HotelAPIService` → `BookingsService, GuestsService`) that kept 944 lines of unreachable code
  compiling through an unrelated refactor.

**Recommendation is structural, not a duplication merge**: delete `QuickBookingModal.tsx` (and its
barrel export) rather than reconciling its logic with `UnifiedBookingModal`.

---

## Findings

### 1. [correctness] Three booking-mutation entry points bypass the shared cache-invalidation
infrastructure, leaving ledgers/invoices/dashboard/analytics stale after common actions

Every mutation that goes through `features/bookings/hooks/useBookingQueries.ts` (`useUpdateBooking`,
`useReactivateBookingMutation`, `useMarkBookingComplimentaryMutation`, `useRecordPaymentMutation`,
`useCheckInGuestMutation`) calls `invalidateBookingDependencies(queryClient)`
(`api/queryInvalidation.ts:8-19`), which invalidates 10 query-key namespaces including
`ledgers.all`, `invoices.all`, `dashboard.all`, `analytics.all`, `nightAudit.all`, `complimentary.all`.

Three real money/state mutations do **not** go through this path:
- **Void**: `BookingsPage.tsx:538` calls `BookingsService.voidBooking(...)` directly (no
  `useMutation`, no `invalidateBookingDependencies`), then only calls `reloadBookingData()`
  (`BookingsPage.tsx:367-369`), which is `Promise.all([loadData(), summaryBookingsQuery.refetch()])`
  — `loadData` (`useBookings.ts:100-102`) refetches only `bookingsQuery`/`statsQuery`/
  `guestsQuery`/`roomsQuery`. Backend confirms void has real side effects beyond the `bookings`
  table: `void_booking_payments_tx` sets `payments.status = 'void'`
  (`hotel-app-be/src/repositories/bookings/lifecycle.rs:2798-2811`) and
  `restore_complimentary_credits_tx` writes `guest_complimentary_credits`
  (`lifecycle.rs:2828-2860`) — neither `invoices`, `ledgers`, `complimentary`, `dashboard`,
  `analytics`, nor `nightAudit` caches are invalidated by the FE after a void, despite the response
  itself carrying `affected_night_audit_dates`.
- **Guest self-cancel**: `MyBookingsPage.tsx:143,145` calls
  `BookingsService.cancelMyPendingBooking(...)` directly, then only `myBookingsQuery.refetch()` — no
  `bookings.all`/`rooms.all` invalidation, so an admin's `BookingsPage`/`RoomManagementPage` open in
  another tab/session will not reflect a guest-cancelled booking or freed room until manual reload.
- **Create**: `UnifiedBookingModal.tsx:583` (`createBookingsForSelectedRooms`) calls
  `BookingsService.createBooking(...)` directly and relies entirely on a caller-supplied
  `onRefreshData` prop instead of `useCreateBooking()` (which exists in
  `useBookingQueries.ts:120-129` and does the correct `invalidateBookingDependencies`). The three
  real callers each hand-roll a different, narrower refresh:
  - `BookingsPage.tsx:2002` → `onRefreshData={reloadBookingData}` (bookings/stats/guests/rooms only)
  - `RoomManagementPage.tsx:1647` → `onRefreshData={loadData}` (that page's own room-focused reload)
  - `GuestConfigurationPage.tsx:1516-1518` → `onRefreshData={async () => { await Promise.all([loadGuests(), loadRooms()]); }}` (does not even refetch bookings)

**Failure scenario**: a front-desk agent voids a booking that has a paid deposit; the customer's
`CustomerLedgerPage` (which reads `ledgers.all`) and the night-audit/dashboard revenue widgets
(`dashboard.all`, `analytics.all`) keep showing the pre-void figures until something else in the app
happens to invalidate those keys, or the user manually refreshes.

**Recommendation**: give void and guest-cancel their own `useMutation` wrappers in
`useBookingQueries.ts` (mirroring `useReactivateBookingMutation`) that call
`invalidateBookingDependencies`; change `UnifiedBookingModal` to use `useCreateBooking()` internally
(or have it call `invalidateBookingDependencies` itself) so all three callers get consistent
invalidation regardless of their local `onRefreshData` implementation.

---

### 2. [efficiency] Summary "view" filters (Arriving/In-house/Departing/Balance-due) are computed
client-side over an unbounded, unfiltered fetch of the entire booking history

`BookingsPage.tsx:236` creates `summaryBookingsQuery = useBookingsWithDetails()` with **no filter
arguments**. `BookingsService.getBookingsWithDetails` (`api/bookings.service.ts:371-382`) calls
`getAllBookings()` (`bookings.service.ts:48-70`), which fetches `page_size: 500` and, if
`total > 500`, fetches all remaining pages **in parallel** — i.e. the entire booking table, every
booking ever created, with full joined details, on every mount of `BookingsPage`. This full result
(`operationsBookings`, `BookingsPage.tsx:1079`) feeds 7 `useMemo` client-side `.filter()` calls
(`arrivingBookings`…`companyDueBookings`, lines 1085–1119) that back the "Arrivals", "In-house",
"Departing", "Balance due" summary cards and their click-through views.

This compounds with Finding 1's invalidation breadth: `invalidateBookingDependencies` invalidates
`queryKeys.bookings.all` (`queryInvalidation.ts:9`), which prefix-matches the `with-details` key
(`queryKeys.ts:40`), so **every** check-in, payment, reactivate, or complimentary mutation triggers a
full re-fetch of the entire booking history, not just the current 50-row page. For a hotel with
years of history this is an unbounded, ever-growing cost paid on nearly every admin interaction.

A dedicated backend aggregate (the existing `/bookings/stats` endpoint already returns
`total/checked_in/confirmed/today_check_ins` via `useBookingStats()` — `useBookingQueries.ts:56-63`
— but not balance-due/departing counts) would remove the need for this full-table client scan.

---

### 3. [deadcode] `QuickBookingModal.tsx` (944 lines) is entirely unreachable

See "UnifiedBookingModal.tsx vs QuickBookingModal.tsx" above for full evidence (zero import sites
outside its own file/barrel; verified `git log` shows it was mechanically kept compiling through an
unrelated refactor as recently as today).

---

### 4. [deadcode] BookingsPage's "Mark Complimentary" feature is completely unwired — dialog is
never rendered and never opened by any button

- `complimentaryDialogOpen` state is declared at `BookingsPage.tsx:336` and set to `true` inside
  `handleMarkComplimentary` (`BookingsPage.tsx:582-591`), but grepping the whole file for
  `complimentaryDialogOpen` returns exactly one hit — the declaration itself. There is no
  `<Dialog open={complimentaryDialogOpen}>` anywhere in the render (confirmed by listing every
  `<Dialog open={...}` in the file: workflow, create, edit, void, reactivate, payment, check-in —
  no complimentary dialog).
- `handleMarkComplimentary` / `canMarkComplimentary` (`BookingsPage.tsx:981-985`) are themselves
  never called from any JSX in the file (no button wired to them).
- `calculateTotalNights`/`calculateComplimentaryNights`/`handleConfirmComplimentary`
  (`BookingsPage.tsx:594-654`, ~60 lines) and the `markComplimentaryMutation` hook
  (`useMarkBookingComplimentaryMutation`, wired at line 156) exist purely to serve this unreachable
  path.
- Confirmed no alternate "mark an existing booking complimentary" UI exists elsewhere
  (`grep -rln "MarkComplimentary\|mark.complimentary" src/features/bookings src/features/admin`
  returns only `BookingsPage.tsx`/`BookingsPage.test.tsx`). `BookingsPage.test.tsx` mocks
  `useMarkBookingComplimentaryMutation` (lines 78-79, 156, 356-358) purely to satisfy the import —
  no test exercises the flow.

**Net effect**: ~80 lines of state/handlers plus a full mutation hook are maintained for a feature
staff cannot currently trigger from this page. Either wire it to a real button (there is an existing
`ComplimentaryIcon` import at line 52 that is otherwise unused for this purpose) or delete it —
this is a product call (see policy note: whether "mark existing booking complimentary" should exist
as an admin action at all, vs. only at booking-creation time via `UnifiedBookingModal`'s
"complimentary" mode, is a business decision, not a code cleanup).

---

### 5. [accountability] Void/Reactivate/Check-in/Payment action buttons render with no client-side
permission gating, even though `isAdmin` is already computed for the same permission

`BookingsPage.tsx:153` computes `isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage')`
and applies it to exactly one button — Edit (`BookingsPage.tsx:1799`). The other four action buttons
in the same detail-panel button row render unconditionally:
- Check-in / Early check-in (`BookingsPage.tsx:1780,1783`) → `handleCheckIn` → `checkInGuestMutation`
- Payment (`BookingsPage.tsx:1796`) → `handleUpdatePaymentStatus` → `recordPaymentMutation`
- Void (`BookingsPage.tsx:1804`) → `handleVoidBooking`
- Reactivate (`BookingsPage.tsx:1807`) → `handleReactivateBooking` → `reactivateBookingMutation`

Verified against backend route guards:
- `void_booking`, `manual_checkin`, `reactivate_booking` all call
  `require_permission_helper(&pool, &headers, "bookings:update")`
  (`hotel-app-be/src/routes/bookings.rs:165, 174, 366`) — the **exact same permission** already
  computed as `isAdmin`.
- `record_payment` requires a **different** permission, `PAYMENTS_CREATE`
  (`hotel-app-be/src/routes/payments.rs:107`).

So a user with only `bookings:read` currently sees fully clickable Check-in/Void/Reactivate buttons
that will 403 server-side, when the page already has the boolean needed to hide them. The Payment
button needs its own `hasPermission('payments:create')` check (not currently computed anywhere in
this file).

---

### 6. [duplication] Night-count calculation is independently reimplemented at least 6 times across
the booking FE surface, with actually-diverging edge-case behavior

A canonical `calculateNights(checkIn, checkOut)` exists at `utils/bookingUtils.ts:115-123`
(raw `Math.ceil`, no clamping — can return negative if checkout < checkin) and is exported/used for
`enhanceBookingDetails`. Independently reimplemented, parameterless, closure-based versions exist at:

| Site | Formula | Divergence |
|---|---|---|
| `BookingsPage.tsx:1003-1008` (`getNights`) | `Math.max(1, Math.ceil(diff/86400000))` | floors at **1** |
| `MyBookingsPage.tsx:153-160` | `diffDays > 0 ? diffDays : 0` | floors at **0** |
| `QuickBookingModal.tsx:149-154` | raw `Math.ceil`, no clamp | can be **negative** (dead file, Finding 3) |
| `EnhancedCheckInModal.tsx:649-655` | `Math.abs(diff)` then `Math.ceil` | **masks** a checkout-before-checkin data error into a positive number instead of surfacing it |
| `GuestCheckInVerify.tsx:89-94` | same `Math.abs` pattern | same masking behavior |
| `guestPortal/booking/utils.ts:47-51` (`countStayNights`) | noon-normalized dates, `Math.round`, floors at 0 | different rounding function (`round` vs `ceil`) and DST-safer normalization than every admin-side version |

A stay whose check-in/check-out straddles a DST transition, or a booking with corrupted/reversed
dates, can legitimately show a different night count on the guest portal than on the admin pages,
and a different count again depending on which admin dialog is open, because six formulas disagree
on floor/clamp/rounding behavior for exactly the inputs where it matters.

---

### 7. [duplication] Guest-portal stay-window and occupancy limits are duplicated as magic numbers
in FE and BE with no shared source of truth

- FE: `features/guestPortal/booking/utils.ts:31-45` (`validateGuestBookingSearch`) hardcodes:
  nights must be 1–30 (line 39), check-in must be within 3 calendar months (`addCalendarMonthsClamped(todayAtNoon, 3)`,
  line 40), adults 1–20 (line 42), children 0–20 (line 43).
- BE: `hotel-app-be/src/modules/guest_booking/validation.rs:7-8` defines
  `MAX_BOOKING_NIGHTS: i64 = 30` and `MAX_ADVANCE_BOOKING_MONTHS: u32 = 3`, and
  `validate_stay_for_today` (lines 37-83) independently enforces the identical 1–30 nights, 3-month
  advance window, and 1–20/0–20 occupancy bounds.

The two sides currently agree, but nothing keeps them in sync — there is no shared constant or
settings endpoint exposing these limits to the FE. If the hotel-ops policy changes (e.g. extend the
booking window to 6 months), a developer must remember to edit both files; today neither side reads
the other or shares a value, so this is an accepted-drift-risk today, not a live bug.

---

### 8. [duplication] Two independent, non-shared check-in implementations exist for the same
underlying operation

- `EnhancedCheckInModal.tsx` (1968 lines — this should be added to the god-file list), reached only
  from `UnifiedBookingModal.tsx`'s "direct booking" hand-off (`grep` confirms it is the only importer),
  with its own dedicated hooks `features/bookings/hooks/useCheckInFormData.ts` (89 lines) and
  `useEnhancedCheckInModalState.ts` (81 lines). Has `paymentChoice: 'pay_now'|'pay_later'`
  (`EnhancedCheckInModal.tsx:220`), `depositChoice: 'receive'|'waive'` (line 231), `waiveReason`
  (line 234), `ic_number` capture (line 113).
- `BookingsPage.tsx` has its own **separate** inline check-in dialog for checking in an existing
  reservation from the bookings list: state at lines 213-225 (`ciPaymentChoice`, `ciPaymentMethod`,
  `ciAmountPaid`, `ciDepositChoice`, `ciDepositAmount`, `ciDepositMethod`, `ciWaiveReason`,
  `ciIcNumber`, `ciPhone` — the exact same concepts, prefixed `ci`), handlers at 741-836, JSX at
  2576-2718 (~150 lines). Neither hook above is imported by `BookingsPage.tsx`.

Two parallel implementations of "collect payment choice, deposit choice, waive reason, and IC/phone,
then check the guest in" exist, doubling the surface area for the payment/deposit business rules to
drift (e.g. a future change to how "waive deposit" is validated must be applied in both places).

---

### 9. [test-gap] `BookingsPage.test.tsx` pins rendering/filtering/sorting/pagination and the
create→check-in handoff, but has zero coverage of the actual money/state mutation paths

Verified `describe`/`it` blocks in `BookingsPage.test.tsx` (610 lines): `rendering` (row content,
empty state, quick-filter chip counts), `filtering` (search debounce+param, quick filters, clear),
`sorting` (toggle direction), `pagination` (visibility + page-advance), `modals` (create→check-in
handoff, check-in prefill from guest profile), `permission gating` (Edit control + companies fetch
gated on admin). There is **no** test exercising: void (including the stale-cache bug in Finding 1),
reactivate, complimentary (which is dead per Finding 4 — a test would have caught that), record
payment, view-invoice, or view-workflow-timeline. These are exactly the handlers most likely to hide
money/state bugs, and the safest ones to refactor behind are the ones already tested — a refactor of
the void/payment/reactivate dialogs (per the decomposition proposal) currently has no regression net.

---

### 10. [efficiency] Multi-room booking creation is a sequential loop of awaited API calls, not
parallelized

`UnifiedBookingModal.tsx:576-597` (`createBookingsForSelectedRooms`) does
`for (const [index, bookingRoom] of selectedBookingRooms.entries()) { const created = await BookingsService.createBooking(...); }`
— for an N-room booking this is N sequential round-trips instead of `Promise.all`. Given
`createBooking` is a real write with server-side rate/tourism-tax computation, parallelizing would
need to confirm the backend doesn't rely on ordering (e.g. room-hold contention), but as written the
UI latency for booking 4-5 rooms at once scales linearly with room count.

---

### 11. [maintainability] `useUnifiedBookingData.ts` duplicates TanStack Query's own cache as local
`useState`, and forces `staleTime: 0` on two of its three fetches

`features/rooms/hooks/useUnifiedBookingData.ts:20-24,40-44` calls `queryClient.fetchQuery(...)` /
imperatively for `guests.mineWithCredits()` and `rooms.available(...)` with `staleTime: 0`, then
copies the result into local `useState` (`guestsWithCredits`, `availableRooms`). This means: (a) the
component does not reactively re-render if that query is invalidated elsewhere while the modal is
open (it only re-fetches when the callback is invoked again), and (b) `staleTime: 0` forces a network
round-trip on every call regardless of how recently the same data was fetched, defeating the
otherwise-present cache. A plain `useQuery`/`useSuspenseQuery` with an explicit `enabled` flag would
give the same on-demand behavior while staying reactive to the shared cache.

---

### 12. [deadcode] `formatCurrency` in `bookingUtils.ts` hardcodes USD regardless of the hotel's
configured currency, feeding a field nothing renders

`utils/bookingUtils.ts:153-159` hardcodes `new Intl.NumberFormat('en-US', { currency: 'USD' })`,
independent of the app-wide `useCurrency()` hook (used everywhere else, e.g.
`BookingsPage.tsx:148`) that reads the hotel's configured currency from settings. It is used solely
to compute `formatted_total` inside `enhanceBookingDetails` (`bookingUtils.ts:318`), which itself is
invoked on every booking returned by `getBookingsPage`/`getBookingsWithDetails`/`getAllBookings`
(`api/bookings.service.ts:346,375`). Grepping all consumers of `formatted_total`
(`types/booking.types.ts:98`, `bookingUtils.test.ts`, and one pass-through at
`CustomerLedgerPage.tsx:1474` into `checkoutFlow.openReceipt`) found no place that actually renders
this string. Today it's wasted computation on every booking row fetched; if it is ever wired up to
render, any non-USD hotel will silently show the wrong currency symbol/format.

---

## Notes on things checked and found correct (not findings)

- `getBookingBalance`/`getBookingTotal` (`BookingsPage.tsx:1049-1050`) read `booking.balance_due`/
  `total_amount` directly from the server response rather than recomputing client-side — this is the
  right pattern and is not duplicated with backend balance math.
- `useBookingsPage` (the main paginated table query, `useBookingQueries.ts:19-27`) correctly uses
  `keepPreviousData` and a short `staleTime` — no missing-`keepPreviousData` issue on the primary
  table.
- Search and room-number filters are debounced 700ms (`useBookings.ts:41-42`); select-type filters
  (status/date/payment-method/online-channel) don't need debouncing.
- `tourism_tax_amount`/`is_tourist` computed client-side in `UnifiedBookingModal.tsx:813-814` for
  preview purposes is **not** trusted blindly by the backend: `canonical_tourism_tax_for_guest`
  (`hotel-app-be/src/repositories/bookings/lifecycle.rs:240-265`) independently recomputes it
  server-side from the guest's `tourism_type` and the live settings rate — the client value is a
  preview only, not authoritative. Divergence risk is limited to the preview looking wrong before
  submit if the two formulas ever drift, not to the actual charged amount.
- No raw `fetch(...)` calls or `toISOString().split/slice` violations found anywhere in the
  in-scope files (all HTTP goes through `api/client.ts`; no CI-banned date pattern present).
