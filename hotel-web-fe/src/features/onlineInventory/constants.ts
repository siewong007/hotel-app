import { dateFormatter } from '../../i18n';

export const GRID_DAYS = 14;

// Shared date formatters — one Intl instance per call site is wasteful, so the
// grid, cells, editors, and phone day strips share these wrappers. They render
// in the interface language (i18n), not the browser locale.
export const WEEKDAY_SHORT = { format: (d: Date) => dateFormatter({ weekday: 'short' }).format(d) };
export const DAY_NUM = { format: (d: Date) => dateFormatter({ day: 'numeric' }).format(d) };
export const FULL_DATE = {
  format: (d: Date) =>
    dateFormatter({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d),
};
