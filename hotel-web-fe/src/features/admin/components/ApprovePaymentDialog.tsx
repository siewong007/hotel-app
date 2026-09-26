import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import type { PendingPaymentEntry } from '../../../api';
import { formatCurrency } from '../../../utils/currency';
import { formatHotelDate } from '../../../utils/date';
import { statusLabel, useTranslation } from '../../../i18n';
import { canRejectPaymentClaim, hasPaymentReceipt } from '../utils/paymentApprovals';

export interface ApprovePaymentDialogProps {
  /** The claim being reviewed; the dialog is open while this is set. */
  entry: PendingPaymentEntry | null;
  isApproving: boolean;
  onCancel: () => void;
  onConfirm: (entry: PendingPaymentEntry) => void;
}

/**
 * Confirmation step before a staff approval marks a claim as money received.
 * Shows who and what is being approved, and warns loudly when the guest never
 * uploaded proof — approval is still allowed (staff may have seen the transfer
 * in the bank account), just never by accident.
 */
const ApprovePaymentDialog: React.FC<ApprovePaymentDialogProps> = ({
  entry,
  isApproving,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation('admin');
  const receiptPresent = entry ? hasPaymentReceipt(entry) : false;
  const alreadyHandled = entry ? !canRejectPaymentClaim(entry.booking_status) : false;
  const bookingRef = entry ? entry.booking_number ?? `#${entry.booking_id}` : '';

  const rows: Array<[string, React.ReactNode]> = entry
    ? [
        [t('paymentApprovals.col.guest'), entry.guest_name ?? '—'],
        [t('paymentApprovals.col.booking'), bookingRef],
        [t('common:field.amount'), formatCurrency(entry.amount)],
        [
          t('paymentApprovals.col.stay'),
          entry.check_in_date
            ? t('paymentApprovals.stayRange', {
                from: formatHotelDate(entry.check_in_date),
                to: formatHotelDate(entry.check_out_date),
              })
            : '—',
        ],
        [
          t('paymentApprovals.receipt'),
          receiptPresent
            ? t('paymentApprovals.approveDialog.receiptPresent')
            : t('paymentApprovals.approveDialog.receiptMissing'),
        ],
      ]
    : [];

  return (
    <Dialog
      open={Boolean(entry)}
      onClose={() => !isApproving && onCancel()}
      maxWidth="sm"
      fullWidth
      aria-labelledby="approve-payment-dialog-title"
    >
      <DialogTitle id="approve-payment-dialog-title">
        {t('paymentApprovals.approveDialog.title')}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{t('paymentApprovals.approveDialog.body')}</Typography>
        <Box
          component="dl"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: 2,
            rowGap: 0.75,
            m: 0,
            mb: 2,
          }}
        >
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <Typography component="dt" variant="body2" sx={{ color: 'text.secondary' }}>
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 600 }}>
                {value}
              </Typography>
            </React.Fragment>
          ))}
        </Box>
        {!receiptPresent ? (
          <Alert severity="warning" sx={{ mb: alreadyHandled ? 1.5 : 0 }}>
            {t('paymentApprovals.approveDialog.noReceiptWarning')}
          </Alert>
        ) : null}
        {alreadyHandled && entry ? (
          <Alert severity="info">
            {t('paymentApprovals.approveDialog.alreadyHandled', {
              status: statusLabel(t, 'booking', entry.booking_status),
            })}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={isApproving}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          color="success"
          variant="contained"
          disabled={isApproving || !entry}
          startIcon={isApproving ? <CircularProgress size={16} color="inherit" /> : undefined}
          onClick={() => entry && onConfirm(entry)}
        >
          {isApproving
            ? t('paymentApprovals.approveDialog.approving')
            : t('paymentApprovals.approveDialog.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ApprovePaymentDialog;
