/**
 * Locale-aware formatting built on the platform's own `Intl` implementation.
 *
 * These wrap `Intl` for two reasons: every constructor is memoised (they are
 * expensive enough that building one per table row shows up in profiles), and
 * every one of them resolves the BCP-47 tag from the locale registry rather
 * than from the browser's locale, so a staff member with a US browser reading
 * the app in Bahasa Melayu sees Malay formatting throughout.
 *
 * Money is deliberately absent: `utils/currency.ts` formats by *currency code*
 * from hotel settings, not by interface language, and the two must not fight.
 */

import { getActiveLocale } from './localeStore';
import { getLocaleDefinition, type LocaleCode } from './locales';

/** BCP-47 tag for `Intl`, for the active or a given locale. */
export const intlTag = (locale: LocaleCode = getActiveLocale()): string =>
  getLocaleDefinition(locale).intlTag;

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

const cacheKey = (tag: string, options?: object): string =>
  options ? `${tag}|${JSON.stringify(options)}` : tag;

export const numberFormatter = (
  options?: Intl.NumberFormatOptions,
  locale?: LocaleCode
): Intl.NumberFormat => {
  const tag = intlTag(locale);
  const key = cacheKey(tag, options);
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
};

export const dateFormatter = (
  options?: Intl.DateTimeFormatOptions,
  locale?: LocaleCode
): Intl.DateTimeFormat => {
  const tag = intlTag(locale);
  const key = cacheKey(tag, options);
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(tag, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
};

/** `1234.5` -> `1,234.5` (en) / `1,234.5` (ms). */
export const formatNumber = (
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
  locale?: LocaleCode
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return numberFormatter(options, locale).format(value);
};

/** `0.125` -> `12.5%`. */
export const formatPercent = (
  ratio: number | null | undefined,
  fractionDigits = 1,
  locale?: LocaleCode
): string =>
  formatNumber(
    ratio,
    {
      style: 'percent',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    },
    locale
  );

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * `Date` -> "in 3 days" / "2 hours ago", in the active language.
 * Falls back to the empty string for unparseable input, like the date helpers.
 */
export const formatRelativeTime = (
  value: Date | string | number | null | undefined,
  locale?: LocaleCode,
  now: Date = new Date()
): string => {
  if (value === null || value === undefined || value === '') return '';
  const target = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(target.getTime())) return '';

  const tag = intlTag(locale);
  let formatter = relativeFormatters.get(tag);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
    relativeFormatters.set(tag, formatter);
  }

  const deltaMs = target.getTime() - now.getTime();
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= unitMs) {
      return formatter.format(Math.round(deltaMs / unitMs), unit);
    }
  }
  return formatter.format(Math.round(deltaMs / 1000), 'second');
};

/** Drop every memoised formatter. Called when the locale registry changes in tests. */
export const clearFormatterCachesForTests = (): void => {
  numberFormatters.clear();
  dateFormatters.clear();
  relativeFormatters.clear();
};
