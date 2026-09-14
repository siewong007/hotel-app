/**
 * Centralized status-label helper: maps an internal status enum value to its
 * localized display label through the `status` namespace.
 *
 * Every wave that renders a status Chip/Badge calls this instead of hand-rolling
 * `t('status:...')` at each site, so the raw-value fallback policy lives in one
 * place:
 *
 *   - `null`/`undefined`/empty → `status:generic.unknown`
 *   - a value the bundle maps → the localized label
 *   - a value no bundle maps → the engine renders the last key segment, which
 *     is the raw value; matching that case, we humanize it (`checked_in` →
 *     `Checked In`) rather than leak the enum verbatim.
 */

import type { UseTranslationResult } from './useTranslation';

const humanize = (value: string): string =>
  value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Localized display label for an internal status value. */
export const statusLabel = (
  t: UseTranslationResult['t'],
  domain: string,
  value: string | null | undefined
): string => {
  if (!value) return t('status:generic.unknown');
  const key = `${domain}.${value}`;
  const translated = t(`status:${key}`);
  // Engine renders the last segment (the raw value) on a missing key — for an
  // unmapped status, humanize beats leaking `checked_in` verbatim.
  return translated === value ? humanize(value) : translated;
};
