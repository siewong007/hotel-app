import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { HTTPError } from "ky";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import CreditCardOutlinedIcon from "@mui/icons-material/CreditCardOutlined";
import DiamondOutlinedIcon from "@mui/icons-material/DiamondOutlined";
import EastOutlinedIcon from "@mui/icons-material/EastOutlined";
import WorkspacePremiumOutlinedIcon from "@mui/icons-material/WorkspacePremiumOutlined";
import { GuestPortalDashboardService } from "../../api/guestPortalDashboard.service";
import { useGuestLoyaltySocket } from "../../hooks/useGuestLoyaltySocket";
import { PromotionCatalog, VoucherWallet } from "../../../promotions";
import PortalNotificationPreferences from "../../../communications/components/PortalNotificationPreferences";
import { PortalSupportTab } from "../PortalSupportTab";
import { GuestPaymentPanel } from "../GuestPaymentPanel";
import type {
  GuestPortalBookingSummary,
  GuestPortalCreditsResponse,
  GuestPortalMeResponse,
  GuestPortalMembershipResponse,
  GuestPortalTransaction,
} from "../../../../types";
import {
  firstName,
  formatPortalCurrency,
  formatPortalDate,
  humanizePortalStatus,
  pointsActivityContext,
  type PortalSection,
} from "./dashboardUtils";

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const FOREST = "#06110e";
const GOLD = "#d9b572";
const REFUND_REASONS = [
  "Change of plans",
  "Booking made by mistake",
  "Travel disruption",
  "Found another accommodation",
  "Other",
] as const;

export function LoadingState({ label = "Loading your details…" }: { label?: string }) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        py: 7,
      }}
    >
      <CircularProgress size={22} />
      <Typography color="text.secondary">{label}</Typography>
    </Box>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <Alert
      severity="error"
      action={
        retry ? (
          <Button color="inherit" size="small" onClick={retry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Box sx={{ py: 6, textAlign: "center" }}>
      <Typography color="text.secondary">{message}</Typography>
    </Box>
  );
}

function requiresPaymentReceipt(booking: GuestPortalBookingSummary): boolean {
  return booking.receipt_request_payment_id != null && !booking.receipt_uploaded;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="overline"
        sx={{ color: "#8d6b30", fontWeight: 700, letterSpacing: "0.12em" }}
      >
        {eyebrow}
      </Typography>
      <Typography
        variant="h4"
        component="h2"
        sx={{ color: FOREST, fontWeight: 700, mt: 0.5 }}
      >
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        {description}
      </Typography>
    </Box>
  );
}

function CancellationUnavailable({
  booking,
  suffix,
}: {
  booking: GuestPortalBookingSummary;
  suffix: string;
}) {
  const reasonId = `cancellation-unavailable-${booking.id}-${suffix}`;
  const reason =
    booking.cancellation_unavailable_reason ??
    "This booking cannot be cancelled online.";
  return (
    <Box role="status" aria-describedby={reasonId}>
      <Typography variant="body2" color="text.secondary" fontWeight={600}>
        Refund unavailable
      </Typography>
      <Typography id={reasonId} variant="caption" color="text.secondary">
        {reason}
      </Typography>
    </Box>
  );
}

