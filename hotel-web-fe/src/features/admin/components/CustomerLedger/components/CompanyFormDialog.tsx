import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Box,
  Typography,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Business as BusinessIcon,
  Edit as EditIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useTranslation } from '../../../../../i18n';

export interface CompanyFormValues {
  company_name: string;
  registration_number: string;
  contact_person: string;
  contact_email: string;
  contact_phone: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_postal_code: string;
  credit_limit: string;
  payment_terms_days: string;
  notes: string;
}

interface CompanyFormDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  mode: 'create' | 'edit';
  form: CompanyFormValues;
  setForm: React.Dispatch<React.SetStateAction<CompanyFormValues>>;
  submitting: boolean;
  currencySymbol: string;
  onSubmit: () => void;
}

// Shared dialog for registering a new company and editing an existing one — the
// two forms have identical fields, differing only in titles, placeholders, and
// the submit affordance.
const CompanyFormDialog: React.FC<CompanyFormDialogProps> = ({
  open,
  onClose,
  onCancel,
  mode,
  form,
  setForm,
  submitting,
  currencySymbol,
  onSubmit,
}) => {
  const { t } = useTranslation('finance');
  const isCreate = mode === 'create';
  const ph = (key: string) => (isCreate ? t(key) : undefined);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1
          }}>
          {isCreate ? <BusinessIcon color="primary" /> : <EditIcon color="primary" />}
          {isCreate ? t('ledger.companyForm.titleCreate') : t('ledger.companyForm.titleEdit')}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {/* Company Basic Info */}
          <Grid size={12}>
            <Typography variant="subtitle2" color="primary" gutterBottom>
              {t('ledger.companyForm.sectionCompany')}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              required
              label={t('ledger.field.companyName')}
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.companyName')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label={t('ledger.field.registrationNumber')}
              value={form.registration_number}
              onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.registrationNumber')}
            />
          </Grid>

          {/* Contact Information */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="primary" gutterBottom>
              {t('ledger.companyForm.sectionContact')}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label={t('ledger.field.contactPerson')}
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.contactPerson')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label={t('ledger.field.contactEmail')}
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.contactEmail')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              type="tel"
              label={t('ledger.field.contactPhone')}
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.contactPhone')}
            />
          </Grid>

          {/* Billing Address */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="primary" gutterBottom>
              {t('ledger.companyForm.sectionBilling')}
            </Typography>
          </Grid>
          <Grid size={12}>
            <TextField
              fullWidth
              label={t('ledger.field.streetAddress')}
              value={form.billing_address}
              onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.streetAddress')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label={t('ledger.field.city')}
              value={form.billing_city}
              onChange={(e) => setForm({ ...form, billing_city: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label={t('ledger.field.state')}
              value={form.billing_state}
              onChange={(e) => setForm({ ...form, billing_state: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label={t('ledger.field.postalCode')}
              value={form.billing_postal_code}
              onChange={(e) => setForm({ ...form, billing_postal_code: e.target.value })}
            />
          </Grid>

          {/* Billing Terms */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="primary" gutterBottom>
              {t('ledger.sections.billingTerms')}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label={t('ledger.field.creditLimit')}
              type="number"
              value={form.credit_limit}
              onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.creditLimit')}
              slotProps={{
                input: {
                  startAdornment: <Typography sx={{ mr: 1 }}>{currencySymbol}</Typography>,
                }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label={t('ledger.field.paymentTermsDays')}
              type="number"
              value={form.payment_terms_days}
              onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
              helperText={isCreate ? t('ledger.companyForm.paymentTermsHelp') : undefined}
            />
          </Grid>

          {/* Notes */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
          </Grid>
          <Grid size={12}>
            <TextField
              fullWidth
              multiline
              rows={2}
              label={t('common:field.notes')}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={ph('ledger.companyForm.ph.notes')}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common:actions.cancel')}</Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          disabled={submitting || !form.company_name.trim()}
          startIcon={submitting ? <CircularProgress size={20} /> : (isCreate ? <AddIcon /> : <EditIcon />)}
        >
          {isCreate
            ? (submitting ? t('ledger.companyForm.registering') : t('ledger.registerCompany'))
            : (submitting ? t('ledger.companyForm.updating') : t('ledger.companyForm.updateCompany'))}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CompanyFormDialog;
