import { useQuery } from '@tanstack/react-query';
import { queryStaleTime } from '../../../api/queryConfig';
import { queryKeys } from '../../../api/queryKeys';
import { PortalPromotionsApi } from '../api/portalPromotionsApi';
import type { VoucherListParams } from '../types';
import { portalSessionScope } from '../utils';

export function useVoucherWallet(
  token?: string,
  params: VoucherListParams = { page: 1, page_size: 50 },
  enabled = true
) {
  const sessionScope = portalSessionScope(token);
  return useQuery({
    queryKey: queryKeys.promotions.portalVouchers(sessionScope, params),
    queryFn: () => PortalPromotionsApi.listVouchers(params, token),
    enabled: enabled && Boolean(token),
    staleTime: queryStaleTime.short,
  });
}