function RefundBookingDialog({
  booking,
  open,
  isSubmitting,
  error,
  onClose,
  onConfirm,
}: {
  booking: GuestPortalBookingSummary | null;
  open: boolean;
  isSubmitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)",
  );
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedReason("");
      setCustomReason("");
    }
  }, [booking?.id, open]);

  if (!booking) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = selectedReason === "Other" ? customReason.trim() : selectedReason;
    if (!reason) return;
    await onConfirm(reason);
  };

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="xs"
      aria-describedby="refund-booking-details"
      transitionDuration={
        prefersReducedMotion ? 0 : { enter: 180, exit: 140 }
      }
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: 3 } } }}
    >
      <Box component="form" onSubmit={(event) => void handleSubmit(event)}>
        <DialogTitle sx={{ color: FOREST, fontWeight: 700 }}>
          Request refund for {booking.booking_number}?
        </DialogTitle>
        <DialogContent>
          <Typography id="refund-booking-details" color="text.secondary">
            {formatPortalDate(booking.check_in_date)} —{" "}
            {formatPortalDate(booking.check_out_date)} ·{" "}
            {formatPortalCurrency(booking.total_amount)}
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Your booking will be cancelled and this request cannot be undone online.
          </Alert>
          {error ? (
            <Alert severity="error" role="alert" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
          <FormControl component="fieldset" fullWidth sx={{ mt: 2 }}>
            <FormLabel component="legend">Reason for refund</FormLabel>
            <RadioGroup
              value={selectedReason}
              onChange={(event) => setSelectedReason(event.target.value)}
            >
              {REFUND_REASONS.map((reason) => (
                <FormControlLabel
                  key={reason}
                  value={reason}
                  control={<Radio />}
                  label={reason}
                  disabled={isSubmitting}
                />
              ))}
            </RadioGroup>
          </FormControl>
          {selectedReason === "Other" ? (
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Custom refund reason"
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              inputProps={{ maxLength: 1000 }}
              helperText={`${1000 - customReason.length} characters remaining`}
              disabled={isSubmitting}
              sx={{ mt: 1 }}
            />
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button
            autoFocus
            onClick={onClose}
            disabled={isSubmitting}
            sx={{ minHeight: 44 }}
          >
            Keep booking
          </Button>
          <Button
            type="submit"
            color="error"
            variant="contained"
            disabled={
              isSubmitting ||
              !selectedReason ||
              (selectedReason === "Other" && !customReason.trim())
            }
            sx={{ minHeight: 44 }}
            startIcon={
              isSubmitting ? (
                <CircularProgress size={18} color="inherit" />
              ) : undefined
            }
          >
            {isSubmitting ? "Submitting…" : "Request refund"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

// Booking is reached only from the shell navigation ("Book a stay" on web, the
// "Book" tab on phones), so no section renders its own book button.
export function OverviewSection({
  token,
  onSectionChange,
}: {
  token: string;
  onSectionChange: (section: PortalSection) => void;
}) {
  const [me, setMe] = useState<GuestPortalMeResponse | null>(null);
  const [bookings, setBookings] = useState<GuestPortalBookingSummary[]>([]);
  const [membership, setMembership] =
    useState<GuestPortalMembershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [partialError, setPartialError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setPartialError(false);
    const [meResponse, bookingsResponse, membershipResponse] =
      await Promise.allSettled([
        GuestPortalDashboardService.me(token),
        GuestPortalDashboardService.bookings({ page: 1, per_page: 10 }, token),
        GuestPortalDashboardService.membership(token),
      ]);
    if (meResponse.status === "fulfilled") setMe(meResponse.value);
    if (bookingsResponse.status === "fulfilled")
      setBookings(bookingsResponse.value.items);
    if (membershipResponse.status === "fulfilled")
      setMembership(membershipResponse.value);
    setPartialError(
      meResponse.status === "rejected" ||
        bookingsResponse.status === "rejected" ||
        membershipResponse.status === "rejected",
    );
    setLoading(false);
  }, [token]);
  useGuestLoyaltySocket(token, () => void load());
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState label="Preparing your stay overview…" />;

  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const nextStay = bookings.find(
    (booking) =>
      booking.check_out_date >= todayKey &&
      !["cancelled", "checked_out"].includes(booking.status.toLowerCase()),
  );
  const member = membership?.membership;
  return (
    <Stack spacing={3}>
      {partialError ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          Some account details are temporarily unavailable. The information we
          could load is shown below.
        </Alert>
      ) : null}
      <Box>
        <Typography
          variant="overline"
          sx={{ color: "#8d6b30", fontWeight: 700, letterSpacing: "0.12em" }}
        >
          Guest account
        </Typography>
        <Typography
          variant="h3"
          component="h2"
          sx={{ color: FOREST, fontWeight: 700, mt: 0.5 }}
        >
          Welcome back, {firstName(me?.guest.full_name)}.
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Everything for your stay, in one calm place.
        </Typography>
      </Box>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card
            sx={{
              minHeight: "100%",
              color: "white",
              bgcolor: FOREST,
              backgroundImage:
                "linear-gradient(135deg, #06110e 0%, #17332b 100%)",
            }}
          >
            <CardContent
              sx={{
                p: { xs: 3, sm: 4 },
                "&:last-child": { pb: { xs: 3, sm: 4 } },
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
                spacing={2}
              >
                <Box>
                  <Typography
                    variant="overline"
                    sx={{ color: GOLD, fontWeight: 700 }}
                  >
                    Your next stay
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
                    {nextStay
                      ? `Booking ${nextStay.booking_number}`
                      : "No stay planned yet"}
                  </Typography>
                  {nextStay ? (
                    <>
                      <Typography
                        sx={{ color: "rgba(255,255,255,.76)", mt: 1 }}
                      >
                        {formatPortalDate(nextStay.check_in_date)} —{" "}
                        {formatPortalDate(nextStay.check_out_date)}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ color: "rgba(255,255,255,.76)", mt: 0.5 }}
                      >
                        {humanizePortalStatus(nextStay.status)} ·{" "}
                        {formatPortalCurrency(nextStay.total_amount)}
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ color: "rgba(255,255,255,.76)", mt: 1 }}>
                      Find a room when you are ready.
                    </Typography>
                  )}
                </Box>
                <CalendarMonthOutlinedIcon sx={{ color: GOLD, fontSize: 34 }} />
              </Stack>
              {nextStay ? (
                <Button
                  endIcon={<EastOutlinedIcon />}
                  onClick={() => onSectionChange("stays")}
                  sx={{
                    color: "white",
                    mt: 3,
                    px: 0,
                    "&:hover": { bgcolor: "transparent", color: GOLD },
                  }}
                >
                  View my stays
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card
            variant="outlined"
            sx={{ minHeight: "100%", borderColor: "rgba(6,17,14,.14)" }}
          >
            <CardContent
              sx={{
                p: { xs: 3, sm: 4 },
                "&:last-child": { pb: { xs: 3, sm: 4 } },
              }}
            >
              <Stack direction="row" justifyContent="space-between">
                <Box>
                  <Typography
                    variant="overline"
                    sx={{ color: "#8d6b30", fontWeight: 700 }}
                  >
                    Points balance
                  </Typography>
                  <Typography
                    variant="h4"
                    sx={{ fontWeight: 700, color: FOREST, mt: 1 }}
                  >
                    {member ? member.points_balance.toLocaleString() : "—"}
                  </Typography>
                  <Typography color="text.secondary">
                    {member
                      ? `${member.tier_name} · points available`
                      : "Not enrolled yet"}
                  </Typography>
                </Box>
                <DiamondOutlinedIcon sx={{ color: GOLD, fontSize: 34 }} />
              </Stack>
              <Button
                endIcon={<EastOutlinedIcon />}
                onClick={() => onSectionChange("points-history")}
                sx={{
                  color: FOREST,
                  mt: 3,
                  px: 0,
                  "&:hover": { bgcolor: "transparent", color: "#8d6b30" },
                }}
              >
                View points history
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Paper
        variant="outlined"
        sx={{ p: { xs: 2, sm: 3 }, borderColor: "rgba(6,17,14,.12)" }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700 }}>
              Plan another visit
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Browse current offers before your next stay.
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="outlined"
              onClick={() => onSectionChange("offers")}
            >
              View offers
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}

function BookingDetailsDialog({
  booking,
  token,
  onClose,
  onPaymentUpdated,
}: {
  booking: GuestPortalBookingSummary | null;
  token: string;
  onClose: () => void;
  onPaymentUpdated: () => void;
}) {
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptUploadError, setReceiptUploadError] = useState<string | null>(null);
  const [receiptUploaded, setReceiptUploaded] = useState(false);
  if (!booking) return null;
  const awaitingPayment = ["pending", "pending_payment"].includes(booking.status);
  const awaitingConfirmation = booking.status === "pending_confirmation";

  const handleReceiptUpload = async () => {
    if (!booking.receipt_request_payment_id || !receiptFile) return;
    setReceiptUploading(true);
    setReceiptUploadError(null);
    try {
      await GuestPortalDashboardService.uploadPaymentReceipt(
        booking.receipt_request_payment_id,
        receiptFile,
        token,
      );
      setReceiptUploaded(true);
      setReceiptFile(null);
      onPaymentUpdated();
    } catch (error) {
      setReceiptUploadError(error instanceof Error ? error.message : 'Unable to upload your receipt.');
    } finally {
      setReceiptUploading(false);
    }
  };
  // Older confirmed bookings may predate the payment-record link. They still
  // need a guest-facing receipt, so confirmation itself is the availability
  // rule; payment metadata is shown when it exists.
  const hasReceipt = booking.status === "confirmed";

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="booking-details-title">
      <DialogTitle id="booking-details-title">Booking {booking.booking_number}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          <Typography><strong>Stay:</strong> {formatPortalDate(booking.check_in_date)} — {formatPortalDate(booking.check_out_date)}</Typography>
          <Typography><strong>Booking status:</strong> {humanizePortalStatus(booking.status)}</Typography>
          <Typography><strong>Total:</strong> {formatPortalCurrency(booking.total_amount)}</Typography>
        </Stack>
        {hasReceipt ? (
          <Paper component="section" aria-labelledby="payment-receipt-heading" variant="outlined" sx={{ mt: 2.5, p: 2, bgcolor: "success.50" }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
              <Box>
                <Typography id="payment-receipt-heading" variant="h6">Booking receipt</Typography>
                <Typography variant="body2" color="text.secondary">Your booking is confirmed.</Typography>
              </Box>
              <Chip label="Paid" color="success" size="small" />
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.75}>
              <Typography variant="body2"><strong>Receipt ID:</strong> {booking.completed_payment_id != null ? `PAY-${booking.completed_payment_id}` : booking.booking_number}</Typography>
              {booking.completed_payment_method ? <Typography variant="body2"><strong>Payment method:</strong> {booking.completed_payment_method}</Typography> : null}
              <Typography variant="body2"><strong>Amount:</strong> {formatPortalCurrency(booking.completed_payment_amount ?? booking.total_amount)}</Typography>
            </Stack>
            <Button variant="outlined" fullWidth sx={{ mt: 2 }} onClick={() => window.print()}>Print receipt</Button>
          </Paper>
        ) : null}
        {awaitingConfirmation ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            Your offline banking payment is awaiting confirmation by our team.
          </Alert>
        ) : null}
        {requiresPaymentReceipt(booking) ? (
          <Alert
            severity="error"
            variant="filled"
            sx={{ mt: 2, boxShadow: "0 4px 14px rgba(166,66,43,.22)" }}
          >
            <Typography variant="subtitle2" fontWeight={800}>
              Action required: upload your receipt
            </Typography>
            <Typography variant="body2">
              Our team has requested your bank-transfer receipt. Please submit it within 24 hours
              to avoid automatic rejection of this payment.
              {booking.receipt_request_message ? ` ${booking.receipt_request_message}` : ''}
            </Typography>
          </Alert>
        ) : null}
        {booking.receipt_uploaded || receiptUploaded ? (
          <Alert severity="success" sx={{ mt: 2 }}>
            <Typography variant="subtitle2">Receipt uploaded</Typography>
            <Typography variant="body2">
              Your receipt has been submitted and is pending confirmation from our team.
            </Typography>
          </Alert>
        ) : booking.receipt_request_payment_id ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Upload payment receipt</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Accepted files: JPG, PNG, WebP, or PDF — maximum 10 MB.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                <Button component="label" variant="outlined" disabled={receiptUploading}>
                  {receiptFile ? receiptFile.name : 'Choose receipt file'}
                  <input
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
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
            {receiptUploadError ? <Alert severity="error" sx={{ mt: 1 }}>{receiptUploadError}</Alert> : null}
          </Box>
        ) : null}
        {awaitingPayment && booking.payment_rejection_reason ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Your previous payment could not be confirmed: {booking.payment_rejection_reason}.
            Please try again below.
          </Alert>
        ) : null}
        {awaitingPayment ? (
          <Box sx={{ mt: 2 }}>
            <GuestPaymentPanel
              mode="session"
              bookingId={booking.id}
              token={token}
              amount={booking.total_amount}
              paymentMethodName={`guest-payment-method-${booking.id}`}
              onPaid={onPaymentUpdated}
            />
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function BookingsSection({ token }: { token: string }) {
  const [items, setItems] = useState<GuestPortalBookingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingToCancel, setBookingToCancel] = useState<GuestPortalBookingSummary | null>(null);
  const [bookingToView, setBookingToView] = useState<GuestPortalBookingSummary | null>(null);
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationSuccess, setCancellationSuccess] = useState<string | null>(null);
  // `search` is what the guest is typing; `appliedSearch` is what the server was
  // asked for. Debouncing between them keeps a request off every keystroke.
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  // A narrower filter can leave the current page past the end of the results.
  useEffect(() => {
    setPage(0);
  }, [appliedSearch]);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await GuestPortalDashboardService.bookings(
        { page: page + 1, per_page: pageSize, search: appliedSearch || undefined },
        token,
      );
      setItems(response.items);
      setTotal(response.total);
    } catch {
      setError("Unable to load your bookings right now.");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page, pageSize, token]);
  useEffect(() => {
    void load();
  }, [load]);
  const cancelBooking = async (reason: string) => {
    if (!bookingToCancel || isCancelling) return;
    setIsCancelling(true);
    setCancellationError(null);
    try {
      await GuestPortalDashboardService.cancelBooking(
        bookingToCancel.id,
        reason,
        token,
      );
      setCancellationSuccess(`Refund request for booking ${bookingToCancel.booking_number} was submitted.`);
      setBookingToCancel(null);
      void load();
    } catch (caught) {
      setCancellationError(
        caught instanceof Error
          ? caught.message
          : "Unable to submit this refund request.",
      );
      if (caught instanceof HTTPError && caught.response.status === 409) {
        void load();
      }
    } finally {
      setIsCancelling(false);
    }
  };
  const receiptRequests = items.filter(requiresPaymentReceipt);
  const firstReceiptRequest = receiptRequests[0];

  return (
    <>
      <SectionHeading
        eyebrow="Stay management"
        title="My stays"
        description="Your reservations, dates, and stay status."
      />
      <Box role="status" aria-live="polite" aria-atomic="true">
        {cancellationSuccess ? <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCancellationSuccess(null)}>{cancellationSuccess}</Alert> : null}
      </Box>
      <TextField
        label="Search stays"
        placeholder="Booking number, status, or date"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        size="small"
        fullWidth
        sx={{ mb: 2, maxWidth: { sm: 420 } }}
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState
          message={
            appliedSearch
              ? `No stays match “${appliedSearch}”.`
              : "You have no bookings on file yet."
          }
        />
      ) : (
        <>
          {firstReceiptRequest ? (
            <Alert
              severity="error"
              variant="filled"
              action={(
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setBookingToView(firstReceiptRequest)}
                  sx={{ fontWeight: 800 }}
                >
                  Upload receipt
                </Button>
              )}
              sx={{
                mb: 3,
                py: 1,
                alignItems: "center",
                boxShadow: "0 6px 18px rgba(166,66,43,.24)",
              }}
            >
              <Typography variant="subtitle1" fontWeight={800}>
                Action required: upload your payment receipt
              </Typography>
              <Typography variant="body2">
                Upload proof of payment for booking {firstReceiptRequest.booking_number} within 24 hours to avoid automatic rejection.
              </Typography>
            </Alert>
          ) : null}
          <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
            <Table aria-label="Your bookings">
              <caption
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              >
                Your hotel booking history
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">
                    Booking
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Check-in
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Check-out
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Status
                  </TableCell>
                  <TableCell component="th" scope="col" align="right">
                    Total
                  </TableCell>
                  <TableCell component="th" scope="col" align="right">
                    Action
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((booking) => {
                  const receiptUploadRequired = requiresPaymentReceipt(booking);
                  return (
                    <TableRow
                      key={booking.booking_number}
                      hover
                      sx={receiptUploadRequired ? { bgcolor: "#FFF1EE", "&:hover": { bgcolor: "#FBE0DA" } } : undefined}
                    >
                      <TableCell
                        component="th"
                        scope="row"
                        sx={{ fontWeight: 700 }}
                      >
                        {booking.booking_number}
                      </TableCell>
                      <TableCell>
                        {formatPortalDate(booking.check_in_date)}
                      </TableCell>
                      <TableCell>
                        {formatPortalDate(booking.check_out_date)}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                          <Chip
                            label={humanizePortalStatus(booking.status)}
                            size="small"
                          />
                          {receiptUploadRequired ? <Chip label="Receipt required" color="error" size="small" /> : null}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        {formatPortalCurrency(booking.total_amount)}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" justifyContent="flex-end" spacing={1}>
                          {receiptUploadRequired ? (
                            <Button variant="contained" color="error" size="small" onClick={() => setBookingToView(booking)} sx={{ minHeight: 44, fontWeight: 800 }}>
                              Upload receipt
                            </Button>
                          ) : null}
                          <Button size="small" onClick={() => setBookingToView(booking)} sx={{ minHeight: 44 }}>
                            View details
                          </Button>
                        {booking.status === "confirmed" ? (
                          <Button size="small" onClick={() => setBookingToView(booking)} sx={{ minHeight: 44 }}>
                            View receipt
                          </Button>
                        ) : null}
                        {booking.can_cancel ? (
                          <Button
                            size="small"
                            color="error"
                            onClick={() => {
                              setCancellationError(null);
                              setBookingToCancel(booking);
                            }}
                            sx={{ minHeight: 44 }}
                          >
                            Refund
                          </Button>
                        ) : (
                          <CancellationUnavailable
                            booking={booking}
                            suffix="desktop"
                          />
                        )}</Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" } }}>
            {items.map((booking) => {
              const receiptUploadRequired = requiresPaymentReceipt(booking);
              return (
                <Card key={booking.booking_number} variant="outlined" sx={receiptUploadRequired ? { borderColor: "#C75A46", bgcolor: "#FFF8F6", boxShadow: "0 5px 16px rgba(166,66,43,.12)" } : undefined}>
                  <CardContent>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Typography fontWeight={700}>
                        {booking.booking_number}
                      </Typography>
                      <Stack spacing={0.5} alignItems="flex-end">
                        <Chip
                          label={humanizePortalStatus(booking.status)}
                          size="small"
                        />
                        {receiptUploadRequired ? <Chip label="Receipt required" color="error" size="small" /> : null}
                      </Stack>
                    </Stack>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {formatPortalDate(booking.check_in_date)} —{" "}
                      {formatPortalDate(booking.check_out_date)}
                    </Typography>
                    <Typography fontWeight={700} sx={{ mt: 1 }}>
                      {formatPortalCurrency(booking.total_amount)}
                    </Typography>
                    {receiptUploadRequired ? (
                      <Button variant="contained" color="error" onClick={() => setBookingToView(booking)} sx={{ mt: 1.5, minHeight: 44, fontWeight: 800 }}>
                        Upload receipt
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => setBookingToView(booking)} sx={{ mt: 1, minHeight: 44 }}>
                      View details
                    </Button>
                    {booking.status === "confirmed" ? (
                      <Button size="small" onClick={() => setBookingToView(booking)} sx={{ mt: 1, ml: 1, minHeight: 44 }}>
                        View receipt
                      </Button>
                    ) : null}
                    {booking.can_cancel ? (
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          setCancellationError(null);
                          setBookingToCancel(booking);
                        }}
                        sx={{ mt: 1, minHeight: 44 }}
                      >
                        Refund
                      </Button>
                    ) : (
                      <Box sx={{ mt: 1.5 }}>
                        <CancellationUnavailable
                          booking={booking}
                          suffix="mobile"
                        />
                      </Box>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, value) => setPage(value)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={PAGE_SIZE_OPTIONS}
            onRowsPerPageChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          />
          <RefundBookingDialog
            booking={bookingToCancel}
            open={Boolean(bookingToCancel)}
            isSubmitting={isCancelling}
            error={cancellationError}
            onClose={() => {
              if (!isCancelling) {
                setBookingToCancel(null);
                setCancellationError(null);
              }
            }}
            onConfirm={cancelBooking}
          />
          <BookingDetailsDialog
            booking={bookingToView}
            token={token}
            onClose={() => setBookingToView(null)}
            onPaymentUpdated={() => void load()}
          />
        </>
      )}
    </>
  );
}

export function PaymentsSection({ token }: { token: string }) {
  const [items, setItems] = useState<GuestPortalTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guest self-service bookings are created `pending` and only flip to
  // `confirmed` once a bank-transfer claim is staff-approved or a PayPal
  // payment captures (see hotel-app-be modules/guest_booking). The portal
  // doesn't expose a separate "amount due"/balance field on
  // GuestPortalBookingSummary, so booking status `pending` is the signal
  // used here to detect bookings still awaiting payment.
  const [pendingBookings, setPendingBookings] = useState<GuestPortalBookingSummary[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await GuestPortalDashboardService.transactions(
        { page: page + 1, per_page: pageSize },
        token,
      );
      setItems(response.items);
      setTotal(response.total);
    } catch {
      setError("Unable to load your payments right now.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, token]);
  const loadPendingBookings = useCallback(async () => {
    setPendingLoading(true);
    try {
      const response = await GuestPortalDashboardService.bookings(
        { page: 1, per_page: 50 },
        token,
      );
      setPendingBookings(response.items.filter((booking) => booking.status === "pending"));
    } catch {
      setPendingBookings([]);
    } finally {
      setPendingLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadPendingBookings();
  }, [loadPendingBookings]);
  return (
    <>
      <SectionHeading
        eyebrow="Account activity"
        title="Payments & invoices"
        description="A record of payments and invoices from your stays."
      />
      {loading || pendingLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : items.length === 0 && pendingBookings.length === 0 ? (
        <EmptyState message="No transactions found." />
      ) : (
        <>
          <TableContainer sx={{ display: { xs: "none", lg: "block" } }}>
            <Table aria-label="Your transactions">
              <caption
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              >
                Payments and invoices for your stays
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">
                    Date
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Type
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Reference
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Booking
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Method
                  </TableCell>
                  <TableCell component="th" scope="col">
                    Status
                  </TableCell>
                  <TableCell component="th" scope="col" align="right">
                    Amount
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingBookings.map((booking) => (
                  <TableRow key={`pending-booking-${booking.id}`} hover>
                    <TableCell>—</TableCell>
                    <TableCell>
                      <Chip
                        icon={<CreditCardOutlinedIcon />}
                        label="Payment"
                        color="success"
                        size="small"
                      />
                    </TableCell>
                    <TableCell>Amount due</TableCell>
                    <TableCell>{booking.booking_number}</TableCell>
                    <TableCell sx={{ minWidth: 300, py: 2 }}>
                      <GuestPaymentPanel
                        mode="session"
                        bookingId={booking.id}
                        token={token}
                        amount={booking.total_amount}
                        paymentMethodName={`guest-payment-method-${booking.id}`}
                        onPaid={() => {
                          void loadPendingBookings();
                          void load();
                        }}
                      />
                    </TableCell>
                    <TableCell>Awaiting payment</TableCell>
                    <TableCell align="right">
                      {formatPortalCurrency(booking.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {items.map((tx, index) => {
                  const TransactionIcon =
                    tx.kind === "payment"
                      ? CreditCardOutlinedIcon
                      : ConfirmationNumberOutlinedIcon;
                  return (
                    <TableRow
                      key={`${tx.kind}-${tx.reference ?? tx.invoice_number ?? index}`}
                      hover
                    >
                      <TableCell>{formatPortalDate(tx.date)}</TableCell>
                      <TableCell>
                        <Chip
                          icon={<TransactionIcon />}
                          label={tx.kind === "payment" ? "Payment" : "Invoice"}
                          color={tx.kind === "payment" ? "success" : "default"}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        {tx.invoice_number ?? tx.reference ?? "—"}
                      </TableCell>
                      <TableCell>{tx.booking_number ?? "—"}</TableCell>
                      <TableCell>{tx.method ?? "—"}</TableCell>
                      <TableCell>
                        {tx.status ? humanizePortalStatus(tx.status) : "—"}
                      </TableCell>
                      <TableCell align="right">
                        {formatPortalCurrency(tx.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack spacing={1.5} sx={{ display: { xs: "flex", lg: "none" } }}>
            {pendingBookings.map((booking) => (
              <Card key={`pending-booking-${booking.id}`} variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Chip icon={<CreditCardOutlinedIcon />} label="Payment" size="small" />
                    <Typography fontWeight={700}>
                      {formatPortalCurrency(booking.total_amount)}
                    </Typography>
                  </Stack>
                  <Typography sx={{ mt: 1 }}>Booking {booking.booking_number}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Awaiting payment
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    <GuestPaymentPanel
                      mode="session"
                      bookingId={booking.id}
                      token={token}
                      amount={booking.total_amount}
                      paymentMethodName={`guest-payment-method-${booking.id}`}
                      onPaid={() => {
                        void loadPendingBookings();
                        void load();
                      }}
                    />
                  </Box>
                </CardContent>
              </Card>
            ))}
            {items.map((tx, index) => {
              const TransactionIcon =
                tx.kind === "payment"
                  ? CreditCardOutlinedIcon
                  : ConfirmationNumberOutlinedIcon;
              return (
                <Card
                  key={`${tx.kind}-${tx.reference ?? tx.invoice_number ?? index}`}
                  variant="outlined"
                >
                  <CardContent>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Chip
                        icon={<TransactionIcon />}
                        label={tx.kind === "payment" ? "Payment" : "Invoice"}
                        size="small"
                      />
                      <Typography fontWeight={700}>
                        {formatPortalCurrency(tx.amount)}
                      </Typography>
                    </Stack>
                    <Typography sx={{ mt: 1 }}>
                      {tx.invoice_number ?? tx.reference ?? "Transaction"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatPortalDate(tx.date)} ·{" "}
                      {humanizePortalStatus(tx.status)}
                    </Typography>
                    {tx.booking_number ? (
                      <Typography variant="body2" color="text.secondary">
                        Booking {tx.booking_number}
                      </Typography>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, value) => setPage(value)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={PAGE_SIZE_OPTIONS}
            onRowsPerPageChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * Complimentary-night credits, broken down by room type.
 *
 * Credits are granted per room type and are not interchangeable, so the
 * breakdown — not the headline total — is what the guest can actually spend.
 * Redemption happens in the booking funnel, where the nights to comp are
 * chosen against real availability and rates.
 */
export function CreditsSection({ token }: { token: string }) {
  const [credits, setCredits] = useState<GuestPortalCreditsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCredits(await GuestPortalDashboardService.credits(token));
    } catch {
      setError("Unable to load your complimentary nights right now.");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading your complimentary nights…" />;
  if (error) return <ErrorState message={error} retry={() => void load()} />;

  const rows = credits?.credits_by_room_type ?? [];
  const total = credits?.total_nights_available ?? 0;

  return (
    <>
      <SectionHeading
        eyebrow="Complimentary"
        title="Free nights"
        description="Nights the hotel has gifted you. Each one is tied to a room type and can be applied when you book that room."
      />
      {rows.length === 0 ? (
        <EmptyState message="You have no complimentary nights right now. The hotel will let you know when you earn some." />
      ) : (
        <>
          <Card sx={{ mb: 3, bgcolor: FOREST, color: "white" }}>
            <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
              <Typography
                variant="overline"
                sx={{ color: GOLD, fontWeight: 700 }}
              >
                Nights available
              </Typography>
              <Typography variant="h3" sx={{ mt: 0.5, fontWeight: 700 }}>
                {total.toLocaleString()}
              </Typography>
              <Typography sx={{ color: "rgba(255,255,255,.76)", mt: 1 }}>
                Across {rows.length} room{" "}
                {rows.length === 1 ? "type" : "types"}
              </Typography>
            </CardContent>
          </Card>
          <List disablePadding>
            {rows.map((credit) => (
              <ListItem
                key={credit.room_type_id}
                divider
                secondaryAction={
                  <Button
                    size="small"
                    variant="contained"
                    endIcon={<EastOutlinedIcon />}
                    href="/guest-portal?view=booking"
                  >
                    Book
                  </Button>
                }
                sx={{ px: 0 }}
              >
                <ListItemText
                  primary={credit.room_type_name}
                  secondary={`${credit.room_type_code} · ${credit.nights_available} free night${credit.nights_available === 1 ? "" : "s"}`}
                  primaryTypographyProps={{ fontWeight: 700, color: FOREST }}
                />
              </ListItem>
            ))}
          </List>
          <Alert severity="info" sx={{ mt: 3 }}>
            Choose your dates and room in the booking flow, then pick which
            nights to cover with your free nights before you pay.
          </Alert>
        </>
      )}
    </>
  );
}

export function PointsHistorySection({ token }: { token: string }) {
  const [membership, setMembership] =
    useState<GuestPortalMembershipResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembership(await GuestPortalDashboardService.membership(token));
    } catch {
      setError("Unable to load your points history right now.");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useGuestLoyaltySocket(token, () => void load());
  useEffect(() => {
    void load();
  }, [load]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} retry={() => void load()} />;
  const member = membership?.membership;
  return (
    <>
      <SectionHeading
        eyebrow="Loyalty"
        title="Points history"
        description="Track your loyalty points and current balance. Claimable rewards are available in Offers."
      />
      {member ? (
        <Card sx={{ mb: 3, bgcolor: FOREST, color: "white" }}>
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 7 }}>
                <Typography
                  variant="overline"
                  sx={{ color: GOLD, fontWeight: 700 }}
                >
                  {member.tier_name} member
                </Typography>
                <Typography variant="h5" sx={{ mt: 1, fontWeight: 700 }}>
                  {member.member_number}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,.76)", mt: 1 }}>
                  Level {member.tier_level} · {member.status}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <Typography
                  variant="overline"
                  sx={{ color: GOLD, fontWeight: 700 }}
                >
                  Points available
                </Typography>
                <Typography variant="h3" sx={{ mt: 0.5, fontWeight: 700 }}>
                  {member.points_balance.toLocaleString()}
                </Typography>
                <Typography sx={{ color: "rgba(255,255,255,.76)" }}>
                  {member.lifetime_points.toLocaleString()} lifetime points
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          You are not enrolled in the loyalty program yet.
        </Alert>
      )}
      {membership?.recent_activity.length ? (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700 }}>
            Recent activity
          </Typography>
          <List>
            {membership.recent_activity.map((activity, index) => {
              const context = pointsActivityContext(activity);
              return (
                <Box key={`${activity.date}-${index}`}>
                  <ListItem disableGutters>
                    <ListItemText
                      primary={`${humanizePortalStatus(activity.transaction_type)} · ${activity.points > 0 ? "+" : ""}${activity.points} points`}
                      secondary={
                        <Stack component="span" spacing={0.25}>
                          <Box component="span">
                            {formatPortalDate(activity.date)} · Balance {activity.balance_after.toLocaleString()}
                          </Box>
                          {context ? <Box component="span">{context}</Box> : null}
                        </Stack>
                      }
                    />
                  </ListItem>
                  {index < membership.recent_activity.length - 1 ? (
                    <Divider />
                  ) : null}
                </Box>
              );
            })}
          </List>
        </Box>
      ) : (
        <EmptyState message="You have no points activity yet." />
      )}
    </>
  );
}

export function EmbeddedSection({
  section,
  token,
}: {
  section: PortalSection;
  token: string;
}) {
  if (section === "offers")
    return (
      <>
        <SectionHeading
          eyebrow="Plan ahead"
          title="Current offers"
          description="Eligible hotel deals, ready to claim when available."
        />
        <PromotionCatalog token={token} />
      </>
    );
  if (section === "vouchers")
    return (
      <>
        <SectionHeading
          eyebrow="Your wallet"
          title="My vouchers"
          description="Keep your claimed offers in one easy-to-find place."
        />
        <VoucherWallet token={token} />
      </>
    );
  if (section === "support")
    return (
      <>
        <SectionHeading
          eyebrow="Help desk"
          title="Support"
          description="Start or continue a conversation with our team."
        />
        <PortalSupportTab token={token} />
      </>
    );
  return (
    <>
      <SectionHeading
        eyebrow="Account controls"
        title="Preferences"
        description="Choose how you would like to hear from us."
      />
      <PortalNotificationPreferences token={token} />
    </>
  );
}
