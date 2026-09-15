import { formatHotelDateTime } from '../../../utils/date';
import type { UseTranslationResult } from '../../../i18n';

type T = UseTranslationResult['t'];

/** Human "x ago" formatting shared by the bell popover and the full page.
 * `t` comes from the caller's `useTranslation` so the text re-renders with
 * the active locale; past 24h the absolute hotel-timezone stamp reads better. */
export function formatRelativeMs(timestamp: number, t: T): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return t('common:time.justNow');
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t('common:time.minutesAgo', { count: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t('common:time.hoursAgo', { count: diffHr });
  return formatHotelDateTime(new Date(timestamp));
}

export function formatRelativeIso(iso: string, t: T): string {
  return formatRelativeMs(new Date(iso).getTime(), t);
}
