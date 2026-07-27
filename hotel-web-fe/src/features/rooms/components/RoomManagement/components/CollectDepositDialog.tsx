import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import { Receipt as ReceiptIcon } from '@mui/icons-material';
import { BookingWithDetails } from '../../../../../types';

interface CollectDepositDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  booking: BookingWithDetails | null;
  paymentMethod: string;
  onPaymentMethodChange: (value: string) => void;
  paymentMethods: readonly string[];
  processing: boolean;
  onCollect: () => void;
}

const CollectDepositDialog: React.FC<CollectDepositDialogProps> = ({
  open,
  onClose,
  onCancel,
  booking,
  paymentMethod,
  onPaymentMethodChange,
  paymentMethods,
  processing,
  onCollect,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'warning.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ReceiptIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Collect Deposit - Room {booking?.room_number}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Box>
            {/* Booking Summary */}
            <Paper elevation={0} sx={{ p: 2, mb: 3, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{
                color: "text.secondary"
              }}>
                Booking #{booking.booking_number}
              </Typography>

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={12}>
                  <Typography variant="h6" sx={{
                    fontWeight: 600
                  }}>
                    {booking.guest_name}
                  </Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {booking.guest_email}
                  </Typography>
                </Grid>

                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Check-in</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {new Date(booking.check_in_date).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Check-out</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {new Date(booking.check_out_date).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* Deposit Amount */}
            {/* Payment Method Selection */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Payment Method *</InputLabel>
              <Select
                value={paymentMethod}
                onChange={(e) => onPaymentMethodChange(e.target.value)}
                label="Payment Method *"
              >
                {paymentMethods.map((method) => (
                  <MenuItem key={method} value={method}>
                    {method}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Alert severity="info" sx={{ mt: 2 }}>
              After deposit is collected, the guest can be checked in.
            </Alert>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onCancel}
          disabled={processing}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={onCollect}
          disabled={processing || !paymentMethod}
          startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <ReceiptIcon />}
        >
          {processing ? 'Processing...' : 'Collect Deposit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CollectDepositDialog;
