import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocaleStoreForTests, setActiveLocale } from '../../../i18n/localeStore';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  paymentConfig: vi.fn(),
  publicCreate: vi.fn(),
  publicQuote: vi.fn(),
  publicSearch: vi.fn(),
  memberCreate: vi.fn(),
  memberQuote: vi.fn(),
  memberSearch: vi.fn(),
  voucherOptions: vi.fn(),
  listVouchers: vi.fn(),
  createSession: vi.fn(),
  me: vi.fn(),
}));

// Signed out: no account at all. This is what `needsLogin` means, and it used
// to bounce straight to the sign-in page.
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: undefined, isAuthenticated: false, isLoading: false }),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  Navigate: ({ to }: { to: string }) => <div data-testid="redirected" data-to={to} />,
}));

vi.mock('../../promotions/api/portalPromotionsApi', () => ({
  PortalPromotionsApi: { listVouchers: (...a: unknown[]) => mocks.listVouchers(...a) },
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    createSession: (...a: unknown[]) => mocks.createSession(...a),
    me: (...a: unknown[]) => mocks.me(...a),
  },
}));

vi.mock('../../../api/guestPortal.service', () => ({
  GuestPortalService: { paymentConfig: (...a: unknown[]) => mocks.paymentConfig(...a) },
}));

vi.mock('../api/portalTokenStore', () => ({ setPortalToken: vi.fn() }));
vi.mock('../api/usePortalSession', () => ({ usePortalSession: () => ({ token: null }) }));

vi.mock('./api', () => ({
  GuestBookingApi: {
    create: (...a: unknown[]) => mocks.memberCreate(...a),
    quote: (...a: unknown[]) => mocks.memberQuote(...a),
    search: (...a: unknown[]) => mocks.memberSearch(...a),
    voucherOptions: (...a: unknown[]) => mocks.voucherOptions(...a),
  },
  PublicBookingApi: {
    create: (...a: unknown[]) => mocks.publicCreate(...a),
    quote: (...a: unknown[]) => mocks.publicQuote(...a),
    search: (...a: unknown[]) => mocks.publicSearch(...a),
  },
}));

vi.mock('./useAvailabilitySocket', () => ({ useAvailabilitySocket: vi.fn() }));

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

/** Walk to the review step and fill in everything except tourism type. */
async function reachReviewStep() {
  render(<PortalBookingPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
  await screen.findByText('Review your stay');
}

function fillContactDetails() {
  fireEvent.change(screen.getByRole('textbox', { name: /First name/ }), {
    target: { value: 'Ahmad' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /Email/ }), {
    target: { value: 'ahmad@example.com' },
  });
}

/** Ticks the two consents the booking form requires (PDPA: never pre-ticked). */
function acceptRequiredConsents() {
  fireEvent.click(
    screen.getByRole('checkbox', { name: /Booking Terms and Conditions/ }),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /Privacy Notice/ }));
}

