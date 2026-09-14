/**
 * Shared guest-facing payment panel — bank-transfer claim + PayPal.
 *
 * Used from three surfaces with two different auth shapes:
 *  - `mode: 'session'` — the authenticated guest-portal dashboard and the
 *    booking-confirmation flow, where the guest has a portal session bearer
 *    token (`token`) and a numeric `bookingId`.
 *  - `mode: 'token'` — the unauthenticated pre-arrival flow
 *    (`/guest-checkin/form`), where the booking token is sent as
 *    `X-Booking-Access-Token` and there is no `bookingId`.
 *
 * The component fetches the public `/guest-portal/payment-config` once to
 * learn the hotel's bank details and whether PayPal is enabled (and its
 * public client id). It never receives or sends payment amounts to the
 * backend — the backend derives the charge from the booking itself; `amount`
 * here is display-only, and may be omitted if the caller doesn't have it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  PayPalScriptProvider,
  PayPalButtons,
  usePayPalScriptReducer,
  type PayPalButtonsComponentProps,
} from '@paypal/react-paypal-js';
import { GuestPortalService } from '../../../api/guestPortal.service';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { guestErrorMessage } from '../utils/feedback';
import { useTranslation } from '../../../i18n';
import { formatCurrency, getCurrentCurrency } from '../../../utils/currency';
import type { GuestPaymentConfig, PaymentActionResponse } from '../../../types';
import { ConsentBlock } from '../../legal/components/ConsentBlock';
import { PAYMENT_CONSENTS, PAYMENT_KEY_POINTS } from '../../legal/content';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import { useConsent } from '../../legal/useConsent';

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
  /** Keeps payment choices independent when multiple panels appear on one page. */
  paymentMethodName?: string;
  /** Called with the server-confirmed outcome after a payment action succeeds. */
  onPaid?: (result: PaymentActionResponse) => void;
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

function PayPalButtonContent(
  props: Pick<PayPalButtonsComponentProps, 'createOrder' | 'onApprove' | 'onError' | 'onCancel'>,
) {
  const { t } = useTranslation('guestPortal');
  const [{ isRejected }] = usePayPalScriptReducer();

  if (isRejected) {
    return (
      <Alert severity="error" role="alert">
        {t('recoverPayment.paypalUnavailable')}
      </Alert>
    );
  }

  return <PayPalButtons style={{ layout: 'vertical' }} {...props} />;
}

