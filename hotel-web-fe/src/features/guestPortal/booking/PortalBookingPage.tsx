import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HotelIcon from '@mui/icons-material/Hotel';
import KingBedOutlinedIcon from '@mui/icons-material/KingBedOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutlined';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Collapse,
  Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  FormControlLabel, Grid, InputLabel, MenuItem, Paper, Select, Stack, Step, StepLabel,
  Stepper, TextField, Typography, useMediaQuery,
} from '@mui/material';

import { Navigate, useNavigate } from '../../../router';
import { PortalPromotionsApi } from '../../promotions/api/portalPromotionsApi';
import type { Voucher } from '../../promotions/types';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { GuestPaymentPanel } from '../components/GuestPaymentPanel';
import { HTTPError } from 'ky';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { GuestBookingApi, PublicBookingApi } from './api';
import type { AnonymousGuestDetails, AvailabilityEvent, GuestBookingConfirmation, GuestBookingOffer, GuestBookingQuote, GuestBookingSearch } from './types';
import type { PaymentActionResponse } from '../../../types';
import { calendarDateInput, countStayNights, shouldInterruptSelectedOffer, stayOverlapsAvailabilityEvent, validateGuestBookingSearch } from './utils';
import { useAvailabilitySocket } from './useAvailabilitySocket';

const STEPS = ['Search', 'Choose', 'Review', 'Payment'];
const EMPTY_GUEST_DETAILS: AnonymousGuestDetails = {
  first_name: '', last_name: '', email: '', phone: '', tourism_type: '',
};

/** Client-side check only; the server validates these again and is authoritative. */
function guestDetailsError(details: AnonymousGuestDetails): string | null {
  if (!details.first_name.trim()) return 'Please enter the guest first name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) return 'Please enter a valid email address. Your confirmation is sent there.';
  // Tourism type decides whether tourism tax applies, so it is never defaulted.
  if (details.tourism_type !== 'local' && details.tourism_type !== 'foreign') return 'Please select whether the guest is a local or foreign tourist.';
  return null;
}
const FALLBACK_ROOM_IMAGE = 'linear-gradient(135deg, #173B31 0%, #315E50 55%, #C7A45B 160%)';

function money(amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number.isFinite(value) ? value : 0);
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function voucherStayEligibilityKey(voucherId: number, roomTypeId: number, search: GuestBookingSearch): string {
  return [voucherId, roomTypeId, search.check_in_date, search.check_out_date, search.adults, search.children].join(':');
}

function isVoucherEligibilityError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('voucher is not eligible');
}

const COMPLETE_PROFILE_REDIRECT = '/complete-profile?redirect=%2Fportal%2Fbook';

// The backend re-checks completion at booking-creation time (`ApiError::ProfileIncomplete`,
// 422 `code: "profile_incomplete"`) in case it changed after this page loaded. Detect that
// exact shape rather than matching on the generic error message text.
async function readProfileIncompleteFields(error: unknown): Promise<string[] | null> {
  if (!(error instanceof HTTPError) || error.response.status !== 422) return null;
  const body = await error.response.json().catch(() => null);
  if (!body || typeof body !== 'object' || (body as { code?: unknown }).code !== 'profile_incomplete') {
    return null;
  }
  const missing = (body as { missing_profile_fields?: unknown }).missing_profile_fields;
  return Array.isArray(missing) ? missing.filter((field): field is string => typeof field === 'string') : [];
}

function offerImage(offer: GuestBookingOffer): string | null {
  return offer.images?.find((image) => typeof image === 'string' && image.trim().length > 0) ?? null;
}

const PortalBookingPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, status: sessionStatus, error: sessionError, canRetry, needsLogin, isStaffAccount, retry, restartSignIn } = usePortalSessionBootstrap();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [search, setSearch] = useState<GuestBookingSearch>({ check_in_date: calendarDateInput(1), check_out_date: calendarDateInput(2), adults: 1, children: 0 });
  const [offers, setOffers] = useState<GuestBookingOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<GuestBookingOffer | null>(null);
  const [quote, setQuote] = useState<GuestBookingQuote | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [voucherId, setVoucherId] = useState<number | ''>('');
  const [eligibleVoucherIds, setEligibleVoucherIds] = useState<Set<number>>(() => new Set());
  const [ineligibleVoucherKeys, setIneligibleVoucherKeys] = useState<Set<string>>(() => new Set());
  const [complimentaryDates, setComplimentaryDates] = useState<string[]>([]);
  const [specialRequests, setSpecialRequests] = useState('');
  const [cleaningPreference, setCleaningPreference] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirmation, setConfirmation] = useState<GuestBookingConfirmation | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityLost, setAvailabilityLost] = useState(false);
  // Default to complete: a portal backend that predates this field, or a
  // transient fetch failure, must never trap the guest in a completion loop.
  // The backend booking guard (`ApiError::ProfileIncomplete`) remains
  // authoritative regardless of this client-side value.
  const [profileComplete, setProfileComplete] = useState(true);
  const [guestDetails, setGuestDetails] = useState<AnonymousGuestDetails>(EMPTY_GUEST_DETAILS);

  // A visitor with no account books anonymously instead of being bounced to a
  // sign-up form — that detour is what made booking unreachable from the public
  // site. `needsLogin` is specifically "the session exchange finished and found
  // no account", as opposed to still checking or having failed part-way, which
  // still belong on the session gate below.
  const isAnonymous = !token && needsLogin;
  const canQuery = Boolean(token) || isAnonymous;

  useEffect(() => {
    if (!token) return;
    void PortalPromotionsApi.listVouchers({ page_size: 100 }, token)
      .then((response) => setVouchers(response.items.filter((voucher) => voucher.status === 'available')))
      .catch(() => setVouchers([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void GuestPortalDashboardService.me(token)
      .then((me) => { if (!cancelled) setProfileComplete(me.profile_complete ?? true); })
      .catch(() => { if (!cancelled) setProfileComplete(true); });
    return () => { cancelled = true; };
  }, [token]);

  const runSearch = useCallback(async () => {
    if (!canQuery) return;
    const validationError = validateGuestBookingSearch(search);
    if (validationError) { setError(validationError); return; }
    setIsSearching(true); setError(null); setOffers([]);
    try {
      const nextOffers = token
        ? await GuestBookingApi.search(search, token)
        : await PublicBookingApi.search(search);
      setOffers(nextOffers);
      if (nextOffers.length === 0) setError('No room types are available for those dates and guests.');
    } catch (searchError) {
      setError(errorMessage(searchError, 'Unable to search room availability.'));
      setOffers([]);
    } finally { setIsSearching(false); }
  }, [canQuery, search, token]);

  const selectOffer = useCallback(async (offer: GuestBookingOffer) => {
    if (!canQuery) return;
    setSelectedOffer(offer); setVoucherId(''); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); setRequestId(newRequestId()); setIsQuoting(true); setError(null);
    try {
      if (token) {
        const voucherOptions = await GuestBookingApi.voucherOptions(
          { ...search, room_type_id: offer.room_type_id },
          token,
        );
        setQuote(voucherOptions.quote);
        setEligibleVoucherIds(new Set(voucherOptions.eligible_voucher_ids));
      } else {
        // No account, so no voucher eligibility to resolve — just the price.
        setQuote(await PublicBookingApi.quote({ ...search, room_type_id: offer.room_type_id }));
      }
    }
    catch (quoteError) { setSelectedOffer(null); setError(errorMessage(quoteError, 'Unable to quote this room type.')); }
    finally { setIsQuoting(false); }
  }, [canQuery, search, token]);

  const applyVoucher = useCallback(async (nextVoucherId: number | '') => {
    if (nextVoucherId !== '' && !eligibleVoucherIds.has(nextVoucherId)) return;
    const eligibilityKey = nextVoucherId === '' || !selectedOffer ? null : voucherStayEligibilityKey(nextVoucherId, selectedOffer.room_type_id, search);
    if (eligibilityKey && ineligibleVoucherKeys.has(eligibilityKey)) return;
    setVoucherId(nextVoucherId);
    if (!token || !selectedOffer) return;
    setIsQuoting(true); setError(null);
    try {
      setQuote(await GuestBookingApi.quote({ ...search, room_type_id: selectedOffer.room_type_id, voucher_id: nextVoucherId === '' ? undefined : nextVoucherId, complimentary_dates: complimentaryDates }, token));
      setRequestId(newRequestId());
    } catch (quoteError) {
      if (eligibilityKey && isVoucherEligibilityError(quoteError)) {
        setIneligibleVoucherKeys((current) => new Set(current).add(eligibilityKey));
        setEligibleVoucherIds((current) => {
          const next = new Set(current);
          if (nextVoucherId !== '') next.delete(nextVoucherId);
          return next;
        });
      }
      setVoucherId('');
      setError(errorMessage(quoteError, 'This voucher cannot be applied to the selected stay.'));
    } finally { setIsQuoting(false); }
  }, [complimentaryDates, eligibleVoucherIds, ineligibleVoucherKeys, search, selectedOffer, token]);

  // Complimentary nights are re-priced server-side on every toggle: the credit
  // is worth exactly the rate of the night it is spent on, so the guest sees
  // the real total before committing.
  const applyComplimentaryDates = useCallback(async (nextDates: string[]) => {
    if (!token || !selectedOffer) return;
    const previousDates = complimentaryDates;
    setComplimentaryDates(nextDates);
    setIsQuoting(true); setError(null);
    try {
      setQuote(await GuestBookingApi.quote({ ...search, room_type_id: selectedOffer.room_type_id, voucher_id: voucherId === '' ? undefined : voucherId, complimentary_dates: nextDates }, token));
      setRequestId(newRequestId());
    } catch (quoteError) {
      setComplimentaryDates(previousDates);
      setError(errorMessage(quoteError, 'Unable to apply your complimentary nights to this stay.'));
    } finally { setIsQuoting(false); }
  }, [complimentaryDates, search, selectedOffer, token, voucherId]);

  const submitAnonymousBooking = useCallback(async () => {
    if (!quote) return;
    const detailsError = guestDetailsError(guestDetails);
    if (detailsError) { setError(detailsError); return; }
    setIsSubmitting(true); setError(null);
    try {
      const result = await PublicBookingApi.create({
        ...search,
        room_type_id: quote.room_type_id,
        client_request_id: requestId,
        expected_total: quote.total_amount,
        special_requests: specialRequests.trim() || undefined,
        cleaning_preference: cleaningPreference,
        guest: {
          first_name: guestDetails.first_name.trim(),
          last_name: guestDetails.last_name?.trim() || undefined,
          email: guestDetails.email.trim(),
          phone: guestDetails.phone?.trim() || undefined,
          tourism_type: guestDetails.tourism_type,
        },
      });
      setConfirmation(result);
    } catch (createError) {
      setError(errorMessage(createError, 'Unable to create the booking.'));
      // Re-price so the guest is never left looking at a total the server has
      // moved on from; if the room itself is gone, fall back to a fresh search.
      try { setQuote(await PublicBookingApi.quote({ ...search, room_type_id: quote.room_type_id })); }
      catch { setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); await runSearch(); }
    } finally { setIsSubmitting(false); }
  }, [cleaningPreference, guestDetails, quote, requestId, runSearch, search, specialRequests]);

  const submitBooking = useCallback(async () => {
    if (!quote) return;
    if (isAnonymous) { await submitAnonymousBooking(); return; }
    if (!token) return;
    // Usability guard only — the backend re-checks and is authoritative (see
    // the 422 profile_incomplete handling below for the race where completion
    // changed after this page loaded).
    if (!profileComplete) {
      navigate(COMPLETE_PROFILE_REDIRECT);
      return;
    }
    setIsSubmitting(true); setError(null);
    try {
      // Submit the nights the server itself priced, so what is booked is
      // exactly what the guest just reviewed.
      const result = await GuestBookingApi.create({ ...search, room_type_id: quote.room_type_id, voucher_id: quote.voucher_id ?? undefined, complimentary_dates: quote.complimentary_dates, client_request_id: requestId, expected_total: quote.total_amount, special_requests: specialRequests.trim() || undefined, cleaning_preference: cleaningPreference }, token);
      setConfirmation(result);
    } catch (createError) {
      const missingFields = await readProfileIncompleteFields(createError);
      if (missingFields) {
        setProfileComplete(false);
        navigate(COMPLETE_PROFILE_REDIRECT);
        return;
      }
      setError(errorMessage(createError, 'Unable to create the booking.'));
      try { setQuote(await GuestBookingApi.quote({ ...search, room_type_id: quote.room_type_id, voucher_id: quote.voucher_id ?? undefined, complimentary_dates: quote.complimentary_dates }, token)); }
      catch { setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); await runSearch(); }
    } finally { setIsSubmitting(false); }
  }, [cleaningPreference, isAnonymous, navigate, profileComplete, quote, requestId, runSearch, search, specialRequests, submitAnonymousBooking, token]);

  const handleAvailabilityChange = useCallback((event: AvailabilityEvent) => {
    if (!stayOverlapsAvailabilityEvent(event, search)) return;
    if (event.room_type_id !== null && event.remaining_rooms !== null) setOffers((current) => current.map((offer) => offer.room_type_id === event.room_type_id ? { ...offer, available_rooms: event.remaining_rooms ?? offer.available_rooms } : offer));
    if (shouldInterruptSelectedOffer(event, search, selectedOffer?.room_type_id ?? null) && !isSubmitting && !confirmation) {
      setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); void runSearch();
    }
  }, [confirmation, isSubmitting, runSearch, search, selectedOffer?.room_type_id]);
  useAvailabilitySocket(token, handleAvailabilityChange);

  const selectedVoucher = useMemo(() => vouchers.find((voucher) => voucher.id === voucherId), [voucherId, vouchers]);
  const activeStep = confirmation ? 3 : quote || selectedOffer ? 2 : offers.length > 0 ? 1 : 0;
  const animationTimeout = reducedMotion ? 0 : 200;

  if (isStaffAccount) return <Navigate to="/admin-portal" replace />;
  // Only gate when an account session is genuinely mid-flight or broken. A
  // visitor with no account at all falls through to the anonymous flow.
  if (!token && !isAnonymous) return <SessionGate error={sessionError} status={sessionStatus} canRetry={canRetry} onRetry={retry} onRestart={restartSignIn} />;
  if (confirmation) return <ConfirmationStage confirmation={confirmation} token={token ?? confirmation.access_token ?? null} paymentMode={token ? 'session' : 'token'} isAnonymous={isAnonymous} onStays={() => navigate(isAnonymous ? '/salim-inn/index.html' : '/guest-portal?section=stays')} onAnother={() => { setConfirmation(null); setSelectedOffer(null); setQuote(null); setOffers([]); setVoucherId(''); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); setSpecialRequests(''); setCleaningPreference(false); setRequestId(newRequestId()); }} />;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      {isAnonymous
        ? <Button startIcon={<ArrowBackIcon />} href="/salim-inn/index.html" sx={{ mb: 2 }}>Back to the hotel</Button>
        : <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/guest-portal')} sx={{ mb: 2 }}>Back to my account</Button>}
      <Typography variant="h3" component="h1">Reserve your stay</Typography>
      <Typography
        sx={{
          color: "text.secondary",
          mt: 1,
          mb: 3
        }}>Live availability, clear pricing, and secure payment after your booking request.</Typography>
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: { xs: 3, md: 4 }, '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.8125rem' } } }}>
        {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      <SearchStage search={search} isSearching={isSearching} onChange={setSearch} onSearch={() => { setSelectedOffer(null); setQuote(null); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); void runSearch(); }} />
      <Collapse in={Boolean(error)} timeout={animationTimeout}><Box sx={{ mt: 2 }}>{error && <Alert severity="error">{error}</Alert>}</Box></Collapse>
      <Collapse in={!selectedOffer && offers.length > 0} timeout={animationTimeout} unmountOnExit>
        <Box sx={{ mt: 3 }}><Typography variant="h5" sx={{ mb: 2 }}>Choose your room</Typography><Grid container spacing={3}>{offers.map((offer) => <Grid key={offer.room_type_id} size={{ xs: 12, md: 6 }}><OfferCard offer={offer} onSelect={() => void selectOffer(offer)} /></Grid>)}</Grid></Box>
      </Collapse>
      <Collapse in={Boolean(selectedOffer)} timeout={animationTimeout} unmountOnExit>
        <Box sx={{ mt: 3 }}>{isQuoting || !quote ? <LoadingQuote /> : <ReviewStage isAnonymous={isAnonymous} guestDetails={guestDetails} onGuestDetails={setGuestDetails} quote={quote} search={search} vouchers={vouchers} voucherId={voucherId} selectedOffer={selectedOffer!} selectedVoucher={selectedVoucher} eligibleVoucherIds={eligibleVoucherIds} ineligibleVoucherKeys={ineligibleVoucherKeys} specialRequests={specialRequests} cleaningPreference={cleaningPreference} isSubmitting={isSubmitting} onVoucher={(value) => void applyVoucher(value)} onComplimentaryDates={(value) => void applyComplimentaryDates(value)} onRequests={setSpecialRequests} onCleaning={setCleaningPreference} onBack={() => { setSelectedOffer(null); setQuote(null); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); }} onConfirm={() => void submitBooking()} />}</Box>
      </Collapse>
      <Dialog open={availabilityLost} onClose={() => setAvailabilityLost(false)}><DialogTitle>Room availability changed</DialogTitle><DialogContent><Typography>This room or its online availability changed while you were reviewing. We refreshed the options and cleared the previous quote so you can choose from the latest availability.</Typography></DialogContent><DialogActions><Button variant="contained" onClick={() => setAvailabilityLost(false)}>View available rooms</Button></DialogActions></Dialog>
    </Container>
  );
};

