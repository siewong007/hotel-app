import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';

import { GuestPortalDashboardService } from '../../api/guestPortalDashboard.service';
import type { GuestPortalEkycStatus, GuestPortalEkycSubmission } from '../../../../types';
import {
  isIdBackRequired,
  validateEkycFields,
  type EkycFieldValues,
} from '../../../ekyc/utils/ekycFieldRules';
import { guestErrorMessage } from '../../utils/feedback';
import { useTranslation } from '../../../../i18n';
import { useAutoFocusError } from '../../../../hooks/useAutoFocusError';
import { ErrorState, LoadingState, SectionHeading } from './PortalDashboardSections';
import { formatPortalDate } from './dashboardUtils';

const FOREST = 'var(--hotel-text)';

/** Document slots the guest uploads. `id_back` is conditional on the ID type. */
const DOCUMENT_SLOTS = [
  { key: 'id_front', required: true },
  { key: 'id_back', required: false },
  { key: 'selfie', required: true },
  { key: 'proof', required: false },
] as const;

type DocumentKey = (typeof DOCUMENT_SLOTS)[number]['key'];

const ID_TYPES = ['passport', 'national_id', 'driving_license'] as const;

type Tone = 'success' | 'warning' | 'error' | 'info';

/**
 * How each backend status reads to the guest, and whether it leaves them able
 * to act. `blocking` mirrors `EkycRepository::exists_open_for_guest`: anything
 * the backend still considers open means a new submission would be rejected,
 * so we show the status instead of a form the guest cannot use.
 */
const STATUS_PRESENTATION: Record<string, { tone: Tone; blocking: boolean }> = {
  approved: { tone: 'success', blocking: true },
  verified: { tone: 'success', blocking: true },
  // Not blocking: `exists_open_for_guest` excludes 'rejected', so the API
  // accepts a fresh submission. Hiding the form here would leave the guest
  // staring at a dead end that the backend would in fact have allowed.
  rejected: { tone: 'error', blocking: false },
  additional_information_required: { tone: 'warning', blocking: false },
  expired: { tone: 'warning', blocking: false },
  void: { tone: 'info', blocking: false },
};

function presentationFor(status: string, t: (key: string) => string) {
  const presentation = STATUS_PRESENTATION[status] ?? { tone: 'info' as const, blocking: true };
  const key = STATUS_PRESENTATION[status] ? status : 'default';
  return {
    ...presentation,
    label: t(`dashboard.identity.status.${key}.label`),
    help: t(`dashboard.identity.status.${key}.help`),
  };
}

const EMPTY_FIELDS: EkycFieldValues = {
  fullName: '',
  dateOfBirth: '',
  nationality: '',
  idType: 'passport',
  idNumber: '',
  idExpiryDate: '',
  idIssuingCountry: '',
  phone: '',
  email: '',
  currentAddress: '',
  idFront: '',
  idBack: '',
  selfie: '',
};

/**
 * Guest self-service identity verification (eKYC).
 *
 * Documents are uploaded one at a time as they are picked, and the submission
 * carries only the returned stored paths — the backend's guest-portal channel
 * rejects inline base64, so every byte reaches disk through the rate-limited,
 * body-capped upload endpoint.
 */
