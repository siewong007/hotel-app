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
import { useTranslation } from '../../../../../i18n';

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
}) => {
  const { t } = useTranslation('finance');
  return (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>{t('ledger.voidDialog.title')}</DialogTitle>
    <DialogContent>
      <Alert severity="error" sx={{ mb: 2 }}>
        {t('ledger.voidDialog.warning')}
      </Alert>
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2"><strong>{t('ledger.field.company')}:</strong> {voidingLedger?.company_name}</Typography>
        <Typography variant="body2"><strong>{t('common:field.amount')}:</strong> {formatCurrency(toMoneyNumber(voidingLedger?.amount))}</Typography>
        <Typography variant="body2"><strong>{t('common:field.description')}:</strong> {voidingLedger?.description}</Typography>
      </Box>
      <TextField
        fullWidth
        multiline
        rows={3}
        label={t('ledger.voidDialog.reasonLabel')}
        value={voidReason}
        onChange={(e) => onVoidReasonChange(e.target.value)}
        placeholder={t('ledger.voidDialog.reasonPlaceholder')}
      />
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
      <Button onClick={onConfirm} variant="contained" color="error" disabled={voiding}>
        {voiding ? t('ledger.voidDialog.voiding') : t('ledger.voidDialog.voidEntry')}
      </Button>
    </DialogActions>
  </Dialog>
  );
};

export default VoidLedgerDialog;
