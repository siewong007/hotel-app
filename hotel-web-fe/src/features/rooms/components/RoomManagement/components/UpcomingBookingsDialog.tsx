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
} from '@mui/material';
import {
  CalendarMonth as CalendarIcon,
  Login as LoginIcon,
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { LogoLoader } from '../../../../../components';
import { BookingWithDetails } from '../../../../../types';
import { toMoneyNumber } from '../../../../../utils/money';
import { useTranslation } from '../../../../../i18n/useTranslation';
import { statusLabel } from '../../../../../i18n/statusLabel';
import { intlTag } from '../../../../../i18n/format';
import { parseLocalDate } from '../../../../../utils/date';

const formatStayDay = (value: string): string =>
  parseLocalDate(value).toLocaleDateString(intlTag(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

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
  const { t } = useTranslation('rooms');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'var(--hotel-info-bg)', color: 'var(--hotel-info)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CalendarIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('upcoming.title', { room: roomNumber })}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {loading ? (
          <LogoLoader variant="page" minHeight={120} />
        ) : bookings.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('upcoming.empty')}
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
                      {booking.guest_name || t('upcoming.unknownGuest')}
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
                      {t('fields.checkIn')}
                    </Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>
                      {formatStayDay(booking.check_in_date)}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block"
                      }}>
                      {t('fields.checkOut')}
                    </Typography>
                    <Typography variant="body2" sx={{
                      fontWeight: 500
                    }}>
                      {formatStayDay(booking.check_out_date)}
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
                              label={t('upcoming.currentlyOccupied')}
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
                              {t('upcoming.checkInNow')}
                            </Button>
                          );
                        } else {
                          return (
                            <Chip
                              label={statusLabel(t, 'booking', booking.status)}
                              size="small"
                              color={booking.status === 'confirmed' ? 'info' : 'default'}
                            />
                          );
                        }
                      })()}
                      {booking.is_complimentary && (
                        <Chip
                          icon={<GiftIcon />}
                          label={t('upcoming.freeGift')}
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
                        <strong>{t('fields.notes')}:</strong> {booking.special_requests}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </Paper>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onViewAllInBookings}
          variant="outlined"
          color="primary"
        >
          {t('upcoming.viewAll')}
        </Button>
        <Button onClick={onClose} variant="contained">
          {t('common:actions.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpcomingBookingsDialog;
