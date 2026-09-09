import { afterEach, describe, expect, it } from 'vitest';
import { clearFormatterCachesForTests, formatNumber, formatPercent, formatRelativeTime, intlTag } from './format';
import { resetLocaleStoreForTests, setActiveLocale } from './localeStore';
import { LOCALES } from './locales';

afterEach(() => {
  resetLocaleStoreForTests();
  clearFormatterCachesForTests();
});

describe('intlTag', () => {
  it('resolves the tag for the active locale', () => {
    setActiveLocale('ms');
    expect(intlTag()).toBe(LOCALES.ms.intlTag);
  });

  it('resolves the tag for an explicit locale', () => {
    expect(intlTag('en')).toBe(LOCALES.en.intlTag);
  });
});

describe('formatNumber', () => {
  it('groups digits for the locale', () => {
    expect(formatNumber(1234567.5, undefined, 'en')).toBe('1,234,567.5');
  });

  it('honours Intl options', () => {
    expect(formatNumber(3.14159, { maximumFractionDigits: 2 }, 'en')).toBe('3.14');
  });

  it('renders nothing for values that are not finite numbers', () => {
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(undefined)).toBe('');
    expect(formatNumber(NaN)).toBe('');
    expect(formatNumber(Infinity)).toBe('');
  });

  it('reuses one memoised formatter per locale and option set', () => {
    expect(formatNumber(1000, undefined, 'en')).toBe(formatNumber(1000, undefined, 'en'));
  });
});

describe('formatPercent', () => {
  it('renders a ratio as a percentage', () => {
    expect(formatPercent(0.125, 1, 'en')).toBe('12.5%');
    expect(formatPercent(1, 0, 'en')).toBe('100%');
  });

  it('renders nothing for a missing ratio', () => {
    expect(formatPercent(null)).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-09T12:00:00Z');

  it('describes the past and the future', () => {
    expect(formatRelativeTime(new Date('2026-09-09T10:00:00Z'), 'en', now)).toBe('2 hours ago');
    expect(formatRelativeTime(new Date('2026-09-12T12:00:00Z'), 'en', now)).toBe('in 3 days');
  });

  it('picks the largest unit that fits', () => {
    expect(formatRelativeTime(new Date('2025-09-09T12:00:00Z'), 'en', now)).toContain('year');
    expect(formatRelativeTime(new Date('2026-09-09T11:59:30Z'), 'en', now)).toContain('second');
  });

  it('accepts strings and epoch millis', () => {
    expect(formatRelativeTime('2026-09-09T10:00:00Z', 'en', now)).toBe('2 hours ago');
    expect(formatRelativeTime(now.getTime() - 7200_000, 'en', now)).toBe('2 hours ago');
  });

  it('renders nothing for unusable input', () => {
    expect(formatRelativeTime(null)).toBe('');
    expect(formatRelativeTime(undefined)).toBe('');
    expect(formatRelativeTime('')).toBe('');
    expect(formatRelativeTime('garbage')).toBe('');
  });

  it('renders in the active language', () => {
    const english = formatRelativeTime(new Date('2026-09-12T12:00:00Z'), 'en', now);
    const malay = formatRelativeTime(new Date('2026-09-12T12:00:00Z'), 'ms', now);
    expect(english).not.toBe(malay);
  });
});
