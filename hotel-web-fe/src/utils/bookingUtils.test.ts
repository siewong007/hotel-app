import { describe, expect, it } from 'vitest';
import { BookingStatus } from '../constants/booking.constants';
import type { Booking, BookingWithDetails } from '../types';
import {
  calculateNights,
  calculateTotalAmount,
  canModifyBooking,
  canVoidBooking,
  enhanceBookingDetails,
  filterActiveBookings,
  filterUpcomingBookings,
  formatCurrency,
  formatDateForDisplay,
  getBookingStatistics,
  getBookingStatusColor,
  getBookingStatusText,
  getPaymentStatusColor,
  getPaymentStatusText,
  isBookingActive,
  sortBookingsByDate,
  validateBookingDates,
  validateBookingRequest,
} from './bookingUtils';

function buildBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: '1',
    guest_id: 'g1',
    room_id: 'r1',
    check_in_date: '2026-08-01',
    check_out_date: '2026-08-03',
    total_amount: 200,
    status: BookingStatus.CONFIRMED,
    ...overrides,
  };
}

function buildBookingWithDetails(overrides: Partial<BookingWithDetails> = {}): BookingWithDetails {
  return {
    ...buildBooking(),
    booking_number: 'BK-1',
    guest_name: 'Jane Doe',
    guest_email: 'jane@example.com',
    room_number: '101',
    room_type: 'Deluxe',
    price_per_night: 100,
    ...overrides,
  };
}

