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
  FormHelperText,
  InputAdornment,
} from '@mui/material';
import type { CustomerLedger, CustomerLedgerUpdateRequest } from '../../../../../types';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';
import { EXPENSE_TYPES } from '../constants';
import { isLedgerVoided } from '../helpers';

/**
 * Whether the "Paid" status option must be withheld for this entry.
 *
 * Mirrors the backend guard in `repositories/ledger.rs::update_customer_ledger`,
 * which refuses a TRANSITION to 'paid' while a balance is outstanding: that
 * update writes the `status` column alone, so a typed-in 'paid' records no
 * payment and no payment date. Blocking it here makes the option visibly
 * unavailable instead of failing on submit. A row already stored as 'paid'
 * stays selectable, matching the backend's transition-only rule.
 */
const isPaidStatusBlocked = (ledger: CustomerLedger | null): boolean =>
  Boolean(ledger)
  && ledger?.status !== 'paid'
  && !isLedgerVoided(ledger as CustomerLedger)
  && isPositiveMoney(toMoneyNumber(ledger?.balance_due));

interface EditLedgerDialogProps {
  open: boolean;
  onClose: () => void;
  editingLedger: CustomerLedger | null;
  editFormData: CustomerLedgerUpdateRequest;
  setEditFormData: React.Dispatch<React.SetStateAction<CustomerLedgerUpdateRequest>>;
  bookingRoomRate: string;
  setBookingRoomRate: React.Dispatch<React.SetStateAction<string>>;
  loadingBookingRoomRate: boolean;
  updating: boolean;
  onUpdate: () => void;
  currencySymbol: string;
}

const EditLedgerDialog: React.FC<EditLedgerDialogProps> = ({
  open,
  onClose,
  editingLedger,
  editFormData,
  setEditFormData,
  bookingRoomRate,
  setBookingRoomRate,
  loadingBookingRoomRate,
  updating,
  onUpdate,
  currencySymbol,
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
              <MenuItem value="paid" disabled={isPaidStatusBlocked(editingLedger)}>Paid</MenuItem>
              <MenuItem value="overdue">Overdue</MenuItem>
            </Select>
            {/* `update_customer_ledger` writes only the `status` column — it does
                not insert a customer_ledger_payments row, and leaves paid_amount,
                balance_due and payment_date untouched. Only Record Payment does,
                and that dialog carries its own payment-date field. */}
            <FormHelperText>
              {isPaidStatusBlocked(editingLedger)
                ? 'Paid is unavailable while a balance is outstanding — it would record no payment and no payment date. Use Record Payment to settle the balance; the status then flips to Paid on its own.'
                : 'Changing the status here only relabels the entry — it records no payment and sets no payment date. Use Record Payment to enter the amount and the date it was actually paid.'}
            </FormHelperText>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Due Date"
            type="date"
            value={editFormData.due_date || ''}
            onChange={(e) => setEditFormData({ ...editFormData, due_date: e.target.value })}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        {editingLedger?.booking_id && editingLedger.post_type === 'room_charge' && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Booking Room Rate"
              type="number"
              value={bookingRoomRate}
              onChange={(e) => setBookingRoomRate(e.target.value)}
              disabled={loadingBookingRoomRate}
              helperText="Per night for the linked booking"
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                },

                htmlInput: {
                  min: 0.01,
                  step: 0.01,
                }
              }} />
          </Grid>
        )}
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
