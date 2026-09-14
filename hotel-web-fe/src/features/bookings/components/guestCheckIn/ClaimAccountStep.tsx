/**
 * Account step of the pre-check-in wizard.
 *
 * Calls `POST /guest-portal/claim-account` rather than `/auth/register`: the
 * booking already created a guest profile, and registration would insert a
 * second one (and refuse outright, since the name is taken). The account this
 * creates is bound to the booking's own guest, which is what makes the identity
 * step — keyed on `users.id` and resolved back through `guest_id` — reachable.
 *
 * On success the portal session goes straight into `portalTokenStore`, so the
 * identity step and the portal dashboard both pick it up without a sign-in.
 */
import React, { useState } from 'react';
import { Alert, Box, Button, Grid, Link, Stack, TextField, Typography } from '@mui/material';
import { isHTTPError } from 'ky';

import { GuestPortalService } from '../../../../api';
import { APIError } from '../../../../api/client';
import type { Booking, Guest } from '../../../../types';
import { guestErrorMessage } from '../../../guestPortal/utils/feedback';
import { ConsentBlock, REGISTRATION_CONSENTS, useConsent, useLegalLocale } from '../../../legal';
import { setPortalToken } from '../../../guestPortal/api/portalTokenStore';
import { useTranslation } from '../../../../i18n';

export interface ClaimAccountStepProps {
  token: string;
  booking: Booking | null;
  guest: Guest | null;
  onClaimed: (result: { portalToken: string; emailVerificationRequired: boolean }) => void;
  onSkip: () => void;
  onBack?: () => void;
}

export const ClaimAccountStep: React.FC<ClaimAccountStepProps> = ({
  token,
  booking,
  guest,
  onClaimed,
  onSkip,
  onBack,
}) => {
  const { t } = useTranslation('guestPortal');
  const { locale: legalLocale } = useLegalLocale();
  const consent = useConsent(REGISTRATION_CONSENTS);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState(guest?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (username.trim().length < 3) {
      setError(t('checkin.account.errors.username'));
      return;
    }
    if (password.length < 8) {
      setError(t('checkin.account.errors.password'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('checkin.account.errors.passwordMismatch'));
      return;
    }
    // Checked here as well as on the server. The server is what makes it
    // binding; this is so the guest sees which box they missed. The form-level
    // alert stays a single concise line — ConsentBlock's per-item helper text
    // names the specific agreement.
    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setError(t('checkin.account.errors.consentRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const consentPayload = consent.buildPayload(legalLocale);
      const response = await GuestPortalService.claimAccount(token, {
        booking_number: booking?.booking_number ?? '',
        guest_name: guest?.nick_name ?? '',
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        consents: consentPayload.consents,
        marketing_opt_in: consentPayload.marketing_opt_in,
      });

      setPortalToken(response.session.token, response.session.expires_at);
      onClaimed({
        portalToken: response.session.token,
        emailVerificationRequired: response.email_verification_required,
      });
    } catch (err) {
      // The backend answers 409 when this guest already has a real login —
      // a dead end here rather than an error to retry: they need to sign in.
      // Match on the status, never on the wording of the server's message.
      const status = isHTTPError(err)
        ? err.response.status
        : err instanceof APIError
          ? err.statusCode
          : undefined;
      setAlreadyClaimed(status === 409);
      setError(
        status === 409
          ? t('checkin.account.errors.alreadyClaimed')
          : guestErrorMessage(err, t('checkin.account.errors.claimFailed')),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Typography variant="h6" gutterBottom>
        {t('checkin.account.title')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('checkin.account.subtitle')}
      </Typography>

      {booking?.booking_number && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {t('checkin.account.forBooking')} <strong>{booking.booking_number}</strong>
          {guest?.nick_name ? t('checkin.account.nameSuffix', { name: guest.nick_name }) : ''}
        </Typography>
      )}

      {error && (
        <Alert severity={alreadyClaimed ? 'info' : 'error'} role="alert" sx={{ mb: 2 }}>
          {error}
          {alreadyClaimed && (
            <Box sx={{ mt: 1 }}>
              <Link href="/login">{t('checkin.account.signInInstead')}</Link>
            </Box>
          )}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            label={t('checkin.account.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            disabled={submitting}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            type="email"
            label={t('checkin.account.email')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            disabled={submitting}
            helperText={t('checkin.account.emailHint')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            type="password"
            label={t('checkin.account.password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            helperText={t('checkin.account.passwordHint')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            type="password"
            label={t('checkin.account.confirmPassword')}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            disabled={submitting}
          />
        </Grid>
      </Grid>

      <ConsentBlock prompts={REGISTRATION_CONSENTS} state={consent} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 3 }}>
        {onBack && (
          <Button variant="text" onClick={onBack} disabled={submitting}>
            {t('common:actions.back')}
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="text" onClick={onSkip} disabled={submitting}>
          {t('checkin.skipForNow')}
        </Button>
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? t('checkin.account.creating') : t('checkin.account.submit')}
        </Button>
      </Stack>
    </Box>
  );
};

export default ClaimAccountStep;
