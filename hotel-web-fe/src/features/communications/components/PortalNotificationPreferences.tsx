import { useState } from 'react';
import {
  Alert,
  Button,
  Box,
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
import { portalSessionScope } from '../../promotions/utils';

const FOREST = '#06110e';

/** Per-topic email opt-in toggles shown on the guest portal dashboard. */
export default function PortalNotificationPreferences({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const queryKey = ['portal', 'notification-preferences', portalSessionScope(token)] as const;

  const prefs = useQuery({
    queryKey,
    queryFn: () => PortalCommunicationsApi.getPreferences(token),
    retry: false,
  });

  const update = useMutation({
    mutationFn: (change: { topic: NotificationTopic; subscribed: boolean }) =>
      PortalCommunicationsApi.updatePreferences({ subscriptions: [change] }, token),
    onMutate: async (change) => {
      setError(null);
      setSavedMessage(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<typeof prefs.data>(queryKey);
      queryClient.setQueryData<typeof prefs.data>(queryKey, current => current ? {
        ...current,
        subscriptions: current.subscriptions.map(subscription =>
          subscription.topic === change.topic
            ? { ...subscription, subscribed: change.subscribed }
            : subscription
        ),
      } : current);
      return { previous, change };
    },
    onSuccess: (data, change) => {
      queryClient.setQueryData(queryKey, data);
      setSavedMessage(`${TOPIC_LABELS[change.topic] ?? change.topic} emails ${change.subscribed ? 'enabled' : 'disabled'}.`);
    },
    onError: (mutationError, _change, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setError(mutationError instanceof Error ? mutationError.message : 'We could not save your email preferences.');
    },
  });

  if (prefs.isLoading) return <CircularProgress size={24} aria-label="Loading email preferences" />;
  if (prefs.isError) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void prefs.refetch()}>Retry</Button>}>
        {prefs.error instanceof Error ? prefs.error.message : 'We could not load your email preferences.'}
      </Alert>
    );
  }

  return (
    <Card variant="outlined" sx={{ borderColor: 'rgba(6,17,14,.14)', borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700 }}>
          Email preferences
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.5,
            mb: 2
          }}>
          You only receive the email topics you choose. All optional communications require your opt-in.
        </Typography>
        <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minHeight: savedMessage || error ? 40 : 0, mb: savedMessage || error ? 1.5 : 0 }}>
          {savedMessage ? <Alert severity="success" sx={{ py: 0.25 }}>{savedMessage}</Alert> : null}
          {error ? (
          <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0.25 }}>
            {error}
          </Alert>) : null}
        </Box>
        <Stack spacing={1}>
          {(prefs.data?.subscriptions ?? []).map((s) => (
            <Stack
              key={s.topic}
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "center",
                minHeight: 52,
                px: 1.5,
                borderRadius: 2,
                bgcolor: s.subscribed ? 'rgba(217,181,114,.16)' : 'rgba(6,17,14,.03)'
              }}>
              <Box><Typography variant="body2" sx={{
                fontWeight: 600
              }}>{TOPIC_LABELS[s.topic] ?? s.topic}</Typography><Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{s.subscribed ? 'Email updates enabled' : 'Email updates disabled'}</Typography></Box>
              <Switch
                checked={s.subscribed}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({ topic: s.topic, subscribed: e.target.checked })
                }
                slotProps={{ input: { role: 'switch', 'aria-label': `toggle ${s.topic} emails` } }}
              />
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
