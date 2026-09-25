import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookingWithDetails, Room } from '../../../../../types';

vi.mock('../../../../../hooks/useIsPhone', () => ({ useIsPhone: () => false }));

import RoomCard from './RoomCard';

const room: Room = {
  id: '10',
  room_number: '210',
  room_type: 'Deluxe',
  room_type_code: 'DLX',
  price_per_night: 180,
  available: false,
  max_occupancy: 2,
  status: 'occupied',
  is_smoking: true,
};

const buildBooking = (overrides: Partial<BookingWithDetails> = {}): BookingWithDetails => ({
  id: '4887',
  booking_number: 'BK-20260925-5046bede',
  guest_id: '1',
  room_id: '10',
  check_in_date: '2026-09-25',
  check_out_date: '2026-09-27',
  total_amount: 360,
  status: 'checked_in',
  guest_name: 'Aisyah',
  guest_email: 'aisyah@example.com',
  room_number: '210',
  room_type: 'Deluxe',
  price_per_night: 180,
  ...overrides,
} as BookingWithDetails);

const noop = () => {};

function renderOccupied(booking: BookingWithDetails, roomOverrides: Partial<Room> = {}) {
  return render(
    <RoomCard
      room={{ ...room, ...roomOverrides }}
      computedStatus="occupied"
      statusLabel="Occupied"
      booking={booking}
      reservedBooking={undefined}
      hasReservationForToday={false}
      isOccupied
      isReservedToday={false}
      isComplimentary={false}
      cardFill="var(--hotel-status-occupied)"
      onMenuOpen={noop}
      onEditNotes={noop}
      onEditBookingNotes={noop}
      onCheckOut={noop}
      onChangeRoom={noop}
      onCheckIn={noop}
      onNewBooking={noop}
      onMarkAvailable={noop}
    />,
  );
}

function renderReserved(booking: BookingWithDetails, roomOverrides: Partial<Room> = {}) {
  return render(
    <RoomCard
      room={{ ...room, status: 'reserved', ...roomOverrides }}
      computedStatus="reserved"
      statusLabel="Reserved"
      booking={undefined}
      reservedBooking={{ ...booking, status: 'confirmed' }}
      hasReservationForToday
      isOccupied={false}
      isReservedToday
      isComplimentary={false}
      cardFill="var(--hotel-status-reserved)"
      onMenuOpen={noop}
      onEditNotes={noop}
      onEditBookingNotes={noop}
      onCheckOut={noop}
      onChangeRoom={noop}
      onCheckIn={noop}
      onNewBooking={noop}
      onMarkAvailable={noop}
    />,
  );
}

describe('RoomCard booking notes', () => {
  afterEach(() => cleanup());

  it('shows the guest special request even when staff remarks exist, each labelled', () => {
    renderOccupied(buildBooking({
      special_requests: 'Non-smoking room please',
      remarks: 'Late arrival, key at guard house',
    }));

    expect(screen.getByText('Non-smoking room please')).toBeDefined();
    expect(screen.getByText('Late arrival, key at guard house')).toBeDefined();
    expect(screen.getByText(/Guest request/)).toBeDefined();
    expect(screen.getByText(/Staff notes/)).toBeDefined();
  });

  it('shows both notes on a reserved card too', () => {
    renderReserved(buildBooking({
      special_requests: 'High floor',
      remarks: 'Paid by transfer',
    }));

    expect(screen.getByText('High floor')).toBeDefined();
    expect(screen.getByText('Paid by transfer')).toBeDefined();
  });

  it('shows just the guest request when there are no staff remarks', () => {
    renderOccupied(buildBooking({ special_requests: 'Extra towels', remarks: undefined }));

    expect(screen.getByText('Extra towels')).toBeDefined();
    expect(screen.queryByText(/Staff notes/)).toBeNull();
  });

  it('prompts to add notes when there are none', () => {
    renderOccupied(buildBooking({ special_requests: undefined, remarks: undefined }));
    expect(screen.getByText('Add notes...')).toBeDefined();
  });
});

describe('RoomCard smoking preference chip', () => {
  afterEach(() => cleanup());

  it('warns when a non-smoking guest is in a smoking room', () => {
    renderOccupied(buildBooking({ smoking_preference: 'non_smoking' }), { is_smoking: true });
    const chip = screen.getByTestId('smoking-preference-chip');
    expect(chip.textContent).toContain('Wants non-smoking');
    expect(chip.getAttribute('data-mismatch')).toBe('true');
  });

  it('shows a plain chip when the reserved room matches the preference', () => {
    renderReserved(buildBooking({ smoking_preference: 'non_smoking' }), { is_smoking: false });
    const chip = screen.getByTestId('smoking-preference-chip');
    expect(chip.getAttribute('data-mismatch')).toBe('false');
  });

  it('treats a room without the smoking flag as non-smoking', () => {
    renderOccupied(buildBooking({ smoking_preference: 'smoking' }), { is_smoking: undefined });
    expect(screen.getByTestId('smoking-preference-chip').getAttribute('data-mismatch')).toBe('true');
  });

  it('shows no chip when the guest has no preference', () => {
    renderOccupied(buildBooking({ smoking_preference: null }));
    expect(screen.queryByTestId('smoking-preference-chip')).toBeNull();
  });
});
