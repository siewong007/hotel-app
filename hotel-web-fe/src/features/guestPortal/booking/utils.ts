import type { AvailabilityEvent, GuestBookingSearch } from './types';

export function stayOverlapsAvailabilityEvent(
  event: AvailabilityEvent,
  search: GuestBookingSearch,
): boolean {
  if (!event.check_in_date || !event.check_out_date) return true;
  return event.check_in_date < search.check_out_date
    && event.check_out_date > search.check_in_date;
}

export function shouldInterruptSelectedOffer(
  event: AvailabilityEvent,
  search: GuestBookingSearch,
  selectedRoomTypeId: number | null,
): boolean {
  if (selectedRoomTypeId === null || !stayOverlapsAvailabilityEvent(event, search)) return false;
  return event.room_type_id === null || event.room_type_id === selectedRoomTypeId;
}
