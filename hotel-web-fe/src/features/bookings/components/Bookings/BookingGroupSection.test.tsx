import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('../../../../api/client', () => ({
  api: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) },
  toApiError: (err: unknown, fallback: string) => new Error(err instanceof Error ? err.message : fallback),
}));

import { availableGroupActions, BookingGroupSection, type StaffBookingGroupRoom } from './BookingGroupSection';
import { GroupChip } from './BookingMetaChips';

afterEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

const room = (booking_id: number, status: string): StaffBookingGroupRoom => ({
  booking_id, booking_number: `BK-${booking_id}`, room_number: String(100 + booking_id), room_type_name: 'Deluxe',
  adults: 2, children: 0, extra_bed_count: 0, status, payment_status: 'paid', total_amount: '100.00',
});
const groupOf = (rooms: StaffBookingGroupRoom[]) => ({
  group: { id: 3, group_number: 'GBK-3', status: 'active', payment_status: 'paid', room_count: rooms.length, total_amount: '200.00' },
  rooms,
});

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

  it('offers the actions that match the rooms, mirroring the server rules', () => {
    expect(availableGroupActions([room(1, 'confirmed'), room(2, 'confirmed')])).toEqual(['checkin', 'cancel']);
    expect(availableGroupActions([room(1, 'checked_in'), room(2, 'confirmed')])).toEqual(['checkin', 'checkout']);
    expect(availableGroupActions([room(1, 'checked_in'), room(2, 'voided')])).toEqual(['checkout']);
    expect(availableGroupActions([room(1, 'checked_out'), room(2, 'voided')])).toEqual([]);
  });

  it('hides the group actions from staff without booking update rights', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(groupOf([room(10, 'confirmed'), room(11, 'confirmed')])) });
    render(<BookingGroupSection bookingId={10} />);
    expect(await screen.findByTestId('staff-booking-group')).toBeTruthy();
    expect(screen.queryByTestId('staff-booking-group-actions')).toBeNull();
  });

  it('checks in every room after confirmation and refreshes the caller', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(groupOf([room(10, 'confirmed'), room(11, 'confirmed')])) });
    post.mockReturnValue({ json: () => Promise.resolve({ booking_group_id: 3, action: 'checkin', processed: [10, 11], skipped: [] }) });
    const onChanged = vi.fn();
    render(<BookingGroupSection bookingId={10} canManage onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check in all' }));
    expect(post).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Check in all')!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('bookings/10/group/checkin', { json: {} });
    expect(await screen.findByText('2 rooms checked in.')).toBeTruthy();
  });

  it('sends the cancel reason and shows a refusal without closing the dialog', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(groupOf([room(10, 'confirmed'), room(11, 'pending')])) });
    post.mockReturnValue({ json: () => Promise.reject(new Error('Some rooms are already checked in or out')) });
    const onChanged = vi.fn();
    render(<BookingGroupSection bookingId={10} canManage onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel all rooms' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Event called off' } });
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Cancel all rooms')!);
    expect(await screen.findByText('Some rooms are already checked in or out')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('bookings/10/group/cancel', { json: { reason: 'Event called off' } });
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('warns that paid rooms are refunded when the whole group is cancelled', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(groupOf([room(10, 'confirmed'), room(11, 'pending')])) });
    render(<BookingGroupSection bookingId={10} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel all rooms' }));
    expect(await screen.findByText(/Paid rooms are refunded/)).toBeTruthy();
  });

  it('takes one payment for every unpaid room', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(groupOf([
      { ...room(10, 'pending'), payment_status: 'unpaid' },
      { ...room(11, 'pending'), payment_status: 'unpaid' },
    ])) });
    post.mockReturnValue({ json: () => Promise.resolve({ amount: '200.00' }) });
    render(<BookingGroupSection bookingId={10} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Take payment' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Take payment')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('bookings/10/group/pay', {
      json: { payment_method: 'cash', transaction_reference: null, notes: null },
    }));
    expect(await screen.findByText(/Payment recorded/)).toBeTruthy();
  });

  it('reactivates every voided room together', async () => {
    get.mockReturnValue({ json: () => Promise.resolve(groupOf([room(10, 'voided'), room(11, 'voided')])) });
    post.mockReturnValue({ json: () => Promise.resolve({ processed: [10, 11] }) });
    render(<BookingGroupSection bookingId={10} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate all rooms' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Reactivate all rooms')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('bookings/10/group/reactivate'));
    expect(await screen.findByText('The group booking was reactivated.')).toBeTruthy();
  });

  it('labels a list row with its group number', () => {
    render(<GroupChip groupNumber="GBK-3" />);
    expect(screen.getByTestId('booking-group-chip').textContent).toBe('Group GBK-3');
  });
});
