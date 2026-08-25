import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { CloudUpload as UploadIcon, CheckCircle as CheckIcon } from '@mui/icons-material';
import { GuestsService } from '../../../api/guests.service';
import type { Guest } from '../../../types/guest.types';
import { EkycService } from '../../../api/ekyc.service';
import { useCreateEkycApplication } from '../hooks/useEkycQueries';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { validateEkycCreateForm } from '../utils/ekycCreateValidation';
import { errorMessage } from '../../../utils/errorMessage';

const ID_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'national_id', label: 'National ID Card' },
];

interface EkycCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
  initialGuest?: Guest | null;
  lockGuest?: boolean;
}

const emptyForm = {
  fullName: '',
  dateOfBirth: '',
  nationality: '',
  phone: '',
  email: '',
  currentAddress: '',
  idType: 'passport',
  idNumber: '',
  idIssuingCountry: '',
  idIssueDate: '',
  idExpiryDate: '',
};

const guestAddress = (guest: Guest) =>
  [guest.address_line1, guest.city, guest.state_province, guest.postal_code, guest.country]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(', ');

const withGuestDefaults = (form: typeof emptyForm, guest: Guest) => ({
  ...form,
  fullName: form.fullName || guest.full_name || '',
  nationality: form.nationality || guest.nationality || '',
  phone: form.phone || guest.phone || '',
  email: form.email || guest.email || '',
  currentAddress: form.currentAddress || guestAddress(guest),
  idNumber: form.idNumber || guest.ic_number || '',
});

const formFromGuest = (guest: Guest) => withGuestDefaults({ ...emptyForm }, guest);

const FileField: React.FC<{
  label: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
}> = ({ label, required, file, onChange }) => (
  <Button
    component="label"
    variant={file ? 'contained' : 'outlined'}
    color={file ? 'success' : 'primary'}
    startIcon={file ? <CheckIcon /> : <UploadIcon />}
    fullWidth
    sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
  >
    {file ? `${label}: ${file.name}` : `${label}${required ? ' *' : ''}`}
    <input
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      onChange={(e) => onChange(e.target.files?.[0] ?? null)}
    />
  </Button>
);

