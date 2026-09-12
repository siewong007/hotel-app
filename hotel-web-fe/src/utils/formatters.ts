/**
 * Canonical display formatters for user-facing text.
 *
 * API enums arrive as snake_case (`pending_payment`, `checked_out`) and every
 * screen used to humanize them with its own `replace(/_/g, ' ')` — fifteen
 * copies with three different casing rules. Route them all through
 * formatStatusLabel so status text reads the same everywhere.
 */

import { formatHotelDate, toHotelDateString, type BusinessDateValue } from './date';

/** `pending_payment` → `Pending Payment`. Also handles kebab-case, camelCase
 * and already-spaced values; empty input renders the fallback. */
export const formatStatusLabel = (
  value: string | null | undefined,
  fallback = '—',
): string => {
  if (value == null) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const stripYearSuffix = (formatted: string): string => formatted.replace(/,\s*\d{4}$/, '');

/**
 * Canonical stay/range display. `'2026-09-13'..'2026-09-15'` →
 * `Sep 13 – Sep 15, 2026`; a single night collapses to `Sep 13, 2026`.
 * Both ends render in the hotel timezone via formatHotelDate.
 */
export const formatDateRange = (
  from: BusinessDateValue,
  to: BusinessDateValue,
  fallback = '—',
): string => {
  const fromDate = toHotelDateString(from);
  const toDate = toHotelDateString(to);
  if (!fromDate || !toDate) return fallback;
  if (fromDate === toDate) return formatHotelDate(fromDate, fallback);
  const left = formatHotelDate(fromDate, fallback);
  const right = formatHotelDate(toDate, fallback);
  // Same month + year: dropping the left year reads tighter ('Sep 13 – Sep 15, 2026').
  if (fromDate.slice(0, 7) === toDate.slice(0, 7)) {
    return `${stripYearSuffix(left)} – ${right}`;
  }
  return `${left} – ${right}`;
};
