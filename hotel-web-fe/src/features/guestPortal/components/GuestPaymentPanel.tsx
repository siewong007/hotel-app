/**
 * Shared guest-facing payment panel — bank-transfer claim + PayPal.
 *
 * Used from three surfaces with two different auth shapes:
 *  - `mode: 'session'` — the authenticated guest-portal dashboard and the
 *    booking-confirmation flow, where the guest has a portal session bearer
 *    token (`token`) and a numeric `bookingId`.
 *  - `mode: 'token'` — the unauthenticated pre-arrival flow
 *    (`/guest-checkin/form?token=...`), where the booking token travels as a
 *    URL path segment on every request and there is no `bookingId`.
 *
 * The component fetches the public `/guest-portal/payment-config` once to
 * learn the hotel's bank details and whether PayPal is enabled (and its
 * public client id). It never receives or sends payment amounts to the
 * backend — the backend derives the charge from the booking itself; `amount`
 * here is display-only, and may be omitted if the caller doesn't have it.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { GuestPortalService } from '../../../api/guestPortal.service';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { formatCurrency, getCurrentCurrency } from '../../../utils/currency';
import type { GuestPaymentConfig, PaymentActionResponse } from '../../../types';

export interface GuestPaymentPanelProps {
  amount?: string | number | null;
  currency?: string;
  mode: 'session' | 'token';
  /** Required when `mode === 'session'`. */
  bookingId?: number;
  /** The portal session bearer token (`mode: 'session'`) or the pre-arrival
   *  booking token (`mode: 'token'`). Required in both modes. */
  token?: string;
  /** Whether to offer the manual bank-transfer claim alongside online checkout. */
  showBankTransfer?: boolean;
  onPaid?: () => void;
}

