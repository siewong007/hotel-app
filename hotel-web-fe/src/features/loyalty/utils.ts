/**
 * Pure loyalty math and formatting helpers extracted from LoyaltyDashboard
 * so they can be unit-tested without rendering the component.
 */

import { formatStatusLabel } from '../../utils/formatters';

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
    color: '#CD8B4A',
    gradient: 'color-mix(in srgb, #CD8B4A 16%, var(--hotel-surface-raised))',
    icon: '🥉',
    bgColor: 'color-mix(in srgb, #CD8B4A 12%, transparent)',
  },
  2: {
    name: 'Silver',
    color: '#B9BEC7',
    gradient: 'color-mix(in srgb, #B9BEC7 16%, var(--hotel-surface-raised))',
    icon: '🥈',
    bgColor: 'color-mix(in srgb, #B9BEC7 12%, transparent)',
  },
  3: {
    name: 'Gold',
    color: '#E3BC55',
    gradient: 'color-mix(in srgb, #E3BC55 16%, var(--hotel-surface-raised))',
    icon: '🥇',
    bgColor: 'color-mix(in srgb, #E3BC55 12%, transparent)',
  },
  4: {
    name: 'Platinum',
    color: '#D8DCE4',
    gradient: 'color-mix(in srgb, #D8DCE4 14%, var(--hotel-surface-raised))',
    icon: '💎',
    bgColor: 'color-mix(in srgb, #D8DCE4 12%, transparent)',
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
  return formatStatusLabel(category);
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
