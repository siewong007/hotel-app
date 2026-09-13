export type PromotionStatus =
  | 'draft'
  | 'published'
  | 'paused'
  | 'cancelled'
  | 'archived';

/** Derived campaign lifecycle — the stored status plus the published
 *  campaign's claim-window resolution. Never persisted. */
export type PromotionLifecycle =
  | 'draft'
  | 'scheduled'
  | 'live'
  | 'paused'
  | 'expired'
  | 'cancelled'
  | 'archived';

export type PromotionKind = 'deal' | 'voucher';
export type PromotionDiscountType = 'percentage' | 'fixed_amount';
export type CampaignObjective =
  | 'occupancy'
  | 'acquisition'
  | 'retention'
  | 'upsell'
  | 'loyalty'
  | 'other';

export interface Promotion {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  terms?: string | null;
  status: PromotionStatus;
  /** Derived lifecycle; present on staff reads only (public catalog rows
   *  omit staff fields), so renderers fall back to `status`. */
  lifecycle?: PromotionLifecycle;
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
  is_cancellable?: boolean;
  /** Staff-only operations reference code. */
  internal_code?: string | null;
  /** Staff-only campaign objective tag. */
  objective?: CampaignObjective | null;
  room_type_ids: number[];
  /** Booking channels the campaign redeems on; empty = every channel.
   *  Staff reads only. */
  booking_channel_ids?: number[];
  /** Loyalty tiers allowed to claim/be issued vouchers; empty = everyone.
   *  Staff reads only. */
  loyalty_tier_ids?: number[];
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
  /** The backend accepts any lifecycle value here and maps it to a
   *  status + claim-window predicate. */
  status?: PromotionLifecycle;
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
  is_cancellable?: boolean;
  room_type_ids: number[];
  internal_code?: string | null;
  objective?: CampaignObjective | null;
  booking_channel_ids: number[];
  loyalty_tier_ids: number[];
  expected_version?: number;
}

export type PromotionUpdateInput = Partial<PromotionInput> & {
  expected_version?: number;
};

export type PromotionLifecycleAction = 'publish' | 'pause' | 'cancel' | 'archive';

export interface PromotionLifecycleInput {
  expected_version?: number;
  reason?: string;
}

export type VoucherStatus = 'available' | 'redeemed' | 'revoked';

/** Display-only voucher status: `available` rows past `expires_at` read as
 *  expired. Never persisted — matches the backend `status=expired` alias. */
export type VoucherDisplayStatus = VoucherStatus | 'expired';

/** `status` query param values — display statuses plus the `expiring_soon`
 *  alias (a filter can never be a row's own display status). */
export type VoucherStatusFilter = VoucherDisplayStatus | 'expiring_soon';

export interface Voucher {
  id: number;
  promotion_id: number;
  promotion_name: string;
  promotion_slug: string;
  code?: string;
  code_masked?: string;
  status: VoucherStatus;
  source: string;
  /** `false` means redeeming this voucher locks the booking against
   *  cancellation — the picker badges it before the guest applies it. */
  is_cancellable?: boolean;
  guest_id?: number | null;
  guest_name?: string | null;
  /** Why the voucher was revoked; populated on admin reads only. */
  revocation_reason?: string | null;
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
  status?: VoucherStatusFilter;
  promotion_id?: number;
  guest_id?: number;
}

export interface VoucherSummaryDiscount {
  currency: string;
  amount: number;
}

export interface VoucherSummary {
  total: number;
  available: number;
  redeemed: number;
  revoked: number;
  expired: number;
  expiring_soon: number;
  redemption_count: number;
  discount_given: VoucherSummaryDiscount[];
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

export interface TargetingChannelOption {
  id: number;
  name: string;
  channel_type: string;
}

export interface TargetingTierOption {
  id: number;
  code?: string | null;
  name: string;
}

export interface TargetingOptionsResponse {
  channels: TargetingChannelOption[];
  loyalty_tiers: TargetingTierOption[];
}

export interface CampaignVoucherFunnel {
  total: number;
  available: number;
  redeemed: number;
  revoked: number;
  expired: number;
  guest_claims: number;
  admin_issues: number;
}

export interface CampaignRedemptionTotals {
  applied: number;
  reversed: number;
  gross_subtotal: number;
  discount_amount: number;
  net_total: number;
  bookings: number;
  guests: number;
  conversion_rate?: number | null;
}

export interface CampaignPerNightTotals {
  nights: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
}

export interface CampaignChannelMixRow {
  channel_id?: number | null;
  name: string;
  channel_type?: string | null;
  redemptions: number;
  net_total: number;
}

export interface CampaignPerformance {
  promotion_id: number;
  currency: string;
  vouchers: CampaignVoucherFunnel;
  redemptions: CampaignRedemptionTotals;
  per_night: CampaignPerNightTotals;
  channel_mix: CampaignChannelMixRow[];
}
