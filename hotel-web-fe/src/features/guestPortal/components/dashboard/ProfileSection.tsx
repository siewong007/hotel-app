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
import { guestErrorMessage } from '../../utils/feedback';
import { validatePhoneKey } from '../../../../utils/validation';
import { useTranslation } from '../../../../i18n';
import { ErrorState, LoadingState, SectionHeading } from './PortalDashboardSections';

const FOREST = 'var(--hotel-text)';
const GOLD_TEXT = 'var(--hotel-primary-text)';

/**
 * The backend's `missing_profile_fields` entries are translated under
 * `dashboard.profile.missingFields`; an unknown field falls back to its raw
 * server name.
 *
 * The verdict is the server's (`services::profile::completion_for_guest`) — the
 * portal never re-derives which fields are missing, so the banner here and the
 * guard that blocks a booking can never disagree.
 */
const MISSING_FIELD_KEYS: Record<string, string> = {
  first_name: 'dashboard.profile.missingFields.first_name',
  last_name: 'dashboard.profile.missingFields.last_name',
  phone: 'dashboard.profile.missingFields.phone',
};

/** Editable fields, in the order they appear in the form. */
const EDITABLE_FIELDS = [
  { key: 'first_name', required: true, autoComplete: 'given-name' },
  { key: 'last_name', required: true, autoComplete: 'family-name' },
  { key: 'title', required: false, autoComplete: 'honorific-prefix' },
  { key: 'phone', required: true, autoComplete: 'tel' },
  { key: 'alt_phone', required: false, autoComplete: 'tel' },
  { key: 'nationality', required: false, autoComplete: 'country-name' },
  { key: 'address_line1', required: false, autoComplete: 'address-line1' },
  { key: 'city', required: false, autoComplete: 'address-level2' },
  { key: 'state_province', required: false, autoComplete: 'address-level1' },
  { key: 'postal_code', required: false, autoComplete: 'postal-code' },
  { key: 'country', required: false, autoComplete: 'country-name' },
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
  const { t } = useTranslation('guestPortal');
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
      setLoadError(guestErrorMessage(error, t('dashboard.profile.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

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
    if (!values.first_name.trim()) errors.first_name = t('dashboard.profile.errors.firstNameRequired');
    if (!values.last_name.trim()) errors.last_name = t('dashboard.profile.errors.lastNameRequired');
    const phoneKey = validatePhoneKey(values.phone);
    if (phoneKey) errors.phone = t(`auth:${phoneKey}`);
    // Blank is allowed and clears the field; anything typed must be a real number.
    if (values.alt_phone.trim()) {
      const altKey = validatePhoneKey(values.alt_phone);
      if (altKey) errors.alt_phone = t(`auth:${altKey}`);
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
      setSaveError(guestErrorMessage(error, t('dashboard.profile.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label={t('dashboard.profile.loading')} />;
  if (loadError || !guest) {
    return (
      <ErrorState
        message={loadError ?? t('dashboard.profile.loadFailed')}
        retry={() => void load()}
      />
    );
  }

  return (
    <Box>
      <SectionHeading
        eyebrow={t('dashboard.profile.eyebrow')}
        title={t('dashboard.profile.title')}
        description={t('dashboard.profile.description')}
      />

      <Stack spacing={3}>
        {!profileComplete ? (
          <Alert severity="warning" role="alert" data-testid="profile-incomplete">
            <Typography sx={{ fontWeight: 600 }}>{t('dashboard.profile.incompleteTitle')}</Typography>
            <Typography variant="body2">
              {missingFields.length > 0
                ? t('dashboard.profile.incompleteFields', {
                    fields: missingFields
                      .map((field) => (MISSING_FIELD_KEYS[field] ? t(MISSING_FIELD_KEYS[field]) : field))
                      .join(', '),
                  })
                : t('dashboard.profile.incompleteGeneric')}{' '}
              {t('dashboard.profile.incompleteReason')}
            </Typography>
          </Alert>
        ) : null}

        {saved ? (
          <Alert
            severity="success"
            role="alert"
            icon={<CheckCircleOutlineIcon fontSize="inherit" />}
            onClose={() => setSaved(false)}
          >
            {t('dashboard.profile.saved')}
          </Alert>
        ) : null}

        <Paper
          component="section"
          aria-label={t('dashboard.profile.contactAria')}
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
                {t('dashboard.profile.contactTitle')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {t('dashboard.profile.contactSubtitle')}
              </Typography>
            </Box>
            {!editing ? (
              <Button
                variant="outlined"
                startIcon={<EditOutlinedIcon />}
                onClick={startEditing}
              >
                {t('dashboard.profile.edit')}
              </Button>
            ) : null}
          </Box>

          <Divider sx={{ my: 2.5 }} />

          {editing && values ? (
            <Box component="form" onSubmit={(event) => void submit(event)} noValidate>
              {saveError ? (
                <Alert severity="error" role="alert" sx={{ mb: 2 }}>
                  {saveError}
                </Alert>
              ) : null}
              <Grid container spacing={2}>
                {EDITABLE_FIELDS.map((field) => (
                  <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                    <TextField
                      fullWidth
                      label={t(`dashboard.profile.fields.${field.key}`)}
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
                  {saving ? t('dashboard.profile.saving') : t('dashboard.profile.save')}
                </Button>
                <Button variant="text" onClick={cancelEditing} disabled={saving}>
                  {t('common:actions.cancel')}
                </Button>
              </Stack>
            </Box>
          ) : (
            <Grid container spacing={2.5}>
              {EDITABLE_FIELDS.map((field) => (
                <ReadOnlyRow
                  key={field.key}
                  label={t(`dashboard.profile.fields.${field.key}`)}
                  value={typeof guest[field.key] === 'string' ? (guest[field.key] as string) : null}
                />
              ))}
            </Grid>
          )}
        </Paper>

        <Paper
          component="section"
          aria-label={t('dashboard.profile.identityAria')}
          variant="outlined"
          sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, bgcolor: 'var(--hotel-surface-raised)' }}
        >
          <Typography variant="h6" component="h3" sx={{ color: FOREST, fontWeight: 700 }}>
            {t('dashboard.profile.identityTitle')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('dashboard.profile.identitySubtitle')}
          </Typography>
          <Divider sx={{ my: 2.5 }} />
          <Grid container spacing={2.5}>
            <ReadOnlyRow label={t('dashboard.profile.email')} value={guest.email} />
            <ReadOnlyRow label={t('dashboard.profile.icNumber')} value={guest.ic_number} />
            <Grid size={{ xs: 12 }}>
              <Chip
                size="small"
                label={t('dashboard.profile.displayName', { name: guest.nick_name })}
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
