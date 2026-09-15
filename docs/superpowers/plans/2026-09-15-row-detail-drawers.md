# Row-Click Right-Side Drawers (Bookings & Guests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Row clicks in `/bookings` and `/guest-relations/guests` open a right-side
drawer (details + inline quick-edit + all existing actions) instead of navigating;
the full detail pages remain reachable from a button inside each drawer.

**Architecture:** Booking drawer wraps the existing `BookingDetailsPanel` (two new
optional props) inside a right-anchored MUI `Drawer` and resolves fresh data via
`useBooking(id)`. Guest drawer is a new `RoomDetailDrawer`-style component reusing
chips extracted from `GuestListTable` and the page's existing action handlers.
Spec: `docs/superpowers/specs/2026-09-15-row-detail-drawers-design.md`.

**Tech Stack:** React 19, MUI v9 (`Drawer`), TanStack Query, Vitest + Testing Library.

## Global Constraints

- Workdir for all commands: `hotel-web-fe/`. Paths below are relative to it unless absolute.
- Drawer chrome matches `src/features/housekeeping/components/RoomDetailDrawer.tsx`:
  `<Drawer anchor="right" slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}>`.
- No backend/route/permission changes. No new dependencies.
- Hardcoded English copy — matches `BookingDetailsPanel`/`RoomDetailDrawer` (not yet i18n'd).
- Date inputs use `type="date"`; parse API timestamps via `.split('T')[0]` (existing
  `EditBookingDialog` convention — the lint-banned pattern is `toISOString()` for *formatting*).
- The worktree is dirty with another session's unrelated changes — `git add` ONLY the
  files each task lists; never `git add -A`/`git add .`.
- Gates after every task: `bun run typecheck` clean for touched files; end of plan:
  `bun run typecheck && bun run lint && bun run test`.
- Vitest mocks are hoisted: `vi.mock` factories for a module MUST export every hook
  the component tree imports, or the render crashes (`useBooking` is NOT currently
  in `BookingsPage.test.tsx`'s `useBookingQueries` mock — Task 3 adds it).

---

### Task 1: Extract shared guest chips into `GuestChips.tsx`

**Files:**
- Create: `src/features/guestRelations/components/GuestChips.tsx`
- Modify: `src/features/guestRelations/components/GuestListTable.tsx`
- Test: existing `src/features/guestRelations/pages/GuestRelationsPage.test.tsx` must stay green (pure move)

**Interfaces:**
- Produces (consumed by Task 4's drawer): `GuestAvatar`, `MemberChip`, `VipChip`,
  `TourismChip`, `OpenRequestChip`, `BlacklistedChip` — all exported from
  `./GuestChips`.

- [ ] **Step 1: Create `GuestChips.tsx` — move the six components verbatim**

```tsx
import React from 'react';
import { Box, Chip, Tooltip, alpha } from '@mui/material';
import {
  GppBadOutlined as BlacklistedBadgeIcon,
  Star as MemberIcon,
  SupportAgentOutlined as OpenRequestsIcon,
  WorkspacePremiumOutlined as VipIcon,
} from '@mui/icons-material';
import type { Guest } from '../../../types';
import { formatStatusLabel } from '../../../utils/formatters';
import { GUEST_DESIGN } from '../../guests/constants';
import { guestHasMissingTourismType } from '../../guests/utils';
import { avatarFor, initialsOf } from '../utils';


export const GuestAvatar: React.FC<{ guest: Guest; size?: number }> = ({ guest, size = 34 }) => {
  const av = avatarFor(guest.id);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: av.bg,
        color: av.fg,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: size * 0.31,
        border: '1px solid rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}
    >
      {initialsOf(guest.nick_name)}
    </Box>
  );
};

export const MemberChip: React.FC = () => (
  <Chip
    size="small"
    icon={<MemberIcon sx={{ fontSize: 12 }} />}
    label="Member"
    sx={{ bgcolor: GUEST_DESIGN.goldBg, color: GUEST_DESIGN.gold, fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
  />
);

export const VipChip: React.FC<{ status: string }> = ({ status }) => (
  <Chip
    size="small"
    icon={<VipIcon sx={{ fontSize: 12 }} />}
    label={formatStatusLabel(status, 'VIP')}
    sx={{ bgcolor: alpha('#5b3aa8', 0.12), color: '#5b3aa8', fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }}
  />
);

export const OpenRequestChip: React.FC = () => (
  <Chip
    size="small"
    icon={<OpenRequestsIcon sx={{ fontSize: 13 }} />}
    label="Open request"
    sx={{
      bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.blue} 10%, transparent)`,
      color: GUEST_DESIGN.blue,
      fontWeight: 700,
      '& .MuiChip-icon': { color: 'inherit' },
    }}
  />
);

