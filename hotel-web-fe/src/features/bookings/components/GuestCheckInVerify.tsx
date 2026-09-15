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
  Grid,
  Divider,
} from '@mui/material';
import { format } from 'date-fns';
import { GuestPortalService } from '../../../api';
import { Booking, Guest } from '../../../types';
import { guestErrorMessage } from '../../guestPortal/utils/feedback';
import { captureBookingAccessToken } from '../../guestPortal/api/bookingAccessTokenStore';
import { useTranslation } from '../../../i18n';

export const GuestCheckInVerify: React.FC = () => {
  const { t } = useTranslation('guestPortal');
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
      setError(guestErrorMessage(err, t('checkin.verify.errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (searchParams.has('token')) {
      const next = new URLSearchParams(searchParams);
      next.delete('token');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!token) {
      setError(t('checkin.verify.errors.missingToken'));
      setLoading(false);
      return;
    }

    loadBookingData();
  }, [token, loadBookingData, t]);

  const handleContinue = () => {
    navigate('/guest-checkin/form');
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>{t('checkin.verify.loading')}</Typography>
      </Container>
    );
  }

  if (error || !booking || !guest) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Alert severity="error" role="alert">
            {error || t('checkin.verify.errors.notFound')}
          </Alert>
          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 3 }}
            onClick={() => navigate('/guest-checkin')}
          >
            {t('checkin.backToStart')}
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
            {t('checkin.verify.title')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('checkin.verify.subtitle')}
          </Typography>
        </Box>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" component="h2" color="primary" gutterBottom>
            {t('checkin.verify.guestInfo')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Grid container spacing={2}>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.name')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                fontWeight: "bold"
              }}>
                {guest.nick_name}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.email')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{guest.email}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.phone')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{guest.phone || t('checkin.verify.notProvided')}</Typography>
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" component="h2" color="primary" gutterBottom>
            {t('checkin.verify.stayInfo')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Grid container spacing={2}>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.bookingNumber')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                fontWeight: "bold"
              }}>
                {booking.folio_number || booking.id}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.checkIn')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{formatDate(booking.check_in_date)}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.checkOut')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{formatDate(booking.check_out_date)}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.nights')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{calculateNights()}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.roomType')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">{booking.room_type || t('checkin.verify.standardRoom')}</Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('checkin.verify.fields.guests')}
              </Typography>
            </Grid>
            <Grid size={6}>
              <Typography variant="body2">
                {t('checkin.verify.adults', { count: booking.number_of_guests || 1 })}
              </Typography>
            </Grid>
          </Grid>
        </Box>

        {booking.pre_checkin_completed && (
          <Alert severity="success" role="alert" sx={{ mb: 3 }}>
            {t('checkin.verify.alreadyCompleted')}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/guest-checkin')}
            sx={{ flex: 1 }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleContinue}
            sx={{ flex: 1 }}
            size="large"
          >
            {t('checkin.verify.continue')}
          </Button>
        </Box>
      </Paper>
    </Container>
  );
};

export default GuestCheckInVerify;
