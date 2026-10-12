import { describe, expect, it } from 'vitest';
import {
  getRoomMethodOptions,
  getSettlementLock,
  isRoomMethodAllowed,
  presetRoomMethod,
} from './settlementLock';

const configured = ['Cash', 'Visa Card', 'Bank Transfer', 'Paypal', 'Agoda.com', 'Booking.com', 'Traveloka', 'Expedia.com'];

describe('settlement lock', () => {
  it('leaves walk-in bookings unlocked', () => {
    const lock = getSettlementLock({ source: 'walk_in', booking_channel_name: null, booking_channel_type: null });
    expect(lock.kind).toBe('unlocked');
    expect(getRoomMethodOptions(lock, configured)).toEqual(configured);
    expect(presetRoomMethod(lock, configured, 'Cash')).toBe('Cash');
  });

  it('locks an OTA booking to its channel tender, matching legacy spellings', () => {
    const lock = getSettlementLock({
      source: 'online',
      booking_channel_name: 'Booking.com',
      booking_channel_type: 'ota',
      booking_channel_settlement_methods: ['Booking.com'],
    });
    expect(lock).toEqual({ kind: 'locked', platform: 'Booking.com', allowedMethods: ['Booking.com'] });
    expect(isRoomMethodAllowed(lock, 'Booking.Com')).toBe(true);
    expect(isRoomMethodAllowed(lock, 'booking')).toBe(true);
    expect(isRoomMethodAllowed(lock, 'Cash')).toBe(false);
    expect(isRoomMethodAllowed(lock, 'Agoda.com')).toBe(false);
    expect(getRoomMethodOptions(lock, configured)).toEqual(['Booking.com']);
    expect(presetRoomMethod(lock, configured, 'Cash')).toBe('Booking.com');
  });

  it('locks a walk-in booking tagged with an OTA channel', () => {
    const lock = getSettlementLock({
      source: 'walk_in',
      booking_channel_name: 'Agoda',
      booking_channel_type: 'ota',
      booking_channel_settlement_methods: ['Agoda.com'],
    });
    expect(presetRoomMethod(lock, configured, 'Cash')).toBe('Agoda.com');
  });

  it('offers bank transfer and PayPal for website bookings, in the configured spelling', () => {
    const lock = getSettlementLock({ source: 'website', booking_channel_name: 'Direct Website', booking_channel_type: 'website' });
    expect(getRoomMethodOptions(lock, configured)).toEqual(['Bank Transfer', 'Paypal']);
    expect(isRoomMethodAllowed(lock, 'bank_transfer')).toBe(true);
    expect(isRoomMethodAllowed(lock, 'Cash')).toBe(false);
  });

  it('matches a platform domain spelling to its plain name', () => {
    const lock = getSettlementLock({
      source: 'online',
      booking_channel_name: 'Traveloka',
      booking_channel_type: 'ota',
      booking_channel_settlement_methods: ['Traveloka'],
    });
    expect(isRoomMethodAllowed(lock, 'Traveloka.Com')).toBe(true);
  });

  it('refuses an online booking without a channel', () => {
    const lock = getSettlementLock({ source: 'online', booking_channel_name: null, booking_channel_type: null });
    expect(lock.kind).toBe('missing_channel');
    expect(getRoomMethodOptions(lock, configured)).toEqual([]);
    expect(isRoomMethodAllowed(lock, 'Booking.com')).toBe(false);
  });

  it('refuses an OTA channel with no configured tender', () => {
    const lock = getSettlementLock({ source: 'online', booking_channel_name: 'Airbnb', booking_channel_type: 'ota' });
    expect(lock).toEqual({ kind: 'unconfigured', platform: 'Airbnb' });
  });
});
