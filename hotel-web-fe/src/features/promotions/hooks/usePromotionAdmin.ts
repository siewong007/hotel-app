import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { PromotionsApi } from '../api/promotionsApi';
import type {
  PromotionInput,
  PromotionLifecycleAction,
  PromotionListParams,
  PromotionUpdateInput,
  VoucherIssueInput,
  VoucherListParams,
  VoucherRevokeInput,
} from '../types';

export function useAdminPromotions(params: PromotionListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.adminList(params),
    queryFn: () => PromotionsApi.listAdmin(params),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useCreatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PromotionInput) => PromotionsApi.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
    },
  });
}

export function useUpdatePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      promotionId,
      input,
    }: {
      promotionId: number;
      input: PromotionUpdateInput;
    }) => PromotionsApi.update(promotionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
    },
  });
}

export function usePromotionTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      promotionId,
      action,
      expectedVersion,
    }: {
      promotionId: number;
      action: PromotionLifecycleAction;
      expectedVersion?: number;
    }) =>
      PromotionsApi.transition(promotionId, action, {
        expected_version: expectedVersion,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
    },
  });
}

export function useAdminVouchers(params: VoucherListParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.adminVouchers(params),
    queryFn: () => PromotionsApi.listVouchers(params),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useIssueVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: VoucherIssueInput) => PromotionsApi.issueVoucher(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
    },
  });
}

export function useRevokeVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      voucherId,
      input,
    }: {
      voucherId: number;
      input?: VoucherRevokeInput;
    }) => PromotionsApi.revokeVoucher(voucherId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.promotions.all });
    },
  });
}