export function IdentitySection({ token }: { token: string }) {
  const { t } = useTranslation('guestPortal');
  const [status, setStatus] = useState<GuestPortalEkycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fields, setFields] = useState<EkycFieldValues>(EMPTY_FIELDS);
  const [paths, setPaths] = useState<Partial<Record<DocumentKey, string>>>({});
  const [uploading, setUploading] = useState<DocumentKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const formErrorRef = useAutoFocusError(formError);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await GuestPortalDashboardService.getEkycStatus(token));
    } catch {
      setLoadError(t('dashboard.identity.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const idBackRequired = isIdBackRequired(fields.idType);

  // Mirror the uploaded paths into the field values the shared rules validate.
  const valuesForValidation = useMemo<EkycFieldValues>(
    () => ({
      ...fields,
      idFront: paths.id_front ?? '',
      idBack: paths.id_back ?? '',
      selfie: paths.selfie ?? '',
    }),
    [fields, paths],
  );

  const errors = useMemo(
    () => validateEkycFields(valuesForValidation),
    [valuesForValidation],
  );
  const errorFor = (field: string) => {
    if (!showErrors) return undefined;
    const error = errors.find((e) => e.field === field);
    if (!error) return undefined;
    // `key` may carry an `auth:` prefix; `labelKey` feeds {{field}} on the
    // shared "is required" message. An unmapped field falls back to its raw
    // name rather than a broken key.
    return t(error.key, {
      field: error.labelKey ? t(error.labelKey) : error.field,
    });
  };

  const setField = (key: keyof EkycFieldValues) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFields((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleUpload = async (key: DocumentKey, file: File | null) => {
    if (!file) return;
    setUploading(key);
    setFormError(null);
    try {
      const result = await GuestPortalDashboardService.uploadEkycDocument(file, key, token);
      setPaths((prev) => ({ ...prev, [key]: result.file_path }));
    } catch (error) {
      // Surface what the server actually said. A rate-limit (429), a
      // deactivated account (403) and an oversized photo all reach here, and
      // "try a different photo" is wrong — and unactionable — for the first two.
      setFormError(
        guestErrorMessage(
          error,
          t('dashboard.identity.uploadFailed', {
            slot: t(`dashboard.identity.documents.${key}`),
          }),
        ),
      );
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    setShowErrors(true);
    if (errors.length > 0) {
      setFormError(t('dashboard.identity.incompleteFields'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const payload: GuestPortalEkycSubmission = {
      full_name: fields.fullName,
      date_of_birth: fields.dateOfBirth,
      nationality: fields.nationality || null,
      id_type: fields.idType,
      id_number: fields.idNumber,
      id_expiry_date: fields.idExpiryDate,
      id_issuing_country: fields.idIssuingCountry || null,
      phone: fields.phone || null,
      email: fields.email || null,
      current_address: fields.currentAddress || null,
      id_front_image: paths.id_front as string,
      id_back_image: paths.id_back ?? null,
      selfie_image: paths.selfie as string,
      proof_of_address: paths.proof ?? null,
    };
    try {
      const saved = await GuestPortalDashboardService.submitEkycVerification(payload, token);
      setStatus(saved);
      setFields(EMPTY_FIELDS);
      setPaths({});
      setShowErrors(false);
    } catch (error) {
      setFormError(guestErrorMessage(error, t('dashboard.identity.submitFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingState label={t('dashboard.identity.loading')} />;
  if (loadError) return <ErrorState message={loadError} retry={() => void load()} />;

  const presentation = status ? presentationFor(status.status, t) : null;

  return (
    <>
      <SectionHeading
        eyebrow={t('dashboard.identity.eyebrow')}
        title={t('dashboard.identity.title')}
        description={t('dashboard.identity.description')}
      />
      {status && presentation ? (
        <Card sx={{ mb: 3, border: '1px solid var(--hotel-border)' }}>
          <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "center",
                mb: 1.5
              }}>
              <Chip
                label={presentation.label}
                color={presentation.tone}
                size="small"
                icon={presentation.tone === 'success' ? <CheckCircleOutlineIcon /> : undefined}
              />
              {status.submitted_at ? (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {t('dashboard.identity.submittedAt', {
                    date: formatPortalDate(status.submitted_at),
                  })}
                </Typography>
              ) : null}
            </Stack>
            <Typography sx={{ color: FOREST }}>{presentation.help}</Typography>
            {status.customer_message ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                {status.customer_message}
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {presentation?.blocking ? null : (
        <Box component="form" noValidate onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
          {status ? (
            <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700, mb: 2 }}>
              {t('dashboard.identity.resubmitTitle')}
            </Typography>
          ) : null}

          {formError ? (
            <Alert severity="error" role="alert" ref={formErrorRef} tabIndex={-1} sx={{ mb: 2 }}>
              {formError}
            </Alert>
          ) : null}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label={t('dashboard.identity.fields.fullName')}
                value={fields.fullName} onChange={setField('fullName')}
                error={Boolean(errorFor('fullName'))} helperText={errorFor('fullName')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="date" label={t('dashboard.identity.fields.dateOfBirth')}
                value={fields.dateOfBirth}
                onChange={setField('dateOfBirth')} error={Boolean(errorFor('dateOfBirth'))}
                helperText={errorFor('dateOfBirth')} slotProps={{
                inputLabel: { shrink: true }
              }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label={t('dashboard.identity.fields.nationality')}
                value={fields.nationality} onChange={setField('nationality')}
                error={Boolean(errorFor('nationality'))} helperText={errorFor('nationality')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select fullWidth required label={t('dashboard.identity.fields.idType')}
                value={fields.idType} onChange={setField('idType')}
              >
                {ID_TYPES.map((idType) => (
                  <MenuItem key={idType} value={idType}>
                    {t(`dashboard.identity.idTypes.${idType}`)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label={t('dashboard.identity.fields.idNumber')}
                value={fields.idNumber} onChange={setField('idNumber')}
                error={Boolean(errorFor('idNumber'))} helperText={errorFor('idNumber')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="date" label={t('dashboard.identity.fields.idExpiryDate')}
                value={fields.idExpiryDate}
                onChange={setField('idExpiryDate')} error={Boolean(errorFor('idExpiryDate'))}
                helperText={errorFor('idExpiryDate')} slotProps={{
                inputLabel: { shrink: true }
              }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label={t('dashboard.identity.fields.idIssuingCountry')}
                value={fields.idIssuingCountry} onChange={setField('idIssuingCountry')}
                error={Boolean(errorFor('idIssuingCountry'))} helperText={errorFor('idIssuingCountry')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="tel" label={t('dashboard.identity.fields.phone')}
                value={fields.phone} onChange={setField('phone')}
                error={Boolean(errorFor('phone'))} helperText={errorFor('phone')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="email" label={t('dashboard.identity.fields.email')}
                value={fields.email} onChange={setField('email')}
                error={Boolean(errorFor('email'))} helperText={errorFor('email')}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth required multiline minRows={2} label={t('dashboard.identity.fields.currentAddress')}
                value={fields.currentAddress} onChange={setField('currentAddress')}
                error={Boolean(errorFor('currentAddress'))} helperText={errorFor('currentAddress')}
              />
            </Grid>
          </Grid>

          <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700, mt: 4, mb: 1 }}>
            {t('dashboard.identity.documentsTitle')}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2
            }}>
            {t('dashboard.identity.documentsHint')}
          </Typography>

          <Stack spacing={1.5} sx={{
            alignItems: "flex-start"
          }}>
            {DOCUMENT_SLOTS.map((slot) => {
              const required = slot.key === 'id_back' ? idBackRequired : slot.required;
              const stored = paths[slot.key];
              return (
                <Stack
                  key={slot.key}
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: "center",
                    flexWrap: "wrap"
                  }}>
                  <Button
                    component="label"
                    size="small"
                    variant={stored ? 'text' : 'outlined'}
                    startIcon={uploading === slot.key ? <CircularProgress size={16} /> : <UploadFileOutlinedIcon />}
                    disabled={uploading !== null}
                  >
                    {t(`dashboard.identity.documents.${slot.key}`)}{required ? ' *' : ''}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void handleUpload(slot.key, event.target.files?.[0] ?? null)}
                    />
                  </Button>
                  {stored ? (
                    <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label={t('dashboard.identity.uploaded')} />
                  ) : null}
                </Stack>
              );
            })}
          </Stack>
          {showErrors && (errorFor('idFront') || errorFor('selfie') || errorFor('idBack')) ? (
            <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
              {errorFor('idFront') ?? errorFor('selfie') ?? errorFor('idBack')}
            </Typography>
          ) : null}

          <Button
            type="submit"
            variant="contained"
            size="large"
            sx={{ mt: 4 }}
            disabled={submitting || uploading !== null}
            startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {submitting ? t('dashboard.identity.submitting') : t('dashboard.identity.submit')}
          </Button>
        </Box>
      )}
    </>
  );
}

export default IdentitySection;
