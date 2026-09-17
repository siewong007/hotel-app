import { describe, expect, it } from 'vitest';
import type { BookingWithDetails } from '../../../types';
import { getBookingChannelInfo } from './bookingChannel';

const booking = (overrides: Partial<BookingWithDetails>): BookingWithDetails =>
  ({ id: '0', status: 'confirmed', source: 'online', ...overrides }) as BookingWithDetails;

describe('getBookingChannelInfo — structured link', () => {
  it('reports the linked channel even when the remarks still name a different one', () => {
    // The case this precedence exists for: a booking recorded against the
    // wrong OTA, corrected by repointing the link. Remarks-only resolution
    // returned 'Booking.com' here because it matches the first configured
    // channel found anywhere in the text.
    const info = getBookingChannelInfo(booking({
      booking_channel_name: 'Traveloka',
      booking_channel_type: 'ota',
      booking_remarks: 'Booking.com - Ref: 5403494822',
      remarks: 'moved to Traveloka',
    }));

    expect(info?.name).toBe('Traveloka');
  });

  it('carries the configured abbreviation for a linked channel', () => {
    const info = getBookingChannelInfo(booking({
      booking_channel_name: 'Booking.com',
      booking_channel_type: 'ota',
    }));

    expect(info?.name).toBe('Booking.com');
    expect(info?.abbreviation).toBe('B.C');
  });

  it('shows no channel badge when the link points at a direct-sale channel', () => {
    expect(getBookingChannelInfo(booking({
      source: 'walk_in',
      booking_channel_name: 'Walk-in',
      booking_channel_type: 'walk_in',
    }))).toBeNull();
  });
});

describe('getBookingChannelInfo — remarks fallback', () => {
  it('still resolves bookings written before the link existed', () => {
    const info = getBookingChannelInfo(booking({
      booking_remarks: 'Traveloka - Ref: 20261123946075 | DEP50',
    }));

    expect(info?.name).toBe('Traveloka');
  });

  it('returns null for a booking with no online signal at all', () => {
    expect(getBookingChannelInfo(booking({
      source: 'walk_in',
      booking_remarks: 'Company Billing: Trienekens Sarawak Sdn Bhd',
    }))).toBeNull();
  });
});
