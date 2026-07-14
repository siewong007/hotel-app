import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { PromotionsApi } from '../api/promotionsApi';
import { PortalPromotionsApi } from '../api/portalPromotionsApi';
import type { ClaimPromotionInput, PromotionListParams } from '../types';
import { portalSessionScope } from '../utils';

export function usePromotionCatalog(
  params: PromotionListParams = { page: 1, page_size: 50 },
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.promotions.publicCatalog(params),
    queryFn: () => PromotionsApi.listPublic(params),
    enabled,
    staleTime: queryStaleTime.standard,
  });
}

export function useGuestPromotionCatalog(
  token?: string,
  params: PromotionListParams = { page: 1, page_size: 50 },
  enabled = true
) {
  const sessionScope = portalSessionScope(token);
  return useQuery({
    queryKey: queryKeys.promotions.portalCatalog(sessionScope, params),
    queryFn: () => PortalPromotionsApi.listPromotions(params, token),
    enabled: enabled && Boolean(token),
    staleTime: queryStaleTime.short,
  });
}

export function useClaimPromotion(token?: string) {
  const queryClient = useQueryClient();
  const sessionScope = portalSessionScope(token);

  return useMutation({
    mutationFn: ({
      promotionId,
      input,
    }: {
      promotionId: number;
      input: ClaimPromotionInput;
    }) => PortalPromotionsApi.claim(promotionId, input, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.promotions.portal(sessionScope),
      });
    },
  });
}
