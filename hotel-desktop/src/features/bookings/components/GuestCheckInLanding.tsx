import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import { HotelAPIService } from '../../../api';

export const GuestCheckInLanding: React.FC = () => {
  const navigate = useNavigate();
  const [bookingNumber, setBookingNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bookingNumber.trim() || !email.trim()) {
      setError('Please enter both booking number and email');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await HotelAPIService.guestPortalVerify({
        booking_number: bookingNumber.trim(),
        email: email.trim(),
      });

      // Navigate to verification page with token
      navigate(`/guest-checkin/verify?token=${response.token}`);
    } catch (err: any) {
      setError(err.message || 'Failed to verify booking. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Online Pre-Check-In
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Complete your check-in before arrival
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Booking Number"
            value={bookingNumber}
            onChange={(e) => setBookingNumber(e.target.value)}
            margin="normal"
            required
            placeholder="Enter your booking/folio number"
            disabled={loading}
          />

          <TextField
            fullWidth
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            margin="normal"
            required
            placeholder="Enter your email address"
            disabled={loading}
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loading}
            sx={{ mt: 3 }}
            startIcon={loading && <CircularProgress size={20} />}
          >
            {loading ? 'Verifying...' : 'Continue'}
          </Button>
        </form>

        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            Pre-check-in is available 7 days before your arrival date
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default GuestCheckInLanding;
