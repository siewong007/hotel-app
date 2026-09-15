import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Payment as PaymentIcon } from '@mui/icons-material';
import type { BookingWithDetails } from '../../../../../types';
import { useRecordPaymentMutation } from '../../../hooks/useBookingQueries';
import { useCurrency } from '../../../../../hooks/useCurrency';
import { statusLabel, useTranslation } from '../../../../../i18n';
import { getPaymentStatusColor } from '../../../../../utils/bookingUtils';
import { formatHotelDate } from '../../../../../utils/date';
import { getHotelSettings } from '../../../../../utils/hotelSettings';
import {
  addMoney,
  isGreaterMoney,
  isLessMoney,
  isPositiveMoney,
  subtractMoney,
  toMoneyNumber,
} from '../../../../../utils/money';
import { getIdempotencyAttempt, type IdempotencyAttempt } from '../../../../../utils/idempotency';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import { getBookingBalance, getErrorMessage } from '../../../utils/bookingPageUtils';

export type PaymentDialogContext = 'manual' | 'checkout_required';

interface PaymentDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  context: PaymentDialogContext;
  onClose: () => void;
  onError: (message: string) => void;
  onCompleted: () => Promise<void> | void;
}

// Accept Payment Dialog — records a real payments row; the backend
// recompute then flips bookings.payment_status automatically.
const PaymentDialog: React.FC<PaymentDialogProps> = ({ open, booking, context, onClose, onError, onCompleted }) => {
  const { t } = useTranslation('bookings');
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const recordPaymentMutation = useRecordPaymentMutation();
  const paymentAttemptRef = useRef<IdempotencyAttempt | null>(null);
  const [currentBooking, setCurrentBooking] = useState<BookingWithDetails | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>('Cash');
  const [note, setNote] = useState<string>('');
  const [updating, setUpdating] = useState(false);

  const paymentMethods = getHotelSettings().payment_methods;

  useEffect(() => {
    if (!open || !booking) return;
    const balanceDue = toMoneyNumber(booking.balance_due);
    const totalAmount = toMoneyNumber(booking.total_amount);
    setCurrentBooking(booking);
    setAmount(context === 'checkout_required' ? balanceDue : (isPositiveMoney(balanceDue) ? balanceDue : totalAmount));
    setMethod(booking.payment_method || 'Cash');
    setNote(context === 'checkout_required' ? 'Required before checkout' : '');
  }, [open, booking, context]);

  const handleConfirm = async () => {
    if (!currentBooking) return;
    if (!Number.isFinite(amount) || !isPositiveMoney(amount)) {
      onError(t('payment.amountPositive'));
      return;
    }
    const requiredCheckoutBalance = getBookingBalance(currentBooking);
    if (context === 'checkout_required' && isLessMoney(amount, requiredCheckoutBalance)) {
      onError(t('payment.amountCoverBalance'));
      return;
    }
    // Block overpayment — a payment can never exceed the outstanding balance.
    if (isGreaterMoney(amount, requiredCheckoutBalance)) {
      onError(t('payment.amountExceedsError', { balance: formatCurrency(requiredCheckoutBalance) }));
      return;
    }

    const notes = note.trim() || `Payment accepted (${method})`;
    // Review finding I5. The synthetic checkout reference used to be derived from
    // the AMOUNT, which made it identical for two genuinely separate payments of
    // the same value. The backend checks the transaction reference BEFORE the
    // idempotency key, so a guest paying 50 twice had the second attempt replay
    // the first: one row recorded, two notes in the drawer.
    //
    // Derive it from the attempt instead. The attempt is retained across retries
    // of one submission and replaced once a payment succeeds, so the reference is
    // now stable exactly when the payment is the same and different exactly when
    // it is new. The reference is therefore a pure function of the attempt and is
    // deliberately excluded from the fingerprint below, which would otherwise be
    // circular.
    const attempt = getIdempotencyAttempt(paymentAttemptRef.current, JSON.stringify({
      booking_id: Number(currentBooking.id),
      amount: toMoneyNumber(amount).toFixed(2),
      payment_method: method,
      payment_type: 'booking',
      notes,
      payment_date: undefined,
    }));
    paymentAttemptRef.current = attempt;
    const transactionReference = context === 'checkout_required'
      ? `checkout-${currentBooking.id}-${attempt.key.slice(0, 8)}`
      : undefined;

    try {
      setUpdating(true);
      // Insert a real `payments` row (payment_type='booking'). The backend
      // recompute_payment_status helper will flip the chip automatically.
      await recordPaymentMutation.mutateAsync({
        booking_id: Number(currentBooking.id),
        amount,
        payment_method: method,
        payment_type: 'booking',
        transaction_reference: transactionReference,
        notes,
        idempotency_key: attempt.key,
      });

      // Work out what's still owed after this payment.
      const prevBalance = getBookingBalance(currentBooking);
      const prevPaid = toMoneyNumber(currentBooking.total_paid);
      const nextBalance = subtractMoney(prevBalance, amount);
      const remainingBalance = isPositiveMoney(nextBalance) ? nextBalance : 0;
      const fullySettled = !isPositiveMoney(remainingBalance);

      await onCompleted();

      // Review finding I2: the attempt is released only after every step that
      // can throw. Clearing it right after the POST meant a failing reload fell
      // into the catch below, reported "Failed to record payment" for a payment
      // that had in fact committed, and left the retry to mint a NEW key --
      // charging the guest twice. While it is retained, an identical retry
      // replays server-side instead. Everything below here is local state.
      paymentAttemptRef.current = null;

      // Checkout-required payments always cover the full balance, so they close.
      if (context === 'checkout_required' || fullySettled) {
        emitApiNotification({
          severity: 'success',
          message: context === 'checkout_required'
            ? t('payment.acceptedContinue', { amount: formatCurrency(amount), method })
            : t('payment.accepted', { amount: formatCurrency(amount), method }),
        });
        onClose();
      } else {
        // Balance still outstanding — keep the window open and re-arm the form
        // for the next payment.
        emitApiNotification({
          severity: 'success',
          message: t('payment.acceptedBalance', { amount: formatCurrency(amount), method }),
        });
        setCurrentBooking({
          ...currentBooking,
          total_paid: addMoney(prevPaid, amount),
          balance_due: remainingBalance,
          payment_status: 'partial',
        });
        setAmount(remainingBalance);
        setNote('');
      }
    } catch (err: unknown) {
      onError(getErrorMessage(err) || t('payment.failed'));
    } finally {
      setUpdating(false);
    }
  };

  const balance = getBookingBalance(currentBooking);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            overflow: 'hidden',
          },
        }
      }}
    >
      <DialogTitle sx={{ p: 0 }}>
        <Box sx={{ px: 3, py: 2.5, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: 'var(--hotel-primary-subtle)', color: 'var(--hotel-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <PaymentIcon />
          </Box>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.15 }}>
              {context === 'checkout_required' ? t('payment.titleRequired') : t('payment.titleAccept')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mt: 0.5
              }}>
              {context === 'checkout_required'
                ? t('payment.subtitleRequired')
                : t('payment.subtitleAccept')}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 3, py: 2.5 }}>
        {currentBooking && (
          <Stack spacing={2.25}>
            {context === 'checkout_required' && (
              <Alert severity="warning">
                {t('payment.checkoutBlocked')}
              </Alert>
            )}
            {/* This dialog has no date field, so the payments row is stamped
                with the server timestamp — i.e. the moment the status is
                flipped here. Back-dating is only possible from the checkout
                invoice screen, which does send an explicit payment_date.

                The instant (not `todayIso`) is what gets formatted: the server
                stamps the row in the hotel timezone, and formatHotelDate passes
                date-only strings through untouched, so feeding it a machine-local
                'YYYY-MM-DD' would name the viewer's day instead of the hotel's. */}
            <Alert severity="info">
              {t('payment.datedNotice', {
                date: formatHotelDate(new Date()),
                action: t('payment.recordPaymentAction'),
              })}
            </Alert>
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
              <Stack
                direction="row"
                spacing={2}
                sx={{
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="overline"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 900
                    }}>
                    {t('payment.booking')}
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, fontFamily: 'monospace', lineHeight: 1.25 }}>
                    {currentBooking.booking_number || currentBooking.folio_number || `#${currentBooking.id}`}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      mt: 0.5
                    }}>
                    {currentBooking.guest_name} · {t('details.roomNumber', { number: currentBooking.room_number })}
                  </Typography>
                </Box>
                <Chip
                  label={statusLabel(t, 'payment', currentBooking.payment_status)}
                  color={getPaymentStatusColor(currentBooking.payment_status)}
                  size="small"
                  sx={{ fontWeight: 800 }}
                />
              </Stack>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25 }}>
              {[
                { label: t('payment.total'), value: formatCurrency(toMoneyNumber(currentBooking.total_amount)), color: 'text.primary' },
                { label: t('payment.paid'), value: formatCurrency(toMoneyNumber(currentBooking.total_paid)), color: 'success.main' },
                { label: t('payment.balance'), value: formatCurrency(balance), color: isPositiveMoney(balance) ? 'error.main' : 'success.main' },
              ].map((item) => (
                <Box key={item.label} sx={{ p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 800
                    }}>
                    {item.label}
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, color: item.color }}>
                    {item.value}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                fullWidth
                type="number"
                label={t('payment.amountLabel')}
                value={amount || ''}
                onChange={(e) => setAmount(toMoneyNumber(e.target.value))}
                error={
                  (context === 'checkout_required' && isLessMoney(amount, balance)) ||
                  isGreaterMoney(amount, balance)
                }
                helperText={
                  isGreaterMoney(amount, balance)
                    ? t('payment.amountExceedsHelper', { balance: formatCurrency(balance) })
                    : context === 'checkout_required'
                      ? t('payment.fullBalanceRequired', { balance: formatCurrency(balance) })
                      : t('payment.outstandingBalance', { balance: formatCurrency(balance) })
                }
                required
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> },
                  htmlInput: { min: 0, max: balance, step: 0.01 }
                }} />
              <FormControl fullWidth>
                <InputLabel>{t('payment.methodLabel')}</InputLabel>
                <Select
                  value={method}
                  label={t('payment.methodLabel')}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {paymentMethods.map((m) => (
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <TextField
              fullWidth
              multiline
              rows={3}
              label={t('payment.noteLabel')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('payment.notePlaceholder')}
              helperText={t('payment.noteHelper')}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'background.paper' }}>
        <Button onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color="primary"
          disabled={
            !isPositiveMoney(amount) ||
            updating ||
            (context === 'checkout_required' && isLessMoney(amount, balance)) ||
            isGreaterMoney(amount, balance)
          }
        >
          {updating ? t('payment.processing') : t('payment.accept')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PaymentDialog;
