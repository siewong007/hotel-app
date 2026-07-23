import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookings: vi.fn(),
  onReviewReceipt: vi.fn(),
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    bookings: (...args: unknown[]) => mocks.bookings(...args),
  },
}));

import { GuestPortalNotificationBell } from './GuestPortalNotificationBell';

const booking = {
  id: 7,
  booking_number: 'SI-1007',
  check_in_date: '2026-08-10',
  check_out_date: '2026-08-12',
  status: 'pending_confirmation',
  total_amount: '420.00',
  can_cancel: false,
  receipt_request_payment_id: 92,
  receipt_request_message: 'Please make sure the transfer reference is visible.',
  receipt_uploaded: false,
};

describe('GuestPortalNotificationBell', () => {
  beforeEach(() => {
    mocks.bookings.mockReset();
    mocks.onReviewReceipt.mockReset();
  });

  afterEach(cleanup);

  it('elevates outstanding receipt requests and directs the guest to review them', async () => {
    mocks.bookings.mockResolvedValue({ items: [booking], total: 1 });
    render(<GuestPortalNotificationBell token="guest-token" onReviewReceipt={mocks.onReviewReceipt} />);

    const bell = await screen.findByRole('button', { name: 'Notifications; 1 receipt needs your attention' });
    fireEvent.click(bell);

    expect(await screen.findByText('Receipt required')).toBeTruthy();
    expect(screen.getByText('Please make sure the transfer reference is visible.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View request' }));

    expect(mocks.onReviewReceipt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Receipt required')).toBeNull());
  });

  it('shows no badge when the guest has no outstanding receipt requests', async () => {
    mocks.bookings.mockResolvedValue({ items: [{ ...booking, receipt_uploaded: true }], total: 1 });
    render(<GuestPortalNotificationBell token="guest-token" onReviewReceipt={mocks.onReviewReceipt} />);

    await screen.findByRole('button', { name: 'Notifications' });
    expect(screen.queryByLabelText(/needs your attention/i)).toBeNull();
  });
});
