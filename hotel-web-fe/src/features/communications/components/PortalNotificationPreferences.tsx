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
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation } from '../../../i18n';

const FOREST = 'var(--hotel-text)';

const TOPIC_KEYS: Record<NotificationTopic, string> = {
  announcement: 'preferences.topics.announcement',
  promotion: 'preferences.topics.promotion',
  birthday_voucher: 'preferences.topics.birthday_voucher',
};

/** Per-topic email opt-in toggles shown on the guest portal dashboard. */
export default function PortalNotificationPreferences({ token }: { token: string }) {
  const { t } = useTranslation('guestPortal');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const errorRef = useAutoFocusError(error);
  const queryKey = ['portal', 'notification-preferences', portalSessionScope(token)] as const;

  const prefs = useQuery({
    queryKey,
    queryFn: () => PortalCommunicationsApi.getPreferences(token),
    retry: false,
  });

  const topicLabel = (topic: NotificationTopic): string => {
    const key = TOPIC_KEYS[topic];
    return key ? t(key) : (TOPIC_LABELS[topic] ?? topic);
  };

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
      setSavedMessage(
        t(change.subscribed ? 'preferences.savedEnabled' : 'preferences.savedDisabled', {
          topic: topicLabel(change.topic),
        }),
      );
    },
    onError: (mutationError, _change, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setError(guestErrorMessage(mutationError, t('preferences.saveFailed')));
    },
  });

  if (prefs.isLoading) return <CircularProgress size={24} aria-label={t('preferences.loadingAria')} />;
  if (prefs.isError) {
    return (
      <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={() => void prefs.refetch()}>{t('common:actions.retry')}</Button>}>
        {guestErrorMessage(prefs.error, t('preferences.loadFailed'))}
      </Alert>
    );
  }

  return (
    <Card variant="outlined" sx={{ borderColor: 'var(--hotel-border)', borderRadius: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700 }}>
          {t('preferences.title')}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.5,
            mb: 2
          }}>
          {t('preferences.subtitle')}
        </Typography>
        <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minHeight: savedMessage || error ? 40 : 0, mb: savedMessage || error ? 1.5 : 0 }}>
          {savedMessage ? <Alert severity="success" role="alert" sx={{ py: 0.25 }}>{savedMessage}</Alert> : null}
          {error ? (
          <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1} onClose={() => setError(null)} sx={{ py: 0.25 }}>
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
                bgcolor: s.subscribed ? 'var(--hotel-primary-subtle)' : 'var(--hotel-hover)'
              }}>
              <Box><Typography variant="body2" sx={{
                fontWeight: 600
              }}>{topicLabel(s.topic)}</Typography><Typography variant="caption" sx={{
                color: "text.secondary"
              }}>{s.subscribed ? t('preferences.enabled') : t('preferences.disabled')}</Typography></Box>
              <Switch
                checked={s.subscribed}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate({ topic: s.topic, subscribed: e.target.checked })
                }
                slotProps={{ input: { role: 'switch', 'aria-label': t('preferences.toggleAria', { topic: topicLabel(s.topic) }) } }}
              />
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
