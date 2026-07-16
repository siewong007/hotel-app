import { useState } from 'react';
import {
  Alert,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PortalCommunicationsApi } from '../api';
import { TOPIC_LABELS, type NotificationTopic } from '../types';

/** Per-topic email opt-in toggles shown on the guest portal dashboard. */
export default function PortalNotificationPreferences() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const prefs = useQuery({
    queryKey: ['portal', 'notification-preferences'],
    queryFn: () => PortalCommunicationsApi.getPreferences(),
    retry: false,
  });

  const update = useMutation({
    mutationFn: (change: { topic: NotificationTopic; subscribed: boolean }) =>
      PortalCommunicationsApi.updatePreferences({ subscriptions: [change] }),
    onSuccess: (data) =>
      queryClient.setQueryData(['portal', 'notification-preferences'], data),
    onError: (e) => setError(e instanceof Error ? e.message : 'Update failed'),
  });

  if (prefs.isLoading) return <CircularProgress size={24} />;
  if (prefs.isError) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Email preferences
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Tell us which emails you want to receive. Everything is off unless you opt in.
        </Typography>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={0.5}>
          {(prefs.data?.subscriptions ?? []).map((s) => (
            <Stack
              key={s.topic}
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="body2">{TOPIC_LABELS[s.topic] ?? s.topic}</Typography>
              <Switch
                size="small"
                checked={s.subscribed}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({ topic: s.topic, subscribed: e.target.checked })
                }
                inputProps={{ 'aria-label': `toggle ${s.topic} emails` }}
              />
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
