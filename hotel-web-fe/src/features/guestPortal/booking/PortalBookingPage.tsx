import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HotelIcon from '@mui/icons-material/Hotel';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { useAuth } from '../../../auth/AuthContext';
import { useNavigate } from '../../../router';
import { PortalPromotionsApi } from '../../promotions/api/portalPromotionsApi';
import type { Voucher } from '../../promotions/types';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { setPortalToken } from '../api/portalTokenStore';
import { usePortalSession } from '../api/usePortalSession';
import { GuestBookingApi } from './api';
import type {
  AvailabilityEvent,
  GuestBookingConfirmation,
  GuestBookingOffer,
  GuestBookingQuote,
  GuestBookingSearch,
} from './types';
import { useAvailabilitySocket } from './useAvailabilitySocket';
import { stayOverlapsAvailabilityEvent } from './utils';

function inputDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function money(amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(Number.isFinite(value) ? value : 0);
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const PortalBookingPage: React.FC = () => {
  const navigate = useNavigate();
  const { token: storedToken } = usePortalSession();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [bootstrapToken, setBootstrapToken] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const token = storedToken ?? bootstrapToken;

  const [search, setSearch] = useState<GuestBookingSearch>({
    check_in_date: inputDate(1),
    check_out_date: inputDate(2),
    adults: 1,
    children: 0,
  });
  const [offers, setOffers] = useState<GuestBookingOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<GuestBookingOffer | null>(null);
  const [quote, setQuote] = useState<GuestBookingQuote | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [voucherId, setVoucherId] = useState<number | ''>('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [cleaningPreference, setCleaningPreference] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirmation, setConfirmation] = useState<GuestBookingConfirmation | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityLost, setAvailabilityLost] = useState(false);

  useEffect(() => {
    if (token || isLoading) return;
    if (!isAuthenticated || user?.user_type !== 'guest') {
      navigate('/login?account=guest', { replace: true });
      return;
    }
    let cancelled = false;
    void GuestPortalDashboardService.createSession()
      .then((session) => {
        if (cancelled) return;
        setPortalToken(session.token, session.expires_at);
        setBootstrapToken(session.token);
      })
      .catch((sessionError: unknown) => {
        if (!cancelled) {
          setBootstrapError(errorMessage(sessionError, 'Unable to open the guest portal.'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, navigate, token, user?.user_type]);

  useEffect(() => {
    if (!token) return;
    void PortalPromotionsApi.listVouchers({ page_size: 100 }, token)
      .then((response) => {
        setVouchers(response.items.filter((voucher) => voucher.status === 'available'));
      })
      .catch(() => setVouchers([]));
  }, [token]);

  const runSearch = useCallback(async () => {
    if (!token) return;
    setIsSearching(true);
    setError(null);
    try {
      const nextOffers = await GuestBookingApi.search(search, token);
      setOffers(nextOffers);
      if (nextOffers.length === 0) {
        setError('No room types are available for those dates and guests.');
      }
    } catch (searchError) {
      setError(errorMessage(searchError, 'Unable to search room availability.'));
      setOffers([]);
    } finally {
      setIsSearching(false);
    }
  }, [search, token]);

  const selectOffer = useCallback(async (offer: GuestBookingOffer) => {
    if (!token) return;
    setSelectedOffer(offer);
    setVoucherId('');
    setRequestId(newRequestId());
    setIsQuoting(true);
    setError(null);
    try {
      setQuote(await GuestBookingApi.quote({
        ...search,
        room_type_id: offer.room_type_id,
      }, token));
    } catch (quoteError) {
      setSelectedOffer(null);
      setError(errorMessage(quoteError, 'Unable to quote this room type.'));
    } finally {
      setIsQuoting(false);
    }
  }, [search, token]);

  const applyVoucher = useCallback(async (nextVoucherId: number | '') => {
    setVoucherId(nextVoucherId);
    if (!token || !selectedOffer) return;
    setIsQuoting(true);
    setError(null);
    try {
      setQuote(await GuestBookingApi.quote({
        ...search,
        room_type_id: selectedOffer.room_type_id,
        voucher_id: nextVoucherId === '' ? undefined : nextVoucherId,
      }, token));
      setRequestId(newRequestId());
    } catch (quoteError) {
      setVoucherId('');
      setError(errorMessage(quoteError, 'This voucher cannot be applied to the selected stay.'));
    } finally {
      setIsQuoting(false);
    }
  }, [search, selectedOffer, token]);

  const submitBooking = useCallback(async () => {
    if (!token || !quote) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await GuestBookingApi.create({
        ...search,
        room_type_id: quote.room_type_id,
        voucher_id: quote.voucher_id ?? undefined,
        client_request_id: requestId,
        expected_total: quote.total_amount,
        special_requests: specialRequests.trim() || undefined,
        cleaning_preference: cleaningPreference,
      }, token);
      setConfirmation(result);
    } catch (createError) {
      setError(errorMessage(createError, 'Unable to create the booking.'));
      try {
        setQuote(await GuestBookingApi.quote({
          ...search,
          room_type_id: quote.room_type_id,
          voucher_id: quote.voucher_id ?? undefined,
        }, token));
      } catch {
        setSelectedOffer(null);
        setQuote(null);
        setAvailabilityLost(true);
        await runSearch();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    cleaningPreference,
    quote,
    requestId,
    runSearch,
    search,
    specialRequests,
    token,
  ]);

  const handleAvailabilityChange = useCallback((event: AvailabilityEvent) => {
    if (!stayOverlapsAvailabilityEvent(event, search)) return;
    setOffers((current) => current.map((offer) => (
      offer.room_type_id === event.room_type_id
        ? { ...offer, available_rooms: event.remaining_rooms }
        : offer
    )));
    if (
      event.remaining_rooms === 0
      && selectedOffer?.room_type_id === event.room_type_id
      && !isSubmitting
      && !confirmation
    ) {
      setSelectedOffer(null);
      setQuote(null);
      setAvailabilityLost(true);
      void runSearch();
    }
  }, [confirmation, isSubmitting, runSearch, search, selectedOffer?.room_type_id]);

  useAvailabilitySocket(token, handleAvailabilityChange);

  const selectedVoucher = useMemo(
    () => vouchers.find((voucher) => voucher.id === voucherId),
    [voucherId, vouchers],
  );

  if (!token) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        {bootstrapError
          ? <Alert severity="error">{bootstrapError}</Alert>
          : <Stack direction="row" justifyContent="center" spacing={2}>
              <CircularProgress size={24} />
              <Typography>Opening your guest portal…</Typography>
            </Stack>}
      </Container>
    );
  }

  if (confirmation) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />
          <Typography variant="h4" sx={{ mt: 2 }}>Booking confirmed</Typography>
          <Typography variant="h6" color="primary" sx={{ mt: 1 }}>
            {confirmation.booking_number}
          </Typography>
          <Typography sx={{ mt: 2 }}>{confirmation.room_type_name}</Typography>
          <Typography color="text.secondary">
            {confirmation.check_in_date} to {confirmation.check_out_date}
          </Typography>
          <Typography variant="h5" sx={{ mt: 2 }}>
            {money(confirmation.total_amount, confirmation.currency)}
          </Typography>
          <Alert severity="info" sx={{ mt: 3, textAlign: 'left' }}>
            Your room is reserved. Payment is due at the hotel.
          </Alert>
          <Button sx={{ mt: 3 }} variant="contained" onClick={() => navigate('/portal')}>
            View my bookings
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/portal')} sx={{ mb: 2 }}>
        Back to my account
      </Button>
      <Typography variant="h3" component="h1">Book a room</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Search live availability and reserve directly with the hotel.
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Check-in"
              type="date"
              fullWidth
              value={search.check_in_date}
              onChange={(event) => setSearch((current) => ({
                ...current,
                check_in_date: event.target.value,
              }))}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: inputDate(0) } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Check-out"
              type="date"
              fullWidth
              value={search.check_out_date}
              onChange={(event) => setSearch((current) => ({
                ...current,
                check_out_date: event.target.value,
              }))}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: search.check_in_date } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField
              label="Adults"
              type="number"
              fullWidth
              value={search.adults}
              onChange={(event) => setSearch((current) => ({
                ...current,
                adults: Number(event.target.value),
              }))}
              slotProps={{ htmlInput: { min: 1, max: 20 } }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField
              label="Children"
              type="number"
              fullWidth
              value={search.children}
              onChange={(event) => setSearch((current) => ({
                ...current,
                children: Number(event.target.value),
              }))}
              slotProps={{ htmlInput: { min: 0, max: 20 } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 2 }}>
            <Button
              variant="contained"
              fullWidth
              size="large"
              disabled={isSearching}
              onClick={() => {
                setSelectedOffer(null);
                setQuote(null);
                void runSearch();
              }}
            >
              {isSearching ? <CircularProgress size={22} /> : 'Search'}
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {!selectedOffer && offers.length > 0 && (
        <Grid container spacing={3}>
          {offers.map((offer) => (
            <Grid key={offer.room_type_id} size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="h5">{offer.room_type_name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {offer.room_type_code} · Up to {offer.max_occupancy} guests
                      </Typography>
                    </Box>
                    <Chip
                      color={offer.available_rooms <= 1 ? 'warning' : 'success'}
                      label={`${offer.available_rooms} left`}
                    />
                  </Stack>
                  {offer.description && <Typography sx={{ mt: 2 }}>{offer.description}</Typography>}
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
                    {offer.bed_type && <Chip size="small" label={offer.bed_type} />}
                    {offer.features.slice(0, 4).map((feature) => (
                      <Chip key={feature} size="small" variant="outlined" label={feature} />
                    ))}
                  </Stack>
                  <Divider sx={{ my: 2 }} />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="caption" color="text.secondary">Stay total</Typography>
                      <Typography variant="h5">{money(offer.total_amount, offer.currency)}</Typography>
                    </Box>
                    <Button
                      variant="contained"
                      startIcon={<HotelIcon />}
                      onClick={() => void selectOffer(offer)}
                    >
                      Select
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {selectedOffer && (
        <Paper sx={{ p: 3 }}>
          {isQuoting || !quote ? (
            <Stack direction="row" spacing={2} justifyContent="center">
              <CircularProgress size={24} />
              <Typography>Confirming the latest price…</Typography>
            </Stack>
          ) : (
            <Grid container spacing={4}>
              <Grid size={{ xs: 12, md: 7 }}>
                <Typography variant="h5">Review your stay</Typography>
                <Typography sx={{ mt: 1 }}>{quote.room_type_name}</Typography>
                <Typography color="text.secondary">
                  {quote.check_in_date} to {quote.check_out_date} · {quote.adults} adults
                  {quote.children > 0 ? ` · ${quote.children} children` : ''}
                </Typography>
                <FormControl fullWidth sx={{ mt: 3 }}>
                  <InputLabel id="voucher-label">Voucher</InputLabel>
                  <Select
                    labelId="voucher-label"
                    label="Voucher"
                    value={voucherId}
                    onChange={(event) => {
                      const value = String(event.target.value);
                      void applyVoucher(value === '' ? '' : Number(value));
                    }}
                  >
                    <MenuItem value="">No voucher</MenuItem>
                    {vouchers.map((voucher) => (
                      <MenuItem key={voucher.id} value={voucher.id}>
                        {voucher.promotion_name} ({voucher.code ?? voucher.code_masked})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {selectedVoucher && quote.voucher_name && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    {quote.voucher_name} has been applied.
                  </Alert>
                )}
                <TextField
                  label="Special requests"
                  value={specialRequests}
                  onChange={(event) => setSpecialRequests(event.target.value)}
                  fullWidth
                  multiline
                  minRows={3}
                  inputProps={{ maxLength: 1000 }}
                  sx={{ mt: 3 }}
                />
                <FormControlLabel
                  sx={{ mt: 1 }}
                  control={(
                    <Checkbox
                      checked={cleaningPreference}
                      onChange={(event) => setCleaningPreference(event.target.checked)}
                    />
                  )}
                  label="I would like daily room cleaning"
                />
              </Grid>
              <Grid size={{ xs: 12, md: 5 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="h6">Price summary</Typography>
                    {quote.nightly_rates.map((rate) => (
                      <Stack key={rate.date} direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                        <Typography variant="body2">{rate.date}</Typography>
                        <Typography variant="body2">{money(rate.amount, quote.currency)}</Typography>
                      </Stack>
                    ))}
                    <Divider sx={{ my: 2 }} />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography>Subtotal</Typography>
                      <Typography>{money(quote.subtotal, quote.currency)}</Typography>
                    </Stack>
                    {Number(quote.discount_amount) > 0 && (
                      <Stack direction="row" justifyContent="space-between" color="success.main">
                        <Typography>Discount</Typography>
                        <Typography>-{money(quote.discount_amount, quote.currency)}</Typography>
                      </Stack>
                    )}
                    <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                      <Typography variant="h6">Total</Typography>
                      <Typography variant="h6">{money(quote.total_amount, quote.currency)}</Typography>
                    </Stack>
                    <Alert severity="info" sx={{ mt: 2 }}>Payment is due at the hotel.</Alert>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 3 }}>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setSelectedOffer(null);
                          setQuote(null);
                        }}
                      >
                        Change room
                      </Button>
                      <Button
                        variant="contained"
                        disabled={isSubmitting}
                        onClick={() => void submitBooking()}
                      >
                        {isSubmitting ? <CircularProgress size={22} /> : 'Confirm booking'}
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}
        </Paper>
      )}

      <Dialog open={availabilityLost} onClose={() => setAvailabilityLost(false)}>
        <DialogTitle>This room was just booked</DialogTitle>
        <DialogContent>
          <Typography>
            Another guest took the last room of this type while you were reviewing your booking.
            We refreshed the available options for you.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setAvailabilityLost(false)}>
            View available rooms
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default PortalBookingPage;