function formatAmount(amount: string | number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return '';
  const code = currency || getCurrentCurrency();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value);
  } catch {
    return formatCurrency(value, code);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function GuestPaymentPanel({
  amount,
  currency,
  mode,
  bookingId,
  token,
  showBankTransfer = true,
  onPaid,
}: GuestPaymentPanelProps) {
  const [config, setConfig] = useState<GuestPaymentConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [paypalError, setPaypalError] = useState<string | null>(null);
  const [pendingPaypalPaymentId, setPendingPaypalPaymentId] = useState<number | null>(null);
  const [result, setResult] = useState<PaymentActionResponse | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'paypal' | null>(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      setConfig(await GuestPortalService.paymentConfig());
    } catch (error) {
      setConfigError(errorMessage(error, 'Unable to load payment options right now.'));
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const submitBankTransfer = useCallback(async () => {
    if (bankSubmitting || result) return;
    if (mode === 'session' && (!bookingId || !token)) return;
    if (mode === 'token' && !token) return;
    setBankSubmitting(true);
    setBankError(null);
    try {
      const response =
        mode === 'session'
          ? await GuestPortalDashboardService.submitBankTransfer(bookingId!, token)
          : await GuestPortalService.submitBankTransfer(token!);
      setResult(response);
      onPaid?.();
    } catch (error) {
      setBankError(errorMessage(error, 'Unable to submit your bank transfer claim.'));
    } finally {
      setBankSubmitting(false);
    }
  }, [bankSubmitting, result, mode, bookingId, token, onPaid]);

  const createOrder = useCallback(async (): Promise<string> => {
    setPaypalError(null);
    const response =
      mode === 'session'
        ? await GuestPortalDashboardService.createPaypalOrder(bookingId!, token)
        : await GuestPortalService.createPaypalOrder(token!);
    setPendingPaypalPaymentId(response.payment_id);
    return response.order_id;
  }, [mode, bookingId, token]);

  const onApprove = useCallback(
    async (data: { orderID: string }): Promise<void> => {
      if (pendingPaypalPaymentId == null) {
        setPaypalError('Something went wrong starting the PayPal order. Please try again.');
        return;
      }
      try {
        const response =
          mode === 'session'
            ? await GuestPortalDashboardService.capturePaypalOrder(
                bookingId!,
                data.orderID,
                pendingPaypalPaymentId,
                token,
              )
            : await GuestPortalService.capturePaypalOrder(
                token!,
                data.orderID,
                pendingPaypalPaymentId,
              );
        setResult(response);
        onPaid?.();
      } catch (error) {
        setPaypalError(errorMessage(error, 'Unable to confirm your PayPal payment.'));
      }
    },
    [mode, bookingId, token, pendingPaypalPaymentId, onPaid],
  );

  const onPaypalError = useCallback(() => {
    setPaypalError('PayPal was unable to process this payment. Please try again.');
  }, []);

  const canPay = mode === 'session' ? Boolean(bookingId && token) : Boolean(token);
  const formattedAmount = formatAmount(amount, currency);

  if (configLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Loading payment options…
        </Typography>
      </Box>
    );
  }

  if (configError || !config) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => void loadConfig()}>
            Retry
          </Button>
        }
      >
        {configError || 'Unable to load payment options right now.'}
      </Alert>
    );
  }

  if (result) {
    const isConfirmed = result.status === 'completed';
    return (
      <Alert severity="success">
        {isConfirmed
          ? 'Payment received — your booking is confirmed.'
          : 'Payment received — pending confirmation by our team.'}
      </Alert>
    );
  }

  const { bank_details: bankDetails } = config;
  const hasBankDetails = Boolean(
    bankDetails.bank_name || bankDetails.account_name || bankDetails.account_number,
  );
  const paypalReady = Boolean(config.paypal_enabled && config.paypal_client_id && canPay);

  return (
    <Box>
      {formattedAmount ? (
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
          Amount due: {formattedAmount}
        </Typography>
      ) : null}

      <FormControl component="fieldset" fullWidth>
        <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
          Choose a payment method
        </Typography>
        <RadioGroup
          name="guest-payment-method"
          value={paymentMethod ?? ''}
          onChange={(event) => {
            setBankError(null);
            setPaypalError(null);
            setPaymentMethod(event.target.value as 'bank_transfer' | 'paypal');
          }}
        >
          {showBankTransfer ? (
            <FormControlLabel
              value="bank_transfer"
              control={<Radio />}
              label="Offline banking (bank transfer)"
            />
          ) : null}
          {paypalReady ? (
            <FormControlLabel
              value="paypal"
              control={<Radio />}
              label="PayPal or debit / credit card"
            />
          ) : null}
        </RadioGroup>
      </FormControl>

      {paymentMethod === 'bank_transfer' && showBankTransfer ? <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Bank transfer details
        </Typography>
        {hasBankDetails ? (
        <Stack spacing={0.5} sx={{ mb: 1.5 }}>
          {bankDetails.bank_name ? (
            <Typography variant="body2">
              <strong>Bank:</strong> {bankDetails.bank_name}
            </Typography>
          ) : null}
          {bankDetails.account_name ? (
            <Typography variant="body2">
              <strong>Account name:</strong> {bankDetails.account_name}
            </Typography>
          ) : null}
          {bankDetails.account_number ? (
            <Typography variant="body2">
              <strong>Account number:</strong> {bankDetails.account_number}
            </Typography>
          ) : null}
        </Stack>
      ) : (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Bank transfer details are not currently available. Please contact the hotel directly.
        </Alert>
      )}
      {bankError ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {bankError}
        </Alert>
      ) : null}
      {hasBankDetails ? (
        <Button
          variant="outlined"
          disabled={!canPay || bankSubmitting}
          onClick={() => void submitBankTransfer()}
        >
          {bankSubmitting ? <CircularProgress size={20} /> : "I've paid via bank transfer"}
        </Button>
      ) : null}
      </Box> : null}

      {paymentMethod === 'paypal' && paypalReady ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Pay with PayPal or card
          </Typography>
          {paypalError ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {paypalError}
            </Alert>
          ) : null}
          <PayPalScriptProvider
            options={{
              clientId: config.paypal_client_id as string,
              currency: currency || getCurrentCurrency() || 'USD',
              intent: 'capture',
            }}
          >
            <PayPalButtons
              style={{ layout: 'vertical' }}
              createOrder={createOrder}
              onApprove={onApprove}
              onError={onPaypalError}
            />
          </PayPalScriptProvider>
        </Box>
      ) : null}
    </Box>
  );
}

export default GuestPaymentPanel;
