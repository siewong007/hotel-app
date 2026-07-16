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
    let reconnectAttempts = 0;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(guestAvailabilityWebSocketUrl(), [
        'hotel-guest-availability',
        token,
      ]);
      socket.onmessage = (message) => {
        reconnectAttempts = 0;
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
