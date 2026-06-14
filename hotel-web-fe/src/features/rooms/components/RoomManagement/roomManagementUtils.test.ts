import { describe, expect, it } from 'vitest';

import type { BookingWithDetails, Room } from '../../../../types';
import {
  calculateNightsBetweenDates,
  formatMenuBookingDate,
  getAvailableCreditsBookingDates,
  getCreditsBookingDates,
  getRatePerNight,
  getRoomStatusInfo,
  getRoomTypeCode,
  isDateBlocked,
  validateCreditBookingDates,
  type RoomBlockedDate,
} from './roomManagementUtils';

const room = (overrides: Partial<Room> = {}): Room => ({
  id: '101',
  room_number: '101',
  room_type: 'Standard Room',
  price_per_night: 150,
  available: true,
  max_occupancy: 2,
  status: 'available',
  ...overrides,
});

const booking = (overrides: Partial<BookingWithDetails> = {}): BookingWithDetails => ({
  id: 'booking-101',
  booking_number: 'BK-20300110-deadbeef',
  guest_id: 'guest-101',
  guest_name: 'Test Guest',
  guest_email: 'guest@example.com',
  room_id: '101',
  room_number: '101',
  room_type: 'Standard Room',
  check_in_date: '2030-01-10',
  check_out_date: '2030-01-12',
  price_per_night: 150,
  total_amount: 300,
  status: 'confirmed',
  ...overrides,
});

describe('room status derivation', () => {
  it('prioritizes checked-in occupancy over persisted status and reservations', () => {
    const info = getRoomStatusInfo(
      room({ status: 'maintenance' }),
      new Map([['101', booking({ status: 'checked_in', is_complimentary: true })]]),
      new Map([['101', booking({ id: 'reserved-101', status: 'confirmed' })]]),
      new Date(2030, 0, 10),
    );

    expect(info.computedStatus).toBe('occupied');
    expect(info.isOccupied).toBe(true);
    expect(info.isComplimentary).toBe(true);
  });

  it('keeps dirty and maintenance room status ahead of same-day reservations', () => {
    const info = getRoomStatusInfo(
      room({ status: 'dirty' }),
      new Map(),
      new Map([['101', booking({ status: 'confirmed', check_in_date: '2030-01-10' })]]),
      new Date(2030, 0, 10),
    );

    expect(info.hasReservationForToday).toBe(true);
    expect(info.computedStatus).toBe('dirty');
    expect(info.isReserved).toBe(false);
  });

  it('tracks future reservations without marking the room reserved today', () => {
    const info = getRoomStatusInfo(
      room(),
      new Map(),
      new Map([['101', booking({ check_in_date: '2030-01-15' })]]),
      new Date(2030, 0, 10),
    );

    expect(info.computedStatus).toBe('available');
    expect(info.hasFutureReservation).toBe(true);
    expect(info.futureCheckInDate?.getFullYear()).toBe(2030);
  });
});

describe('date and credit helpers', () => {
  const blockedDates: RoomBlockedDate[] = [
    { start: '2030-04-10', end: '2030-04-12', status: 'confirmed' },
  ];

  it('blocks check-in through the night before checkout, but not checkout day', () => {
    expect(isDateBlocked('2030-04-09', blockedDates)).toBe(false);
    expect(isDateBlocked('2030-04-10', blockedDates)).toBe(true);
    expect(isDateBlocked('2030-04-11', blockedDates)).toBe(true);
    expect(isDateBlocked('2030-04-12', blockedDates)).toBe(false);
  });

  it('calculates same-day and multi-night stays', () => {
    expect(calculateNightsBetweenDates('2030-05-01', '2030-05-01')).toBe(1);
    expect(calculateNightsBetweenDates('2030-05-01', '2030-05-04')).toBe(3);
  });

  it('calculates available credit dates across partial blocked overlaps', () => {
    const partialOverlap = [{ start: '2030-06-11', end: '2030-06-13', status: 'confirmed' }];

    expect(getCreditsBookingDates('2030-06-10', '2030-06-14')).toEqual([
      '2030-06-10',
      '2030-06-11',
      '2030-06-12',
      '2030-06-13',
    ]);
    expect(getAvailableCreditsBookingDates('2030-06-10', '2030-06-14', partialOverlap)).toEqual([
      '2030-06-10',
      '2030-06-13',
    ]);
    expect(validateCreditBookingDates('2030-06-10', '2030-06-14', partialOverlap)).toMatchObject({
      valid: false,
    });
  });

  it('treats timestamp-like inputs as hotel-local date values', () => {
    const timestampBlockedDates = [
      { start: '2030-07-04T23:30:00-05:00', end: '2030-07-06T01:00:00+09:00', status: 'confirmed' },
    ];

    expect(isDateBlocked('2030-07-04T23:30:00-05:00', timestampBlockedDates)).toBe(true);
    expect(isDateBlocked('2030-07-06T01:00:00+09:00', timestampBlockedDates)).toBe(false);
    expect(calculateNightsBetweenDates('2030-07-04T23:30:00-05:00', '2030-07-05T01:00:00+09:00')).toBe(1);
    expect(formatMenuBookingDate('2030-07-04T23:30:00-05:00')).toBe('Jul 4');
  });
});

describe('display fallback helpers', () => {
  it('returns stable room-type codes for known, unknown, and blank values', () => {
    expect(getRoomTypeCode('standard queen')).toBe('STDQ');
    expect(getRoomTypeCode('Penthouse')).toBe('PENT');
    expect(getRoomTypeCode('')).toBe('ROOM');
    expect(getRoomTypeCode(undefined)).toBe('ROOM');
    expect(getRoomTypeCode('   ')).toBe('ROOM');
  });

  it('uses the booking room-rate fallback only when it is a positive number', () => {
    expect(getRatePerNight(booking({ price_per_night: '225.50' }))).toBe(225.5);
    expect(getRatePerNight({ room_rate: '175.25' })).toBe(175.25);
    expect(getRatePerNight({ room_rate: '0' })).toBeNull();
    expect(getRatePerNight(null)).toBeNull();
  });
});
