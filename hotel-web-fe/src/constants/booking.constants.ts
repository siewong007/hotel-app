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