export function GuestPaymentPanel({
  amount,
  currency,
  mode,
  bookingId,
  token,
  showBankTransfer = true,
  paymentMethodName = 'guest-payment-method',
  onPaid,
}: GuestPaymentPanelProps) {
  const { t } = useTranslation('guestPortal');
  const [config, setConfig] = useState<GuestPaymentConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paypalError, setPaypalError] = useState<string | null>(null);
  const [pendingPaypalPaymentId, setPendingPaypalPaymentId] = useState<number | null>(null);
  const [result, setResult] = useState<PaymentActionResponse | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'paypal' | null>(null);
  const consent = useConsent(PAYMENT_CONSENTS);
  const { locale: legalLocale } = useLegalLocale();
  // React state updates are asynchronous, so it cannot by itself prevent two
  // clicks in the same render from creating two payment claims.
  const paymentAttemptInFlight = useRef(false);

  const loadConfig = useCallback(async () => {
    if (!token) {
      setConfigError(t('payment.configLoadFailed'));
      setConfigLoading(false);
      return;
    }
    setConfigLoading(true);
    setConfigError(null);
    try {
      setConfig(
        mode === 'session'
          ? await GuestPortalDashboardService.paymentConfig(token)
          : await GuestPortalService.paymentConfig(token),
      );
    } catch (error) {
      setConfigError(guestErrorMessage(error, t('payment.configLoadFailed')));
    } finally {
      setConfigLoading(false);
    }
  }, [mode, t, token]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const submitBankTransfer = useCallback(async () => {
    if (paymentAttemptInFlight.current || bankSubmitting || result) return;
    if (mode === 'session' && (!bookingId || !token)) return;
    if (mode === 'token' && !token) return;
    paymentAttemptInFlight.current = true;
    setBankSubmitting(true);
    setBankError(null);
    try {
      const consents = consent.buildPayload(legalLocale).consents;
      const response =
        mode === 'session'
          ? await GuestPortalDashboardService.submitBankTransfer(bookingId!, consents, token)
          : await GuestPortalService.submitBankTransfer(token!, consents);
      if (receiptFile) {
        if (mode === 'session') {
          await GuestPortalDashboardService.uploadPaymentReceipt(response.payment_id, receiptFile, token);
        } else {
          await GuestPortalService.uploadPaymentReceipt(token!, response.payment_id, receiptFile);
        }
      }
      setResult(response);
      onPaid?.(response);
    } catch (error) {
      setBankError(guestErrorMessage(error, t('payment.bankSubmitFailed')));
    } finally {
      paymentAttemptInFlight.current = false;
      setBankSubmitting(false);
    }
  }, [bankSubmitting, result, mode, bookingId, token, onPaid, receiptFile, consent, legalLocale, t]);

  const createOrder = useCallback(async (): Promise<string> => {
    if (paymentAttemptInFlight.current) {
      throw new Error(t('payment.inFlight'));
    }
    paymentAttemptInFlight.current = true;
    setPaypalError(null);
    try {
      const consents = consent.buildPayload(legalLocale).consents;
      const response =
        mode === 'session'
          ? await GuestPortalDashboardService.createPaypalOrder(bookingId!, consents, token)
          : await GuestPortalService.createPaypalOrder(token!, consents);
      setPendingPaypalPaymentId(response.payment_id);
      return response.order_id;
    } catch (error) {
      setPaypalError(guestErrorMessage(error, t('payment.paypalStartFailed')));
      paymentAttemptInFlight.current = false;
      throw error;
    }
  }, [mode, bookingId, token, consent, legalLocale, t]);

  const onApprove = useCallback(
    async (data: { orderID: string }): Promise<void> => {
      if (pendingPaypalPaymentId == null) {
        setPaypalError(t('payment.paypalOrderMissing'));
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
        onPaid?.(response);
      } catch (error) {
        setPaypalError(guestErrorMessage(error, t('payment.paypalCaptureFailed')));
      } finally {
        paymentAttemptInFlight.current = false;
      }
    },
    [mode, bookingId, token, pendingPaypalPaymentId, onPaid, t],
  );

  const onPaypalError = useCallback(() => {
    paymentAttemptInFlight.current = false;
    setPaypalError(t('payment.paypalProcessFailed'));
  }, [t]);

  const onPaypalCancel = useCallback(() => {
    paymentAttemptInFlight.current = false;
  }, []);

  const canPay = mode === 'session' ? Boolean(bookingId && token) : Boolean(token);
  const formattedAmount = formatAmount(amount, currency);

  if (configLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" sx={{
          color: "text.secondary"
        }}>
          {t('payment.loading')}
        </Typography>
      </Box>
    );
  }

  if (configError || !config) {
    return (
      <Alert
        severity="error"
        role="alert"
        action={
          <Button color="inherit" size="small" onClick={() => void loadConfig()}>
            {t('common:actions.retry')}
          </Button>
        }
      >
        {configError || t('payment.configLoadFailed')}
      </Alert>
    );
  }

  if (result) {
    const isConfirmed = result.status === 'completed';
    return (
      <Alert severity="success" role="alert">
        {isConfirmed
          ? t('payment.successConfirmed')
          : t('payment.successPending')}
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
          {t('payment.amountDue', { amount: formattedAmount })}
        </Typography>
      ) : null}
      <FormControl component="fieldset" fullWidth>
        <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
          {t('payment.chooseMethod')}
        </Typography>
        <RadioGroup
          name={paymentMethodName}
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
              label={t('payment.bankTransferLabel')}
            />
          ) : null}
          {paypalReady ? (
            <FormControlLabel
              value="paypal"
              control={<Radio />}
              label={t('payment.paypalLabel')}
            />
          ) : null}
        </RadioGroup>
      </FormControl>

      {/* The guest is authorising a specific amount here, so the terms that
          govern it — how each method settles, when the booking is confirmed,
          and how refunds work — are shown at the point of payment rather than
          left behind a link they have already passed. */}
      {paymentMethod ? (
        <ConsentBlock
          prompts={PAYMENT_CONSENTS}
          state={consent}
          keyPoints={PAYMENT_KEY_POINTS}
          title={{ en: 'Before you pay', ms: 'Sebelum anda membayar' }}
        />
      ) : null}

      {paymentMethod === 'bank_transfer' && showBankTransfer ? <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('payment.bankDetailsHeading')}
        </Typography>
        {hasBankDetails ? (
        <Stack spacing={0.5} sx={{ mb: 1.5 }}>
          {bankDetails.bank_name ? (
            <Typography variant="body2">
              <strong>{t('payment.bankFieldBank')}</strong> {bankDetails.bank_name}
            </Typography>
          ) : null}
          {bankDetails.account_name ? (
            <Typography variant="body2">
              <strong>{t('payment.bankFieldAccountName')}</strong> {bankDetails.account_name}
            </Typography>
          ) : null}
          {bankDetails.account_number ? (
            <Typography variant="body2">
              <strong>{t('payment.bankFieldAccountNumber')}</strong> {bankDetails.account_number}
            </Typography>
          ) : null}
        </Stack>
      ) : (
        <Alert severity="info" role="alert" sx={{ mb: 1.5 }}>
          {t('payment.bankDetailsUnavailable')}
        </Alert>
      )}
      {bankError ? (
        <Alert severity="error" role="alert" sx={{ mb: 1.5 }}>
          {bankError}
        </Alert>
      ) : null}
      {hasBankDetails ? (
        <Stack spacing={1.25} sx={{
          alignItems: "flex-start"
        }}>
          <Button component="label" size="small" startIcon={<UploadFileOutlinedIcon />}>
            {receiptFile ? t('payment.receiptSelected', { name: receiptFile.name }) : t('payment.attachReceipt')}
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {t('payment.receiptHint')}
          </Typography>
          <Button
            variant="outlined"
            disabled={!canPay || bankSubmitting || !consent.allRequiredGranted}
            onClick={() => void submitBankTransfer()}
          >
            {bankSubmitting ? <CircularProgress size={20} /> : t('payment.paidViaBank')}
          </Button>
        </Stack>
      ) : null}
      </Box> : null}
      {paymentMethod === 'paypal' && paypalReady ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('recoverPayment.paypal')}
          </Typography>
          {paypalError ? (
            <Alert severity="error" role="alert" sx={{ mb: 1.5 }}>
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
            {consent.allRequiredGranted ? (
              <PayPalButtonContent
                createOrder={createOrder}
                onApprove={onApprove}
                onError={onPaypalError}
                onCancel={onPaypalCancel}
              />
            ) : (
              <Alert severity="info" role="alert">
                {t('payment.acceptTermsFirst')}
              </Alert>
            )}
          </PayPalScriptProvider>
        </Box>
      ) : null}
    </Box>
  );
}

export default GuestPaymentPanel;