const EkycCreateDialog: React.FC<EkycCreateDialogProps> = ({
  open,
  onClose,
  onCreated,
  initialGuest = null,
  lockGuest = false,
}) => {
  const createMutation = useCreateEkycApplication();

  const [guest, setGuest] = useState<Guest | null>(null);
  const [guestInput, setGuestInput] = useState('');
  const [guestOptions, setGuestOptions] = useState<Guest[]>([]);
  const [guestLoading, setGuestLoading] = useState(false);
  const debouncedGuestQuery = useDebouncedValue(guestInput, 400);

  const [form, setForm] = useState({ ...emptyForm });
  const [selfCheckin, setSelfCheckin] = useState(true);
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof emptyForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setGuest(null);
    setGuestInput('');
    setGuestOptions([]);
    setGuestLoading(false);
    setForm({ ...emptyForm });
    setSelfCheckin(true);
    setIdFront(null);
    setIdBack(null);
    setSelfie(null);
    setProof(null);
    setError(null);
  };

  useEffect(() => {
    if (!open || !initialGuest) return;
    setGuest(initialGuest);
    setGuestInput(initialGuest.full_name || '');
    setGuestOptions([initialGuest]);
    setForm(formFromGuest(initialGuest));
    setError(null);
  }, [initialGuest, open]);

  useEffect(() => {
    if (!open || lockGuest) return;
    let active = true;
    const query = debouncedGuestQuery.trim();
    if (query.length < 2) {
      setGuestOptions([]);
      return;
    }
    setGuestLoading(true);
    GuestsService.getAllGuests({ search: query })
      .then((guests) => {
        if (active) setGuestOptions(guests.slice(0, 25));
      })
      .catch(() => {
        if (active) setGuestOptions([]);
      })
      .finally(() => {
        if (active) setGuestLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedGuestQuery, lockGuest, open]);

  const guestSelectOptions = useMemo(() => {
    if (!guest) return guestOptions;
    return [guest, ...guestOptions.filter((option) => option.id !== guest.id)];
  }, [guest, guestOptions]);

  const validationError = useMemo(
    () =>
      validateEkycCreateForm({
        guestId: guest?.id ?? null,
        fullName: form.fullName,
        dateOfBirth: form.dateOfBirth,
        idType: form.idType,
        idNumber: form.idNumber,
        idExpiryDate: form.idExpiryDate,
        hasIdFront: !!idFront,
        hasSelfie: !!selfie,
      }),
    [guest, form, idFront, selfie]
  );

  const handleSelectGuest = (value: Guest | null) => {
    setGuest(value);
    setGuestInput(value?.full_name || '');
    if (value) {
      setGuestOptions((prev) => [value, ...prev.filter((option) => option.id !== value.id)]);
      setForm((prev) => withGuestDefaults(prev, value));
    }
  };

  const close = () => {
    if (createMutation.isPending) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    const message = validationError;
    if (message || !guest) {
      setError(message ?? 'Please complete the required fields.');
      return;
    }
    try {
      const upload = async (file: File, type: string) =>
        (await EkycService.uploadEkycDocument(file, type)).file_path;

      const idFrontPath = await upload(idFront!, 'id_front');
      const selfiePath = await upload(selfie!, 'selfie');
      const idBackPath = idBack ? await upload(idBack, 'id_back') : undefined;
      const proofPath = proof ? await upload(proof, 'proof') : undefined;

      await createMutation.mutateAsync({
        guest_id: guest.id,
        full_name: form.fullName.trim(),
        date_of_birth: form.dateOfBirth,
        nationality: form.nationality || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        current_address: form.currentAddress || undefined,
        id_type: form.idType,
        id_number: form.idNumber.trim(),
        id_issuing_country: form.idIssuingCountry || undefined,
        id_issue_date: form.idIssueDate || undefined,
        id_expiry_date: form.idExpiryDate,
        id_front_image: idFrontPath,
        id_back_image: idBackPath,
        selfie_image: selfiePath,
        proof_of_address: proofPath,
        self_checkin_enabled: selfCheckin,
      });

      onCreated(
        `eKYC verified for ${form.fullName.trim()}.${selfCheckin ? ' Self check-in enabled.' : ''}`
      );
      reset();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create eKYC verification.'));
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create eKYC verification</DialogTitle>
      <DialogContent dividers>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mb: 2
          }}>
          Verify a customer's identity documents at the front desk. The verification is created
          as <strong>approved</strong>, so the customer can check in directly.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid size={12}>
            <Autocomplete
              options={guestSelectOptions}
              value={guest}
              disabled={lockGuest}
              loading={!lockGuest && guestLoading}
              onChange={(_, value) => {
                if (!lockGuest) handleSelectGuest(value);
              }}
              onInputChange={(_, value) => {
                if (!lockGuest) setGuestInput(value);
              }}
              getOptionLabel={(g) => (g ? `${g.full_name}${g.email ? ` · ${g.email}` : ''}` : '')}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText={guestInput.trim().length < 2 ? 'Type to search guests…' : 'No guests found'}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Guest *"
                  placeholder={lockGuest ? undefined : 'Search by name, email, or phone'}
                  helperText={lockGuest ? 'Selected guest' : "Pick the guest this verification is for. Create the guest first if they don't exist."}
                  slotProps={{
                    ...params.slotProps,

                    input: {
                      ...params.slotProps.input,
                      endAdornment: (
                        <>
                          {!lockGuest && guestLoading ? <CircularProgress size={18} /> : null}
                          {params.slotProps.input.endAdornment}
                        </>
                      ),
                    }
                  }}
                />
              )}
            />
          </Grid>

          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
              Identity
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Full name *" fullWidth value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Date of birth *"
              type="date"
              fullWidth
              value={form.dateOfBirth}
              onChange={(e) => set('dateOfBirth', e.target.value)}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Nationality" fullWidth value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Phone" fullWidth value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Email" type="email" fullWidth value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Current address" fullWidth value={form.currentAddress} onChange={(e) => set('currentAddress', e.target.value)} />
          </Grid>

          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
              ID document
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="ID type *" fullWidth value={form.idType} onChange={(e) => set('idType', e.target.value)}>
              {ID_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="ID number *" fullWidth value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField label="Issuing country" fullWidth value={form.idIssuingCountry} onChange={(e) => set('idIssuingCountry', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Issue date"
              type="date"
              fullWidth
              value={form.idIssueDate}
              onChange={(e) => set('idIssueDate', e.target.value)}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              label="Expiry date *"
              type="date"
              fullWidth
              value={form.idExpiryDate}
              onChange={(e) => set('idExpiryDate', e.target.value)}
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Grid>

          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
              Documents
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FileField label="ID front" required file={idFront} onChange={setIdFront} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FileField label="ID back" file={idBack} onChange={setIdBack} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FileField label="Selfie" required file={selfie} onChange={setSelfie} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FileField label="Proof of address" file={proof} onChange={setProof} />
          </Grid>

          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <FormControlLabel
              control={<Switch checked={selfCheckin} onChange={(e) => setSelfCheckin(e.target.checked)} />}
              label="Enable self / kiosk check-in for this customer"
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={close} color="inherit" disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        {validationError && (
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              mr: 1,
              textAlign: 'right'
            }}>
            {validationError}
          </Typography>
        )}
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={createMutation.isPending}
          startIcon={createMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <CheckIcon />}
        >
          {createMutation.isPending ? 'Creating…' : 'Create & approve'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EkycCreateDialog;
