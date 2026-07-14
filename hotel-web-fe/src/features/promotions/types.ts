export type PromotionStatus = 'draft' | 'published' | 'paused' | 'archived';
export type PromotionKind = 'deal' | 'voucher';
export type PromotionDiscountType = 'percentage' | 'fixed_amount';

export interface Promotion {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  terms?: string | null;
  status: PromotionStatus;
  promotion_kind: PromotionKind;
  discount_type: PromotionDiscountType;
  discount_value: number;
  max_discount_amount?: number | null;
  currency: string;
  claim_starts_at?: string | null;
  claim_ends_at?: string | null;
  stay_starts_on?: string | null;
  stay_ends_on?: string | null;
  min_nights?: number | null;
  max_nights?: number | null;
  min_subtotal?: number | null;
  claim_limit?: number | null;
  claimed_count: number;
  per_guest_limit: number;
  is_public: boolean;
  room_type_ids: number[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface GuestPromotion {
  promotion: Promotion;
  can_claim: boolean;
  has_voucher: boolean;
  claim_unavailable_reason?: string | null;
}

export interface PromotionListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: PromotionStatus;
  promotion_kind?: PromotionKind;
}

export interface PromotionListResponse {
  items: Promotion[];
  total: number;
  page: number;
  page_size: number;
}

export interface GuestPromotionListResponse {
  items: GuestPromotion[];
  total: number;
  page: number;
  page_size: number;
}

export interface PromotionInput {
  slug: string;
  name: string;
  description?: string | null;
  terms?: string | null;
  promotion_kind: PromotionKind;
  discount_type: PromotionDiscountType;
  discount_value: number;
  max_discount_amount?: number | null;
  currency: string;
  claim_starts_at?: string | null;
  claim_ends_at?: string | null;
  stay_starts_on?: string | null;
  stay_ends_on?: string | null;
  min_nights?: number | null;
  max_nights?: number | null;
  min_subtotal?: number | null;
  claim_limit?: number | null;
  per_guest_limit: number;
  is_public: boolean;
  room_type_ids: number[];
  expected_version?: number;
}

export type PromotionUpdateInput = Partial<PromotionInput> & {
  expected_version?: number;
};

export type PromotionLifecycleAction = 'publish' | 'pause' | 'archive';

export interface PromotionLifecycleInput {
  expected_version?: number;
}

export type VoucherStatus = 'available' | 'redeemed' | 'expired' | 'revoked';

export interface Voucher {
  id: number;
  promotion_id: number;
  promotion_name: string;
  promotion_slug: string;
  code?: string;
  code_masked?: string;
  status: VoucherStatus;
  source: string;
  guest_id?: number | null;
  guest_name?: string | null;
  expires_at?: string | null;
  claimed_at?: string | null;
  redeemed_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface VoucherListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: VoucherStatus;
  promotion_id?: number;
  guest_id?: number;
}

export interface VoucherListResponse {
  items: Voucher[];
  total: number;
  page: number;
  page_size: number;
}

export interface ClaimPromotionInput {
  client_request_id?: string;
}

export interface VoucherIssueInput {
  promotion_id: number;
  guest_id: number;
  code?: string;
  expires_at?: string | null;
}

export interface VoucherRevokeInput {
  reason?: string;
}
