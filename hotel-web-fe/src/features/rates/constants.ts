export const PLAN_TYPES = [
  'standard',
  'seasonal',
  'promotional',
  'corporate',
  'group',
  'package',
] as const;

export const ADJUSTMENT_TYPES = ['percentage', 'fixed', 'override'] as const;

/** Day-of-week flag keys in rate_plans column order (Monday first). */
export const DOW_FLAGS = [
  ['applies_monday', 'Mon'],
  ['applies_tuesday', 'Tue'],
  ['applies_wednesday', 'Wed'],
  ['applies_thursday', 'Thu'],
  ['applies_friday', 'Fri'],
  ['applies_saturday', 'Sat'],
  ['applies_sunday', 'Sun'],
] as const;

/** Days shown per calendar page. */
export const CALENDAR_WINDOW_DAYS = 14;
