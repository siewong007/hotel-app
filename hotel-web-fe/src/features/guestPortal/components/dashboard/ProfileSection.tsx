import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import { GuestPortalDashboardService } from '../../api/guestPortalDashboard.service';
import type {
  GuestPortalGuest,
  GuestPortalMeResponse,
  GuestPortalProfileUpdate,
} from '../../../../types';
import { errorMessage } from '../../../../utils/errorMessage';
import { validatePhone } from '../../../../utils/validation';
import { ErrorState, LoadingState, SectionHeading } from './PortalDashboardSections';

const FOREST = 'var(--hotel-text)';
const GOLD_TEXT = 'var(--hotel-primary-text)';

/**
 * How the backend's `missing_profile_fields` entries read to a guest.
 *
 * The verdict is the server's (`services::profile::completion_for_guest`) — the
 * portal never re-derives which fields are missing, so the banner here and the
 * guard that blocks a booking can never disagree.
 */
const MISSING_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone number',
};

/** Editable fields, in the order they appear in the form. */
const EDITABLE_FIELDS = [
  { key: 'first_name', label: 'First name', required: true, autoComplete: 'given-name' },
  { key: 'last_name', label: 'Last name', required: true, autoComplete: 'family-name' },
  { key: 'title', label: 'Title', required: false, autoComplete: 'honorific-prefix' },
  { key: 'phone', label: 'Phone number', required: true, autoComplete: 'tel' },
  { key: 'alt_phone', label: 'Alternate phone', required: false, autoComplete: 'tel' },
  { key: 'nationality', label: 'Nationality', required: false, autoComplete: 'country-name' },
  { key: 'address_line1', label: 'Address', required: false, autoComplete: 'address-line1' },
  { key: 'city', label: 'City', required: false, autoComplete: 'address-level2' },
  { key: 'state_province', label: 'State or province', required: false, autoComplete: 'address-level1' },
  { key: 'postal_code', label: 'Postcode', required: false, autoComplete: 'postal-code' },
  { key: 'country', label: 'Country', required: false, autoComplete: 'country-name' },
] as const;

type EditableKey = (typeof EDITABLE_FIELDS)[number]['key'];

type FormValues = Record<EditableKey, string>;

function toFormValues(guest: GuestPortalGuest): FormValues {
  const read = (key: EditableKey) => {
    const value = guest[key];
    return typeof value === 'string' ? value : '';
  };
  return EDITABLE_FIELDS.reduce((values, field) => {
    values[field.key] = read(field.key);
    return values;
  }, {} as FormValues);
}

/**
 * Trims every field and drops the empty optional ones, so clearing a field
 * sends `null` (the backend stores NULL) rather than an empty string.
 */
function toPayload(values: FormValues): GuestPortalProfileUpdate {
  const optional = (value: string) => (value.trim() ? value.trim() : null);
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    phone: values.phone.trim(),
    alt_phone: optional(values.alt_phone),
    title: optional(values.title),
    nationality: optional(values.nationality),
    address_line1: optional(values.address_line1),
    city: optional(values.city),
    state_province: optional(values.state_province),
    postal_code: optional(values.postal_code),
    country: optional(values.country),
  };
}

function ReadOnlyRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography sx={{ color: FOREST, fontWeight: 500, wordBreak: 'break-word' }}>
        {value?.trim() ? value : '—'}
      </Typography>
    </Grid>
  );
}

/**
 * The guest's own contact details: what the hotel holds, what is still missing,
 * and a form to put it right.
 *
 * Email and IC number are shown but never editable here — email is the login
 * identifier and the IC number is identity data the hotel verifies through
 * eKYC, so both change through their own flows rather than a contact form.
 */
