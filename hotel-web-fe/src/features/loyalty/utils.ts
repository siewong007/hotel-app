/**
 * Pure loyalty math and formatting helpers extracted from LoyaltyDashboard
 * so they can be unit-tested without rendering the component.
 */

export interface UserLoyaltyMembership {
  id: number;
  membership_number: string;
  points_balance: number;
  lifetime_points: number;
  tier_level: number;
  tier_name: string;
  status: string;
  enrolled_date: string;
  next_tier?: {
    tier_level: number;
    tier_name: string;
    minimum_points: number;
    points_multiplier: number;
  };
  current_tier_benefits: string[];
  points_to_next_tier?: number;
  recent_transactions: Array<{
    id: string;
    transaction_type: string;
    points_amount: number;
    balance_after: number;
    description?: string;
    created_at: string;
  }>;
}

export const TIER_CONFIG: Record<number, {
  name: string;
  color: string;
  gradient: string;
  icon: string;
  bgColor: string;
}> = {
  1: {
    name: 'Bronze',
    color: '#CD7F32',
    gradient: 'linear-gradient(135deg, #CD7F32 0%, #B87333 100%)',
    icon: '🥉',
    bgColor: 'rgba(205, 127, 50, 0.1)',
  },
  2: {
    name: 'Silver',
    color: '#C0C0C0',
    gradient: 'linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%)',
    icon: '🥈',
    bgColor: 'rgba(192, 192, 192, 0.1)',
  },
  3: {
    name: 'Gold',
    color: '#FFD700',
    gradient: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
    icon: '🥇',
    bgColor: 'rgba(255, 215, 0, 0.1)',
  },
  4: {
    name: 'Platinum',
    color: '#E5E4E2',
    gradient: 'linear-gradient(135deg, #E5E4E2 0%, #B9B9B9 100%)',
    icon: '💎',
    bgColor: 'rgba(229, 228, 226, 0.1)',
  },
};

export const getTierConfig = (tierLevel: number) => {
  return TIER_CONFIG[tierLevel] || TIER_CONFIG[1];
};

/** Minimum lifetime points historically required for each tier level. */
const TIER_MINIMUM_POINTS: Record<number, number> = {
  1: 0,
  2: 1000,
  3: 5000,
};

/**
 * Percentage (0–100) of the journey from the member's current tier floor to
 * their next tier's threshold. Top-tier members (no next_tier) are done: 100.
 */
export function getTierProgress(membership: Pick<UserLoyaltyMembership, 'lifetime_points' | 'tier_level' | 'next_tier'> | null): number {
  if (!membership || !membership.next_tier) return 100;

  const currentPoints = membership.lifetime_points;
  const nextTierPoints = membership.next_tier.minimum_points;
  const currentTierMin = membership.tier_level === 1 ? 0 :
    (membership.tier_level === 2 ? 1000 :
     membership.tier_level === 3 ? 5000 : 10000);

  if (nextTierPoints <= currentTierMin) return 100;

  const progress = ((currentPoints - currentTierMin) / (nextTierPoints - currentTierMin)) * 100;
  return Math.min(Math.max(progress, 0), 100);
}

export function canRedeem(
  reward: { points_cost: number; minimum_tier_level: number },
  membership: Pick<UserLoyaltyMembership, 'points_balance' | 'tier_level'>,
): boolean {
  return membership.points_balance >= reward.points_cost &&
    membership.tier_level >= reward.minimum_tier_level;
}

export function isTierLocked(
  reward: { minimum_tier_level: number },
  membership: Pick<UserLoyaltyMembership, 'tier_level'>,
): boolean {
  return membership.tier_level < reward.minimum_tier_level;
}

/** `dining_discount` → `Dining Discount`. */
export function formatCategoryLabel(category: string): string {
  return category
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const formatNumber = (num: number) => {
  return new Intl.NumberFormat('en-US').format(num);
};

export const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};
