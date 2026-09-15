import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Paper,
  Grid,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  Login as LoginIcon,
  Payment as PaymentIcon,
  MoneyOff as MoneyOffIcon,
  CardGiftcard as GiftIcon,
} from '@mui/icons-material';
import { BookingWithDetails } from '../../../../../types';
import { toMoneyNumber } from '../../../../../utils/money';
import { getBookingChannelInfo } from '../../../../bookings/utils/bookingChannel';
import { useTranslation } from '../../../../../i18n/useTranslation';
import { intlTag } from '../../../../../i18n/format';
import { parseLocalDate } from '../../../../../utils/date';

const formatStayDay = (value: string): string =>
  parseLocalDate(value).toLocaleDateString(intlTag(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

type PaymentChoice = 'pay_now' | 'pay_later';
type DepositChoice = 'receive' | 'waive';

interface ReservedCheckInDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  booking: BookingWithDetails | null;
  formatCurrency: (value: number) => string;
  currencySymbol: string;
  paymentMethods: readonly string[];
  paymentChoice: PaymentChoice;
  onPaymentChoiceChange: (value: PaymentChoice) => void;
  paymentMethod: string;
  onPaymentMethodChange: (value: string) => void;
  amountPaid: number;
  onAmountPaidChange: (value: number) => void;
  depositChoice: DepositChoice;
  onDepositChoiceChange: (value: DepositChoice) => void;
  depositMethod: string;
  onDepositMethodChange: (value: string) => void;
  depositAmount: number;
  onDepositAmountChange: (value: number) => void;
  waiveReason: string;
  onWaiveReasonChange: (value: string) => void;
  icNumber: string;
  onIcNumberChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  processing: boolean;
  onCheckIn: () => void;
}

const ReservedCheckInDialog: React.FC<ReservedCheckInDialogProps> = ({
  open,
  onClose,
  onCancel,
  booking,
  formatCurrency,
  currencySymbol,
  paymentMethods,
  paymentChoice,
  onPaymentChoiceChange,
  paymentMethod,
  onPaymentMethodChange,
  amountPaid,
  onAmountPaidChange,
  depositChoice,
  onDepositChoiceChange,
  depositMethod,
  onDepositMethodChange,
  depositAmount,
  onDepositAmountChange,
  waiveReason,
  onWaiveReasonChange,
  icNumber,
  onIcNumberChange,
  phone,
  onPhoneChange,
  processing,
  onCheckIn,
}) => {
  const { t } = useTranslation('rooms');
  const icMissing = !icNumber.trim();
  // Online reservations are settled on the booking platform (Traveloka,
  // Booking.com, …). The backend auto-records a payment for the outstanding
  // balance when `source === 'online'`, so we surface that here instead of the
  // generic "unpaid" messaging. Gate on the exact source the backend keys off
  // so the prompt never promises an auto-settlement that won't happen.
  const isOnlineReservation = (booking?.source || '').trim().toLowerCase() === 'online';
  const onlinePlatformName =
    (booking ? getBookingChannelInfo(booking)?.name : null) || t('bookings:checkIn.onlinePlatformFallback');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'var(--hotel-success-bg)', color: 'var(--hotel-success)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <LoginIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('bookings:checkIn.title', { room: booking?.room_number })}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Box>
            {/* Booking Summary */}
            <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'var(--hotel-surface-raised)', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{
                color: "text.secondary"
              }}>
                {t('bookings:checkIn.bookingNumber', { number: booking.booking_number })}
              </Typography>

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={12}>
                  <Typography variant="h6" sx={{
                    fontWeight: 600
                  }}>
                    {booking.guest_name}
                  </Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {booking.guest_email}
                    {booking.guest_phone && ` • ${booking.guest_phone}`}
                  </Typography>
                </Grid>

                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('bookings:checkIn.summary.checkIn')}</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {formatStayDay(booking.check_in_date)}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('bookings:checkIn.summary.checkOut')}</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {formatStayDay(booking.check_out_date)}
                  </Typography>
                </Grid>

                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('bookings:checkIn.summary.roomType')}</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {booking.room_type}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('bookings:checkIn.summary.totalAmount')}</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {formatCurrency(toMoneyNumber(booking.total_amount))}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* Guest Information — IC is collected at check-in (optional at
                booking creation); phone is optional. */}
            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>{t('bookings:checkIn.guestInformation')}</Typography>
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <Grid size={6}>
                <TextField
                  fullWidth
                  size="small"
                  required
                  label={t('bookings:checkIn.icPassport')}
                  value={icNumber}
                  onChange={(e) => onIcNumberChange(e.target.value)}
                  error={icMissing}
                  helperText={icMissing ? t('bookings:checkIn.icRequired') : ' '}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  fullWidth
                  size="small"
                  type="tel"
                  label={t('bookings:checkIn.phone')}
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  helperText={t('bookings:checkIn.phoneOptional')}
                />
              </Grid>
            </Grid>

            {/* Payment Section */}
            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>{t('bookings:checkIn.paymentSection')}</Typography>
            {isOnlineReservation && (
              <Alert severity="success" sx={{ mb: 1.5, py: 0 }}>
                {t('bookings:checkIn.settledOnlineNotice', {
                  platform: onlinePlatformName,
                  amount: formatCurrency(toMoneyNumber(booking.total_amount)),
                })}
              </Alert>
            )}
            <ToggleButtonGroup
              value={paymentChoice}
              exclusive
              onChange={(_, val) => { if (val) onPaymentChoiceChange(val); }}
              fullWidth
              size="small"
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="pay_now" color="success" sx={{ py: 1, fontWeight: 600 }}>
                <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} />
                {t('bookings:checkIn.makePaymentNow')}
              </ToggleButton>
              <ToggleButton value="pay_later" color="warning" sx={{ py: 1, fontWeight: 600 }}>
                <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} />
                {isOnlineReservation ? t('bookings:checkIn.settledOnline') : t('bookings:checkIn.payLater')}
              </ToggleButton>
            </ToggleButtonGroup>

            {paymentChoice === 'pay_now' && (
              <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                <Grid size={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('bookings:checkIn.paymentMethod')}</InputLabel>
                    <Select
                      value={paymentMethod}
                      onChange={(e) => onPaymentMethodChange(e.target.value)}
                      label={t('bookings:checkIn.paymentMethod')}
                    >
                      {paymentMethods.map(method => (
                        <MenuItem key={method} value={method}>{method}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label={t('bookings:checkIn.amountPaid')}
                    type="number"
                    value={amountPaid}
                    onChange={(e) => onAmountPaidChange(toMoneyNumber(e.target.value))}
                    slotProps={{
                      input: {
                        startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                        inputProps: { min: 0, step: 0.01 },
                      }
                    }}
                  />
                </Grid>
              </Grid>
            )}

            {paymentChoice === 'pay_later' && !isOnlineReservation && (
              <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>
                {t('bookings:checkIn.payLaterUnpaid')}
              </Alert>
            )}

            {/* Deposit Section */}
            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>{t('bookings:checkIn.depositSection')}</Typography>
            <ToggleButtonGroup
              value={depositChoice}
              exclusive
              onChange={(_, val) => { if (val) onDepositChoiceChange(val); }}
              fullWidth
              size="small"
              sx={{ mb: 1.5 }}
            >
              <ToggleButton value="receive" color="success" sx={{ py: 1, fontWeight: 600 }}>
                <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} />
                {t('bookings:checkIn.receiveDeposit')}
              </ToggleButton>
              <ToggleButton value="waive" color="error" sx={{ py: 1, fontWeight: 600 }}>
                <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} />
                {t('bookings:checkIn.waiveDeposit')}
              </ToggleButton>
            </ToggleButtonGroup>

            {depositChoice === 'receive' && (
              <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                <Grid size={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('bookings:checkIn.depositMethod')}</InputLabel>
                    <Select
                      value={depositMethod}
                      onChange={(e) => onDepositMethodChange(e.target.value)}
                      label={t('bookings:checkIn.depositMethod')}
                    >
                      {paymentMethods.map(method => (
                        <MenuItem key={method} value={method}>{method}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label={t('bookings:checkIn.depositAmount')}
                    type="number"
                    value={depositAmount}
                    onChange={(e) => onDepositAmountChange(toMoneyNumber(e.target.value))}
                    slotProps={{
                      input: {
                        startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                        inputProps: { min: 0, step: 0.01 },
                      }
                    }}
                  />
                </Grid>
              </Grid>
            )}

            {depositChoice === 'waive' && (
              <TextField
                fullWidth
                size="small"
                label={t('bookings:checkIn.waiveReasonLabel')}
                value={waiveReason}
                onChange={(e) => onWaiveReasonChange(e.target.value)}
                multiline
                rows={2}
                placeholder={t('bookings:checkIn.waiveReasonPlaceholder')}
                helperText={t('bookings:checkIn.waiveReasonHelper')}
                sx={{ mb: 1.5 }}
              />
            )}

            {/* Complimentary Badge if applicable */}
            {booking.is_complimentary && (
              <Alert severity="info" icon={<GiftIcon />} sx={{ mb: 2 }}>
                <strong>{t('complimentary.stayTitle')}</strong>
                {booking.complimentary_reason && (
                  <Typography variant="body2">
                    {t('bookings:comp.reason')}: {booking.complimentary_reason}
                  </Typography>
                )}
              </Alert>
            )}

            {/* Special Requests */}
            {booking.special_requests && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <strong>{t('fields.specialRequests')}:</strong> {booking.special_requests}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onCancel}
          disabled={processing}
        >
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={onCheckIn}
          disabled={processing || icMissing}
          startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}
        >
          {processing ? t('common:state.processing') : t('bookings:checkIn.checkInNow')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReservedCheckInDialog;
