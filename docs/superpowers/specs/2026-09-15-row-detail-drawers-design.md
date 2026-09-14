# Row-Click Right-Side Drawers — Bookings & Guests

**Date:** 2026-09-15
**Status:** Approved (design walkthrough)
**Scope:** `hotel-web-fe` only — no backend, route, or permission changes.

## Goal

Clicking a row in the **Bookings** list (`/bookings`) or the **Guests** list
(`/guest-relations/guests`) opens a right-side drawer instead of navigating away.
The drawer shows details, allows inline editing of key fields, and exposes every
existing feature/action. A "view full page" affordance inside each drawer reaches
the existing detail pages (`/bookings/$bookingId`, `/guest-relations/guests/$guestId`).

Precedent: `features/housekeeping/components/RoomDetailDrawer.tsx` — right-anchored
MUI `Drawer`, paper `width: { xs: '100%', sm: 420 }`, header + close button, chips,
action rows, sections.

## Decisions (confirmed with user)

1. Row click opens the drawer; the full detail page is reached only from inside
   the drawer ("drawer first, page inside").
2. Key fields are editable inline in the drawer; the existing full Edit dialogs
   remain available via an Edit action.
3. Inline field set:
   - **Booking:** check-in date, check-out date, remarks, special requests.
   - **Guest:** first name, last name, email, phone, nationality.
4. The guest table's per-row "eye" (View guest 360) icon is **removed** — row
   click is the single path in. The row's Edit / New-booking icons and the ⋮
   overflow menu stay as direct shortcuts.
5. Approach A: compose on existing components — no duplicated detail UIs.

## Components

### `features/bookings/components/Bookings/BookingDetailDrawer.tsx` (new)

- Props: `bookingId: string | null`, `open`, `onClose`, `isAdmin`,
  `onOpenFullDetails: (booking) => void`, `onError`, `onCompleted`, plus
  `callbacks: BookingActionCallbacks` and `rooms` passed through to the panel.
- Resolves the booking via the existing `useBooking(bookingId)` query (same hook
  `BookingDetailPage` uses), enabled only while open — so post-mutation state is
  fresh even when the row falls out of the current filter/page.
- Body: the existing `BookingDetailsPanel` inside the `Drawer`.
- Contains `BookingQuickEditSection` (local to the drawer file):
  - Rendered into the panel via the new `quickEdit` slot (below).
  - Gated on `isAdmin` (same `bookings:update`/`bookings:manage` check as Edit).
  - Fields: `check_in_date`, `check_out_date` (`type="date"`), `remarks`,
    `special_requests`; initialised from the booking on open.
  - Save → `useUpdateBooking().mutateAsync({ bookingId, data: { check_in_date,
    check_out_date, remarks, special_requests } })`, success notification, then
    `onCompleted()` (list reload + detail-query invalidation).
  - Known trade-off: inline date edits do NOT re-run the availability room
    picker the full Edit dialog has; the backend validates conflicts. Documented
    as intentional.

### `BookingDetailsPanel.tsx` (additive only)

Two optional props; `BookingDetailPage` is unaffected:

- `onOpenFullDetails?: (booking: BookingWithDetails) => void` — renders an
  "Open full page" `IconButton` (OpenInNew-style icon) beside the header close X.
- `quickEdit?: React.ReactNode` — rendered between the Charges section and the
  Actions section.

### `BookingsPage.tsx` (wiring)

- `const [drawerBookingId, setDrawerBookingId] = useState<string | null>(null)`;
  `BookingListPanel`'s `onOpenBooking` becomes `setDrawerBookingId(String(b.id))`
  (replaces `navigate('/bookings/$id')`).
- `useBookingActions` already mounted — now also take `callbacks` (currently
  only `dialogs` + `openCheckInDialog` are destructured) and pass to the drawer.
- `isAdmin` via `useAuth().hasPermission('bookings:update' | 'bookings:manage')`
  (same expression as `BookingDetailPage`).
- `onOpenFullDetails` → `navigate(`/bookings/${booking.id}`)`; drawer may stay
  mounted while navigation proceeds (route change unmounts the page anyway).
- `?booking_id=` deep link keeps redirecting to the full page — unchanged.
- `onCompleted` → existing `reloadBookingData`; the drawer's own `useBooking`
  refetches via the mutation's cache invalidation (verify `useUpdateBooking`
  invalidates the single-booking key during implementation; if not, the drawer
  refetches its own query after `onCompleted`).

### `features/guestRelations/components/GuestDetailDrawer.tsx` (new)

