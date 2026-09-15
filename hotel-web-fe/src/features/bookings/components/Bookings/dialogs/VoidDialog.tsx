import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import type { BookingWithDetails } from '../../../../../types';
import { BookingsService } from '../../../../../api';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import {
  getErrorMessage,
  getKnownNightAuditDates,
  isNightAuditInvolved,
} from '../../../utils/bookingPageUtils';
import { useTranslation } from '../../../../../i18n';

interface VoidDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const VoidDialog: React.FC<VoidDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
  const { t } = useTranslation('bookings');
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const auditDates = getKnownNightAuditDates(booking);
  const needsAuditReview = isNightAuditInvolved(booking);

  const handleConfirm = async () => {
    if (!booking) return;
    try {
      setVoiding(true);
      const result = await BookingsService.voidBooking({
        booking_id: booking.id,
        reason: reason.trim() || 'Voided by admin',
      });
      const affectedDates = result.affected_night_audit_dates || [];
      emitApiNotification({
        severity: 'success',
        message: affectedDates.length > 0
          ? t('void.successAudit', { dates: affectedDates.join(', ') })
          : t('void.success'),
      });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || t('void.failed'));
    } finally {
      setVoiding(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('void.title')}</DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('void.warning')}
        </Alert>
        {needsAuditReview && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {auditDates.length > 0
              ? t('void.auditDatesNotice', { dates: auditDates.join(', ') })
              : t('void.auditPostedNotice')}
          </Alert>
        )}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2"><strong>{t('labels.guest')}</strong> {booking?.guest_name}</Typography>
          <Typography variant="body2"><strong>{t('labels.room')}</strong> {booking?.room_type} - {t('details.roomNumber', { number: booking?.room_number })}</Typography>
          <Typography variant="body2"><strong>{t('labels.checkIn')}</strong> {booking?.formatted_check_in || booking?.check_in_date}</Typography>
          <Typography variant="body2"><strong>{t('labels.checkOut')}</strong> {booking?.formatted_check_out || booking?.check_out_date}</Typography>
        </Box>
        <TextField
          fullWidth
          multiline
          rows={3}
          label={t('void.reasonLabel')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('void.reasonPlaceholder')}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleConfirm} variant="contained" color="error" disabled={voiding}>
          {voiding ? t('void.processing') : t('void.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default VoidDialog;
