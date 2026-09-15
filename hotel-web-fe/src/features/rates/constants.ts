export const PLAN_TYPES = [
  'standard',
  'seasonal',
  'promotional',
  'corporate',
  'group',
  'package',
] as const;

export const ADJUSTMENT_TYPES = ['percentage', 'fixed', 'override'] as const;

/** Day-of-week flag keys in rate_plans column order (Monday first); the
 * second element is the `rates:days.*` key suffix, resolved via `t()`. */
export const DOW_FLAGS = [
  ['applies_monday', 'mon'],
  ['applies_tuesday', 'tue'],
  ['applies_wednesday', 'wed'],
  ['applies_thursday', 'thu'],
  ['applies_friday', 'fri'],
  ['applies_saturday', 'sat'],
  ['applies_sunday', 'sun'],
] as const;

/** Days shown per calendar page. */
export const CALENDAR_WINDOW_DAYS = 14;
