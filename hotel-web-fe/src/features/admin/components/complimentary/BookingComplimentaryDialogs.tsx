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
      emitApiNotification({ message: 'Complimentary booking updated successfully', severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, 'Failed to update'), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Complimentary Booking</DialogTitle>
      <DialogContent>
        {booking && (
          <Box sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              Booking: {booking.booking_number} - {booking.guest_name}
            </Alert>
            <Grid container spacing={2}>
              <Grid size={6}>
                <TextField
                  fullWidth
                  label="Complimentary Start Date"
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
                  label="Complimentary End Date"
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
                  label="Reason"
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
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleUpdate} variant="contained" disabled={processing}>
          {processing ? 'Updating...' : 'Update'}
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
  const { format: formatCurrency } = useCurrency();
  const [processing, setProcessing] = useState(false);

  const handleRemove = async () => {
    if (!booking) return;
    try {
      setProcessing(true);
      await BookingsService.removeComplimentary(booking.id.toString());
      emitApiNotification({ message: 'Complimentary status removed successfully', severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, 'Failed to remove'), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Remove Complimentary Status</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Are you sure you want to remove the complimentary status from this booking? The original
          amount will be restored.
        </Alert>
        {booking && (
          <Box>
            <Typography variant="body2">
              <strong>Booking:</strong> {booking.booking_number}
            </Typography>
            <Typography variant="body2">
              <strong>Guest:</strong> {booking.guest_name}
            </Typography>
            <Typography variant="body2">
              <strong>Complimentary Nights:</strong> {booking.complimentary_nights}
            </Typography>
            {booking.original_total_amount && (
              <Typography variant="body2">
                <strong>Original Amount:</strong>{' '}
                {formatCurrency(parseFloat(booking.original_total_amount as string))}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleRemove} variant="contained" color="error" disabled={processing}>
          {processing ? 'Removing...' : 'Remove Complimentary'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