export const TourismChip: React.FC<{ guest: Guest }> = ({ guest }) => {
  if (guestHasMissingTourismType(guest)) {
    return (
      <Chip
        size="small"
        label="Missing tourism"
        sx={{ bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.rose} 10%, transparent)`, color: GUEST_DESIGN.rose, fontWeight: 700 }}
      />
    );
  }
  if (guest.tourism_type === 'foreign') {
    return (
      <Chip
        size="small"
        label="Tourist"
        sx={{ bgcolor: GUEST_DESIGN.blueBg, color: GUEST_DESIGN.blue, fontWeight: 700 }}
      />
    );
  }
  if (guest.tourism_type === 'local') {
    return (
      <Chip
        size="small"
        label="Local"
        sx={{ bgcolor: GUEST_DESIGN.green50, color: GUEST_DESIGN.green700, fontWeight: 700 }}
      />
    );
  }
  return null;
};

/**
 * Blacklisted badge. The alerts column shows it under a reason Tooltip and the
 * GppBad icon; the mobile card uses the plainer Block icon — pass `icon` to keep
 * either look while sharing the chip itself.
 */
export const BlacklistedChip: React.FC<{ icon?: React.ReactNode }> = ({
  icon = <BlacklistedBadgeIcon sx={{ fontSize: 14 }} />,
}) => (
  <Chip
    size="small"
    icon={icon}
    label="Blacklisted"
    sx={{
      bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.rose} 10%, transparent)`,
      color: GUEST_DESIGN.rose,
      fontWeight: 700,
      '& .MuiChip-icon': { color: 'inherit' },
    }}
  />
);

```

- [ ] **Step 2: Update `GuestListTable.tsx`**

- Delete the local `GuestAvatar`, `MemberChip`, `VipChip`, `OpenRequestChip`,
  `TourismChip` definitions (lines ~66–150).
- Add `import { BlacklistedChip, GuestAvatar, MemberChip, OpenRequestChip, TourismChip, VipChip } from './GuestChips';`
- Alerts column (was lines ~362–376): replace the inline blacklisted `Chip` with
  `<BlacklistedChip />` inside the existing `Tooltip`.
- Mobile card (was lines ~470–478): replace the inline blacklisted `Chip` with
  `<BlacklistedChip icon={<BlacklistIcon sx={{ fontSize: 13 }} />} />`.
- Remove now-unused imports: `alpha`, `Chip`, `formatStatusLabel`,
  `guestHasMissingTourismType`, `avatarFor`, `initialsOf`,
  `GppBadOutlined as BlacklistedBadgeIcon`, `Star as MemberIcon`,
  `SupportAgentOutlined as OpenRequestsIcon`, `WorkspacePremiumOutlined as VipIcon`.
  Keep: `BlockOutlined as BlacklistIcon` (mobile card icon), `GUEST_DESIGN`
  (delete-menu `rose`), `guestLegalName`, `formatHotelDate`, all menu icons.

- [ ] **Step 3: Verify the move changed nothing**

Run: `cd hotel-web-fe && bun run test -- src/features/guestRelations && bun run typecheck`
Expected: all guest-relations tests pass; typecheck clean (unused imports would fail).

- [ ] **Step 4: Commit**

```bash
git add hotel-web-fe/src/features/guestRelations/components/GuestChips.tsx hotel-web-fe/src/features/guestRelations/components/GuestListTable.tsx
git commit -m "refactor(guests): extract shared guest chips for reuse in detail drawer"
```

---

### Task 2: `BookingDetailsPanel` — `onOpenFullDetails` + `quickEdit` slots

**Files:**
- Modify: `src/features/bookings/components/Bookings/BookingDetailsPanel.tsx`
- Test: `src/features/bookings/pages/BookingDetailPage.test.tsx` must stay green (additive only)

**Interfaces:**
- Produces (consumed by Task 3): `BookingDetailsPanelProps` gains
  `onOpenFullDetails?: (booking: BookingWithDetails) => void` and
  `quickEdit?: React.ReactNode`.

- [ ] **Step 1: Add the props**

In `BookingDetailsPanelProps` add:

```tsx
  /** Drawer mode only — jumps to /bookings/$bookingId. Absent on the detail page. */
  onOpenFullDetails?: (booking: BookingWithDetails) => void;
  /** Drawer mode only — inline quick-edit section rendered between Charges and Actions. */
  quickEdit?: React.ReactNode;
```

Destructure both in the component signature.

- [ ] **Step 2: Header — full-page button beside close**

Add `OpenInNewOutlined as OpenFullIcon` to the `@mui/icons-material` import.
Replace the lone close `Tooltip`/`IconButton` (lines ~167–171) with:

```tsx
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              {onOpenFullDetails && (
                <Tooltip title="Open full page" arrow>
                  <IconButton size="small" aria-label="Open full page" onClick={() => onOpenFullDetails(booking)}>
                    <OpenFullIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="Close details" arrow>
                <IconButton size="small" aria-label="Close details" onClick={onClose}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
```

- [ ] **Step 3: Render `quickEdit` between Charges and Actions**

Immediately after the Charges section's closing `</Box>` (line ~279) and before
the Actions `<Box sx={{ p: 2.5 }}>` (line ~281), insert:

```tsx
          {quickEdit}
```

- [ ] **Step 4: Verify existing surface untouched**

Run: `cd hotel-web-fe && bun run test -- src/features/bookings && bun run typecheck`
Expected: all bookings tests pass (detail page passes neither prop → no visual change).

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/bookings/components/Bookings/BookingDetailsPanel.tsx
git commit -m "feat(bookings): add full-page + quick-edit slots to BookingDetailsPanel"
```

---

### Task 3: `BookingDetailDrawer` + `BookingsPage` wiring

**Files:**
- Create: `src/features/bookings/components/Bookings/BookingDetailDrawer.tsx`
- Create: `src/features/bookings/components/Bookings/BookingDetailDrawer.test.tsx`
- Modify: `src/features/bookings/components/Bookings/BookingsPage.tsx`
- Modify: `src/features/bookings/components/Bookings/BookingsPage.test.tsx`

**Interfaces:**
- Consumes: `useBooking(id, enabled)` / `useUpdateBooking()` from
  `../../hooks/useBookingQueries`; `BookingActionCallbacks` from
  `../../hooks/useBookingActions`; `BookingDetailsPanel` props from Task 2.
- Produces: `BookingDetailDrawer` default-exported; props below.

- [ ] **Step 1: Write the failing test — `BookingDetailDrawer.test.tsx`**

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingWithDetails } from '../../../../types';

const mocks = vi.hoisted(() => ({
  bookingQuery: { data: undefined as BookingWithDetails | undefined, isPending: false, error: null as unknown },
  lastBookingArg: undefined as unknown,
  updateBookingMutation: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock('../../hooks/useBookingQueries', () => ({
  useBooking: (id: unknown, enabled: unknown) => {
    mocks.lastBookingArg = { id, enabled };
    return mocks.bookingQuery;
  },
  useUpdateBooking: () => mocks.updateBookingMutation,
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (value: number) => `RM${Number(value).toFixed(2)}`, symbol: 'RM' }),
}));

vi.mock('../../../../hooks/useIsPhone', () => ({ useIsPhone: () => false }));

vi.mock('../../../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({ check_in_time: '15:00', payment_methods: [], booking_channels: [] }),
}));

