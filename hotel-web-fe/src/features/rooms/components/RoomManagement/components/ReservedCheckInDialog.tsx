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
  const icMissing = !icNumber.trim();
  // Online reservations are settled on the booking platform (Traveloka,
  // Booking.com, …). The backend auto-records a payment for the outstanding
  // balance when `source === 'online'`, so we surface that here instead of the
  // generic "unpaid" messaging. Gate on the exact source the backend keys off
  // so the prompt never promises an auto-settlement that won't happen.
  const isOnlineReservation = (booking?.source || '').trim().toLowerCase() === 'online';
  const onlinePlatformName =
    (booking ? getBookingChannelInfo(booking)?.name : null) || 'the online platform';

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
            {/* Booking Summary */}
            <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Booking #{booking.booking_number}
              </Typography>

              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={12}>
                  <Typography variant="h6" fontWeight={600}>
                    {booking.guest_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {booking.guest_email}
                    {booking.guest_phone && ` • ${booking.guest_phone}`}
                  </Typography>
                </Grid>

                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Check-in</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {new Date(booking.check_in_date).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Check-out</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {new Date(booking.check_out_date).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </Typography>
                </Grid>

                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Room Type</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {booking.room_type}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="caption" color="text.secondary">Total Amount</Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {formatCurrency(toMoneyNumber(booking.total_amount))}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>

            {/* Guest Information — IC is collected at check-in (optional at
                booking creation); phone is optional. */}
            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Guest Information</Typography>
            <Grid container spacing={1.5} sx={{ mb: 2 }}>
              <Grid size={6}>
                <TextField
                  fullWidth
                  size="small"
                  required
                  label="IC / Passport Number"
                  value={icNumber}
                  onChange={(e) => onIcNumberChange(e.target.value)}
                  error={icMissing}
                  helperText={icMissing ? 'Required to complete check-in' : ' '}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  fullWidth
                  size="small"
                  label="Phone Number"
                  value={phone}
                  onChange={(e) => onPhoneChange(e.target.value)}
                  helperText="Optional"
                />
              </Grid>
            </Grid>

            {/* Payment Section */}
            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Payment</Typography>
            {isOnlineReservation && (
              <Alert severity="success" sx={{ mb: 1.5, py: 0 }}>
                Payment was settled on {onlinePlatformName}. The full amount
                {' '}({formatCurrency(toMoneyNumber(booking.total_amount))}) is recorded
                automatically on check-in — keep this on “Settled Online”. Switch to “Make Payment Now”
                only if you are collecting at the desk instead.
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
                Make Payment Now
              </ToggleButton>
              <ToggleButton value="pay_later" color="warning" sx={{ py: 1, fontWeight: 600 }}>
                <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} />
                {isOnlineReservation ? 'Settled Online' : 'Pay Later'}
              </ToggleButton>
            </ToggleButtonGroup>

            {paymentChoice === 'pay_now' && (
              <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                <Grid size={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Payment Method</InputLabel>
                    <Select
                      value={paymentMethod}
                      onChange={(e) => onPaymentMethodChange(e.target.value)}
                      label="Payment Method"
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
                    label="Amount Paid"
                    type="number"
                    value={amountPaid}
                    onChange={(e) => onAmountPaidChange(toMoneyNumber(e.target.value))}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                      inputProps: { min: 0, step: 0.01 },
                    }}
                  />
                </Grid>
              </Grid>
            )}

            {paymentChoice === 'pay_later' && !isOnlineReservation && (
              <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>
                Payment will be collected later. Guest checks in with unpaid status.
              </Alert>
            )}

            {/* Deposit Section */}
            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Deposit</Typography>
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
                Receive Deposit
              </ToggleButton>
              <ToggleButton value="waive" color="error" sx={{ py: 1, fontWeight: 600 }}>
                <MoneyOffIcon sx={{ mr: 0.5, fontSize: 18 }} />
                Waive Deposit
              </ToggleButton>
            </ToggleButtonGroup>

            {depositChoice === 'receive' && (
              <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                <Grid size={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Deposit Method</InputLabel>
                    <Select
                      value={depositMethod}
                      onChange={(e) => onDepositMethodChange(e.target.value)}
                      label="Deposit Method"
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
                    label="Deposit Amount"
                    type="number"
                    value={depositAmount}
                    onChange={(e) => onDepositAmountChange(toMoneyNumber(e.target.value))}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                      inputProps: { min: 0, step: 0.01 },
                    }}
                  />
                </Grid>
              </Grid>
            )}

            {depositChoice === 'waive' && (
              <TextField
                fullWidth
                size="small"
                label="Reason for Waiving Deposit"
                value={waiveReason}
                onChange={(e) => onWaiveReasonChange(e.target.value)}
                multiline
                rows={2}
                placeholder="e.g., Returning guest, Company account, Manager approval..."
                helperText="Optional: provide a reason for waiving the deposit"
                sx={{ mb: 1.5 }}
              />
            )}

            {/* Complimentary Badge if applicable */}
            {booking.is_complimentary && (
              <Alert severity="info" icon={<GiftIcon />} sx={{ mb: 2 }}>
                <strong>Complimentary Stay</strong>
                {booking.complimentary_reason && (
                  <Typography variant="body2">
                    Reason: {booking.complimentary_reason}
                  </Typography>
                )}
              </Alert>
            )}

            {/* Special Requests */}
            {booking.special_requests && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <strong>Special Requests:</strong> {booking.special_requests}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onCancel}
          disabled={processing}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={onCheckIn}
          disabled={processing || icMissing}
          startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />}
        >
          {processing ? 'Processing...' : 'Check-In Now'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReservedCheckInDialog;
