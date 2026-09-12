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

interface ReleaseDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

// Release an unpaid hold. Reason is required — see releaseBooking.
const ReleaseDialog: React.FC<ReleaseDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
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
          ? `Room released. Rerun night audit for ${affectedDates.join(', ')} to refresh reports.`
          : 'Room released and the booking voided.',
      });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to release booking');
    } finally {
      setReleasing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Release Room</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This booking is still awaiting payment. Releasing puts the room back on sale and voids the booking. Bookings with payments recorded against them must be voided through the refund flow instead.
        </Alert>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2"><strong>Guest:</strong> {booking?.guest_name}</Typography>
          <Typography variant="body2"><strong>Room:</strong> {booking?.room_type} - Room {booking?.room_number}</Typography>
          <Typography variant="body2"><strong>Check-in:</strong> {booking?.formatted_check_in || booking?.check_in_date}</Typography>
          <Typography variant="body2"><strong>Check-out:</strong> {booking?.formatted_check_out || booking?.check_out_date}</Typography>
        </Box>
        <TextField
          fullWidth
          required
          multiline
          rows={3}
          label="Reason for releasing"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. No payment received after 7 days"
          helperText="Recorded in the booking history and the audit log."
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="warning"
          disabled={releasing || reason.trim().length < 4}
        >
          {releasing ? 'Releasing...' : 'Release Room'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReleaseDialog;
