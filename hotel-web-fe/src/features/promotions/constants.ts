import type {
  PromotionDiscountType,
  PromotionInput,
  PromotionKind,
  PromotionStatus,
  VoucherStatus,
} from './types';

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  paused: 'Paused',
  archived: 'Archived',
};

export const VOUCHER_STATUS_LABELS: Record<VoucherStatus, string> = {
  available: 'Available',
  redeemed: 'Redeemed',
  revoked: 'Revoked',
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
};