export function ProfileSection({ token }: { token: string }) {
  const [me, setMe] = useState<GuestPortalMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FormValues | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EditableKey, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMe(await GuestPortalDashboardService.me(token));
    } catch (error) {
      setLoadError(errorMessage(error, 'We could not load your profile.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const guest = me?.guest;
  const missingFields = useMemo(
    () => me?.missing_profile_fields ?? [],
    [me?.missing_profile_fields]
  );
  // Absent means complete: a portal backend predating the field must not trap
  // the guest behind a banner they have no way to clear.
  const profileComplete = me?.profile_complete ?? true;

  const startEditing = () => {
    if (!guest) return;
    setValues(toFormValues(guest));
    setFieldErrors({});
    setSaveError(null);
    setSaved(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setValues(null);
    setFieldErrors({});
    setSaveError(null);
  };

  const setField = (key: EditableKey, value: string) => {
    setValues((current) => (current ? { ...current, [key]: value } : current));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values) return;

    const errors: Partial<Record<EditableKey, string>> = {};
    if (!values.first_name.trim()) errors.first_name = 'First name is required';
    if (!values.last_name.trim()) errors.last_name = 'Last name is required';
    const phoneError = validatePhone(values.phone);
    if (phoneError) errors.phone = phoneError;
    // Blank is allowed and clears the field; anything typed must be a real number.
    if (values.alt_phone.trim()) {
      const altError = validatePhone(values.alt_phone);
      if (altError) errors.alt_phone = altError;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      // The response is the refreshed `/me`, so `profile_complete` comes back
      // from the server rather than being inferred from what we just sent.
      setMe(await GuestPortalDashboardService.updateProfile(toPayload(values), token));
      setEditing(false);
      setValues(null);
      setSaved(true);
    } catch (error) {
      setSaveError(errorMessage(error, 'We could not save your profile.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Loading your profile…" />;
  if (loadError || !guest) {
    return (
      <ErrorState
        message={loadError ?? 'We could not load your profile.'}
        retry={() => void load()}
      />
    );
  }

  return (
    <Box>
      <SectionHeading
        eyebrow="Your account"
        title="Profile"
        description="The details we use to reach you about a stay. Keeping them current means confirmations and check-in reminders arrive where you expect them."
      />

      <Stack spacing={3}>
        {!profileComplete ? (
          <Alert severity="warning" data-testid="profile-incomplete">
            <Typography sx={{ fontWeight: 600 }}>Your profile is incomplete</Typography>
            <Typography variant="body2">
              {missingFields.length > 0
                ? `Please add: ${missingFields
                    .map((field) => MISSING_FIELD_LABELS[field] ?? field)
                    .join(', ')}.`
                : 'Please add your remaining contact details.'}{' '}
              We need these before you can book online.
            </Typography>
          </Alert>
        ) : null}

        {saved ? (
          <Alert
            severity="success"
            icon={<CheckCircleOutlineIcon fontSize="inherit" />}
            onClose={() => setSaved(false)}
          >
            Your profile has been saved.
          </Alert>
        ) : null}

        <Paper
          component="section"
          aria-label="Contact details"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, bgcolor: 'var(--hotel-surface-raised)' }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h3" sx={{ color: FOREST, fontWeight: 700 }}>
                Contact details
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                How the hotel reaches you, and where we send your confirmations.
              </Typography>
            </Box>
            {!editing ? (
              <Button
                variant="outlined"
                startIcon={<EditOutlinedIcon />}
                onClick={startEditing}
              >
                Edit
              </Button>
            ) : null}
          </Box>

          <Divider sx={{ my: 2.5 }} />

          {editing && values ? (
            <Box component="form" onSubmit={(event) => void submit(event)} noValidate>
              {saveError ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {saveError}
                </Alert>
              ) : null}
              <Grid container spacing={2}>
                {EDITABLE_FIELDS.map((field) => (
                  <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                    <TextField
                      fullWidth
                      label={field.label}
                      required={field.required}
                      autoComplete={field.autoComplete}
                      value={values[field.key]}
                      onChange={(event) => setField(field.key, event.target.value)}
                      error={Boolean(fieldErrors[field.key])}
                      helperText={fieldErrors[field.key] ?? ' '}
                    />
                  </Grid>
                ))}
              </Grid>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1 }}>
                <Button type="submit" variant="contained" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
                <Button variant="text" onClick={cancelEditing} disabled={saving}>
                  Cancel
                </Button>
              </Stack>
            </Box>
          ) : (
            <Grid container spacing={2.5}>
              {EDITABLE_FIELDS.map((field) => (
                <ReadOnlyRow
                  key={field.key}
                  label={field.label}
                  value={typeof guest[field.key] === 'string' ? (guest[field.key] as string) : null}
                />
              ))}
            </Grid>
          )}
        </Paper>

        <Paper
          component="section"
          aria-label="Identity details"
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, bgcolor: 'var(--hotel-surface-raised)' }}
        >
          <Typography variant="h6" component="h3" sx={{ color: FOREST, fontWeight: 700 }}>
            Identity
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            These identify your account, so they are not edited from this form. Contact the hotel
            to change them.
          </Typography>
          <Divider sx={{ my: 2.5 }} />
          <Grid container spacing={2.5}>
            <ReadOnlyRow label="Email" value={guest.email} />
            <ReadOnlyRow label="ID / IC number" value={guest.ic_number} />
            <Grid size={{ xs: 12 }}>
              <Chip
                size="small"
                label={`Display name: ${guest.nick_name}`}
                sx={{ bgcolor: 'var(--hotel-primary-subtle)', color: GOLD_TEXT, fontWeight: 600 }}
              />
            </Grid>
          </Grid>
        </Paper>
      </Stack>
    </Box>
  );
}

export default ProfileSection;
