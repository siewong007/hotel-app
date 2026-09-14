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
import { guestErrorMessage } from "../../utils/feedback";
import { useTranslation } from "../../../../i18n";
import { useAutoFocusError } from "../../../../hooks/useAutoFocusError";
import { PromotionCatalog, VoucherWallet } from "../../../promotions";
import PortalNotificationPreferences from "../../../communications/components/PortalNotificationPreferences";
import { AppearancePreferenceCard } from "./AppearancePreferenceCard";
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
// TablePagination's getItemAriaLabel hands us its English type names; map them
// to keys rather than branching on translated copy.
const PAGINATION_ARIA_KEYS = {
  first: "pageFirst",
  previous: "pagePrevious",
  next: "pageNext",
  last: "pageLast",
} as const;
const REFUND_REASONS = [
  "Change of plans",
  "Booking made by mistake",
  "Travel disruption",
  "Found another accommodation",
  "Other",
] as const;

// The English constants above are the values sent to the API; these keys only
// drive what the guest reads.
const REFUND_REASON_KEYS: Record<(typeof REFUND_REASONS)[number], string> = {
  "Change of plans": "dashboard.bookings.cancelDialog.reasons.changeOfPlans",
  "Booking made by mistake": "dashboard.bookings.cancelDialog.reasons.mistake",
  "Travel disruption": "dashboard.bookings.cancelDialog.reasons.disruption",
  "Found another accommodation":
    "dashboard.bookings.cancelDialog.reasons.otherAccommodation",
  Other: "dashboard.bookings.cancelDialog.reasons.other",
};

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation("guestPortal");
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
      <Typography sx={{
        color: "text.secondary"
      }}>{label ?? t("dashboard.loading")}</Typography>
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
  const { t } = useTranslation("guestPortal");
  return (
    <Alert
      severity="error"
      role="alert"
      action={
        retry ? (
          <Button color="inherit" size="small" onClick={retry}>
            {t("common:actions.retry")}
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
      <Typography sx={{
        color: "text.secondary"
      }}>{message}</Typography>
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
        sx={{ color: "var(--hotel-primary-text)", fontWeight: 700, letterSpacing: "0.12em" }}
      >
        {eyebrow}
      </Typography>
      <Typography
        variant="h4"
        component="h2"
        sx={{ color: "var(--hotel-text)", fontWeight: 700, mt: 0.5 }}
      >
        {title}
      </Typography>
      <Typography
        sx={{
          color: "text.secondary",
          mt: 1
        }}>
        {description}
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
  const { t } = useTranslation("guestPortal");
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)",
  );
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const errorRef = useAutoFocusError(error);

  useEffect(() => {
    if (open) {
      setSelectedReason("");
      setCustomReason("");
    }
  }, [booking?.id, open]);

  if (!booking) return null;

  const isRefund = booking.completed_payment_id != null;
  const actionLabel = isRefund
    ? t("dashboard.bookings.cancelDialog.submitRequest")
    : t("dashboard.bookings.cancelBooking");

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
      slotProps={{
        paper: { sx: { borderRadius: { xs: 0, sm: 3 } } }
      }}
    >
      <Box component="form" onSubmit={(event) => void handleSubmit(event)}>
        <DialogTitle sx={{ color: "var(--hotel-text)", fontWeight: 700 }}>
          {isRefund
            ? t("dashboard.bookings.cancelDialog.requestTitle", {
                number: booking.booking_number,
              })
            : t("dashboard.bookings.cancelDialog.cancelTitle", {
                number: booking.booking_number,
              })}
        </DialogTitle>
        <DialogContent>
          <Typography id="refund-booking-details" sx={{
            color: "text.secondary"
          }}>
            {formatPortalDate(booking.check_in_date)} —{" "}
            {formatPortalDate(booking.check_out_date)} ·{" "}
            {formatPortalCurrency(booking.total_amount)}
          </Typography>
          {isRefund ? (
            <Alert severity="info" role="alert" sx={{ mt: 2 }}>
              {t("dashboard.bookings.cancelDialog.paidNotice")}
            </Alert>
          ) : (
            <Alert severity="warning" role="alert" sx={{ mt: 2 }}>
              {t("dashboard.bookings.cancelDialog.unpaidNotice")}
            </Alert>
          )}
          {error ? (
            <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1} sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
          <FormControl component="fieldset" fullWidth sx={{ mt: 2 }}>
            <FormLabel component="legend">
              {t("dashboard.bookings.cancelDialog.reasonLabel")}
            </FormLabel>
            <RadioGroup
              value={selectedReason}
              onChange={(event) => setSelectedReason(event.target.value)}
            >
              {REFUND_REASONS.map((reason) => (
                <FormControlLabel
                  key={reason}
                  value={reason}
                  control={<Radio />}
                  label={t(REFUND_REASON_KEYS[reason])}
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
              label={t("dashboard.bookings.cancelDialog.customReasonLabel")}
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
              helperText={t(
                "dashboard.bookings.cancelDialog.charactersRemaining",
                { count: 1000 - customReason.length },
              )}
              disabled={isSubmitting}
              sx={{ mt: 1 }}
              slotProps={{
                htmlInput: { maxLength: 1000 }
              }}
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
            {t("dashboard.bookings.cancelDialog.keepBooking")}
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
            {isSubmitting
              ? t("dashboard.bookings.cancelDialog.submitting")
              : actionLabel}
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
  const { t } = useTranslation("guestPortal");
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
  if (loading) return <LoadingState label={t("dashboard.overview.loading")} />;

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
          role="alert"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              {t("common:actions.retry")}
            </Button>
          }
        >
          {t("dashboard.overview.partialError")}
        </Alert>
      ) : null}
      <Box>
        <Typography
          variant="overline"
          sx={{ color: "var(--hotel-primary-text)", fontWeight: 700, letterSpacing: "0.12em" }}
        >
          {t("dashboard.overview.eyebrow")}
        </Typography>
        <Typography
          variant="h3"
          component="h2"
          sx={{ color: "var(--hotel-text)", fontWeight: 700, mt: 0.5 }}
        >
          {t("dashboard.overview.welcome", {
            name: firstName(me?.guest.nick_name),
          })}
        </Typography>
        <Typography
          sx={{
            color: "text.secondary",
            mt: 1
          }}>
          {t("dashboard.overview.subtitle")}
        </Typography>
      </Box>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card
            sx={{
              minHeight: "100%",
              color: "var(--hotel-text)",
              bgcolor: "var(--hotel-surface-raised)",
              backgroundImage:
                "linear-gradient(135deg, var(--hotel-surface-raised) 0%, var(--hotel-surface-sunken) 100%)",
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
                spacing={2}
                sx={{
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}>
                <Box>
                  <Typography
                    variant="overline"
                    sx={{ color: "var(--hotel-primary)", fontWeight: 700 }}
                  >
                    {t("dashboard.overview.nextStay")}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
                    {nextStay
                      ? t("dashboard.overview.nextStayBooking", {
                          number: nextStay.booking_number,
                        })
                      : t("dashboard.overview.noStay")}
                  </Typography>
                  {nextStay ? (
                    <>
                      <Typography
                        sx={{ color: "var(--hotel-text-secondary)", mt: 1 }}
                      >
                        {formatPortalDate(nextStay.check_in_date)} —{" "}
                        {formatPortalDate(nextStay.check_out_date)}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ color: "var(--hotel-text-secondary)", mt: 0.5 }}
                      >
                        {humanizePortalStatus(nextStay.status)} ·{" "}
                        {formatPortalCurrency(nextStay.total_amount)}
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ color: "var(--hotel-text-secondary)", mt: 1 }}>
                      {t("dashboard.overview.noStayHint")}
                    </Typography>
                  )}
                </Box>
                <CalendarMonthOutlinedIcon sx={{ color: "var(--hotel-primary)", fontSize: 34 }} />
              </Stack>
              {nextStay ? (
                <Button
                  endIcon={<EastOutlinedIcon />}
                  onClick={() => onSectionChange("stays")}
                  sx={{
                    color: "var(--hotel-text)",
                    mt: 3,
                    px: 0,
                    "&:hover": { bgcolor: "transparent", color: "var(--hotel-primary)" },
                  }}
                >
                  {t("dashboard.overview.viewStays")}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card
            variant="outlined"
            sx={{ minHeight: "100%", borderColor: "var(--hotel-border)" }}
          >
            <CardContent
              sx={{
                p: { xs: 3, sm: 4 },
                "&:last-child": { pb: { xs: 3, sm: 4 } },
              }}
            >
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Box>
                  <Typography
                    variant="overline"
                    sx={{ color: "var(--hotel-primary-text)", fontWeight: 700 }}
                  >
                    {t("dashboard.overview.pointsBalance")}
                  </Typography>
                  <Typography
                    variant="h4"
                    sx={{ fontWeight: 700, color: "var(--hotel-text)", mt: 1 }}
                  >
                    {member ? member.points_balance.toLocaleString() : "—"}
                  </Typography>
                  <Typography sx={{
                    color: "text.secondary"
                  }}>
                    {member
                      ? t("dashboard.overview.pointsAvailable", {
                          tier: member.tier_name,
                        })
                      : t("dashboard.overview.notEnrolled")}
                  </Typography>
                </Box>
                <DiamondOutlinedIcon sx={{ color: "var(--hotel-primary)", fontSize: 34 }} />
              </Stack>
              <Button
                endIcon={<EastOutlinedIcon />}
                onClick={() => onSectionChange("points-history")}
                sx={{
                  color: "var(--hotel-text)",
                  mt: 3,
                  px: 0,
                  "&:hover": { bgcolor: "transparent", color: "var(--hotel-primary-text)" },
                }}
              >
                {t("dashboard.overview.viewPoints")}
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Paper
        variant="outlined"
        sx={{ p: { xs: 2, sm: 3 }, borderColor: "var(--hotel-border)" }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            alignItems: { sm: "center" },
            justifyContent: "space-between"
          }}>
          <Box>
            <Typography variant="h6" sx={{ color: "var(--hotel-text)", fontWeight: 700 }}>
              {t("dashboard.overview.planVisit")}
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t("dashboard.overview.planVisitHint")}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="outlined"
              onClick={() => onSectionChange("offers")}
            >
              {t("dashboard.overview.viewOffers")}
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
  onRequestCancel,
}: {
  booking: GuestPortalBookingSummary | null;
  token: string;
  onClose: () => void;
  onPaymentUpdated: () => void;
  onRequestCancel: (booking: GuestPortalBookingSummary) => void;
}) {
  const { t } = useTranslation("guestPortal");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptUploadError, setReceiptUploadError] = useState<string | null>(null);
  const [receiptUploaded, setReceiptUploaded] = useState(false);
  const receiptUploadErrorRef = useAutoFocusError(receiptUploadError);
  // The dialog component stays mounted between opens (it early-returns on a
  // null booking), so receipt state from the previous view must not bleed
  // into the next one.
  useEffect(() => {
    setReceiptFile(null);
    setReceiptUploadError(null);
    setReceiptUploaded(false);
  }, [booking?.id]);
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
      setReceiptUploadError(
        guestErrorMessage(error, t("dashboard.bookings.details.uploadFailed")),
      );
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
      <DialogTitle id="booking-details-title">{t("dashboard.bookings.details.title", { number: booking.booking_number })}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.25}>
          <Typography><strong>{t("dashboard.bookings.details.stay")}:</strong> {formatPortalDate(booking.check_in_date)} — {formatPortalDate(booking.check_out_date)}</Typography>
          <Typography><strong>{t("dashboard.bookings.details.bookingStatus")}:</strong> {humanizePortalStatus(booking.status)}</Typography>
          <Typography><strong>{t("dashboard.bookings.details.total")}:</strong> {formatPortalCurrency(booking.total_amount)}</Typography>
        </Stack>
        {!booking.can_cancel ? (
          <Box sx={{ mt: 1.5 }}>
            {booking.cancellation_pending ? (
              <Chip label="Cancellation under review" color="warning" size="small" />
            ) : (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {booking.cancellation_unavailable_reason ??
                  "This booking cannot be cancelled online."}
              </Typography>
            )}
          </Box>
        ) : null}
        {hasReceipt ? (
          <Paper component="section" aria-labelledby="payment-receipt-heading" variant="outlined" sx={{ mt: 2.5, p: 2, bgcolor: "var(--hotel-success-bg)", borderColor: "var(--hotel-success-border)" }}>
            <Stack
              direction="row"
              spacing={2}
              sx={{
                justifyContent: "space-between",
                alignItems: "flex-start"
              }}>
              <Box>
                <Typography id="payment-receipt-heading" variant="h6">{t("dashboard.bookings.details.receiptTitle")}</Typography>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t("dashboard.bookings.details.confirmedBody")}</Typography>
              </Box>
              <Chip label={t("dashboard.bookings.details.paid")} color="success" size="small" />
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.75}>
              <Typography variant="body2"><strong>{t("dashboard.bookings.details.receiptId")}:</strong> {booking.completed_payment_id != null ? `PAY-${booking.completed_payment_id}` : booking.booking_number}</Typography>
              {booking.completed_payment_method ? <Typography variant="body2"><strong>{t("dashboard.bookings.details.paymentMethod")}:</strong> {booking.completed_payment_method}</Typography> : null}
              <Typography variant="body2"><strong>{t("dashboard.bookings.details.amount")}:</strong> {formatPortalCurrency(booking.completed_payment_amount ?? booking.total_amount)}</Typography>
            </Stack>
            <Button variant="outlined" fullWidth sx={{ mt: 2 }} onClick={() => window.print()}>{t("dashboard.bookings.details.printReceipt")}</Button>
          </Paper>
        ) : null}
        {awaitingConfirmation ? (
          <Alert severity="info" role="alert" sx={{ mt: 2 }}>
            {t("dashboard.bookings.details.offlinePending")}
          </Alert>
        ) : null}
        {requiresPaymentReceipt(booking) ? (
          <Alert
            severity="error"
            variant="filled"
            role="alert"
            sx={{ mt: 2, boxShadow: "var(--hotel-shadow-sm)" }}
          >
            <Typography variant="subtitle2" sx={{
              fontWeight: 800
            }}>
              {t("dashboard.bookings.details.receiptRequiredTitle")}
            </Typography>
            <Typography variant="body2">
              {t("dashboard.bookings.details.receiptRequiredBody")}
              {booking.receipt_request_message ? ` ${booking.receipt_request_message}` : ''}
            </Typography>
          </Alert>
        ) : null}
        {booking.receipt_uploaded || receiptUploaded ? (
          <Alert severity="success" role="alert" sx={{ mt: 2 }}>
            <Typography variant="subtitle2">{t("dashboard.bookings.details.receiptUploadedTitle")}</Typography>
            <Typography variant="body2">
              {t("dashboard.bookings.details.receiptUploadedBody")}
            </Typography>
          </Alert>
        ) : booking.receipt_request_payment_id ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t("dashboard.bookings.details.uploadTitle")}</Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 1
              }}>
              {t("dashboard.bookings.details.uploadHint")}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{
              alignItems: { sm: 'center' }
            }}>
                <Button component="label" variant="outlined" disabled={receiptUploading}>
                  {receiptFile ? receiptFile.name : t("dashboard.bookings.details.uploadChoose")}
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
                  {receiptUploading ? t("dashboard.bookings.details.uploading") : t("dashboard.bookings.details.uploadButton")}
                </Button>
            </Stack>
            {receiptUploadError ? <Alert severity="error" role="alert" ref={receiptUploadErrorRef} tabIndex={-1} sx={{ mt: 1 }}>{receiptUploadError}</Alert> : null}
          </Box>
        ) : null}
        {awaitingPayment && booking.payment_rejection_reason ? (
          <Alert severity="warning" role="alert" sx={{ mt: 2 }}>
            {t("dashboard.bookings.details.paymentRejected", { reason: booking.payment_rejection_reason })}
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
        {booking.can_cancel ? (
          <Button
            color="error"
            variant="outlined"
            onClick={() => onRequestCancel(booking)}
            sx={{ mr: "auto" }}
          >
            {booking.completed_payment_id != null
              ? t("dashboard.bookings.requestCancellation")
              : t("dashboard.bookings.cancelBooking")}
          </Button>
        ) : null}
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function BookingsSection({ token }: { token: string }) {
  const { t } = useTranslation("guestPortal");
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
      setError(t("dashboard.bookings.loadError"));
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page, pageSize, t, token]);
  useEffect(() => {
    void load();
  }, [load]);
  const cancelBooking = async (reason: string) => {
    if (!bookingToCancel || isCancelling) return;
    setIsCancelling(true);
    setCancellationError(null);
    try {
      const response = await GuestPortalDashboardService.cancelBooking(
        bookingToCancel.id,
        reason,
        token,
      );
      setCancellationSuccess(
        response.cancellation_requested
          ? t("dashboard.bookings.cancelRequested", {
              number: bookingToCancel.booking_number,
            })
          : t("dashboard.bookings.cancelled", {
              number: bookingToCancel.booking_number,
            }),
      );
      setBookingToCancel(null);
      void load();
    } catch (caught) {
      setCancellationError(
        guestErrorMessage(caught, t("dashboard.bookings.cancelFailed")),
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
        eyebrow={t("dashboard.bookings.eyebrow")}
        title={t("dashboard.bookings.title")}
        description={t("dashboard.bookings.description")}
      />
      <Box role="status" aria-live="polite" aria-atomic="true">
        {cancellationSuccess ? <Alert severity="success" role="alert" sx={{ mb: 2 }} onClose={() => setCancellationSuccess(null)}>{cancellationSuccess}</Alert> : null}
      </Box>
      <TextField
        label={t("dashboard.bookings.searchLabel")}
        placeholder={t("dashboard.bookings.searchPlaceholder")}
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
              ? t("dashboard.bookings.emptySearch", { search: appliedSearch })
              : t("dashboard.bookings.empty")
          }
        />
      ) : (
        <>
          {firstReceiptRequest ? (
            <Alert
              severity="error"
              variant="filled"
              role="alert"
              action={(
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setBookingToView(firstReceiptRequest)}
                  sx={{ fontWeight: 800 }}
                >
                  {t("dashboard.bookings.uploadReceipt")}
                </Button>
              )}
              sx={{
                mb: 3,
                py: 1,
                alignItems: "center",
                boxShadow: "var(--hotel-shadow-md)",
              }}
            >
              <Typography variant="subtitle1" sx={{
                fontWeight: 800
              }}>
                {t("dashboard.bookings.receiptRequiredTitle")}
              </Typography>
              <Typography variant="body2">
                {t("dashboard.bookings.receiptRequiredBody", { number: firstReceiptRequest.booking_number })}
              </Typography>
            </Alert>
          ) : null}
          <TableContainer sx={{ display: { xs: "none", md: "block" } }}>
            <Table aria-label={t("dashboard.bookings.tableLabel")}>
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
                {t("dashboard.bookings.tableCaption")}
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">
                    {t("dashboard.bookings.colBooking")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("booking.checkIn")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("booking.checkOut")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("booking.status")}
                  </TableCell>
                  <TableCell component="th" scope="col" align="right">
                    {t("booking.total")}
                  </TableCell>
                  <TableCell component="th" scope="col" align="right">
                    {t("dashboard.bookings.colAction")}
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
                      sx={receiptUploadRequired ? { bgcolor: "var(--hotel-danger-bg)", "&:hover": { bgcolor: "var(--hotel-active)" } } : undefined}
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
                        <Stack direction="row" spacing={0.5} useFlexGap sx={{
                          flexWrap: "wrap"
                        }}>
                          <Chip
                            label={humanizePortalStatus(booking.status)}
                            size="small"
                          />
                          {receiptUploadRequired ? <Chip label={t("dashboard.bookings.receiptRequiredChip")} color="error" size="small" /> : null}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        {formatPortalCurrency(booking.total_amount)}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} sx={{
                          justifyContent: "flex-end"
                        }}>
                          {receiptUploadRequired ? (
                            <Button variant="contained" color="error" size="small" onClick={() => setBookingToView(booking)} sx={{ minHeight: 44, fontWeight: 800 }}>
                              {t("dashboard.bookings.uploadReceipt")}
                            </Button>
                          ) : null}
                          <Button size="small" onClick={() => setBookingToView(booking)} sx={{ minHeight: 44 }}>
                            {t("dashboard.bookings.viewDetails")}
                          </Button>
                        </Stack>
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
                <Card key={booking.booking_number} variant="outlined" sx={receiptUploadRequired ? { borderColor: "var(--hotel-danger-border)", bgcolor: "var(--hotel-danger-bg)", boxShadow: "var(--hotel-shadow-sm)" } : undefined}>
                  <CardContent>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        justifyContent: "space-between"
                      }}
                    >
                      <Typography sx={{
                        fontWeight: 700
                      }}>
                        {booking.booking_number}
                      </Typography>
                      <Stack spacing={0.5} sx={{
                        alignItems: "flex-end"
                      }}>
                        <Chip
                          label={humanizePortalStatus(booking.status)}
                          size="small"
                        />
                        {receiptUploadRequired ? <Chip label={t("dashboard.bookings.receiptRequiredChip")} color="error" size="small" /> : null}
                      </Stack>
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        mt: 1
                      }}>
                      {formatPortalDate(booking.check_in_date)} —{" "}
                      {formatPortalDate(booking.check_out_date)}
                    </Typography>
                    <Typography
                      sx={{
                        fontWeight: 700,
                        mt: 1
                      }}>
                      {formatPortalCurrency(booking.total_amount)}
                    </Typography>
                    {receiptUploadRequired ? (
                      <Button variant="contained" color="error" onClick={() => setBookingToView(booking)} sx={{ mt: 1.5, minHeight: 44, fontWeight: 800 }}>
                        {t("dashboard.bookings.uploadReceipt")}
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => setBookingToView(booking)} sx={{ mt: 1, minHeight: 44 }}>
                      {t("dashboard.bookings.viewDetails")}
                    </Button>
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
            labelRowsPerPage={t("dashboard.pagination.rowsPerPage")}
            labelDisplayedRows={({ from, to, count }) =>
              count === -1
                ? t("dashboard.pagination.displayedRowsMore", { from, to })
                : t("dashboard.pagination.displayedRows", { from, to, count })
            }
            getItemAriaLabel={(type) =>
              t(`dashboard.pagination.${PAGINATION_ARIA_KEYS[type]}`)
            }
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
            onRequestCancel={(booking) => {
              setCancellationError(null);
              setBookingToCancel(booking);
              setBookingToView(null);
            }}
          />
        </>
      )}
    </>
  );
}

