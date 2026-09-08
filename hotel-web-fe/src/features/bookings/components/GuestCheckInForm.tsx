import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from '../../../router';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import { GuestPortalService } from '../../../api';
import { Booking, Guest } from '../../../types';
import { GuestPaymentPanel } from '../../guestPortal/components/GuestPaymentPanel';
import { errorMessage } from '../../../utils/errorMessage';
import { captureBookingAccessToken } from '../../guestPortal/api/bookingAccessTokenStore';

function needsOnlinePayment(status: string | undefined): boolean {
  return status === 'pending' || status === 'pending_payment';
}

export const GuestCheckInForm: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = captureBookingAccessToken(searchParams);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBookingData = useCallback(async () => {
    try {
      const response = await GuestPortalService.getBooking(token!);
      setBooking(response.booking);
      setGuest(response.guest);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load booking'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (searchParams.has('token')) {
      const next = new URLSearchParams(searchParams);
      next.delete('token');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing token');
      setLoading(false);
      return;
    }

    loadBookingData();
  }, [token, loadBookingData]);

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading...</Typography>
      </Container>
    );
  }

  if (error && !booking) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Alert severity="error">{error}</Alert>
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

  const showPayment = Boolean(token && needsOnlinePayment(booking?.status));

  return (
    <Container maxWidth="md" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            {showPayment ? 'Complete your payment' : 'Your booking'}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {showPayment
              ? 'Pay securely to confirm your reservation. No extra personal details are required.'
              : 'Payment is not required for this booking right now.'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {(booking?.booking_number || guest?.full_name) && (
          <Box sx={{ mb: 3 }}>
            {booking?.booking_number && (
              <Typography variant="body1">
                Booking <strong>{booking.booking_number}</strong>
              </Typography>
            )}
            {booking?.check_in_date && booking?.check_out_date && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {booking.check_in_date} to {booking.check_out_date}
              </Typography>
            )}
            {guest?.full_name && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {guest.full_name}
              </Typography>
            )}
          </Box>
        )}

        {showPayment && (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
            {/*
              The pre-arrival token endpoint (`GET /guest-portal/booking/:token`,
              backed by GuestPortalBookingView) is a guest-safe subset that does
              not include a total/amount field — it exposes only
              id/booking_number/dates/status/adults/children/special_requests/
              market_code/pre_checkin fields. There is no other unauthenticated
              endpoint that returns the booking total for this token flow, so
              `amount` is intentionally omitted here rather than guessed; the
              panel still functions correctly because the backend derives the
              charge from the booking server-side and never accepts an amount
              from the client.
            */}
            <GuestPaymentPanel mode="token" token={token!} />
          </Paper>
        )}

        {!showPayment && (
          <Alert severity="info" sx={{ mb: 3 }}>
            Online pre-check-in is no longer part of this flow. Please complete
            any remaining details with the hotel at arrival if needed.
          </Alert>
        )}

        <Button
          variant="outlined"
          fullWidth
          onClick={() => navigate('/guest-checkin')}
        >
          Back
        </Button>
      </Paper>
    </Container>
  );
};

export default GuestCheckInForm;
