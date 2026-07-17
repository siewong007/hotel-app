import { useEffect, useRef } from 'react';

import { guestSupportWebSocketUrl } from '../api/guestPortalSupport.service';

export function useSupportSocket(token: string | null, onConversationChanged: () => void): void {
  const callbackRef = useRef(onConversationChanged);
  callbackRef.current = onConversationChanged;

  useEffect(() => {
    if (!token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let reconnectAttempts = 0;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(guestSupportWebSocketUrl(), ['hotel-guest-support', token]);
      socket.onmessage = (message) => {
        reconnectAttempts = 0;
        try {
          const event = JSON.parse(String(message.data)) as { event_type?: string };
          if (event.event_type === 'conversation_changed') {
            callbackRef.current();
          }
        } catch {
          // Ignore malformed or forward-incompatible events.
        }
      };
      socket.onclose = () => {
        if (!stopped) {
          const backoffMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
          const jitterMs = Math.floor(Math.random() * 500);
          reconnectAttempts += 1;
          reconnectTimer = window.setTimeout(connect, backoffMs + jitterMs);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token]);
}
