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
import { BookingsService } from '../../../api';
import { useCurrency } from '../../../hooks/useCurrency';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { formatLocalDate, addLocalDays, formatHotelDate } from '../../../utils/date';
import { isGreaterMoney, multiplyMoney, subtractMoney, sumMoney, toMoneyNumber } from '../../../utils/money';
import { errorMessage } from '../../../utils/errorMessage';
import { useTranslation } from '../../../i18n/useTranslation';

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
  const { t } = useTranslation('rooms');
  const { format: formatCurrency } = useCurrency();
  const [newCheckoutDate, setNewCheckoutDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && booking) {
      const currentCheckout = typeof booking.check_out_date === 'string'
        ? booking.check_out_date.split('T')[0]
        : formatLocalDate(new Date(booking.check_out_date));
      setNewCheckoutDate(currentCheckout);
      setError(null);
    }
  }, [open, booking]);

  if (!booking) return null;

  const checkInDate = typeof booking.check_in_date === 'string'
    ? booking.check_in_date.split('T')[0]
    : formatLocalDate(new Date(booking.check_in_date));

  const currentCheckoutDate = typeof booking.check_out_date === 'string'
    ? booking.check_out_date.split('T')[0]
    : formatLocalDate(new Date(booking.check_out_date));

  const pricePerNight = toMoneyNumber(booking.price_per_night);
  const hotelSettings = getHotelSettings();
  const isForeignTourist = booking.guest_tourism_type === 'foreign' || booking.is_tourist === true;
  const tourismTaxRate = toMoneyNumber(hotelSettings.tourism_tax_rate);

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

  const previewNights = Math.max(newNights, 1);
  const currentRoomTotal = multiplyMoney(pricePerNight, currentNights);
  const newRoomTotal = multiplyMoney(pricePerNight, previewNights);
  const currentTourismTax = isForeignTourist ? multiplyMoney(tourismTaxRate, currentNights) : 0;
  const newTourismTax = isForeignTourist ? multiplyMoney(tourismTaxRate, previewNights) : 0;
  const currentTotal = sumMoney([currentRoomTotal, currentTourismTax]);
  const newTotal = sumMoney([newRoomTotal, newTourismTax]);
  const difference = subtractMoney(newTotal, currentTotal);
  const isValid = newNights >= 1 && newCheckoutDate !== currentCheckoutDate;

  const handleSubmit = async () => {
    if (!isValid) return;

    try {
      setLoading(true);
      setError(null);

      await BookingsService.updateBooking(String(booking.id), {
        check_out_date: newCheckoutDate,
      });

      onSuccess();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('errors.extendCheckout')));
    } finally {
      setLoading(false);
    }
  };

  // Min date is day after check-in
  const minCheckoutDate = formatLocalDate(addLocalDays(checkInDate, 1));

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center"
          }}>
          <CalendarIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">{t('extendCheckout.title')}</Typography>
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
          <Box sx={{ bgcolor: 'var(--hotel-surface-raised)', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>{t('extendCheckout.currentBooking')}</Typography>
            <Grid container spacing={1}>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('fields.guest')}</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{booking.guest_name}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('fields.room')}</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{booking.room_number} - {booking.room_type}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('fields.checkIn')}</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{formatHotelDate(checkInDate)}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('extendCheckout.currentCheckout')}</Typography>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{formatHotelDate(currentCheckoutDate)}</Typography>
              </Grid>
            </Grid>
          </Box>

          {/* New Checkout Date Picker */}
          <TextField
            label={t('extendCheckout.newDate')}
            type="date"
            value={newCheckoutDate}
            onChange={(e) => setNewCheckoutDate(e.target.value)}
            fullWidth
            slotProps={{
              htmlInput: { min: minCheckoutDate },
              inputLabel: { shrink: true }
            }} />

          <Divider />

          {/* Price Preview */}
          <Box sx={{ bgcolor: 'primary.50', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>{t('extendCheckout.pricePreview')}</Typography>
            <Grid container spacing={1}>
              <Grid size={8}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('extendCheckout.ratePerNight')}</Typography>
              </Grid>
              <Grid sx={{ textAlign: 'right' }} size={4}>
                <Typography variant="body2">{formatCurrency(pricePerNight)}</Typography>
              </Grid>
              <Grid size={8}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {t('extendCheckout.currentRoomNights', { count: currentNights })}
                </Typography>
              </Grid>
              <Grid sx={{ textAlign: 'right' }} size={4}>
                <Typography variant="body2">{formatCurrency(currentRoomTotal)}</Typography>
              </Grid>
              <Grid size={8}>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>
                  {t('extendCheckout.newRoomNights', { count: previewNights })}
                </Typography>
              </Grid>
              <Grid sx={{ textAlign: 'right' }} size={4}>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{formatCurrency(newRoomTotal)}</Typography>
              </Grid>
              {isForeignTourist && (
                <>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('extendCheckout.currentTax', { rate: formatCurrency(tourismTaxRate) })}
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography variant="body2">{formatCurrency(currentTourismTax)}</Typography>
                  </Grid>
                  <Grid size={8}>
                    <Typography variant="body2" sx={{
                      fontWeight: 600
                    }}>
                      {t('extendCheckout.newTax', { rate: formatCurrency(tourismTaxRate) })}
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography variant="body2" sx={{
                      fontWeight: 600
                    }}>{formatCurrency(newTourismTax)}</Typography>
                  </Grid>
                </>
              )}
              {difference !== 0 && (
                <>
                  <Grid size={12}><Divider sx={{ my: 0.5 }} /></Grid>
                  <Grid size={8}>
                    <Typography
                      variant="body2"
                      color={isGreaterMoney(difference, 0) ? 'error.main' : 'success.main'}
	                      sx={{
                            fontWeight: 600
                          }}
	                    >
	                      {isGreaterMoney(difference, 0) ? t('extendCheckout.additionalCharge') : t('extendCheckout.reduction')}
                    </Typography>
                  </Grid>
                  <Grid sx={{ textAlign: 'right' }} size={4}>
                    <Typography
                      variant="body2"
                      color={isGreaterMoney(difference, 0) ? 'error.main' : 'success.main'}
	                      sx={{
                            fontWeight: 600
                          }}
	                    >
	                      {isGreaterMoney(difference, 0) ? '+' : '-'}{formatCurrency(Math.abs(difference))}
                    </Typography>
                  </Grid>
                </>
              )}
            </Grid>
          </Box>

          {newNights < 1 && (
            <Alert severity="error">
              {t('extendCheckout.minDateError')}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={loading}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || !isValid}
          startIcon={loading ? <CircularProgress size={20} /> : <CalendarIcon />}
        >
          {loading ? t('extendCheckout.extending') : t('extendCheckout.title')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default UpdateCheckoutDateDialog;
