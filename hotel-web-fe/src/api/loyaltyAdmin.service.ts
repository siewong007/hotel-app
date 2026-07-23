import { api } from './client';
import type {
  AdminLoyaltyReward,
  AdminRewardInput,
  AdminRewardUpdateInput,
  LoyaltyMemberDetail,
  LoyaltyMemberQueryParams,
  LoyaltyMemberSummary,
  LoyaltyProgramRules,
  LoyaltyRedemption,
  LoyaltyRedemptionQueryParams,
  LoyaltyRewardQueryParams,
  LoyaltyRulesInput,
  LoyaltyTransaction,
  GiftPointsInput,
  ManualAdjustmentInput,
  RejectRedemptionInput,
} from '../types';

// Admin-facing loyalty API. Targets the live `modules::loyalty` router mounted
// at `/api` (e.g. `/api/admin/loyalty/members`). The `api` client prepends the
// `/api` prefix for non-root paths, so paths here are passed without it.

function toSearchParams(params: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      out[key] = String(value);
    }
  }
  return out;
}

export class LoyaltyAdminService {
  // --- Members ---
  static async getMembers(params: LoyaltyMemberQueryParams = {}): Promise<LoyaltyMemberSummary[]> {
    return await api
      .get('admin/loyalty/members', { searchParams: toSearchParams(params) })
      .json<LoyaltyMemberSummary[]>();
  }

  static async getMemberDetail(id: number): Promise<LoyaltyMemberDetail> {
    return await api.get(`admin/loyalty/members/${id}`).json<LoyaltyMemberDetail>();
  }

  static async adjustPoints(
    id: number,
    input: ManualAdjustmentInput
  ): Promise<LoyaltyTransaction> {
    return await api
      .post(`admin/loyalty/members/${id}/adjustments`, { json: input })
      .json<LoyaltyTransaction>();
  }

  static async giftPoints(id: number, input: GiftPointsInput): Promise<LoyaltyTransaction> {
    return await api
      .post(`admin/loyalty/members/${id}/gifts`, { json: input })
      .json<LoyaltyTransaction>();
  }

  // --- Program rules ---
  static async getRules(): Promise<LoyaltyProgramRules> {
    return await api.get('admin/loyalty/rules').json<LoyaltyProgramRules>();
  }

  static async updateRules(input: LoyaltyRulesInput): Promise<LoyaltyProgramRules> {
    return await api.put('admin/loyalty/rules', { json: input }).json<LoyaltyProgramRules>();
  }

  // --- Rewards ---
  static async getRewards(params: LoyaltyRewardQueryParams = {}): Promise<AdminLoyaltyReward[]> {
    return await api
      .get('admin/loyalty/rewards', { searchParams: toSearchParams(params) })
      .json<AdminLoyaltyReward[]>();
  }

  static async createReward(input: AdminRewardInput): Promise<AdminLoyaltyReward> {
    return await api.post('admin/loyalty/rewards', { json: input }).json<AdminLoyaltyReward>();
  }

  static async updateReward(
    id: number,
    input: AdminRewardUpdateInput
  ): Promise<AdminLoyaltyReward> {
    return await api
      .put(`admin/loyalty/rewards/${id}`, { json: input })
      .json<AdminLoyaltyReward>();
  }

  // --- Redemptions ---
  static async getRedemptions(
    params: LoyaltyRedemptionQueryParams = {}
  ): Promise<LoyaltyRedemption[]> {
    return await api
      .get('admin/loyalty/redemptions', { searchParams: toSearchParams(params) })
      .json<LoyaltyRedemption[]>();
  }

  static async approveRedemption(id: number): Promise<LoyaltyRedemption> {
    return await api.put(`admin/loyalty/redemptions/${id}/approve`).json<LoyaltyRedemption>();
  }

  static async rejectRedemption(
    id: number,
    input: RejectRedemptionInput
  ): Promise<LoyaltyRedemption> {
    return await api
      .put(`admin/loyalty/redemptions/${id}/reject`, { json: input })
      .json<LoyaltyRedemption>();
  }
}
