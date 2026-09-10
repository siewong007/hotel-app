import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  searchParams: new URLSearchParams(),
  getBooking: vi.fn(),
  uploadPaymentReceipt: vi.fn(),
  submitPreCheckin: vi.fn(),
  claimAccount: vi.fn(),
  autoCheckin: vi.fn(),
  captureBookingAccessToken: vi.fn(),
  getValidPortalToken: vi.fn(),
  setPortalToken: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('../../../api', () => ({
  GuestPortalService: {
    getBooking: (...args: unknown[]) => mocks.getBooking(...args),
    uploadPaymentReceipt: (...args: unknown[]) => mocks.uploadPaymentReceipt(...args),
    submitPreCheckin: (...args: unknown[]) => mocks.submitPreCheckin(...args),
    claimAccount: (...args: unknown[]) => mocks.claimAccount(...args),
    autoCheckin: (...args: unknown[]) => mocks.autoCheckin(...args),
  },
}));

vi.mock('../../guestPortal/api/bookingAccessTokenStore', () => ({
  captureBookingAccessToken: (...args: unknown[]) => mocks.captureBookingAccessToken(...args),
}));

vi.mock('../../guestPortal/api/portalTokenStore', () => ({
  getValidPortalToken: () => mocks.getValidPortalToken(),
  setPortalToken: (...args: unknown[]) => mocks.setPortalToken(...args),
}));

vi.mock('../../guestPortal/components/GuestPaymentPanel', () => ({
  GuestPaymentPanel: ({ mode, token }: { mode: string; token: string }) => (
    <div data-testid="guest-payment-panel" data-mode={mode} data-token={token} />
  ),
}));

vi.mock('../../guestPortal/components/dashboard/IdentitySection', () => ({
  IdentitySection: ({ token }: { token: string }) => (
    <div data-testid="identity-section" data-token={token} />
  ),
}));

import GuestCheckInForm from './GuestCheckInForm';

const PAID_BOOKING = {
  booking: {
    id: 10,
    booking_number: 'BK-paid',
    status: 'confirmed',
    check_in_date: '2026-10-12',
    check_out_date: '2026-10-14',
  },
  guest: { id: 3, nick_name: 'Paid Guest', email: 'paid@hotel.test' },
};

