import { addLocalDays, formatLocalDate, parseLocalDate } from '../../../utils/date';
import { intlTag } from '../../../i18n/format';
import { getHotelSetting } from '../../../utils/hotelSettings';
import { isPositiveMoney, toMoneyNumber } from '../../../utils/money';
import {
  isAwaitingPaymentBookingStatus,
  isInHouseBookingStatus,
  isRoomHoldingReservationStatus,
} from '../../../constants/booking.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Parse a 'HH:mm' / 'HH:mm:ss' string into minutes-since-midnight (NaN-safe).
const timeToMinutes = (value: string): number => {
  const [rawHours, rawMinutes] = (value || '').split(':');
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  if (!Number.isFinite(hours)) return 0;
  return hours * 60 + (Number.isFinite(minutes) ? minutes : 0);
};

export interface BlockedDateRange {
  start: string;
  end: string;
  status?: string;
}

export interface RoomStatusRoom {
  status?: string | null;
}

export interface RoomStatusBooking {
  status?: string | null;
  check_in_date: string;
  is_complimentary?: boolean | null;
}

export interface RoomCreditMatch {
  id: string | number;
  room_type?: string | null;
  room_type_code?: string | null;
  room_type_id?: string | number | null;
}

export interface RoomCreditBucket {
  room_type_id?: string | number | null;
  room_type_name?: string | null;
  room_type_code?: string | null;
  nights_available?: number | string | null;
}

export interface GuestCreditsLike {
  total_complimentary_credits?: number | string | null;
  credits_by_room_type?: RoomCreditBucket[] | null;
}

export interface RateSource {
  price_per_night?: number | string | null;
  room_rate?: number | string | null;
}

export const getRoomTypeCode = (roomType?: string | null): string => {
  const normalized = roomType?.trim().toLowerCase();
  if (!normalized) return 'N/A';

  const codes: Record<string, string> = {
    deluxe: 'DLXX',
    superior: 'SUP',
    standard: 'STD',
    suite: 'STE',
    'standard queen': 'STDQ',
    'family room': 'FR',
  };

  return codes[normalized] || normalized.slice(0, 4).toUpperCase();
};

export const formatMenuBookingDate = (date: string): string =>
  parseLocalDate(date).toLocaleDateString(intlTag(), { month: 'short', day: 'numeric' });

export const calculateNightCount = (checkInDate?: string, checkOutDate?: string): number => {
  if (!checkInDate || !checkOutDate) return 1;

  const nights = dateSerial(checkOutDate) - dateSerial(checkInDate);
  return Number.isFinite(nights) ? Math.max(1, nights) : 1;
};

export const buildBlockedDateRangesForRoom = <TBooking extends {
  room_id?: string | number | null;
  check_in_date: string;
  check_out_date: string;
  status: string;
}>(
  bookings: TBooking[],
  roomId: string | number,
): BlockedDateRange[] => bookings
  .filter((booking) => (
    booking.room_id?.toString() === roomId.toString()
    && !['checked_out', 'voided'].includes(booking.status)
  ))
  .map((booking) => ({
    start: booking.check_in_date,
    end: booking.check_out_date,
    status: booking.status,
  }));

export const isDateBlockedByRanges = (
  dateString: string,
  blockedRanges: BlockedDateRange[],
): boolean => {
  const target = dateSerial(dateString);

  return blockedRanges.some((range) => {
    const start = dateSerial(range.start);
    const end = dateSerial(range.end);
    return target >= start && target < end;
  });
};

export const getNextAvailableDate = (
  fromDate: string,
  blockedRanges: BlockedDateRange[],
): string => {
  let date = parseLocalDate(fromDate);

  for (let attempts = 0; attempts < 366; attempts += 1) {
    const formatted = formatLocalDate(date);
    if (!isDateBlockedByRanges(formatted, blockedRanges)) return formatted;
    date = addLocalDays(date, 1);
  }

  return formatLocalDate(date);
};

/**
 * Returns a `messageKey` + interpolation `vars` instead of a rendered string so
 * a future caller can feed the result straight into `t()`. No production caller
 * exists yet — today only `roomManagementUtils.test.ts` exercises it; wire it
 * into the complimentary-credit booking flow when that UI lands.
 */
