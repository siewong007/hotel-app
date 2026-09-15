import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configure } from '@testing-library/dom';

// The payment idempotency suite below runs under fake timers with automatic
// advancement, so its waitFor windows no longer race wall-clock time. The
// raised async-util timeout stays as a cheap safety net for the remaining
// render-heavy waits in this file.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookingWithDetails, Guest, Room } from '../../../../types';
import { addLocalDays, formatLocalDate } from '../../../../utils/date';

// ---------------------------------------------------------------------------
// Characterization tests for BookingsPage (docs/ongoing-dev.md P2). These pin
// CURRENT observable behavior (rendered text, params sent to the paginated
// bookings query, and props handed to mocked children) so a future refactor
// fails loudly if it changes what the user sees or what the API is asked for.
//
// Kept REAL: useBookings (owns all filter/sort/pagination state — the thing
// being characterized), useCheckoutFlow, utils/date, utils/money,
// utils/bookingUtils, utils/pagination, utils/bookingChannel,
// utils/hotelSettings, utils/apiNotifications.
// Mocked: everything that hits the network (useBookingQueries, guest/room
// queries, the api barrel, ReportsService/LedgerService), auth, currency,
// router search params, the heavy UnifiedBookingModal/CheckoutInvoiceModals
// children, and useDebouncedValue (its own debounce timing is characterized
// in its own test file — this page's tests only need the settled value).
// ---------------------------------------------------------------------------

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  navigate: vi.fn(),
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),

  useBookingsPage: vi.fn(),
  bookingsPageQuery: {
    data: undefined as { data: unknown[]; total: number } | undefined,
    isPending: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  lastBookingsPageParams: null as Record<string, unknown> | null,

  useBookingStats: vi.fn(),
  bookingStatsQuery: {
    data: undefined as unknown,
    error: null as unknown,
    refetch: vi.fn(),
  },

  useBookingBoardSummary: vi.fn(),
  boardSummaryQuery: {
    data: undefined as Record<string, unknown> | undefined,
    isSuccess: true,
    error: null as unknown,
    refetch: vi.fn(),
  },

  useActiveCompanies: vi.fn(),
  activeCompaniesQuery: { data: [] as unknown[], error: null as unknown },
  lastActiveCompaniesArg: undefined as unknown,

  useCheckInGuestMutation: vi.fn(),
  checkInGuestMutation: { isPending: false, mutateAsync: vi.fn() },

  useMarkBookingComplimentaryMutation: vi.fn(),
  markComplimentaryMutation: { isPending: false, mutateAsync: vi.fn() },

  useReactivateBookingMutation: vi.fn(),
  reactivateMutation: { isPending: false, mutateAsync: vi.fn() },

  useRecordPaymentMutation: vi.fn(),
  recordPaymentMutation: { isPending: false, mutateAsync: vi.fn() },

  useUpdateBooking: vi.fn(),
  updateBookingMutation: { isPending: false, mutateAsync: vi.fn() },

  useBookingWorkflowFetcher: vi.fn(),

  useGuests: vi.fn(),
  guestsQuery: { data: [] as unknown[], error: null as unknown, refetch: vi.fn() },

  useRooms: vi.fn(),
  roomsQuery: { data: [] as unknown[], error: null as unknown, refetch: vi.fn() },

  getAllRoomTypes: vi.fn(),
  getAvailableRoomsForDates: vi.fn(),
  getGuest: vi.fn(),
  voidBooking: vi.fn(),
  releaseBooking: vi.fn(),
  updateRoomStatus: vi.fn(),
  updateBookingApi: vi.fn(),

  listBookingChannels: vi.fn(),
  getRoomChargeLedgerForBooking: vi.fn(),

  lastUnifiedBookingModalProps: null as Record<string, unknown> | null,
}));

vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (value: number) => `RM${Number(value).toFixed(2)}`, symbol: 'RM' }),
}));

vi.mock('../../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('../../../../api', () => ({
  BookingsService: {
    voidBooking: (...args: unknown[]) => mocks.voidBooking(...args),
    releaseBooking: (...args: unknown[]) => mocks.releaseBooking(...args),
    updateBooking: (...args: unknown[]) => mocks.updateBookingApi(...args),
  },
  GuestsService: {
    getGuest: (...args: unknown[]) => mocks.getGuest(...args),
  },
  RoomsService: {
    getAllRoomTypes: (...args: unknown[]) => mocks.getAllRoomTypes(...args),
    getAvailableRoomsForDates: (...args: unknown[]) => mocks.getAvailableRoomsForDates(...args),
    updateRoomStatus: (...args: unknown[]) => mocks.updateRoomStatus(...args),
  },
}));

