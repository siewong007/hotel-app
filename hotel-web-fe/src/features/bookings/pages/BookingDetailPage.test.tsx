import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookingWithDetails } from '../../../types';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';

// ---------------------------------------------------------------------------
// BookingDetailPage (route /bookings/$bookingId). Kept REAL: useBooking (the
// fetch-by-id path), useBookingActions + its dialog mounts, BookingDetailsPanel,
// PageHeader/EmptyState/LoadingSpinner, i18n (no provider needed), utils.
// Mocked: network services (api barrel, LedgerService, ReportsService), auth,
// router compat (navigate spy + Link anchor), useRooms, useCurrency.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  navigate: vi.fn(),
  getBookingById: vi.fn(),
  updateBookingApi: vi.fn(),
  voidBooking: vi.fn(),
  releaseBooking: vi.fn(),
  checkInGuest: vi.fn(),
  reactivateBooking: vi.fn(),
  getBookingTimeline: vi.fn(),
  getPaymentWorkflowSummary: vi.fn(),
  recordPayment: vi.fn(),
  getGuest: vi.fn(),
  getCompanies: vi.fn(),
  getRateCodes: vi.fn(),
  getMarketCodes: vi.fn(),
  listBookingChannels: vi.fn(),
  getRoomChargeLedgerForBooking: vi.fn(),
  useRooms: vi.fn(),
  roomsQuery: { data: [] as unknown[], error: null as unknown },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, className, style }: { to: unknown; children?: ReactNode; className?: string; style?: unknown }) => (
    <a href={typeof to === 'string' ? to : '#'} className={className} style={style as React.CSSProperties | undefined}>
      {children}
    </a>
  ),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('../../../api', () => ({
  BookingsService: {
    getBookingById: (...args: unknown[]) => mocks.getBookingById(...args),
    updateBooking: (...args: unknown[]) => mocks.updateBookingApi(...args),
    voidBooking: (...args: unknown[]) => mocks.voidBooking(...args),
    releaseBooking: (...args: unknown[]) => mocks.releaseBooking(...args),
    checkInGuest: (...args: unknown[]) => mocks.checkInGuest(...args),
    reactivateBooking: (...args: unknown[]) => mocks.reactivateBooking(...args),
    getBookingTimeline: (...args: unknown[]) => mocks.getBookingTimeline(...args),
  },
  InvoicesService: {
    getPaymentWorkflowSummary: (...args: unknown[]) => mocks.getPaymentWorkflowSummary(...args),
    recordPayment: (...args: unknown[]) => mocks.recordPayment(...args),
  },
  GuestsService: {
    getGuest: (...args: unknown[]) => mocks.getGuest(...args),
  },
  CompaniesService: {
    getCompanies: (...args: unknown[]) => mocks.getCompanies(...args),
  },
  RatesService: {
    getRateCodes: (...args: unknown[]) => mocks.getRateCodes(...args),
    getMarketCodes: (...args: unknown[]) => mocks.getMarketCodes(...args),
  },
}));

vi.mock('../../../api/ledger.service', () => ({
  LedgerService: {
    getRoomChargeLedgerForBooking: (...args: unknown[]) => mocks.getRoomChargeLedgerForBooking(...args),
  },
}));

vi.mock('../../../api/reports.service', () => ({
  ReportsService: {
    listBookingChannels: (...args: unknown[]) => mocks.listBookingChannels(...args),
  },
}));

vi.mock('../../rooms/hooks/useRoomQueries', () => ({
  useRooms: (...args: unknown[]) => mocks.useRooms(...args),
}));

// CheckoutInvoiceModal requires ConfirmProvider (and a heavier invoice data
// surface) — the dialog mount is incidental to this page's coverage.
vi.mock('../../invoices/components/CheckoutInvoiceModals', () => ({
  default: () => null,
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (value: number) => `RM${Number(value).toFixed(2)}`, symbol: 'RM' }),
}));

import BookingDetailPage from './BookingDetailPage';

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

