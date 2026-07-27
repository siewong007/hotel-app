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
  MenuItem,
  Grid,
  CircularProgress,
} from '@mui/material';
import { CreditScore as CreditNoteIcon } from '@mui/icons-material';
import type { Company, CustomerLedger } from '../../../../../types';
import { asMoney } from '../helpers';

interface CreditNoteDialogProps {
  open: boolean;
  onClose: () => void;
  activeCompany: Company | null;
  reversibleEntries: CustomerLedger[];
  creditNoteLedgerId: number | '';
  setCreditNoteLedgerId: React.Dispatch<React.SetStateAction<number | ''>>;
  creditNoteReason: string;
  setCreditNoteReason: React.Dispatch<React.SetStateAction<string>>;
  creditNoteNotes: string;
  setCreditNoteNotes: React.Dispatch<React.SetStateAction<string>>;
  processingCreditNote: boolean;
  onSubmit: () => void;
  formatCurrency: (value: number) => string;
}

const CreditNoteDialog: React.FC<CreditNoteDialogProps> = ({
  open,
  onClose,
  activeCompany,
  reversibleEntries,
  creditNoteLedgerId,
  setCreditNoteLedgerId,
  creditNoteReason,
  setCreditNoteReason,
  creditNoteNotes,
  setCreditNoteNotes,
  processingCreditNote,
  onSubmit,
  formatCurrency,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1
        }}>
        <CreditNoteIcon color="error" />
        Issue Credit Note
        {activeCompany && (
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              ml: 1
            }}>
            · {activeCompany.company_name}
          </Typography>
        )}
      </Box>
    </DialogTitle>
    <DialogContent>
      <Alert severity="info" sx={{ mb: 2 }}>
        A credit note posts a <strong>reversal entry</strong> against an existing ledger
        row. The original entry stays in the ledger and the reversal is audit-tracked.
        Reversals cannot be issued against another reversal.
      </Alert>
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField
            select
            fullWidth
            required
            label="Original ledger entry"
            value={creditNoteLedgerId}
            onChange={(e) => setCreditNoteLedgerId(e.target.value === '' ? '' : Number(e.target.value))}
            helperText="Pick the entry to reverse"
          >
            {reversibleEntries.map(l => (
              <MenuItem key={l.id} value={l.id}>
                {l.invoice_number || l.folio_number || `#${l.id}`} · {l.description.slice(0, 48)}
                {l.description.length > 48 ? '…' : ''} · {formatCurrency(asMoney(l.amount))}
              </MenuItem>
            ))}
          </TextField>
          {reversibleEntries.length === 0 && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                mt: 0.5,
                display: 'block'
              }}>
              No reversible entries for this company.
            </Typography>
          )}
        </Grid>
        <Grid size={12}>
          <TextField
            select
            fullWidth
            required
            label="Reason"
            value={creditNoteReason}
            onChange={(e) => setCreditNoteReason(e.target.value)}
          >
            <MenuItem value="">Pick a reason…</MenuItem>
            <MenuItem value="Refund — early checkout">Refund — early checkout</MenuItem>
            <MenuItem value="Room downgrade">Room downgrade</MenuItem>
            <MenuItem value="Service not rendered">Service not rendered</MenuItem>
            <MenuItem value="Billing error">Billing error</MenuItem>
            <MenuItem value="Goodwill / discount">Goodwill / discount</MenuItem>
            <MenuItem value="Other">Other</MenuItem>
          </TextField>
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Details (optional)"
            value={creditNoteNotes}
            onChange={(e) => setCreditNoteNotes(e.target.value)}
            placeholder="Explain the credit — appears on the reversal record."
          />
        </Grid>
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={processingCreditNote}>
        Cancel
      </Button>
      <Button
        onClick={onSubmit}
        variant="contained"
        color="error"
        disabled={processingCreditNote || !creditNoteLedgerId || !creditNoteReason}
        startIcon={processingCreditNote ? <CircularProgress size={18} /> : <CreditNoteIcon />}
      >
        {processingCreditNote ? 'Issuing…' : 'Issue credit note'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default CreditNoteDialog;
