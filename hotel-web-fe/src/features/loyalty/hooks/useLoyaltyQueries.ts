import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HotelAPIService } from '../../../api';
import type { LoyaltyReward, RedeemRewardInput, RewardInput, RewardUpdateInput } from '../../../types';

const loyaltyRoot = ['loyalty'] as const;

export const loyaltyQueryKeys = {
  all: loyaltyRoot,
  statistics: () => [...loyaltyRoot, 'statistics'] as const,
  rewards: () => [...loyaltyRoot, 'rewards'] as const,
  myRewards: () => [...loyaltyRoot, 'my-rewards'] as const,
  myMembership: () => [...loyaltyRoot, 'my-membership'] as const,
};

export function useAdminRewards() {
  return useQuery({
    queryKey: loyaltyQueryKeys.rewards(),
    queryFn: () => HotelAPIService.getRewards(),
  });
}

export function useMyLoyaltyRewards(enabled = true) {
  return useQuery({
    queryKey: loyaltyQueryKeys.myRewards(),
    queryFn: () => HotelAPIService.getLoyaltyRewards(),
    enabled,
  });
}

export function useMyLoyaltyMembership(enabled = true) {
  return useQuery({
    queryKey: loyaltyQueryKeys.myMembership(),
    queryFn: () => HotelAPIService.getUserLoyaltyMembership(),
    enabled,
  });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RedeemRewardInput) => HotelAPIService.redeemReward(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loyaltyQueryKeys.all });
    },
  });
}

export function useCreateReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RewardInput) => HotelAPIService.createReward(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loyaltyQueryKeys.all });
    },
  });
}

export function useUpdateReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: RewardUpdateInput }) =>
      HotelAPIService.updateReward(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loyaltyQueryKeys.all });
    },
  });
}

export function useDeleteReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => HotelAPIService.deleteReward(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: loyaltyQueryKeys.all });
    },
  });
}

export type { LoyaltyReward };
