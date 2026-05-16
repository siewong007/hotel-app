import { useEffect, useRef, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import {
  API_NOTIFICATION_EVENT,
  ApiNotificationDetail,
} from '../../utils/apiNotifications';

interface QueuedNotification extends ApiNotificationDetail {
  id: number;
}

const DEDUPE_WINDOW_MS = 1500;

export function ApiNotificationHost() {
  const [queue, setQueue] = useState<QueuedNotification[]>([]);
  const [activeNotification, setActiveNotification] = useState<QueuedNotification | null>(null);
  const nextIdRef = useRef(1);
  const recentNotificationsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const handleNotification = (event: Event) => {
      const detail = (event as CustomEvent<ApiNotificationDetail>).detail;
      if (!detail?.message) return;

      const now = Date.now();
      recentNotificationsRef.current.forEach((seenAt, key) => {
        if (now - seenAt >= DEDUPE_WINDOW_MS) {
          recentNotificationsRef.current.delete(key);
        }
      });
      const dedupeKey = detail.message;
      const lastSeenAt = recentNotificationsRef.current.get(dedupeKey);

      if (lastSeenAt && now - lastSeenAt < DEDUPE_WINDOW_MS) return;

      recentNotificationsRef.current.set(dedupeKey, now);
      setQueue((current) => [
        ...current,
        {
          ...detail,
          id: nextIdRef.current++,
        },
      ]);
    };

    window.addEventListener(API_NOTIFICATION_EVENT, handleNotification);
    return () => window.removeEventListener(API_NOTIFICATION_EVENT, handleNotification);
  }, []);

  useEffect(() => {
    if (activeNotification || queue.length === 0) return;

    const [nextNotification, ...remainingNotifications] = queue;
    setActiveNotification(nextNotification);
    setQueue(remainingNotifications);
  }, [activeNotification, queue]);

  const handleClose = () => {
    setActiveNotification(null);
  };

  return (
    <Snackbar
      key={activeNotification?.id}
      open={Boolean(activeNotification)}
      autoHideDuration={activeNotification?.severity === 'error' ? 6500 : 5000}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Alert
        onClose={handleClose}
        severity={activeNotification?.severity ?? 'info'}
        variant="filled"
        sx={{ width: '100%', maxWidth: 420 }}
      >
        {activeNotification?.message}
      </Alert>
    </Snackbar>
  );
}
