import { describe, expect, it } from 'vitest';

import {
  canRedeem,
  formatCategoryLabel,
  getTierConfig,
  getTierProgress,
  isTierLocked,
} from './utils';
import type { UserLoyaltyMembership } from './utils';

function membership(overrides: Partial<UserLoyaltyMembership> = {}): UserLoyaltyMembership {
  return {
    id: 1,
    membership_number: 'M-000001',
    points_balance: 500,
    lifetime_points: 2500,
    tier_level: 2,
    tier_name: 'Silver',
    status: 'active',
    enrolled_date: '2026-01-01T00:00:00.000Z',
    current_tier_benefits: [],
    recent_transactions: [],
    next_tier: {
      tier_level: 3,
      tier_name: 'Gold',
      minimum_points: 5000,
      points_multiplier: 1,
    },
    ...overrides,
  };
}

describe('getTierProgress', () => {
  it('returns 100 when there is no membership or no next tier', () => {
    expect(getTierProgress(null)).toBe(100);
    expect(getTierProgress(membership({ next_tier: undefined }))).toBe(100);
  });

  it('interpolates between the Silver floor (1000) and the Gold threshold (5000)', () => {
    // (2500 - 1000) / (5000 - 1000) = 37.5%
    expect(getTierProgress(membership())).toBeCloseTo(37.5);
  });

  it('uses a zero floor for Bronze members', () => {
    const bronze = membership({
      tier_level: 1,
      lifetime_points: 250,
      next_tier: { tier_level: 2, tier_name: 'Silver', minimum_points: 1000, points_multiplier: 1 },
    });
    expect(getTierProgress(bronze)).toBeCloseTo(25);
  });

  it('clamps below-zero and above-threshold point balances into 0–100', () => {
    expect(getTierProgress(membership({ lifetime_points: 200 }))).toBe(0);
    expect(getTierProgress(membership({ lifetime_points: 9000 }))).toBe(100);
  });
});

describe('getTierConfig', () => {
  it('falls back to Bronze for an unknown tier level', () => {
    expect(getTierConfig(99).name).toBe('Bronze');
    expect(getTierConfig(3).name).toBe('Gold');
  });
});

describe('canRedeem / isTierLocked', () => {
  const reward = { points_cost: 400, minimum_tier_level: 2 };

  it('requires both enough points and a sufficient tier', () => {
    expect(canRedeem(reward, { points_balance: 500, tier_level: 2 })).toBe(true);
    expect(canRedeem(reward, { points_balance: 399, tier_level: 4 })).toBe(false);
    expect(canRedeem(reward, { points_balance: 500, tier_level: 1 })).toBe(false);
  });

  it('treats exact-cost balances as redeemable and lower tiers as locked', () => {
    expect(canRedeem(reward, { points_balance: 400, tier_level: 2 })).toBe(true);
    expect(isTierLocked(reward, { tier_level: 1 })).toBe(true);
    expect(isTierLocked(reward, { tier_level: 2 })).toBe(false);
  });
});

describe('formatCategoryLabel', () => {
  it('title-cases snake_case categories', () => {
    expect(formatCategoryLabel('dining_discount')).toBe('Dining Discount');
    expect(formatCategoryLabel('spa')).toBe('Spa');
  });
});