export const validateCreditDateSelection = (
  checkInDate: string,
  checkOutDate: string,
  blockedRanges: BlockedDateRange[],
): { valid: boolean; messageKey: string; vars?: Record<string, unknown> } => {
  if (!checkInDate || !checkOutDate) {
    return { valid: false, messageKey: 'validation.selectDates' };
  }

  if (dateSerial(checkOutDate) <= dateSerial(checkInDate)) {
    return { valid: false, messageKey: 'validation.checkoutAfterCheckin' };
  }

  for (const date of getCreditBookingDates(checkInDate, checkOutDate)) {
    if (isDateBlockedByRanges(date, blockedRanges)) {
      return {
        valid: false,
        messageKey: 'validation.dateReserved',
        vars: { date: parseLocalDate(date).toLocaleDateString(intlTag()) },
      };
    }
  }

  return { valid: true, messageKey: '' };
};

export const getCreditBookingDates = (
  checkInDate: string,
  checkOutDate: string,
): string[] => {
  const dates: string[] = [];
  let current = parseLocalDate(checkInDate);
  const end = dateSerial(checkOutDate);

  while (dateSerial(formatLocalDate(current)) < end) {
    dates.push(formatLocalDate(current));
    current = addLocalDays(current, 1);
  }

  return dates;
};

export const getTotalCreditsForRoom = (
  guestCredits: GuestCreditsLike | null | undefined,
  rooms: RoomCreditMatch[],
  roomId: string | number,
): number => {
  if (!guestCredits || !roomId) return 0;

  const room = rooms.find((candidate) => candidate.id.toString() === roomId.toString());
  if (!room) return 0;

  const roomTypeCredits = getRoomTypeCreditForRoom(guestCredits, room);

  const nights = Number(roomTypeCredits?.nights_available ?? 0);
  return Number.isFinite(nights) ? nights : 0;
};

export const getRoomTypeCreditForRoom = (
  guestCredits: GuestCreditsLike | null | undefined,
  room: RoomCreditMatch | null | undefined,
): RoomCreditBucket | undefined => {
  if (!guestCredits || !room) return undefined;

  return guestCredits.credits_by_room_type?.find((credit) => (
    matchesRoomTypeId(room, credit)
    || matchesRoomTypeCode(room, credit)
    || matchesRoomTypeName(room, credit)
  ));
};

export const canCoverRoomsWithCredits = (
  guestCredits: GuestCreditsLike | null | undefined,
  rooms: RoomCreditMatch[],
  nightsPerRoom: number,
): boolean => {
  if (!guestCredits) return false;

  if (rooms.length === 0) {
    const total = Number(guestCredits.total_complimentary_credits);
    if (Number.isFinite(total)) return total > 0;

    return (guestCredits.credits_by_room_type || []).some((credit) => (
      getCreditNights(credit) > 0
    ));
  }

  const requiredNights = Math.max(1, nightsPerRoom);
  const requirements = new Map<string, { available: number; required: number }>();

  for (const room of rooms) {
    const credit = getRoomTypeCreditForRoom(guestCredits, room);
    const available = getCreditNights(credit);
    if (!credit || available <= 0) return false;

    const key = getCreditBucketKey(credit, room);
    const current = requirements.get(key) || { available, required: 0 };
    current.available = available;
    current.required += requiredNights;
    requirements.set(key, current);
  }

  return Array.from(requirements.values()).every(({ available, required }) => (
    available >= required
  ));
};

export const getPositiveRatePerNight = (source: RateSource | null | undefined): number | null => {
  const value = toMoneyNumber(source?.price_per_night ?? source?.room_rate);
  return isPositiveMoney(value) ? value : null;
};

export const deriveRoomStatusInfo = <
  TBooking extends RoomStatusBooking | undefined,
  TReservedBooking extends RoomStatusBooking | undefined,
