import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { BookingsService } from '../../../../api';
import type { BookingWithDetails } from '../../../../types';
import { errorMessage } from '../../../../utils';
import { useCurrency } from '../../../../hooks/useCurrency';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { useTranslation } from '../../../../i18n';

interface BookingDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
}

export const EditComplimentaryDialog: React.FC<BookingDialogProps> = ({
  open,
  booking,
  onClose,
  onCompleted,
}) => {
  const { t } = useTranslation('bookings');
  const [formData, setFormData] = useState({
    complimentary_start_date: '',
    complimentary_end_date: '',
    complimentary_reason: '',
  });
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (open && booking) {
      setFormData({
        complimentary_start_date: booking.complimentary_start_date || '',
        complimentary_end_date: booking.complimentary_end_date || '',
        complimentary_reason: booking.complimentary_reason || '',
      });
    }
  }, [open, booking]);

  const handleUpdate = async () => {
    if (!booking) return;
    try {
      setProcessing(true);
      await BookingsService.updateComplimentary(booking.id.toString(), formData);
      emitApiNotification({ message: t('comp.updated'), severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('comp.updateFailed')), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('comp.editTitle')}</DialogTitle>
      <DialogContent>
        {booking && (
          <Box sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('comp.bookingLine', { number: booking.booking_number, guest: booking.guest_name })}
            </Alert>
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  fullWidth
                  label={t('comp.startDate')}
                  type="date"
                  value={formData.complimentary_start_date}
                  onChange={(e) =>
                    setFormData({ ...formData, complimentary_start_date: e.target.value })
                  }
                  slotProps={{
                    htmlInput: {
                      min: booking.check_in_date,
                      max: booking.check_out_date,
                    },

                    inputLabel: { shrink: true }
                  }} />
              </Grid>
              <Grid size={6}>
                <TextField
                  fullWidth
                  label={t('comp.endDate')}
                  type="date"
                  value={formData.complimentary_end_date}
                  onChange={(e) =>
                    setFormData({ ...formData, complimentary_end_date: e.target.value })
                  }
                  slotProps={{
                    htmlInput: {
                      min: booking.check_in_date,
                      max: booking.check_out_date,
                    },

                    inputLabel: { shrink: true }
                  }} />
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label={t('comp.reason')}
                  multiline
                  rows={2}
                  value={formData.complimentary_reason}
                  onChange={(e) =>
                    setFormData({ ...formData, complimentary_reason: e.target.value })
                  }
                />
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleUpdate} variant="contained" disabled={processing}>
          {processing ? t('comp.updating') : t('comp.update')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const RemoveComplimentaryDialog: React.FC<BookingDialogProps> = ({
  open,
  booking,
  onClose,
  onCompleted,
}) => {
  const { t } = useTranslation('bookings');
  const { format: formatCurrency } = useCurrency();
  const [processing, setProcessing] = useState(false);

  const handleRemove = async () => {
    if (!booking) return;
    try {
      setProcessing(true);
      await BookingsService.removeComplimentary(booking.id.toString());
      emitApiNotification({ message: t('comp.removed'), severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('comp.removeFailed')), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('comp.removeTitle')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('comp.removeWarning')}
        </Alert>
        {booking && (
          <Box>
            <Typography variant="body2">
              <strong>{t('comp.bookingLabel')}</strong> {booking.booking_number}
            </Typography>
            <Typography variant="body2">
              <strong>{t('comp.guestLabel')}</strong> {booking.guest_name}
            </Typography>
            <Typography variant="body2">
              <strong>{t('comp.compNightsLabel')}</strong> {booking.complimentary_nights}
            </Typography>
            {booking.original_total_amount && (
              <Typography variant="body2">
                <strong>{t('comp.originalAmount')}</strong>{' '}
                {formatCurrency(parseFloat(booking.original_total_amount as string))}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleRemove} variant="contained" color="error" disabled={processing}>
          {processing ? t('comp.removing') : t('comp.remove')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