export function PaymentsSection({ token }: { token: string }) {
  const { t } = useTranslation("guestPortal");
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
  const [pendingError, setPendingError] = useState<string | null>(null);
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
      setError(t("dashboard.payments.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, t, token]);
  const loadPendingBookings = useCallback(async () => {
    setPendingLoading(true);
    setPendingError(null);
    try {
      const response = await GuestPortalDashboardService.bookings(
        { page: 1, per_page: 50 },
        token,
      );
      setPendingBookings(response.items.filter((booking) => booking.status === "pending"));
    } catch (caught) {
      // Secondary surface: the transactions list below is still valid, so a
      // failed pending-bookings check warns inline instead of taking the
      // whole section down.
      setPendingBookings([]);
      setPendingError(
        guestErrorMessage(caught, t("payments.pendingLoadFailed")),
      );
    } finally {
      setPendingLoading(false);
    }
  }, [t, token]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadPendingBookings();
  }, [loadPendingBookings]);
  // The pending-payments check is a secondary surface: its failure warns above
  // the list with a retry instead of replacing the transactions it sits on.
  const pendingAlert = pendingError ? (
    <Alert
      severity="warning"
      role="alert"
      sx={{ mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => void loadPendingBookings()}
        >
          {t("common:actions.retry")}
        </Button>
      }
    >
      {pendingError}
    </Alert>
  ) : null;
  return (
    <>
      <SectionHeading
        eyebrow={t("dashboard.payments.eyebrow")}
        title={t("dashboard.payments.title")}
        description={t("dashboard.payments.description")}
      />
      {loading || pendingLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : items.length === 0 && pendingBookings.length === 0 ? (
        <>
          {pendingAlert}
          {pendingError ? null : (
            <EmptyState message={t("dashboard.payments.empty")} />
          )}
        </>
      ) : (
        <>
          {pendingAlert}
          <TableContainer sx={{ display: { xs: "none", lg: "block" } }}>
            <Table aria-label={t("dashboard.payments.tableLabel")}>
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
                {t("dashboard.payments.tableCaption")}
              </caption>
              <TableHead>
                <TableRow>
                  <TableCell component="th" scope="col">
                    {t("dashboard.payments.colDate")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("dashboard.payments.colType")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("dashboard.payments.colReference")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("dashboard.payments.colBooking")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("dashboard.payments.colMethod")}
                  </TableCell>
                  <TableCell component="th" scope="col">
                    {t("booking.status")}
                  </TableCell>
                  <TableCell component="th" scope="col" align="right">
                    {t("dashboard.payments.colAmount")}
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
                        label={t("dashboard.payments.kindPayment")}
                        color="success"
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{t("dashboard.payments.amountDue")}</TableCell>
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
                    <TableCell>{t("dashboard.payments.awaitingPayment")}</TableCell>
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
                          label={tx.kind === "payment" ? t("dashboard.payments.kindPayment") : t("dashboard.payments.kindInvoice")}
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
                  <Stack direction="row" spacing={1} sx={{
                    justifyContent: "space-between"
                  }}>
                    <Chip icon={<CreditCardOutlinedIcon />} label={t("dashboard.payments.kindPayment")} size="small" />
                    <Typography sx={{
                      fontWeight: 700
                    }}>
                      {formatPortalCurrency(booking.total_amount)}
                    </Typography>
                  </Stack>
                  <Typography sx={{ mt: 1 }}>{t("dashboard.payments.bookingLabel", { number: booking.booking_number })}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t("dashboard.payments.awaitingPayment")}
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
                      spacing={1}
                      sx={{
                        justifyContent: "space-between"
                      }}
                    >
                      <Chip
                        icon={<TransactionIcon />}
                        label={tx.kind === "payment" ? t("dashboard.payments.kindPayment") : t("dashboard.payments.kindInvoice")}
                        size="small"
                      />
                      <Typography sx={{
                        fontWeight: 700
                      }}>
                        {formatPortalCurrency(tx.amount)}
                      </Typography>
                    </Stack>
                    <Typography sx={{ mt: 1 }}>
                      {tx.invoice_number ?? tx.reference ?? t("dashboard.payments.transactionFallback")}
                    </Typography>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {formatPortalDate(tx.date)} ·{" "}
                      {humanizePortalStatus(tx.status)}
                    </Typography>
                    {tx.booking_number ? (
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {t("dashboard.payments.bookingLabel", { number: tx.booking_number })}
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
            labelRowsPerPage={t("dashboard.pagination.rowsPerPage")}
            labelDisplayedRows={({ from, to, count }) =>
              count === -1
                ? t("dashboard.pagination.displayedRowsMore", { from, to })
                : t("dashboard.pagination.displayedRows", { from, to, count })
            }
            getItemAriaLabel={(type) =>
              t(`dashboard.pagination.${PAGINATION_ARIA_KEYS[type]}`)
            }
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
  const { t } = useTranslation("guestPortal");
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
      setError(t("dashboard.credits.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, token]);
  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label={t("dashboard.credits.loading")} />;
  if (error) return <ErrorState message={error} retry={() => void load()} />;

  const rows = credits?.credits_by_room_type ?? [];
  const total = credits?.total_nights_available ?? 0;

  return (
    <>
      <SectionHeading
        eyebrow={t("dashboard.credits.eyebrow")}
        title={t("dashboard.credits.title")}
        description={t("dashboard.credits.description")}
      />
      {rows.length === 0 ? (
        <EmptyState message={t("dashboard.credits.empty")} />
      ) : (
        <>
          <Card sx={{ mb: 3, bgcolor: "var(--hotel-surface-raised)", color: "var(--hotel-text)" }}>
            <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
              <Typography
                variant="overline"
                sx={{ color: "var(--hotel-primary)", fontWeight: 700 }}
              >
                {t("dashboard.credits.nightsAvailable")}
              </Typography>
              <Typography variant="h3" sx={{ mt: 0.5, fontWeight: 700 }}>
                {total.toLocaleString()}
              </Typography>
              <Typography sx={{ color: "var(--hotel-text-secondary)", mt: 1 }}>
                {t("dashboard.credits.acrossRoomTypes", { count: rows.length })}
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
                    {t("actions.book")}
                  </Button>
                }
                sx={{ px: 0 }}
              >
                <ListItemText
                  primary={credit.room_type_name}
                  secondary={t("dashboard.credits.roomTypeEntry", {
                    code: credit.room_type_code,
                    count: credit.nights_available,
                  })}
                  slotProps={{
                    primary: { sx: { fontWeight: 700, color: "var(--hotel-text)" } }
                  }}
                />
              </ListItem>
            ))}
          </List>
          <Alert severity="info" role="alert" sx={{ mt: 3 }}>
            {t("dashboard.credits.howTo")}
          </Alert>
        </>
      )}
    </>
  );
}

export function PointsHistorySection({ token }: { token: string }) {
  const { t } = useTranslation("guestPortal");
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
      setError(t("dashboard.points.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t, token]);
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
        eyebrow={t("dashboard.points.eyebrow")}
        title={t("dashboard.points.title")}
        description={t("dashboard.points.description")}
      />
      {member ? (
        <Card sx={{ mb: 3, bgcolor: "var(--hotel-surface-raised)", color: "var(--hotel-text)" }}>
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 7 }}>
                <Typography
                  variant="overline"
                  sx={{ color: "var(--hotel-primary)", fontWeight: 700 }}
                >
                  {t("dashboard.points.tierMember", { tier: member.tier_name })}
                </Typography>
                <Typography variant="h5" sx={{ mt: 1, fontWeight: 700 }}>
                  {member.member_number}
                </Typography>
                <Typography sx={{ color: "var(--hotel-text-secondary)", mt: 1 }}>
                  {t("dashboard.points.levelStatus", { level: member.tier_level, status: member.status })}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <Typography
                  variant="overline"
                  sx={{ color: "var(--hotel-primary)", fontWeight: 700 }}
                >
                  {t("dashboard.points.pointsAvailable")}
                </Typography>
                <Typography variant="h3" sx={{ mt: 0.5, fontWeight: 700 }}>
                  {member.points_balance.toLocaleString()}
                </Typography>
                <Typography sx={{ color: "var(--hotel-text-secondary)" }}>
                  {t("dashboard.points.lifetimePoints", { count: member.lifetime_points })}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info" role="alert" sx={{ mb: 3 }}>
          {t("dashboard.points.notEnrolled")}
        </Alert>
      )}
      {membership?.recent_activity.length ? (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ color: "var(--hotel-text)", fontWeight: 700 }}>
            {t("dashboard.points.recentActivity")}
          </Typography>
          <List>
            {membership.recent_activity.map((activity, index) => {
              const context = pointsActivityContext(activity);
              return (
                <Box key={`${activity.date}-${index}`}>
                  <ListItem disableGutters>
                    <ListItemText
                      primary={t("dashboard.points.activityLine", {
                        type: humanizePortalStatus(activity.transaction_type),
                        points: `${activity.points > 0 ? "+" : ""}${activity.points}`,
                      })}
                      secondary={
                        <Stack component="span" spacing={0.25}>
                          <Box component="span">
                            {formatPortalDate(activity.date)} · {t("dashboard.points.balanceAfter", { balance: activity.balance_after })}
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
        <EmptyState message={t("dashboard.points.empty")} />
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
  const { t } = useTranslation("guestPortal");
  if (section === "offers")
    return (
      <>
        <SectionHeading
          eyebrow={t("dashboard.offers.eyebrow")}
          title={t("dashboard.offers.title")}
          description={t("dashboard.offers.description")}
        />
        <PromotionCatalog token={token} />
      </>
    );
  if (section === "vouchers")
    return (
      <>
        <SectionHeading
          eyebrow={t("dashboard.vouchers.eyebrow")}
          title={t("dashboard.vouchers.title")}
          description={t("dashboard.vouchers.description")}
        />
        <VoucherWallet token={token} />
      </>
    );
  if (section === "support")
    return (
      <>
        <SectionHeading
          eyebrow={t("dashboard.support.eyebrow")}
          title={t("dashboard.support.title")}
          description={t("dashboard.support.description")}
        />
        <PortalSupportTab token={token} />
      </>
    );
  return (
    <>
      <SectionHeading
        eyebrow={t("dashboard.preferences.eyebrow")}
        title={t("dashboard.preferences.title")}
        description={t("dashboard.preferences.description")}
      />
      <AppearancePreferenceCard />
      <PortalNotificationPreferences token={token} />
    </>
  );
}
