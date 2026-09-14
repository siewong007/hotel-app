export const GRID_DAYS = 14;

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// Shared Intl formatters — one instance per module is wasteful; these are the
// single copies used by the grid, cells, editors, and phone day strips.
export const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
export const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
export const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