function SessionGate({ error, status, canRetry, onRetry, onRestart }: { error: string | null; status: string; canRetry: boolean; onRetry: () => void; onRestart: () => void }) {
  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>{error ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={canRetry ? onRetry : onRestart}>{canRetry ? 'Retry' : 'Sign in again'}</Button>}>{error}</Alert> : <Stack direction="row" spacing={2} sx={{
      justifyContent: "center"
    }}><CircularProgress size={24} /><Typography>{status === 'checking-account' ? 'Checking your account session…' : 'Opening your guest portal…'}</Typography></Stack>}</Container>
  );
}

function SearchStage({ search, isSearching, onChange, onSearch }: { search: GuestBookingSearch; isSearching: boolean; onChange: React.Dispatch<React.SetStateAction<GuestBookingSearch>>; onSearch: () => void }) {
  const nights = countStayNights(search);
  return (
    <Paper component="section" aria-labelledby="booking-search-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}><Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{
        justifyContent: "space-between",
        mb: 2
      }}><Box><Typography id="booking-search-heading" variant="h5">Search</Typography><Typography
      variant="body2"
      sx={{
        color: "text.secondary",
        mt: 0.5
      }}>Choose a check-in within three months and a stay of up to 30 nights.</Typography></Box>{nights > 0 ? <Chip label={`${nights} night${nights === 1 ? '' : 's'}`} size="small" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} /> : null}</Stack><Grid container spacing={2} sx={{
      alignItems: "center"
    }}><Grid size={{ xs: 12, sm: 3 }}><TextField label="Check-in" type="date" fullWidth value={search.check_in_date} onChange={(event) => onChange((current) => ({ ...current, check_in_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: calendarDateInput(0) } }} /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField label="Check-out" type="date" fullWidth value={search.check_out_date} onChange={(event) => onChange((current) => ({ ...current, check_out_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: search.check_in_date } }} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField label="Adults" type="number" fullWidth value={search.adults} onChange={(event) => onChange((current) => ({ ...current, adults: Number(event.target.value) }))} slotProps={{ htmlInput: { min: 1, max: 20 } }} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField label="Children" type="number" fullWidth value={search.children} onChange={(event) => onChange((current) => ({ ...current, children: Number(event.target.value) }))} slotProps={{ htmlInput: { min: 0, max: 20 } }} /></Grid><Grid size={{ xs: 12, sm: 2 }}><Button variant="contained" fullWidth size="large" disabled={isSearching} onClick={onSearch}>{isSearching ? <CircularProgress size={22} color="inherit" /> : 'Search'}</Button></Grid></Grid></Paper>
  );
}

