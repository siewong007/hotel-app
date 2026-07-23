import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookings: vi.fn(),
  uploadPaymentReceipt: vi.fn(),
}));

vi.mock('../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    bookings: (...args: unknown[]) => mocks.bookings(...args),
    uploadPaymentReceipt: (...args: unknown[]) => mocks.uploadPaymentReceipt(...args),
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
    mocks.uploadPaymentReceipt.mockReset();
  });

  afterEach(cleanup);

  it('opens the requested receipt upload directly from a notification', async () => {
    mocks.bookings.mockResolvedValue({ items: [booking], total: 1 });
    mocks.uploadPaymentReceipt.mockResolvedValue(undefined);
    render(<GuestPortalNotificationBell token="guest-token" />);

    const bell = await screen.findByRole('button', { name: 'Notifications; 1 receipt needs your attention' });
    fireEvent.click(bell);

    expect(await screen.findByText('Receipt required')).toBeTruthy();
    expect(screen.getByText('Please make sure the transfer reference is visible.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View request' }));

    expect(screen.getByRole('dialog', { name: 'Upload payment receipt' })).toBeTruthy();
    const receipt = new File(['receipt'], 'bank-transfer.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Select receipt file'), { target: { files: [receipt] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload receipt' }));

    await waitFor(() => expect(mocks.uploadPaymentReceipt).toHaveBeenCalledWith(92, receipt, 'guest-token'));
    expect(await screen.findByText('Your receipt has been submitted and is pending confirmation from our team.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Receipt required')).toBeNull());
  });

  it('shows no badge when the guest has no outstanding receipt requests', async () => {
    mocks.bookings.mockResolvedValue({ items: [{ ...booking, receipt_uploaded: true }], total: 1 });
    render(<GuestPortalNotificationBell token="guest-token" />);

    await screen.findByRole('button', { name: 'Notifications' });
    expect(screen.queryByLabelText(/needs your attention/i)).toBeNull();
  });
});