vi.mock('../../../../api/reports.service', () => ({
  ReportsService: {
    listBookingChannels: (...args: unknown[]) => mocks.listBookingChannels(...args),
  },
}));

vi.mock('../../../../api/ledger.service', () => ({
  LedgerService: {
    getRoomChargeLedgerForBooking: (...args: unknown[]) => mocks.getRoomChargeLedgerForBooking(...args),
  },
}));

vi.mock('../../hooks/useBookingQueries', () => ({
  useBookingsPage: (...args: unknown[]) => mocks.useBookingsPage(...args),
  useBooking: (id: unknown) => ({
    data: (mocks.bookingsPageQuery.data?.data as BookingWithDetails[] | undefined)
      ?.find((b) => String(b.id) === String(id)),
    isPending: false,
    error: null,
  }),
  useBookingStats: (...args: unknown[]) => mocks.useBookingStats(...args),
  useBookingBoardSummary: (...args: unknown[]) => mocks.useBookingBoardSummary(...args),
  useActiveCompanies: (...args: unknown[]) => mocks.useActiveCompanies(...args),
  useCheckInGuestMutation: (...args: unknown[]) => mocks.useCheckInGuestMutation(...args),
  useMarkBookingComplimentaryMutation: (...args: unknown[]) => mocks.useMarkBookingComplimentaryMutation(...args),
  useReactivateBookingMutation: (...args: unknown[]) => mocks.useReactivateBookingMutation(...args),
  useRecordPaymentMutation: (...args: unknown[]) => mocks.useRecordPaymentMutation(...args),
  useUpdateBooking: (...args: unknown[]) => mocks.useUpdateBooking(...args),
  useBookingWorkflowFetcher: (...args: unknown[]) => mocks.useBookingWorkflowFetcher(...args),
}));

vi.mock('../../../guests/hooks/useGuestQueries', () => ({
  useGuests: (...args: unknown[]) => mocks.useGuests(...args),
}));

vi.mock('../../../rooms/hooks/useRoomQueries', () => ({
  useRooms: (...args: unknown[]) => mocks.useRooms(...args),
}));

vi.mock('../../../rooms/components/UnifiedBooking', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.lastUnifiedBookingModalProps = props;
    if (!props.open) return null;
    return (
      <div aria-label="Mocked create booking modal">
        <button
          onClick={() => {
            const onBookingCreated = props.onBookingCreated as
              | ((booking: Record<string, unknown>, guest: Record<string, unknown>) => void)
              | undefined;
            onBookingCreated?.(
              {
                id: 'new-1',
                folio_number: 'F-NEW',
                room_id: 'r-101',
                check_in_date: '2026-01-01T00:00:00.000Z',
                check_out_date: '2026-01-03T00:00:00.000Z',
                total_amount: 200,
                status: 'confirmed',
                payment_method: 'cash',
                created_at: '2026-01-01T00:00:00.000Z',
              },
              { id: 99, nick_name: 'New Guest', email: 'new@example.com' }
            );
          }}
        >
          Simulate direct booking created
        </button>
        <button
          onClick={() => {
            const onClose = props.onClose as (() => void) | undefined;
            onClose?.();
          }}
        >
          Simulate modal close
        </button>
      </div>
    );
  },
}));

vi.mock('../../../invoices/components/CheckoutInvoiceModals', () => ({
  default: () => null,
}));

vi.mock('../../../../hooks/useDebouncedValue', () => ({
  // useDebouncedValue's own debounce-timing behavior is characterized in its
  // own test file; this page's tests only need the settled value.
  useDebouncedValue: (value: unknown) => value,
}));

import BookingsPage from './BookingsPage';
import { expectNoCriticalAxeViolations } from '../../../../test/axe';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '1',
    booking_number: 'BK-1001',
    folio_number: 'F-1001',
    guest_id: 'g-1',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_id: 'r-101',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: `${formatLocalDate(addLocalDays(new Date(), -2))}T00:00:00.000Z`,
    check_out_date: `${formatLocalDate(addLocalDays(new Date(), 1))}T00:00:00.000Z`,
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

function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'r-101',
    room_number: '101',
    room_type: 'Deluxe',
    price_per_night: 150,
    available: true,
    max_occupancy: 2,
    ...overrides,
  } as Room;
}

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 1,
    nick_name: 'Jane Doe',
    is_active: true,
    guest_type: 'member',
    ...overrides,
  } as Guest;
}

