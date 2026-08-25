import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoyaltyReward } from '../../../types';

import type { UserLoyaltyMembership } from '../utils';

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  membership: null as UserLoyaltyMembership | null,
  rewards: [] as LoyaltyReward[],
  ekycStatus: 'approved' as string,
  redeemReward: vi.fn(),
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (p: string) => mocks.permissions.has(p) }),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ symbol: 'RM', currency: 'MYR' }),
}));

// The component pulls services through the src/api barrel — mock there.
vi.mock('../../../api', () => ({
  EkycService: {
    getEkycStatus: () => Promise.resolve({ status: mocks.ekycStatus }),
  },
  LoyaltyService: {
    getUserLoyaltyMembership: () => Promise.resolve(mocks.membership),
    getLoyaltyRewards: () => Promise.resolve(mocks.rewards),
    redeemReward: (...args: unknown[]) => mocks.redeemReward(...args),
    getRewards: () => Promise.resolve([]),
    getTransactions: () => Promise.resolve([]),
  },
}));

import LoyaltyDashboard from './LoyaltyDashboard';

const membership = (points: number): UserLoyaltyMembership => ({
  id: 1,
  membership_number: 'M-0001',
  points_balance: points,
  lifetime_points: points,
  tier_level: 2,
  tier_name: 'Silver',
  status: 'active',
  enrolled_date: '2026-01-01',
  next_tier: {
    tier_level: 3,
    tier_name: 'Gold',
    minimum_points: 5000,
    points_multiplier: 1,
  },
  current_tier_benefits: ['5% bonus points'],
  points_to_next_tier: 5000 - points,
  recent_transactions: [],
});

const reward = (overrides: Partial<LoyaltyReward> = {}): LoyaltyReward =>
  ({
    id: 77,
    name: 'Free Night Voucher',
    description: 'One night, any room type',
    category: 'accommodation',
    points_cost: 500,
    minimum_tier_id: 1,
    minimum_tier_level: 1,
    is_active: true,
    ...overrides,
  }) as LoyaltyReward;

describe('LoyaltyDashboard member view', () => {
  beforeEach(() => {
    mocks.permissions = new Set();
    mocks.ekycStatus = 'approved';
    mocks.membership = membership(1_000);
    mocks.rewards = [reward()];
    mocks.redeemReward.mockReset().mockResolvedValue({ id: 9001 });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(cleanup);

  it('shows the membership balance and an affordable reward as redeemable', async () => {
    render(<LoyaltyDashboard />);

    expect(await screen.findByText(/Silver/i)).toBeTruthy();
    const button = await screen.findByText('Redeem Now');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables redemption when the balance cannot cover the cost', async () => {
    mocks.membership = membership(100);

    render(<LoyaltyDashboard />);

    expect(await screen.findByText('Insufficient Points')).toBeTruthy();
    const button = screen.getByText('Insufficient Points').closest('button')!;
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('locks rewards above the member tier instead of offering redemption', async () => {
    mocks.rewards = [reward({ minimum_tier_level: 3 })];

    render(<LoyaltyDashboard />);

    expect(await screen.findByText('Tier Locked')).toBeTruthy();
    const button = screen.getByText('Tier Locked').closest('button')!;
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires completed eKYC before showing any loyalty data', async () => {
    mocks.ekycStatus = 'pending';

    render(<LoyaltyDashboard />);

    expect(await screen.findByText('eKYC Verification Required')).toBeTruthy();
    expect(screen.queryByText('Redeem Now')).toBeNull();
  });

  it('redeems through the confirmation dialog and reports success', async () => {
    render(<LoyaltyDashboard />);

    fireEvent.click(await screen.findByText('Redeem Now'));
    expect(await screen.findByText('Confirm Reward Redemption')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Notes/i), {
      target: { value: 'Anniversary night' },
    });
    fireEvent.click(screen.getByText('Confirm Redemption'));

    await waitFor(() =>
      expect(mocks.redeemReward).toHaveBeenCalledWith({
        reward_id: 77,
        notes: 'Anniversary night',
      }),
    );
    expect(await screen.findByText(/Successfully redeemed: Free Night Voucher/)).toBeTruthy();
  });

  it('surfaces a failed redemption instead of the success banner', async () => {
    mocks.redeemReward.mockRejectedValueOnce(new Error('reward out of stock'));

    render(<LoyaltyDashboard />);

    fireEvent.click(await screen.findByText('Redeem Now'));
    fireEvent.click(await screen.findByText('Confirm Redemption'));

    expect(await screen.findByText('reward out of stock')).toBeTruthy();
    expect(screen.queryByText(/Successfully redeemed/)).toBeNull();
  });
});
