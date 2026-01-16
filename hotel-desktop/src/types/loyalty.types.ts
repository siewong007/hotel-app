// Loyalty Program type definitions

export interface LoyaltyProgram {
  id: number;
  name: string;
  description?: string;
  tier_level: number;
  points_multiplier: number;
  minimum_points_required: number;
  benefits?: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyMembership {
  id: number;
  guest_id: number;
  program_id: number;
  membership_number: string;
  points_balance: number;
  lifetime_points: number;
  tier_level: number;
  status: 'active' | 'inactive' | 'suspended' | 'expired';
  enrolled_date: string;
  expiry_date?: string;
  last_points_activity?: string;
  created_at: string;
  updated_at: string;
}

export interface PointsTransaction {
  id: string;
  membership_id: number;
  transaction_type: 'earn' | 'redeem' | 'expire' | 'adjust';
  points_amount: number;
  balance_after: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  expires_at?: string;
  created_at: string;
  created_by?: number;
}

export interface LoyaltyMembershipWithDetails extends LoyaltyMembership {
  guest_name: string;
  guest_email: string;
  program_name: string;
  program_description?: string;
  points_multiplier: number;
}

export interface LoyaltyStatistics {
  total_members: number;
  active_members: number;
  members_by_tier: {
    tier_level: number;
    tier_name: string;
    count: number;
    percentage: number;
  }[];
  total_points_issued: number;
  total_points_redeemed: number;
  total_points_active: number;
  average_points_per_member: number;
  top_members: {
    guest_name: string;
    guest_email: string;
    points_balance: number;
    lifetime_points: number;
    tier_level: number;
    membership_number: string;
  }[];
  recent_transactions: {
    id: string;
    guest_name: string;
    transaction_type: string;
    points_amount: number;
    description?: string;
    created_at: string;
  }[];
  membership_growth: {
    date: string;
    new_members: number;
    total_members: number;
  }[];
  points_activity: {
    date: string;
    points_earned: number;
    points_redeemed: number;
  }[];
}

export interface TierInfo {
  tier_level: number;
  tier_name: string;
  minimum_points: number;
  benefits: string[];
  points_multiplier: number;
}

export interface UserLoyaltyMembership {
  id: number;
  membership_number: string;
  points_balance: number;
  lifetime_points: number;
  tier_level: number;
  tier_name: string;
  status: string;
  enrolled_date: string;
  expiry_date?: string;
  next_tier?: TierInfo;
  current_tier_benefits: string[];
  points_to_next_tier?: number;
  recent_transactions: PointsTransaction[];
}

export interface LoyaltyReward {
  id: number;
  name: string;
  description?: string;
  category: 'room_upgrade' | 'service' | 'discount' | 'gift' | 'dining' | 'spa' | 'experience';
  points_cost: number;
  monetary_value?: number;
  minimum_tier_level: number;
  is_active: boolean;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
  created_at: string;
  updated_at: string;
}

export interface RedeemRewardInput {
  reward_id: number;
  booking_id?: number;
  notes?: string;
}

export interface RewardInput {
  name: string;
  description?: string;
  category: string;
  points_cost: number;
  monetary_value?: number;
  minimum_tier_level: number;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
}

export interface RewardUpdateInput {
  name?: string;
  description?: string;
  category?: string;
  points_cost?: number;
  monetary_value?: number;
  minimum_tier_level?: number;
  is_active?: boolean;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
}

export interface RewardRedemption {
  id: number;
  guest_name: string;
  guest_email: string;
  reward_name: string;
  category: string;
  points_spent: number;
  redeemed_at: string;
  status: string;
}