const today = formatLocalDate();
const booking1 = buildBooking({
  id: '1',
  guest_name: 'Jane Doe',
  room_number: '101',
  folio_number: 'F-1001',
  status: 'confirmed',
  balance_due: 300,
  payment_status: 'unpaid',
});
const booking2 = buildBooking({
  id: '2',
  guest_name: 'Alex Tan',
  room_number: '202',
  folio_number: 'F-1002',
  status: 'checked_in',
  balance_due: 0,
  payment_status: 'paid',
  check_in_date: `${today}T00:00:00.000Z`,
  check_out_date: `${formatLocalDate(addLocalDays(new Date(), 1))}T00:00:00.000Z`,
});
const booking3 = buildBooking({
  id: '3',
  guest_name: 'Mei Ling',
  room_number: '303',
  folio_number: 'F-1003',
  status: 'pending',
  balance_due: 150,
  payment_status: 'unpaid',
  check_in_date: `${formatLocalDate(addLocalDays(new Date(), 1))}T00:00:00.000Z`,
  check_out_date: `${formatLocalDate(addLocalDays(new Date(), 3))}T00:00:00.000Z`,
});
const defaultBookings = [booking1, booking2, booking3];

function setBookingsPageData(items: BookingWithDetails[], total: number) {
  mocks.bookingsPageQuery.data = { data: items, total };
}

// The board's figures come from GET /bookings/summary now, not from slicing a
// full-table fetch, so tests state them directly instead of implying them from
// the fixture rows.
const emptySummary = {
  arriving: 0,
  ready_to_check_in: 0,
  in_house: 0,
  guests_in_house: 0,
  departing: 0,
  upcoming: 0,
  normal_due: 0,
  normal_due_amount: 0,
  company_due: 0,
  company_due_amount: 0,
  company_outstanding_months: 1,
};

function setBoardSummary(overrides: Partial<typeof emptySummary> = {}) {
  mocks.boardSummaryQuery.data = { ...emptySummary, ...overrides };
  mocks.boardSummaryQuery.isSuccess = true;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<BookingsPage />, { wrapper });
}

