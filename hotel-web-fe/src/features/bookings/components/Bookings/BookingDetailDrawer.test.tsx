import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingWithDetails } from '../../../../types';

const mocks = vi.hoisted(() => ({
  bookingQuery: { data: undefined as BookingWithDetails | undefined, isPending: false, error: null as unknown },
  lastBookingArg: undefined as unknown,
  updateBookingMutation: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock('../../hooks/useBookingQueries', () => ({
  useBooking: (id: unknown, enabled: unknown) => {
    mocks.lastBookingArg = { id, enabled };
    return mocks.bookingQuery;
  },
  useUpdateBooking: () => mocks.updateBookingMutation,
}));

vi.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (value: number) => `RM${Number(value).toFixed(2)}`, symbol: 'RM' }),
}));

vi.mock('../../../../hooks/useIsPhone', () => ({ useIsPhone: () => false }));

vi.mock('../../../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({ check_in_time: '15:00', payment_methods: [], booking_channels: [] }),
}));

import BookingDetailDrawer from './BookingDetailDrawer';

function buildBooking(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    id: '2',
    folio_number: 'F-1002',
    guest_id: 'g-1',
    guest_name: 'Alex Tan',
    room_id: 'r-202',
    room_number: '202',
    room_type: 'Deluxe',
    check_in_date: '2026-09-10T00:00:00.000Z',
    check_out_date: '2026-09-12T00:00:00.000Z',
    total_amount: 300,
    price_per_night: 150,
    status: 'confirmed',
    payment_status: 'unpaid',
    balance_due: 300,
    source: 'walk_in',
    is_complimentary: false,
    deposit_paid: false,
    ...overrides,
  } as BookingWithDetails;
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof BookingDetailDrawer>> = {}) {
  const props = {
    bookingId: '2',
    open: true,
    onClose: vi.fn(),
    isAdmin: false,
    onOpenFullDetails: vi.fn(),
    onError: vi.fn(),
    onCompleted: vi.fn(),
    onCheckIn: vi.fn(),
    onCheckOut: vi.fn(),
    onPayment: vi.fn(),
    onWorkflow: vi.fn(),
    onEdit: vi.fn(),
    onInvoice: vi.fn(),
    onRelease: vi.fn(),
    onVoid: vi.fn(),
    onReactivate: vi.fn(),
    ...overrides,
  };
  render(<BookingDetailDrawer {...props} />);
  return props;
}

describe('BookingDetailDrawer', () => {
  beforeEach(() => {
    mocks.bookingQuery.data = buildBooking();
    mocks.bookingQuery.isPending = false;
    mocks.bookingQuery.error = null;
    mocks.lastBookingArg = undefined;
    mocks.updateBookingMutation.isPending = false;
    mocks.updateBookingMutation.mutateAsync.mockReset().mockResolvedValue({});
  });

  afterEach(cleanup);

  it('fetches the booking with the query gated on open and renders the details panel', () => {
    renderDrawer();
    expect(mocks.lastBookingArg).toEqual({ id: '2', enabled: true });
    expect(screen.getAllByText('Alex Tan').length).toBeGreaterThan(0);
    expect(screen.getByText('Workflow')).toBeTruthy();
  });

  it('forwards the full-page jump to onOpenFullDetails', () => {
    const { onOpenFullDetails } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Open full page' }));
    expect(onOpenFullDetails).toHaveBeenCalledWith(mocks.bookingQuery.data);
  });

  it('shows quick edit only for admins and saves the four fields', async () => {
    renderDrawer();
    expect(screen.queryByText('Quick edit')).toBeNull();

    cleanup();
    const { onCompleted } = renderDrawer({ isAdmin: true });
    expect(screen.getByText('Quick edit')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Notes / Remarks'), { target: { value: 'Late arrival' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mocks.updateBookingMutation.mutateAsync).toHaveBeenCalledWith({
      bookingId: '2',
      data: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        remarks: 'Late arrival',
        special_requests: '',
      },
    }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
  });

  it('surfaces save failures through onError', async () => {
    const { onError } = renderDrawer({ isAdmin: true });
    mocks.updateBookingMutation.mutateAsync.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