>({
  room,
  booking,
  reservedBooking,
  today = new Date(),
  checkInTime = getHotelSetting('check_in_time'),
}: {
  room: RoomStatusRoom;
  booking: TBooking;
  reservedBooking: TReservedBooking;
  today?: Date;
  checkInTime?: string;
}) => {
  const todaySerial = dateSerial(formatLocalDate(today));
  const hasCheckedInBooking = isInHouseBookingStatus(booking?.status);
  // On the arrival day a reservation only "holds" the room once the configured
  // check-in time has passed; before that the room reads as available. Earlier
  // arrival dates (a reservation that should already be in-house) are not gated.
  const reservationCheckInSerial = reservedBooking
    ? dateSerial(reservedBooking.check_in_date)
    : null;
  const isArrivalToday = reservationCheckInSerial === todaySerial;
  const checkInTimeReached =
    !isArrivalToday || today.getHours() * 60 + today.getMinutes() >= timeToMinutes(checkInTime);
  // Any room-holding reservation counts — an unpaid (`pending_payment`) or
  // awaiting-confirmation (`pending_confirmation`) website booking holds the
  // room just like a confirmed one, and the backend already reports it reserved.
  const hasReservationForToday = Boolean(
    reservedBooking
    && isRoomHoldingReservationStatus(reservedBooking.status)
    && reservationCheckInSerial !== null
    && reservationCheckInSerial <= todaySerial
    && checkInTimeReached,
  );
  const hasFutureReservation = Boolean(reservedBooking && !hasReservationForToday);
  const futureCheckInDate = hasFutureReservation && reservedBooking
    ? parseLocalDate(reservedBooking.check_in_date)
    : null;

  const computedStatus = hasCheckedInBooking
    ? 'occupied'
    : ['maintenance', 'dirty', 'reserved_dirty'].includes(room.status || '')
      ? room.status!
      : hasReservationForToday
        ? 'reserved'
        : 'available';

  const isOccupied = computedStatus === 'occupied';
  const isReserved = computedStatus === 'reserved';
  const isReservedToday = isReserved && hasReservationForToday;
  // The hold is real but payment is outstanding or awaiting confirmation. The
  // backend check-in accepts only confirmed/pending, so the card shows the
  // guest and a payment badge but must not offer check-in.
  const isAwaitingPayment = Boolean(
    reservedBooking && isAwaitingPaymentBookingStatus(reservedBooking.status),
  );
  const canCheckInReservation = isReservedToday && !isAwaitingPayment;
  const isComplimentary = (
    (isOccupied && booking?.is_complimentary === true)
    || (isReserved && reservedBooking?.is_complimentary === true)
  );

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
    isAwaitingPayment,
    canCheckInReservation,
    isComplimentary,
  };
};

const dateSerial = (dateString: string): number => {
  const date = parseLocalDate(dateString);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY;
};

const normalizeText = (value?: string | null): string => (
  value?.trim().toLowerCase().replace(/\s+/g, ' ') || ''
);

const normalizeCreditKeyPart = (value?: string | number | null): string => (
  value == null ? '' : String(value).trim().toLowerCase()
);

const getCreditNights = (credit: RoomCreditBucket | undefined): number => {
  const nights = Number(credit?.nights_available ?? 0);
  return Number.isFinite(nights) ? nights : 0;
};

const getCreditBucketKey = (credit: RoomCreditBucket, room: RoomCreditMatch): string => {
  const id = normalizeCreditKeyPart(credit.room_type_id);
  if (id) return `id:${id}`;

  const code = normalizeCreditKeyPart(credit.room_type_code);
  if (code) return `code:${code}`;

  const name = normalizeCreditKeyPart(credit.room_type_name || room.room_type);
  return `name:${name}`;
};

const matchesRoomTypeId = (
  room: RoomCreditMatch,
  credit: RoomCreditBucket,
): boolean => Boolean(
  room.room_type_id
  && credit.room_type_id
  && room.room_type_id.toString() === credit.room_type_id.toString(),
);

const matchesRoomTypeCode = (
  room: RoomCreditMatch,
  credit: RoomCreditBucket,
): boolean => {
  const roomCode = normalizeText(room.room_type_code || getRoomTypeCode(room.room_type));
  const creditCode = normalizeText(credit.room_type_code);

  return Boolean(roomCode && creditCode && roomCode === creditCode);
};

const matchesRoomTypeName = (
  room: RoomCreditMatch,
  credit: RoomCreditBucket,
): boolean => {
  const roomType = normalizeText(room.room_type);
  const creditName = normalizeText(credit.room_type_name);

  return Boolean(
    roomType
    && creditName
    && (roomType.includes(creditName) || creditName.includes(roomType)),
  );
};
