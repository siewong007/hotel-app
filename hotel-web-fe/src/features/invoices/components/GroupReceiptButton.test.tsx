import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import GroupReceiptButton from './GroupReceiptButton';

const mocks = vi.hoisted(() => ({
  fetchBookingGroup: vi.fn(),
  fetchGroupReceipt: vi.fn(),
}));

vi.mock('../../bookings/components/Bookings/BookingGroupSection', () => ({
  fetchBookingGroup: (...a: unknown[]) => mocks.fetchBookingGroup(...a),
}));
vi.mock('../api/groupReceipt', () => ({
  fetchGroupReceipt: (...a: unknown[]) => mocks.fetchGroupReceipt(...a),
}));
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ format: (n: number) => `RM${Number(n).toFixed(2)}`, symbol: 'RM' }),
}));

const settings = {
  hotel_name: 'Salim Inn', hotel_address: 'Kuching', hotel_phone: '1', hotel_email: 'a@b.c',
} as never;

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GroupReceiptButton bookingId={7} hotelSettings={settings} />
    </QueryClientProvider>,
  );

const row = (id: number, room: string, total: string) => ({
  booking_id: id, booking_number: `B${id}`, invoice_number: `INV-${id}`, room_number: room,
  room_type: 'Deluxe', check_in_date: '2031-05-01', check_out_date: '2031-05-03', nights: 2,
  room_total: total, tourism_tax_amount: '0', extra_bed_count: 0, extra_bed_charge: '0', total,
});

describe('GroupReceiptButton', () => {
  beforeEach(() => {
    mocks.fetchBookingGroup.mockReset();
    mocks.fetchGroupReceipt.mockReset();
  });

  it('renders nothing for a single-room booking', async () => {
    mocks.fetchBookingGroup.mockResolvedValue(null);
    renderIt();
    await waitFor(() => expect(mocks.fetchBookingGroup).toHaveBeenCalledWith(7));
    expect(screen.queryByTestId('group-receipt-button')).toBeNull();
  });

  it('shows every room and one grand total for a group', async () => {
    mocks.fetchBookingGroup.mockResolvedValue({ group: { id: 3, group_number: 'G-3' }, rooms: [] });
    mocks.fetchGroupReceipt.mockResolvedValue({
      booking_group_id: 3, group_number: 'G-3', guest_id: 1, guest_name: 'Ali',
      check_in_date: '2031-05-01', check_out_date: '2031-05-03', currency: 'MYR',
      payment_status: 'paid', group_payment_ref: null,
      rooms: [row(10, '101', '200.00'), row(11, '102', '150.00')],
      room_total: '350.00', tourism_tax_amount: '0', extra_bed_charge: '0', grand_total: '350.00',
    });
    renderIt();
    fireEvent.click(await screen.findByTestId('group-receipt-button'));
    expect(await screen.findByText('INV-10')).toBeTruthy();
    expect(screen.getByText('INV-11')).toBeTruthy();
    expect(mocks.fetchGroupReceipt).toHaveBeenCalledWith(3);
    expect(screen.getByTestId('group-receipt-grand-total').textContent).toBe('RM350.00');
  });
});