RoomDetailDrawer-style layout, props: `guest: Guest | null`, `open`, `onClose`,
`onOpenFullProfile: (guest) => void`, `onSaved: () => void | Promise<void>`,
`canCreateEkyc`, `canTransferPortalAccount`, `tourismConversionGuestId`, and the
existing `GuestListTableActions` handlers.

Sections, top to bottom:

1. **Header** — `GuestAvatar` (reuse from `GuestListTable`; extract to a small
   shared module if needed — it is currently file-local), nick_name, legal
   name · `#id`, close X.
2. **Chips** — Member / VIP / Tourism / Blacklisted / Open-request (same
   conditions as the table cells).
3. **"Open guest 360"** button → `onOpenFullProfile(guest)` →
   `navigate(`/guest-relations/guests/${guest.id}`)`.
4. **Details** — email, phone, company, last stay + stays count, portal account
   + active status, blacklist reason (DetailRow-style rows).
5. **Quick edit** — first name, last name (both required), email
   (`validateEmail` when non-empty), phone, nationality. Save builds the SAME
   payload shape as `handleUpdateGuest` (full `GuestFormData` initialised from
   the guest, edited fields applied, empty strings → `undefined`) via
   `useUpdateGuest`, then success notification + `onSaved()`; inline `Alert` on
   error. Drawer stays open on the refreshed guest.
6. **Actions** — New booking, Stay history, Free-night credits, Set tourism
   from last check-in (spinner while `tourismConversionGuestId === guest.id`),
   Transfer portal account (`canTransferPortalAccount`), Create eKYC
   (`canCreateEkyc`), Edit (existing `GuestFormDialog`), Delete (destructive —
   page wraps `handleDeleteGuest` to close the drawer on success).

### `GuestListTable.tsx` (small edit)

- Remove the "View guest 360" `Tooltip`+`IconButton` (and the now-unused
  `ViewIcon` import) from `GuestRowActions` — used in both the desktop column
  and the mobile card.
- `onRowClick` already calls `onOpen`; the page re-points `onOpen` at the
  drawer. No table-prop changes.

### `GuestRelationsPage.tsx` (wiring)

- `const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null)`;
  resolve `const drawerGuest = guests.find(g => g.id === selectedGuestId) ??
  lastSnapshot` (keep the last object so a mid-edit refetch or filter change
  can't blank the drawer).
- `onOpen` → `setSelectedGuestId(guest.id)` (replaces direct navigate);
  `onOpenFullProfile` → existing `navigate(`/guest-relations/guests/${id}`)`.
- `onSaved` → `loadGuests()`; `onDelete` wrapper closes the drawer after the
  existing confirm+delete succeeds.

## Edge cases / notes

- **Z-index:** MUI `Dialog` (1300) renders above `Drawer` (1200) — check-in,
  payment, edit, guest dialogs layer correctly on top of the open drawer.
- **Mobile:** drawer is full-width at `xs` (RoomDetailDrawer precedent).
- **Stale data:** booking drawer is query-backed (`useBooking`); guest drawer is
  list-backed with snapshot fallback. Mutations trigger the existing
  refetches — no new invalidation plumbing.
- **Deep links unchanged:** `?booking_id=` still redirects to
  `/bookings/$bookingId`; `?guest_id=`/`?search=` still just filter the list.
- **Permissions parity:** guest Edit visibility matches today (shown to anyone
  with page access; server enforces). Booking quick-edit is admin-gated like
  Edit. No permission changes.
- **Dirty quick-edit:** no unsaved-changes guard (consistent with existing
  drawers); closing the drawer discards unsaved input.
- **i18n:** surrounding components are not yet translated; drawer copy follows
  the same hardcoded-English convention as `BookingDetailsPanel`/`RoomDetailDrawer`.

## Testing

- `BookingDetailDrawer.test.tsx`, `GuestDetailDrawer.test.tsx` — Vitest +
  Testing Library, following `VoucherDetailsDrawer.test.tsx`:
  - drawer renders the booking/guest when open;
  - action buttons invoke the passed callbacks;
  - guest quick-edit blocks save on missing required names / bad email;
  - booking quick-edit hidden for non-admin.
- Gates (from `hotel-web-fe/`): `bun run typecheck && bun run lint &&
  bun run test`.

## Out of scope

- No backend/API/route/permission changes; no new SQL.
- No changes to the detail pages themselves, the ⋮ menu contents, or other
  lists (rooms, housekeeping, promotions already have their own drawers).
