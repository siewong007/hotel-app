import { describe, expect, it } from 'vitest';

import type { AvailabilityEvent, GuestBookingSearch } from './types';
import {
  shouldInterruptSelectedOffer,
  stayOverlapsAvailabilityEvent,
  validateGuestBookingSearch,
} from './utils';

const search: GuestBookingSearch = {
  check_in_date: '2026-08-10',
  check_out_date: '2026-08-12',
  adults: 2,
  children: 0,
};

function event(checkIn: string, checkOut: string): AvailabilityEvent {
  return {
    event_id: 'event-1',
    event_type: 'availability_changed',
    reason: 'booking_created',
    room_type_id: 1,
    check_in_date: checkIn,
    check_out_date: checkOut,
    remaining_rooms: 0,
  };
}

describe('stayOverlapsAvailabilityEvent', () => {
  it('interrupts for availability changes that overlap the selected stay', () => {
    expect(stayOverlapsAvailabilityEvent(event('2026-08-11', '2026-08-13'), search))
      .toBe(true);
  });

  it('does not interrupt when one stay starts as the other checks out', () => {
    expect(stayOverlapsAvailabilityEvent(event('2026-08-12', '2026-08-14'), search))
      .toBe(false);
    expect(stayOverlapsAvailabilityEvent(event('2026-08-08', '2026-08-10'), search))
      .toBe(false);
  });

  it('treats a general room inventory change as affecting every stay', () => {
    const globalEvent: AvailabilityEvent = {
      ...event('2026-08-12', '2026-08-14'),
      reason: 'room_inventory_changed',
      room_type_id: null,
      check_in_date: null,
      check_out_date: null,
      remaining_rooms: null,
    };
    expect(stayOverlapsAvailabilityEvent(globalEvent, search)).toBe(true);
    expect(shouldInterruptSelectedOffer(globalEvent, search, 3)).toBe(true);
  });

  it('interrupts a selected room when its online count changes but remains above zero', () => {
    const decreasedEvent = {
      ...event('2026-08-10', '2026-08-11'),
      reason: 'online_inventory_changed' as const,
      remaining_rooms: 2,
    };
    expect(shouldInterruptSelectedOffer(decreasedEvent, search, 1)).toBe(true);
  });
});

describe('validateGuestBookingSearch', () => {
  const today = new Date(2026, 6, 17, 9);

  it('accepts a stay within the allowed booking horizon', () => {
    expect(validateGuestBookingSearch(search, today)).toBeNull();
  });

  it('rejects invalid dates, stay lengths, guest counts, and the booking horizon', () => {
    expect(validateGuestBookingSearch({ ...search, check_in_date: '2026-07-16' }, today))
      .toBe('Check-in must be today or later.');
    expect(validateGuestBookingSearch({ ...search, check_out_date: '2026-08-10' }, today))
      .toBe('Check-out must be later than check-in.');
    expect(validateGuestBookingSearch({ ...search, check_out_date: '2026-09-12' }, today))
      .toBe('Stays must be between 1 and 30 nights.');
    expect(validateGuestBookingSearch({ ...search, check_in_date: '2026-10-18', check_out_date: '2026-10-19' }, today))
      .toBe('Choose a check-in date within the next three calendar months.');
    expect(validateGuestBookingSearch({ ...search, adults: 21 }, today))
      .toBe('Adults must be between 1 and 20.');
    expect(validateGuestBookingSearch({ ...search, children: -1 }, today))
      .toBe('Children must be between 0 and 20.');
  });

  it('allows a valid stay to end after the check-in horizon', () => {
    expect(validateGuestBookingSearch({
      ...search,
      check_in_date: '2026-10-17',
      check_out_date: '2026-10-30',
    }, today)).toBeNull();
  });

  it('clamps the three-month horizon to the last valid day of the target month', () => {
    const januaryThirtyFirst = new Date(2026, 0, 31, 9);
    expect(validateGuestBookingSearch({
      ...search,
      check_in_date: '2026-04-30',
      check_out_date: '2026-05-01',
    }, januaryThirtyFirst)).toBeNull();
    expect(validateGuestBookingSearch({
      ...search,
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-02',
    }, januaryThirtyFirst)).toBe('Choose a check-in date within the next three calendar months.');
  });
});
