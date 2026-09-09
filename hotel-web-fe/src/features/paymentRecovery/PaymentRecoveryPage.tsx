import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  PayPalButtons,
  PayPalScriptProvider,
  usePayPalScriptReducer,
} from '@paypal/react-paypal-js';
import { PaymentRecoveryApi } from './api';
import { useTranslation } from '../../i18n';
import { formatHotelDateTime } from '../../utils/date';

/** Shows a clear reason when PayPal's own script cannot load. */
function PayPalButtonContent(props: {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onError: () => void;
  unavailable: string;
}) {
  const [{ isRejected }] = usePayPalScriptReducer();
  const { unavailable, ...buttonProps } = props;
  if (isRejected) {
    return <Alert severity="error">{unavailable}</Alert>;
  }
  return <PayPalButtons style={{ layout: 'vertical' }} {...buttonProps} />;
}

/**
 * Public payment-recovery page, reached from the link in a payment-rejected
 * email and authenticated solely by the capability in the URL.
 *
 * Loading the page is read-only by design — the server does not spend the
 * capability on a view — so a mail scanner that pre-fetches the link cannot
 * burn the guest's one attempt before they open it.
 *
 * Every unusable link (expired, unknown, already spent, reservation moved on)
 * shows the same message and points at the hotel. Distinguishing them here
 * would turn the page into an oracle for which tokens once existed.
 */
