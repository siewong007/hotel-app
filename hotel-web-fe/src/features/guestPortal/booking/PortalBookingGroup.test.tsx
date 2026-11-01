import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HTTPError } from 'ky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBooking: vi.fn(),
  createSession: vi.fn(),
  listVouchers: vi.fn(),
  me: vi.fn(),
  navigate: vi.fn(),
  paymentConfig: vi.fn(),
  quote: vi.fn(),
  search: vi.fn(),
  voucherOptions: vi.fn(),
  groupQuote: vi.fn(),
  groupCreate: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { user_type: 'guest' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../promotions/api/portalPromotionsApi', () => ({
  PortalPromotionsApi: {
    listVouchers: (...args: unknown[]) => mocks.listVouchers(...args),
  },
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    createSession: (...args: unknown[]) => mocks.createSession(...args),
    me: (...args: unknown[]) => mocks.me(...args),
    paymentConfig: (...args: unknown[]) => mocks.paymentConfig(...args),
  },
}));

vi.mock('../../../api/guestPortal.service', () => ({
  GuestPortalService: {
    paymentConfig: (...args: unknown[]) => mocks.paymentConfig(...args),
  },
}));

vi.mock('../api/portalTokenStore', () => ({
  setPortalToken: vi.fn(),
}));

/** Ticks the two consents the booking form requires (PDPA: never pre-ticked). */
function acceptRequiredConsents() {
  fireEvent.click(
    screen.getByRole('checkbox', { name: /Booking Terms and Conditions/ }),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /Privacy Notice/ }));
}

vi.mock('../api/usePortalSession', () => ({
  usePortalSession: () => ({ token: 'guest-token' }),
}));

vi.mock('./api', () => ({
  GuestBookingApi: {
    create: (...args: unknown[]) => mocks.createBooking(...args),
    quote: (...args: unknown[]) => mocks.quote(...args),
    search: (...args: unknown[]) => mocks.search(...args),
    voucherOptions: (...args: unknown[]) => mocks.voucherOptions(...args),
  },
  GroupBookingApi: {
    quote: (...args: unknown[]) => mocks.groupQuote(...args),
    create: (...args: unknown[]) => mocks.groupCreate(...args),
  },
  PublicGroupBookingApi: { quote: vi.fn(), create: vi.fn() },
}))

vi.mock('./useAvailabilitySocket', () => ({
  useAvailabilitySocket: vi.fn(),
}));

import PortalBookingPage from './PortalBookingPage';
import { CART_STORAGE_KEY } from './cart';

const offer = {
  room_type_id: 7,
  room_type_code: 'DLX',
  room_type_name: 'Deluxe Room',
  description: null,
  max_occupancy: 2,
  bed_type: 'King',
  bed_count: 1,
  images: [],
  features: [],
  available_rooms: 3,
  currency: 'MYR',
  nightly_rates: [{ date: '2026-07-17', rate_plan_code: 'BASE', amount: '250.00' }],
  subtotal: '250.00',
  discount_amount: '0.00',
  tax_amount: '0.00',
  total_amount: '250.00',
};

const quote = {
  room_type_id: 7,
  room_type_code: 'DLX',
  room_type_name: 'Deluxe Room',
  check_in_date: '2026-07-17',
  check_out_date: '2026-07-18',
  adults: 1,
  children: 0,
  currency: 'MYR',
  nightly_rates: [{ date: '2026-07-17', rate_plan_code: 'BASE', amount: '250.00' }],
  subtotal: '250.00',
  discount_amount: '0.00',
  tax_amount: '0.00',
  total_amount: '250.00',
  voucher_id: null,
  voucher_name: null,
  complimentary_dates: [],
  complimentary_nights: 0,
  complimentary_discount: '0.00',
  credits_available: 0,
};

function groupQuoteFor(rooms: number) {
  return {
    check_in_date: '2026-07-17', check_out_date: '2026-07-18', currency: 'MYR', room_count: rooms, max_rooms: 5,
    rooms: Array.from({ length: rooms }, (_, index) => ({ index, quote, extra_bed_count: 0, extra_bed_charge: '0', room_total: '250.00' })),
    availability: [], subtotal: String(250 * rooms), discount_amount: '0', tax_amount: '0', extra_bed_charge: '0',
    total_amount: String(250 * rooms), voucher_discount: '0', complimentary_nights: 0, complimentary_discount: '0', credits_available: [],
  };
}

