import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from './reviewQueue';

describe('formatCalendarDate', () => {
  it('renders a date-only value on the calendar day the backend sent', () => {
    // The load-bearing case. `new Date('2026-01-01')` is UTC midnight, which
    // renders as 31 Dec 2025 anywhere west of Greenwich — so on a CI runner or
    // a reviewer's laptop in the Americas the naive implementation shows every
    // arrival a day early. Passing in this repo's own timezone (UTC+8) does not
    // by itself prove the guard; it fails loudly where the bug would appear.
    expect(formatCalendarDate('2026-01-01')).toBe('Jan 01, 2026');
    expect(formatCalendarDate('2026-12-31')).toBe('Dec 31, 2026');
  });

  it('shows a dash when the applicant has no upcoming stay', () => {
    expect(formatCalendarDate(null)).toBe('-');
    expect(formatCalendarDate(undefined)).toBe('-');
    expect(formatCalendarDate('')).toBe('-');
  });

  it('returns anything unparseable verbatim rather than inventing a date', () => {
    // A silently wrong date in a review queue is worse than an obviously odd
    // one: staff would work the wrong applicant first and never know.
    expect(formatCalendarDate('not-a-date')).toBe('not-a-date');
    expect(formatCalendarDate('2026-13')).toBe('2026-13');
  });
});
