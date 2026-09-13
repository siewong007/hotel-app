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

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  paused: 'Paused',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

/** Operator-facing lifecycle labels — what the campaigns list filters and
 *  status chips display. `scheduled`/`live`/`expired` are derived, never
 *  stored. */
export const CAMPAIGN_LIFECYCLE_LABELS: Record<PromotionLifecycle, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  paused: 'Paused',
  expired: 'Expired',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

export const CAMPAIGN_OBJECTIVE_OPTIONS: Array<{
  value: CampaignObjective;
  label: string;
}> = [
  { value: 'occupancy', label: 'Fill occupancy' },
  { value: 'acquisition', label: 'Acquire guests' },
  { value: 'retention', label: 'Retain guests' },
  { value: 'upsell', label: 'Upsell' },
  { value: 'loyalty', label: 'Loyalty' },
  { value: 'other', label: 'Other' },
];

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  available: 'Available',
  redeemed: 'Redeemed',
  revoked: 'Revoked',
};

export const VOUCHER_DISPLAY_STATUS_LABELS: Record<VoucherDisplayStatus, string> = {
  available: 'Available',
  expired: 'Expired',
  redeemed: 'Redeemed',
  revoked: 'Revoked',
};

export const VOUCHER_STATUS_FILTER_LABELS: Record<VoucherStatusFilter, string> = {
  ...VOUCHER_DISPLAY_STATUS_LABELS,
  expiring_soon: 'Expiring soon',
};

export const PROMOTION_KIND_OPTIONS: Array<{ value: PromotionKind; label: string }> = [
  { value: 'deal', label: 'Deal' },
  { value: 'voucher', label: 'Voucher' },
];

export const DISCOUNT_TYPE_OPTIONS: Array<{
  value: PromotionDiscountType;
  label: string;
}> = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed_amount', label: 'Fixed amount' },
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
