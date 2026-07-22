import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookings: vi.fn(),
  cancelBooking: vi.fn(),
}));

vi.mock('../../api/guestPortalDashboard.service', () => ({
  GuestPortalDashboardService: {
    bookings: (...args: unknown[]) => mocks.bookings(...args),
    cancelBooking: (...args: unknown[]) => mocks.cancelBooking(...args),
  },
}));

vi.mock('../GuestPaymentPanel', () => ({
  GuestPaymentPanel: ({ bookingId }: { bookingId?: number }) => (
    <div>Payment method for booking {bookingId}</div>
  ),
}));

import { BookingsSection } from './PortalDashboardSections';

const booking = {
  id: 7,
  booking_number: 'SI-1007',
  check_in_date: '2026-08-10',
  check_out_date: '2026-08-12',
  status: 'confirmed',
  total_amount: '420.00',
  can_cancel: true,
};

describe('BookingsSection cancellation', () => {
  beforeEach(() => {
    mocks.bookings.mockReset();
    mocks.cancelBooking.mockReset();
    mocks.bookings.mockResolvedValue({ items: [booking], total: 1 });
  });

  afterEach(cleanup);

  it('keeps the dialog and its reason open after a cancellation failure', async () => {
    mocks.cancelBooking.mockRejectedValue(new Error('Cancellation window has closed'));
    render(<BookingsSection token="guest-token" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    fireEvent.change(screen.getByLabelText('Reason for cancellation (optional)'), { target: { value: 'Plans changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));

    await waitFor(() => expect(screen.getByText('Cancellation window has closed')).toBeTruthy());
    expect((screen.getByLabelText('Reason for cancellation (optional)') as HTMLTextAreaElement).value).toBe('Plans changed');
    expect(mocks.cancelBooking).toHaveBeenCalledWith(7, 'Plans changed', 'guest-token');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(mocks.cancelBooking).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Reason for cancellation (optional)') as HTMLTextAreaElement).value).toBe('Plans changed');
  });

  it('closes after cancellation and announces success', async () => {
    mocks.cancelBooking.mockResolvedValue(undefined);
    render(<BookingsSection token="guest-token" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Booking SI-1007 was cancelled.')).toBeTruthy();
  });

  it('explains when online cancellation is unavailable', async () => {
    mocks.bookings.mockResolvedValue({
      items: [{ ...booking, can_cancel: false, cancellation_unavailable_reason: 'This rate is non-refundable.' }],
      total: 1,
    });
    render(<BookingsSection token="guest-token" />);

    expect((await screen.findAllByText('Cancellation unavailable')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('This rate is non-refundable.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).toBeNull();
  });
});

describe('BookingsSection payment details', () => {
  beforeEach(() => {
    mocks.bookings.mockReset();
    mocks.bookings.mockResolvedValue({
      items: [{ ...booking, status: 'pending_payment' }],
      total: 1,
    });
  });

  afterEach(cleanup);

  it('opens payment details from the selected My stays row', async () => {
    render(<BookingsSection token="guest-token" />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[0]);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('Pending Payment').length).toBeGreaterThan(0);
    expect(screen.getByText('Payment method for booking 7')).toBeTruthy();
  });
});
