import { describe, expect, it } from 'vitest';
import type { BookingWithDetails } from '../../../../types';
import { filterAndSortBookings, getStatusColor, getStatusLabel } from './utils';

const booking = (overrides: Partial<BookingWithDetails>): BookingWithDetails =>
  ({ id: '0', ...overrides }) as BookingWithDetails;

describe('complimentary status helpers', () => {
  it('maps statuses to chip colors', () => {
    expect(getStatusColor('fully_complimentary')).toBe('success');
    expect(getStatusColor('partial_complimentary')).toBe('warning');
    expect(getStatusColor('voided')).toBe('info');
    expect(getStatusColor('anything_else')).toBe('default');
  });

  it('maps statuses to labels, humanizing any unmapped status', () => {
    expect(getStatusLabel('fully_complimentary')).toBe('Fully Complimentary');
    expect(getStatusLabel('partial_complimentary')).toBe('Partial');
    expect(getStatusLabel('voided')).toBe('Voided');
    expect(getStatusLabel('confirmed')).toBe('Confirmed');
  });
});

describe('filterAndSortBookings', () => {
  const bookings = [
    booking({ id: '1', guest_name: 'Alice Tan', booking_number: 'BK-100', room_number: '101', complimentary_nights: 2, status: 'fully_complimentary', created_at: '2026-01-03T00:00:00Z' }),
    booking({ id: '2', guest_name: 'Bob Lee', booking_number: 'BK-200', room_number: '202', complimentary_nights: 5, status: 'partial_complimentary', created_at: '2026-01-01T00:00:00Z' }),
    booking({ id: '3', guest_name: 'Carol Ng', booking_number: 'BK-300', room_number: '303', complimentary_nights: 1, status: 'voided', created_at: '2026-01-02T00:00:00Z' }),
  ];

  it('returns all bookings when the query is empty', () => {
    expect(filterAndSortBookings(bookings, '', 'created_at', 'desc')).toHaveLength(3);
  });

  it('matches the search query against guest, booking number, and room', () => {
    expect(filterAndSortBookings(bookings, 'alice', 'created_at', 'desc').map((b) => b.id)).toEqual(['1']);
    expect(filterAndSortBookings(bookings, 'bk-200', 'created_at', 'desc').map((b) => b.id)).toEqual(['2']);
    expect(filterAndSortBookings(bookings, '303', 'created_at', 'desc').map((b) => b.id)).toEqual(['3']);
    expect(filterAndSortBookings(bookings, 'nobody', 'created_at', 'desc')).toHaveLength(0);
  });

  it('sorts by created_at descending by default', () => {
    expect(filterAndSortBookings(bookings, '', 'created_at', 'desc').map((b) => b.id)).toEqual(['1', '3', '2']);
  });

  it('sorts numeric and text fields in both directions', () => {
    expect(filterAndSortBookings(bookings, '', 'complimentary_nights', 'asc').map((b) => b.id)).toEqual(['3', '1', '2']);
    expect(filterAndSortBookings(bookings, '', 'guest_name', 'desc').map((b) => b.id)).toEqual(['3', '2', '1']);
  });
});
