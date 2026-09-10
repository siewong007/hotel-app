/**
 * Online pre-check-in wizard.
 *
 * Reached from the emailed booking link (`?token=` captured into
 * sessionStorage) or from the booking-number lookup at `/guest-checkin`.
 * Everything here runs on the booking access token — no account required —
 * until the guest chooses to create one, which is what unlocks the identity
 * step and, with it, checking in without queueing at the desk.
 *
 * Steps are addressed by id rather than index: the account step disappears once
 * a portal session exists, and an index-based stepper would silently shift the
 * guest onto the wrong panel at that moment.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from '../../../router';
import {
  Container,
  Paper,
  Typography,
  Button,
  Box,
  Alert,
  CircularProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
} from '@mui/material';
import { GuestPortalService } from '../../../api';
import {
  Booking,
  Guest,
  GuestEkycStatusSummary,
  GuestPortalAutoCheckinResponse,
} from '../../../types';
import { GuestPaymentPanel } from '../../guestPortal/components/GuestPaymentPanel';
import { IdentitySection } from '../../guestPortal/components/dashboard/IdentitySection';
import { errorMessage } from '../../../utils/errorMessage';
import { captureBookingAccessToken } from '../../guestPortal/api/bookingAccessTokenStore';
import { getValidPortalToken } from '../../guestPortal/api/portalTokenStore';
import { ClaimAccountStep } from './guestCheckIn/ClaimAccountStep';
import { PreCheckInDetailsStep } from './guestCheckIn/PreCheckInDetailsStep';

function needsOnlinePayment(status: string | undefined): boolean {
  return status === 'pending' || status === 'pending_payment';
}

type StepId = 'payment' | 'details' | 'account' | 'identity' | 'done';

export const GuestCheckInForm: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = captureBookingAccessToken(searchParams);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [ekycSummary, setEkycSummary] = useState<GuestEkycStatusSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiptRequestPaymentId, setReceiptRequestPaymentId] = useState<number | null>(null);
  const [receiptRequestMessage, setReceiptRequestMessage] = useState<string | null>(null);
  const [receiptAlreadyUploaded, setReceiptAlreadyUploaded] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptUploadError, setReceiptUploadError] = useState<string | null>(null);
  const [receiptSubmitted, setReceiptSubmitted] = useState(false);

  const [portalToken, setPortalTokenState] = useState<string | null>(() => getValidPortalToken());
  const [activeStep, setActiveStep] = useState<StepId | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [checkinResult, setCheckinResult] = useState<GuestPortalAutoCheckinResponse | null>(null);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const loadBookingData = useCallback(
    async (options?: { keepStep?: boolean }) => {
      try {
        const response = await GuestPortalService.getBooking(token!);
        setBooking(response.booking);
        setGuest(response.guest);
        setEkycSummary(response.ekyc_summary ?? null);
        setReceiptRequestPaymentId(response.receipt_request_payment_id ?? null);
        setReceiptRequestMessage(response.receipt_request_message ?? null);
        setReceiptAlreadyUploaded(Boolean(response.receipt_uploaded));

        if (!options?.keepStep) {
          // Start where the guest actually has something to do: money first
          // when it is outstanding, otherwise straight into their details.
          const paymentOutstanding =
            needsOnlinePayment(response.booking?.status) ||
            (Boolean(response.receipt_request_payment_id) && !response.receipt_uploaded);
          setActiveStep(paymentOutstanding ? 'payment' : 'details');
        }
      } catch (err) {
        setError(errorMessage(err, 'Failed to load booking'));
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (searchParams.has('token')) {
      const next = new URLSearchParams(searchParams);
      next.delete('token');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing token');
      setLoading(false);
      return;
    }

    void loadBookingData();
  }, [token, loadBookingData]);

  const needsReceipt =
    Boolean(receiptRequestPaymentId) && !receiptAlreadyUploaded && !receiptSubmitted;
  const showPayment =
    Boolean(token && needsOnlinePayment(booking?.status)) &&
    !needsReceipt &&
    !receiptSubmitted &&
    !receiptAlreadyUploaded;
  const paymentStepRelevant = showPayment || needsReceipt || receiptSubmitted;

  const steps = useMemo(() => {
    const list: { id: StepId; label: string }[] = [];
    if (paymentStepRelevant) list.push({ id: 'payment', label: 'Payment' });
    list.push({ id: 'details', label: 'Your details' });
    if (!portalToken) list.push({ id: 'account', label: 'Your account' });
    list.push({ id: 'identity', label: 'Identity check' });
    list.push({ id: 'done', label: 'Done' });
    return list;
  }, [paymentStepRelevant, portalToken]);

  const stepIndex = steps.findIndex((step) => step.id === activeStep);

  /**
   * Move to a step. Arriving at the summary re-reads the booking, because
   * eligibility was last read on page load — before the guest had filed the
   * eKYC the verdict now depends on.
   */
  const goToStep = useCallback(
    (id: StepId) => {
      setActiveStep(id);
      if (id === 'done') void loadBookingData({ keepStep: true });
    },
    [loadBookingData],
  );

  /** The step after `from`, skipping any that no longer apply. */
  const advanceFrom = useCallback(
    (from: StepId) => {
      const index = steps.findIndex((step) => step.id === from);
      const next = index >= 0 ? steps[index + 1] : undefined;
      goToStep(next ? next.id : 'done');
    },
    [steps, goToStep],
  );

  const goBackFrom = useCallback(
    (from: StepId) => {
      const index = steps.findIndex((step) => step.id === from);
      if (index > 0) goToStep(steps[index - 1].id);
    },
    [steps, goToStep],
  );

  const handleCheckIn = async () => {
    if (!token) return;
    setCheckingIn(true);
    setCheckinError(null);
    try {
      const result = await GuestPortalService.autoCheckin(token);
      setCheckinResult(result);
      setEkycSummary(result.ekyc_summary);
    } catch (err) {
      // The backend owns every gate, so a refusal here is authoritative and its
      // message is the reason. Re-read the booking so the panel below agrees
      // with it rather than still offering the button.
      setCheckinError(errorMessage(err, 'We could not check you in just yet.'));
      void loadBookingData({ keepStep: true });
    } finally {
      setCheckingIn(false);
    }
  };

  const handleReceiptUpload = async () => {
    if (!token || !receiptRequestPaymentId || !receiptFile) return;
    setReceiptUploading(true);
    setReceiptUploadError(null);
    try {
      await GuestPortalService.uploadPaymentReceipt(token, receiptRequestPaymentId, receiptFile);
      setReceiptSubmitted(true);
      setReceiptFile(null);
    } catch (err) {
      setReceiptUploadError(errorMessage(err, 'Unable to upload your receipt.'));
    } finally {
      setReceiptUploading(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading...</Typography>
      </Container>
    );
  }

  if (error && !booking) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Alert severity="error">{error}</Alert>
          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 3 }}
            onClick={() => navigate('/guest-checkin')}
          >
            Back to Start
          </Button>
        </Paper>
      </Container>
    );
  }

  const paymentHeading = needsReceipt ? 'Upload your receipt' : 'Complete your payment';
  const paymentSubtitle = needsReceipt
    ? 'Our team has requested your bank-transfer receipt. Please submit it within 24 hours to avoid automatic rejection of this payment.'
    : showPayment
      ? 'Pay securely to confirm your reservation. No extra personal details are required.'
      : 'Payment is not required for this booking right now.';

  return (
    <Container maxWidth="md" sx={{ mt: 8, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Online pre-check-in
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            A few minutes now, and there is far less to do when you arrive.
          </Typography>
        </Box>

        {steps.length > 1 && stepIndex >= 0 && (
          <Stepper activeStep={stepIndex} alternativeLabel sx={{ mb: 4 }}>
            {steps.map((step) => (
              <Step key={step.id}>
                <StepLabel>{step.label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {(booking?.booking_number || guest?.nick_name) && (
          <Box sx={{ mb: 3 }}>
            {booking?.booking_number && (
              <Typography variant="body1">
                Booking <strong>{booking.booking_number}</strong>
              </Typography>
            )}
            {booking?.check_in_date && booking?.check_out_date && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {booking.check_in_date} to {booking.check_out_date}
              </Typography>
            )}
            {guest?.nick_name && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {guest.nick_name}
              </Typography>
            )}
          </Box>
        )}

        {activeStep === 'payment' && (
          <Box>
            <Typography variant="h6" gutterBottom>
              {paymentHeading}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {paymentSubtitle}
            </Typography>

            {showPayment && (
              <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
                {/*
                  The pre-arrival token endpoint (`GET /guest-portal/booking`,
                  backed by GuestPortalBookingView) is a guest-safe subset that
                  does not include a total/amount field, so `amount` is
                  intentionally omitted rather than guessed; the backend derives
                  the charge from the booking and never accepts an amount from
                  the client.
                */}
                <GuestPaymentPanel
                  mode="token"
                  token={token!}
                  onPaid={() => {
                    void loadBookingData({ keepStep: true });
                    advanceFrom('payment');
                  }}
                />
              </Paper>
            )}

            {needsReceipt ? (
              <Box sx={{ mb: 3 }}>
                {receiptRequestMessage ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {receiptRequestMessage}
                  </Alert>
                ) : null}
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Upload payment receipt
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                  Accepted files: JPG, PNG, WebP, or PDF — maximum 10 MB.
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { sm: 'center' } }}
                >
                  <Button component="label" variant="outlined" disabled={receiptUploading}>
                    {receiptFile ? receiptFile.name : 'Choose receipt file'}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      aria-label="Select receipt file"
                      onChange={(event) => {
                        setReceiptUploadError(null);
                        setReceiptFile(event.target.files?.[0] ?? null);
                      }}
                    />
                  </Button>
                  <Button
                    variant="contained"
                    disabled={!receiptFile || receiptUploading}
                    onClick={() => void handleReceiptUpload()}
                  >
                    {receiptUploading ? 'Uploading…' : 'Upload receipt'}
                  </Button>
                </Stack>
                {receiptUploadError ? (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {receiptUploadError}
                  </Alert>
                ) : null}
              </Box>
            ) : null}

            {receiptSubmitted || receiptAlreadyUploaded ? (
              <Alert severity="success" sx={{ mb: 3 }}>
                Your receipt has been submitted and is pending confirmation from our team.
              </Alert>
            ) : null}

            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Box sx={{ flexGrow: 1 }} />
              <Button variant="contained" onClick={() => advanceFrom('payment')}>
                Continue
              </Button>
            </Stack>
          </Box>
        )}

        {activeStep === 'details' && (
          <PreCheckInDetailsStep
            token={token!}
            guest={guest}
            booking={booking}
            onSaved={(result) => {
              setBooking(result.booking);
              setGuest(result.guest);
              setDetailsSaved(true);
              advanceFrom('details');
            }}
            onSkip={() => advanceFrom('details')}
            onBack={paymentStepRelevant ? () => goBackFrom('details') : undefined}
          />
        )}

        {activeStep === 'account' && (
          <ClaimAccountStep
            token={token!}
            booking={booking}
            guest={guest}
            onClaimed={({ portalToken: newToken, emailVerificationRequired }) => {
              setPortalTokenState(newToken);
              setAccountNotice(
                emailVerificationRequired
                  ? 'Your account is ready. Check your email for a link to confirm your address before you sign in with your password next time.'
                  : 'Your account is ready.',
              );
              goToStep('identity');
            }}
            onSkip={() => goToStep('done')}
            onBack={() => goBackFrom('account')}
          />
        )}

        {activeStep === 'identity' && (
          <Box>
            {accountNotice && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {accountNotice}
              </Alert>
            )}
            {portalToken ? (
              <>
                <IdentitySection token={portalToken} />
                <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
                  <Box sx={{ flexGrow: 1 }} />
                  <Button variant="contained" onClick={() => goToStep('done')}>
                    Continue
                  </Button>
                </Stack>
              </>
            ) : (
              <Alert severity="info">
                Verifying your identity before arrival needs an account. You can
                still check in at the front desk.
              </Alert>
            )}
          </Box>
        )}

        {activeStep === 'done' && (
          <Box>
            <Typography variant="h6" gutterBottom>
              You are all set
            </Typography>
            {accountNotice && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {accountNotice}
              </Alert>
            )}
            {detailsSaved && (
              <Alert severity="success" sx={{ mb: 2 }}>
                Your details are saved — that is one less form at the front desk.
              </Alert>
            )}
            {checkinResult ? (
              <Alert severity="success" sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                  Checked in — room {checkinResult.room_number}
                </Typography>
                <Typography variant="body2">{checkinResult.message}</Typography>
              </Alert>
            ) : (
              <>
                {checkinError && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    {checkinError}
                  </Alert>
                )}
                {ekycSummary?.can_auto_checkin ? (
                  <Box sx={{ mb: 2 }}>
                    <Alert severity="success" sx={{ mb: 2 }}>
                      Your identity is verified and check-in is open for this booking.
                    </Alert>
                    <Button
                      variant="contained"
                      size="large"
                      fullWidth
                      disabled={checkingIn}
                      onClick={() => void handleCheckIn()}
                    >
                      {checkingIn ? 'Checking you in…' : 'Check in now'}
                    </Button>
                  </Box>
                ) : ekycSummary?.auto_checkin_block_reason ? (
                  <Alert
                    severity="info"
                    sx={{ mb: 2 }}
                    action={
                      // Some reasons are the guest's to fix (a missing IC or
                      // passport); the rest are ours (a room still being
                      // cleaned, eKYC in review). Only offer the way back when
                      // going back would actually change the verdict.
                      ekycSummary.auto_checkin_block_reason.includes('details') ? (
                        <Button color="inherit" size="small" onClick={() => goToStep('details')}>
                          Update details
                        </Button>
                      ) : undefined
                    }
                  >
                    {ekycSummary.auto_checkin_block_reason}
                  </Alert>
                ) : null}
              </>
            )}
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
              Please bring the ID you booked with. Our team will have everything
              else ready for your arrival.
            </Typography>
          </Box>
        )}

        <Button
          variant="outlined"
          fullWidth
          sx={{ mt: 3 }}
          onClick={() => navigate('/guest-checkin')}
        >
          Back
        </Button>
      </Paper>
    </Container>
  );
};

export default GuestCheckInForm;
