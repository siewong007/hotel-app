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
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';

import { GuestPortalDashboardService } from '../../api/guestPortalDashboard.service';
import type { GuestPortalEkycStatus, GuestPortalEkycSubmission } from '../../../../types';
import {
  isIdBackRequired,
  validateEkycFields,
  type EkycFieldValues,
} from '../../../ekyc/utils/ekycFieldRules';
import { ErrorState, LoadingState, SectionHeading } from './PortalDashboardSections';
import { formatPortalDate } from './dashboardUtils';

const FOREST = '#06110e';

/** Document slots the guest uploads. `id_back` is conditional on the ID type. */
const DOCUMENT_SLOTS = [
  { key: 'id_front', label: 'ID front', required: true },
  { key: 'id_back', label: 'ID back', required: false },
  { key: 'selfie', label: 'Selfie holding your ID', required: true },
  { key: 'proof', label: 'Proof of address (optional)', required: false },
] as const;

type DocumentKey = (typeof DOCUMENT_SLOTS)[number]['key'];

const ID_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'driving_license', label: "Driver's licence" },
];

/**
 * How each backend status reads to the guest, and whether it leaves them able
 * to act. `blocking` mirrors `EkycRepository::exists_open_for_guest`: anything
 * the backend still considers open means a new submission would be rejected,
 * so we show the status instead of a form the guest cannot use.
 */
const STATUS_PRESENTATION: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'error' | 'info'; blocking: boolean; help: string }
> = {
  approved: { label: 'Verified', tone: 'success', blocking: true, help: 'Your identity is verified. You can check in faster on arrival.' },
  verified: { label: 'Verified', tone: 'success', blocking: true, help: 'Your identity is verified. You can check in faster on arrival.' },
  // Not blocking: `exists_open_for_guest` excludes 'rejected', so the API
  // accepts a fresh submission. Hiding the form here would leave the guest
  // staring at a dead end that the backend would in fact have allowed.
  rejected: { label: 'Not accepted', tone: 'error', blocking: false, help: 'We could not accept this verification. You can submit a new set of documents below, or contact the front desk if you are unsure why.' },
  additional_information_required: { label: 'More information needed', tone: 'warning', blocking: false, help: 'Please review the note below and send us a new set of documents.' },
  expired: { label: 'Expired', tone: 'warning', blocking: false, help: 'This verification has expired. You can submit a new one.' },
  void: { label: 'Cancelled', tone: 'info', blocking: false, help: 'This verification was cancelled. You can submit a new one.' },
};

function presentationFor(status: string) {
  return (
    STATUS_PRESENTATION[status] ?? {
      label: 'Under review',
      tone: 'info' as const,
      blocking: true,
      help: 'Our team is reviewing your documents. We will update you shortly.',
    }
  );
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
  const [status, setStatus] = useState<GuestPortalEkycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fields, setFields] = useState<EkycFieldValues>(EMPTY_FIELDS);
  const [paths, setPaths] = useState<Partial<Record<DocumentKey, string>>>({});
  const [uploading, setUploading] = useState<DocumentKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await GuestPortalDashboardService.getEkycStatus(token));
    } catch {
      setLoadError('Unable to load your verification status right now.');
    } finally {
      setLoading(false);
    }
  }, [token]);

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
  const errorFor = (field: string) =>
    showErrors ? errors.find((e) => e.field === field)?.message : undefined;

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
      const fallback = `We could not upload your ${key.replace('_', ' ')}. Please try a different photo.`;
      setFormError(error instanceof Error && error.message ? error.message : fallback);
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    setShowErrors(true);
    if (errors.length > 0) {
      setFormError('Please complete the highlighted fields before submitting.');
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
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : 'We could not submit your verification. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingState label="Loading your verification status…" />;
  if (loadError) return <ErrorState message={loadError} retry={() => void load()} />;

  const presentation = status ? presentationFor(status.status) : null;

  return (
    <>
      <SectionHeading
        eyebrow="Identity"
        title="Identity verification"
        description="Verify your identity before you arrive so check-in takes moments instead of minutes. Your documents are encrypted and only seen by our front-desk team."
      />

      {status && presentation ? (
        <Card sx={{ mb: 3, border: '1px solid rgba(6,17,14,.12)' }}>
          <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
              <Chip
                label={presentation.label}
                color={presentation.tone}
                size="small"
                icon={presentation.tone === 'success' ? <CheckCircleOutlineIcon /> : undefined}
              />
              {status.submitted_at ? (
                <Typography variant="body2" color="text.secondary">
                  Submitted {formatPortalDate(status.submitted_at)}
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
              Send us a new set of documents
            </Typography>
          ) : null}

          {formError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          ) : null}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Full name (as on your ID)"
                value={fields.fullName} onChange={setField('fullName')}
                error={Boolean(errorFor('fullName'))} helperText={errorFor('fullName')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="date" label="Date of birth"
                InputLabelProps={{ shrink: true }}
                value={fields.dateOfBirth} onChange={setField('dateOfBirth')}
                error={Boolean(errorFor('dateOfBirth'))} helperText={errorFor('dateOfBirth')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Nationality"
                value={fields.nationality} onChange={setField('nationality')}
                error={Boolean(errorFor('nationality'))} helperText={errorFor('nationality')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select fullWidth required label="ID type"
                value={fields.idType} onChange={setField('idType')}
              >
                {ID_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="ID number"
                value={fields.idNumber} onChange={setField('idNumber')}
                error={Boolean(errorFor('idNumber'))} helperText={errorFor('idNumber')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="date" label="ID expiry date"
                InputLabelProps={{ shrink: true }}
                value={fields.idExpiryDate} onChange={setField('idExpiryDate')}
                error={Boolean(errorFor('idExpiryDate'))} helperText={errorFor('idExpiryDate')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Issuing country"
                value={fields.idIssuingCountry} onChange={setField('idIssuingCountry')}
                error={Boolean(errorFor('idIssuingCountry'))} helperText={errorFor('idIssuingCountry')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Phone"
                value={fields.phone} onChange={setField('phone')}
                error={Boolean(errorFor('phone'))} helperText={errorFor('phone')}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required type="email" label="Email"
                value={fields.email} onChange={setField('email')}
                error={Boolean(errorFor('email'))} helperText={errorFor('email')}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth required multiline minRows={2} label="Current address"
                value={fields.currentAddress} onChange={setField('currentAddress')}
                error={Boolean(errorFor('currentAddress'))} helperText={errorFor('currentAddress')}
              />
            </Grid>
          </Grid>

          <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700, mt: 4, mb: 1 }}>
            Documents
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Clear photos, JPEG/PNG/WebP, up to 10MB each.
          </Typography>

          <Stack spacing={1.5} alignItems="flex-start">
            {DOCUMENT_SLOTS.map((slot) => {
              const required = slot.key === 'id_back' ? idBackRequired : slot.required;
              const stored = paths[slot.key];
              return (
                <Stack key={slot.key} direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                  <Button
                    component="label"
                    size="small"
                    variant={stored ? 'text' : 'outlined'}
                    startIcon={uploading === slot.key ? <CircularProgress size={16} /> : <UploadFileOutlinedIcon />}
                    disabled={uploading !== null}
                  >
                    {slot.label}{required ? ' *' : ''}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => void handleUpload(slot.key, event.target.files?.[0] ?? null)}
                    />
                  </Button>
                  {stored ? (
                    <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label="Uploaded" />
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
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </Button>
        </Box>
      )}
    </>
  );
}

export default IdentitySection;