function OfferCard({ offer, onSelect }: { offer: GuestBookingOffer; onSelect: () => void }) {
  const image = offerImage(offer);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(image && !imageFailed);
  const roomsLabel = offer.available_rooms === 1 ? '1 room left' : `${offer.available_rooms} rooms left`;
  return (
    <Card component="article" variant="outlined" sx={{ height: '100%', overflow: 'hidden', transition: 'transform 200ms ease, box-shadow 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 } }}>{shouldShowImage ? <Box component="img" src={image!} alt={`${offer.room_type_name} room`} onError={() => setImageFailed(true)} sx={{ display: 'block', width: '100%', height: 176, objectFit: 'cover', bgcolor: '#173B31' }} /> : <Box aria-hidden="true" sx={{ height: 176, background: FALLBACK_ROOM_IMAGE, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.9)' }}><HotelIcon sx={{ fontSize: 48 }} /></Box>}<CardContent sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 176px)' }}><Stack direction="row" spacing={2} sx={{
      justifyContent: "space-between"
    }}><Box><Typography variant="h5">{offer.room_type_name}</Typography><Typography variant="body2" sx={{
      color: "text.secondary"
    }}>{offer.room_type_code}</Typography></Box><Chip color={offer.available_rooms <= 1 ? 'warning' : 'success'} label={roomsLabel} /></Stack>{offer.description && <Typography sx={{ mt: 2 }}>{offer.description}</Typography>}<Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{
        flexWrap: "wrap",
        mt: 2
      }}><Chip size="small" icon={<PeopleOutlineIcon />} label={`Up to ${offer.max_occupancy} guests`} />{offer.bed_type && <Chip size="small" icon={<KingBedOutlinedIcon />} label={`${offer.bed_count ? `${offer.bed_count} ` : ''}${offer.bed_type}`} />}{offer.features.slice(0, 4).map((feature) => <Chip key={feature} size="small" variant="outlined" label={feature} />)}</Stack><Divider sx={{ my: 2, mt: 'auto' }} /><Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: "end"
      }}><Box><Typography variant="caption" sx={{
      color: "text.secondary"
    }}>Stay total</Typography><Typography variant="h5">{money(offer.total_amount, offer.currency)}</Typography></Box><Button variant="contained" startIcon={<HotelIcon />} onClick={onSelect}>Select</Button></Stack></CardContent></Card>
  );
}

