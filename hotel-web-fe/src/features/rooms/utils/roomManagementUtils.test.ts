import { describe, expect, it } from 'vitest';

import {
  buildBlockedDateRangesForRoom,
  canCoverRoomsWithCredits,
  calculateNightCount,
  deriveRoomStatusInfo,
  getCreditBookingDates,
  getNextAvailableDate,
  getPositiveRatePerNight,
  getRoomTypeCode,
  getRoomTypeCreditForRoom,
  getTotalCreditsForRoom,
  isDateBlockedByRanges,
  validateCreditDateSelection,
} from './roomManagementUtils';

describe('roomManagementUtils', () => {
  it('prioritizes checked-in bookings over manual room status and reservations', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'maintenance' },
      booking: {
        status: 'checked_in',
        check_in_date: '2026-06-14',
        is_complimentary: true,
      },
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-06-15',
      },
      today: new Date(2026, 5, 15),
    });

    expect(status.computedStatus).toBe('occupied');
    expect(status.isComplimentary).toBe(true);
  });

  it('prioritizes dirty and maintenance rooms over due reservations', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'dirty' },
      booking: undefined,
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-06-15',
      },
      today: new Date(2026, 5, 15, 16, 0, 0),
      checkInTime: '15:00',
    });

    expect(status.computedStatus).toBe('dirty');
    expect(status.hasReservationForToday).toBe(true);
  });

  it('keeps reserved dirty rooms from becoming check-in ready', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'reserved_dirty' },
      booking: undefined,
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-06-15',
      },
      today: new Date(2026, 5, 15, 16, 0, 0),
      checkInTime: '15:00',
    });

    expect(status.computedStatus).toBe('reserved_dirty');
    expect(status.isReserved).toBe(false);
    expect(status.isReservedToday).toBe(false);
    expect(status.hasReservationForToday).toBe(true);
  });

  it('does not mark an arrival-day reservation as reserved before check-in time', () => {
    const base = {
      room: { status: 'available' },
      booking: undefined,
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-06-15',
      },
      checkInTime: '15:00',
    } as const;

    const beforeCheckIn = deriveRoomStatusInfo({
      ...base,
      today: new Date(2026, 5, 15, 9, 0, 0),
    });
    expect(beforeCheckIn.computedStatus).toBe('available');
    expect(beforeCheckIn.hasReservationForToday).toBe(false);

    const afterCheckIn = deriveRoomStatusInfo({
      ...base,
      today: new Date(2026, 5, 15, 15, 0, 0),
    });
    expect(afterCheckIn.computedStatus).toBe('reserved');
    expect(afterCheckIn.hasReservationForToday).toBe(true);
  });

  it('keeps future reservations visible without marking the room reserved today', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'available' },
      booking: undefined,
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-06-20',
      },
      today: new Date(2026, 5, 15),
    });

    expect(status.computedStatus).toBe('available');
    expect(status.hasFutureReservation).toBe(true);
    expect(status.futureCheckInDate?.getFullYear()).toBe(2026);
    expect(status.futureCheckInDate?.getMonth()).toBe(5);
    expect(status.futureCheckInDate?.getDate()).toBe(20);
  });

  it('blocks check-in through the night before checkout, but not checkout day', () => {
    const ranges = [{ start: '2026-06-15', end: '2026-06-18', status: 'confirmed' }];

    expect(isDateBlockedByRanges('2026-06-14', ranges)).toBe(false);
    expect(isDateBlockedByRanges('2026-06-15', ranges)).toBe(true);
    expect(isDateBlockedByRanges('2026-06-17', ranges)).toBe(true);
    expect(isDateBlockedByRanges('2026-06-18', ranges)).toBe(false);
  });

  it('builds blocked ranges only from active bookings for the selected room', () => {
    const ranges = buildBlockedDateRangesForRoom([
      {
        room_id: '101',
        check_in_date: '2026-06-15',
        check_out_date: '2026-06-17',
        status: 'confirmed',
      },
      {
        room_id: '101',
        check_in_date: '2026-06-20',
        check_out_date: '2026-06-21',
        status: 'checked_out',
      },
      {
        room_id: '102',
        check_in_date: '2026-06-16',
        check_out_date: '2026-06-18',
        status: 'confirmed',
      },
    ], '101');

    expect(ranges).toEqual([
      { start: '2026-06-15', end: '2026-06-17', status: 'confirmed' },
    ]);
  });

  it('calculates same-day and multi-night stays from local date parts', () => {
    expect(calculateNightCount('2026-06-15', '2026-06-15')).toBe(1);
    expect(calculateNightCount('2026-06-15', '2026-06-18')).toBe(3);
    expect(calculateNightCount('2026-03-07T23:00:00-08:00', '2026-03-09T01:00:00-07:00')).toBe(2);
  });

  it('returns each credit night and validates partial overlaps against blocked ranges', () => {
    const ranges = [{ start: '2026-06-16', end: '2026-06-17', status: 'pending' }];

    expect(getCreditBookingDates('2026-06-15', '2026-06-18')).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
    ]);
    expect(validateCreditDateSelection('2026-06-15', '2026-06-18', ranges)).toEqual({
      valid: false,
      message: expect.stringContaining('already reserved'),
    });
    expect(validateCreditDateSelection('2026-06-17', '2026-06-18', ranges)).toEqual({
      valid: true,
      message: '',
    });
  });

  it('finds the next available credit date after contiguous blocked ranges', () => {
    expect(getNextAvailableDate('2026-06-15', [
      { start: '2026-06-15', end: '2026-06-16' },
      { start: '2026-06-16', end: '2026-06-18' },
    ])).toBe('2026-06-18');
  });

  it('matches complimentary credits by id, code, or partial room-type names', () => {
    const rooms = [
      { id: '1', room_type: 'Deluxe King' },
      { id: '2', room_type: 'Standard Queen', room_type_code: 'STDQ' },
      { id: '3', room_type: 'Mystery Room', room_type_id: 9 },
    ];
    const guestCredits = {
      credits_by_room_type: [
        { room_type_name: 'Deluxe', nights_available: 2 },
        { room_type_code: 'STDQ', nights_available: '3' },
        { room_type_id: 9, nights_available: 4 },
      ],
    };

    expect(getTotalCreditsForRoom(guestCredits, rooms, '1')).toBe(2);
    expect(getTotalCreditsForRoom(guestCredits, rooms, '2')).toBe(3);
    expect(getTotalCreditsForRoom(guestCredits, rooms, '3')).toBe(4);
    expect(getTotalCreditsForRoom(guestCredits, rooms, '404')).toBe(0);
    expect(getRoomTypeCreditForRoom(guestCredits, rooms[1])?.room_type_code).toBe('STDQ');
  });

  it('matches complimentary guest and room selections by credited room type and required nights', () => {
    const rooms = [
      { id: '101', room_type: 'Standard Queen', room_type_code: 'STDQ' },
      { id: '102', room_type: 'Standard Queen', room_type_code: 'STDQ' },
      { id: '201', room_type: 'Deluxe King', room_type_name: 'Deluxe' },
      { id: '301', room_type: 'Family Suite', room_type_code: 'FAM' },
    ];
    const standardGuest = {
      total_complimentary_credits: 2,
      credits_by_room_type: [
        { room_type_code: 'STDQ', nights_available: 2 },
      ],
    };
    const deluxeGuest = {
      total_complimentary_credits: 2,
      credits_by_room_type: [
        { room_type_name: 'Deluxe', nights_available: 2 },
      ],
    };
    const mixedGuest = {
      total_complimentary_credits: 4,
      credits_by_room_type: [
        { room_type_code: 'STDQ', nights_available: 2 },
        { room_type_name: 'Deluxe', nights_available: 2 },
      ],
    };

    expect(canCoverRoomsWithCredits(standardGuest, [rooms[0]], 1)).toBe(true);
    expect(canCoverRoomsWithCredits(standardGuest, [rooms[2]], 1)).toBe(false);

    const guestsForStandardRoom = [standardGuest, deluxeGuest, mixedGuest]
      .filter((guest) => canCoverRoomsWithCredits(guest, [rooms[0]], 1));
    expect(guestsForStandardRoom).toEqual([standardGuest, mixedGuest]);

    const roomsForStandardGuest = rooms
      .filter((room) => canCoverRoomsWithCredits(standardGuest, [room], 1))
      .map((room) => room.id);
    expect(roomsForStandardGuest).toEqual(['101', '102']);

    expect(canCoverRoomsWithCredits(standardGuest, [rooms[0], rooms[1]], 1)).toBe(true);
    expect(canCoverRoomsWithCredits(standardGuest, [rooms[0], rooms[1]], 2)).toBe(false);
    expect(canCoverRoomsWithCredits(mixedGuest, [rooms[0], rooms[2]], 2)).toBe(true);
    expect(canCoverRoomsWithCredits(mixedGuest, [rooms[0], rooms[3]], 1)).toBe(false);
  });

  it('handles empty room-type codes and fallback rate values', () => {
    expect(getRoomTypeCode()).toBe('N/A');
    expect(getRoomTypeCode('')).toBe('N/A');
    expect(getRoomTypeCode('suite')).toBe('STE');
    expect(getRoomTypeCode('Ocean View')).toBe('OCEA');
    expect(getPositiveRatePerNight({ room_rate: '180.50' })).toBe(180.5);
    expect(getPositiveRatePerNight({ price_per_night: 'not-money', room_rate: 120 })).toBe(null);
    expect(getPositiveRatePerNight({ price_per_night: 0 })).toBe(null);
  });
});
