import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import type { CustomerLedger, CustomerLedgerUpdateRequest } from '../../../../../types';
import { EXPENSE_TYPES } from '../constants';

interface EditLedgerDialogProps {
  open: boolean;
  onClose: () => void;
  editingLedger: CustomerLedger | null;
  editFormData: CustomerLedgerUpdateRequest;
  setEditFormData: React.Dispatch<React.SetStateAction<CustomerLedgerUpdateRequest>>;
  updating: boolean;
  onUpdate: () => void;
}

const EditLedgerDialog: React.FC<EditLedgerDialogProps> = ({
  open,
  onClose,
  editingLedger,
  editFormData,
  setEditFormData,
  updating,
  onUpdate,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>Edit Ledger Entry - {editingLedger?.invoice_number || `#${editingLedger?.id}`}</DialogTitle>
    <DialogContent>
      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Company Name"
            value={editFormData.company_name || ''}
            onChange={(e) => setEditFormData({ ...editFormData, company_name: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Registration Number"
            value={editFormData.company_registration_number || ''}
            onChange={(e) => setEditFormData({ ...editFormData, company_registration_number: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Contact Person"
            value={editFormData.contact_person || ''}
            onChange={(e) => setEditFormData({ ...editFormData, contact_person: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Contact Email"
            type="email"
            value={editFormData.contact_email || ''}
            onChange={(e) => setEditFormData({ ...editFormData, contact_email: e.target.value })}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label="Description"
            multiline
            rows={2}
            value={editFormData.description || ''}
            onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Expense Type</InputLabel>
            <Select
              value={editFormData.expense_type || ''}
              label="Expense Type"
              onChange={(e) => setEditFormData({ ...editFormData, expense_type: e.target.value })}
            >
              {EXPENSE_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Status</InputLabel>
            <Select
              value={editFormData.status || ''}
              label="Status"
              onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
            >
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="partial">Partial</MenuItem>
              <MenuItem value="paid">Paid</MenuItem>
              <MenuItem value="overdue">Overdue</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Due Date"
            type="date"
            value={editFormData.due_date || ''}
            onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label="Notes"
            multiline
            rows={2}
            value={editFormData.notes || ''}
            onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label="Internal Notes (Staff Only)"
            multiline
            rows={2}
            value={editFormData.internal_notes || ''}
            onChange={(e) => setEditFormData({ ...editFormData, internal_notes: e.target.value })}
          />
        </Grid>
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button onClick={onUpdate} variant="contained" disabled={updating}>
        {updating ? 'Updating...' : 'Update Entry'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default EditLedgerDialog;
