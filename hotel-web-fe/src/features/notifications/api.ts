import { api } from '../../api/client';
import type { DeliveryFeedParams, DeliveryFeedResponse } from './types';

function toSearchParams(params: DeliveryFeedParams): Record<string, string> {
  const search: Record<string, string> = {};
  if (params.tier && params.tier !== 'all') search.tier = params.tier;
  if (params.status) search.status = params.status;
  if (params.page) search.page = String(params.page);
  if (params.page_size) search.page_size = String(params.page_size);
  return search;
}

export function listDeliveries(
  params: DeliveryFeedParams,
): Promise<DeliveryFeedResponse> {
  return api
    .get('admin/communications/deliveries', { searchParams: toSearchParams(params) })
    .json<DeliveryFeedResponse>();
}
