import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTPError } from 'ky';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { LoyaltyService } from './loyalty.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

/** Methods that chain `.json()` onto the api call must reject from that
 * `.json()` call — a bare rejected mock return value is never awaited. */
function mockJsonRejection(error: unknown) {
  return { json: () => Promise.reject(error) };
}

function buildHttpError(status: number, body: unknown, url = 'http://localhost/api/rewards') {
  const response = new Response(JSON.stringify(body), { status, statusText: 'Error' });
  const request = new Request(url, { method: 'POST' });
  return new HTTPError(response, request, {} as any);
}

describe('LoyaltyService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
  });

  describe('getAllLoyaltyPrograms', () => {
    it('calls GET loyalty/programs', async () => {
      const programs = [{ id: 1 }];
      get.mockReturnValue(mockJsonResponse(programs));

      const result = await LoyaltyService.getAllLoyaltyPrograms();

      expect(get).toHaveBeenCalledWith('loyalty/programs');
      expect(result).toEqual(programs);
    });
  });

  describe('getAllLoyaltyMemberships', () => {
    it('calls GET loyalty/memberships', async () => {
      const memberships = [{ id: 1 }];
      get.mockReturnValue(mockJsonResponse(memberships));

      const result = await LoyaltyService.getAllLoyaltyMemberships();

      expect(get).toHaveBeenCalledWith('loyalty/memberships');
      expect(result).toEqual(memberships);
    });
  });

  describe('getLoyaltyMembershipsByGuest', () => {
    it('calls GET loyalty/guests/<guestId>/memberships', async () => {
      const memberships = [{ id: 1 }];
      get.mockReturnValue(mockJsonResponse(memberships));

      const result = await LoyaltyService.getLoyaltyMembershipsByGuest('7');

      expect(get).toHaveBeenCalledWith('loyalty/guests/7/memberships');
      expect(result).toEqual(memberships);
    });
  });

  describe('getPointsTransactions', () => {
    it('calls GET loyalty/memberships/<id>/transactions', async () => {
      const transactions = [{ id: '1' }];
      get.mockReturnValue(mockJsonResponse(transactions));

      const result = await LoyaltyService.getPointsTransactions(3);

      expect(get).toHaveBeenCalledWith('loyalty/memberships/3/transactions');
      expect(result).toEqual(transactions);
    });
  });

  describe('getLoyaltyStatistics', () => {
    it('calls GET loyalty/statistics', async () => {
      const stats = { total_members: 10 };
      get.mockReturnValue(mockJsonResponse(stats));

      const result = await LoyaltyService.getLoyaltyStatistics();

      expect(get).toHaveBeenCalledWith('loyalty/statistics');
      expect(result).toEqual(stats);
    });
  });

  describe('addPointsToMembership', () => {
    it('posts points and description as json to loyalty/memberships/<id>/points/add', async () => {
      const txn = { id: '1' };
      post.mockReturnValue(mockJsonResponse(txn));

      const result = await LoyaltyService.addPointsToMembership(3, 100, 'bonus');

      expect(post).toHaveBeenCalledWith('loyalty/memberships/3/points/add', { json: { points: 100, description: 'bonus' } });
      expect(result).toEqual(txn);
    });

    it('forwards an undefined description when omitted', async () => {
      post.mockReturnValue(mockJsonResponse({ id: '1' }));

      await LoyaltyService.addPointsToMembership(3, 100);

      expect(post).toHaveBeenCalledWith('loyalty/memberships/3/points/add', { json: { points: 100, description: undefined } });
    });
  });

  describe('redeemPoints', () => {
    it('posts points and description as json to loyalty/memberships/<id>/points/redeem', async () => {
      const txn = { id: '1' };
      post.mockReturnValue(mockJsonResponse(txn));

      const result = await LoyaltyService.redeemPoints(3, 50, 'reward redemption');

      expect(post).toHaveBeenCalledWith('loyalty/memberships/3/points/redeem', { json: { points: 50, description: 'reward redemption' } });
      expect(result).toEqual(txn);
    });
  });

  describe('getUserLoyaltyMembership', () => {
    it('calls GET loyalty/my-membership', async () => {
      const membership = { id: 1, membership_number: 'M1' };
      get.mockReturnValue(mockJsonResponse(membership));

      const result = await LoyaltyService.getUserLoyaltyMembership();

      expect(get).toHaveBeenCalledWith('loyalty/my-membership');
      expect(result).toEqual(membership);
    });
  });

  describe('getLoyaltyRewards', () => {
    it('calls GET loyalty/rewards', async () => {
      const rewards = [{ id: 1 }];
      get.mockReturnValue(mockJsonResponse(rewards));

      const result = await LoyaltyService.getLoyaltyRewards();

      expect(get).toHaveBeenCalledWith('loyalty/rewards');
      expect(result).toEqual(rewards);
    });
  });

  describe('redeemReward', () => {
    it('posts the redemption input as json to loyalty/rewards/redeem', async () => {
      const response = { id: 1, status: 'redeemed' };
      post.mockReturnValue(mockJsonResponse(response));

      const result = await LoyaltyService.redeemReward({ reward_id: 5 });

      expect(post).toHaveBeenCalledWith('loyalty/rewards/redeem', { json: { reward_id: 5 } });
      expect(result).toEqual(response);
    });
  });

  describe('getRewards (admin)', () => {
    it('calls GET api/rewards with no searchParams when no category is given', async () => {
      get.mockReturnValue(mockJsonResponse([]));

      await LoyaltyService.getRewards();

      expect(get).toHaveBeenCalledWith('api/rewards', { searchParams: {} });
    });

    it('forwards category as a search param when provided', async () => {
      const rewards = [{ id: 1, category: 'spa' }];
      get.mockReturnValue(mockJsonResponse(rewards));

      const result = await LoyaltyService.getRewards('spa');

      expect(get).toHaveBeenCalledWith('api/rewards', { searchParams: { category: 'spa' } });
      expect(result).toEqual(rewards);
    });
  });

  describe('getReward', () => {
    it('calls GET api/rewards/<id>', async () => {
      const reward = { id: 4 };
      get.mockReturnValue(mockJsonResponse(reward));

      const result = await LoyaltyService.getReward(4);

      expect(get).toHaveBeenCalledWith('api/rewards/4');
      expect(result).toEqual(reward);
    });
  });

  describe('createReward', () => {
    it('posts the input as json to api/rewards', async () => {
      const input = { name: 'Free Spa', category: 'spa', points_cost: 500, minimum_tier_level: 1 };
      const created = { id: 1, ...input, is_active: true, created_at: 'x', updated_at: 'x' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await LoyaltyService.createReward(input);

      expect(post).toHaveBeenCalledWith('api/rewards', { json: input });
      expect(result).toEqual(created);
    });

    it('wraps an HTTPError into an APIError with the server message', async () => {
      post.mockReturnValue(mockJsonRejection(buildHttpError(400, { error: 'Invalid category' })));

      await expect(
        LoyaltyService.createReward({ name: 'X', category: 'bad', points_cost: 1, minimum_tier_level: 1 }),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Invalid category', statusCode: 400 });
    });

    it('falls back to a generic message when the error is not an HTTPError', async () => {
      post.mockReturnValue(mockJsonRejection(new Error('offline')));

      await expect(
        LoyaltyService.createReward({ name: 'X', category: 'spa', points_cost: 1, minimum_tier_level: 1 }),
      ).rejects.toMatchObject({ name: 'APIError', message: 'Failed to create reward' });
    });
  });

  describe('updateReward', () => {
    it('puts the input as json to api/rewards/<id>', async () => {
      const input = { points_cost: 600 };
      const updated = { id: 4, points_cost: 600 };
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await LoyaltyService.updateReward(4, input);

      expect(put).toHaveBeenCalledWith('api/rewards/4', { json: input });
      expect(result).toEqual(updated);
    });

    it('wraps an HTTPError into an APIError', async () => {
      put.mockReturnValue(mockJsonRejection(buildHttpError(404, { error: 'Reward not found' })));

      await expect(LoyaltyService.updateReward(999, {})).rejects.toMatchObject({
        name: 'APIError',
        message: 'Reward not found',
        statusCode: 404,
      });
    });
  });

  describe('deleteReward', () => {
    it('calls DELETE api/rewards/<id>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await LoyaltyService.deleteReward(4);

      expect(del).toHaveBeenCalledWith('api/rewards/4');
    });

    it('wraps an HTTPError into an APIError', async () => {
      del.mockReturnValue(Promise.reject(buildHttpError(403, { error: 'Not permitted' })));

      await expect(LoyaltyService.deleteReward(4)).rejects.toMatchObject({
        name: 'APIError',
        message: 'Not permitted',
        statusCode: 403,
      });
    });
  });

  describe('getRewardRedemptions', () => {
    it('calls GET rewards/redemptions', async () => {
      const redemptions = [{ id: 1, guest_name: 'Jane', guest_email: 'a@b.com', reward_name: 'Spa', category: 'spa', points_spent: 500, redeemed_at: 'x', status: 'completed' }];
      get.mockReturnValue(mockJsonResponse(redemptions));

      const result = await LoyaltyService.getRewardRedemptions();

      expect(get).toHaveBeenCalledWith('rewards/redemptions');
      expect(result).toEqual(redemptions);
    });

    it('wraps an HTTPError into an APIError', async () => {
      get.mockReturnValue(mockJsonRejection(buildHttpError(500, { error: 'Server error' })));

      await expect(LoyaltyService.getRewardRedemptions()).rejects.toMatchObject({
        name: 'APIError',
        message: 'Server error',
        statusCode: 500,
      });
    });
  });
});
