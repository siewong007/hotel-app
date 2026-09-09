import { useState } from 'react';
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
import { PaymentRecoveryApi } from './api';
import { useTranslation } from '../../i18n';
import { formatHotelDateTime } from '../../utils/date';

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
  const done = view.already_submitted || submit.isSuccess;

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
            <Alert severity="success">
              {view.already_submitted && !submit.isSuccess
                ? t('recoverPayment.alreadySubmitted')
                : t('recoverPayment.submittedBody')}
            </Alert>
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
