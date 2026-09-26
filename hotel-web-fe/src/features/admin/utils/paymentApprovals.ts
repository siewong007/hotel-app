import type { PendingPaymentEntry } from '../../../types';

/**
 * Booking statuses in which staff may still reject a pending payment claim.
 * Mirrors `STAFF_REJECTABLE_BOOKING_STATUSES` in
 * `hotel-app-be/src/modules/payments/service.rs`: once staff have moved the
 * booking on by hand (confirmed, checked in, ...) the backend refuses the
 * rejection, so the queue disables the button instead of offering it.
 */
export const REJECTABLE_CLAIM_BOOKING_STATUSES = [
  'pending',
  'pending_payment',
  'pending_confirmation',
] as const;

/**
 * Whether a claim on a booking in `bookingStatus` can still be rejected. An
 * unknown status (an older backend that does not send it) keeps the button
 * available; the server stays the authority either way.
 */
export const canRejectPaymentClaim = (bookingStatus?: string | null): boolean =>
  !bookingStatus
  || (REJECTABLE_CLAIM_BOOKING_STATUSES as readonly string[]).includes(bookingStatus);

/** Whether the guest has uploaded proof of payment for this claim. */
export const hasPaymentReceipt = (
  entry: Pick<PendingPaymentEntry, 'receipt_uploaded' | 'receipt_file_available'>,
): boolean => entry.receipt_uploaded || entry.receipt_file_available;
