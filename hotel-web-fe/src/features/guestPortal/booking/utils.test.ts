import { describe, expect, it } from 'vitest';

import type { AvailabilityEvent, GuestBookingSearch } from './types';
import { shouldInterruptSelectedOffer, stayOverlapsAvailabilityEvent } from './utils';

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
