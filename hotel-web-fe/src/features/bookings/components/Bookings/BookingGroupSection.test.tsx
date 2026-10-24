import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/client', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

import { BookingGroupSection } from './BookingGroupSection';

afterEach(() => { cleanup(); get.mockReset(); });

describe('BookingGroupSection', () => {
  it('lists every room of the multi-room booking', async () => {
    get.mockReturnValue({ json: () => Promise.resolve({
      group: { id: 3, group_number: 'GBK-3', status: 'active', payment_status: 'unpaid', room_count: 2, total_amount: '300.00' },
      rooms: [
        { booking_id: 10, booking_number: 'BK-10', room_number: '101', room_type_name: 'Deluxe', adults: 2, children: 0, extra_bed_count: 1, status: 'pending_payment', payment_status: 'unpaid', total_amount: '200.00' },
        { booking_id: 11, booking_number: 'BK-11', room_number: '102', room_type_name: 'Standard', adults: 1, children: 1, extra_bed_count: 0, status: 'voided', payment_status: 'unpaid', total_amount: '100.00' },
      ],
    }) });
    render(<BookingGroupSection bookingId={10} />);
    expect(await screen.findByTestId('staff-booking-group')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('bookings/10/group');
    expect(screen.getByText(/BK-10/)).toBeTruthy();
    expect(screen.getByText(/BK-11/)).toBeTruthy();
    expect(screen.getByText(/1 extra bed/)).toBeTruthy();
  });

  it('renders nothing for a single-room booking', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(null) });
    const { container } = render(<BookingGroupSection bookingId={9} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });
});
