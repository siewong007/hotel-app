import { describe, expect, it } from 'vitest';

import {
  buildBlockedDateRangesForRoom,
  canCoverRoomsWithCredits,
  calculateNightCount,
  deriveRoomStatusInfo,
  formatHoldRange,
  getCreditBookingDates,
  isArrivalHoldVisible,
  getNextAvailableDate,
  getPositiveRatePerNight,
  getRoomTypeCode,
  getRoomTypeCreditForRoom,
  getTotalCreditsForRoom,
  selectSoonestHoldingBooking,
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
      visibleFrom: '15:00',
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
      visibleFrom: '15:00',
    });

    expect(status.computedStatus).toBe('reserved_dirty');
    expect(status.isReserved).toBe(false);
    expect(status.isReservedToday).toBe(false);
    expect(status.hasReservationForToday).toBe(true);
  });

  it('does not mark an arrival-day reservation as reserved before the new-reservation time', () => {
    const base = {
      room: { status: 'available' },
      booking: undefined,
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-06-15',
      },
      visibleFrom: '15:00',
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

  it('reads a stored reserved_dirty room as dirty until its arrival day', () => {
    // Prod 2026-10-11: rooms checked out with a stay due days later were left
    // reserved_dirty and showed as held today. They are just dirty, with the
    // future stay kept as a small hold label.
    const status = deriveRoomStatusInfo({
      room: { status: 'reserved_dirty' },
      booking: undefined,
      reservedBooking: {
        status: 'confirmed',
        check_in_date: '2026-10-12',
        check_out_date: '2026-10-13',
      },
      today: new Date(2026, 9, 11, 10, 0, 0),
      visibleFrom: '07:00',
    });

    expect(status.computedStatus).toBe('dirty');
    expect(status.hasReservationForToday).toBe(false);
    expect(status.hasFutureReservation).toBe(true);
    expect(status.futureCheckInDate?.getDate()).toBe(12);

    const noHold = deriveRoomStatusInfo({
      room: { status: 'reserved_dirty' },
      booking: undefined,
      reservedBooking: undefined,
      today: new Date(2026, 9, 11, 10, 0, 0),
      visibleFrom: '07:00',
    });
    expect(noHold.computedStatus).toBe('dirty');
  });

  it('holds a dirty room for today\'s arrival only from the new-reservation time', () => {
    const base = {
      room: { status: 'reserved_dirty' },
      booking: undefined,
      reservedBooking: { status: 'confirmed', check_in_date: '2026-10-11' },
      visibleFrom: '07:00',
    } as const;

    expect(deriveRoomStatusInfo({ ...base, today: new Date(2026, 9, 11, 6, 59) }).computedStatus)
      .toBe('dirty');
    expect(deriveRoomStatusInfo({ ...base, today: new Date(2026, 9, 11, 7, 0) }).computedStatus)
      .toBe('reserved_dirty');
  });

  it('never reads a stored reserved room as held for a later stay', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'reserved' },
      booking: undefined,
      reservedBooking: { status: 'confirmed', check_in_date: '2026-10-15' },
      today: new Date(2026, 9, 11, 12, 0, 0),
      visibleFrom: '07:00',
    });

    expect(status.computedStatus).toBe('available');
    expect(status.isReservedToday).toBe(false);
    expect(status.hasFutureReservation).toBe(true);
  });

  it('keeps an overdue arrival holding the room whatever the time', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'reserved' },
      booking: undefined,
      reservedBooking: { status: 'confirmed', check_in_date: '2026-10-10' },
      today: new Date(2026, 9, 11, 1, 0, 0),
      visibleFrom: '07:00',
    });

    expect(status.computedStatus).toBe('reserved');
    expect(status.hasReservationForToday).toBe(true);
  });

  it('gates arrival holds on the new_reservation_visible_time setting by default', () => {
    localStorage.setItem('hotelSettings', JSON.stringify({
      new_reservation_visible_time: '09:30',
      check_in_time: '15:00',
    }));
    try {
      const base = {
        room: { status: 'available' },
        booking: undefined,
        reservedBooking: { status: 'confirmed', check_in_date: '2026-10-11' },
      } as const;
      expect(deriveRoomStatusInfo({ ...base, today: new Date(2026, 9, 11, 9, 29) }).computedStatus)
        .toBe('available');
      // Held from 09:30 — the check-in time (15:00) no longer gates it.
      expect(deriveRoomStatusInfo({ ...base, today: new Date(2026, 9, 11, 9, 30) }).computedStatus)
        .toBe('reserved');
    } finally {
      localStorage.removeItem('hotelSettings');
    }
  });

  it('decides arrival-hold visibility from the day and the hotel clock', () => {
    expect(isArrivalHoldVisible('2026-10-10', '2026-10-11', 0, '07:00')).toBe(true);
    expect(isArrivalHoldVisible('2026-10-11', '2026-10-11', 6 * 60 + 59, '07:00')).toBe(false);
    expect(isArrivalHoldVisible('2026-10-11', '2026-10-11', 7 * 60, '07:00')).toBe(true);
    expect(isArrivalHoldVisible('2026-10-12', '2026-10-11', 23 * 60, '07:00')).toBe(false);
    expect(isArrivalHoldVisible('', '2026-10-11', 23 * 60, '07:00')).toBe(false);
  });

  it('treats an awaiting-payment hold as reserving the room without offering check-in', () => {
    // Room 210 regression: a website booking in `pending_confirmation` (bank
    // transfer awaiting confirmation) arriving today held the room, but the
    // grid read it as available with no guest.
    for (const holdStatus of ['pending_payment', 'pending_confirmation']) {
      const status = deriveRoomStatusInfo({
        room: { status: 'reserved' },
        booking: undefined,
        reservedBooking: {
          status: holdStatus,
          check_in_date: '2026-09-25',
        },
        today: new Date(2026, 8, 25, 20, 30, 0),
        visibleFrom: '15:00',
      });

      expect(status.computedStatus).toBe('reserved');
      expect(status.hasReservationForToday).toBe(true);
      expect(status.isReservedToday).toBe(true);
      expect(status.isAwaitingPayment).toBe(true);
      expect(status.canCheckInReservation).toBe(false);
    }
  });

  it('keeps check-in available for confirmed and pending reservations', () => {
    for (const reservedStatus of ['confirmed', 'pending']) {
      const status = deriveRoomStatusInfo({
        room: { status: 'available' },
        booking: undefined,
        reservedBooking: {
          status: reservedStatus,
          check_in_date: '2026-09-25',
        },
        today: new Date(2026, 8, 25, 16, 0, 0),
        visibleFrom: '15:00',
      });

      expect(status.isReservedToday).toBe(true);
      expect(status.isAwaitingPayment).toBe(false);
      expect(status.canCheckInReservation).toBe(true);
    }
  });

  it('never lets a voided booking hold the room', () => {
    const status = deriveRoomStatusInfo({
      room: { status: 'available' },
      booking: undefined,
      reservedBooking: {
        status: 'voided',
        check_in_date: '2026-09-25',
      },
      today: new Date(2026, 8, 25, 16, 0, 0),
      visibleFrom: '15:00',
    });

    expect(status.computedStatus).toBe('available');
    expect(status.hasReservationForToday).toBe(false);
    expect(status.canCheckInReservation).toBe(false);
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
      messageKey: 'validation.dateReserved',
      vars: { date: expect.any(String) },
    });
    expect(validateCreditDateSelection('2026-06-17', '2026-06-18', ranges)).toEqual({
      valid: true,
      messageKey: '',
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

describe('holding reservation dates', () => {
  const today = new Date(2026, 8, 30);

  const stay = (overrides: Record<string, string>) => ({
    room_id: '104',
    status: 'confirmed',
    check_in_date: '2026-10-20',
    check_out_date: '2026-10-22',
    ...overrides,
  });

  it('picks the earliest check-in that is still active', () => {
    const chosen = selectSoonestHoldingBooking([
      stay({ check_in_date: '2026-11-02', check_out_date: '2026-11-04' }),
      stay({ check_in_date: '2026-10-14', check_out_date: '2026-10-16' }),
      stay({ status: 'voided', check_in_date: '2026-10-01', check_out_date: '2026-10-03' }),
      stay({ status: 'cancelled', check_in_date: '2026-10-05', check_out_date: '2026-10-08' }),
      stay({ status: 'checked_out', check_in_date: '2026-09-01', check_out_date: '2026-09-03' }),
      stay({ room_id: '105', check_in_date: '2026-10-02', check_out_date: '2026-10-04' }),
    ], '104', today);

    expect(chosen?.check_in_date).toBe('2026-10-14');
    expect(chosen?.check_out_date).toBe('2026-10-16');
  });

  it('does not invent a date when every hold is inactive or already over', () => {
    expect(selectSoonestHoldingBooking([
      stay({ status: 'voided' }),
      stay({ status: 'checked_in', check_in_date: '2026-09-28', check_out_date: '2026-10-02' }),
      stay({ check_in_date: '2026-09-01', check_out_date: '2026-09-30' }),
    ], '104', today)).toBeUndefined();
  });

  it('formats a same-month stay as a compact range', () => {
    expect(formatHoldRange('2026-10-14', '2026-10-16')).toBe('Oct 14–16');
  });

  it('keeps both months when the stay crosses a month boundary', () => {
    expect(formatHoldRange('2026-10-30', '2026-11-02')).toBe('Oct 30–Nov 2');
  });
});
