export type BookingType = 'direct' | 'walk_in' | 'online' | 'complimentary';
export type BookingMode = 'direct' | 'reservation';

/** Reservation sub-type selected when bookingMode === 'reservation'. */
export type ReservationType = 'walk_in' | 'online' | 'complimentary';

/** Booking type as resolved for submission (direct collapses to walk_in). */
export type EffectiveBookingType = ReservationType | null;
