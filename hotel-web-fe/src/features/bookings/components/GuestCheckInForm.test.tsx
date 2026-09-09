import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setSearchParams: vi.fn(),
  searchParams: new URLSearchParams(),
  getBooking: vi.fn(),
  captureBookingAccessToken: vi.fn(),
}));

vi.mock('../../../router', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock('../../../api', () => ({
  GuestPortalService: {
    getBooking: (...args: unknown[]) => mocks.getBooking(...args),
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

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument();
    expect(screen.getByText(/BK-20261012-test/)).toBeInTheDocument();
    expect(screen.getByText('Deeplink Retest')).toBeInTheDocument();
    expect(screen.getByTestId('guest-payment-panel')).toHaveAttribute('data-mode', 'token');
    expect(screen.getByTestId('guest-payment-panel')).toHaveAttribute('data-token', 'tok-abc');
    expect(screen.queryByText('Submit Pre-Check-In')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/IC\/Passport/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Personal Information')).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Your booking' })).toBeInTheDocument();
    expect(screen.queryByTestId('guest-payment-panel')).not.toBeInTheDocument();
    expect(screen.getByText(/Online pre-check-in is no longer part of this flow/i)).toBeInTheDocument();
  });

  it('shows an error when the booking token is missing', async () => {
    mocks.captureBookingAccessToken.mockReturnValue(null);

    render(<GuestCheckInForm />);

    expect(await screen.findByText('Invalid or missing token')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.getBooking).not.toHaveBeenCalled();
    });
  });
});
