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
import { type NotificationTopic } from '../types';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation } from '../../../i18n';
import { formatStatusLabel } from '../../../utils/formatters';
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';

const TOPIC_KEYS: Record<NotificationTopic, string> = {
  announcement: 'preferences.topics.announcement',
  promotion: 'preferences.topics.promotion',
  birthday_voucher: 'preferences.topics.birthday_voucher',
};

/**
 * Public email-preferences page reached from the unsubscribe link in every
 * outgoing email. Authenticated solely by the signed token in the URL.
 */
export default function UnsubscribePage({ token }: { token: string }) {
  const { t } = useTranslation('guestPortal');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const errorRef = useAutoFocusError(error);

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
    onMutate: () => {
      setError(null);
      setDone(false);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['unsubscribe', token], data);
      setDone(true);
    },
    onError: (e) => setError(guestErrorMessage(e, t('unsubscribe.saveFailed'))),
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
        <Alert severity="error" role="alert">
          {t('unsubscribe.invalidLink')}
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
            {t('unsubscribe.title')}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2
            }}>
            {t('unsubscribe.subtitle')}
          </Typography>
          {error && (
            <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1} onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {done && (
            <Alert severity="success" role="alert" sx={{ mb: 2 }}>
              {t('unsubscribe.saved')}
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
                <Typography>{TOPIC_KEYS[s.topic] ? t(TOPIC_KEYS[s.topic]) : formatStatusLabel(s.topic)}</Typography>
                <Switch
                  checked={s.subscribed}
                  disabled={!s.subscribed || apply.isPending}
                  onChange={() => apply.mutate({ topic: s.topic })}
                  slotProps={{
                    input: {
                      'aria-label': t('unsubscribe.toggleAria', {
                        topic: TOPIC_KEYS[s.topic] ? t(TOPIC_KEYS[s.topic]) : formatStatusLabel(s.topic),
                      }),
                    }
                  }}
                />
              </Stack>
            ))}
          </Stack>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {t('unsubscribe.note')}
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Button
            fullWidth
            color="error"
            variant="outlined"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ global: true })}
          >
            {t('unsubscribe.allButton')}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
