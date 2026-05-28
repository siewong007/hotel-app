import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HotelAPIService } from '../../../api';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import type { LoyaltyReward, RedeemRewardInput, RewardInput, RewardUpdateInput } from '../../../types';

export const loyaltyQueryKeys = queryKeys.loyalty;

export function useAdminRewards() {
  return useQuery({
    queryKey: loyaltyQueryKeys.rewards(),
    queryFn: () => HotelAPIService.getRewards(),
    staleTime: queryStaleTime.long,
  });
}

export function useMyLoyaltyRewards(enabled = true) {
  return useQuery({
    queryKey: loyaltyQueryKeys.myRewards(),
    queryFn: () => HotelAPIService.getLoyaltyRewards(),
    enabled,
    staleTime: queryStaleTime.long,
  });
}

export function useMyLoyaltyMembership(enabled = true) {
  return useQuery({
    queryKey: loyaltyQueryKeys.myMembership(),
    queryFn: () => HotelAPIService.getUserLoyaltyMembership(),
    enabled,
    staleTime: queryStaleTime.standard,
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