describe('BookingsPage', () => {
  it('reports no critical axe violations', async () => {
    setBookingsPageData(defaultBookings, defaultBookings.length);
    setBoardSummary({ in_house: 1, guests_in_house: 1, upcoming: 1 });
    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByText(/Room 101/).length).toBeGreaterThan(0));
    await expectNoCriticalAxeViolations(container);
  });

  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());

    mocks.hasPermission.mockReset().mockReturnValue(false);
    mocks.navigate.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.setSearchParams.mockReset();

    mocks.lastBookingsPageParams = null;
    setBookingsPageData(defaultBookings, 120);
    mocks.bookingsPageQuery.isPending = false;
    mocks.bookingsPageQuery.error = null;
    mocks.bookingsPageQuery.refetch.mockReset();
    mocks.useBookingsPage.mockReset().mockImplementation((params: Record<string, unknown>) => {
      mocks.lastBookingsPageParams = params;
      return mocks.bookingsPageQuery;
    });

    mocks.bookingStatsQuery.data = { total: 3, checked_in: 1, confirmed: 1, today_check_ins: 0 };
    mocks.bookingStatsQuery.error = null;
    mocks.bookingStatsQuery.refetch.mockReset();
    mocks.useBookingStats.mockReset().mockReturnValue(mocks.bookingStatsQuery);

    setBoardSummary({ in_house: 1, guests_in_house: 1, upcoming: 1 });
    mocks.boardSummaryQuery.error = null;
    mocks.boardSummaryQuery.refetch.mockReset();
    mocks.useBookingBoardSummary.mockReset().mockReturnValue(mocks.boardSummaryQuery);

    mocks.activeCompaniesQuery.data = [];
    mocks.lastActiveCompaniesArg = undefined;
    mocks.useActiveCompanies.mockReset().mockImplementation((enabled: unknown) => {
      mocks.lastActiveCompaniesArg = enabled;
      return mocks.activeCompaniesQuery;
    });

    mocks.checkInGuestMutation.isPending = false;
    mocks.checkInGuestMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.useCheckInGuestMutation.mockReset().mockReturnValue(mocks.checkInGuestMutation);

    mocks.markComplimentaryMutation.isPending = false;
    mocks.markComplimentaryMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.useMarkBookingComplimentaryMutation.mockReset().mockReturnValue(mocks.markComplimentaryMutation);

    mocks.reactivateMutation.isPending = false;
    mocks.reactivateMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.useReactivateBookingMutation.mockReset().mockReturnValue(mocks.reactivateMutation);

    mocks.recordPaymentMutation.isPending = false;
    mocks.recordPaymentMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.useRecordPaymentMutation.mockReset().mockReturnValue(mocks.recordPaymentMutation);

    mocks.updateBookingMutation.isPending = false;
    mocks.updateBookingMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.useUpdateBooking.mockReset().mockReturnValue(mocks.updateBookingMutation);

    mocks.useBookingWorkflowFetcher.mockReset().mockReturnValue(vi.fn().mockResolvedValue([{}, []]));

    mocks.guestsQuery.data = [buildGuest()];
    mocks.guestsQuery.error = null;
    mocks.guestsQuery.refetch.mockReset();
    mocks.useGuests.mockReset().mockReturnValue(mocks.guestsQuery);

    mocks.roomsQuery.data = [buildRoom()];
    mocks.roomsQuery.error = null;
    mocks.roomsQuery.refetch.mockReset();
    mocks.useRooms.mockReset().mockReturnValue(mocks.roomsQuery);

    mocks.getAllRoomTypes.mockReset().mockResolvedValue([]);
    mocks.getAvailableRoomsForDates.mockReset().mockResolvedValue([]);
    mocks.getGuest.mockReset().mockResolvedValue({ ic_number: '990101-01-1234', phone: '0123456789' });
    mocks.voidBooking.mockReset().mockResolvedValue({});
    mocks.releaseBooking.mockReset().mockResolvedValue({});
    mocks.updateRoomStatus.mockReset().mockResolvedValue({});
    mocks.updateBookingApi.mockReset().mockResolvedValue({});

    mocks.listBookingChannels.mockReset().mockResolvedValue([]);
    mocks.getRoomChargeLedgerForBooking.mockReset().mockResolvedValue({});

    mocks.lastUnifiedBookingModalProps = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('rendering', () => {
    it('renders each booking row with its guest name, room number, and folio identifier', () => {
      renderPage();

      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
      expect(screen.getByText('Alex Tan')).toBeDefined();
      expect(screen.getByText('Mei Ling')).toBeDefined();
      expect(screen.getAllByText(/Room 101/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Room 202/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Room 303/).length).toBeGreaterThan(0);
      // F-1001 renders in booking1's list row (folio/invoice column).
      expect(screen.getAllByText('F-1001').length).toBeGreaterThan(0);
      expect(screen.getByText('F-1002')).toBeDefined();
      expect(screen.getByText('F-1003')).toBeDefined();
    });

    it('shows the friendly empty state when there are no bookings at all', () => {
      setBookingsPageData([], 0);
      setBoardSummary();

      renderPage();

      expect(screen.getByText('No bookings yet')).toBeDefined();
      expect(screen.getByText('Create your first booking using the New booking button above')).toBeDefined();
    });

    it('takes the quick-filter chip counts from the server summary', () => {
      renderPage();

      // "All" uses the server-reported total (120), not the current page's array length.
      expect(screen.getByText('All 120')).toBeDefined();
      // The rest come straight from GET /bookings/summary, so they describe the
      // whole dataset rather than whichever page happens to be loaded.
      expect(screen.getByText('In House 1')).toBeDefined();
      expect(screen.getByText('Upcoming 1')).toBeDefined();
    });
  });

  describe('filtering', () => {
    it('sends the trimmed search text as a param and resets the page back to 1', async () => {
      renderPage();

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ page: 1, status: 'all' }));

      // Move off page 1 first so we can observe the reset triggered by the search.
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ page: 2 }));

      fireEvent.change(screen.getByPlaceholderText('Search booking, guest, invoice, or room number...'), {
        target: { value: 'Jane' },
      });

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ search: 'Jane', page: 1 }));
    });

    it('selecting the "In House" quick filter sends view=in_house and resets the page', async () => {
      renderPage();
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ page: 1 }));

      fireEvent.click(screen.getByText('In House 1'));

      // The view is the filter now. It used to be approximated with
      // status/date filters, which could not express "arriving today" or "past
      // checkout with a balance" and disagreed with the counts on the cards.
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ view: 'in_house', page: 1 }));
      expect(mocks.lastBookingsPageParams).not.toHaveProperty('check_in_from');
    });

    it('selecting the "Arriving" quick filter sends view=arriving', async () => {
      renderPage();
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ page: 1 }));

      fireEvent.click(screen.getByText('Arriving 0'));

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({
        view: 'arriving',
        page: 1,
      }));
    });

    it('"Clear" removes every active filter and returns to the base param set', async () => {
      renderPage();

      fireEvent.change(screen.getByPlaceholderText('Search booking, guest, invoice, or room number...'), {
        target: { value: 'Jane' },
      });
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ search: 'Jane' }));

      fireEvent.click(screen.getByText('Clear'));

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({
        page: 1,
        sort_by: 'check_in_date',
        sort_order: 'desc',
        status: 'all',
      }));
      expect(mocks.lastBookingsPageParams).not.toHaveProperty('search');
    });
  });

  describe('sorting', () => {
    it('toggles the sort field between check-in date and guest name, always landing on ascending order', async () => {
      renderPage();

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({
        sort_by: 'check_in_date',
        sort_order: 'desc',
      }));
      expect(screen.getByRole('button', { name: /Sort: Priority/ })).toBeDefined();

      fireEvent.click(screen.getByRole('button', { name: /Sort: Priority/ }));
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({
        sort_by: 'guest_name',
        sort_order: 'asc',
        page: 1,
      }));
      expect(screen.getByRole('button', { name: /Sort: Guest/ })).toBeDefined();

      // Clicking again flips back to check_in_date but — because the button
      // always passes a *different* field than the current one — the
      // same-field "toggle direction" branch of useBookings' handleSort is
      // never reached through this control, so order stays 'asc' (not 'desc').
      fireEvent.click(screen.getByRole('button', { name: /Sort: Guest/ }));
      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({
        sort_by: 'check_in_date',
        sort_order: 'asc',
        page: 1,
      }));
    });
  });

  describe('pagination', () => {
    it('renders Pagination when total exceeds the page size and advances the page on click', async () => {
      renderPage();

      expect(screen.getByText('Showing 1-50 of 120')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ page: 2 }));
    });

    it('hides Pagination when the total fits within a single page', () => {
      setBookingsPageData(defaultBookings, defaultBookings.length);

      renderPage();

      expect(screen.queryByText(/Showing/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Go to page/ })).toBeNull();
    });
  });

  describe('navigation', () => {
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

    it('redirects the legacy ?booking_id= deep link to the detail route', async () => {
      mocks.searchParams = new URLSearchParams('booking_id=7');

      renderPage();

      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith('/bookings/7', { replace: true }));
    });

    it('keeps ?search= filtering the list without navigating away', async () => {
      mocks.searchParams = new URLSearchParams('search=Jane');

      renderPage();

      await waitFor(() => expect(mocks.lastBookingsPageParams).toMatchObject({ search: 'Jane' }));
      expect(mocks.navigate).not.toHaveBeenCalled();
    });
  });

  describe('modals', () => {
    it('opens the create-booking modal from "New booking" and routes a direct booking into the check-in dialog', () => {
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(true);

      fireEvent.click(screen.getByText('Simulate direct booking created'));

      expect(screen.getByText('Check-In - Room 101')).toBeDefined();
      expect(screen.getByText('New Guest')).toBeDefined();
    });

    it('opens the create-booking modal when the ?create=1 deep-link param is present', () => {
      mocks.searchParams = new URLSearchParams('create=1');

      renderPage();

      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(true);
      expect(screen.getByLabelText('Mocked create booking modal')).toBeDefined();
    });

    it('strips only the create param (via replace) when the deep-linked modal is closed', () => {
      mocks.searchParams = new URLSearchParams('create=1&search=Jane');

      renderPage();
      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(true);

      fireEvent.click(screen.getByText('Simulate modal close'));

      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(false);
      expect(mocks.setSearchParams).toHaveBeenCalledTimes(1);
      const [nextParams, options] = mocks.setSearchParams.mock.calls[0] as [
        URLSearchParams,
        { replace?: boolean } | undefined,
      ];
      expect(nextParams.get('create')).toBeNull();
      // Unrelated params survive the strip.
      expect(nextParams.get('search')).toBe('Jane');
      expect(options?.replace).toBe(true);
    });

    it('does not open the modal or touch the URL when the create param is absent', () => {
      renderPage();

      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(false);
      expect(screen.queryByLabelText('Mocked create booking modal')).toBeNull();
      expect(mocks.setSearchParams).not.toHaveBeenCalled();
    });

    it('closes the modal without touching the URL when it was opened via the button (no create param)', () => {
      renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(true);

      fireEvent.click(screen.getByText('Simulate modal close'));

      expect(mocks.lastUnifiedBookingModalProps?.open).toBe(false);
      expect(mocks.setSearchParams).not.toHaveBeenCalled();
    });

    // Row-detail actions (Check in, Payment, Edit, …) moved to the
    // /bookings/$bookingId page with the details panel; their dialog coverage
    // now lives in BookingDetailPage.test.tsx.
  });
});
