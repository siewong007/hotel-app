import { dateFormatter } from '../../../i18n';

/**
 * Format a date-only value (`YYYY-MM-DD`) such as an applicant's next arrival.
 *
 * Deliberately not the page's `formatDate`, which parses through `new Date()`:
 * that reads a bare `YYYY-MM-DD` as UTC midnight and then renders it in local
 * time, so every date shows a day early for a viewer west of Greenwich — and it
 * would print a meaningless `00:00` besides. Splitting the parts and building a
 * local date keeps the calendar day the backend meant, while `dateFormatter`
 * renders the month in the interface language rather than a fixed English
 * pattern.
 */
export function formatCalendarDate(value?: string | null): string {
  if (!value) return '-';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return dateFormatter({ year: 'numeric', month: 'short', day: '2-digit' }).format(
    new Date(year, month - 1, day),
  );
}