const matchMediaStub = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
};

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '42',
    booking_number: 'BK-1042',
    folio_number: 'F-1042',
    guest_id: 'g-7',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_id: 'r-101',
    room_number: '101',
    room_type: 'Deluxe',
    check_in_date: `${formatLocalDate(addLocalDays(new Date(), -1))}T00:00:00.000Z`,
    check_out_date: `${formatLocalDate(addLocalDays(new Date(), 2))}T00:00:00.000Z`,
    total_amount: 450,
    price_per_night: 150,
    status: 'confirmed',
    payment_status: 'unpaid',
    balance_due: 450,
    source: 'walk_in',
    is_complimentary: false,
    deposit_paid: false,
    ...overrides,
  } as BookingWithDetails;
}

function renderPage(bookingId = '42') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<BookingDetailPage bookingId={bookingId} />, { wrapper });
}

describe('BookingDetailPage', () => {
  beforeEach(() => {
    resetLocaleStoreForTests();
    vi.stubGlobal('localStorage', createLocalStorageStub());
    matchMediaStub(false);

    mocks.hasPermission.mockReset().mockReturnValue(false);
    mocks.navigate.mockReset();
    mocks.getBookingById.mockReset().mockResolvedValue(buildBooking());
    mocks.updateBookingApi.mockReset().mockResolvedValue({});
    mocks.voidBooking.mockReset().mockResolvedValue({});
    mocks.releaseBooking.mockReset().mockResolvedValue({});
    mocks.checkInGuest.mockReset().mockResolvedValue({});
    mocks.reactivateBooking.mockReset().mockResolvedValue({});
    mocks.getBookingTimeline.mockReset().mockResolvedValue([]);
    mocks.getPaymentWorkflowSummary.mockReset().mockResolvedValue({});
    mocks.recordPayment.mockReset().mockResolvedValue({});
    mocks.getGuest.mockReset().mockResolvedValue({});
    mocks.getCompanies.mockReset().mockResolvedValue([]);
    mocks.getRateCodes.mockReset().mockResolvedValue({ rate_codes: [] });
    mocks.getMarketCodes.mockReset().mockResolvedValue({ market_codes: [] });
    mocks.listBookingChannels.mockReset().mockResolvedValue([]);
    mocks.getRoomChargeLedgerForBooking.mockReset().mockResolvedValue({});

    mocks.roomsQuery.data = [];
    mocks.roomsQuery.error = null;
    mocks.useRooms.mockReset().mockReturnValue(mocks.roomsQuery);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fetches the booking by the route id and renders the details panel', async () => {
    renderPage('42');

    await waitFor(() => expect(mocks.getBookingById).toHaveBeenCalledWith('42'));
    // PageHeader title + panel header both render the guest name.
    expect((await screen.findAllByText('Jane Doe')).length).toBeGreaterThanOrEqual(1);
    // Panel chrome: folio reference + stay/charges sections.
    expect(screen.getAllByText('F-1042').length).toBeGreaterThan(0);
    expect(screen.getByText(/Room 101/)).toBeDefined();
  });

  it('shows the not-found empty state with a working back button on error', async () => {
    mocks.getBookingById.mockRejectedValue(new Error('Booking not found'));
    renderPage('99');

    // Title and the error-derived description both read "Booking not found".
    expect((await screen.findAllByText('Booking not found')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: /Back to bookings/i }));
    expect(mocks.navigate).toHaveBeenCalledWith('/bookings');
  });

  it('links back to the bookings list', async () => {
    renderPage('42');

    const backLink = await screen.findByRole('link', { name: /Back to list/i });
    expect(backLink.getAttribute('href')).toBe('/bookings');
  });

  it('groups overflow actions behind the More menu on phone widths', async () => {
    matchMediaStub(true);
    renderPage('42');

    // Lifecycle CTA stays a full-width contained button.
    expect(await screen.findByRole('button', { name: /Check in/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Payment$/i })).toBeDefined();

    // Workflow/Invoice/Release/Void/Reactivate are inside the sheet, not the row.
    expect(screen.queryByRole('button', { name: /Workflow/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More/i }));
    expect(await screen.findByText('Workflow')).toBeDefined();
    expect(screen.getByText('Void')).toBeDefined();
  });
});
