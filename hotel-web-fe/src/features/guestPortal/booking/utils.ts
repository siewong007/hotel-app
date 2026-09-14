import type { AvailabilityEvent, GuestBookingSearch } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseCalendarDate(value: string): Date | null {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatCalendarDate(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function addCalendarMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months;
  const lastDayOfTargetMonth = new Date(
    date.getFullYear(),
    targetMonth + 1,
    0,
    12,
  ).getDate();
  return new Date(
    date.getFullYear(),
    targetMonth,
    Math.min(date.getDate(), lastDayOfTargetMonth),
    12,
  );
}

/** Returns a guest-friendly validation message, or null when the search is valid. */
export function validateGuestBookingSearch(
  search: GuestBookingSearch,
  t: (key: string) => string,
  today = new Date(),
): string | null {
  const checkIn = parseCalendarDate(search.check_in_date);
  const checkOut = parseCalendarDate(search.check_out_date);
  const todayAtNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (!checkIn || !checkOut) return t('book.errors.invalidDates');
  if (checkIn < todayAtNoon) return t('book.errors.checkInPast');
  if (checkOut <= checkIn) return t('book.errors.checkOutOrder');
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
  if (nights < 1 || nights > 30) return t('book.errors.stayLength');
  const latestCheckIn = addCalendarMonthsClamped(todayAtNoon, 3);
  if (checkIn > latestCheckIn) return t('book.errors.checkInHorizon');
  if (!Number.isInteger(search.adults) || search.adults < 1 || search.adults > 20) return t('book.errors.adultsRange');
  if (!Number.isInteger(search.children) || search.children < 0 || search.children > 20) return t('book.errors.childrenRange');
  return null;
}

export function countStayNights(search: Pick<GuestBookingSearch, 'check_in_date' | 'check_out_date'>): number {
  const checkIn = parseCalendarDate(search.check_in_date);
  const checkOut = parseCalendarDate(search.check_out_date);
  return checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS)) : 0;
}

export function calendarDateInput(daysFromToday: number, today = new Date()): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysFromToday, 12);
  return formatCalendarDate(date);
}

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
