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
  TextField,
} from '@mui/material';
import type { CustomerLedger } from '../../../../../types';
import { toMoneyNumber } from '../../../../../utils/money';

interface VoidLedgerDialogProps {
  open: boolean;
  onClose: () => void;
  voidingLedger: CustomerLedger | null;
  voidReason: string;
  onVoidReasonChange: (value: string) => void;
  voiding: boolean;
  onConfirm: () => void;
  formatCurrency: (value: number) => string;
}

const VoidLedgerDialog: React.FC<VoidLedgerDialogProps> = ({
  open,
  onClose,
  voidingLedger,
  voidReason,
  onVoidReasonChange,
  voiding,
  onConfirm,
  formatCurrency,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Void Ledger Entry</DialogTitle>
    <DialogContent>
      <Alert severity="error" sx={{ mb: 2 }}>
        Voiding a ledger entry marks it as void and removes its outstanding balance. This is reversible only by reactivating from the database.
      </Alert>
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2"><strong>Company:</strong> {voidingLedger?.company_name}</Typography>
        <Typography variant="body2"><strong>Amount:</strong> {formatCurrency(toMoneyNumber(voidingLedger?.amount))}</Typography>
        <Typography variant="body2"><strong>Description:</strong> {voidingLedger?.description}</Typography>
      </Box>
      <TextField
        fullWidth
        multiline
        rows={3}
        label="Void Reason (Optional)"
        value={voidReason}
        onChange={(e) => onVoidReasonChange(e.target.value)}
        placeholder="Enter reason for voiding..."
      />
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button onClick={onConfirm} variant="contained" color="error" disabled={voiding}>
        {voiding ? 'Voiding...' : 'Void Entry'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default VoidLedgerDialog;
