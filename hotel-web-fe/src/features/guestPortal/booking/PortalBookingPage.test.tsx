import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  complimentary_dates: [],
  complimentary_nights: 0,
  complimentary_discount: '0.00',
  credits_available: 0,
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
    mocks.me.mockReset().mockResolvedValue({ guest: {}, profile_complete: true });
    mocks.navigate.mockReset();
    mocks.search.mockReset().mockResolvedValue([offer]);
    mocks.quote.mockReset();
    mocks.voucherOptions.mockReset().mockResolvedValue({
      quote,
      eligible_voucher_ids: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('disables an ineligible voucher before the guest can select it', async () => {
    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Voucher' }));

    const disabledVoucher = screen.getByRole('option', {
      name: 'Summer Saver (SAVE-10) — Not eligible for this stay',
    });
    expect(disabledVoucher.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(disabledVoucher);
    await waitFor(() => expect(mocks.quote).not.toHaveBeenCalled());
  });

  it('disables a voucher if eligibility changes before it is applied', async () => {
    mocks.voucherOptions.mockResolvedValue({
      quote,
      eligible_voucher_ids: [31],
    });
    mocks.quote.mockRejectedValue(
      new Error('This voucher is not eligible for the selected stay.'),
    );

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
  });

  it('continues to payment without asking for a payment choice during review', async () => {
    mocks.paymentConfig.mockResolvedValue({
      paypal_enabled: false,
      paypal_client_id: null,
      bank_details: {
        bank_name: 'Maybank',
        account_name: 'Salim Inn',
        account_number: '511270052595',
      },
    });
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
    await screen.findByText('Review your stay');
    expect(screen.queryByText('How would you like to pay?')).toBeNull();

    const continueButton = screen.getByRole('button', { name: 'Continue to payment' }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);

    await screen.findByRole('heading', { name: 'Complete your payment' });
    await screen.findByText('Choose a payment method');
    fireEvent.click(await screen.findByRole('radio', { name: 'Offline banking (bank transfer)' }));
    expect(await screen.findByRole('button', { name: "I've paid via bank transfer" })).toBeTruthy();
  });
});

describe('PortalBookingPage profile completion guard', () => {
  beforeEach(() => {
    mocks.createBooking.mockReset();
    mocks.createSession.mockReset();
    mocks.listVouchers.mockReset().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
    });
    mocks.navigate.mockReset();
    mocks.paymentConfig.mockReset().mockResolvedValue({
      paypal_enabled: false,
      paypal_client_id: null,
      bank_details: {
        bank_name: 'Maybank',
        account_name: 'Salim Inn',
        account_number: '511270052595',
      },
    });
    mocks.search.mockReset().mockResolvedValue([offer]);
    mocks.quote.mockReset();
    mocks.voucherOptions.mockReset().mockResolvedValue({
      quote,
      eligible_voucher_ids: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('redirects to complete-profile instead of submitting, when the guest profile is incomplete', async () => {
    mocks.me.mockReset().mockResolvedValue({ guest: {}, profile_complete: false });

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/complete-profile?redirect=%2Fportal%2Fbook'),
    );
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });
});

describe('PortalBookingPage complimentary nights', () => {
  const twoNightOffer = {
    ...offer,
    nightly_rates: [
      { date: '2026-07-17', rate_plan_code: 'BASE', amount: '250.00' },
      { date: '2026-07-18', rate_plan_code: 'BASE', amount: '400.00' },
    ],
    subtotal: '650.00',
    total_amount: '650.00',
  };
  const twoNightQuote = {
    ...quote,
    check_out_date: '2026-07-19',
    nightly_rates: twoNightOffer.nightly_rates,
    subtotal: '650.00',
    total_amount: '650.00',
    credits_available: 1,
  };

  beforeEach(() => {
    mocks.createBooking.mockReset();
    mocks.createSession.mockReset();
    mocks.listVouchers.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    mocks.me.mockReset().mockResolvedValue({ guest: {}, profile_complete: true });
    mocks.navigate.mockReset();
    mocks.paymentConfig.mockReset();
    mocks.search.mockReset().mockResolvedValue([twoNightOffer]);
    mocks.quote.mockReset();
    mocks.voucherOptions.mockReset().mockResolvedValue({
      quote: twoNightQuote,
      eligible_voucher_ids: [],
    });
  });

  afterEach(cleanup);

  it('stays hidden when the guest holds no credits for the selected room type', async () => {
    mocks.voucherOptions.mockResolvedValue({
      quote: { ...twoNightQuote, credits_available: 0 },
      eligible_voucher_ids: [],
    });

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    expect(screen.queryByText('Use your complimentary nights')).toBeNull();
  });

  it('re-prices against the specific night the guest comped, not an average', async () => {
    // One credit, two nights at different rates. Comping the 400 night must
    // take 400 off — picking the night is the whole point of the control.
    mocks.quote.mockResolvedValue({
      ...twoNightQuote,
      complimentary_dates: ['2026-07-18'],
      complimentary_nights: 1,
      complimentary_discount: '400.00',
      discount_amount: '400.00',
      total_amount: '250.00',
    });

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Use your complimentary nights');

    fireEvent.click(screen.getByRole('checkbox', { name: /2026-07-18/ }));

    await waitFor(() => expect(mocks.quote).toHaveBeenCalled());
    expect(mocks.quote.mock.calls[0][0]).toMatchObject({
      room_type_id: 7,
      complimentary_dates: ['2026-07-18'],
    });
    expect(await screen.findByText('Complimentary nights (1)')).toBeTruthy();
  });

  it('stops the guest selecting more nights than they hold credits for', async () => {
    mocks.quote.mockResolvedValue({
      ...twoNightQuote,
      complimentary_dates: ['2026-07-17'],
      complimentary_nights: 1,
      complimentary_discount: '250.00',
      discount_amount: '250.00',
      total_amount: '400.00',
    });

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Use your complimentary nights');

    fireEvent.click(screen.getByRole('checkbox', { name: /2026-07-17/ }));

    // With the single credit spent, the other night can no longer be checked.
    const otherNight = await screen.findByRole('checkbox', { name: /2026-07-18/ });
    await waitFor(() => expect((otherNight as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole('checkbox', { name: /2026-07-17/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('asks the guest to confirm a free stay instead of sending them to payment', async () => {
    mocks.voucherOptions.mockResolvedValue({
      quote: {
        ...twoNightQuote,
        credits_available: 2,
        complimentary_dates: ['2026-07-17', '2026-07-18'],
        complimentary_nights: 2,
        complimentary_discount: '650.00',
        discount_amount: '650.00',
        total_amount: '0.00',
      },
      eligible_voucher_ids: [],
    });

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    expect(screen.getByRole('button', { name: 'Confirm free stay' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
    expect(
      screen.getByText('Your complimentary nights cover this stay in full — there is nothing to pay.'),
    ).toBeTruthy();
  });

  it('books the nights the server priced, so what is charged matches the review', async () => {
    mocks.voucherOptions.mockResolvedValue({
      quote: {
        ...twoNightQuote,
        complimentary_dates: ['2026-07-18'],
        complimentary_nights: 1,
        complimentary_discount: '400.00',
        discount_amount: '400.00',
        total_amount: '250.00',
      },
      eligible_voucher_ids: [],
    });
    mocks.paymentConfig.mockResolvedValue({
      paypal_enabled: false,
      paypal_client_id: null,
      bank_details: { bank_name: 'Maybank', account_name: 'Salim Inn', account_number: '511270052595' },
    });
    mocks.createBooking.mockResolvedValue({
      booking_id: 43,
      booking_number: 'WEB-43',
      room_type_name: 'Deluxe Room',
      check_in_date: '2026-07-17',
      check_out_date: '2026-07-19',
      status: 'pending_payment',
      payment_status: 'unpaid',
      currency: 'MYR',
      subtotal: '650.00',
      discount_amount: '400.00',
      tax_amount: '0.00',
      total_amount: '250.00',
      created_at: '2026-07-01T00:00:00Z',
    });

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(mocks.createBooking).toHaveBeenCalled());
    expect(mocks.createBooking.mock.calls[0][0]).toMatchObject({
      complimentary_dates: ['2026-07-18'],
      expected_total: '250.00',
    });
  });
});
