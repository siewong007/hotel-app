import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLocalDays,
  formatHotelDate,
  formatHotelDateTime,
  formatLocalDate,
  isHotelDatePast,
  parseLocalDate,
  toHotelDateString,
} from './date';

describe('date utilities', () => {
  it('formats dates to YYYY-MM-DD string', () => {
    expect(formatLocalDate(new Date(2026, 5, 15))).toBe('2026-06-15');
    expect(formatLocalDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('parses date strings', () => {
    const d = parseLocalDate('2026-06-15');
    expect(d).toBeDefined();
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
  });

  it('adds days to a date', () => {
    const result = addLocalDays(new Date(2026, 5, 15), 3);
    expect(result.getDate()).toBe(18);
    expect(result.getMonth()).toBe(5);
  });

  it('adds days from a string date', () => {
    const result = addLocalDays('2026-06-15', 3);
    expect(result.getDate()).toBe(18);
    expect(result.getMonth()).toBe(5);
  });

  it('handles month overflow when adding days', () => {
    const result = addLocalDays(new Date(2026, 5, 29), 5);
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(4);
  });

  it('handles negative day addition', () => {
    const result = addLocalDays(new Date(2026, 5, 15), -3);
    expect(result.getDate()).toBe(12);
    expect(result.getMonth()).toBe(5);
  });

  it('formats current date when no argument provided', () => {
    const result = formatLocalDate();
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});

// These assertions are viewer-timezone independent by design: they must pass
// identically under any TZ env (e.g. TZ=UTC, TZ=America/New_York), because the
// helpers anchor to the hotel timezone (default Asia/Kuala_Lumpur, +08).
describe('hotel-timezone business dates', () => {
  const createLocalStorageStub = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    };
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageStub());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Z-suffixed instants in the hotel timezone, not the viewer zone', () => {
    // 16:00Z is exactly midnight +08 of the NEXT day — the boundary itself.
    expect(toHotelDateString('2026-07-25T16:00:00Z')).toBe('2026-07-26');
    // Hotel-local 00:00–07:59 window, where the UTC calendar date is a day behind.
    expect(toHotelDateString('2026-07-25T23:59:00Z')).toBe('2026-07-26');
    // Backend stores business dates as hotel-local noon (04:00Z).
    expect(toHotelDateString('2026-07-26T04:00:00Z')).toBe('2026-07-26');
    expect(toHotelDateString('2026-07-26T15:59:59Z')).toBe('2026-07-26');
    expect(toHotelDateString('2026-07-26T16:00:00Z')).toBe('2026-07-27');
  });

  it('passes date-only values through and keeps zone-less wall times literal', () => {
    expect(toHotelDateString('2026-07-26')).toBe('2026-07-26');
    expect(toHotelDateString('2026-07-26T00:30:00')).toBe('2026-07-26');
    expect(toHotelDateString('2026-07-26 00:30:00')).toBe('2026-07-26');
    expect(toHotelDateString('')).toBe('');
    expect(toHotelDateString(null)).toBe('');
    expect(toHotelDateString(undefined)).toBe('');
    expect(toHotelDateString('garbage')).toBe('');
  });

  it('handles explicit offsets and Date instances', () => {
    expect(toHotelDateString('2026-07-26T00:30:00+08:00')).toBe('2026-07-26');
    expect(toHotelDateString('2026-07-25T20:30:00-04:00')).toBe('2026-07-26');
    expect(toHotelDateString(new Date('2026-07-25T16:00:00Z'))).toBe('2026-07-26');
  });

  it('formats display dates from instants in the hotel timezone', () => {
    expect(formatHotelDate('2026-07-25T16:00:00Z')).toBe('Jul 26, 2026');
    expect(formatHotelDate('2026-07-26')).toBe('Jul 26, 2026');
    expect(formatHotelDate(null)).toBe('-');
    expect(formatHotelDate('garbage')).toBe('-');
  });

  it('renders date-times of zoned instants in the hotel timezone', () => {
    // 16:30Z = 00:30 on the 26th in +08; a viewer-zone render outside +08
    // would show the 25th.
    expect(formatHotelDateTime('2026-07-25T16:30:00Z')).toContain('26');
    expect(formatHotelDateTime(null)).toBe('-');
    expect(formatHotelDateTime('garbage')).toBe('-');
  });

  it('marks dates past only after the hotel calendar moves beyond them', () => {
    expect(isHotelDatePast('2000-01-01')).toBe(true);
    expect(isHotelDatePast('2999-12-31')).toBe(false);
    // "Today" (hotel calendar) is due, not overdue.
    expect(isHotelDatePast(toHotelDateString(new Date()))).toBe(false);
    expect(isHotelDatePast(new Date())).toBe(false);
    expect(isHotelDatePast('')).toBe(false);
    expect(isHotelDatePast(null)).toBe(false);
  });

  it('honours the hotel timezone configured in settings', () => {
    localStorage.setItem('hotelSettings', JSON.stringify({ timezone: 'America/New_York' }));
    // 02:00Z on the 26th is 22:00 on the 25th in New York (EDT, -04).
    expect(toHotelDateString('2026-07-26T02:00:00Z')).toBe('2026-07-25');
  });

  it('falls back to Asia/Kuala_Lumpur when settings hold an invalid zone', () => {
    localStorage.setItem('hotelSettings', JSON.stringify({ timezone: 'Not/AZone' }));
    expect(toHotelDateString('2026-07-25T16:00:00Z')).toBe('2026-07-26');
  });
});