function LoadingQuote() { return (
  <Paper sx={{ p: 4 }}><Stack
    direction="row"
    spacing={2}
    sx={{
      justifyContent: "center",
      alignItems: "center"
    }}><CircularProgress size={24} /><Typography>Confirming the latest price…</Typography></Stack></Paper>
); }

function ReviewStage(props: { isAnonymous: boolean; guestDetails: AnonymousGuestDetails; onGuestDetails: (value: AnonymousGuestDetails) => void; quote: GuestBookingQuote; search: GuestBookingSearch; vouchers: Voucher[]; voucherId: number | ''; selectedOffer: GuestBookingOffer; selectedVoucher?: Voucher; eligibleVoucherIds: Set<number>; ineligibleVoucherKeys: Set<string>; specialRequests: string; cleaningPreference: boolean; isSubmitting: boolean; onVoucher: (value: number | '') => void; onComplimentaryDates: (value: string[]) => void; onRequests: (value: string) => void; onCleaning: (value: boolean) => void; onBack: () => void; onConfirm: () => void }) {
  const { isAnonymous, guestDetails, onGuestDetails, quote, search, vouchers, voucherId, selectedOffer, selectedVoucher, eligibleVoucherIds, ineligibleVoucherKeys, specialRequests, cleaningPreference, isSubmitting, onVoucher, onComplimentaryDates, onRequests, onCleaning, onBack, onConfirm } = props;
  return (
    <Paper component="section" aria-labelledby="review-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}><Grid container spacing={4}><Grid size={{ xs: 12, md: 7 }}><Typography id="review-heading" variant="h5">Review your stay</Typography><Typography sx={{ mt: 1, fontWeight: 700 }}>{quote.room_type_name}</Typography><Typography sx={{
        color: "text.secondary"
      }}>{quote.check_in_date} to {quote.check_out_date} · {countStayNights(search)} night{countStayNights(search) === 1 ? '' : 's'} · {quote.adults} adults{quote.children > 0 ? ` · ${quote.children} children` : ''}</Typography>{isAnonymous ? <GuestDetailsForm details={guestDetails} onChange={onGuestDetails} /> : <><ComplimentaryNights quote={quote} onChange={onComplimentaryDates} /><FormControl fullWidth sx={{ mt: 3 }}><InputLabel id="voucher-label">Voucher</InputLabel><Select labelId="voucher-label" label="Voucher" value={voucherId} onChange={(event) => { const value = String(event.target.value); onVoucher(value === '' ? '' : Number(value)); }}><MenuItem value="">No voucher</MenuItem>{vouchers.map((voucher) => { const isIneligible = !eligibleVoucherIds.has(voucher.id) || ineligibleVoucherKeys.has(voucherStayEligibilityKey(voucher.id, selectedOffer.room_type_id, search)); return <MenuItem key={voucher.id} value={voucher.id} disabled={isIneligible}>{voucher.promotion_name} ({voucher.code ?? voucher.code_masked}){isIneligible ? ' — Not eligible for this stay' : ''}</MenuItem>; })}</Select></FormControl>{selectedVoucher && quote.voucher_name && <Alert severity="success" sx={{ mt: 2 }}>{quote.voucher_name} has been applied.</Alert>}</>}<TextField label="Special requests" value={specialRequests} onChange={(event) => onRequests(event.target.value)} fullWidth multiline minRows={3} sx={{ mt: 3 }} slotProps={{
        htmlInput: { maxLength: 1000 }
      }} /><FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={cleaningPreference} onChange={(event) => onCleaning(event.target.checked)} />} label="I would like daily room cleaning" /></Grid><Grid size={{ xs: 12, md: 5 }}><PriceSummary quote={quote} isSubmitting={isSubmitting} onBack={onBack} onConfirm={onConfirm} /></Grid></Grid></Paper>
  );
}

