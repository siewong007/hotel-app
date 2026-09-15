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
import { useTranslation } from '../../../../../i18n';

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
}) => {
  const { t } = useTranslation('finance');
  return (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1
        }}>
        <CreditNoteIcon color="error" />
        {t('ledger.creditNote.title')}
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
        {t('ledger.creditNote.info')}
      </Alert>
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextField
            select
            fullWidth
            required
            label={t('ledger.creditNote.entryLabel')}
            value={creditNoteLedgerId}
            onChange={(e) => setCreditNoteLedgerId(e.target.value === '' ? '' : Number(e.target.value))}
            helperText={t('ledger.creditNote.entryHelp')}
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
              {t('ledger.creditNote.noReversible')}
            </Typography>
          )}
        </Grid>
        <Grid size={12}>
          <TextField
            select
            fullWidth
            required
            label={t('ledger.creditNote.reasonLabel')}
            value={creditNoteReason}
            onChange={(e) => setCreditNoteReason(e.target.value)}
          >
            <MenuItem value="">{t('ledger.creditNote.reasonPlaceholder')}</MenuItem>
            <MenuItem value="Refund — early checkout">{t('ledger.creditNote.reasons.refundEarlyCheckout')}</MenuItem>
            <MenuItem value="Room downgrade">{t('ledger.creditNote.reasons.roomDowngrade')}</MenuItem>
            <MenuItem value="Service not rendered">{t('ledger.creditNote.reasons.serviceNotRendered')}</MenuItem>
            <MenuItem value="Billing error">{t('ledger.creditNote.reasons.billingError')}</MenuItem>
            <MenuItem value="Goodwill / discount">{t('ledger.creditNote.reasons.goodwillDiscount')}</MenuItem>
            <MenuItem value="Other">{t('ledger.creditNote.reasons.other')}</MenuItem>
          </TextField>
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            multiline
            rows={3}
            label={t('ledger.creditNote.detailsLabel')}
            value={creditNoteNotes}
            onChange={(e) => setCreditNoteNotes(e.target.value)}
            placeholder={t('ledger.creditNote.detailsPlaceholder')}
          />
        </Grid>
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={processingCreditNote}>
        {t('common:actions.cancel')}
      </Button>
      <Button
        onClick={onSubmit}
        variant="contained"
        color="error"
        disabled={processingCreditNote || !creditNoteLedgerId || !creditNoteReason}
        startIcon={processingCreditNote ? <CircularProgress size={18} /> : <CreditNoteIcon />}
      >
        {processingCreditNote ? t('ledger.creditNote.issuing') : t('ledger.creditNote.issue')}
      </Button>
    </DialogActions>
  </Dialog>
  );
};

export default CreditNoteDialog;
