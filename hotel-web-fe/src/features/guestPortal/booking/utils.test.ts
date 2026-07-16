import { describe, expect, it } from 'vitest';

import type { AvailabilityEvent, GuestBookingSearch } from './types';
import { stayOverlapsAvailabilityEvent } from './utils';

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
});
