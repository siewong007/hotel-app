import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Payment as PaymentIcon,
  MoneyOff as MoneyOffIcon,
  Login as LoginIcon,
} from '@mui/icons-material';
import type { BookingUpdateRequest, BookingWithDetails, CheckInRequest } from '../../../../../types';
import { GuestsService } from '../../../../../api';
import { useCheckInGuestMutation } from '../../../hooks/useBookingQueries';
import { useCurrency } from '../../../../../hooks/useCurrency';
import { getHotelSettings } from '../../../../../utils/hotelSettings';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import { getBookingChannelInfo } from '../../../utils/bookingChannel';
import { getErrorMessage } from '../../../utils/bookingPageUtils';

interface CheckInDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

const CheckInDialog: React.FC<CheckInDialogProps> = ({ open, booking, onClose, onError, onCompleted }) => {
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const checkInGuestMutation = useCheckInGuestMutation();
  const paymentMethods = getHotelSettings().payment_methods;

  const [processing, setProcessing] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<'pay_now' | 'pay_later'>('pay_later');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [depositChoice, setDepositChoice] = useState<'receive' | 'waive'>('receive');
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositMethod, setDepositMethod] = useState('Cash');
  const [waiveReason, setWaiveReason] = useState('');
  // IC is collected at check-in (optional at booking creation); phone optional.
  const [icNumber, setIcNumber] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!open || !booking) return undefined;
    const totalAmt = toMoneyNumber(booking.total_amount);
    setPaymentChoice(booking.payment_status === 'paid' ? 'pay_now' : 'pay_later');
    setPaymentMethod(booking.payment_method || 'Cash');
    setAmountPaid(totalAmt);
    setDepositChoice('receive');
    setDepositAmount(getHotelSettings().deposit_amount);
    setDepositMethod('Cash');
    setWaiveReason('');
    setIcNumber('');
    setPhone(booking.guest_phone || '');

    // Back-fill IC / phone from the guest profile (booking summary omits IC).
    if (booking.guest_id !== undefined && booking.guest_id !== null) {
      let cancelled = false;
      GuestsService.getGuest(booking.guest_id)
        .then((guest) => {
          if (cancelled) return;
          setIcNumber((current) => (current.trim() ? current : guest.ic_number || ''));
          setPhone((current) => (current.trim() ? current : guest.phone || ''));
        })
        .catch(() => { /* leave for manual entry */ });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [open, booking]);

  // Online reservations are settled on the booking platform; the backend
  // auto-records a payment for the outstanding balance when `source === 'online'`,
  // so the check-in dialog surfaces that instead of the generic "unpaid" message.
  const isOnlineReservation = (booking?.source || '').trim().toLowerCase() === 'online';
  const onlinePlatformName =
    (booking ? getBookingChannelInfo(booking)?.name : null) || 'the online platform';

  const handleConfirm = async () => {
    if (!booking) return;
    if (!icNumber.trim()) {
      onError('IC / passport number is required to complete check-in.');
      return;
    }
    if (depositChoice === 'receive' && !isPositiveMoney(depositAmount)) {
      onError('Deposit amount must be greater than 0. To skip the deposit, choose "Waive" instead.');
      return;
    }
    try {
      setProcessing(true);
      // Single atomic request: deposit fields + payment + the status flip all go
      // through the check-in endpoint, which commits them in one transaction.
      // (Don't push payment_status — recording the payments row is what flips the
      // derived status; an override would be overwritten by the backend anyway.)
      const bookingUpdate: BookingUpdateRequest = {};
      if (paymentChoice === 'pay_now') {
        bookingUpdate.payment_method = paymentMethod;
      }
      if (depositChoice === 'receive') {
        bookingUpdate.deposit_paid = true;
        bookingUpdate.deposit_amount = toMoneyNumber(depositAmount);
        bookingUpdate.payment_note = `Deposit received (${depositMethod})`;
      } else {
        bookingUpdate.deposit_paid = false;
        bookingUpdate.deposit_amount = 0;
        bookingUpdate.payment_note = `Deposit waived: ${waiveReason}`;
      }
      const checkinPayload: CheckInRequest = {
        booking_update: bookingUpdate,
        guest_update: {
          ic_number: icNumber.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        },
      };
      if (paymentChoice === 'pay_now' && isPositiveMoney(amountPaid)) {
        checkinPayload.payment_record = {
          amount: toMoneyNumber(amountPaid),
          payment_method: paymentMethod,
          payment_type: 'booking',
          notes: 'Payment collected at check-in',
        };
      }
      await checkInGuestMutation.mutateAsync({ bookingId: booking.id, data: checkinPayload });
      onClose();
      emitApiNotification({ severity: 'success', message: 'Guest checked in successfully!' });
      await onCompleted();
    } catch (err: unknown) {
      onError(getErrorMessage(err) || 'Failed to check in guest');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!processing) onClose(); }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'success.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <LoginIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Check-In - Room {booking?.room_number}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Box>
            <Box sx={{ p: 2, mb: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" gutterBottom sx={{
                color: "text.secondary"
              }}>
                Booking #{booking.booking_number}
              </Typography>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={12}>
                  <Typography variant="h6" sx={{
                    fontWeight: 600
                  }}>{booking.guest_name}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Check-in</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {new Date(booking.check_in_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Check-out</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>
                    {new Date(booking.check_out_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Room Type</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>{booking.room_type}</Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>Total Amount</Typography>
                  <Typography variant="body2" sx={{
                    fontWeight: 500
                  }}>{formatCurrency(toMoneyNumber(booking.total_amount))}</Typography>
                </Grid>
              </Grid>
            </Box>

            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Guest Information</Typography>
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <Grid size={6}>
                <TextField fullWidth size="small" required label="IC / Passport Number" value={icNumber}
                  onChange={(e) => setIcNumber(e.target.value)}
                  error={!icNumber.trim()}
                  helperText={!icNumber.trim() ? 'Required to complete check-in' : ' '} />
              </Grid>
              <Grid size={6}>
                <TextField fullWidth size="small" label="Phone Number" value={phone}
                  onChange={(e) => setPhone(e.target.value)} helperText="Optional" />
              </Grid>
            </Grid>

            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Payment</Typography>
            {isOnlineReservation && (
              <Alert severity="success" sx={{ mb: 1.5, py: 0 }}>
                Payment was settled on {onlinePlatformName}. The full amount
                {' '}({formatCurrency(toMoneyNumber(booking.total_amount))}) is recorded
                automatically on check-in — keep this on “Settled Online”. Switch to “Make Payment Now”
                only if you are collecting at the desk instead.
              </Alert>
            )}
            <ToggleButtonGroup value={paymentChoice} exclusive onChange={(_, val) => { if (val) setPaymentChoice(val); }} fullWidth size="small" sx={{ mb: 1.5 }}>
              <ToggleButton value="pay_now" color="success" sx={{ py: 1, fontWeight: 600 }}>
                <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} /> Make Payment Now
              </ToggleButton>
              <ToggleButton value="pay_later" color="warning" sx={{ py: 1, fontWeight: 600 }}>
                <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} /> {isOnlineReservation ? 'Settled Online' : 'Pay Later'}
              </ToggleButton>
            </ToggleButtonGroup>
            {paymentChoice === 'pay_now' && (
              <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                <Grid size={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Payment Method</InputLabel>
                    <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} label="Payment Method">
                      {paymentMethods.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={6}>
                  <TextField fullWidth size="small" label="Amount Paid" type="number" value={amountPaid} onChange={(e) => setAmountPaid(toMoneyNumber(e.target.value))}
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>, inputProps: { min: 0, step: 0.01 } }
                    }} />
                </Grid>
              </Grid>
            )}
            {paymentChoice === 'pay_later' && !isOnlineReservation && (
              <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>Payment will be collected later.</Alert>
            )}

            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Deposit</Typography>
            <ToggleButtonGroup value={depositChoice} exclusive onChange={(_, val) => { if (val) setDepositChoice(val); }} fullWidth size="small" sx={{ mb: 1.5 }}>
              <ToggleButton value="receive" color="success" sx={{ py: 1, fontWeight: 600 }}>
                <PaymentIcon sx={{ mr: 0.5, fontSize: 18 }} /> Receive Deposit
              </ToggleButton>
              <ToggleButton value="waive" color="error" sx={{ py: 1, fontWeight: 600 }}>
                <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} /> Waive Deposit
              </ToggleButton>
            </ToggleButtonGroup>
            {depositChoice === 'receive' && (
              <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                <Grid size={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Deposit Method</InputLabel>
                    <Select value={depositMethod} onChange={(e) => setDepositMethod(e.target.value)} label="Deposit Method">
                      {paymentMethods.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={6}>
                  <TextField fullWidth size="small" label="Deposit Amount" type="number" value={depositAmount} onChange={(e) => setDepositAmount(toMoneyNumber(e.target.value))}
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>, inputProps: { min: 0, step: 0.01 } }
                    }} />
                </Grid>
              </Grid>
            )}
            {depositChoice === 'waive' && (
              <TextField fullWidth size="small" label="Reason for Waiving Deposit" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)}
                multiline rows={2} placeholder="e.g., Returning guest, Company account..." helperText="Optional: provide a reason for waiving the deposit" sx={{ mb: 1.5 }} />
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} disabled={processing}>Cancel</Button>
        <Button variant="contained" color="success" onClick={handleConfirm} disabled={processing || !icNumber.trim()}
          startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}>
          {processing ? 'Processing...' : 'Check-In Now'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CheckInDialog;
