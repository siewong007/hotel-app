import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  CircularProgress,
  Grid,
  Divider,
} from '@mui/material';
import { format } from 'date-fns';
import { HotelAPIService } from '../../../api';
import { Booking, Guest } from '../../../types';

export const GuestCheckInVerify: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [booking, setBooking] = useState<Booking | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing verification token');
      setLoading(false);
      return;
    }

    loadBookingData();
  }, [token]);

  const loadBookingData = async () => {
    try {
      const response = await HotelAPIService.guestPortalGetBooking(token!);
      setBooking(response.booking);
      setGuest(response.guest);
    } catch (err: any) {
      setError(err.message || 'Failed to load booking information');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = () => {
    navigate(`/guest-checkin/form?token=${token}`);
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading your booking...</Typography>
      </Container>
    );
  }

  if (error || !booking || !guest) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Alert severity="error">{error || 'Booking not found'}</Alert>
          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 3 }}
            onClick={() => navigate('/guest-checkin')}
          >
            Back to Start
          </Button>
        </Paper>
      </Container>
    );
  }

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'EEEE, MMMM d, yyyy');
    } catch {
      return dateStr;
    }
  };

  const calculateNights = () => {
    const checkIn = new Date(booking.check_in_date);
    const checkOut = new Date(booking.check_out_date);
    const diffTime = Math.abs(checkOut.getTime() - checkIn.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  return (
    <Container maxWidth="md" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Your Booking Details
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Please review your booking information before continuing
          </Typography>
        </Box>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" color="primary" gutterBottom>
            Guest Information
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Name:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight="bold">
                {guest.full_name}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Email:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{guest.email}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Phone:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{guest.phone || 'Not provided'}</Typography>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" color="primary" gutterBottom>
            Stay Information
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Booking Number:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight="bold">
                {booking.folio_number || booking.id}
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Check-in:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{formatDate(booking.check_in_date)}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Check-out:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{formatDate(booking.check_out_date)}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Nights:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{calculateNights()}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Room Type:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{booking.room_type || 'Standard'}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Guests:
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2">{booking.number_of_guests || 1} Adult(s)</Typography>
            </Grid>
          </Grid>
        </Box>

        {booking.pre_checkin_completed && (
          <Alert severity="success" sx={{ mb: 3 }}>
            You have already completed pre-check-in for this booking.
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/guest-checkin')}
            sx={{ flex: 1 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleContinue}
            sx={{ flex: 1 }}
            size="large"
          >
            Continue to Update Information
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default GuestCheckInVerify;
