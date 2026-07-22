import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBooking: vi.fn(),
  createSession: vi.fn(),
  listVouchers: vi.fn(),
  navigate: vi.fn(),
  quote: vi.fn(),
  search: vi.fn(),
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
  },
}));

vi.mock('../api/portalTokenStore', () => ({
  setPortalToken: vi.fn(),
}));

vi.mock('../api/usePortalSession', () => ({
  usePortalSession: () => ({ token: 'guest-token' }),
}));

vi.mock('./api', () => ({
  GuestBookingApi: {
    create: (...args: unknown[]) => mocks.createBooking(...args),
    quote: (...args: unknown[]) => mocks.quote(...args),
    search: (...args: unknown[]) => mocks.search(...args),
  },
}));

vi.mock('./useAvailabilitySocket', () => ({
  useAvailabilitySocket: vi.fn(),
}));

import PortalBookingPage from './PortalBookingPage';

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
};

describe('PortalBookingPage voucher eligibility', () => {
  beforeEach(() => {
    mocks.createBooking.mockReset();
    mocks.createSession.mockReset();
    mocks.listVouchers.mockReset().mockResolvedValue({
      items: [{
        id: 31,
        promotion_id: 4,
        promotion_name: 'Summer Saver',
        promotion_slug: 'summer-saver',
        code: 'SAVE-10',
        status: 'available',
        source: 'claim',
        expires_at: null,
        created_at: '2026-07-01T00:00:00Z',
      }],
      total: 1,
      page: 1,
      page_size: 100,
    });
    mocks.navigate.mockReset();
    mocks.search.mockReset().mockResolvedValue([offer]);
    mocks.quote
      .mockReset()
      .mockResolvedValueOnce(quote)
      .mockRejectedValueOnce(
        new Error('This voucher is not eligible for the selected stay.'),
      );
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps a voucher disabled after the backend rejects it for the selected stay', async () => {
    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Voucher' }));
    fireEvent.click(screen.getByRole('option', { name: 'Summer Saver (SAVE-10)' }));

    await screen.findByText('This voucher is not eligible for the selected stay.');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Voucher' }));

    const disabledVoucher = screen.getByRole('option', {
      name: 'Summer Saver (SAVE-10) — Not eligible for this stay',
    });
    expect(disabledVoucher.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(disabledVoucher);
    await waitFor(() => expect(mocks.quote).toHaveBeenCalledTimes(2));
  });

  it('requires a payment choice and labels pay-at-hotel bookings as pending', async () => {
    mocks.createBooking.mockResolvedValue({
      booking_id: 42,
      booking_number: 'WEB-42',
      room_type_name: 'Deluxe Room',
      check_in_date: '2026-07-17',
      check_out_date: '2026-07-18',
      status: 'pending',
      payment_status: 'unpaid',
      currency: 'MYR',
      subtotal: '250.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '250.00',
      created_at: '2026-07-01T00:00:00Z',
    });

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('How would you like to pay?');

    expect((screen.getByRole('button', { name: 'Continue to payment' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Pay at the hotel (offline)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit booking request' }));

    await screen.findByRole('heading', { name: 'Booking request received' });
    expect(screen.getByText(/booking is pending until the hotel confirms it/i)).toBeTruthy();
  });
});
