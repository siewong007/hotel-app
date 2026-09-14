import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { PromotionsApi } from '../api/promotionsApi';
import type {
  Promotion,
  PromotionInput,
  PromotionLifecycleAction,
  PromotionListResponse,
  PromotionListParams,
  PromotionUpdateInput,
  VoucherIssueInput,
  VoucherListParams,
  VoucherRevokeInput,
} from '../types';

function replacePromotionInAdminLists(
  current: PromotionListResponse | undefined,
  updated: Promotion
): PromotionListResponse | undefined {
  if (!current?.items.some((promotion) => promotion.id === updated.id)) {
    return current;
  }
  return {
    ...current,
    items: current.items.map((promotion) =>
      promotion.id === updated.id ? updated : promotion
    ),
  };
}

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
    onSuccess: async (updatedPromotion) => {
      queryClient.setQueriesData<PromotionListResponse>(
        { queryKey: queryKeys.promotions.adminLists() },
        (current) => replacePromotionInAdminLists(current, updatedPromotion)
      );
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
      reason,
    }: {
      promotionId: number;
      action: PromotionLifecycleAction;
      expectedVersion?: number;
      reason?: string;
    }) =>
      PromotionsApi.transition(promotionId, action, {
        expected_version: expectedVersion,
        reason,
      }),
    onSuccess: async (updatedPromotion) => {
      queryClient.setQueriesData<PromotionListResponse>(
        { queryKey: queryKeys.promotions.adminLists() },
        (current) => replacePromotionInAdminLists(current, updatedPromotion)
      );
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

export function useAdminVoucher(voucherId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.adminVoucher(voucherId ?? 0),
    queryFn: () => PromotionsApi.getVoucher(voucherId as number),
    enabled: enabled && voucherId != null,
    staleTime: queryStaleTime.short,
  });
}

export function useVoucherSummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.voucherSummary(),
    queryFn: () => PromotionsApi.getVoucherSummary(),
    enabled,
    staleTime: queryStaleTime.short,
  });
}

export function useAdminPromotion(promotionId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.adminPromotionDetail(promotionId ?? 0),
    queryFn: () => PromotionsApi.getAdminPromotion(promotionId as number),
    enabled: enabled && promotionId != null,
    staleTime: queryStaleTime.short,
  });
}

export function useTargetingOptions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.promotions.targetingOptions(),
    queryFn: () => PromotionsApi.getTargetingOptions(),
    enabled,
    staleTime: queryStaleTime.long,
  });
}

export function useCampaignPerformance(
  promotionId: number | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.promotions.campaignPerformance(promotionId ?? 0),
    queryFn: () => PromotionsApi.getCampaignPerformance(promotionId as number),
    enabled: enabled && promotionId != null,
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
