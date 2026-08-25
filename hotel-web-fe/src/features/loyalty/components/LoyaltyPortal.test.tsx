import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// RulesTab syncs its form via useEffect keyed on the query data object, so the
// mocked data must keep a STABLE identity across renders or the effect loops.
const STABLE_RULES = {
  points_per_currency_unit: 1,
  tier_qualification_metric: 'points',
  point_expiry_months: null,
  min_eligible_amount: 0,
  redemption_approval_required: true,
  earning_enabled: true,
};

const mocks = vi.hoisted(() => ({
  members: [] as Array<Record<string, unknown>>,
  membersLoading: false,
  memberDetail: null as Record<string, unknown> | null,
  rewards: [] as Array<Record<string, unknown>>,
  redemptions: [] as Array<Record<string, unknown>>,
  giftPoints: vi.fn(),
  approveRedemption: vi.fn(),
  rejectRedemption: vi.fn(),
  updateRules: vi.fn(),
}));

vi.mock('../hooks/useLoyaltyAdmin', () => ({
  useLoyaltyMembers: () => ({
    data: mocks.members,
    isLoading: mocks.membersLoading,
    error: null,
  }),
  useLoyaltyMemberDetail: (id: number | null) => ({
    data: id == null ? undefined : mocks.memberDetail,
    isLoading: false,
    error: null,
  }),
  useLoyaltyRules: () => ({
    data: STABLE_RULES,
    isLoading: false,
    error: null,
  }),
  useLoyaltyRedemptions: () => ({
    data: mocks.redemptions,
    isLoading: false,
    error: null,
  }),
  useAdminLoyaltyRewards: () => ({
    data: mocks.rewards,
    isLoading: false,
    error: null,
  }),
  useGiftPoints: () => ({ mutateAsync: mocks.giftPoints, isPending: false }),
  useCreateLoyaltyReward: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateLoyaltyReward: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveRedemption: () => ({ mutateAsync: mocks.approveRedemption, isPending: false }),
  useRejectRedemption: () => ({ mutateAsync: mocks.rejectRedemption, isPending: false }),
  useUpdateLoyaltyRules: () => ({ mutateAsync: mocks.updateRules, isPending: false }),
}));

vi.mock('../hooks/useLoyaltySocket', () => ({
  useLoyaltySocket: () => ({ connected: true }),
}));

import LoyaltyPortal from './LoyaltyPortal';

const member = (overrides: Record<string, unknown> = {}) => ({
  id: 11,
  member_number: 'LM-0011',
  guest_name: 'Jane Doe',
  guest_email: 'jane@example.com',
  tier_name: 'Silver',
  status: 'active',
  available_points: 500,
  lifetime_points: 2500,
  enrolled_at: '2026-01-01',
  ...overrides,
});

const memberDetail = (base: Record<string, unknown>) => ({
  member: base,
  tier_progress: {
    metric: 'points',
    progress_percent: 37,
    next_tier_name: 'Gold',
    remaining_to_next_tier: 2500,
  },
  recent_activity: [],
});

async function switchTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

describe('LoyaltyPortal', () => {
  beforeEach(() => {
    mocks.members = [
      member(),
      member({ id: 12, member_number: 'LM-0012', guest_name: 'Bob Ray', status: 'closed', available_points: 10, lifetime_points: 20 }),
    ];
    mocks.membersLoading = false;
    mocks.rewards = [];
    mocks.redemptions = [];
    mocks.memberDetail = memberDetail(member());
    mocks.giftPoints.mockReset().mockResolvedValue(undefined);
    mocks.approveRedemption.mockReset().mockResolvedValue(undefined);
    mocks.rejectRedemption.mockReset().mockResolvedValue(undefined);
    mocks.updateRules.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('summarises the programme on the Overview tab', async () => {
    render(<LoyaltyPortal />);

    expect(await screen.findByText('Total members')).toBeTruthy();
    expect(screen.getByText('Available points')).toBeTruthy();
    // 500 + 10 available; 2500 + 20 lifetime
    expect(await screen.findByText('510')).toBeTruthy();
    expect(screen.getByText('2,520')).toBeTruthy();
    expect(await screen.findByText('Members by tier')).toBeTruthy();
  });

  it('lists members and opens the detail dialog from a row', async () => {
    render(<LoyaltyPortal />);
    await switchTab('Members');

    expect(await screen.findByText('LM-0011')).toBeTruthy();
    expect(screen.getByText('LM-0012')).toBeTruthy();

    fireEvent.click(screen.getByText('Jane Doe'));
    expect(await screen.findByText('Member details')).toBeTruthy();
    // The dialog stat card echoes the member name alongside the member number.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Jane Doe')).toBeTruthy();
  });

  it('shows the empty state when no members match', async () => {
    mocks.members = [];

    render(<LoyaltyPortal />);
    await switchTab('Members');

    expect(await screen.findByText('No members found')).toBeTruthy();
  });

  it('validates the gift-points form before submitting', async () => {
    render(<LoyaltyPortal />);
    await switchTab('Members');
    fireEvent.click(await screen.findByText('Jane Doe'));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gift points' }));
    expect(within(dialog).getByText('Enter a positive number of points')).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Points'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'hi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gift points' }));
    expect(within(dialog).getByText('Reason must be at least 5 characters')).toBeTruthy();
    expect(mocks.giftPoints).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Goodwill gesture' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gift points' }));
    await waitFor(() =>
      expect(mocks.giftPoints).toHaveBeenCalledWith({
        id: 11,
        input: { points: 50, reason: 'Goodwill gesture' },
      }),
    );
  });

  it('approves a pending redemption directly and rejects through a reason dialog', async () => {
    mocks.redemptions = [
      {
        id: 7,
        status: 'pending',
        reward_name: 'Free Night',
        guest_name: 'Jane Doe',
        member_number: 'LM-0011',
        points_spent: 500,
        created_at: '2026-08-01',
      },
    ];

    render(<LoyaltyPortal />);
    await switchTab('Redemptions');

    const row = await screen.findByText('Free Night').then(node => node.closest('tr')!);
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.approveRedemption).toHaveBeenCalledWith(7));

    fireEvent.click(within(row).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reject$/ }));
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Duplicate request' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Reject$/ }));
    await waitFor(() =>
      expect(mocks.rejectRedemption).toHaveBeenCalledWith({
        id: 7,
        input: { reason: 'Duplicate request' },
      }),
    );
  });

  it('saves programme rules and confirms success', async () => {
    render(<LoyaltyPortal />);
    await switchTab('Rules');

    fireEvent.change(await screen.findByLabelText('Points per currency unit'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() =>
      expect(mocks.updateRules).toHaveBeenCalledWith(
        expect.objectContaining({ points_per_currency_unit: 2 }),
      ),
    );
    expect(await screen.findByText('Rules saved')).toBeTruthy();
  });

  it('renders a loading spinner while the members query is in flight', async () => {
    mocks.membersLoading = true;

    render(<LoyaltyPortal />);
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText('Total members')).toBeNull();
  });
});
