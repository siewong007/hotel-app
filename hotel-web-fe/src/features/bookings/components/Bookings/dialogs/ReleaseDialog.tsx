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
import { getErrorMessage } from '../../../utils/bookingPageUtils';
import { useTranslation } from '../../../../../i18n';

interface ReleaseDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

// Release an unpaid hold. Reason is required — see releaseBooking.
const ReleaseDialog: React.FC<ReleaseDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
  const { t } = useTranslation('bookings');
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const handleConfirm = async () => {
    if (!booking) return;
    try {
      setReleasing(true);
      const result = await BookingsService.releaseBooking(
        booking.id,
        reason.trim(),
      );
      const affectedDates = result.affected_night_audit_dates || [];
      emitApiNotification({
        severity: 'success',
        message: affectedDates.length > 0
          ? t('release.successAudit', { dates: affectedDates.join(', ') })
          : t('release.success'),
      });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || t('release.failed'));
    } finally {
      setReleasing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('release.title')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('release.warning')}
        </Alert>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2"><strong>{t('labels.guest')}</strong> {booking?.guest_name}</Typography>
          <Typography variant="body2"><strong>{t('labels.room')}</strong> {booking?.room_type} - {t('details.roomNumber', { number: booking?.room_number })}</Typography>
          <Typography variant="body2"><strong>{t('labels.checkIn')}</strong> {booking?.formatted_check_in || booking?.check_in_date}</Typography>
          <Typography variant="body2"><strong>{t('labels.checkOut')}</strong> {booking?.formatted_check_out || booking?.check_out_date}</Typography>
        </Box>
        <TextField
          fullWidth
          required
          multiline
          rows={3}
          label={t('release.reasonLabel')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('release.reasonPlaceholder')}
          helperText={t('release.reasonHelper')}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="warning"
          disabled={releasing || reason.trim().length < 4}
        >
          {releasing ? t('release.processing') : t('release.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReleaseDialog;
