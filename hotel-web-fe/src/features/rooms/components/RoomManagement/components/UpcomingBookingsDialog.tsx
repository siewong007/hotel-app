import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Alert,
  Paper,
  Grid,
  Stack,
  Chip,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  CalendarMonth as CalendarIcon,
  Login as LoginIcon,
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { BookingWithDetails } from '../../../../../types';
import { toMoneyNumber } from '../../../../../utils/money';

interface UpcomingBookingsDialogProps {
  open: boolean;
  onClose: () => void;
  roomNumber?: string;
  loading: boolean;
  bookings: BookingWithDetails[];
  formatCurrency: (value: number) => string;
  onCheckInBooking: (booking: BookingWithDetails) => void;
  onViewAllInBookings: () => void;
}

const UpcomingBookingsDialog: React.FC<UpcomingBookingsDialogProps> = ({
  open,
  onClose,
  roomNumber,
  loading,
  bookings,
  formatCurrency,
  onCheckInBooking,
  onViewAllInBookings,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'info.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CalendarIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Upcoming Bookings - Room {roomNumber}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {loading ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              py: 4
            }}>
            <CircularProgress />
          </Box>
        ) : bookings.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            No upcoming bookings for this room.
          </Alert>
        ) : (
          <Box sx={{ mt: 1 }}>
            {bookings.map((booking) => (
              <Paper
                key={booking.id}
                elevation={1}
                sx={{
                  p: 2,
                  mb: 2,
                  borderLeft: 4,
                  borderColor: booking.status === 'checked_in' ? 'warning.main' : 'info.main',
                }}
              >
                <Grid container spacing={2} sx={{
                  alignItems: "center"
                }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="subtitle1" sx={{
                      fontWeight: 600
                    }}>
                      {booking.guest_name || 'Unknown Guest'}
                    </Typography>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {booking.guest_email || ''} {booking.guest_phone ? `• ${booking.guest_phone}` : ''}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block"
                      }}>
                      Check-in
                    </Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>
                      {new Date(booking.check_in_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block"
                      }}>
                      Check-out
                    </Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>
                      {new Date(booking.check_out_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Typography>
                  </Grid>
                  <Grid size={12}>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{
                        flexWrap: "wrap",
                        alignItems: "center"
                      }}>
                      {(() => {
                        const checkInDate = new Date(booking.check_in_date);
                        checkInDate.setHours(0, 0, 0, 0);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const isToday = checkInDate.getTime() === today.getTime();
                        const canCheckIn = isToday && (booking.status === 'confirmed' || booking.status === 'pending');

                        if (booking.status === 'checked_in' || booking.status === 'auto_checked_in') {
                          return (
                            <Chip
                              label="Currently Occupied"
                              size="small"
                              color="warning"
                            />
                          );
                        } else if (canCheckIn) {
                          return (
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<LoginIcon />}
                              onClick={() => onCheckInBooking(booking)}
                              sx={{ fontWeight: 600 }}
                            >
                              Check-In Now
                            </Button>
                          );
                        } else {
                          return (
                            <Chip
                              label={booking.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                              size="small"
                              color={booking.status === 'confirmed' ? 'info' : 'default'}
                            />
                          );
                        }
                      })()}
                      {booking.is_complimentary && (
                        <Chip
                          icon={<GiftIcon />}
                          label="Free Gift"
                          size="small"
                          color="secondary"
                        />
                      )}
                      <Chip
                        label={formatCurrency(toMoneyNumber(booking.total_amount))}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                  </Grid>
                  {booking.special_requests && (
                    <Grid size={12}>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        <strong>Notes:</strong> {booking.special_requests}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </Paper>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onViewAllInBookings}
          variant="outlined"
          color="primary"
        >
          View All in Bookings Page
        </Button>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpcomingBookingsDialog;
