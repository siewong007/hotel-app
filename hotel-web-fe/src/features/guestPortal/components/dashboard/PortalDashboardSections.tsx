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
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
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
import { PromotionCatalog, VoucherWallet } from "../../../promotions";
import PortalNotificationPreferences from "../../../communications/components/PortalNotificationPreferences";
import { PortalSupportTab } from "../PortalSupportTab";
import type {
  GuestPortalBenefitsResponse,
  GuestPortalBookingSummary,
  GuestPortalMeResponse,
  GuestPortalMembershipResponse,
  GuestPortalTransaction,
} from "../../../../types";
import {
  firstName,
  formatPortalCurrency,
  formatPortalDate,
  humanizePortalStatus,
  type PortalSection,
} from "./dashboardUtils";

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const FOREST = "#06110e";
const GOLD = "#d9b572";

function LoadingState({ label = "Loading your details…" }: { label?: string }) {
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

function ErrorState({
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

function EmptyState({ message }: { message: string }) {
  return (
    <Box sx={{ py: 6, textAlign: "center" }}>
      <Typography color="text.secondary">{message}</Typography>
    </Box>
  );
}

function SectionHeading({
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
        Cancellation unavailable
      </Typography>
      <Typography id={reasonId} variant="caption" color="text.secondary">
        {reason}
      </Typography>
    </Box>
  );
}

function CancelBookingDialog({
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
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [booking?.id, open]);

  if (!booking) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onConfirm(reason.trim());
  };

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="xs"
      aria-describedby="cancel-booking-details"
      transitionDuration={
        prefersReducedMotion ? 0 : { enter: 180, exit: 140 }
      }
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: 3 } } }}
    >
      <Box component="form" onSubmit={(event) => void handleSubmit(event)}>
        <DialogTitle sx={{ color: FOREST, fontWeight: 700 }}>
          Cancel booking {booking.booking_number}?
        </DialogTitle>
        <DialogContent>
          <Typography id="cancel-booking-details" color="text.secondary">
            {formatPortalDate(booking.check_in_date)} —{" "}
            {formatPortalDate(booking.check_out_date)} ·{" "}
            {formatPortalCurrency(booking.total_amount)}
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            This action cannot be undone online.
          </Alert>
          {error ? (
            <Alert severity="error" role="alert" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            inputProps={{
              "aria-label": "Reason for cancellation (optional)",
              maxLength: 1000,
            }}
            helperText={`${1000 - reason.length} characters remaining`}
            disabled={isSubmitting}
            sx={{ mt: 2 }}
          />
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
            disabled={isSubmitting}
            sx={{ minHeight: 44 }}
            startIcon={
              isSubmitting ? (
                <CircularProgress size={18} color="inherit" />
              ) : undefined
            }
          >
            {isSubmitting ? "Cancelling…" : "Cancel booking"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function OverviewSection({
  token,
  onSectionChange,
  onBook,
}: {
  token: string;
  onSectionChange: (section: PortalSection) => void;
  onBook: () => void;
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
              <Button
                endIcon={<EastOutlinedIcon />}
                onClick={nextStay ? () => onSectionChange("stays") : onBook}
                sx={{
                  color: "white",
                  mt: 3,
                  px: 0,
                  "&:hover": { bgcolor: "transparent", color: GOLD },
                }}
              >
                {nextStay ? "View my stays" : "Book a stay"}
              </Button>
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
                    Member rewards
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
                onClick={() => onSectionChange("rewards")}
                sx={{
                  color: FOREST,
                  mt: 3,
                  px: 0,
                  "&:hover": { bgcolor: "transparent", color: "#8d6b30" },
                }}
              >
                Explore rewards
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
              Search live availability, or browse an offer before you book.
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button
              variant="outlined"
              onClick={() => onSectionChange("offers")}
            >
              View offers
            </Button>
            <Button
              variant="contained"
              onClick={onBook}
              sx={{
                bgcolor: GOLD,
                color: FOREST,
                fontWeight: 700,
                "&:hover": { bgcolor: "#e4c487" },
              }}
            >
              Book a stay
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Stack>
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
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationSuccess, setCancellationSuccess] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await GuestPortalDashboardService.bookings(
        { page: page + 1, per_page: pageSize },
        token,
      );
      setItems(response.items);
      setTotal(response.total);
    } catch {
      setError("Unable to load your bookings right now.");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, token]);
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
      setCancellationSuccess(`Booking ${bookingToCancel.booking_number} was cancelled.`);
      setBookingToCancel(null);
      void load();
    } catch (caught) {
      setCancellationError(
        caught instanceof Error
          ? caught.message
          : "Unable to cancel this booking.",
      );
      if (caught instanceof HTTPError && caught.response.status === 409) {
        void load();
      }
    } finally {
      setIsCancelling(false);
    }
  };
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
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState message="You have no bookings on file yet." />
      ) : (
        <>
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
                {items.map((booking) => (
                  <TableRow key={booking.booking_number} hover>
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
                      <Chip
                        label={humanizePortalStatus(booking.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      {formatPortalCurrency(booking.total_amount)}
                    </TableCell>
                    <TableCell align="right">
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
                          Cancel
                        </Button>
                      ) : (
                        <CancellationUnavailable
                          booking={booking}
                          suffix="desktop"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" } }}>
            {items.map((booking) => (
              <Card key={booking.booking_number} variant="outlined">
                <CardContent>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Typography fontWeight={700}>
                      {booking.booking_number}
                    </Typography>
                    <Chip
                      label={humanizePortalStatus(booking.status)}
                      size="small"
                    />
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
                      Cancel booking
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
            ))}
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
          <CancelBookingDialog
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
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <SectionHeading
        eyebrow="Account activity"
        title="Payments & invoices"
        description="A record of payments and invoices from your stays."
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : items.length === 0 ? (
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

export function RewardsSection({ token }: { token: string }) {
  const [membership, setMembership] =
    useState<GuestPortalMembershipResponse | null>(null);
  const [benefits, setBenefits] = useState<GuestPortalBenefitsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [membershipResult, benefitsResult] = await Promise.all([
        GuestPortalDashboardService.membership(token),
        GuestPortalDashboardService.benefits(token),
      ]);
      setMembership(membershipResult);
      setBenefits(benefitsResult);
    } catch {
      setError("Unable to load your rewards right now.");
    } finally {
      setLoading(false);
    }
  }, [token]);
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
        title="Rewards"
        description="Your membership, eligible benefits, and available rewards."
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
      <Grid container spacing={2}>
        {benefits?.tier_benefits.map((benefit) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={benefit.tier_name}>
            <Card variant="outlined">
              <CardContent>
                <Typography color="text.secondary" variant="body2">
                  {benefit.tier_name} benefit
                </Typography>
                <Typography
                  variant="h5"
                  sx={{ color: FOREST, fontWeight: 700, mt: 1 }}
                >
                  {benefit.discount_percentage}% off
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      {benefits?.rewards.length ? (
        <Box sx={{ mt: 4 }}>
          <Typography
            variant="h6"
            sx={{ color: FOREST, fontWeight: 700, mb: 2 }}
          >
            Available rewards
          </Typography>
          <Grid container spacing={2}>
            {benefits.rewards.map((reward) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={reward.id}>
                <Card
                  variant="outlined"
                  sx={{ height: "100%", opacity: reward.affordable ? 1 : 0.68 }}
                >
                  <CardContent>
                    <Typography fontWeight={700}>{reward.name}</Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {reward.description}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                      <Chip label={reward.category} size="small" />
                      <Chip
                        label={`${reward.points_required.toLocaleString()} pts`}
                        color={reward.affordable ? "success" : "default"}
                        size="small"
                      />
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 2 }}
                    >
                      {reward.affordable
                        ? "Redemption is not available in the guest portal yet."
                        : "You need more points to unlock this reward."}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      ) : null}
      {membership?.recent_activity.length ? (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" sx={{ color: FOREST, fontWeight: 700 }}>
            Recent points activity
          </Typography>
          <List>
            {membership.recent_activity.map((activity, index) => (
              <Box key={`${activity.date}-${index}`}>
                <ListItem disableGutters>
                  <ListItemText
                    primary={`${activity.transaction_type} · ${activity.points > 0 ? "+" : ""}${activity.points} points`}
                    secondary={`${formatPortalDate(activity.date)} · Balance ${activity.balance_after.toLocaleString()}`}
                  />
                </ListItem>
                {index < membership.recent_activity.length - 1 ? (
                  <Divider />
                ) : null}
              </Box>
            ))}
          </List>
        </Box>
      ) : null}
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
