import { useQuery } from '@tanstack/react-query';

import { listDeliveries } from '../api';
import type { DeliveryFeedParams } from '../types';

const IDLE_POLL_MS = 60_000;
const OPEN_POLL_MS = 15_000;

/**
 * Server-backed feed for the notification center. `open` tightens polling so
 * an open panel tracks near-real-time while a closed bell idles gently.
 * `enabled` is the caller's `communications:read`: without it the endpoint
 * answers 403, and the API client turns every refusal into a "no permission"
 * toast and notification-center entry, one per poll.
 */
export function useDeliveryFeed(
  params: DeliveryFeedParams,
  enabled: boolean,
  open: boolean,
) {
  return useQuery({
    queryKey: ['notifications', 'feed', params.tier ?? 'all', params.status ?? '', params.page ?? 1],
    queryFn: () => listDeliveries({ page_size: 10, ...params }),
    staleTime: 15_000,
    refetchInterval: open ? OPEN_POLL_MS : IDLE_POLL_MS,
    refetchIntervalInBackground: false,
    enabled,
  });
}
