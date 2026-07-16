import { useEffect, useRef } from 'react';

import { guestAvailabilityWebSocketUrl } from './api';
import type { AvailabilityEvent } from './types';

export function useAvailabilitySocket(
  token: string | null,
  onAvailabilityChange: (event: AvailabilityEvent) => void,
): void {
  const callbackRef = useRef(onAvailabilityChange);
  callbackRef.current = onAvailabilityChange;

  useEffect(() => {
    if (!token) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(guestAvailabilityWebSocketUrl(), [
        'hotel-guest-availability',
        token,
      ]);
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as AvailabilityEvent;
          if (event.event_type === 'availability_changed') {
            callbackRef.current(event);
          }
        } catch {
          // Ignore malformed or forward-incompatible events.
        }
      };
      socket.onclose = () => {
        if (!stopped) {
          reconnectTimer = window.setTimeout(connect, 2000);
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
