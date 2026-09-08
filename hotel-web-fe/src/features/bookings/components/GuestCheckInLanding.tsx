import React, { useState } from 'react';
import { useNavigate } from '../../../router';
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
import { GuestPortalService } from '../../../api';
import { setBookingAccessToken } from '../../guestPortal/api/bookingAccessTokenStore';
import { errorMessage } from '../../../utils/errorMessage';

export const GuestCheckInLanding: React.FC = () => {
  const navigate = useNavigate();
  const [bookingNumber, setBookingNumber] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bookingNumber.trim() || !name.trim()) {
      setError('Please enter both booking number and name');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await GuestPortalService.verify({
        booking_number: bookingNumber.trim(),
        name: name.trim(),
      });

      setBookingAccessToken(response.token);
      navigate('/guest-checkin/verify');
    } catch (err) {
      setError(errorMessage(err, 'Failed to verify booking. Please check your details.'));
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
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
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
            label="Guest Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            margin="normal"
            required
            placeholder="Enter the name on the booking"
            autoComplete="name"
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
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Pre-check-in is available 7 days before your arrival date
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default GuestCheckInLanding;
