import type { AvailabilityEvent, GuestBookingSearch } from './types';

export function stayOverlapsAvailabilityEvent(
  event: AvailabilityEvent,
  search: GuestBookingSearch,
): boolean {
  return event.check_in_date < search.check_out_date
    && event.check_out_date > search.check_in_date;
}
