import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  searchParams: new URLSearchParams(),
  getBooking: vi.fn(),
  uploadPaymentReceipt: vi.fn(),
  captureBookingAccessToken: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('../../../api', () => ({
  GuestPortalService: {
    getBooking: (...args: unknown[]) => mocks.getBooking(...args),
    uploadPaymentReceipt: (...args: unknown[]) => mocks.uploadPaymentReceipt(...args),
  },
}));

vi.mock('../../guestPortal/api/bookingAccessTokenStore', () => ({
  captureBookingAccessToken: (...args: unknown[]) => mocks.captureBookingAccessToken(...args),
}));

vi.mock('../../guestPortal/components/GuestPaymentPanel', () => ({
  GuestPaymentPanel: ({ mode, token }: { mode: string; token: string }) => (
    <div data-testid="guest-payment-panel" data-mode={mode} data-token={token} />
  ),
}));

import GuestCheckInForm from './GuestCheckInForm';

describe('GuestCheckInForm', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.setSearchParams.mockReset();
    mocks.getBooking.mockReset();
    mocks.uploadPaymentReceipt.mockReset();
    mocks.captureBookingAccessToken.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.captureBookingAccessToken.mockReturnValue('tok-abc');
  });

  afterEach(() => {
    cleanup();
  });

  it('shows payment UI without pre-check-in fields for pending_payment bookings', async () => {
    mocks.getBooking.mockResolvedValue({
      booking: {
        id: 9,
        booking_number: 'BK-20261012-test',
        status: 'pending_payment',
        check_in_date: '2026-10-12',
        check_out_date: '2026-10-14',
      },
      guest: {
        id: 3,
        full_name: 'Deeplink Retest',
      },
    });

    render(<GuestCheckInForm />);

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeTruthy();
    expect(screen.getByText(/BK-20261012-test/)).toBeTruthy();
    expect(screen.getByText('Deeplink Retest')).toBeTruthy();
    const panel = screen.getByTestId('guest-payment-panel');
    expect(panel.getAttribute('data-mode')).toBe('token');
    expect(panel.getAttribute('data-token')).toBe('tok-abc');
    expect(screen.queryByText('Submit Pre-Check-In')).toBeNull();
    expect(screen.queryByLabelText(/IC\/Passport/i)).toBeNull();
    expect(screen.queryByText('Personal Information')).toBeNull();
  });

  it('hides payment panel when booking does not need online payment', async () => {
    mocks.getBooking.mockResolvedValue({
      booking: {
        id: 10,
        booking_number: 'BK-paid',
        status: 'confirmed',
        check_in_date: '2026-10-12',
        check_out_date: '2026-10-14',
      },
      guest: { id: 3, full_name: 'Paid Guest' },
    });

    render(<GuestCheckInForm />);

    expect(await screen.findByRole('heading', { name: 'Your booking' })).toBeTruthy();
    expect(screen.queryByTestId('guest-payment-panel')).toBeNull();
    expect(
      screen.getByText(/Online pre-check-in is no longer part of this flow/i)
    ).toBeTruthy();
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
      guest: { id: 8, full_name: 'zz' },
      receipt_request_payment_id: 42,
      receipt_request_message: 'Please upload a clear receipt showing the transfer reference and date.',
      receipt_uploaded: false,
    });
    mocks.uploadPaymentReceipt.mockResolvedValue(undefined);

    render(<GuestCheckInForm />);

    expect(await screen.findByRole('heading', { name: 'Upload your receipt' })).toBeTruthy();
    expect(screen.getByText(/BK-20260910-a3a2579f/)).toBeTruthy();
    expect(
      screen.getByText(/Please upload a clear receipt showing the transfer reference and date/)
    ).toBeTruthy();
    expect(screen.queryByTestId('guest-payment-panel')).toBeNull();

    const file = new File(['receipt'], 'transfer.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Select receipt file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload receipt' }));

    await waitFor(() => {
      expect(mocks.uploadPaymentReceipt).toHaveBeenCalledWith('tok-abc', 42, file);
    });
    expect(
      await screen.findByText('Your receipt has been submitted and is pending confirmation from our team.')
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