describe('GuestCheckInForm', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.setSearchParams.mockReset();
    mocks.getBooking.mockReset();
    mocks.uploadPaymentReceipt.mockReset();
    mocks.submitPreCheckin.mockReset();
    mocks.claimAccount.mockReset();
    mocks.autoCheckin.mockReset();
    mocks.captureBookingAccessToken.mockReset();
    mocks.getValidPortalToken.mockReset();
    mocks.setPortalToken.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.captureBookingAccessToken.mockReturnValue('tok-abc');
    mocks.getValidPortalToken.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens on the payment step when the booking still owes money', async () => {
    mocks.getBooking.mockResolvedValue({
      booking: {
        id: 9,
        booking_number: 'BK-20261012-test',
        status: 'pending_payment',
        check_in_date: '2026-10-12',
        check_out_date: '2026-10-14',
      },
      guest: { id: 3, nick_name: 'Deeplink Retest' },
    });

    render(<GuestCheckInForm />);

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeTruthy();
    expect(screen.getByText(/BK-20261012-test/)).toBeTruthy();
    expect(screen.getByText('Deeplink Retest')).toBeTruthy();
    const panel = screen.getByTestId('guest-payment-panel');
    expect(panel.getAttribute('data-mode')).toBe('token');
    expect(panel.getAttribute('data-token')).toBe('tok-abc');
    // Details belong to a later step, so none of their fields are on screen yet.
    expect(screen.queryByLabelText('IC / Passport number')).toBeNull();
  });

  it('starts at the details step when no payment is outstanding', async () => {
    mocks.getBooking.mockResolvedValue(PAID_BOOKING);

    render(<GuestCheckInForm />);

    expect(await screen.findByRole('heading', { name: 'Your details' })).toBeTruthy();
    expect(screen.queryByTestId('guest-payment-panel')).toBeNull();
    expect(screen.getByLabelText('IC / Passport number')).toBeTruthy();
  });

  it('saves pre-check-in details and moves on to the account step', async () => {
    mocks.getBooking.mockResolvedValue(PAID_BOOKING);
    mocks.submitPreCheckin.mockResolvedValue({
      booking: PAID_BOOKING.booking,
      guest: { ...PAID_BOOKING.guest, ic_number: 'A1234567' },
    });

    render(<GuestCheckInForm />);

    fireEvent.change(await screen.findByLabelText('IC / Passport number'), {
      target: { value: 'A1234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));

    await waitFor(() => {
      expect(mocks.submitPreCheckin).toHaveBeenCalledWith('tok-abc', {
        guest_update: expect.objectContaining({ ic_number: 'A1234567' }),
        special_requests: undefined,
      });
    });
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
  });

  it('claims an account and hands the portal session to the identity step', async () => {
    mocks.getBooking.mockResolvedValue(PAID_BOOKING);
    mocks.claimAccount.mockResolvedValue({
      session: { token: 'portal-tok', expires_at: '2026-10-13T00:00:00Z', guest: {} },
      username: 'paidguest',
      email_verification_required: true,
    });

    render(<GuestCheckInForm />);

    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'paidguest' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Sup3rSecret!' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), {
      target: { value: 'Sup3rSecret!' },
    });
    const [terms, privacy] = screen.getAllByRole('checkbox');
    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(mocks.claimAccount).toHaveBeenCalledWith(
        'tok-abc',
        expect.objectContaining({
          booking_number: 'BK-paid',
          guest_name: 'Paid Guest',
          username: 'paidguest',
          password: 'Sup3rSecret!',
        }),
      );
    });
    // The session must be persisted, or a reload drops the guest out of the
    // identity step and back into creating a second account.
    expect(mocks.setPortalToken).toHaveBeenCalledWith('portal-tok', '2026-10-13T00:00:00Z');
    const identity = await screen.findByTestId('identity-section');
    expect(identity.getAttribute('data-token')).toBe('portal-tok');
    expect(screen.getByText(/Check your email for a link to confirm/)).toBeTruthy();
  });

  it('sends the required registration consents with the claim', async () => {
    mocks.getBooking.mockResolvedValue(PAID_BOOKING);
    mocks.claimAccount.mockResolvedValue({
      session: { token: 'portal-tok', expires_at: '2026-10-13T00:00:00Z', guest: {} },
      username: 'paidguest',
      email_verification_required: false,
    });

    render(<GuestCheckInForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Create your account' });

    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'paidguest' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'Sup3rSecret!' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), {
      target: { value: 'Sup3rSecret!' },
    });

    // Submitting without ticking the boxes must not reach the API at all.
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText(/Please accept the booking terms/);
    expect(mocks.claimAccount).not.toHaveBeenCalled();

    const [terms, privacy] = screen.getAllByRole('checkbox');
    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(mocks.claimAccount).toHaveBeenCalled();
    });
    const [, payload] = mocks.claimAccount.mock.calls[0] as [string, { consents: unknown[] }];
    expect(payload.consents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document: 'terms_of_service', granted: true }),
        expect.objectContaining({ document: 'privacy_notice', granted: true }),
      ]),
    );
  });

  it('skips the account step for a guest who already has a portal session', async () => {
    mocks.getValidPortalToken.mockReturnValue('existing-portal-tok');
    mocks.getBooking.mockResolvedValue(PAID_BOOKING);

    render(<GuestCheckInForm />);

    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));

    const identity = await screen.findByTestId('identity-section');
    expect(identity.getAttribute('data-token')).toBe('existing-portal-tok');
    expect(screen.queryByRole('heading', { name: 'Create your account' })).toBeNull();
  });

  it('shows why check-in is not open yet on the final step', async () => {
    mocks.getValidPortalToken.mockReturnValue('existing-portal-tok');
    mocks.getBooking.mockResolvedValue({
      ...PAID_BOOKING,
      ekyc_summary: {
        guest_id: 3,
        status: 'submitted',
        self_checkin_enabled: false,
        can_auto_checkin: false,
        auto_checkin_block_reason: 'eKYC is still in review.',
      },
    });

    render(<GuestCheckInForm />);

    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'You are all set' })).toBeTruthy();
    expect(screen.getByText('eKYC is still in review.')).toBeTruthy();
  });

  it('offers check-in on the summary once the guest is eligible, and confirms the room', async () => {
    mocks.getValidPortalToken.mockReturnValue('existing-portal-tok');
    mocks.getBooking.mockResolvedValue({
      ...PAID_BOOKING,
      ekyc_summary: {
        guest_id: 3,
        status: 'approved',
        self_checkin_enabled: true,
        can_auto_checkin: true,
        auto_checkin_block_reason: null,
      },
    });
    mocks.autoCheckin.mockResolvedValue({
      success: true,
      booking_id: 10,
      room_number: '204',
      digital_key_sent: true,
      checked_in_at: '2026-10-12T07:00:00Z',
      ekyc_summary: {
        guest_id: 3,
        status: 'approved',
        self_checkin_enabled: true,
        can_auto_checkin: false,
        auto_checkin_block_reason: 'Booking is already checked in.',
      },
      message: 'Successfully checked in to room 204. Your digital key has been sent.',
    });

    render(<GuestCheckInForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Check in now' }));

    await waitFor(() => {
      expect(mocks.autoCheckin).toHaveBeenCalledWith('tok-abc');
    });
    expect(await screen.findByText('Checked in — room 204')).toBeTruthy();
    expect(
      screen.getByText('Successfully checked in to room 204. Your digital key has been sent.'),
    ).toBeTruthy();
    // The button must not survive a successful check-in, or a second click
    // would hit a booking the backend now considers already checked in.
    expect(screen.queryByRole('button', { name: 'Check in now' })).toBeNull();
  });

  it('shows the backend reason when check-in is refused, and stops offering the button', async () => {
    mocks.getValidPortalToken.mockReturnValue('existing-portal-tok');
    const eligible = {
      guest_id: 3,
      status: 'approved',
      self_checkin_enabled: true,
      can_auto_checkin: true,
      auto_checkin_block_reason: null,
    };
    // Deliberately NOT the same wording as the thrown API error: the assertion
    // below must be reachable only through the re-read, or the test passes on
    // the error alert alone and proves nothing about the refresh.
    const blocked = {
      ...eligible,
      can_auto_checkin: false,
      auto_checkin_block_reason: 'Housekeeping is still preparing your room.',
    };
    // Eligible at first; the room goes dirty between the page load and the click.
    mocks.getBooking
      .mockResolvedValueOnce({ ...PAID_BOOKING, ekyc_summary: eligible })
      .mockResolvedValueOnce({ ...PAID_BOOKING, ekyc_summary: eligible })
      .mockResolvedValue({ ...PAID_BOOKING, ekyc_summary: blocked });
    mocks.autoCheckin.mockRejectedValue(new Error('Cannot auto check-in - the room must be cleaned before check-in.'));

    render(<GuestCheckInForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check in now' }));

    // The refreshed verdict, not the thrown message.
    expect(await screen.findByText('Housekeeping is still preparing your room.')).toBeTruthy();
    expect(screen.getByText(/the room must be cleaned before check-in/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check in now' })).toBeNull();
  });

  it('routes the guest back to their details when the block is theirs to fix', async () => {
    mocks.getValidPortalToken.mockReturnValue('existing-portal-tok');
    mocks.getBooking.mockResolvedValue({
      ...PAID_BOOKING,
      ekyc_summary: {
        guest_id: 3,
        status: 'approved',
        self_checkin_enabled: true,
        can_auto_checkin: false,
        auto_checkin_block_reason:
          'Add your IC or passport number to your details to check in online.',
      },
    });

    render(<GuestCheckInForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'You are all set' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update details' }));

    expect(await screen.findByRole('heading', { name: 'Your details' })).toBeTruthy();
    expect(screen.getByLabelText('IC / Passport number')).toBeTruthy();
  });

  it('offers no way back when the block is not the guest to fix', async () => {
    mocks.getValidPortalToken.mockReturnValue('existing-portal-tok');
    mocks.getBooking.mockResolvedValue({
      ...PAID_BOOKING,
      ekyc_summary: {
        guest_id: 3,
        status: 'submitted',
        self_checkin_enabled: false,
        can_auto_checkin: false,
        auto_checkin_block_reason: 'eKYC is still in review.',
      },
    });

    render(<GuestCheckInForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Skip for now' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('eKYC is still in review.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update details' })).toBeNull();
  });

  it('lets an anonymous booker upload a requested bank-transfer receipt without signing in', async () => {
    mocks.getBooking.mockResolvedValue({
      booking: {
        id: 11,
        booking_number: 'BK-20260910-a3a2579f',
        status: 'pending_payment',
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-11',
      },
      guest: { id: 8, nick_name: 'zz' },
      receipt_request_payment_id: 42,
      receipt_request_message:
        'Please upload a clear receipt showing the transfer reference and date.',
      receipt_uploaded: false,
    });
    mocks.uploadPaymentReceipt.mockResolvedValue(undefined);

    render(<GuestCheckInForm />);

    expect(await screen.findByRole('heading', { name: 'Upload your receipt' })).toBeTruthy();
    expect(screen.getByText(/BK-20260910-a3a2579f/)).toBeTruthy();
    expect(
      screen.getByText(/Please upload a clear receipt showing the transfer reference and date/),
    ).toBeTruthy();
    expect(screen.queryByTestId('guest-payment-panel')).toBeNull();

    const file = new File(['receipt'], 'transfer.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Select receipt file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload receipt' }));

    await waitFor(() => {
      expect(mocks.uploadPaymentReceipt).toHaveBeenCalledWith('tok-abc', 42, file);
    });
    expect(
      await screen.findByText(
        'Your receipt has been submitted and is pending confirmation from our team.',
      ),
    ).toBeTruthy();
  });

  it('shows an error when the booking token is missing', async () => {
    mocks.captureBookingAccessToken.mockReturnValue(null);

    render(<GuestCheckInForm />);

    expect(await screen.findByText('Invalid or missing token')).toBeTruthy();
    await waitFor(() => {
      expect(mocks.getBooking).not.toHaveBeenCalled();
    });
  });
});