describe('PortalBookingPage anonymous checkout', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.publicCreate.mockReset();
    mocks.publicQuote.mockReset().mockResolvedValue(quote);
    mocks.publicSearch.mockReset().mockResolvedValue([offer]);
    mocks.memberCreate.mockReset();
    mocks.memberQuote.mockReset();
    mocks.memberSearch.mockReset();
    mocks.voucherOptions.mockReset();
    mocks.listVouchers.mockReset();
    mocks.me.mockReset();
    mocks.paymentConfig.mockReset().mockResolvedValue({
      paypal_enabled: false,
      paypal_client_id: null,
      bank_details: { bank_name: 'Maybank', account_name: 'Salim Inn', account_number: '5112' },
    });
  });

  afterEach(() => {
    cleanup();
    resetLocaleStoreForTests();
  });

  it('renders search and review labels in Bahasa Melayu when that is the active language', async () => {
    setActiveLocale('ms');
    render(<PortalBookingPage />);

    expect(screen.getByRole('heading', { name: 'Cari' })).toBeTruthy();
    expect(screen.getByLabelText('Daftar Masuk')).toBeTruthy();
    expect(screen.getByLabelText('Daftar Keluar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cari' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cari' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pilih' }));
    expect(await screen.findByRole('heading', { name: 'Semak penginapan anda' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Butiran anda' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Teruskan ke pembayaran' })).toBeTruthy();
  });

  it('lets a visitor with no account search instead of bouncing to sign-in', async () => {
    render(<PortalBookingPage />);

    expect(screen.queryByTestId('redirected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('button', { name: 'Select' });
    expect(mocks.publicSearch).toHaveBeenCalledTimes(1);
    // The account-authenticated endpoints are never reached without a session.
    expect(mocks.memberSearch).not.toHaveBeenCalled();
  });

  it('prices a room without asking the voucher-eligibility endpoint', async () => {
    await reachReviewStep();

    expect(mocks.publicQuote).toHaveBeenCalledWith(
      expect.objectContaining({ room_type_id: 7 }),
    );
    expect(mocks.voucherOptions).not.toHaveBeenCalled();
    // Discounts and rewards belong to an account, so neither control is offered.
    expect(screen.queryByRole('combobox', { name: 'Voucher' })).toBeNull();
    expect(screen.queryByText(/complimentary/i)).toBeNull();
  });

  it('collects contact details in place of the account profile', async () => {
    await reachReviewStep();

    expect(screen.getByRole('textbox', { name: /First name/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Email/ })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Guest type/ })).toBeTruthy();
  });

  it('refuses to book until tourism type is chosen explicitly', async () => {
    await reachReviewStep();
    fillContactDetails();
    // Consent given, so the only thing left to reject is the missing tourism
    // type — otherwise this test would pass for the wrong reason.
    acceptRequiredConsents();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    // Tourism type drives tourism tax, so it is never defaulted for the guest.
    await screen.findByText(/local or foreign tourist/i);
    expect(mocks.publicCreate).not.toHaveBeenCalled();
  });

  it('refuses to book without a usable email address', async () => {
    await reachReviewStep();
    fireEvent.change(screen.getByRole('textbox', { name: /First name/ }), {
      target: { value: 'Ahmad' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Email/ }), {
      target: { value: 'not-an-email' },
    });
    acceptRequiredConsents();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await screen.findByText(/valid email address/i);
    expect(mocks.publicCreate).not.toHaveBeenCalled();
  });

  it('refuses to book until the terms and privacy notice are accepted', async () => {
    await reachReviewStep();
    fillContactDetails();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Guest type/ }));
    fireEvent.click(screen.getByRole('option', { name: /Foreign tourist/ }));

    // Changing tourism type re-quotes; the button is absent while that runs.
    const confirm = await screen.findByRole('button', { name: 'Continue to payment' });

    // Everything else is valid, so a refusal here can only be the consent gate.
    fireEvent.click(confirm);

    await screen.findByText(/accept the Booking Terms and the Privacy Notice/i);
    expect(mocks.publicCreate).not.toHaveBeenCalled();
  });

  it('never pre-ticks a consent box', async () => {
    await reachReviewStep();

    // Consent must be a positive act under the PDPA, so a pre-ticked box is not
    // consent at all.
    for (const box of screen.getAllByRole('checkbox')) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
  });

  it('books at list price, carrying no voucher or credits', async () => {
    mocks.publicCreate.mockResolvedValue({
      booking_id: 91,
      booking_number: 'SI-20260717-0004',
      room_type_name: 'Deluxe Room',
      check_in_date: '2026-07-17',
      check_out_date: '2026-07-18',
      status: 'pending_payment',
      payment_status: 'unpaid',
      currency: 'MYR',
      subtotal: '250.00',
      discount_amount: '0.00',
      tax_amount: '0.00',
      total_amount: '250.00',
      created_at: '2026-07-10T00:00:00Z',
      access_token: 'booking-scoped-token',
    });

    await reachReviewStep();
    fillContactDetails();
    acceptRequiredConsents();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Guest type/ }));
    fireEvent.click(screen.getByRole('option', { name: /Foreign tourist/ }));

    await waitFor(() =>
      expect(mocks.publicQuote.mock.calls.some((call) => {
        const body = call[0] as { tourism_type?: string };
        return body.tourism_type === 'foreign';
      })).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    await waitFor(() => expect(mocks.publicCreate).toHaveBeenCalledTimes(1));
    const payload = mocks.publicCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.guest).toMatchObject({
      first_name: 'Ahmad',
      email: 'ahmad@example.com',
      tourism_type: 'foreign',
    });
    expect(payload.expected_total).toBe('250.00');
    expect(mocks.publicQuote.mock.calls.some((call) => {
      const body = call[0] as { tourism_type?: string };
      return body.tourism_type === 'foreign';
    })).toBe(true);
    expect(payload).not.toHaveProperty('voucher_id');
    expect(payload).not.toHaveProperty('complimentary_dates');
    // The consent the guest gave travels with the booking, pinned to the
    // version of the text they were shown.
    expect(payload.consents).toEqual([
      { document: 'terms_of_service', version: '2026-09-09', granted: true, locale: 'en' },
      { document: 'privacy_notice', version: '2026-09-09', granted: true, locale: 'en' },
    ]);
    // Untouched optional box is sent as an explicit refusal, not omitted.
    expect(payload.marketing_opt_in).toBe(false);
    expect(mocks.memberCreate).not.toHaveBeenCalled();

    // The booking number is the guest's way back once the link lapses, so it is
    // shown as the confirmation heading AND spelled out in the retrieval note.
    expect(await screen.findAllByText('SI-20260717-0004')).toHaveLength(2);
    expect(screen.getByText(/how you reopen this booking later/i)).toBeTruthy();
    expect(
      screen.getByText(/if it is not in Primary, check Spam and Promotions/i),
    ).toBeTruthy();
  });
});