describe('PortalBookingPage multi-room cart', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.listVouchers.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    mocks.me.mockReset().mockResolvedValue({ guest: {}, profile_complete: true });
    mocks.paymentConfig.mockReset().mockResolvedValue({ paypal_enabled: false, paypal_client_id: null, bank_transfer_enabled: true, bank_details: { bank_name: 'Test Bank', account_name: 'Salim Inn', account_number: '123' } });
    mocks.search.mockReset().mockResolvedValue([offer]);
    mocks.groupQuote.mockReset().mockImplementation((request: { rooms: unknown[] }) => Promise.resolve(groupQuoteFor(request.rooms.length)));
    mocks.groupCreate.mockReset();
  });
  afterEach(() => cleanup());

  it('warns, without blocking, when the rooms sleep fewer guests than searched', async () => {
    render(<PortalBookingPage />);
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Children'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: 'Add a Deluxe Room room' });
    fireEvent.click(add);
    expect(screen.getByTestId('capacity-notice').textContent).toBe(
      'Your rooms fit 2 guests but you searched for 5. Add another room so everyone has a bed.',
    );
    fireEvent.click(add);
    expect(screen.getByTestId('capacity-notice').textContent).toContain('fit 4 guests');
    expect(screen.getByRole('button', { name: 'Checkout' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(add);
    expect(screen.queryByTestId('capacity-notice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a Deluxe Room room' }));
    expect(screen.getByTestId('capacity-notice').textContent).toContain('fit 4 guests');
  });

  it('has no per-card Select button', async () => {
    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('button', { name: 'Add a Deluxe Room room' });
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('shows the sticky bar from the first room and caps the stepper at availability', async () => {
    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: 'Add a Deluxe Room room' });
    expect(screen.queryByTestId('cart-bar')).toBeNull();
    fireEvent.click(add);
    expect(screen.getByTestId('cart-bar').textContent).toContain('1 room');
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByTestId('cart-bar').textContent).toContain('3 rooms');
    expect((add as HTMLButtonElement).disabled).toBe(true);
    const saved = JSON.parse(window.sessionStorage.getItem(CART_STORAGE_KEY) ?? '{}');
    expect(saved.rooms).toHaveLength(3);
  });

  it('restores the cart after a refresh and books the whole group in one request', async () => {
    const first = render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: 'Add a Deluxe Room room' });
    fireEvent.click(add);
    fireEvent.click(add);
    first.unmount();

    render(<PortalBookingPage />);
    expect(screen.getByTestId('cart-bar').textContent).toContain('2 rooms');
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await screen.findByText('Your rooms');
    await waitFor(() => expect(mocks.groupQuote).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to payment' }).hasAttribute('disabled')).toBe(false));

    mocks.groupCreate.mockResolvedValue({
      group_id: 9, group_number: 'GRP-0009', status: 'pending_payment', payment_status: 'unpaid',
      check_in_date: '2026-07-17', check_out_date: '2026-07-18', currency: 'MYR', room_count: 2,
      subtotal: '500', discount_amount: '0', tax_amount: '0', total_amount: '500',
      rooms: [1, 2].map((n) => ({ booking_id: n, booking_number: `BK-${n}`, room_type_name: 'Deluxe Room', check_in_date: '2026-07-17', check_out_date: '2026-07-18', status: 'pending_payment', payment_status: 'unpaid', currency: 'MYR', subtotal: '250', discount_amount: '0', tax_amount: '0', total_amount: '250', created_at: '2026-07-01T00:00:00Z' })),
    });
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByText('GRP-0009');
    expect(mocks.groupCreate).toHaveBeenCalledTimes(1);
    const [request] = mocks.groupCreate.mock.calls[0] as [{ rooms: unknown[]; expected_total: string }];
    expect(request.rooms).toHaveLength(2);
    expect(request.expected_total).toBe('500');
    await waitFor(() => expect(window.sessionStorage.getItem(CART_STORAGE_KEY)).toBeNull());
  });

  it('lets the guest move a complimentary night to another room and books that placement', async () => {
    type Req = { rooms: unknown[]; use_credits?: boolean; complimentary?: { room_index: number; date: string }[] };
    mocks.groupQuote.mockImplementation((request: Req) => {
      const base = groupQuoteFor(request.rooms.length);
      const placed = request.complimentary ?? (request.use_credits ? [{ room_index: 0, date: '2026-07-17' }] : []);
      return Promise.resolve({
        ...base,
        credits_available: [{ room_type_id: 7, nights_available: 1 }],
        rooms: base.rooms.map((room) => ({ ...room, quote: { ...room.quote, complimentary_dates: placed.filter((n) => n.room_index === room.index).map((n) => n.date) } })),
      });
    });
    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: 'Add a Deluxe Room room' });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Use my 1 complimentary night/ }));

    const room1 = await screen.findByRole('checkbox', { name: 'Use a complimentary night for Room 1 · Deluxe Room on 2026-07-17' });
    await waitFor(() => expect((room1 as HTMLInputElement).checked).toBe(true));
    const room2 = screen.getByRole('checkbox', { name: 'Use a complimentary night for Room 2 · Deluxe Room on 2026-07-17' });
    expect(room2.hasAttribute('disabled')).toBe(true);

    fireEvent.click(room1);
    await waitFor(() => expect(mocks.groupQuote).toHaveBeenLastCalledWith(expect.objectContaining({ use_credits: false }), 'guest-token'));
    const room2Again = await screen.findByRole('checkbox', { name: 'Use a complimentary night for Room 2 · Deluxe Room on 2026-07-17' });
    await waitFor(() => expect(room2Again.hasAttribute('disabled')).toBe(false));
    fireEvent.click(room2Again);
    await waitFor(() => expect(mocks.groupQuote).toHaveBeenLastCalledWith(
      expect.objectContaining({ use_credits: true, complimentary: [{ room_index: 1, date: '2026-07-17' }] }), 'guest-token'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to payment' }).hasAttribute('disabled')).toBe(false));

    mocks.groupCreate.mockRejectedValue(new Error('stop'));
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(mocks.groupCreate).toHaveBeenCalledTimes(1));
    expect(mocks.groupCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ use_credits: true, complimentary: [{ room_index: 1, date: '2026-07-17' }] }));
  });

  it('keeps the cart and shows the server error when a room is taken mid-checkout', async () => {
    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const add = await screen.findByRole('button', { name: 'Add a Deluxe Room room' });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to payment' }).hasAttribute('disabled')).toBe(false));
    const body = { error: 'Room 1: Deluxe Room is no longer available for these dates' };
    const conflict = new HTTPError(
      new Response(JSON.stringify(body), { status: 409, statusText: 'Conflict' }),
      new Request('http://localhost/api/guest-portal/me/booking-groups', { method: 'POST' }),
      {} as never,
    );
    (conflict as unknown as { data: unknown }).data = body;
    conflict.message = body.error;
    mocks.groupCreate.mockRejectedValue(conflict);
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByText('Room 1: Deluxe Room is no longer available for these dates');
    expect(screen.getByTestId('cart-bar').textContent).toContain('2 rooms');
  });
});
