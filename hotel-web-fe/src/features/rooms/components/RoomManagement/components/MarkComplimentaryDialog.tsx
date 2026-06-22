import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Grid,
  Paper,
  TextField,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import { CardGiftcard as GiftIcon } from '@mui/icons-material';
import { Room, BookingWithDetails } from '../../../../../types';
import { toMoneyNumber } from '../../../../../utils/money';

interface MarkComplimentaryDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  booking: BookingWithDetails | null;
  room: Room | null;
  currencySymbol: string;
  reason: string;
  onReasonChange: (value: string) => void;
  processing: boolean;
  onConfirm: () => void;
}

const MarkComplimentaryDialog: React.FC<MarkComplimentaryDialogProps> = ({
  open,
  onClose,
  onCancel,
  booking,
  room,
  currencySymbol,
  reason,
  onReasonChange,
  processing,
  onConfirm,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'secondary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <GiftIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Mark Booking as Complimentary
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Grid container spacing={3}>
            {/* Booking Info */}
            <Grid size={12}>
              <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
                <Typography variant="subtitle2" gutterBottom>
                  Booking Details
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Room:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" fontWeight="bold">
                      {room?.room_number} - {room?.room_type}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Guest:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" fontWeight="bold">
                      {booking.guest_name}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Check-in Date:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {new Date(booking.check_in_date).toLocaleDateString()}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Check-out Date:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {new Date(booking.check_out_date).toLocaleDateString()}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      Original Amount:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'error.main' }}>
                      {currencySymbol}{toMoneyNumber(booking.total_amount).toFixed(2)}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" color="text.secondary">
                      New Amount:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" fontWeight="bold" color="success.main">
                      {currencySymbol}0.00 (Complimentary)
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* Reason Input */}
            <Grid size={12}>
              <TextField
                fullWidth
                label="Reason for Complimentary Stay"
                placeholder="e.g., VIP guest, compensation, promotional offer"
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                multiline
                rows={2}
              />
            </Grid>

            {/* Info Alert */}
            <Grid size={12}>
              <Alert severity="info" sx={{ mt: 1 }}>
                Marking this booking as complimentary will set the total amount to {currencySymbol}0.00.
                If the guest cancels or doesn't show up, the complimentary nights will be converted to credits for future use.
              </Alert>
            </Grid>
          </Grid>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onCancel} disabled={processing}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          color="secondary"
          onClick={onConfirm}
          disabled={processing}
          startIcon={processing ? <CircularProgress size={20} /> : <GiftIcon />}
          size="large"
        >
          {processing ? 'Processing...' : 'Confirm Complimentary'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MarkComplimentaryDialog;
