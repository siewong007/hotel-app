import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import type { BookingWithDetails } from '../../../../../types';
import { useReactivateBookingMutation } from '../../../hooks/useBookingQueries';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import { getErrorMessage } from '../../../utils/bookingPageUtils';
import { useTranslation } from '../../../../../i18n';

interface ReactivateDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const ReactivateDialog: React.FC<ReactivateDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
  const { t } = useTranslation('bookings');
  const [reactivating, setReactivating] = useState(false);
  const reactivateBookingMutation = useReactivateBookingMutation();

  const handleConfirm = async () => {
    if (!booking) return;
    try {
      setReactivating(true);
      await reactivateBookingMutation.mutateAsync(booking.id);
      emitApiNotification({ severity: 'success', message: t('reactivate.success') });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || t('reactivate.failed'));
    } finally {
      setReactivating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('reactivate.title')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('reactivate.warning')}
        </Alert>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2"><strong>{t('labels.guest')}</strong> {booking?.guest_name}</Typography>
          <Typography variant="body2"><strong>{t('labels.room')}</strong> {booking?.room_type} - {t('details.roomNumber', { number: booking?.room_number })}</Typography>
          <Typography variant="body2"><strong>{t('labels.checkIn')}</strong> {booking?.formatted_check_in || booking?.check_in_date}</Typography>
          <Typography variant="body2"><strong>{t('labels.checkOut')}</strong> {booking?.formatted_check_out || booking?.check_out_date}</Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleConfirm} variant="contained" color="success" disabled={reactivating}>
          {reactivating ? t('reactivate.processing') : t('reactivate.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReactivateDialog;
