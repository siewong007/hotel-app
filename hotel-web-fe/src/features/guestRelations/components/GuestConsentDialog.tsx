import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  Typography,
} from '@mui/material';
import { errorMessage } from '../../../utils';
import type { GuestSubscription } from '../../../types';
import { useTranslation } from '../../../i18n/useTranslation';
import { TOPIC_LABELS, type NotificationTopic } from '../../communications/types';
import { useRecordGuestConsent } from '../hooks/useGuestRelationsQueries';

const TOPICS: NotificationTopic[] = ['announcement', 'promotion', 'birthday_voucher'];

type TopicDraft = Record<NotificationTopic, boolean>;

const draftFrom = (subscriptions: GuestSubscription[]): TopicDraft => {
  const draft: TopicDraft = {
    announcement: false,
    promotion: false,
    birthday_voucher: false,
  };
  for (const topic of TOPICS) {
    draft[topic] =
      subscriptions.find((s) => s.channel === 'email' && s.topic === topic)?.subscribed ?? false;
  }
  return draft;
};

interface GuestConsentDialogProps {
  open: boolean;
  guestId: number;
  guestName: string;
  /** Current `GuestCommunicationsSummary.subscriptions` — seeds the toggles on open. */
  subscriptions: GuestSubscription[];
  onClose: () => void;
  onSaved?: (message: string) => void;
}

/**
 * Staff-side consent editor — records email-topic opt-ins on the guest's
 * behalf via `POST /admin/communications/guests/{id}/consent`
 * (`communications:manage`). Only topics changed from the open-time baseline
 * are submitted, so consent events are written for real decisions rather than
 * restated defaults.
 */
const GuestConsentDialog: React.FC<GuestConsentDialogProps> = ({
  open,
  guestId,
  guestName,
  subscriptions,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation('guests');
  return (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>{t('consent.title', { name: guestName })}</DialogTitle>
    {/* Mounted fresh on each open so the draft seeds from the latest
        subscriptions via useState initializers (no effect needed — the React
        Compiler lint forbids dep-array escapes). */}
    {open && (
      <ConsentForm
        guestId={guestId}
        guestName={guestName}
        subscriptions={subscriptions}
        onClose={onClose}
        onSaved={onSaved}
      />
    )}
  </Dialog>
  );
};

interface ConsentFormProps {
  guestId: number;
  guestName: string;
  subscriptions: GuestSubscription[];
  onClose: () => void;
  onSaved?: (message: string) => void;
}

const ConsentForm: React.FC<ConsentFormProps> = ({
  guestId,
  guestName,
  subscriptions,
  onClose,
  onSaved,
}) => {
  const { t, tOr } = useTranslation('guests');
  const recordConsent = useRecordGuestConsent();
  const [baseline] = useState<TopicDraft>(() => draftFrom(subscriptions));
  const [draft, setDraft] = useState<TopicDraft>(baseline);
  const [formError, setFormError] = useState<string | null>(null);

  const changedSubscriptions = TOPICS.filter((topic) => draft[topic] !== baseline[topic]).map(
    (topic) => ({ topic, subscribed: draft[topic] }),
  );

  const handleSubmit = async () => {
    if (changedSubscriptions.length === 0) {
      onClose();
      return;
    }
    try {
      setFormError(null);
      await recordConsent.mutateAsync({
        guestId,
        data: { subscriptions: changedSubscriptions },
      });
      onSaved?.(t('consent.updated', { name: guestName }));
      onClose();
    } catch (err) {
      setFormError(errorMessage(err, t('consent.failed')));
    }
  };

  return (
    <>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {formError && (
            <Alert severity="error" onClose={() => setFormError(null)}>
              {formError}
            </Alert>
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('consent.description')}
          </Typography>
          {TOPICS.map((topic) => (
            <FormControlLabel
              key={topic}
              control={
                <Switch
                  checked={draft[topic]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [topic]: event.target.checked }))
                  }
                  slotProps={{ input: { role: 'switch', 'aria-label': t('consent.toggleAria', { topic }) } }}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {/* intentional: dynamic key — consent topic is a DB enum value; unknown topics use TOPIC_LABELS */}
                    {tOr(`consent.topics.${topic}`, TOPIC_LABELS[topic] ?? topic)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {draft[topic] ? t('consent.optedIn') : t('consent.optedOut')}
                  </Typography>
                </Box>
              }
            />
          ))}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('consent.footnote')}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => void handleSubmit()}
          disabled={recordConsent.isPending || changedSubscriptions.length === 0}
        >
          {recordConsent.isPending ? t('common:state.saving') : t('consent.save')}
        </Button>
      </DialogActions>
    </>
  );
};

export default GuestConsentDialog;
