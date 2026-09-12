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

interface ReactivateDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const ReactivateDialog: React.FC<ReactivateDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
  const [reactivating, setReactivating] = useState(false);
  const reactivateBookingMutation = useReactivateBookingMutation();

  const handleConfirm = async () => {
    if (!booking) return;
    try {
      setReactivating(true);
      await reactivateBookingMutation.mutateAsync(booking.id);
      emitApiNotification({ severity: 'success', message: 'Booking reactivated successfully!' });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to reactivate booking');
    } finally {
      setReactivating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Reactivate Booking</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will reactivate the voided booking and reserve the room. Make sure the room is available for the booking dates.
        </Alert>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2"><strong>Guest:</strong> {booking?.guest_name}</Typography>
          <Typography variant="body2"><strong>Room:</strong> {booking?.room_type} - Room {booking?.room_number}</Typography>
          <Typography variant="body2"><strong>Check-in:</strong> {booking?.formatted_check_in || booking?.check_in_date}</Typography>
          <Typography variant="body2"><strong>Check-out:</strong> {booking?.formatted_check_out || booking?.check_out_date}</Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleConfirm} variant="contained" color="success" disabled={reactivating}>
          {reactivating ? 'Reactivating...' : 'Reactivate Booking'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReactivateDialog;
