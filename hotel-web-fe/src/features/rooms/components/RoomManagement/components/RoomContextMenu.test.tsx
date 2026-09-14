// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isPhone: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mui/material')>();
  return { ...actual, useMediaQuery: () => mocks.isPhone };
});

import RoomContextMenu from './RoomContextMenu';
import type { BookingWithDetails, Room } from '../../../../../types';
import type { MenuLayout } from '../types';
import type { RoomManagementStatusInfo } from '../../../hooks/useRoomManagementFilters';

const room: Room = {
  id: 'r1',
  room_number: '101',
  room_type: 'deluxe',
  price_per_night: 120,
  available: false,
  max_occupancy: 2,
  status: 'occupied',
};

const booking: BookingWithDetails = {
  id: 'b1',
  booking_number: 'BK-1',
  guest_id: 'g1',
  room_id: 'r1',
  check_in_date: '2026-09-14',
  check_out_date: '2026-09-16',
  total_amount: 240,
  status: 'checked_in',
  guest_name: 'Jane Guest',
  guest_email: 'jane@example.com',
  room_number: '101',
  room_type: 'deluxe',
  price_per_night: 120,
  source: 'walk-in',
};

const statusInfo = (overrides: Partial<RoomManagementStatusInfo>): RoomManagementStatusInfo => ({
  computedStatus: 'available',
  booking: undefined,
  reservedBooking: undefined,
  hasCheckedInBooking: false,
  hasReservationForToday: false,
  hasFutureReservation: false,
  futureCheckInDate: null,
  isOccupied: false,
  isReserved: false,
  isReservedToday: false,
  isComplimentary: false,
  ...overrides,
});

const occupiedInfo = statusInfo({
  computedStatus: 'occupied',
  booking,
  hasCheckedInBooking: true,
  isOccupied: true,
});

const buildLayout = (spies: { primary: () => void; item: () => void }): MenuLayout => ({
  primary: { label: 'Check out', icon: null, onClick: spies.primary, color: 'error' },
  sections: [
    {
      title: 'Booking',
      actions: [
        { id: 'upcoming', label: 'Upcoming bookings', icon: null, onClick: spies.item },
      ],
    },
    {
      title: 'Room',
      actions: [
        { id: 'history', label: 'Room history', icon: null, onClick: spies.item },
      ],
    },
  ],
});

const renderMenu = (layout: MenuLayout, info: RoomManagementStatusInfo = occupiedInfo) => {
  const onClose = vi.fn();
  render(
    <RoomContextMenu
      menuPosition={{ top: 10, left: 10 }}
      onClose={onClose}
      room={room}
      getStatusInfo={() => info}
      getMenuLayout={() => layout}
      formatCurrency={(v) => `RM ${v}`}
    />,
  );
  return onClose;
};

describe('RoomContextMenu', () => {
  beforeEach(() => { mocks.isPhone = false; });
  afterEach(cleanup);

  it('desktop: renders the anchored menu with header, primary and sections', () => {
    const spies = { primary: vi.fn(), item: vi.fn() };
    const onClose = renderMenu(buildLayout(spies));

    expect(screen.getByText('Room 101')).toBeTruthy();
    // 'OCC' renders twice: the header pill and the aside housekeeping value.
    expect(screen.getAllByText('OCC')).toHaveLength(2);
    expect(screen.getByText('RM 120')).toBeTruthy(); // aside rate
    expect(screen.getByText('Housekeeping')).toBeTruthy(); // aside panel

    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));
    expect(spies.primary).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('desktop: runs a section action and closes', () => {
    const spies = { primary: vi.fn(), item: vi.fn() };
    const onClose = renderMenu(buildLayout(spies));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Room history' }));
    expect(spies.item).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('phone: renders a bottom sheet with header, folded aside facts and sections', () => {
    mocks.isPhone = true;
    const spies = { primary: vi.fn(), item: vi.fn() };
    renderMenu(buildLayout(spies));

    expect(screen.getByText('Room 101')).toBeTruthy();
    // 'OCC' renders twice: the header pill and the housekeeping caption row.
    expect(screen.getAllByText('OCC')).toHaveLength(2);
    // Aside facts folded inline as caption rows
    expect(screen.getByText('RM 120')).toBeTruthy();
    expect(screen.getByText(/Current booking/)).toBeTruthy();
    expect(screen.getByText(/Sep 14/)).toBeTruthy();
    expect(screen.getByText(/Housekeeping/)).toBeTruthy();
    // Sections render as overline labels + list rows
    expect(screen.getByText('Booking')).toBeTruthy();
    expect(screen.getByText('Room')).toBeTruthy();
    expect(screen.getByText('Upcoming bookings')).toBeTruthy();
  });

  it('phone: runs the primary action and closes', () => {
    mocks.isPhone = true;
    const spies = { primary: vi.fn(), item: vi.fn() };
    const onClose = renderMenu(buildLayout(spies));

    fireEvent.click(screen.getByRole('button', { name: 'Check out' }));
    expect(spies.primary).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('phone: runs a section action and closes', () => {
    mocks.isPhone = true;
    const spies = { primary: vi.fn(), item: vi.fn() };
    const onClose = renderMenu(buildLayout(spies));

    fireEvent.click(screen.getByText('Upcoming bookings'));
    expect(spies.item).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('phone: omits aside facts when no booking is attached', () => {
    mocks.isPhone = true;
    const spies = { primary: vi.fn(), item: vi.fn() };
    const layout: MenuLayout = {
      primary: { label: 'Mark clean', icon: null, onClick: spies.primary, dark: true },
      sections: [
        {
          title: 'Housekeeping',
          actions: [{ id: 'update-status', label: 'Update status / block', icon: null, onClick: spies.item }],
        },
      ],
    };
    renderMenu(layout, statusInfo({ computedStatus: 'dirty' }));

    expect(screen.queryByText(/Current booking|Next booking/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark clean' })).toBeTruthy();
    expect(screen.getByText('Update status / block')).toBeTruthy();
  });
});
