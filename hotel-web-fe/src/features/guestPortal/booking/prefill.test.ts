import { describe, expect, it } from 'vitest';

import type { GuestBookingOffer } from './types';
import { findPrefilledOffer, isCalendarDate, parseBookingPrefill } from './prefill';

// Local noon on a fixed day so the "today" rules are deterministic.
const today = new Date(2026, 9, 23, 12);
const valid = 'view=booking&check_in_date=2026-11-06&check_out_date=2026-11-08&adults=2&children=1&room_type=DLX';

describe('parseBookingPrefill', () => {
  it('parses a full landing handoff', () => {
    expect(parseBookingPrefill(valid, today)).toEqual({
      search: { check_in_date: '2026-11-06', check_out_date: '2026-11-08', adults: 2, children: 1 },
      roomTypeCode: 'DLX',
    });
  });

  it('accepts URLSearchParams and a leading "?"', () => {
    expect(parseBookingPrefill(new URLSearchParams(valid), today)?.search.adults).toBe(2);
    expect(parseBookingPrefill(`?${valid}`, today)?.roomTypeCode).toBe('DLX');
  });

  it('defaults children to 0 and upper-cases the room code', () => {
    const result = parseBookingPrefill('check_in_date=2026-10-23&check_out_date=2026-10-24&adults=1&room_type=stdq', today);
    expect(result?.search.children).toBe(0);
    expect(result?.roomTypeCode).toBe('STDQ');
  });

  it('keeps the stay but drops an unusable room code', () => {
    expect(parseBookingPrefill(valid.replace('DLX', '<script>'), today)?.roomTypeCode).toBeNull();
    expect(parseBookingPrefill(valid.replace('&room_type=DLX', ''), today)?.roomTypeCode).toBeNull();
  });

  it.each([
    ['no params', ''],
    ['the plain booking view', 'view=booking'],
    ['a missing check-out', 'check_in_date=2026-11-06&adults=2'],
    ['a missing adults count', 'check_in_date=2026-11-06&check_out_date=2026-11-08'],
    ['a malformed date', valid.replace('2026-11-06', '6/11/2026')],
    ['an impossible date', valid.replace('2026-11-06', '2026-02-30')],
    ['a past check-in', valid.replace('2026-11-06', '2026-10-22')],
    ['check-out before check-in', valid.replace('2026-11-08', '2026-11-05')],
    ['a zero-night stay', valid.replace('2026-11-08', '2026-11-06')],
    ['a stay over 30 nights', valid.replace('2026-11-08', '2026-12-07')],
    ['a check-in beyond the 3-month horizon', 'check_in_date=2027-02-01&check_out_date=2027-02-02&adults=2'],
    ['zero adults', valid.replace('adults=2', 'adults=0')],
    ['too many adults', valid.replace('adults=2', 'adults=21')],
    ['fractional adults', valid.replace('adults=2', 'adults=1.5')],
    ['negative children', valid.replace('children=1', 'children=-1')],
    ['non-numeric children', valid.replace('children=1', 'children=two')],
    ['too many children', valid.replace('children=1', 'children=21')],
  ])('falls back to Search for %s', (_label, query) => {
    expect(parseBookingPrefill(query, today)).toBeNull();
  });
});

describe('isCalendarDate', () => {
  it('accepts real days only', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
  });
});

describe('findPrefilledOffer', () => {
  const offers = [
    { room_type_id: 1, room_type_code: 'STDQ' },
    { room_type_id: 2, room_type_code: 'dlx' },
  ] as GuestBookingOffer[];

  it('matches the room code case-insensitively', () => {
    expect(findPrefilledOffer(offers, 'DLX')?.room_type_id).toBe(2);
  });

  it('returns null without a code or a match', () => {
    expect(findPrefilledOffer(offers, null)).toBeNull();
    expect(findPrefilledOffer(offers, 'FS')).toBeNull();
  });
});