describe('validateBookingDates', () => {
  it('accepts a normal date range', () => {
    expect(validateBookingDates('2026-08-01', '2026-08-03')).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it('flags invalid check-in and check-out dates', () => {
    const result = validateBookingDates('not-a-date', 'also-not-a-date');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Check-in date is invalid');
    expect(result.errors).toContain('Check-out date is invalid');
  });

  it('flags check-out before check-in', () => {
    const result = validateBookingDates('2026-08-05', '2026-08-01');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Check-out date must be on or after check-in date');
  });

  it('allows a same-day stay (hourly bookings)', () => {
    const result = validateBookingDates('2026-08-01', '2026-08-01');
    expect(result.isValid).toBe(true);
  });

  it('flags a stay longer than 30 days', () => {
    const result = validateBookingDates('2026-08-01', '2026-10-01');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Maximum stay duration is 30 days');
  });

  it('allows a backdated check-in (administrative bookings)', () => {
    const result = validateBookingDates('2000-01-01', '2000-01-03');
    expect(result.isValid).toBe(true);
  });
});

describe('validateBookingRequest', () => {
  const baseRequest = {
    guest_id: 1,
    room_id: 'r1',
    check_in_date: '2026-08-01',
    check_out_date: '2026-08-03',
  };

  it('accepts a well-formed request', () => {
    expect(validateBookingRequest(baseRequest as any)).toEqual({ isValid: true, errors: [] });
  });

  it('requires a numeric guest_id', () => {
    const result = validateBookingRequest({ ...baseRequest, guest_id: undefined } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Guest ID is required and must be a number');
  });

  it('requires a non-blank room_id', () => {
    const result = validateBookingRequest({ ...baseRequest, room_id: '   ' } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Room ID is required');
  });

  it('rejects a number_of_guests outside 1-10', () => {
    const tooMany = validateBookingRequest({ ...baseRequest, number_of_guests: 11 } as any);
    expect(tooMany.errors).toContain('Number of guests must be between 1 and 10');

    const tooFew = validateBookingRequest({ ...baseRequest, number_of_guests: 0 } as any);
    expect(tooFew.errors).toContain('Number of guests must be between 1 and 10');
  });

  it('rejects special_requests over 500 characters', () => {
    const result = validateBookingRequest({
      ...baseRequest,
      special_requests: 'x'.repeat(501),
    } as any);
    expect(result.errors).toContain('Special requests cannot exceed 500 characters');
  });

  it('aggregates date-validation errors from validateBookingDates', () => {
    const result = validateBookingRequest({
      ...baseRequest,
      check_out_date: '2026-07-01',
    } as any);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Check-out date must be on or after check-in date');
  });
});

describe('calculateNights / calculateTotalAmount', () => {
  it('calculates the number of nights between two dates', () => {
    expect(calculateNights('2026-08-01', '2026-08-04')).toBe(3);
  });

  it('calculates total amount as price per night times nights', () => {
    expect(calculateTotalAmount(100, '2026-08-01', '2026-08-04')).toBe(300);
  });
});

describe('formatDateForDisplay / formatCurrency', () => {
  it('formats a date string for display', () => {
    const formatted = formatDateForDisplay('2026-08-01T00:00:00Z');
    expect(formatted).toMatch(/2026/);
  });

  it('formats a numeric amount as USD currency', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formats a string amount as USD currency', () => {
    expect(formatCurrency('99.9')).toBe('$99.90');
  });
});

describe('getBookingStatusColor / getBookingStatusText', () => {
  it.each([
    [BookingStatus.CONFIRMED, 'success', 'Confirmed'],
    [BookingStatus.PENDING, 'warning', 'Pending'],
    [BookingStatus.CHECKED_IN, 'primary', 'Checked In'],
    [BookingStatus.AUTO_CHECKED_IN, 'primary', 'Auto Checked In'],
    [BookingStatus.CHECKED_OUT, 'info', 'Checked Out'],
    [BookingStatus.PARTIAL_COMPLIMENTARY, 'secondary', 'Partial Complimentary'],
    [BookingStatus.FULLY_COMPLIMENTARY, 'secondary', 'Fully Complimentary'],
    [BookingStatus.VOIDED, 'default', 'Voided'],
  ])('maps %s to color %s and text %s', (status, color, text) => {
    expect(getBookingStatusColor(status)).toBe(color);
    expect(getBookingStatusText(status)).toBe(text);
  });

  it('falls back to default color and the raw string for an unknown status', () => {
    expect(getBookingStatusColor('mystery_status')).toBe('default');
    expect(getBookingStatusText('mystery_status')).toBe('mystery_status');
  });
});

describe('getPaymentStatusColor / getPaymentStatusText', () => {
  it.each([
    ['paid', 'success', 'Paid'],
    ['paid_rate', 'info', 'Rate Paid'],
    ['partial', 'warning', 'Partial'],
    ['unpaid_deposit', 'warning', 'Unpaid Deposit'],
    ['unpaid', 'error', 'Unpaid'],
    ['refunded', 'secondary', 'Refunded'],
    ['void', 'error', 'Void'],
  ])('maps %s to color %s and text %s', (status, color, text) => {
    expect(getPaymentStatusColor(status)).toBe(color);
    expect(getPaymentStatusText(status)).toBe(text);
  });

  it('falls back to default color and "Unknown" text when status is undefined', () => {
    expect(getPaymentStatusColor(undefined)).toBe('default');
    expect(getPaymentStatusText(undefined)).toBe('Unknown');
  });
});

describe('canVoidBooking / canModifyBooking / isBookingActive', () => {
  it('allows voiding confirmed, pending, or checked-in bookings', () => {
    expect(canVoidBooking(buildBooking({ status: BookingStatus.CONFIRMED }))).toBe(true);
    expect(canVoidBooking(buildBooking({ status: BookingStatus.PENDING }))).toBe(true);
    expect(canVoidBooking(buildBooking({ status: BookingStatus.CHECKED_IN }))).toBe(true);
  });

  it('does not allow voiding a checked-out or voided booking', () => {
    expect(canVoidBooking(buildBooking({ status: BookingStatus.CHECKED_OUT }))).toBe(false);
    expect(canVoidBooking(buildBooking({ status: BookingStatus.VOIDED }))).toBe(false);
  });

  it('allows modifying a confirmed booking more than 48 hours before check-in', () => {
    const farFuture = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    expect(
      canModifyBooking(buildBooking({ status: BookingStatus.CONFIRMED, check_in_date: farFuture }))
    ).toBe(true);
  });

  it('does not allow modifying within 48 hours of check-in', () => {
    const soon = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    expect(
      canModifyBooking(buildBooking({ status: BookingStatus.CONFIRMED, check_in_date: soon }))
    ).toBe(false);
  });

  it('does not allow modifying a checked-in booking regardless of timing', () => {
    const farFuture = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    expect(
      canModifyBooking(buildBooking({ status: BookingStatus.CHECKED_IN, check_in_date: farFuture }))
    ).toBe(false);
  });

  it('treats only checked-in bookings as active', () => {
    expect(isBookingActive(buildBooking({ status: BookingStatus.CHECKED_IN }))).toBe(true);
    expect(isBookingActive(buildBooking({ status: BookingStatus.CONFIRMED }))).toBe(false);
  });
});

describe('enhanceBookingDetails', () => {
  it('computes nights, formatted fields, and action flags', () => {
    const booking = buildBookingWithDetails({
      check_in_date: '2026-08-01',
      check_out_date: '2026-08-04',
      total_amount: 300,
      status: BookingStatus.CHECKED_IN,
    });

    const enhanced = enhanceBookingDetails(booking);

    expect(enhanced.number_of_nights).toBe(3);
    expect(enhanced.formatted_total).toBe('$300.00');
    expect(enhanced.is_active).toBe(true);
    expect(enhanced.can_void).toBe(true);
    expect(enhanced.can_modify).toBe(false); // checked_in bookings cannot be modified
  });
});

describe('sortBookingsByDate / filterActiveBookings / filterUpcomingBookings', () => {
  it('sorts bookings by check-in date, newest first', () => {
    const bookings = [
      buildBookingWithDetails({ id: '1', check_in_date: '2026-08-01' }),
      buildBookingWithDetails({ id: '2', check_in_date: '2026-09-01' }),
      buildBookingWithDetails({ id: '3', check_in_date: '2026-07-01' }),
    ];

    expect(sortBookingsByDate(bookings).map((b) => b.id)).toEqual(['2', '1', '3']);
  });

  it('does not mutate the original array', () => {
    const bookings = [
      buildBookingWithDetails({ id: '1', check_in_date: '2026-08-01' }),
      buildBookingWithDetails({ id: '2', check_in_date: '2026-09-01' }),
    ];
    const original = [...bookings];
    sortBookingsByDate(bookings);
    expect(bookings).toEqual(original);
  });

  it('filters only checked-in bookings as active', () => {
    const bookings = [
      buildBookingWithDetails({ id: '1', status: BookingStatus.CHECKED_IN }),
      buildBookingWithDetails({ id: '2', status: BookingStatus.CONFIRMED }),
    ];
    expect(filterActiveBookings(bookings).map((b) => b.id)).toEqual(['1']);
  });

  it('filters upcoming (future, confirmed/pending) bookings', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const bookings = [
      buildBookingWithDetails({ id: '1', check_in_date: future, status: BookingStatus.CONFIRMED }),
      buildBookingWithDetails({ id: '2', check_in_date: past, status: BookingStatus.CONFIRMED }),
      buildBookingWithDetails({ id: '3', check_in_date: future, status: BookingStatus.CHECKED_OUT }),
    ];
    expect(filterUpcomingBookings(bookings).map((b) => b.id)).toEqual(['1']);
  });
});

describe('getBookingStatistics', () => {
  it('aggregates totals, active/upcoming/completed counts, and revenue excluding voided bookings', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const bookings = [
      buildBookingWithDetails({ id: '1', status: BookingStatus.CHECKED_IN, total_amount: 100 }),
      buildBookingWithDetails({
        id: '2',
        status: BookingStatus.CONFIRMED,
        check_in_date: future,
        total_amount: 150,
      }),
      buildBookingWithDetails({ id: '3', status: BookingStatus.CHECKED_OUT, total_amount: 200 }),
      buildBookingWithDetails({ id: '4', status: BookingStatus.VOIDED, total_amount: 999 }),
    ];

    const stats = getBookingStatistics(bookings);

    expect(stats.total).toBe(4);
    expect(stats.active).toBe(1);
    expect(stats.upcoming).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.totalRevenue).toBe(450); // excludes the voided booking's 999
  });
});
