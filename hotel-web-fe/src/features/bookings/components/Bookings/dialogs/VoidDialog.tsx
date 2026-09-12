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

interface VoidDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const VoidDialog: React.FC<VoidDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
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
          ? `Booking voided successfully. Rerun night audit for ${affectedDates.join(', ')} to refresh reports.`
          : 'Booking voided successfully',
      });
      onClose();
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to void booking');
    } finally {
      setVoiding(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Void Booking</DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ mb: 2 }}>
          Voiding a booking will permanently remove it from all reports including night audit. This cannot be undone.
        </Alert>
        {needsAuditReview && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {auditDates.length > 0
              ? `This booking was included in night audit for ${auditDates.join(', ')}. Rerun night audit for those date(s) after voiding to refresh the report.`
              : 'This booking is marked as posted in night audit. After voiding, rerun the affected night audit date returned by the system to refresh the report.'}
          </Alert>
        )}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2"><strong>Guest:</strong> {booking?.guest_name}</Typography>
          <Typography variant="body2"><strong>Room:</strong> {booking?.room_type} - Room {booking?.room_number}</Typography>
          <Typography variant="body2"><strong>Check-in:</strong> {booking?.formatted_check_in || booking?.check_in_date}</Typography>
          <Typography variant="body2"><strong>Check-out:</strong> {booking?.formatted_check_out || booking?.check_out_date}</Typography>
        </Box>
        <TextField
          fullWidth
          multiline
          rows={3}
          label="Void Reason (Optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter reason for voiding..."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleConfirm} variant="contained" color="error" disabled={voiding}>
          {voiding ? 'Voiding...' : 'Void Booking'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default VoidDialog;
