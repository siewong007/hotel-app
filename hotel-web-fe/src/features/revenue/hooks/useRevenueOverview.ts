import { useQuery } from '@tanstack/react-query';

import { RevenueApi } from '../api';
import type { RevenueOverviewParams } from '../types';

export function useRevenueOverview(params: RevenueOverviewParams) {
  return useQuery({
    queryKey: ['revenue', 'overview', params],
    queryFn: () => RevenueApi.overview(params),
  });
}
