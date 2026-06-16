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
  const isCreate = mode === 'create';
  const ph = (text: string) => (isCreate ? text : undefined);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          {isCreate ? <BusinessIcon color="primary" /> : <EditIcon color="primary" />}
          {isCreate ? 'Register New Company' : 'Edit Company'}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {/* Company Basic Info */}
          <Grid size={12}>
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Company Information
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              required
              label="Company Name"
              value={form.company_name}
              onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              placeholder={ph('Enter company name')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Registration Number"
              value={form.registration_number}
              onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
              placeholder={ph('Business registration number')}
            />
          </Grid>

          {/* Contact Information */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Contact Information
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label="Contact Person"
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              placeholder={ph('Primary contact name')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label="Contact Email"
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
              placeholder={ph('email@company.com')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label="Contact Phone"
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
              placeholder={ph('+60 12-345 6789')}
            />
          </Grid>

          {/* Billing Address */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Billing Address
            </Typography>
          </Grid>
          <Grid size={12}>
            <TextField
              fullWidth
              label="Street Address"
              value={form.billing_address}
              onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
              placeholder={ph('Street address, building, floor')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label="City"
              value={form.billing_city}
              onChange={(e) => setForm({ ...form, billing_city: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label="State"
              value={form.billing_state}
              onChange={(e) => setForm({ ...form, billing_state: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField
              fullWidth
              label="Postal Code"
              value={form.billing_postal_code}
              onChange={(e) => setForm({ ...form, billing_postal_code: e.target.value })}
            />
          </Grid>

          {/* Billing Terms */}
          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Billing Terms
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Credit Limit"
              type="number"
              value={form.credit_limit}
              onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
              placeholder={ph('0.00')}
              InputProps={{
                startAdornment: <Typography sx={{ mr: 1 }}>{currencySymbol}</Typography>,
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Payment Terms (Days)"
              type="number"
              value={form.payment_terms_days}
              onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })}
              helperText={isCreate ? 'Number of days for payment after invoice' : undefined}
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
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={ph('Additional notes about this company...')}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          disabled={submitting || !form.company_name.trim()}
          startIcon={submitting ? <CircularProgress size={20} /> : (isCreate ? <AddIcon /> : <EditIcon />)}
        >
          {isCreate
            ? (submitting ? 'Registering...' : 'Register Company')
            : (submitting ? 'Updating...' : 'Update Company')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CompanyFormDialog;
