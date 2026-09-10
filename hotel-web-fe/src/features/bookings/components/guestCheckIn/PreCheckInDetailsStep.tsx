/**
 * Pre-check-in details step.
 *
 * Only fields that BOTH `GuestPortalRepository::update_guest_precheckin`
 * persists AND the token endpoint returns are rendered: a field the backend
 * drops would look saved, and one the guest-safe view omits could never show
 * what is already on file. That intersection excludes first/last name — see
 * the note in the form body.
 */
import React, { useState } from 'react';
import { Alert, Box, Button, Grid, Stack, TextField, Typography } from '@mui/material';

import { GuestPortalService } from '../../../../api';
import type { Booking, Guest, GuestUpdateRequest } from '../../../../types';
import { errorMessage } from '../../../../utils/errorMessage';

export interface PreCheckInDetailsStepProps {
  token: string;
  guest: Guest | null;
  booking: Booking | null;
  onSaved: (result: { booking: Booking; guest: Guest }) => void;
  onSkip: () => void;
  onBack?: () => void;
}

/** Trimmed value, or `undefined` so an untouched field is not sent at all. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export const PreCheckInDetailsStep: React.FC<PreCheckInDetailsStepProps> = ({
  token,
  guest,
  booking,
  onSaved,
  onSkip,
  onBack,
}) => {
  const [email, setEmail] = useState(guest?.email ?? '');
  const [phone, setPhone] = useState(guest?.phone ?? '');
  const [icNumber, setIcNumber] = useState(guest?.ic_number ?? '');
  const [nationality, setNationality] = useState(guest?.nationality ?? '');
  const [addressLine1, setAddressLine1] = useState(guest?.address_line1 ?? '');
  const [city, setCity] = useState(guest?.city ?? '');
  const [postalCode, setPostalCode] = useState(guest?.postal_code ?? '');
  const [country, setCountry] = useState(guest?.country ?? '');
  const [specialRequests, setSpecialRequests] = useState(booking?.special_requests ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const guestUpdate: GuestUpdateRequest = {
      email: optional(email),
      phone: optional(phone),
      ic_number: optional(icNumber),
      nationality: optional(nationality),
      address_line1: optional(addressLine1),
      city: optional(city),
      postal_code: optional(postalCode),
      country: optional(country),
    };

    try {
      const result = await GuestPortalService.submitPreCheckin(token, {
        guest_update: guestUpdate,
        special_requests: optional(specialRequests),
      });
      onSaved(result);
    } catch (err) {
      setError(errorMessage(err, 'We could not save your details. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Typography variant="h6" gutterBottom>
        Your details
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Confirming these now means less to fill in at the front desk. Everything
        here is optional — leave anything blank and we will ask on arrival.
      </Typography>
      {/*
        No name field: the token endpoint returns the guest-safe view
        (`GuestPortalGuestView`), which carries `nick_name` but not
        first/last name, so the inputs could never show what is on file. The
        booked name is also what the account claim matches on, so changing it
        here would be actively confusing. Name corrections stay a front-desk job.
      */}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            type="email"
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="IC / Passport number"
            value={icNumber}
            onChange={(event) => setIcNumber(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Nationality"
            value={nationality}
            onChange={(event) => setNationality(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label="Address"
            value={addressLine1}
            onChange={(event) => setAddressLine1(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField
            fullWidth
            label="City"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            fullWidth
            label="Postcode"
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            disabled={saving}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Special requests"
            value={specialRequests}
            onChange={(event) => setSpecialRequests(event.target.value)}
            disabled={saving}
          />
        </Grid>
      </Grid>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 3 }}>
        {onBack && (
          <Button variant="text" onClick={onBack} disabled={saving}>
            Back
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="text" onClick={onSkip} disabled={saving}>
          Skip for now
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? 'Saving…' : 'Save and continue'}
        </Button>
      </Stack>
    </Box>
  );
};

export default PreCheckInDetailsStep;
