import { api, toApiError } from './client';
import {
  LoyaltyProgram,
  LoyaltyMembership,
  PointsTransaction,
  LoyaltyMembershipWithDetails,
  LoyaltyStatistics,
  UserLoyaltyMembership,
  LoyaltyReward,
  RedeemRewardInput,
  RewardInput,
  RewardUpdateInput,
  RewardRedemption,
} from '../types';

export class LoyaltyService {
  // Loyalty Program Operations
  static async getAllLoyaltyPrograms(): Promise<LoyaltyProgram[]> {
    return await api.get('loyalty/programs').json<LoyaltyProgram[]>();
  }

  static async getAllLoyaltyMemberships(): Promise<LoyaltyMembershipWithDetails[]> {
    return await api.get('loyalty/memberships').json<LoyaltyMembershipWithDetails[]>();
  }

  static async getLoyaltyMembershipsByGuest(guestId: string): Promise<LoyaltyMembership[]> {
    return await api.get(`loyalty/guests/${guestId}/memberships`).json<LoyaltyMembership[]>();
  }

  static async getPointsTransactions(membershipId: number): Promise<PointsTransaction[]> {
    return await api.get(`loyalty/memberships/${membershipId}/transactions`).json<PointsTransaction[]>();
  }

  static async getLoyaltyStatistics(): Promise<LoyaltyStatistics> {
    return await api.get('loyalty/statistics').json<LoyaltyStatistics>();
  }

  static async addPointsToMembership(membershipId: number, points: number, description?: string): Promise<PointsTransaction> {
    return await api.post(`loyalty/memberships/${membershipId}/points/add`, {
      json: { points, description }
    }).json<PointsTransaction>();
  }

  static async redeemPoints(membershipId: number, points: number, description?: string): Promise<PointsTransaction> {
    return await api.post(`loyalty/memberships/${membershipId}/points/redeem`, {
      json: { points, description }
    }).json<PointsTransaction>();
  }

  // User Loyalty Operations
  static async getUserLoyaltyMembership(): Promise<UserLoyaltyMembership> {
    return await api.get('loyalty/my-membership').json<UserLoyaltyMembership>();
  }

  static async getLoyaltyRewards(): Promise<LoyaltyReward[]> {
    return await api.get('loyalty/rewards').json<LoyaltyReward[]>();
  }

  static async redeemReward(input: RedeemRewardInput): Promise<any> {
    return await api.post('loyalty/rewards/redeem', {
      json: input
    }).json();
  }

  // Rewards Management (Admin)
  static async getRewards(category?: string): Promise<LoyaltyReward[]> {
    const searchParams = category ? { category } : {};
    return await api.get('api/rewards', { searchParams }).json<LoyaltyReward[]>();
  }

  static async getReward(id: number): Promise<LoyaltyReward> {
    return await api.get(`api/rewards/${id}`).json<LoyaltyReward>();
  }

  static async createReward(data: RewardInput): Promise<LoyaltyReward> {
    try {
      return await api.post('api/rewards', { json: data }).json<LoyaltyReward>();
    } catch (error) {
      throw toApiError(error, 'Failed to create reward');
    }
  }

  static async updateReward(id: number, data: RewardUpdateInput): Promise<LoyaltyReward> {
    try {
      return await api.put(`api/rewards/${id}`, { json: data }).json<LoyaltyReward>();
    } catch (error) {
      throw toApiError(error, 'Failed to update reward');
    }
  }

  static async deleteReward(id: number): Promise<void> {
    try {
      await api.delete(`api/rewards/${id}`);
    } catch (error) {
      throw toApiError(error, 'Failed to delete reward');
    }
  }

  static async getRewardRedemptions(): Promise<RewardRedemption[]> {
    try {
      return await api.get('rewards/redemptions').json<RewardRedemption[]>();
    } catch (error) {
      throw toApiError(error, 'Failed to fetch redemption history');
    }
  }
}
