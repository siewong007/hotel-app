import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getAccessToken } from '../auth/tokenStore';
import { apiUrl } from '../desktop/runtimeApi';
import { invalidateDomain, type ApiDomain } from '../api/queryInvalidation';

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
const KNOWN_DOMAINS = new Set<ApiDomain>([
  'bookings',
  'guests',
  'rooms',
  'ledgers',
  'housekeeping',
  'night-audit',
]);

/**
 * Staff realtime feed: the backend publishes a `data_changed` event after any
 * client's successful mutation, and this hook invalidates the same query-key
 * groups the API client's own auto-invalidation uses — so a change made from
 * another session refreshes this screen too. Reconnects with capped
 * exponential backoff; each attempt re-reads the access token so a renewed
 * session keeps feeding updates.
 */
export function useDataChangeSocket(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      const token = getAccessToken();
      if (!token || disposed) return;

      const url = new URL(apiUrl('updates/socket'), window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url.toString(), ['hotel-updates', token]);

      socket.onopen = () => {
        attempts = 0;
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            event_type?: string;
            domain?: string;
          };
          if (event.event_type !== 'data_changed') return;
          if (event.domain && KNOWN_DOMAINS.has(event.domain as ApiDomain)) {
            invalidateDomain(queryClient, event.domain as ApiDomain);
          }
        } catch {
          // Ignore malformed or newer server events.
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        attempts += 1;
        const delay = Math.min(RECONNECT_BASE_MS * attempts, RECONNECT_MAX_MS);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient, enabled]);
}
