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
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { useTranslation } from '../../../i18n';

export const GuestCheckInLanding: React.FC = () => {
  const { t } = useTranslation('guestPortal');
  const navigate = useNavigate();
  const [bookingNumber, setBookingNumber] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bookingNumber.trim() || !name.trim()) {
      setError(t('checkin.landing.errors.missingFields'));
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
      setError(guestErrorMessage(err, t('checkin.landing.errors.verifyFailed')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: { xs: 3, sm: 8 } }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            {t('checkin.landing.title')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('checkin.landing.subtitle')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" role="alert" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label={t('checkin.landing.bookingNumber')}
            value={bookingNumber}
            onChange={(e) => setBookingNumber(e.target.value)}
            margin="normal"
            required
            placeholder={t('checkin.landing.bookingNumberPlaceholder')}
            disabled={loading}
          />

          <TextField
            fullWidth
            label={t('checkin.landing.guestName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            margin="normal"
            required
            placeholder={t('checkin.landing.guestNamePlaceholder')}
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
            {loading ? t('checkin.landing.verifying') : t('checkin.continue')}
          </Button>
        </form>

        <Box sx={{ mt: 3, textAlign: 'center' }}>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {t('checkin.landing.availabilityNote')}
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
};

export default GuestCheckInLanding;
