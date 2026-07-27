import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicCommunicationsApi } from '../api';
import { TOPIC_LABELS, type NotificationTopic } from '../types';

/**
 * Public email-preferences page reached from the unsubscribe link in every
 * outgoing email. Authenticated solely by the signed token in the URL.
 */
export default function UnsubscribePage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const prefs = useQuery({
    queryKey: ['unsubscribe', token],
    queryFn: () => PublicCommunicationsApi.view(token),
    retry: false,
  });

  const apply = useMutation({
    mutationFn: (arg: { topic?: NotificationTopic; global?: boolean }) =>
      arg.global
        ? PublicCommunicationsApi.unsubscribeAll(token)
        : PublicCommunicationsApi.unsubscribeTopic(token, arg.topic!),
    onSuccess: (data) => {
      queryClient.setQueryData(['unsubscribe', token], data);
      setDone(true);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Request failed'),
  });

  if (prefs.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (prefs.isError) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
        <Alert severity="error">
          This unsubscribe link is invalid or no longer available. If you keep receiving
          unwanted email, please contact the hotel directly.
        </Alert>
      </Box>
    );
  }

  const subscriptions = prefs.data?.subscriptions ?? [];

  return (
    <Box sx={{ maxWidth: 520, mx: 'auto', mt: 6, px: 2 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Email preferences
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2
            }}>
            Choose which emails you would like to receive from us.
          </Typography>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {done && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Your preferences were updated.
            </Alert>
          )}
          <Stack spacing={1}>
            {subscriptions.map((s) => (
              <Stack
                key={s.topic}
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                <Typography>{TOPIC_LABELS[s.topic] ?? s.topic}</Typography>
                <Switch
                  checked={s.subscribed}
                  disabled={!s.subscribed || apply.isPending}
                  onChange={() => apply.mutate({ topic: s.topic })}
                  slotProps={{
                    input: { 'aria-label': `unsubscribe from ${s.topic}` }
                  }}
                />
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Turning a topic off takes effect immediately. To subscribe again, sign in to the
            guest portal.
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Button
            fullWidth
            color="error"
            variant="outlined"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ global: true })}
          >
            Unsubscribe from all emails
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
