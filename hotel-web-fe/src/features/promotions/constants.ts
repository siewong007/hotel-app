import type {
  CampaignObjective,
  PromotionDiscountType,
  PromotionInput,
  PromotionKind,
  PromotionLifecycle,
  PromotionStatus,
  VoucherDisplayStatus,
  VoucherStatus,
  VoucherStatusFilter,
} from './types';

/** i18n keys (`status:promotion.*`) for stored promotion statuses — render
 *  with `t(PROMOTION_STATUS_KEYS[status])`. */
export const PROMOTION_STATUS_KEYS: Record<PromotionStatus, string> = {
  draft: 'status:promotion.draft',
  published: 'status:promotion.published',
  paused: 'status:promotion.paused',
  cancelled: 'status:promotion.cancelled',
  archived: 'status:promotion.archived',
};

/** Operator-facing lifecycle keys (`status:promotion.*`) — what the campaigns
 *  list filters and status chips display. `scheduled`/`live`/`expired` are
 *  derived, never stored. */
export const CAMPAIGN_LIFECYCLE_KEYS: Record<PromotionLifecycle, string> = {
  draft: 'status:promotion.draft',
  scheduled: 'status:promotion.scheduled',
  live: 'status:promotion.live',
  paused: 'status:promotion.paused',
  expired: 'status:promotion.expired',
  cancelled: 'status:promotion.cancelled',
  archived: 'status:promotion.archived',
};

export const CAMPAIGN_OBJECTIVE_OPTIONS: Array<{
  value: CampaignObjective;
  labelKey: string;
}> = [
  { value: 'occupancy', labelKey: 'objectives.occupancy' },
  { value: 'acquisition', labelKey: 'objectives.acquisition' },
  { value: 'retention', labelKey: 'objectives.retention' },
  { value: 'upsell', labelKey: 'objectives.upsell' },
  { value: 'loyalty', labelKey: 'objectives.loyalty' },
  { value: 'other', labelKey: 'objectives.other' },
];

export const VOUCHER_STATUS_KEYS: Record<VoucherStatus, string> = {
  available: 'status:voucher.available',
  redeemed: 'status:voucher.redeemed',
  revoked: 'status:voucher.revoked',
};

export const VOUCHER_DISPLAY_STATUS_KEYS: Record<VoucherDisplayStatus, string> = {
  available: 'status:voucher.available',
  expired: 'status:voucher.expired',
  redeemed: 'status:voucher.redeemed',
  revoked: 'status:voucher.revoked',
};

export const VOUCHER_STATUS_FILTER_KEYS: Record<VoucherStatusFilter, string> = {
  ...VOUCHER_DISPLAY_STATUS_KEYS,
  expiring_soon: 'promotions:filters.expiringSoon',
};

export const PROMOTION_KIND_OPTIONS: Array<{ value: PromotionKind; labelKey: string }> = [
  { value: 'deal', labelKey: 'kind.deal' },
  { value: 'voucher', labelKey: 'kind.voucher' },
];

export const DISCOUNT_TYPE_OPTIONS: Array<{
  value: PromotionDiscountType;
  labelKey: string;
}> = [
  { value: 'percentage', labelKey: 'discountType.percentage' },
  { value: 'fixed_amount', labelKey: 'discountType.fixedAmount' },
];

export const EMPTY_PROMOTION_INPUT: PromotionInput = {
  slug: '',
  name: '',
  description: '',
  terms: '',
  promotion_kind: 'deal',
  discount_type: 'percentage',
  discount_value: 10,
  max_discount_amount: null,
  currency: 'USD',
  claim_starts_at: null,
  claim_ends_at: null,
  stay_starts_on: null,
  stay_ends_on: null,
  min_nights: 1,
  max_nights: null,
  min_subtotal: 0,
  claim_limit: null,
  per_guest_limit: 1,
  is_public: true,
  is_cancellable: true,
  room_type_ids: [],
  internal_code: null,
  objective: null,
  booking_channel_ids: [],
  loyalty_tier_ids: [],
};