import BookingDetailDrawer from './BookingDetailDrawer';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '2',
    folio_number: 'F-1002',
    guest_id: 'g-1',
    guest_name: 'Alex Tan',
    room_id: 'r-202',
    room_number: '202',
    room_type: 'Deluxe',
    check_in_date: '2026-09-10T00:00:00.000Z',
    check_out_date: '2026-09-12T00:00:00.000Z',
    total_amount: 300,
    price_per_night: 150,
    status: 'confirmed',
    payment_status: 'unpaid',
    balance_due: 300,
    source: 'walk_in',
    is_complimentary: false,
    deposit_paid: false,
    ...overrides,
  } as BookingWithDetails;
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof BookingDetailDrawer>> = {}) {
  const props = {
    bookingId: '2',
    open: true,
    onClose: vi.fn(),
    isAdmin: false,
    onOpenFullDetails: vi.fn(),
    onError: vi.fn(),
    onCompleted: vi.fn(),
    onCheckIn: vi.fn(),
    onCheckOut: vi.fn(),
    onPayment: vi.fn(),
    onWorkflow: vi.fn(),
    onEdit: vi.fn(),
    onInvoice: vi.fn(),
    onRelease: vi.fn(),
    onVoid: vi.fn(),
    onReactivate: vi.fn(),
    ...overrides,
  };
  render(<BookingDetailDrawer {...props} />);
  return props;
}

