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

import { GuestPortalService } from '../../../../api';
import type { Booking, Guest } from '../../../../types';
import { errorMessage } from '../../../../utils/errorMessage';
import { ConsentBlock, REGISTRATION_CONSENTS, useConsent, useLegalLocale } from '../../../legal';
import { setPortalToken } from '../../../guestPortal/api/portalTokenStore';

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
      setError('Please choose a username of at least 3 characters.');
      return;
    }
    if (password.length < 8) {
      setError('Your password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    // Checked here as well as on the server. The server is what makes it
    // binding; this is so the guest sees which box they missed.
    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setError('Please accept the booking terms and the privacy notice to continue.');
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
      const message = errorMessage(err, 'We could not create your account. Please try again.');
      // The backend conflicts when this guest already has a real login, which
      // is a dead end here rather than an error to retry: they need to sign in.
      setAlreadyClaimed(message.toLowerCase().includes('already exists'));
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Typography variant="h6" gutterBottom>
        Create your account
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        An account lets you verify your identity before you arrive, so check-in
        takes moments instead of minutes. You can also skip this and check in at
        the front desk as usual.
      </Typography>

      {booking?.booking_number && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Creating an account for booking <strong>{booking.booking_number}</strong>
          {guest?.nick_name ? ` · ${guest.nick_name}` : ''}
        </Typography>
      )}

      {error && (
        <Alert severity={alreadyClaimed ? 'info' : 'error'} sx={{ mb: 2 }}>
          {error}
          {alreadyClaimed && (
            <Box sx={{ mt: 1 }}>
              <Link href="/login">Sign in instead</Link>
            </Box>
          )}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            label="Username"
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
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            disabled={submitting}
            helperText="We will send a link to confirm this address."
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            type="password"
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            helperText="At least 8 characters."
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            type="password"
            label="Confirm password"
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
            Back
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="text" onClick={onSkip} disabled={submitting}>
          Skip for now
        </Button>
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </Button>
      </Stack>
    </Box>
  );
};

export default ClaimAccountStep;
