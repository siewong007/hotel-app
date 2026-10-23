import type { GuestBookingOffer, GuestBookingSearch } from './types';
import { validateGuestBookingSearch } from './utils';

/**
 * Booking prefill handed over by the public landing page's BOOK DIRECT:
 *   /guest-portal?view=booking&check_in_date=YYYY-MM-DD&check_out_date=YYYY-MM-DD
 *     &adults=2&children=0&room_type=DLX
 * The portal trusts none of it: dates, party size and room code are each
 * validated, and anything invalid drops the whole stay back to the normal
 * Search step (a bad room code alone only drops the highlight).
 */
export interface BookingPrefill {
  search: GuestBookingSearch;
  /** Upper-cased room type code to highlight in Choose, or null. */
  roomTypeCode: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^\d{1,2}$/;
const ROOM_CODE = /^[A-Za-z0-9_-]{1,16}$/;

/** Strict calendar date: well-formed and a real day (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseCount(raw: string | null): number | null {
  if (raw === null) return null;
  const value = raw.trim();
  return INTEGER.test(value) ? Number(value) : null;
}

/**
 * Returns the validated prefill, or null when the URL carries no usable stay.
 * `children` defaults to 0 when omitted; everything else is required.
 */
export function parseBookingPrefill(
  query: string | URLSearchParams,
  today = new Date(),
): BookingPrefill | null {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const checkIn = params.get('check_in_date')?.trim() ?? '';
  const checkOut = params.get('check_out_date')?.trim() ?? '';
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) return null;
  const adults = parseCount(params.get('adults'));
  const children = params.has('children') ? parseCount(params.get('children')) : 0;
  if (adults === null || children === null) return null;
  const search: GuestBookingSearch = { check_in_date: checkIn, check_out_date: checkOut, adults, children };
  // Same rules the Search form enforces (past dates, order, 1–30 nights,
  // 3-month horizon, 1–20 adults, 0–20 children).
  if (validateGuestBookingSearch(search, (key) => key, today) !== null) return null;
  const room = params.get('room_type')?.trim() ?? '';
  return { search, roomTypeCode: ROOM_CODE.test(room) ? room.toUpperCase() : null };
}

/** The offer matching the prefilled room code (case-insensitive), if any. */
export function findPrefilledOffer(
  offers: readonly GuestBookingOffer[],
  roomTypeCode: string | null,
): GuestBookingOffer | null {
  if (!roomTypeCode) return null;
  return offers.find((offer) => offer.room_type_code?.toUpperCase() === roomTypeCode) ?? null;
}
