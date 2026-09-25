import { describe, expect, it } from 'vitest';

import {
  AWAITING_PAYMENT_BOOKING_STATUSES,
  IN_HOUSE_BOOKING_STATUSES,
  ROOM_HOLDING_RESERVATION_STATUSES,
  isAwaitingPaymentBookingStatus,
  isInHouseBookingStatus,
  isRoomHoldingReservationStatus,
} from './booking.constants';

describe('room-holding booking statuses', () => {
  it('counts unpaid and awaiting-confirmation reservations as holding a room', () => {
    expect([...ROOM_HOLDING_RESERVATION_STATUSES].sort()).toEqual(
      ['confirmed', 'pending', 'pending_confirmation', 'pending_payment'],
    );
    for (const status of ['pending', 'pending_payment', 'pending_confirmation', 'confirmed']) {
      expect(isRoomHoldingReservationStatus(status)).toBe(true);
    }
  });

  it('never counts voided, finished or in-house stays as a reservation hold', () => {
    for (const status of ['voided', 'checked_out', 'completed', 'no_show', 'checked_in', 'auto_checked_in', '']) {
      expect(isRoomHoldingReservationStatus(status)).toBe(false);
    }
    expect(isRoomHoldingReservationStatus(undefined)).toBe(false);
    expect(isRoomHoldingReservationStatus(null)).toBe(false);
  });

  it('identifies in-house stays', () => {
    expect([...IN_HOUSE_BOOKING_STATUSES].sort()).toEqual(['auto_checked_in', 'checked_in']);
    expect(isInHouseBookingStatus('checked_in')).toBe(true);
    expect(isInHouseBookingStatus('auto_checked_in')).toBe(true);
    expect(isInHouseBookingStatus('confirmed')).toBe(false);
    expect(isInHouseBookingStatus(undefined)).toBe(false);
  });

  it('marks only payment-outstanding holds as awaiting payment', () => {
    expect([...AWAITING_PAYMENT_BOOKING_STATUSES].sort()).toEqual(['pending_confirmation', 'pending_payment']);
    expect(isAwaitingPaymentBookingStatus('pending_payment')).toBe(true);
    expect(isAwaitingPaymentBookingStatus('pending_confirmation')).toBe(true);
    // `pending` is check-in-able server-side; it is not an awaiting-payment hold.
    expect(isAwaitingPaymentBookingStatus('pending')).toBe(false);
    expect(isAwaitingPaymentBookingStatus('confirmed')).toBe(false);
  });
});
