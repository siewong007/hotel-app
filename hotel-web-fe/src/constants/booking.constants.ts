export const BookingStatus = {
  PENDING: 'pending',
  PENDING_PAYMENT: 'pending_payment',
  PENDING_CONFIRMATION: 'pending_confirmation',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out',
  AUTO_CHECKED_IN: 'auto_checked_in',
  PARTIAL_COMPLIMENTARY: 'partial_complimentary',
  FULLY_COMPLIMENTARY: 'fully_complimentary',
  VOIDED: 'voided',
} as const;

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/**
 * Reservation statuses that hold a room for a future or arriving stay.
 *
 * `pending_payment` (an unpaid website booking) and `pending_confirmation`
 * (payment submitted, e.g. a bank transfer awaiting staff confirmation) hold
 * the room exactly like `pending`/`confirmed`: the backend allocates the room,
 * marks it reserved, and refuses conflicting bookings. The room grid must show
 * them, or a held room reads as free. Voided bookings never hold a room.
 *
 * Mirrors the backend's room-hold lists (`rooms/queries.rs`,
 * `bookings/summary.rs`).
 */
export const ROOM_HOLDING_RESERVATION_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.PENDING_CONFIRMATION,
  BookingStatus.CONFIRMED,
] as const;

/** Statuses of a guest who is in the room right now. */
export const IN_HOUSE_BOOKING_STATUSES = [
  BookingStatus.CHECKED_IN,
  BookingStatus.AUTO_CHECKED_IN,
] as const;

/**
 * Room-holding reservations that cannot be checked in yet because payment is
 * still outstanding or awaiting confirmation. The backend check-in accepts
 * only `confirmed`/`pending`, so the UI must not offer check-in for these.
 */
export const AWAITING_PAYMENT_BOOKING_STATUSES = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.PENDING_CONFIRMATION,
] as const;

const includesStatus = (list: readonly string[], status?: string | null): boolean =>
  typeof status === 'string' && list.includes(status);

export const isRoomHoldingReservationStatus = (status?: string | null): boolean =>
  includesStatus(ROOM_HOLDING_RESERVATION_STATUSES, status);

export const isInHouseBookingStatus = (status?: string | null): boolean =>
  includesStatus(IN_HOUSE_BOOKING_STATUSES, status);

export const isAwaitingPaymentBookingStatus = (status?: string | null): boolean =>
  includesStatus(AWAITING_PAYMENT_BOOKING_STATUSES, status);
