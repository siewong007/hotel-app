import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookings: vi.fn(),
  cancelBooking: vi.fn(),
}));

/** Params of the most recent bookings() call. (`Array.prototype.at` is outside
 *  this project's configured `lib`, so index arithmetic it is.) */
function lastBookingsParams(): Record<string, unknown> {
  const { calls } = mocks.bookings.mock;
  return calls[calls.length - 1][0];
}

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

  it('keeps the selected refund reason open after a request failure', async () => {
    mocks.cancelBooking.mockRejectedValue(new Error('Cancellation window has closed'));
    render(<BookingsSection token="guest-token" />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Refund' }))[0]);
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByLabelText('Custom refund reason'), { target: { value: 'Plans changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request refund' }));

    await waitFor(() => expect(screen.getByText('Cancellation window has closed')).toBeTruthy());
    expect((screen.getByLabelText('Custom refund reason') as HTMLTextAreaElement).value).toBe('Plans changed');
    expect(mocks.cancelBooking).toHaveBeenCalledWith(7, 'Plans changed', 'guest-token');

    fireEvent.click(screen.getByRole('button', { name: 'Request refund' }));
    await waitFor(() => expect(mocks.cancelBooking).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Custom refund reason') as HTMLTextAreaElement).value).toBe('Plans changed');
  });

  it('closes after submitting a refund request and announces success', async () => {
    mocks.cancelBooking.mockResolvedValue(undefined);
    render(<BookingsSection token="guest-token" />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Refund' }))[0]);
    fireEvent.click(screen.getByLabelText('Change of plans'));
    fireEvent.click(screen.getByRole('button', { name: 'Request refund' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Refund request for booking SI-1007 was submitted.')).toBeTruthy();
  });

  it('explains when online cancellation is unavailable', async () => {
    mocks.bookings.mockResolvedValue({
      items: [{ ...booking, can_cancel: false, cancellation_unavailable_reason: 'This rate is non-refundable.' }],
      total: 1,
    });
    render(<BookingsSection token="guest-token" />);

    expect((await screen.findAllByText('Refund unavailable')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('This rate is non-refundable.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });
});

describe('BookingsSection search', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.bookings.mockReset();
    mocks.bookings.mockResolvedValue({ items: [booking], total: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('filters on the server, because pagination is server-side', async () => {
    render(<BookingsSection token="guest-token" />);
    await vi.waitFor(() => expect(mocks.bookings).toHaveBeenCalled());
    expect(mocks.bookings.mock.calls[0][0]).toMatchObject({ page: 1, per_page: 10 });
    expect(mocks.bookings.mock.calls[0][0].search).toBeUndefined();

    fireEvent.change(screen.getByLabelText('Search stays'), { target: { value: 'SI-1007' } });
    await vi.advanceTimersByTimeAsync(300);

    await vi.waitFor(() => expect(lastBookingsParams()).toMatchObject({ search: 'SI-1007' }));
  });

  it('debounces so a request is not sent per keystroke', async () => {
    render(<BookingsSection token="guest-token" />);
    await vi.waitFor(() => expect(mocks.bookings).toHaveBeenCalledTimes(1));

    const field = screen.getByLabelText('Search stays');
    fireEvent.change(field, { target: { value: 'S' } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(field, { target: { value: 'SI' } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(field, { target: { value: 'SI-' } });
    expect(mocks.bookings).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(mocks.bookings).toHaveBeenCalledTimes(2));
    expect(lastBookingsParams()).toMatchObject({ search: 'SI-' });
  });

  it('names the term when nothing matches, instead of claiming there are no bookings', async () => {
    render(<BookingsSection token="guest-token" />);
    await vi.waitFor(() => expect(mocks.bookings).toHaveBeenCalled());

    mocks.bookings.mockResolvedValue({ items: [], total: 0 });
    fireEvent.change(screen.getByLabelText('Search stays'), { target: { value: 'ZZZ' } });
    await vi.advanceTimersByTimeAsync(300);

    await vi.waitFor(() => expect(screen.getByText('No stays match “ZZZ”.')).toBeTruthy());
    expect(screen.queryByText('You have no bookings on file yet.')).toBeNull();
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

  it('makes an outstanding receipt request a prominent upload action', async () => {
    mocks.bookings.mockResolvedValue({
      items: [{
        ...booking,
        status: 'pending_confirmation',
        receipt_request_payment_id: 91,
        receipt_uploaded: false,
      }],
      total: 1,
    });
    render(<BookingsSection token="guest-token" />);

    expect(await screen.findByText('Action required: upload your payment receipt')).toBeTruthy();
    expect(screen.getAllByText('Receipt required').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload receipt' })[0]);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Upload payment receipt')).toBeTruthy();
  });
});
