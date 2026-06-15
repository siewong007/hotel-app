import type { BookingWithDetails, Room } from '../../../../types';
import { formatLocalDate, parseLocalDate } from '../../../../utils/date';
import type { RoomStatusType } from '../../config';

export interface RoomBlockedDate {
  start: string;
  end: string;
  status: string;
}

export interface RoomCreditBucket {
  room_type_name: string;
  nights_available: number;
}

export interface GuestCreditsForRoom {
  credits_by_room_type: RoomCreditBucket[];
}

export interface RoomStatusInfo {
  computedStatus: RoomStatusType;
  booking: BookingWithDetails | undefined;
  reservedBooking: BookingWithDetails | undefined;
  hasCheckedInBooking: boolean;
  hasReservationForToday: boolean;
  hasFutureReservation: boolean;
  futureCheckInDate: Date | null;
  isOccupied: boolean;
  isReserved: boolean;
  isReservedToday: boolean;
  isComplimentary: boolean;
}

const ROOM_FILL_DARK: Record<string, string> = {
  available: '#2E7D4F',
  occupied: '#B25E18',
  reserved: '#1E5A8A',
  dirty: '#8A6E1D',
  maintenance: '#4D5358',
};

export function getRoomCardFill(status: string, statusColor: string, isDarkMode: boolean): string {
  if (isDarkMode) return ROOM_FILL_DARK[status] || ROOM_FILL_DARK.available;
  return status === 'dirty' ? '#a89436' : statusColor;
}

export function getRoomTypeCode(roomType?: string | null): string {
  const normalizedRoomType = roomType?.trim();
  if (!normalizedRoomType) return 'ROOM';

  const codes: Record<string, string> = {
    deluxe: 'DLXX',
    superior: 'SUP',
    standard: 'STD',
    suite: 'STE',
    'standard queen': 'STDQ',
    'family room': 'FR',
  };
  return codes[normalizedRoomType.toLowerCase()] || normalizedRoomType.substring(0, 4).toUpperCase();
}

export function formatMenuBookingDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getRatePerNight(
  booking: (Partial<BookingWithDetails> & { room_rate?: number | string }) | null,
): number | null {
  const rate = Number(booking?.price_per_night ?? booking?.room_rate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function buildRoomBlockedDates(
  bookings: BookingWithDetails[],
  roomId: string,
): RoomBlockedDate[] {
  return bookings
    .filter((booking) => (
      booking.room_id?.toString() === roomId &&
      !['checked_out', 'voided'].includes(booking.status)
    ))
    .map((booking) => ({
      start: booking.check_in_date,
      end: booking.check_out_date,
      status: booking.status,
    }));
}

export function isDateBlocked(dateStr: string, blockedDates: RoomBlockedDate[]): boolean {
  const date = parseLocalDate(dateStr);
  date.setHours(0, 0, 0, 0);

  return blockedDates.some((booking) => {
    const start = parseLocalDate(booking.start);
    start.setHours(0, 0, 0, 0);
    const end = parseLocalDate(booking.end);
    end.setHours(0, 0, 0, 0);

    return date >= start && date < end;
  });
}

export function getNextAvailableDate(fromDate: string, blockedDates: RoomBlockedDate[]): string {
  const date = parseLocalDate(fromDate);
  date.setHours(0, 0, 0, 0);

  while (isDateBlocked(formatLocalDate(date), blockedDates)) {
    date.setDate(date.getDate() + 1);
  }

  return formatLocalDate(date);
}

export function validateCreditBookingDates(
  checkInDate: string,
  checkOutDate: string,
  blockedDates: RoomBlockedDate[],
): { valid: boolean; message: string } {
  if (!checkInDate || !checkOutDate) {
    return { valid: false, message: 'Please select dates' };
  }

  const checkIn = parseLocalDate(checkInDate);
  const checkOut = parseLocalDate(checkOutDate);

  if (checkOut <= checkIn) {
    return { valid: false, message: 'Check-out must be after check-in' };
  }

  for (let date = new Date(checkIn); date < checkOut; date.setDate(date.getDate() + 1)) {
    if (isDateBlocked(formatLocalDate(date), blockedDates)) {
      return { valid: false, message: `Date ${date.toLocaleDateString()} is already reserved` };
    }
  }

  return { valid: true, message: '' };
}

export function getCreditsBookingDates(checkInDate: string, checkOutDate: string): string[] {
  const dates: string[] = [];
  const start = parseLocalDate(checkInDate);
  const end = parseLocalDate(checkOutDate);

  for (let date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
    dates.push(formatLocalDate(date));
  }

  return dates;
}

export function getAvailableCreditsBookingDates(
  checkInDate: string,
  checkOutDate: string,
  blockedDates: RoomBlockedDate[],
): string[] {
  return getCreditsBookingDates(checkInDate, checkOutDate)
    .filter((date) => !isDateBlocked(date, blockedDates));
}

export function getTotalCreditsForRoom(
  guestCredits: GuestCreditsForRoom | null,
  rooms: Room[],
  roomId: string,
): number {
  if (!guestCredits || !roomId) return 0;

  const room = rooms.find((candidate) => candidate.id.toString() === roomId);
  if (!room) return 0;

  const roomTypeCredits = guestCredits.credits_by_room_type.find((credit) =>
    room.room_type?.toLowerCase().includes(credit.room_type_name.toLowerCase()),
  );

  return roomTypeCredits?.nights_available || 0;
}

export function calculateNightsBetweenDates(checkInDate: string, checkOutDate: string): number {
  const checkIn = parseLocalDate(checkInDate);
  const checkOut = parseLocalDate(checkOutDate);
  return Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
}

export function getRoomStatusInfo(
  room: Room,
  roomBookings: Map<string, BookingWithDetails>,
  reservedBookings: Map<string, BookingWithDetails>,
  todayDate: Date = new Date(),
): RoomStatusInfo {
  const booking = roomBookings.get(room.id);
  const reservedBooking = reservedBookings.get(room.id);
  const today = new Date(todayDate);
  today.setHours(0, 0, 0, 0);

  const hasCheckedInBooking = booking?.status === 'checked_in' || booking?.status === 'auto_checked_in';
  const hasReservationForToday = reservedBooking ? (() => {
    const checkInDate = new Date(reservedBooking.check_in_date);
    checkInDate.setHours(0, 0, 0, 0);
    const isConfirmed = reservedBooking.status === 'confirmed' || reservedBooking.status === 'pending';
    return isConfirmed && checkInDate <= today;
  })() : false;
  const hasFutureReservation = !!reservedBooking && !hasReservationForToday;
  const futureCheckInDate = hasFutureReservation && reservedBooking
    ? new Date(reservedBooking.check_in_date)
    : null;

  const persistedStatus = room.status || '';
  const computedStatus: RoomStatusType = hasCheckedInBooking
    ? 'occupied'
    : ['maintenance', 'dirty'].includes(persistedStatus)
      ? persistedStatus as RoomStatusType
      : hasReservationForToday
        ? 'reserved'
        : 'available';

  const isOccupied = computedStatus === 'occupied';
  const isReserved = computedStatus === 'reserved';
  const isReservedToday = isReserved && hasReservationForToday;
  const isComplimentary = (isOccupied && booking?.is_complimentary === true) ||
    (isReserved && reservedBooking?.is_complimentary === true);

  return {
    computedStatus,
    booking,
    reservedBooking,
    hasCheckedInBooking,
    hasReservationForToday,
    hasFutureReservation,
    futureCheckInDate,
    isOccupied,
    isReserved,
    isReservedToday,
    isComplimentary,
  };
}
