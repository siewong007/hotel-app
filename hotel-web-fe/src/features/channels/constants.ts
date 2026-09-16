import type { PricingRuleType } from './types';

export const CHANNEL_TYPES = [
  'direct',
  'ota',
  'corporate',
  'walk_in',
  'phone',
  'website',
  'channel_manager',
  'other',
] as const;

export const INTEGRATION_MODES = ['manual', 'channel_manager', 'api'] as const;

export const PRICING_RULE_TYPES: PricingRuleType[] = [
  'markup_percent',
  'markup_fixed',
  'discount_percent',
  'fixed_price',
  'net_rate',
];

export const COMMISSION_TYPES = ['percentage', 'fixed_amount'] as const;
export const COMMISSION_SCOPES = ['per_booking', 'per_night'] as const;

/** Rule types whose `value` is a percentage rather than a currency amount. */
export const PERCENT_RULE_TYPES: ReadonlySet<string> = new Set([
  'markup_percent',
  'discount_percent',
]);
