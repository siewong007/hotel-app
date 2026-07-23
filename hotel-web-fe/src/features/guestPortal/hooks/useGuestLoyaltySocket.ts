import { useEffect, useRef } from 'react';
import { apiUrl } from '../../../desktop/runtimeApi';

export function useGuestLoyaltySocket(token: string, onMemberUpdated: () => void): void {
  const callback = useRef(onMemberUpdated);
  callback.current = onMemberUpdated;

  useEffect(() => {
    const url = new URL(apiUrl('guest-portal/me/loyalty/socket'), window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url.toString(), ['hotel-guest-loyalty', token]);
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as { event_type?: string };
        if (event.event_type === 'loyalty_member_updated') callback.current();
      } catch {
        // Ignore malformed or newer server events.
      }
    };
    return () => socket.close();
  }, [token]);
}
