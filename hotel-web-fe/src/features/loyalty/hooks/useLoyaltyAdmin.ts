import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoyaltyAdminService } from '../../../api/loyaltyAdmin.service';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import type {
  AdminRewardInput,
  AdminRewardUpdateInput,
  LoyaltyMemberQueryParams,
  LoyaltyRedemptionQueryParams,
  LoyaltyRewardQueryParams,
  LoyaltyRulesInput,
  GiftPointsInput,
  ManualAdjustmentInput,
  RejectRedemptionInput,
} from '../../../types';

const loyaltyKeys = queryKeys.loyalty;

function useInvalidateLoyalty() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: loyaltyKeys.all });
}

// --- Members ---
export function useLoyaltyMembers(params: LoyaltyMemberQueryParams = {}) {
  return useQuery({
    queryKey: loyaltyKeys.adminMembers(params),
    queryFn: () => LoyaltyAdminService.getMembers(params),
    staleTime: queryStaleTime.standard,
  });
}

export function useLoyaltyMemberDetail(id: number | null) {
  return useQuery({
    queryKey: loyaltyKeys.adminMemberDetail(id ?? 0),
    queryFn: () => LoyaltyAdminService.getMemberDetail(id as number),
    enabled: id != null,
    staleTime: queryStaleTime.standard,
  });
}

export function useAdjustPoints() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ManualAdjustmentInput }) =>
      LoyaltyAdminService.adjustPoints(id, input),
    onSuccess: invalidate,
  });
}

export function useGiftPoints() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: GiftPointsInput }) =>
      LoyaltyAdminService.giftPoints(id, input),
    onSuccess: invalidate,
  });
}

// --- Rules ---
export function useLoyaltyRules() {
  return useQuery({
    queryKey: loyaltyKeys.adminRules(),
    queryFn: () => LoyaltyAdminService.getRules(),
    staleTime: queryStaleTime.long,
  });
}

export function useUpdateLoyaltyRules() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: (input: LoyaltyRulesInput) => LoyaltyAdminService.updateRules(input),
    onSuccess: invalidate,
  });
}

// --- Rewards ---
export function useAdminLoyaltyRewards(params: LoyaltyRewardQueryParams = {}) {
  return useQuery({
    queryKey: loyaltyKeys.adminRewards(params),
    queryFn: () => LoyaltyAdminService.getRewards(params),
    staleTime: queryStaleTime.long,
  });
}

export function useCreateLoyaltyReward() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: (input: AdminRewardInput) => LoyaltyAdminService.createReward(input),
    onSuccess: invalidate,
  });
}

export function useUpdateLoyaltyReward() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AdminRewardUpdateInput }) =>
      LoyaltyAdminService.updateReward(id, input),
    onSuccess: invalidate,
  });
}

// --- Redemptions ---
export function useLoyaltyRedemptions(params: LoyaltyRedemptionQueryParams = {}) {
  return useQuery({
    queryKey: loyaltyKeys.adminRedemptions(params),
    queryFn: () => LoyaltyAdminService.getRedemptions(params),
    staleTime: queryStaleTime.standard,
  });
}

export function useApproveRedemption() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: (id: number) => LoyaltyAdminService.approveRedemption(id),
    onSuccess: invalidate,
  });
}

export function useRejectRedemption() {
  const invalidate = useInvalidateLoyalty();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: RejectRedemptionInput }) =>
      LoyaltyAdminService.rejectRedemption(id, input),
    onSuccess: invalidate,
  });
}
