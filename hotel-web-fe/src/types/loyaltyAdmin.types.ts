// Loyalty admin type definitions.
//
// These mirror the live backend contract in
// `hotel-app-be/src/modules/loyalty/models.rs` (the `modules::loyalty` router
// mounted at `/api`). They intentionally live apart from the legacy
// `loyalty.types.ts` shapes, which target an older, unmounted API surface.

export type LoyaltyMemberStatus = 'active' | 'closed';
export type LoyaltyRedemptionStatus = 'pending' | 'approved' | 'rejected';
export type TierQualificationMetric = 'points' | 'nights' | 'spend';

export interface LoyaltyTier {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  min_points: number;
  min_nights: number;
  min_spend: number;
  benefits: string[];
  is_active: boolean;
}

export interface LoyaltyProgramRules {
  id: number;
  points_per_currency_unit: number;
  tier_qualification_metric: TierQualificationMetric;
  point_expiry_months?: number | null;
  redemption_approval_required: boolean;
  earning_enabled: boolean;
  min_eligible_amount: number;
  updated_at: string;
}

export interface LoyaltyRulesInput {
  points_per_currency_unit: number;
  tier_qualification_metric: TierQualificationMetric;
  point_expiry_months?: number | null;
  redemption_approval_required: boolean;
  earning_enabled: boolean;
  min_eligible_amount: number;
}

export interface LoyaltyMemberSummary {
  id: number;
  guest_id: number;
  member_number: string;
  status: LoyaltyMemberStatus;
  enrolled_at: string;
  closed_at?: string | null;
  guest_name: string;
  guest_email?: string | null;
  guest_phone?: string | null;
  account_id: number;
  available_points: number;
  lifetime_points: number;
  qualifying_points: number;
  qualifying_nights: number;
  qualifying_spend: number;
  tier_id: number;
  tier_code: string;
  tier_name: string;
}

export interface TierProgress {
  metric: string;
  current_value: number;
  current_tier_minimum: number;
  next_tier_id?: number | null;
  next_tier_name?: string | null;
  next_tier_minimum?: number | null;
  remaining_to_next_tier?: number | null;
  progress_percent: number;
}

export interface LoyaltyTransaction {
  id: number;
  member_id: number;
  account_id: number;
  transaction_type: string;
  points_delta: number;
  available_delta: number;
  balance_after: number;
  source_type?: string | null;
  source_id?: number | null;
  booking_id?: number | null;
  payment_id?: number | null;
  invoice_id?: number | null;
  related_transaction_id?: number | null;
  description?: string | null;
  metadata?: unknown;
  actor_user_id?: number | null;
  created_at: string;
}

export interface AdminLoyaltyReward {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  points_cost: number;
  minimum_tier_id?: number | null;
  minimum_tier_name?: string | null;
  requires_approval: boolean;
  is_active: boolean;
  inventory_count?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  terms_conditions?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyRedemption {
  id: number;
  member_id: number;
  member_number: string;
  guest_name: string;
  guest_email?: string | null;
  reward_id: number;
  reward_name: string;
  points_spent: number;
  status: LoyaltyRedemptionStatus;
  transaction_id?: number | null;
  requested_at: string;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  notes?: string | null;
}

export interface LoyaltyMemberDetail {
  member: LoyaltyMemberSummary;
  tier_progress: TierProgress;
  recent_activity: LoyaltyTransaction[];
  redemptions: LoyaltyRedemption[];
}

export interface ManualAdjustmentInput {
  points_delta: number;
  reason: string;
  allow_negative_balance?: boolean;
}

export interface GiftPointsInput {
  points: number;
  reason: string;
}

export interface AdminRewardInput {
  name: string;
  description?: string;
  category: string;
  points_cost: number;
  minimum_tier_id?: number | null;
  requires_approval?: boolean;
  is_active?: boolean;
  inventory_count?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  terms_conditions?: string;
}

export type AdminRewardUpdateInput = Partial<AdminRewardInput>;

export interface RejectRedemptionInput {
  reason: string;
}

export interface LoyaltyMemberQueryParams {
  search?: string;
  status?: LoyaltyMemberStatus;
}

export interface LoyaltyRewardQueryParams {
  include_inactive?: boolean;
  category?: string;
}

export interface LoyaltyRedemptionQueryParams {
  status?: LoyaltyRedemptionStatus;
}
