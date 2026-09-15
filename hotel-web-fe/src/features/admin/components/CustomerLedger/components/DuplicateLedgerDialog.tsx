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
import { useTranslation } from '../../../../../i18n';

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
}) => {
  const { t } = useTranslation('finance');
  return (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>{t('ledger.duplicateDialog.title')}</DialogTitle>
    <DialogContent>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('ledger.duplicateDialog.warning')}
      </Alert>
      {duplicate && (
        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{duplicate.description}</Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('ledger.roomWithNumber', { number: duplicate.room_number || '-' })} / {formatDateForDisplay(duplicate.posting_date || duplicate.created_at)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {formatCurrency(asMoney(duplicate.amount))} / {duplicate.invoice_number || t('ledger.notInvoiced')}
          </Typography>
        </Box>
      )}
    </DialogContent>
    {/* Three actions; wrap so longer ms labels cannot overflow a phone-width
        dialog. */}
    <DialogActions sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button onClick={onViewExisting}>{t('ledger.duplicateDialog.viewExisting')}</Button>
      <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
      <Button onClick={onCreateAnyway} variant="contained" disabled={creating}>
        {t('ledger.duplicateDialog.createAnyway')}
      </Button>
    </DialogActions>
  </Dialog>
  );
};

export default DuplicateLedgerDialog;