describe('BookingDetailDrawer', () => {
  beforeEach(() => {
    mocks.bookingQuery.data = buildBooking();
    mocks.bookingQuery.isPending = false;
    mocks.bookingQuery.error = null;
    mocks.lastBookingArg = undefined;
    mocks.updateBookingMutation.isPending = false;
    mocks.updateBookingMutation.mutateAsync.mockReset().mockResolvedValue({});
  });

  afterEach(cleanup);

  it('fetches the booking with the query gated on open and renders the details panel', () => {
    renderDrawer();
    expect(mocks.lastBookingArg).toEqual({ id: '2', enabled: true });
    expect(screen.getAllByText('Alex Tan').length).toBeGreaterThan(0);
    expect(screen.getByText('Workflow')).toBeTruthy();
  });

  it('forwards the full-page jump to onOpenFullDetails', () => {
    const { onOpenFullDetails } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    expect(onOpenFullDetails).toHaveBeenCalledWith(mocks.bookingQuery.data);
  });

  it('shows quick edit only for admins and saves the four fields', async () => {
    renderDrawer();
    expect(screen.queryByText('Quick edit')).toBeNull();

    cleanup();
    const { onCompleted } = renderDrawer({ isAdmin: true });
    expect(screen.getByText('Quick edit')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'Late arrival' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateBookingMutation.mutateAsync).toHaveBeenCalledWith({
      bookingId: '2',
      data: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        remarks: 'Late arrival',
        special_requests: '',
      },
    }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  it('surfaces save failures through onError', async () => {
    const { onError } = renderDrawer({ isAdmin: true });
    mocks.updateBookingMutation.mutateAsync.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
```

Note for the implementer: `fireEvent.click` on the row-like Panel buttons is fine;
if `getByLabelText('Remarks')` misses because of label association, use
`screen.getByLabelText(/remarks/i)` or add `id`/`htmlFor` — keep the label text
`Remarks` either way. Also confirm `booking.remarks`/`booking.special_requests`
exist on `BookingWithDetails` (EditBookingDialog already reads them).

- [ ] **Step 2: Run the test — verify it fails**

Run: `cd hotel-web-fe && bun run test -- src/features/bookings/components/Bookings/BookingDetailDrawer.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `BookingDetailDrawer.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { BookingWithDetails } from '../../../../types';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { getErrorMessage } from '../../utils/bookingPageUtils';
import { useBooking, useUpdateBooking } from '../../hooks/useBookingQueries';
import type { BookingActionCallbacks } from '../../hooks/useBookingActions';
import BookingDetailsPanel from './BookingDetailsPanel';

interface BookingDetailDrawerProps extends BookingActionCallbacks {
  bookingId: string | null;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onOpenFullDetails: (booking: BookingWithDetails) => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

interface QuickEditFields {
  check_in_date: string;
  check_out_date: string;
  remarks: string;
  special_requests: string;
}

/**
 * Inline edit for the fields front-desk staff change most — stay dates and
 * free-text notes. Everything else (status, channel, company, rate, room,
 * extra beds) stays in the full Edit dialog one row of actions below; unlike
 * that dialog this does NOT re-run the room-availability picker on date
 * changes — the backend still validates conflicts.
 */
const BookingQuickEditSection: React.FC<{
  booking: BookingWithDetails;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}> = ({ booking, onError, onCompleted }) => {
  const updateBooking = useUpdateBooking();
  const [fields, setFields] = useState<QuickEditFields>({
    check_in_date: '',
    check_out_date: '',
    remarks: '',
    special_requests: '',
  });
  const [saving, setSaving] = useState(false);

  // Re-initialise when a different booking is opened.
  useEffect(() => {
    setFields({
      check_in_date: booking.check_in_date.split('T')[0],
      check_out_date: booking.check_out_date.split('T')[0],
      remarks: booking.remarks ?? '',
      special_requests: booking.special_requests ?? '',
    });
  }, [booking.id]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateBooking.mutateAsync({
        bookingId: booking.id,
        data: {
          check_in_date: fields.check_in_date,
          check_out_date: fields.check_out_date,
          remarks: fields.remarks,
          special_requests: fields.special_requests,
        },
      });
      emitApiNotification({ severity: 'success', message: 'Booking updated successfully!' });
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to update booking');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>
        Quick edit
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Stack direction="row" spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Check-In Date"
            type="date"
            value={fields.check_in_date}
            onChange={(e) => setFields((prev) => ({ ...prev, check_in_date: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            fullWidth
            size="small"
            label="Check-Out Date"
            type="date"
            value={fields.check_out_date}
            onChange={(e) => setFields((prev) => ({ ...prev, check_out_date: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <TextField
          fullWidth
          size="small"
          label="Remarks"
          value={fields.remarks}
          onChange={(e) => setFields((prev) => ({ ...prev, remarks: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          fullWidth
          size="small"
          label="Special Requests"
          value={fields.special_requests}
          onChange={(e) => setFields((prev) => ({ ...prev, special_requests: e.target.value }))}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={14} /> : undefined}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
};

/**
 * Row-click surface for /bookings: the shared details panel inside a right
 * drawer, backed by useBooking(bookingId) so post-action state (check-in,
 * void, payments) refreshes even when the row leaves the current list filter.
 * The /bookings/$bookingId page stays reachable via onOpenFullDetails.
 */
const BookingDetailDrawer: React.FC<BookingDetailDrawerProps> = ({
  bookingId,
  open,
  onClose,
  isAdmin,
  onOpenFullDetails,
  onError,
  onCompleted,
  ...callbacks
}) => {
  const bookingQuery = useBooking(bookingId, open);
  const booking = bookingQuery.data;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}
      aria-label="Booking details"
    >
      {!bookingId ? null : bookingQuery.isPending ? (
        <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : bookingQuery.error || !booking ? (
        <Box sx={{ p: 2.5 }}>
          <Alert severity="warning">Booking details unavailable.</Alert>
        </Box>
      ) : (
        <BookingDetailsPanel
          booking={booking}
          isAdmin={isAdmin}
          onClose={onClose}
          onOpenFullDetails={onOpenFullDetails}
          quickEdit={
            isAdmin ? (
              <BookingQuickEditSection
                booking={booking}
                onError={onError}
                onCompleted={onCompleted}
              />
            ) : undefined
          }
          {...callbacks}
        />
      )}
    </Drawer>
  );
};

export default BookingDetailDrawer;
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd hotel-web-fe && bun run test -- src/features/bookings/components/Bookings/BookingDetailDrawer.test.tsx`
Expected: 4 tests PASS. Fix any label/query mismatches in the test (not the component).

- [ ] **Step 5: Wire `BookingsPage.tsx`**

- Add imports:
  ```tsx
  import { useAuth } from '../../../../auth/AuthContext';
  import BookingDetailDrawer from './BookingDetailDrawer';
  ```
- Inside the component, after the existing hooks:
  ```tsx
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('bookings:update') || hasPermission('bookings:manage');
  const [drawerBookingId, setDrawerBookingId] = useState<string | null>(null);
  ```
- Change the `useBookingActions` destructure (line ~172) to also take `callbacks`:
  ```tsx
  const {
    callbacks: bookingActionCallbacks,
    dialogs: bookingActionDialogs,
    openCheckInDialog,
  } = useBookingActions({ ...unchanged... });
  ```
- Change `BookingListPanel`'s prop (line ~408):
  ```tsx
  onOpenBooking={(booking) => setDrawerBookingId(String(booking.id))}
  ```
  Update the prop's doc comment in `BookingListPanel.tsx` (line ~49) to
  `/** Row click — the page opens the booking drawer. */`.
- Render before `{bookingActionDialogs}` (line ~467):
  ```tsx
      <BookingDetailDrawer
        bookingId={drawerBookingId}
        open={Boolean(drawerBookingId)}
        onClose={() => setDrawerBookingId(null)}
        isAdmin={isAdmin}
        onOpenFullDetails={(booking) => navigate(`/bookings/${booking.id}`)}
        onError={setError}
        onCompleted={reloadBookingData}
        {...bookingActionCallbacks}
      />
  ```

- [ ] **Step 6: Update `BookingsPage.test.tsx`**

- In the `vi.mock('../../hooks/useBookingQueries', …)` factory (line ~162), add
  `useBooking` so the drawer doesn't hit an unmocked export:
  ```ts
  useBooking: (id: unknown) => ({
    data: (mocks.bookingsPageQuery.data?.data as BookingWithDetails[] | undefined)
      ?.find((b) => String(b.id) === String(id)),
    isPending: false,
    error: null,
  }),
  ```
- Replace the navigation test (lines ~584–590):
  ```ts
  it('clicking a booking row opens the details drawer instead of navigating', () => {
    renderPage();

    fireEvent.click(screen.getByText('Alex Tan'));

    expect(mocks.navigate).not.toHaveBeenCalledWith('/bookings/2');
    // The drawer reuses BookingDetailsPanel — the Workflow action only exists there.
    expect(screen.getByRole('button', { name: 'Workflow' })).toBeDefined();
  });

  it('the drawer\'s full-page button still reaches /bookings/$bookingId', () => {
    renderPage();

    fireEvent.click(screen.getByText('Alex Tan'));
    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/bookings/2');
  });
  ```
  Keep the `?booking_id=` redirect test unchanged.

- [ ] **Step 7: Run bookings tests + typecheck**

Run: `cd hotel-web-fe && bun run test -- src/features/bookings && bun run typecheck`
Expected: all pass, including the two updated page tests.

- [ ] **Step 8: Commit**

```bash
git add hotel-web-fe/src/features/bookings/components/Bookings/BookingDetailDrawer.tsx hotel-web-fe/src/features/bookings/components/Bookings/BookingDetailDrawer.test.tsx hotel-web-fe/src/features/bookings/components/Bookings/BookingsPage.tsx hotel-web-fe/src/features/bookings/components/Bookings/BookingsPage.test.tsx hotel-web-fe/src/features/bookings/components/Bookings/BookingListPanel.tsx
git commit -m "feat(bookings): open row-click booking details in a right-side drawer"
```

---

### Task 4: `GuestDetailDrawer` + `GuestRelationsPage`/`GuestListTable` wiring

**Files:**
- Create: `src/features/guestRelations/components/GuestDetailDrawer.tsx`
- Create: `src/features/guestRelations/components/GuestDetailDrawer.test.tsx`
- Modify: `src/features/guestRelations/components/GuestListTable.tsx` (remove eye icon)
- Modify: `src/features/guestRelations/pages/GuestRelationsPage.tsx`
- Modify: `src/features/guestRelations/pages/GuestRelationsPage.test.tsx`

**Interfaces:**
- Consumes: `GuestChips` components (Task 1); `GuestListTableActions` from
  `./GuestListTable`; `useUpdateGuest` from `../../guests/hooks/useGuestQueries`;
  `validateEmail` from `../../../utils/validation`; `GuestFormData` from
  `../../guests/types`.
- Produces: `GuestDetailDrawer` default-exported; props below.

- [ ] **Step 1: Write the failing test — `GuestDetailDrawer.test.tsx`**

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Guest } from '../../../types';

const mocks = vi.hoisted(() => ({
  updateGuestMutation: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock('../../guests/hooks/useGuestQueries', () => ({
  useUpdateGuest: () => mocks.updateGuestMutation,
}));

import GuestDetailDrawer from './GuestDetailDrawer';

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 7,
    nick_name: 'Aisha Rahman',
    first_name: 'Aisha',
    last_name: 'Rahman',
    email: 'aisha@example.com',
    phone: '0123456789',
    nationality: 'Malaysian',
    is_active: true,
    guest_type: 'member',
    tourism_type: 'local',
    bookings_count: 3,
    last_stay_date: '2026-08-01',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Guest;
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof GuestDetailDrawer>> = {}) {
  const props = {
    guest: buildGuest(),
    open: true,
    onClose: vi.fn(),
    onOpenFullProfile: vi.fn(),
    onSaved: vi.fn(),
    canCreateEkyc: true,
    canTransferPortalAccount: true,
    tourismConversionGuestId: null,
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onNewBooking: vi.fn(),
    onStayHistory: vi.fn(),
    onViewCredits: vi.fn(),
    onConvertTourism: vi.fn(),
    onTransferPortalAccount: vi.fn(),
    onCreateEkyc: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<GuestDetailDrawer {...props} />);
  return props;
}

describe('GuestDetailDrawer', () => {
  beforeEach(() => {
    mocks.updateGuestMutation.isPending = false;
    mocks.updateGuestMutation.mutateAsync.mockReset().mockResolvedValue({});
  });

  afterEach(cleanup);

  it('renders identity, chips, contact details and the full-profile jump', () => {
    const { onOpenFullProfile } = renderDrawer();
    expect(screen.getAllByText('Aisha Rahman').length).toBeGreaterThan(0);
    expect(screen.getByText('aisha@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open guest 360' }));
    expect(onOpenFullProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('blocks quick-edit save when the legal names are cleared', async () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('First name and last name are required')).toBeTruthy();
    expect(mocks.updateGuestMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('saves the full guest payload with only the edited fields changed', async () => {
    const { onSaved } = renderDrawer();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateGuestMutation.mutateAsync).toHaveBeenCalledWith({
      guestId: 7,
      data: expect.objectContaining({
        first_name: 'Aisha',
        last_name: 'Rahman',
        phone: '0999',
        guest_type: 'member',
        tourism_type: 'local',
      }),
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('routes the action rows to the page handlers', () => {
    const props = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
    expect(props.onNewBooking).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete guest' }));
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('hides eKYC and portal-account actions without the permissions', () => {
    renderDrawer({ canCreateEkyc: false, canTransferPortalAccount: false });
    expect(screen.queryByRole('button', { name: 'Create eKYC' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfer portal account' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `cd hotel-web-fe && bun run test -- src/features/guestRelations/components/GuestDetailDrawer.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `GuestDetailDrawer.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddCircleOutlineOutlined as NewBookingIcon,
  AutoAwesome as ConvertIcon,
  CardGiftcardOutlined as CreditsIcon,
  Close as CloseIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  HistoryOutlined as StayHistoryIcon,
  ManageAccountsOutlined as PortalAccountIcon,
  OpenInNewOutlined as OpenFullIcon,
  Save as SaveIcon,
  VerifiedUserOutlined as EkycIcon,
} from '@mui/icons-material';
import type { Guest } from '../../../types';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { errorMessage } from '../../../utils';
import { formatHotelDate } from '../../../utils/date';
import { validateEmail } from '../../../utils/validation';
import { useUpdateGuest } from '../../guests/hooks/useGuestQueries';
import type { GuestFormData } from '../../guests/types';
import { guestLegalName } from '../utils';
import type { GuestListTableActions } from './GuestListTable';
import {
  BlacklistedChip,
  GuestAvatar,
  MemberChip,
  OpenRequestChip,
  TourismChip,
  VipChip,
} from './GuestChips';

interface GuestDetailDrawerProps extends GuestListTableActions {
  guest: Guest | null;
  open: boolean;
  onClose: () => void;
  onOpenFullProfile: (guest: Guest) => void;
  onSaved: () => Promise<void> | void;
  canCreateEkyc: boolean;
  canTransferPortalAccount: boolean;
  tourismConversionGuestId: number | null;
}

interface QuickEditFields {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  nationality: string;
}

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', minWidth: 0 }}>{value}</Typography>
    </Stack>
  );
}

/** Legal-name split identical to the page's edit handler: a real first+last
 *  always wins; the nickname split is only a fallback for legacy rows. */
const initialFields = (guest: Guest): QuickEditFields => {
  const hasLegalName = Boolean(guest.first_name?.trim() && guest.last_name?.trim());
  const [splitFirst, ...splitRest] = guest.nick_name.split(' ');
  return {
    first_name: hasLegalName ? (guest.first_name ?? '') : (splitFirst || ''),
    last_name: hasLegalName ? (guest.last_name ?? '') : (splitRest.join(' ') || ''),
    email: guest.email || '',
    phone: guest.phone || '',
    nationality: guest.nationality || '',
  };
};

/**
 * Row-click surface for /guest-relations/guests: identity + contact details,
 * a small quick-edit form, and every action the row's icon/⋮ menu exposed.
 * The guest-360 page stays reachable via "Open guest 360".
 */
const GuestDetailDrawer: React.FC<GuestDetailDrawerProps> = ({
  guest,
  open,
  onClose,
  onOpenFullProfile,
  onSaved,
  canCreateEkyc,
  canTransferPortalAccount,
  tourismConversionGuestId,
  onEdit,
  onNewBooking,
  onStayHistory,
  onViewCredits,
  onConvertTourism,
  onTransferPortalAccount,
  onCreateEkyc,
  onDelete,
}) => {
  const updateGuest = useUpdateGuest();
  const [fields, setFields] = useState<QuickEditFields>({
    first_name: '', last_name: '', email: '', phone: '', nationality: '',
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Re-initialise whenever a different guest (or a freshly refetched one) loads.
  const guestId = guest?.id;
  useEffect(() => {
    if (open && guest) setFields(initialFields(guest));
    setEditError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on identity change only
  }, [guestId, open]);

  if (!guest) return null;

  const legalName = guestLegalName(guest);
  const isConverting = tourismConversionGuestId === guest.id;

  const handleSave = async () => {
    if (!fields.first_name.trim() || !fields.last_name.trim()) {
      setEditError('First name and last name are required');
      return;
    }
    if (fields.email.trim()) {
      const emailError = validateEmail(fields.email);
      if (emailError) {
        setEditError(emailError);
        return;
      }
    }
    // Same payload shape as the page's edit dialog: the full form built from
    // the guest, with only the quick-edit fields applied on top.
    const data: GuestFormData = {
      first_name: fields.first_name.trim(),
      last_name: fields.last_name.trim(),
      email: fields.email,
      phone: fields.phone,
      ic_number: guest.ic_number || '',
      nationality: fields.nationality,
      address_line1: guest.address_line1 || '',
      city: guest.city || '',
      state_province: guest.state_province || '',
      postal_code: guest.postal_code || '',
      country: guest.country || '',
      company_name: guest.company_name || '',
      guest_type: guest.guest_type || 'non_member',
      tourism_type: guest.tourism_type,
      discount_percentage: guest.discount_percentage || 0,
    };
    try {
      setSaving(true);
      setEditError(null);
      await updateGuest.mutateAsync({ guestId: guest.id, data });
      emitApiNotification({ message: 'Guest updated successfully', severity: 'success' });
      await onSaved();
    } catch (err) {
      setEditError(errorMessage(err, 'Failed to update guest'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}
      aria-label={`Guest ${guest.nick_name} details`}
    >
      <Stack spacing={2.5} sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <GuestAvatar guest={guest} size={46} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                {guest.nick_name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {legalName && legalName !== guest.nick_name ? `${legalName} · ` : ''}#{guest.id}
              </Typography>
            </Box>
          </Stack>
          <IconButton onClick={onClose} aria-label="Close guest details" size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {guest.guest_type === 'member' && <MemberChip />}
          {guest.vip_status?.trim() && <VipChip status={guest.vip_status} />}
          <TourismChip guest={guest} />
          {guest.is_blacklisted && (
            <Tooltip title={guest.blacklist_reason ? `Blacklisted — ${guest.blacklist_reason}` : 'Blacklisted guest'}>
              <BlacklistedChip />
            </Tooltip>
          )}
          {guest.has_open_support && <OpenRequestChip />}
        </Stack>

        <Button
          variant="outlined"
          size="small"
          startIcon={<OpenFullIcon />}
          onClick={() => onOpenFullProfile(guest)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Open guest 360
        </Button>

        <Divider />

        <Stack spacing={0.75}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Details</Typography>
          <DetailRow label="Email" value={guest.email} />
          <DetailRow label="Phone" value={guest.phone} />
          <DetailRow label="IC / Passport" value={guest.ic_number} />
          <DetailRow label="Nationality" value={guest.nationality} />
          <DetailRow label="Company" value={guest.company_name} />
          <DetailRow
            label="Last stay"
            value={guest.last_stay_date ? formatHotelDate(guest.last_stay_date, '—') : undefined}
          />
          <DetailRow
            label="Stays"
            value={(guest.bookings_count ?? 0) === 0 ? 'No stays' : `${guest.bookings_count}`}
          />
          <DetailRow
            label="Portal account"
            value={
              guest.account_username
                ? `${guest.account_username} (${guest.account_is_active ? 'active' : 'deactivated'})`
                : undefined
            }
          />
          <DetailRow label="Blacklist reason" value={guest.is_blacklisted ? guest.blacklist_reason : undefined} />
        </Stack>

        <Divider />

        <Stack spacing={1.5}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Quick edit</Typography>
          {editError && (
            <Alert severity="error" onClose={() => setEditError(null)}>{editError}</Alert>
          )}
          <Stack direction="row" spacing={1.5}>
            <TextField
              fullWidth size="small" label="First name" required
              value={fields.first_name}
              onChange={(e) => setFields((prev) => ({ ...prev, first_name: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              fullWidth size="small" label="Last name" required
              value={fields.last_name}
              onChange={(e) => setFields((prev) => ({ ...prev, last_name: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <TextField
            fullWidth size="small" label="Email" type="email"
            value={fields.email}
            onChange={(e) => setFields((prev) => ({ ...prev, email: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1.5}>
            <TextField
              fullWidth size="small" label="Phone" type="tel"
              value={fields.phone}
              onChange={(e) => setFields((prev) => ({ ...prev, phone: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              fullWidth size="small" label="Nationality"
              value={fields.nationality}
              onChange={(e) => setFields((prev) => ({ ...prev, nationality: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small" variant="contained" onClick={handleSave} disabled={saving}
              startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Box>
        </Stack>

        <Divider />

        <Stack spacing={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Actions</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" startIcon={<NewBookingIcon />} onClick={() => onNewBooking(guest)}>
              New booking
            </Button>
            <Button size="small" variant="outlined" startIcon={<StayHistoryIcon />} onClick={() => onStayHistory(guest)}>
              Stay history
            </Button>
            <Button size="small" variant="outlined" startIcon={<CreditsIcon />} onClick={() => onViewCredits(guest)}>
              Free-night credits
            </Button>
            <Button
              size="small" variant="outlined" disabled={isConverting}
              startIcon={isConverting ? <CircularProgress size={14} /> : <ConvertIcon />}
              onClick={() => onConvertTourism(guest)}
            >
              Set tourism from last check-in
            </Button>
            {canTransferPortalAccount && (
              <Button size="small" variant="outlined" startIcon={<PortalAccountIcon />} onClick={() => onTransferPortalAccount(guest)}>
                Transfer portal account
              </Button>
            )}
            {canCreateEkyc && (
              <Button size="small" variant="outlined" startIcon={<EkycIcon />} onClick={() => onCreateEkyc(guest)}>
                Create eKYC
              </Button>
            )}
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => onEdit(guest)}>
              Edit
            </Button>
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={() => onDelete(guest)}>
              Delete guest
            </Button>
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  );
};

export default GuestDetailDrawer;
```

Note: `GuestListTableActions` still includes `onOpen` (used by the table's
`onRowClick`) — the drawer interface extends it for convenience but doesn't
destructure/use it.

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd hotel-web-fe && bun run test -- src/features/guestRelations/components/GuestDetailDrawer.test.tsx`
Expected: 5 tests PASS. If a `getByLabelText` misses (label association), switch
to placeholder/role queries in the test — keep the component labels as written.

- [ ] **Step 5: Remove the eye icon from `GuestListTable.tsx`**

- Delete the "View guest 360" `Tooltip`+`IconButton` block (lines ~187–191).
- Remove `VisibilityOutlined as ViewIcon` from the icon imports.
- Change `GuestRowActionsProps` to `extends Omit<GuestListTableActions, 'onOpen'>`
  and drop `onOpen` from its destructure and from both `<GuestRowActions …>`
  call sites (remove `onOpen={onOpen}` lines ~419 and ~455).

- [ ] **Step 6: Wire `GuestRelationsPage.tsx`**

- Add `import GuestDetailDrawer from '../components/GuestDetailDrawer';`
- Add state near the other dialog state (line ~151):
  ```tsx
  const [selectedGuestId, setSelectedGuestId] = useState<number | null>(null);
  const [drawerGuestSnapshot, setDrawerGuestSnapshot] = useState<Guest | null>(null);
  ```
- After `visibleGuests` is defined, add:
  ```tsx
  // The open drawer's guest resolves live from the list when possible so
  // mutations refetch into view; the snapshot keeps it populated when the row
  // falls out of the current page/filter.
  const drawerGuest =
    visibleGuests.find((g) => g.id === selectedGuestId) ?? drawerGuestSnapshot;
  const openGuestDrawer = (guest: Guest) => {
    setDrawerGuestSnapshot(guest);
    setSelectedGuestId(guest.id);
  };
  const closeGuestDrawer = () => {
    setSelectedGuestId(null);
    setDrawerGuestSnapshot(null);
  };
  ```
- Make `handleDeleteGuest` report success: change the early `return` to
  `return false` and end the try block with `return true` (catch returns `false`).
- Add the drawer-facing delete wrapper:
  ```tsx
  const handleDeleteFromDrawer = async (guest: Guest) => {
    if (await handleDeleteGuest(guest)) closeGuestDrawer();
  };
  ```
- Change `tableActions.onOpen` (line ~451) to `onOpen: openGuestDrawer`.
- Render the drawer before the closing `</Box>` (after `GuestPortalAccountDialog`):
  ```tsx
      <GuestDetailDrawer
        guest={drawerGuest}
        open={Boolean(drawerGuest)}
        onClose={closeGuestDrawer}
        onOpenFullProfile={handleOpenGuest}
        onSaved={loadGuests}
        canCreateEkyc={canCreateEkyc}
        canTransferPortalAccount={canTransferPortalAccount}
        tourismConversionGuestId={tourismConversionGuestId}
        onOpen={openGuestDrawer}
        onEdit={handleEditClick}
        onNewBooking={handleCreateBookingForGuest}
        onStayHistory={setHistoryGuest}
        onViewCredits={setCreditsGuest}
        onConvertTourism={handleApplyTourismFromLastCheckIn}
        onTransferPortalAccount={setPortalAccountGuest}
        onCreateEkyc={setEkycGuest}
        onDelete={handleDeleteFromDrawer}
      />
  ```
  (`handleOpenGuest` keeps its `navigate('/guest-relations/guests/' + id)` body —
  it's now the drawer's full-profile jump instead of the row click.)

- [ ] **Step 7: Update `GuestRelationsPage.test.tsx`**

- In `vi.mock('../../guests/hooks/useGuestQueries', …)` (line ~60), make
  `useUpdateGuest` return a hoisted spy so saves are observable:
  add to `mocks`: `updateGuestMutation: { isPending: false, mutateAsync: vi.fn() },`
  and change the mock line to `useUpdateGuest: () => mocks.updateGuestMutation,`.
  Reset it in `beforeEach`:
  `mocks.updateGuestMutation.mutateAsync.mockReset().mockResolvedValue({});`
- Replace the final test (lines ~219–223):
  ```ts
  it('opens the detail drawer on row click and navigates to guest 360 from inside it', () => {
    render(<GuestRelationsPage />);

    // Row body click — the per-row eye icon was removed; the row itself is the target.
    fireEvent.click(screen.getByText('Aisha Rahman'));

    expect(screen.queryByRole('button', { name: 'View Aisha Rahman' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open guest 360' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/guest-relations/guests/7');
  });
  ```

- [ ] **Step 8: Run guest-relations tests + typecheck**

Run: `cd hotel-web-fe && bun run test -- src/features/guestRelations && bun run typecheck`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add hotel-web-fe/src/features/guestRelations/components/GuestDetailDrawer.tsx hotel-web-fe/src/features/guestRelations/components/GuestDetailDrawer.test.tsx hotel-web-fe/src/features/guestRelations/components/GuestListTable.tsx hotel-web-fe/src/features/guestRelations/pages/GuestRelationsPage.tsx hotel-web-fe/src/features/guestRelations/pages/GuestRelationsPage.test.tsx
git commit -m "feat(guests): open row-click guest details in a right-side drawer"
```

---

### Task 5: Full gates + self-review

- [ ] **Step 1: Run the three gates**

Run: `cd hotel-web-fe && bun run typecheck && bun run lint && bun run test`
Expected: all three clean. Vitest transpiles without type info — a green test
run does NOT imply typecheck passes; run all three verbatim.

- [ ] **Step 2: Review the diff for drift**

Run: `git diff master -- hotel-web-fe/src/features/bookings hotel-web-fe/src/features/guestRelations | head -400`
Check: no unrelated formatting churn; `BookingDetailsPanel` changes are purely
additive; the eye icon removal didn't strand imports.

- [ ] **Step 3: Report**

Summarize: drawer behavior per tab, files touched, test counts, anything the
reviewer should double-check (quick-edit field choices, eye-icon removal).
