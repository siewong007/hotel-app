import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  CircularProgress,
  Alert,
  Grid,
  Divider,
} from '@mui/material';
import {
  CalendarMonth as CalendarIcon,
} from '@mui/icons-material';
import { BookingWithDetails } from '../../../types';
import { HotelAPIService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';

interface UpdateCheckoutDateDialogProps {
  open: boolean;
  onClose: () => void;
  booking: BookingWithDetails | null;
  onSuccess: () => void;
}

const UpdateCheckoutDateDialog: React.FC<UpdateCheckoutDateDialogProps> = ({
  open,
  onClose,
  booking,
  onSuccess,
}) => {
  const { format: formatCurrency } = useCurrency();
  const [newCheckoutDate, setNewCheckoutDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && booking) {
      const currentCheckout = typeof booking.check_out_date === 'string'
        ? booking.check_out_date.split('T')[0]
        : new Date(booking.check_out_date).toISOString().split('T')[0];
      setNewCheckoutDate(currentCheckout);
      setError(null);
    }
  }, [open, booking]);

  if (!booking) return null;

  const checkInDate = typeof booking.check_in_date === 'string'
    ? booking.check_in_date.split('T')[0]
    : new Date(booking.check_in_date).toISOString().split('T')[0];

  const currentCheckoutDate = typeof booking.check_out_date === 'string'
    ? booking.check_out_date.split('T')[0]
    : new Date(booking.check_out_date).toISOString().split('T')[0];

  const pricePerNight = typeof booking.price_per_night === 'string'
    ? parseFloat(booking.price_per_night)
    : booking.price_per_night || 0;

  const currentNights = Math.max(
    Math.ceil((new Date(currentCheckoutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24)),
    1
  );

  const newNights = newCheckoutDate
    ? Math.max(
        Math.ceil((new Date(newCheckoutDate).getTime() - new Date(checkInDate).getTime()) / (1000 * 60 * 60 * 24)),
        0
      )
    : currentNights;

  const currentTotal = pricePerNight * currentNights;
  const newTotal = pricePerNight * Math.max(newNights, 1);
  const difference = newTotal - currentTotal;
  const isValid = newNights >= 1 && newCheckoutDate !== currentCheckoutDate;

  const handleSubmit = async () => {
    if (!isValid) return;

    try {
      setLoading(true);
      setError(null);

      await HotelAPIService.updateBooking(String(booking.id), {
        check_out_date: newCheckoutDate,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update checkout date');
    } finally {
      setLoading(false);
    }
  };

  // Min date is day after check-in
  const minCheckoutDate = new Date(new Date(checkInDate).getTime() + 86400000)
    .toISOString().split('T')[0];

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center">
          <CalendarIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">Update Checkout Date</Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Current Booking Info */}
          <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>Current Booking</Typography>
            <Grid container spacing={1}>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">Guest</Typography>
                <Typography variant="body2" fontWeight={600}>{booking.guest_name}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">Room</Typography>
                <Typography variant="body2" fontWeight={600}>{booking.room_number} - {booking.room_type}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">Check-in</Typography>
                <Typography variant="body2" fontWeight={600}>{new Date(checkInDate).toLocaleDateString()}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">Current Checkout</Typography>
                <Typography variant="body2" fontWeight={600}>{new Date(currentCheckoutDate).toLocaleDateString()}</Typography>
              </Grid>
            </Grid>
          </Box>

          {/* New Checkout Date Picker */}
          <TextField
            label="New Checkout Date"
            type="date"
            value={newCheckoutDate}
            onChange={(e) => setNewCheckoutDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: minCheckoutDate }}
            fullWidth
          />

          <Divider />

          {/* Price Preview */}
          <Box sx={{ bgcolor: 'primary.50', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>Price Preview</Typography>
            <Grid container spacing={1}>
              <Grid item xs={8}>
                <Typography variant="body2" color="text.secondary">Rate per night</Typography>
              </Grid>
              <Grid item xs={4} sx={{ textAlign: 'right' }}>
                <Typography variant="body2">{formatCurrency(pricePerNight)}</Typography>
              </Grid>
              <Grid item xs={8}>
                <Typography variant="body2" color="text.secondary">
                  Current: {currentNights} night(s)
                </Typography>
              </Grid>
              <Grid item xs={4} sx={{ textAlign: 'right' }}>
                <Typography variant="body2">{formatCurrency(currentTotal)}</Typography>
              </Grid>
              <Grid item xs={8}>
                <Typography variant="body2" fontWeight={600}>
                  New: {Math.max(newNights, 1)} night(s)
                </Typography>
              </Grid>
              <Grid item xs={4} sx={{ textAlign: 'right' }}>
                <Typography variant="body2" fontWeight={600}>{formatCurrency(newTotal)}</Typography>
              </Grid>
              {difference !== 0 && (
                <>
                  <Grid item xs={12}><Divider sx={{ my: 0.5 }} /></Grid>
                  <Grid item xs={8}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color={difference > 0 ? 'error.main' : 'success.main'}
                    >
                      {difference > 0 ? 'Additional Charge' : 'Reduction'}
                    </Typography>
                  </Grid>
                  <Grid item xs={4} sx={{ textAlign: 'right' }}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color={difference > 0 ? 'error.main' : 'success.main'}
                    >
                      {difference > 0 ? '+' : '-'}{formatCurrency(Math.abs(difference))}
                    </Typography>
                  </Grid>
                </>
              )}
            </Grid>
          </Box>

          {newNights < 1 && (
            <Alert severity="error">
              Checkout date must be at least one day after check-in.
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !isValid}
          startIcon={loading ? <CircularProgress size={20} /> : <CalendarIcon />}
        >
          {loading ? 'Updating...' : 'Update Checkout Date'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpdateCheckoutDateDialog;
