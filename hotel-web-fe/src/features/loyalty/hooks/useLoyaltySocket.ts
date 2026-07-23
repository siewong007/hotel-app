import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getAccessToken } from '../../../auth/tokenStore';
import { apiUrl } from '../../../desktop/runtimeApi';
import { queryKeys } from '../../../api/queryKeys';

export function useLoyaltySocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    const url = new URL(apiUrl('admin/loyalty/socket'), window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url.toString(), ['hotel-loyalty', token]);

    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as { event_type?: string };
        if (event.event_type === 'loyalty_member_updated') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.loyalty.all });
        }
      } catch {
        // Ignore malformed or newer server events.
      }
    };

    return () => socket.close();
  }, [queryClient]);
}
