import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '../../../test/renderPage';
import { expectNoAxeViolations } from '../../../test/axe';
import { queryData, queryLoading, queryError } from '../../../test/queryMocks';
import { addLocalDays, formatLocalDate } from '../../../utils/date';
import type { BookingWithDetails, Room } from '../../../types';

const mocks = vi.hoisted(() => ({
  rooms: {
    data: [] as Room[],
    isPending: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  bookings: {
    data: [] as BookingWithDetails[],
    isPending: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('../../bookings/hooks/useBookingQueries', () => ({
  useBookingsWithDetails: () => mocks.bookings,
}));

vi.mock('../hooks/useRoomQueries', () => ({
  useRooms: () => mocks.rooms,
}));

import RoomReservationTimeline from './RoomReservationTimeline';

const rooms: Room[] = [
  { id: 'r-101', room_number: '101', room_type: 'Deluxe King', price_per_night: 320, available: true, max_occupancy: 2, status: 'available' },
  { id: 'r-102', room_number: '102', room_type: 'Deluxe Twin', price_per_night: 300, available: true, max_occupancy: 2, status: 'occupied' },
];

const bookings: BookingWithDetails[] = [
  {
    id: 'bk-1',
    booking_number: 'BK-1001',
    guest_id: 'g-1',
    guest_name: 'Aminah Yusof',
    guest_email: 'aminah@example.com',
    room_id: 'r-101',
    room_number: '101',
    room_type: 'Deluxe King',
    price_per_night: 320,
    check_in_date: formatLocalDate(),
    check_out_date: formatLocalDate(addLocalDays(new Date(), 2)),
    total_amount: 640,
    status: 'checked_in',
  },
];

function setPopulated() {
  mocks.rooms = { ...queryData(rooms), refetch: vi.fn().mockResolvedValue(undefined) } as never;
  mocks.bookings = { ...queryData(bookings), refetch: vi.fn().mockResolvedValue(undefined) } as never;
}

describe('RoomReservationTimeline', () => {
  it('renders the timeline with its title and room rows', async () => {
    setPopulated();
    renderPage(<RoomReservationTimeline />, { route: '/timeline' });
    expect(await screen.findByText('101')).toBeTruthy();
    expect(screen.getByText('102')).toBeTruthy();
  });

  it('shows the loading state while queries are pending', async () => {
    mocks.rooms = { ...queryLoading(), refetch: vi.fn() } as never;
    mocks.bookings = { ...queryLoading(), refetch: vi.fn() } as never;
    renderPage(<RoomReservationTimeline />, { route: '/timeline' });
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows the error state when a query fails', async () => {
    mocks.rooms = { ...queryError(new Error('rooms down')), refetch: vi.fn() } as never;
    mocks.bookings = { ...queryData([]), refetch: vi.fn() } as never;
    renderPage(<RoomReservationTimeline />, { route: '/timeline' });
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('reports no axe violations in the populated grid state', async () => {
    setPopulated();
    const { container } = renderPage(<RoomReservationTimeline />, { route: '/timeline' });
    await screen.findByText('101');
    await expectNoAxeViolations(container);
  });
});
