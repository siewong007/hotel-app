import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
    },
  };
});

import { LoyaltyAdminService } from './loyaltyAdmin.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('LoyaltyAdminService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
  });

  describe('getMembers', () => {
    it('calls GET admin/loyalty/members with an empty searchParams object when no filters are given', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getMembers();

      expect(get).toHaveBeenCalledWith('admin/loyalty/members', { searchParams: {} });
    });

    it('forwards search and status, dropping undefined/null/empty-string values', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getMembers({ search: 'jane', status: 'active' });

      expect(get).toHaveBeenCalledWith('admin/loyalty/members', { searchParams: { search: 'jane', status: 'active' } });
    });

    it('omits a filter whose value is an empty string', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getMembers({ search: '' });

      expect(get).toHaveBeenCalledWith('admin/loyalty/members', { searchParams: {} });
    });
  });

  describe('getMemberDetail', () => {
    it('calls GET admin/loyalty/members/<id>', async () => {
      const detail = { member: {}, tier_progress: {}, recent_activity: [], redemptions: [] };
      get.mockReturnValue(mockJsonResponse(detail));

      const result = await LoyaltyAdminService.getMemberDetail(7);

      expect(get).toHaveBeenCalledWith('admin/loyalty/members/7');
      expect(result).toEqual(detail);
    });
  });

  describe('adjustPoints', () => {
    it('posts the adjustment as json to admin/loyalty/members/<id>/adjustments', async () => {
      const input = { points_delta: -50, reason: 'goodwill correction' };
      const txn = { id: 1 };
      post.mockReturnValue(mockJsonResponse(txn));

      const result = await LoyaltyAdminService.adjustPoints(7, input);

      expect(post).toHaveBeenCalledWith('admin/loyalty/members/7/adjustments', { json: input });
      expect(result).toEqual(txn);
    });
  });

  describe('giftPoints', () => {
    it('posts the gift as json to admin/loyalty/members/<id>/gifts', async () => {
      const input = { points: 100, reason: 'birthday gift' };
      const txn = { id: 2 };
      post.mockReturnValue(mockJsonResponse(txn));

      const result = await LoyaltyAdminService.giftPoints(7, input);

      expect(post).toHaveBeenCalledWith('admin/loyalty/members/7/gifts', { json: input });
      expect(result).toEqual(txn);
    });
  });

  describe('getRules', () => {
    it('calls GET admin/loyalty/rules', async () => {
      const rules = { id: 1, points_per_currency_unit: 1, tier_qualification_metric: 'points', redemption_approval_required: false, earning_enabled: true, min_eligible_amount: 0, updated_at: 'x' };
      get.mockReturnValue(mockJsonResponse(rules));

      const result = await LoyaltyAdminService.getRules();

      expect(get).toHaveBeenCalledWith('admin/loyalty/rules');
      expect(result).toEqual(rules);
    });
  });

  describe('updateRules', () => {
    it('puts the input as json to admin/loyalty/rules', async () => {
      const input = { points_per_currency_unit: 2, tier_qualification_metric: 'spend' as const, redemption_approval_required: true, earning_enabled: true, min_eligible_amount: 10 };
      const updated = { ...input, id: 1, updated_at: 'x' };
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await LoyaltyAdminService.updateRules(input);

      expect(put).toHaveBeenCalledWith('admin/loyalty/rules', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('getRewards', () => {
    it('calls GET admin/loyalty/rewards with an empty searchParams object when no filters are given', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getRewards();

      expect(get).toHaveBeenCalledWith('admin/loyalty/rewards', { searchParams: {} });
    });

    it('forwards include_inactive and category', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getRewards({ include_inactive: true, category: 'spa' });

      expect(get).toHaveBeenCalledWith('admin/loyalty/rewards', { searchParams: { include_inactive: 'true', category: 'spa' } });
    });
  });

  describe('createReward', () => {
    it('posts the input as json to admin/loyalty/rewards', async () => {
      const input = { name: 'Free Spa', category: 'spa', points_cost: 500 };
      const created = { id: 1, ...input, requires_approval: false, is_active: true, created_at: 'x', updated_at: 'x' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await LoyaltyAdminService.createReward(input);

      expect(post).toHaveBeenCalledWith('admin/loyalty/rewards', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updateReward', () => {
    it('puts the input as json to admin/loyalty/rewards/<id>', async () => {
      const input = { points_cost: 600 };
      const updated = { id: 3, name: 'Free Spa', category: 'spa', points_cost: 600, requires_approval: false, is_active: true, created_at: 'x', updated_at: 'x' };
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await LoyaltyAdminService.updateReward(3, input);

      expect(put).toHaveBeenCalledWith('admin/loyalty/rewards/3', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('getRedemptions', () => {
    it('calls GET admin/loyalty/redemptions with an empty searchParams object when no filters are given', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getRedemptions();

      expect(get).toHaveBeenCalledWith('admin/loyalty/redemptions', { searchParams: {} });
    });

    it('forwards status', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyAdminService.getRedemptions({ status: 'pending' });

      expect(get).toHaveBeenCalledWith('admin/loyalty/redemptions', { searchParams: { status: 'pending' } });
    });
  });

  describe('approveRedemption', () => {
    it('puts admin/loyalty/redemptions/<id>/approve with no body', async () => {
      const redemption = { id: 5, status: 'approved' };
      put.mockReturnValue(mockJsonResponse(redemption));

      const result = await LoyaltyAdminService.approveRedemption(5);

      expect(put).toHaveBeenCalledWith('admin/loyalty/redemptions/5/approve');
      expect(result).toEqual(redemption);
    });
  });

  describe('rejectRedemption', () => {
    it('puts the rejection reason as json to admin/loyalty/redemptions/<id>/reject', async () => {
      const redemption = { id: 5, status: 'rejected' };
      put.mockReturnValue(mockJsonResponse(redemption));

      const result = await LoyaltyAdminService.rejectRedemption(5, { reason: 'out of stock' });

      expect(put).toHaveBeenCalledWith('admin/loyalty/redemptions/5/reject', { json: { reason: 'out of stock' } });
      expect(result).toEqual(redemption);
    });
  });
});
