import { useQuery } from '@tanstack/react-query';

import { listDeliveries } from '../api';
import type { DeliveryFeedParams } from '../types';

const IDLE_POLL_MS = 60_000;
const OPEN_POLL_MS = 15_000;

/**
 * Server-backed feed for the notification center. `open` tightens polling so
 * an open panel tracks near-real-time while a closed bell idles gently.
 */
export function useDeliveryFeed(
  params: DeliveryFeedParams,
  open: boolean,
) {
  return useQuery({
    queryKey: ['notifications', 'feed', params.tier ?? 'all', params.status ?? '', params.page ?? 1],
    queryFn: () => listDeliveries({ page_size: 10, ...params }),
    staleTime: 15_000,
    refetchInterval: open ? OPEN_POLL_MS : IDLE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}