export default function PaymentRecoveryPage({ token }: { token: string }) {
  const { t } = useTranslation('guestPortal');
  const [failed, setFailed] = useState(false);
  const [paypalFailed, setPaypalFailed] = useState(false);
  const [paypalDone, setPaypalDone] = useState(false);
  // The payment id the authorised order belongs to. Capture is refused for any
  // other payment, so this must come from the create-order response.
  const pendingPaypalPaymentId = useRef<number | null>(null);

  const recovery = useQuery({
    queryKey: ['payment-recovery', token],
    queryFn: () => PaymentRecoveryApi.view(token),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () => PaymentRecoveryApi.bankTransfer(token),
    onMutate: () => setFailed(false),
    onError: () => setFailed(true),
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      PaymentRecoveryApi.uploadReceipt(token, receiptPaymentId as number, file),
  });

  const createOrder = useCallback(async () => {
    setPaypalFailed(false);
    try {
      const order = await PaymentRecoveryApi.paypalCreateOrder(token);
      pendingPaypalPaymentId.current = order.payment_id;
      return order.order_id;
    } catch (error) {
      setPaypalFailed(true);
      throw error;
    }
  }, [token]);

  const onApprove = useCallback(
    async (data: { orderID: string }) => {
      const paymentId = pendingPaypalPaymentId.current;
      if (paymentId == null) {
        setPaypalFailed(true);
        return;
      }
      try {
        await PaymentRecoveryApi.paypalCapture(token, data.orderID, paymentId);
        setPaypalDone(true);
      } catch {
        setPaypalFailed(true);
      }
    },
    [token],
  );

  if (recovery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress aria-label={t('recoverPayment.loading')} />
      </Box>
    );
  }

  if (recovery.isError || !recovery.data) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8, px: 2 }}>
        <Alert severity="error">
          <Typography variant="subtitle2" gutterBottom>
            {t('recoverPayment.unavailableTitle')}
          </Typography>
          {t('recoverPayment.unavailableBody')}
        </Alert>
      </Box>
    );
  }

  const view = recovery.data;
  const amount = `${view.currency} ${view.amount_due}`;
  // Spent links and freshly submitted ones read the same to the guest: the
  // claim is with the hotel and there is nothing more to do.
  const done = view.already_submitted || submit.isSuccess || paypalDone;
  const paypalReady =
    view.payment_methods.includes('paypal') && Boolean(view.paypal_client_id);
  // Either the claim raised just now, or the one this link raised earlier --
  // a guest who leaves to find the file and comes back must still be able to
  // send it.
  const receiptPaymentId = submit.data?.payment_id ?? view.payment_id;
  // Whether evidence is still wanted is the server's call: on a fresh load it
  // says so directly, and immediately after a claim we know it was one. The
  // page never infers it, or a reload after a PayPal capture would offer an
  // upload the server then refuses.
  const canUploadReceipt =
    done && receiptPaymentId != null && (submit.isSuccess || view.receipt_uploadable);

  return (
    <Box sx={{ maxWidth: 520, mx: 'auto', mt: 6, px: 2 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            {done ? t('recoverPayment.submitted') : t('recoverPayment.title')}
          </Typography>

          {!done && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {t('recoverPayment.subtitle')}
            </Typography>
          )}

          <Stack spacing={1} sx={{ my: 2 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('recoverPayment.reference')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {view.booking_number}
              </Typography>
            </Stack>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('recoverPayment.amountDue')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {amount}
              </Typography>
            </Stack>
            {!done && (
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('recoverPayment.expires')}
                </Typography>
                <Typography variant="body2">
                  {formatHotelDateTime(view.expires_at)}
                </Typography>
              </Stack>
            )}
          </Stack>

          <Divider sx={{ my: 2 }} />

          {done ? (
            <>
              <Alert severity="success">
                {view.already_submitted && !submit.isSuccess
                  ? t('recoverPayment.alreadySubmitted')
                  : t('recoverPayment.submittedBody')}
              </Alert>
              {canUploadReceipt && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('recoverPayment.uploadHeading')}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: 'text.secondary', mb: 1.5 }}
                  >
                    {t('recoverPayment.uploadHint')}
                  </Typography>
                  {upload.isError && (
                    <Alert severity="error" sx={{ mb: 1.5 }}>
                      {t('recoverPayment.uploadFailed')}
                    </Alert>
                  )}
                  {upload.isSuccess ? (
                    <Alert severity="success">{t('recoverPayment.uploaded')}</Alert>
                  ) : (
                    <Button
                      component="label"
                      variant="outlined"
                      fullWidth
                      disabled={upload.isPending}
                    >
                      {upload.isPending
                        ? t('recoverPayment.uploading')
                        : t('recoverPayment.uploadChoose')}
                      <input
                        type="file"
                        hidden
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) upload.mutate(file);
                        }}
                      />
                    </Button>
                  )}
                </Box>
              )}
            </>
          ) : (
            <>
              {failed && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {t('recoverPayment.failed')}
                </Alert>
              )}
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                {t('recoverPayment.singleUse')}
              </Typography>
              {paypalReady && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('recoverPayment.paypal')}
                  </Typography>
                  {paypalFailed && (
                    <Alert severity="error" sx={{ mb: 1.5 }}>
                      {t('recoverPayment.paypalFailed')}
                    </Alert>
                  )}
                  <PayPalScriptProvider
                    options={{
                      clientId: view.paypal_client_id as string,
                      currency: view.currency,
                      intent: 'capture',
                    }}
                  >
                    <PayPalButtonContent
                      createOrder={createOrder}
                      onApprove={onApprove}
                      onError={() => setPaypalFailed(true)}
                      unavailable={t('recoverPayment.paypalUnavailable')}
                    />
                  </PayPalScriptProvider>
                  {view.payment_methods.includes('bank_transfer') && (
                    <Divider sx={{ my: 2 }}>{t('recoverPayment.or')}</Divider>
                  )}
                </Box>
              )}
              {view.payment_methods.includes('bank_transfer') && (
                <>
                  <Button
                    variant="contained"
                    fullWidth
                    disabled={submit.isPending}
                    onClick={() => submit.mutate()}
                  >
                    {submit.isPending
                      ? t('recoverPayment.submitting')
                      : t('recoverPayment.bankTransfer')}
                  </Button>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', display: 'block', mt: 1 }}
                  >
                    {t('recoverPayment.bankTransferHint')}
                  </Typography>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
