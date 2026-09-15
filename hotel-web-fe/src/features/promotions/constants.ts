import type {
  CampaignObjective,
  PromotionDiscountType,
  PromotionInput,
  PromotionKind,
} from './types';

export const CAMPAIGN_OBJECTIVE_OPTIONS: Array<{
  value: CampaignObjective;
  /** `promotions:objectives.<value>` */
  labelKey: string;
}> = [
  { value: 'occupancy', labelKey: 'objectives.occupancy' },
  { value: 'acquisition', labelKey: 'objectives.acquisition' },
  { value: 'retention', labelKey: 'objectives.retention' },
  { value: 'upsell', labelKey: 'objectives.upsell' },
  { value: 'loyalty', labelKey: 'objectives.loyalty' },
  { value: 'other', labelKey: 'objectives.other' },
];

export const PROMOTION_KIND_OPTIONS: Array<{ value: PromotionKind; labelKey: string }> = [
  { value: 'deal', labelKey: 'kinds.deal' },
  { value: 'voucher', labelKey: 'kinds.voucher' },
];

export const DISCOUNT_TYPE_OPTIONS: Array<{
  value: PromotionDiscountType;
  /** `promotions:discountTypes.<value>` */
  labelKey: string;
}> = [
  { value: 'percentage', labelKey: 'discountTypes.percentage' },
  { value: 'fixed_amount', labelKey: 'discountTypes.fixed_amount' },
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
