import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoyaltyReward } from '../../../types';

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  rewards: [] as LoyaltyReward[],
  getRewards: vi.fn(),
  createReward: vi.fn(),
  updateReward: vi.fn(),
  deleteReward: vi.fn(),
  getEkycStatus: vi.fn(),
  api: {
    getUserLoyaltyMembership: vi.fn(),
    getLoyaltyRewards: vi.fn(),
  },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasPermission: (p: string) => mocks.permissions.has(p) }),
}));

vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ symbol: 'RM', currency: 'MYR' }),
}));

// Admin flows pull every service through the src/api barrel — mock there.
vi.mock('../../../api', () => ({
  EkycService: {
    getEkycStatus: (...args: unknown[]) => mocks.getEkycStatus(...args),
  },
  LoyaltyService: {
    getRewards: (...args: unknown[]) => mocks.getRewards(...args),
    createReward: (...args: unknown[]) => mocks.createReward(...args),
    updateReward: (...args: unknown[]) => mocks.updateReward(...args),
    deleteReward: (...args: unknown[]) => mocks.deleteReward(...args),
    redeemReward: vi.fn(),
    getUserLoyaltyMembership: (...args: unknown[]) =>
      mocks.api.getUserLoyaltyMembership(...args),
    getLoyaltyRewards: (...args: unknown[]) => mocks.api.getLoyaltyRewards(...args),
    getTransactions: vi.fn(),
  },
}));

import LoyaltyDashboard from './LoyaltyDashboard';
import type { UserLoyaltyMembership } from '../utils';

const memberMembership = (): UserLoyaltyMembership => ({
  id: 1,
  membership_number: 'M-0001',
  points_balance: 1000,
  lifetime_points: 1000,
  tier_level: 2,
  tier_name: 'Silver',
  status: 'active',
  enrolled_date: '2026-01-01',
  current_tier_benefits: [],
  recent_transactions: [],
});

const reward = (overrides: Partial<LoyaltyReward> = {}): LoyaltyReward =>
  ({
    id: 77,
    name: 'Free Night Voucher',
    description: 'One night, any room type',
    category: 'room_upgrade',
    points_cost: 500,
    minimum_tier_level: 2,
    minimum_tier_id: 2,
    stock_quantity: null,
    monetary_value: null,
    is_active: true,
    ...overrides,
  }) as LoyaltyReward;

describe('LoyaltyDashboard admin view', () => {
  beforeEach(() => {
    mocks.permissions = new Set(['loyalty:manage']);
    mocks.rewards = [reward()];
    mocks.getRewards.mockReset().mockResolvedValue(mocks.rewards);
    mocks.getEkycStatus.mockReset().mockRejectedValue(new Error('must not be called for admins'));
    mocks.createReward.mockReset().mockResolvedValue({ id: 78 });
    mocks.updateReward.mockReset().mockResolvedValue(undefined);
    mocks.deleteReward.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(cleanup);

  it('lists rewards with cost, tier and unlimited stock — without touching eKYC', async () => {
    render(<LoyaltyDashboard />);

    expect(await screen.findByText('Rewards Management')).toBeTruthy();
    expect(await screen.findByText('Free Night Voucher')).toBeTruthy();
    expect(screen.getByText('500')).toBeTruthy();
    expect(screen.getByText('Silver')).toBeTruthy(); // tier chip from minimum_tier_level
    expect(screen.getByText('∞')).toBeTruthy(); // null stock renders as unlimited
    expect(mocks.getEkycStatus).not.toHaveBeenCalled();
  });

  it('creates a reward through the dialog', async () => {
    render(<LoyaltyDashboard />);
    await screen.findByText('Rewards Management');

    fireEvent.click(screen.getByRole('button', { name: 'Create Reward' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Create Reward')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Spa Credit' } });
    fireEvent.change(within(dialog).getByLabelText('Points Cost'), { target: { value: '1200' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mocks.createReward).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Spa Credit', points_cost: 1200 }),
      ),
    );
  });

  it('edits an existing reward with prefilled fields', async () => {
    render(<LoyaltyDashboard />);
    const row = await screen.findByText('Free Night Voucher').then(node => node.closest('tr')!);
    const [editButton] = within(row).getAllByRole('button');

    fireEvent.click(editButton);
    expect(await screen.findByText('Edit Reward')).toBeTruthy();

    const nameField = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameField.value).toBe('Free Night Voucher');

    fireEvent.change(screen.getByLabelText('Points Cost'), { target: { value: '750' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(mocks.updateReward).toHaveBeenCalledWith(
        77,
        expect.objectContaining({ points_cost: 750 }),
      ),
    );
  });

  it('deletes a reward only after confirmation', async () => {
    render(<LoyaltyDashboard />);
    const row = await screen.findByText('Free Night Voucher').then(node => node.closest('tr')!);
    const buttons = within(row).getAllByRole('button');
    const deleteButton = buttons[buttons.length - 1];

    fireEvent.click(deleteButton);
    expect(await screen.findByText('Delete Reward')).toBeTruthy();
    expect(screen.getByText(/This action cannot be undone/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.deleteReward).toHaveBeenCalledWith(77));
  });

  it('shows members the catalog instead of the management table', async () => {
    mocks.permissions = new Set();
    // Member path needs eKYC approval plus a membership to render its tabs.
    mocks.getEkycStatus.mockResolvedValue({ status: 'approved' });
    mocks.api.getUserLoyaltyMembership.mockResolvedValue(memberMembership());
    mocks.api.getLoyaltyRewards.mockResolvedValue([reward()]);

    render(<LoyaltyDashboard />);

    expect(await screen.findByText(/Rewards Catalog/i)).toBeTruthy();
    expect(screen.queryByText('Rewards Management')).toBeNull();
  });
});