/**
 * Contact details for a booking made without an account.
 *
 * Deliberately short: a name, an email and the tourism type. Everything else a
 * stay eventually needs (IC, address, full party details) is collected at
 * check-in, so the booking itself stays fast.
 */
function GuestDetailsForm({ details, onChange }: { details: AnonymousGuestDetails; onChange: (value: AnonymousGuestDetails) => void }) {
  const set = (patch: Partial<AnonymousGuestDetails>) => onChange({ ...details, ...patch });
  return (
    <Box component="section" aria-labelledby="guest-details-heading" sx={{ mt: 3 }}>
      <Typography id="guest-details-heading" variant="h6">Your details</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 2 }}>
        We only need enough to hold the room and send your confirmation. The rest is collected at check-in.
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="First name" required fullWidth value={details.first_name} onChange={(event) => set({ first_name: event.target.value })} slotProps={{ htmlInput: { maxLength: 100, autoComplete: 'given-name' } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Last name" fullWidth value={details.last_name ?? ''} onChange={(event) => set({ last_name: event.target.value })} slotProps={{ htmlInput: { maxLength: 100, autoComplete: 'family-name' } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Email" type="email" required fullWidth value={details.email} onChange={(event) => set({ email: event.target.value })} helperText="Your confirmation and booking number are sent here." slotProps={{ htmlInput: { maxLength: 255, autoComplete: 'email' } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Phone" fullWidth value={details.phone ?? ''} onChange={(event) => set({ phone: event.target.value })} slotProps={{ htmlInput: { maxLength: 20, autoComplete: 'tel' } }} />
        </Grid>
        <Grid size={{ xs: 12 }}>
          {/* Never defaulted: this decides whether tourism tax is charged. */}
          <FormControl fullWidth required>
            <InputLabel id="tourism-type-label">Guest type</InputLabel>
            <Select labelId="tourism-type-label" label="Guest type" value={details.tourism_type} onChange={(event) => set({ tourism_type: event.target.value as AnonymousGuestDetails['tourism_type'] })}>
              <MenuItem value="local">Local tourist (Malaysian)</MenuItem>
              <MenuItem value="foreign">Foreign tourist</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>
      <Alert severity="info" sx={{ mt: 2 }}>
        Booking as a guest. <Box component="a" href="/login?account=guest&redirect=%2Fguest-portal%3Fview%3Dbooking" sx={{ color: 'inherit', fontWeight: 700 }}>Sign in</Box> to use vouchers and free nights, and to earn points on this stay.
      </Alert>
    </Box>
  );
}

/**
 * Pick which nights to cover with complimentary-night credits.
 *
 * Credits are room-type specific, so this only appears once a room type with a
 * balance is selected. Each night is priced individually, so the guest chooses
 * the nights rather than the count — spending a credit on the expensive night
 * is worth more than on the cheap one, and that should be their call.
 */
function ComplimentaryNights({ quote, onChange }: { quote: GuestBookingQuote; onChange: (value: string[]) => void }) {
  const selected = quote.complimentary_dates ?? [];
  const available = quote.credits_available ?? 0;
  if (available <= 0) return null;
  const atLimit = selected.length >= available;
  const toggle = (date: string) => {
    onChange(selected.includes(date) ? selected.filter((value) => value !== date) : [...selected, date]);
  };
  return (
    <Card variant="outlined" sx={{ mt: 3, borderColor: 'success.light', bgcolor: 'success.50' }}>
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            justifyContent: "space-between",
            alignItems: "center"
          }}>
          <Typography variant="subtitle1" sx={{
            fontWeight: 700
          }}>Use your complimentary nights</Typography>
          <Chip color="success" size="small" label={`${available} available`} />
        </Stack>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.5
          }}>
          You have {available} free night{available === 1 ? '' : 's'} for {quote.room_type_name}. Choose which nights to cover.
        </Typography>
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, mt: 1.5 }}>
          <Typography component="legend" variant="caption" sx={{
            color: "text.secondary"
          }}>Nights of this stay</Typography>
          {quote.nightly_rates.map((rate) => {
            const isSelected = selected.includes(rate.date);
            return (
              <FormControlLabel
                key={rate.date}
                sx={{ display: 'flex', ml: 0, justifyContent: 'space-between' }}
                labelPlacement="start"
                control={<Checkbox checked={isSelected} disabled={!isSelected && atLimit} onChange={() => toggle(rate.date)} />}
                label={<Typography variant="body2" sx={{ textDecoration: isSelected ? 'line-through' : undefined }}>{rate.date} · {money(rate.amount, quote.currency)}</Typography>}
              />
            );
          })}
        </Box>
        {atLimit && selected.length > 0 ? (
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            That is all {available} of your free nights for this room type. Uncheck one to move it to a different night.
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PriceSummary({ quote, isSubmitting, onBack, onConfirm }: { quote: GuestBookingQuote; isSubmitting: boolean; onBack: () => void; onConfirm: () => void }) {
  const complimentaryAmount = Number(quote.complimentary_discount) || 0;
  // `discount_amount` is the combined discount; show the voucher's share of it
  // separately so the guest can tell what each one saved them.
  const voucherAmount = (Number(quote.discount_amount) || 0) - complimentaryAmount;
  const settledByCredits = complimentaryAmount > 0 && Number(quote.total_amount) <= 0;
  return (
    <Card variant="outlined" sx={{ position: { md: 'sticky' }, top: { md: 92 } }}><CardContent><Typography variant="h6">Price summary</Typography>{quote.nightly_rates.map((rate) => <Stack
      key={rate.date}
      direction="row"
      spacing={2}
      sx={{
        justifyContent: "space-between",
        mt: 1
      }}><Typography variant="body2">{rate.date}</Typography><Typography variant="body2">{money(rate.amount, quote.currency)}</Typography></Stack>)}<Divider sx={{ my: 2 }} /><SummaryLine label="Subtotal" value={money(quote.subtotal, quote.currency)} />{complimentaryAmount > 0 ? <SummaryLine label={`Complimentary nights (${quote.complimentary_nights})`} value={`-${money(complimentaryAmount, quote.currency)}`} color="success.main" /> : null}{voucherAmount > 0 ? <SummaryLine label="Discount" value={`-${money(voucherAmount, quote.currency)}`} color="success.main" /> : null}<SummaryLine label="Tax" value={money(quote.tax_amount, quote.currency)} /><Divider sx={{ my: 2 }} /><SummaryLine label="Total" value={money(quote.total_amount, quote.currency)} strong /><Alert severity={settledByCredits ? 'success' : 'info'} sx={{ mt: 2 }}>{settledByCredits ? 'Your complimentary nights cover this stay in full — there is nothing to pay.' : 'You can choose your payment method after submitting your booking request.'}</Alert><Stack direction={{ xs: 'column', sm: 'row', md: 'column' }} spacing={1} sx={{ mt: 3 }}><Button variant="outlined" onClick={onBack}>Change room</Button><Button variant="contained" disabled={isSubmitting} onClick={onConfirm}>{isSubmitting ? <CircularProgress size={22} color="inherit" /> : settledByCredits ? 'Confirm free stay' : 'Continue to payment'}</Button></Stack></CardContent></Card>
  );
}

function SummaryLine({ label, value, strong = false, color }: { label: string; value: string; strong?: boolean; color?: string }) { return (
  <Stack
    direction="row"
    sx={{
      justifyContent: "space-between",
      color: color,
      mt: 1
    }}><Typography sx={{
    fontWeight: strong ? 700 : undefined
  }}>{label}</Typography><Typography sx={{
    fontWeight: strong ? 700 : undefined
  }}>{value}</Typography></Stack>
); }

function ConfirmationStage({ confirmation, token, paymentMode, isAnonymous, onStays, onAnother }: { confirmation: GuestBookingConfirmation; token: string | null; paymentMode: 'session' | 'token'; isAnonymous: boolean; onStays: () => void; onAnother: () => void }) {
  const [paymentComplete, setPaymentComplete] = useState(confirmation.status === 'confirmed');
  const [completedPayment, setCompletedPayment] = useState<PaymentActionResponse | null>(null);
  const title = paymentComplete ? 'Booking confirmed' : 'Complete your payment';
  const handlePaymentResult = (result: PaymentActionResponse) => {
    if (result.status === 'completed') {
      setPaymentComplete(true);
      setCompletedPayment(result);
    }
  };
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 7 } }}><Paper role="status" aria-live="polite" sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center', border: '1px solid', borderColor: 'divider' }}><CheckCircleIcon color={paymentComplete ? 'success' : 'primary'} sx={{ fontSize: 64 }} /><Typography variant="h4" component="h1" sx={{ mt: 2 }}>{title}</Typography><Typography
      variant="overline"
      sx={{
        color: "text.secondary",
        display: 'block',
        mt: 2
      }}>Booking number</Typography><Typography
      variant="h3"
      sx={{
        color: "primary.main",
        mt: 0.5,
        fontVariantNumeric: 'tabular-nums'
      }}>{confirmation.booking_number}</Typography><Typography sx={{ mt: 3, fontWeight: 700 }}>{confirmation.room_type_name}</Typography><Typography sx={{
      color: "text.secondary"
    }}>{confirmation.check_in_date} to {confirmation.check_out_date}</Typography><Typography variant="h5" sx={{ mt: 2 }}>{money(confirmation.total_amount, confirmation.currency)}</Typography><Box sx={{ mt: 3, textAlign: 'left' }}><GuestPaymentPanel mode={paymentMode} bookingId={confirmation.booking_id} token={token ?? ''} amount={confirmation.total_amount} currency={confirmation.currency} onPaid={handlePaymentResult} /></Box>{completedPayment ? <Paper component="section" aria-labelledby="payment-receipt-heading" variant="outlined" sx={{ mt: 3, p: 2.5, textAlign: 'left', bgcolor: 'success.50' }}><Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: "flex-start"
      }}><Box><Typography id="payment-receipt-heading" variant="h6">Payment receipt</Typography><Typography variant="body2" sx={{
      color: "text.secondary"
    }}>Payment received and your booking is confirmed.</Typography></Box><Chip color="success" label="Paid" size="small" /></Stack><Divider sx={{ my: 2 }} /><SummaryLine label="Booking" value={confirmation.booking_number} /><SummaryLine label="Receipt ID" value={`PAY-${completedPayment.payment_id}`} /><SummaryLine label="Stay" value={`${confirmation.check_in_date} – ${confirmation.check_out_date}`} /><SummaryLine label="Amount paid" value={money(confirmation.total_amount, confirmation.currency)} strong /><Button variant="outlined" fullWidth sx={{ mt: 2 }} onClick={() => window.print()}>Print receipt</Button></Paper> : null}<Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{
        justifyContent: "center",
        mt: 3
      }}><Button variant="outlined" onClick={onStays}>{isAnonymous ? 'Back to the hotel' : 'View my stays'}</Button><Button variant="contained" onClick={onAnother}>Book another stay</Button></Stack>{isAnonymous ? <Alert severity="info" sx={{ mt: 3, textAlign: 'left' }}>Keep booking number <strong>{confirmation.booking_number}</strong>. With the email you gave us, it is how you reopen this booking later — this page's link expires.</Alert> : null}</Paper></Container>
  );
}

export default PortalBookingPage;
