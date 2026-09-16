import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { BookingWithDetails } from '../../../types';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import { resetLocaleStoreForTests } from '../../../i18n/localeStore';

// ---------------------------------------------------------------------------
// BookingDetailPage (route /bookings/$bookingId). Kept REAL: useBooking (the
// fetch-by-id path), useBookingActions + its dialog mounts, BookingDetailsPanel,
// PageHeader/EmptyState/LogoLoader, i18n (no provider needed), utils.
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
  getAllRoomTypes: vi.fn(),
  getAvailableRoomsForDates: vi.fn(),
  updateRoomStatus: vi.fn(),
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
  RoomsService: {
    getAllRoomTypes: (...args: unknown[]) => mocks.getAllRoomTypes(...args),
    getAvailableRoomsForDates: (...args: unknown[]) => mocks.getAvailableRoomsForDates(...args),
    updateRoomStatus: (...args: unknown[]) => mocks.updateRoomStatus(...args),
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
import { expectNoAxeViolations } from '../../../test/axe';

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
    mocks.getAllRoomTypes.mockReset().mockResolvedValue([]);
    mocks.getAvailableRoomsForDates.mockReset().mockResolvedValue([]);
    mocks.updateRoomStatus.mockReset().mockResolvedValue({});

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

  it('renders the secondary metadata chips (channel, billing, night audit) below the folio line', async () => {
    // source 'website' resolves through the default configured channels to
    // 'Direct Website' (abbreviation 'DW'); is_posted marks the booking as
    // night-audit touched. The chips moved off the phone list rows live here.
    mocks.getBookingById.mockResolvedValue(buildBooking({
      source: 'website',
      guest_type: 'non_member',
      is_posted: true,
    }));
    renderPage('42');

    expect(await screen.findByText('DW')).toBeDefined();
    expect(screen.getByText('Non-member')).toBeDefined();
    expect(screen.getByText('Night audit')).toBeDefined();
  });

  it('renders no secondary metadata chips when the booking carries none of those fields', async () => {
    // Default fixture: walk_in source, no guest_type, not posted.
    renderPage('42');

    await screen.findAllByText('Jane Doe');
    expect(screen.queryByText('DW')).toBeNull();
    expect(screen.queryByText('Non-member')).toBeNull();
    expect(screen.queryByText('Night audit')).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Booking-action dialog coverage. These used to be driven through
  // BookingsPage's auto-opened inline details panel; the panel lives on this
  // page now, so the assertions moved with it (recordPayment is asserted at
  // the service seam — this harness keeps the real mutation hooks).
  // ---------------------------------------------------------------------

  it('the "Check in" button fetches the guest profile and prefills IC/phone', async () => {
    mocks.getGuest.mockResolvedValue({ ic_number: '990101-01-1234', phone: '0123456789' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }));

    await waitFor(() => expect(mocks.getGuest).toHaveBeenCalledWith('g-7'));
    expect(screen.getByText('Check-In - Room 101')).toBeDefined();
    expect(screen.getByText('Booking #BK-1042')).toBeDefined();

    await waitFor(() => {
      const icField = screen.getByLabelText(/IC \/ Passport Number/) as HTMLInputElement;
      expect(icField.value).toBe('990101-01-1234');
    });
  });

  // The Accept Payment dialog carries no date field, so the payments row is
  // stamped with the server timestamp — recording a payment here dates it to
  // the day the status is changed, not the day the guest handed over money.
  // Staff must be told before they use this instead of the checkout invoice
  // (the only path that sends an explicit payment_date).
  it('the Accept Payment dialog warns that the payment is dated today', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Payment' }));

    const notice = screen
      .getAllByRole('alert')
      .find(node => node.textContent?.includes('This payment will be dated'));

    expect(notice).toBeDefined();
    expect(notice?.textContent).toContain('not the day the guest actually paid');
    expect(notice?.textContent).toContain('Record Payment');
  });

  it('reuses a failed booking payment key, rotates it after a material edit, and clears it after success', async () => {
    // Fake timers with automatic advancement make RTL's waitFor polling
    // deterministic under parallel-suite load; the code under test has no
    // timers of its own (same pattern as the timezone test below).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const timeout = new Error('timeout');
      mocks.recordPayment
        .mockRejectedValueOnce(timeout)
        .mockRejectedValueOnce(timeout)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Payment' }));
      const dialog = await screen.findByRole('dialog');

      const [amountInput] = within(dialog).getAllByRole('spinbutton');
      fireEvent.change(amountInput, { target: { value: '150' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1));

      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(2));
      const firstRequest = mocks.recordPayment.mock.calls[0][0];
      expect(mocks.recordPayment.mock.calls[1][0].idempotency_key)
        .toBe(firstRequest.idempotency_key);

      fireEvent.mouseDown(within(dialog).getByRole('combobox'));
      fireEvent.click(await screen.findByRole('option', { name: 'Bank Transfer' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(3));
      const changedRequest = mocks.recordPayment.mock.calls[2][0];
      expect(changedRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept Payment' }));
      await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(4));
      expect(mocks.recordPayment.mock.calls[3][0].idempotency_key)
        .not.toBe(changedRequest.idempotency_key);
    } finally {
      vi.useRealTimers();
    }
  });

  // Review finding I5 regression pin, now reachable: on the old list page the
  // `checkout_required` dialog could not be driven through the harness (the
  // auto-opened panel unmounted between query and click). Here the panel is
  // the page, so a checked-in booking with a balance reaches it via "Check
  // out". The reference must be checkout-prefixed and stable across retries
  // of one attempt — the backend checks it before the idempotency key.
  it('sends a stable checkout-prefixed transaction reference for checkout-required payments', async () => {
    mocks.getBookingById.mockResolvedValue(buildBooking({ status: 'checked_in' }));
    mocks.recordPayment
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(undefined);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Check out' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept Payment' }));
    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(1));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept Payment' }));
    await waitFor(() => expect(mocks.recordPayment).toHaveBeenCalledTimes(2));

    const firstRef = mocks.recordPayment.mock.calls[0][0].transaction_reference;
    expect(firstRef).toMatch(/^checkout-42-/);
    expect(mocks.recordPayment.mock.calls[1][0].transaction_reference).toBe(firstRef);
  });

  // The date must resolve in the HOTEL timezone: the server stamps the row
  // there, and formatHotelDate passes date-only strings straight through, so
  // handing it a machine-local 'YYYY-MM-DD' would name the viewer's day.
  //
  // Pinned to an instant where the two genuinely disagree — a hotel in UTC+14
  // has already rolled over to Aug 7 while every zone from UTC-11 to UTC+13
  // is still on Aug 6. Without this the assertion proves nothing: the dev
  // machine (Asia/Kuching) and the seeded hotel zone (Asia/Kuala_Lumpur) are
  // both UTC+8, so a machine-local date renders identically.
  it('dates the Accept Payment notice in the hotel timezone, not the viewer’s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-08-06T10:00:00Z'));
      localStorage.setItem(
        'hotelSettings',
        JSON.stringify({ timezone: 'Pacific/Kiritimati' }),
      );

      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Payment' }));

      const notice = screen
        .getAllByRole('alert')
        .find(node => node.textContent?.includes('This payment will be dated'));

      expect(notice?.textContent).toContain('today (Aug 7, 2026)');
    } finally {
      vi.useRealTimers();
    }
  });

  describe('fields the panel used to discard', () => {
    it('shows notes, remarks and the payment note the API already returns', async () => {
      mocks.getBookingById.mockResolvedValue(buildBooking({
        special_requests: 'High floor, away from the lift',
        remarks: 'Booking.com - Ref: ABC123',
        payment_note: 'Company to settle on invoice',
      }));
      renderPage();

      expect(await screen.findByText('Notes & requests')).toBeDefined();
      expect(screen.getByText('High floor, away from the lift')).toBeDefined();
      expect(screen.getByText('Booking.com - Ref: ABC123')).toBeDefined();
      expect(screen.getByText('Company to settle on invoice')).toBeDefined();
    });

    it('omits the notes section entirely when the booking carries none', async () => {
      renderPage();

      await screen.findAllByText('Jane Doe');
      expect(screen.queryByText('Notes & requests')).toBeNull();
    });

    it('shows occupancy next to the room, counting children separately', async () => {
      mocks.getBookingById.mockResolvedValue(buildBooking({ adults: 2, children: 1 }));
      renderPage();

      expect(await screen.findByText(/2 adult\(s\), 1 child\(ren\)/)).toBeDefined();
    });

    it('shows the amount paid and keeps the deposit as a separate held line', async () => {
      mocks.getBookingById.mockResolvedValue(buildBooking({
        total_paid: 200,
        balance_due: 250,
        deposit_amount: 50,
        deposit_paid: true,
        payment_status: 'partial',
      }));
      renderPage();

      expect(await screen.findByText('Paid')).toBeDefined();
      expect(screen.getByText('Deposit held')).toBeDefined();
      // The deposit must NOT be folded into the balance: balance_due excludes
      // deposit payment types by design, so 250 is what the guest still owes.
      expect(screen.getByText(/Due.*250/)).toBeDefined();
    });

    it('hides the paid and deposit lines when there is nothing to show', async () => {
      renderPage();

      await screen.findAllByText('Jane Doe');
      expect(screen.queryByText('Paid')).toBeNull();
      expect(screen.queryByText('Deposit held')).toBeNull();
      expect(screen.queryByText('Refunded')).toBeNull();
    });
  });

  describe('quick edit parity with the drawer', () => {
    it('offers the drawer\'s inline quick edit to an admin', async () => {
      mocks.hasPermission.mockReturnValue(true);
      renderPage();

      // The full page used to be a strict subset of the drawer that opens it.
      expect(await screen.findByText('Quick edit')).toBeDefined();
      expect(screen.getByRole('button', { name: /Save changes/i })).toBeDefined();
    });

    it('withholds quick edit from a user without booking update rights', async () => {
      mocks.hasPermission.mockReturnValue(false);
      renderPage();

      await screen.findAllByText('Jane Doe');
      expect(screen.queryByText('Quick edit')).toBeNull();
    });
  });

  describe('permission gating', () => {
    it('hides the admin-only Edit control and skips the booking-channels/companies fetches for a non-admin user', async () => {
      renderPage();

      await screen.findByRole('button', { name: 'Check in' });

      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
      expect(mocks.listBookingChannels).not.toHaveBeenCalled();
      expect(mocks.getCompanies).not.toHaveBeenCalled();
    });

    it('shows the admin-only Edit control, fetches booking channels, and loads active companies once Edit opens the dialog', async () => {
      mocks.hasPermission.mockImplementation((permission: string) => permission === 'bookings:update');

      renderPage();

      await waitFor(() => expect(mocks.listBookingChannels).toHaveBeenCalledTimes(1));

      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

      expect(await screen.findByText('Edit Booking #F-1042')).toBeDefined();
      await waitFor(() => expect(mocks.getAllRoomTypes).toHaveBeenCalled());
      await waitFor(() => expect(mocks.getCompanies).toHaveBeenCalled());
    });
  });

  it('has no axe violations on the populated booking detail', async () => {
    const { container } = renderPage('42');

    expect((await screen.findAllByText('Jane Doe')).length).toBeGreaterThanOrEqual(1);
    await expectNoAxeViolations(container);
  });
});
