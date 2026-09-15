/**
 * Chart formatting atoms — tick and tooltip formatters built on the app's
 * currency/date utils so charts format exactly like the rest of the UI.
 */
import { formatCurrency } from '../../utils/currency';
import { intlTag } from '../../i18n/format';

/** Full precision: "RM 1,234.56" — tooltips, value labels. */
export const fmtMoney = (value: number | string | null | undefined): string =>
  formatCurrency(value);

/** Axis-tick money: "RM 1.2k" / "RM 3.4M" — keeps dense axes readable. */
export const fmtCompactMoney = (value: number): string => {
  const abs = Math.abs(value);
  const symbol = formatCurrency(0).replace(/[\d\s.,]/g, '');
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${(value / 1_000).toFixed(0)}k`;
  return `${symbol}${Math.round(value)}`;
};

export const fmtPct = (value: number, digits = 1): string => `${value.toFixed(digits)}%`;

export const fmtInt = (value: number): string => Math.round(value).toLocaleString(intlTag());

/** Axis-tick date: "5 Sep". Input is an ISO "YYYY-MM-DD" day string. */
export const fmtShortDate = (isoDay: string): string => {
  const d = new Date(`${isoDay}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? isoDay
    : `${d.getDate()} ${d.toLocaleString(intlTag(), { month: 'short' })}`;
};

/** Thin a dense date/category domain to ~maxTicks evenly spaced entries,
 *  always keeping first and last — pass as `axisBottom.tickValues` so labels
 *  never overlap on long ranges. */
export const thinTicks = <T>(values: T[], maxTicks = 8): T[] => {
  if (values.length <= maxTicks) return values;
  const step = (values.length - 1) / (maxTicks - 1);
  const keep = new Set<number>();
  for (let i = 0; i < maxTicks; i++) keep.add(Math.round(i * step));
  return values.filter((_, i) => keep.has(i));
};
