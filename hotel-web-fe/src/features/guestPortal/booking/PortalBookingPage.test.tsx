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
}));

vi.mock('./useAvailabilitySocket', () => ({
  useAvailabilitySocket: vi.fn(),
}));

import PortalBookingPage from './PortalBookingPage';
import { expectNoAxeViolations } from '../../../test/axe';

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

/**
 * Build the HTTPError ky 2 throws, including the part that matters here: ky
 * reads the body to populate `error.data` *before* throwing (`httpError.data =
 * await ky.#getResponseData(currentResponse)` in ky's Ky.js), which leaves the
 * response stream already used.
 *
 * A fixture that only sets `.data` and leaves the stream readable would let
 * `error.response.json()` succeed here and could never catch this regression.
 */
async function buildKyHttpError(status: number, body: unknown): Promise<HTTPError> {
  const response = new Response(JSON.stringify(body), {
    status,
    statusText: 'Unprocessable Entity',
    headers: { 'Content-Type': 'application/json' },
  });
  const request = new Request('http://localhost/api/portal/bookings', { method: 'POST' });
  const error = new HTTPError(response, request, {} as never);
  // The read that consumes the stream, exactly as ky does before throwing.
  (error as unknown as { data: unknown }).data = await response.json();
  return error;
}

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
    // Mirror what the client's beforeError hook hands the page: ky pre-parses
    // the body onto `error.data` and rewrites `error.message` to the server's
    // own message, which is both what `isVoucherEligibilityError` matches and
    // what `guestErrorMessage` displays.
    const eligibilityBody = { error: 'This voucher is not eligible for the selected stay.' };
    const eligibilityError = new HTTPError(
      new Response(JSON.stringify(eligibilityBody), { status: 422, statusText: 'Unprocessable Entity' }),
      new Request('http://localhost/api/portal/bookings/quote', { method: 'POST' }),
      {} as never,
    );
    (eligibilityError as unknown as { data: unknown }).data = eligibilityBody;
    eligibilityError.message = eligibilityBody.error;
    mocks.quote.mockRejectedValue(eligibilityError);

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

  it('blocks a second voucher change while a re-quote is still in flight', async () => {
    mocks.voucherOptions.mockResolvedValue({
      quote,
      eligible_voucher_ids: [31],
    });
    let release!: (nextQuote: unknown) => void;
    mocks.quote.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Voucher' }));
    fireEvent.click(screen.getByRole('option', { name: 'Summer Saver (SAVE-10)' }));
    await waitFor(() => expect(mocks.quote).toHaveBeenCalledTimes(1));

    // The picker disables while the re-price runs, so no overlapping quote can
    // start and resolve out of order over the newer one.
    const voucherPicker = screen.getByRole('combobox', { name: 'Voucher' });
    expect(voucherPicker.getAttribute('aria-disabled')).toBe('true');
    fireEvent.mouseDown(voucherPicker);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(mocks.quote).toHaveBeenCalledTimes(1);

    release(quote);
    await waitFor(() =>
      expect(voucherPicker.getAttribute('aria-disabled')).not.toBe('true'),
    );
  });

  it('warns at the voucher picker when vouchers fail to load, without masking the quote flow', async () => {
    mocks.listVouchers.mockReset().mockRejectedValue(new Error('Network down'));

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    expect(
      await screen.findByText(
        'We could not load your vouchers. You can still book without one.',
      ),
    ).toBeTruthy();
    // The quote/search flow is untouched: the picker renders empty and the
    // guest can still proceed to payment.
    expect(screen.getByRole('combobox', { name: 'Voucher' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeTruthy();

    mocks.listVouchers.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.listVouchers).toHaveBeenCalledTimes(2));
  });

  it('moves focus to the form-level alert when booking creation fails', async () => {
    mocks.createBooking.mockRejectedValue(new Error('Server unavailable'));

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    // The Collapse keeps the alert hidden until it finishes opening, so grab
    // the message and check where focus actually landed.
    const message = await screen.findByText('Unable to create the booking.');
    const alert = message.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(alert));
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
    acceptRequiredConsents();
    fireEvent.click(continueButton);

    await screen.findByRole('heading', { name: 'Complete your payment' });
    expect(
      screen.getByText(/if it is not in Primary, check Spam and Promotions/i),
    ).toBeTruthy();
    await screen.findByText('Choose a payment method');
    fireEvent.click(await screen.findByRole('radio', { name: 'Offline banking (bank transfer)' }));
    expect(await screen.findByRole('button', { name: "I've paid via bank transfer" })).toBeTruthy();
  });
  it('sends the chosen smoking preference with a signed-in booking and shows it on the confirmation', async () => {
    mocks.paymentConfig.mockResolvedValue({ paypal_enabled: false, paypal_client_id: null, bank_details: { bank_name: 'Maybank', account_name: 'Salim Inn', account_number: '511270052595' } });
    mocks.createBooking.mockResolvedValue({
      booking_id: 43,
      booking_number: 'WEB-43',
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
      smoking_preference: 'non_smoking',
    });

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');

    // Defaults to "No preference", with the not-guaranteed helper text.
    expect((screen.getByRole('radio', { name: 'No preference' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Subject to availability and not guaranteed/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Non-smoking' }));
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(mocks.createBooking).toHaveBeenCalledTimes(1));
    expect(mocks.createBooking.mock.calls[0][0]).toMatchObject({ smoking_preference: 'non_smoking' });
    expect(await screen.findByText('Room preference: Non-smoking (subject to availability)')).toBeTruthy();
  });

  it('leaves smoking_preference out of a signed-in booking when the guest has no preference', async () => {
    mocks.createBooking.mockRejectedValue(new Error('stop here'));

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(mocks.createBooking).toHaveBeenCalledTimes(1));
    expect(mocks.createBooking.mock.calls[0][0]).not.toHaveProperty('smoking_preference');
  });

  it('has no axe violations on the populated rate selection', async () => {
    const { container } = render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('button', { name: 'Select' })).toBeTruthy();
    await expectNoAxeViolations(container);
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

  it('redirects to complete-profile when the server rejects the booking as profile_incomplete', async () => {
    // The race the client-side guard above cannot cover: the profile looked
    // complete when this page loaded and the server disagrees at creation time.
    mocks.me.mockReset().mockResolvedValue({ guest: {}, profile_complete: true });
    mocks.createBooking.mockRejectedValueOnce(
      await buildKyHttpError(422, {
        error: 'Complete your profile before making a booking.',
        code: 'profile_incomplete',
        missing_profile_fields: ['phone', 'address'],
      }),
    );

    render(<PortalBookingPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');
    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(mocks.createBooking).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/complete-profile?redirect=%2Fportal%2Fbook'),
    );
    // The guest is being sent away to finish their profile, so the generic
    // create-failure path must not also run and re-price the stay behind them.
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it('reproduces ky 2 consuming the error body, so the redirect test cannot silently pass', async () => {
    const error = await buildKyHttpError(422, {
      code: 'profile_incomplete',
      missing_profile_fields: [],
    });

    // Guards the fixture, not the page: reading the code under test out of
    // `error.response` is exactly the bug, and it only shows up when the
    // stream really is spent.
    expect(error.response.bodyUsed).toBe(true);
    // Asserting that this read rejects IS the point here; the ban exists to keep
    // production code from doing it.
    // eslint-disable-next-line no-restricted-syntax
    await expect(error.response.json()).rejects.toThrow();
    expect((error as unknown as { data: unknown }).data).toMatchObject({
      code: 'profile_incomplete',
    });
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

  it('ignores complimentary-night toggles while a re-quote is in flight', async () => {
    let release!: (nextQuote: unknown) => void;
    mocks.quote.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Use your complimentary nights');

    fireEvent.click(screen.getByRole('checkbox', { name: /2026-07-17/ }));
    await waitFor(() => expect(mocks.quote).toHaveBeenCalledTimes(1));

    // Disabled while the re-price runs: a second toggle would otherwise fire an
    // overlapping quote that could resolve last and overwrite the newer one.
    const otherNight = screen.getByRole('checkbox', { name: /2026-07-18/ }) as HTMLInputElement;
    expect(otherNight.disabled).toBe(true);
    fireEvent.click(otherNight);
    expect(mocks.quote).toHaveBeenCalledTimes(1);

    release(twoNightQuote);
    await waitFor(() => expect(otherNight.disabled).toBe(false));
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
    acceptRequiredConsents();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(mocks.createBooking).toHaveBeenCalled());
    expect(mocks.createBooking.mock.calls[0][0]).toMatchObject({
      complimentary_dates: ['2026-07-18'],
      expected_total: '250.00',
      consents: [
        { document: 'terms_of_service', granted: true, locale: 'en' },
        { document: 'privacy_notice', granted: true, locale: 'en' },
      ],
    });
  });
});

describe('PortalBookingPage pending states', () => {
  beforeEach(() => {
    mocks.createBooking.mockReset();
    mocks.createSession.mockReset();
    mocks.listVouchers.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    mocks.me.mockReset().mockResolvedValue({ guest: {}, profile_complete: true });
    mocks.navigate.mockReset();
    mocks.paymentConfig.mockReset();
    mocks.search.mockReset().mockResolvedValue([offer]);
    mocks.quote.mockReset();
    mocks.voucherOptions.mockReset().mockResolvedValue({ quote, eligible_voucher_ids: [] });
  });

  afterEach(cleanup);

  it('disables the search button while a search is in flight', async () => {
    let release!: (offers: unknown[]) => void;
    mocks.search.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    render(<PortalBookingPage />);
    const searchButton = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
    fireEvent.click(searchButton);

    await waitFor(() => expect(searchButton.disabled).toBe(true));
    release([offer]);
    await screen.findByRole('button', { name: 'Select' });
  });

  it('disables the confirm button while the booking request is in flight', async () => {
    let release!: (confirmation: unknown) => void;
    mocks.createBooking.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    render(<PortalBookingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByText('Review your stay');
    acceptRequiredConsents();

    const confirm = screen.getByRole('button', { name: 'Continue to payment' }) as HTMLButtonElement;
    fireEvent.click(confirm);

    await waitFor(() => expect(confirm.disabled).toBe(true));
    release({
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
    await screen.findByRole('heading', { name: 'Complete your payment' });
  });
});
