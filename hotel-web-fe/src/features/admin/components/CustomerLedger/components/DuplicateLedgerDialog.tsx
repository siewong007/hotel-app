import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  Box,
  Typography,
} from '@mui/material';
import type { CustomerLedger } from '../../../../../types';
import { formatDateForDisplay, asMoney } from '../helpers';

interface DuplicateLedgerDialogProps {
  open: boolean;
  onClose: () => void;
  duplicate: CustomerLedger | null;
  creating: boolean;
  onViewExisting: () => void;
  onCreateAnyway: () => void;
  formatCurrency: (value: number) => string;
}

const DuplicateLedgerDialog: React.FC<DuplicateLedgerDialogProps> = ({
  open,
  onClose,
  duplicate,
  creating,
  onViewExisting,
  onCreateAnyway,
  formatCurrency,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Possible duplicate ledger entry found</DialogTitle>
    <DialogContent>
      <Alert severity="warning" sx={{ mb: 2 }}>
        A ledger entry already exists for the same company, room, stay date, and amount.
      </Alert>
      {duplicate && (
        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{duplicate.description}</Typography>
          <Typography variant="body2" color="text.secondary">
            Room {duplicate.room_number || '-'} / {formatDateForDisplay(duplicate.posting_date || duplicate.created_at)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {formatCurrency(asMoney(duplicate.amount))} / {duplicate.invoice_number || 'Not invoiced'}
          </Typography>
        </Box>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onViewExisting}>View existing</Button>
      <Button onClick={onClose}>Cancel</Button>
      <Button onClick={onCreateAnyway} variant="contained" disabled={creating}>
        Create anyway
      </Button>
    </DialogActions>
  </Dialog>
);

export default DuplicateLedgerDialog;
