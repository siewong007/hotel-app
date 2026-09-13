import { api } from '../../api/client';
import type { RevenueOverview, RevenueOverviewParams } from './types';

function toSearchParams(params: RevenueOverviewParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });
  return searchParams;
}

export const RevenueApi = {
  overview(params: RevenueOverviewParams): Promise<RevenueOverview> {
    return api
      .get('revenue/overview', { searchParams: toSearchParams(params) })
      .json<RevenueOverview>();
  },
};
