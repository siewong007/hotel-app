import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HotelIcon from '@mui/icons-material/Hotel';
import KingBedOutlinedIcon from '@mui/icons-material/KingBedOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
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
import { GuestBookingApi } from './api';
import type { AvailabilityEvent, GuestBookingConfirmation, GuestBookingOffer, GuestBookingQuote, GuestBookingSearch } from './types';
import type { PaymentActionResponse } from '../../../types';
import { calendarDateInput, countStayNights, shouldInterruptSelectedOffer, stayOverlapsAvailabilityEvent, validateGuestBookingSearch } from './utils';
import { useAvailabilitySocket } from './useAvailabilitySocket';

const STEPS = ['Search', 'Choose', 'Review', 'Payment'];
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
  const [ineligibleVoucherKeys, setIneligibleVoucherKeys] = useState<Set<string>>(() => new Set());
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
    if (!token) return;
    void PortalPromotionsApi.listVouchers({ page_size: 100 }, token)
      .then((response) => setVouchers(response.items.filter((voucher) => voucher.status === 'available')))
      .catch(() => setVouchers([]));
  }, [token]);

  const runSearch = useCallback(async () => {
    if (!token) return;
    const validationError = validateGuestBookingSearch(search);
    if (validationError) { setError(validationError); return; }
    setIsSearching(true); setError(null); setOffers([]);
    try {
      const nextOffers = await GuestBookingApi.search(search, token);
      setOffers(nextOffers);
      if (nextOffers.length === 0) setError('No room types are available for those dates and guests.');
    } catch (searchError) {
      setError(errorMessage(searchError, 'Unable to search room availability.'));
      setOffers([]);
    } finally { setIsSearching(false); }
  }, [search, token]);

  const selectOffer = useCallback(async (offer: GuestBookingOffer) => {
    if (!token) return;
    setSelectedOffer(offer); setVoucherId(''); setRequestId(newRequestId()); setIsQuoting(true); setError(null);
    try { setQuote(await GuestBookingApi.quote({ ...search, room_type_id: offer.room_type_id }, token)); }
    catch (quoteError) { setSelectedOffer(null); setError(errorMessage(quoteError, 'Unable to quote this room type.')); }
    finally { setIsQuoting(false); }
  }, [search, token]);

  const applyVoucher = useCallback(async (nextVoucherId: number | '') => {
    const eligibilityKey = nextVoucherId === '' || !selectedOffer ? null : voucherStayEligibilityKey(nextVoucherId, selectedOffer.room_type_id, search);
    if (eligibilityKey && ineligibleVoucherKeys.has(eligibilityKey)) return;
    setVoucherId(nextVoucherId);
    if (!token || !selectedOffer) return;
    setIsQuoting(true); setError(null);
    try {
      setQuote(await GuestBookingApi.quote({ ...search, room_type_id: selectedOffer.room_type_id, voucher_id: nextVoucherId === '' ? undefined : nextVoucherId }, token));
      setRequestId(newRequestId());
    } catch (quoteError) {
      if (eligibilityKey && isVoucherEligibilityError(quoteError)) setIneligibleVoucherKeys((current) => new Set(current).add(eligibilityKey));
      setVoucherId('');
      setError(errorMessage(quoteError, 'This voucher cannot be applied to the selected stay.'));
    } finally { setIsQuoting(false); }
  }, [ineligibleVoucherKeys, search, selectedOffer, token]);

  const submitBooking = useCallback(async () => {
    if (!token || !quote) return;
    setIsSubmitting(true); setError(null);
    try {
      const result = await GuestBookingApi.create({ ...search, room_type_id: quote.room_type_id, voucher_id: quote.voucher_id ?? undefined, client_request_id: requestId, expected_total: quote.total_amount, special_requests: specialRequests.trim() || undefined, cleaning_preference: cleaningPreference }, token);
      setConfirmation(result);
    } catch (createError) {
      setError(errorMessage(createError, 'Unable to create the booking.'));
      try { setQuote(await GuestBookingApi.quote({ ...search, room_type_id: quote.room_type_id, voucher_id: quote.voucher_id ?? undefined }, token)); }
      catch { setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); await runSearch(); }
    } finally { setIsSubmitting(false); }
  }, [cleaningPreference, quote, requestId, runSearch, search, specialRequests, token]);

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
  if (needsLogin) return <Navigate to="/login?account=guest" replace />;
  if (!token) return <SessionGate error={sessionError} status={sessionStatus} canRetry={canRetry} onRetry={retry} onRestart={restartSignIn} />;
  if (confirmation) return <ConfirmationStage confirmation={confirmation} token={token} onStays={() => navigate('/guest-portal?section=stays')} onAnother={() => { setConfirmation(null); setSelectedOffer(null); setQuote(null); setOffers([]); setVoucherId(''); setSpecialRequests(''); setCleaningPreference(false); setRequestId(newRequestId()); }} />;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/guest-portal')} sx={{ mb: 2 }}>Back to my account</Button>
      <Typography variant="h3" component="h1">Reserve your stay</Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>Live availability, clear pricing, and secure payment after your booking request.</Typography>
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: { xs: 3, md: 4 }, '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.8125rem' } } }}>
        {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      <SearchStage search={search} isSearching={isSearching} onChange={setSearch} onSearch={() => { setSelectedOffer(null); setQuote(null); void runSearch(); }} />
      <Collapse in={Boolean(error)} timeout={animationTimeout}><Box sx={{ mt: 2 }}>{error && <Alert severity="error">{error}</Alert>}</Box></Collapse>
      <Collapse in={!selectedOffer && offers.length > 0} timeout={animationTimeout} unmountOnExit>
        <Box sx={{ mt: 3 }}><Typography variant="h5" sx={{ mb: 2 }}>Choose your room</Typography><Grid container spacing={3}>{offers.map((offer) => <Grid key={offer.room_type_id} size={{ xs: 12, md: 6 }}><OfferCard offer={offer} onSelect={() => void selectOffer(offer)} /></Grid>)}</Grid></Box>
      </Collapse>
      <Collapse in={Boolean(selectedOffer)} timeout={animationTimeout} unmountOnExit>
        <Box sx={{ mt: 3 }}>{isQuoting || !quote ? <LoadingQuote /> : <ReviewStage quote={quote} search={search} vouchers={vouchers} voucherId={voucherId} selectedOffer={selectedOffer!} selectedVoucher={selectedVoucher} ineligibleVoucherKeys={ineligibleVoucherKeys} specialRequests={specialRequests} cleaningPreference={cleaningPreference} isSubmitting={isSubmitting} onVoucher={(value) => void applyVoucher(value)} onRequests={setSpecialRequests} onCleaning={setCleaningPreference} onBack={() => { setSelectedOffer(null); setQuote(null); }} onConfirm={() => void submitBooking()} />}</Box>
      </Collapse>
      <Dialog open={availabilityLost} onClose={() => setAvailabilityLost(false)}><DialogTitle>Room availability changed</DialogTitle><DialogContent><Typography>This room or its online availability changed while you were reviewing. We refreshed the options and cleared the previous quote so you can choose from the latest availability.</Typography></DialogContent><DialogActions><Button variant="contained" onClick={() => setAvailabilityLost(false)}>View available rooms</Button></DialogActions></Dialog>
    </Container>
  );
};

function SessionGate({ error, status, canRetry, onRetry, onRestart }: { error: string | null; status: string; canRetry: boolean; onRetry: () => void; onRestart: () => void }) {
  return <Container maxWidth="sm" sx={{ mt: 8 }}>{error ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={canRetry ? onRetry : onRestart}>{canRetry ? 'Retry' : 'Sign in again'}</Button>}>{error}</Alert> : <Stack direction="row" justifyContent="center" spacing={2}><CircularProgress size={24} /><Typography>{status === 'checking-account' ? 'Checking your account session…' : 'Opening your guest portal…'}</Typography></Stack>}</Container>;
}

function SearchStage({ search, isSearching, onChange, onSearch }: { search: GuestBookingSearch; isSearching: boolean; onChange: React.Dispatch<React.SetStateAction<GuestBookingSearch>>; onSearch: () => void }) {
  const nights = countStayNights(search);
  return <Paper component="section" aria-labelledby="booking-search-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}><Box><Typography id="booking-search-heading" variant="h5">Search</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Choose a check-in within three months and a stay of up to 30 nights.</Typography></Box>{nights > 0 ? <Chip label={`${nights} night${nights === 1 ? '' : 's'}`} size="small" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} /> : null}</Stack><Grid container spacing={2} alignItems="center"><Grid size={{ xs: 12, sm: 3 }}><TextField label="Check-in" type="date" fullWidth value={search.check_in_date} onChange={(event) => onChange((current) => ({ ...current, check_in_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: calendarDateInput(0) } }} /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField label="Check-out" type="date" fullWidth value={search.check_out_date} onChange={(event) => onChange((current) => ({ ...current, check_out_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: search.check_in_date } }} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField label="Adults" type="number" fullWidth value={search.adults} onChange={(event) => onChange((current) => ({ ...current, adults: Number(event.target.value) }))} slotProps={{ htmlInput: { min: 1, max: 20 } }} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField label="Children" type="number" fullWidth value={search.children} onChange={(event) => onChange((current) => ({ ...current, children: Number(event.target.value) }))} slotProps={{ htmlInput: { min: 0, max: 20 } }} /></Grid><Grid size={{ xs: 12, sm: 2 }}><Button variant="contained" fullWidth size="large" disabled={isSearching} onClick={onSearch}>{isSearching ? <CircularProgress size={22} color="inherit" /> : 'Search'}</Button></Grid></Grid></Paper>;
}

function OfferCard({ offer, onSelect }: { offer: GuestBookingOffer; onSelect: () => void }) {
  const image = offerImage(offer);
  const [imageFailed, setImageFailed] = useState(false);
  const shouldShowImage = Boolean(image && !imageFailed);
  const roomsLabel = offer.available_rooms === 1 ? '1 room left' : `${offer.available_rooms} rooms left`;
  return <Card component="article" variant="outlined" sx={{ height: '100%', overflow: 'hidden', transition: 'transform 200ms ease, box-shadow 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 } }}>{shouldShowImage ? <Box component="img" src={image!} alt={`${offer.room_type_name} room`} onError={() => setImageFailed(true)} sx={{ display: 'block', width: '100%', height: 176, objectFit: 'cover', bgcolor: '#173B31' }} /> : <Box aria-hidden="true" sx={{ height: 176, background: FALLBACK_ROOM_IMAGE, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.9)' }}><HotelIcon sx={{ fontSize: 48 }} /></Box>}<CardContent sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 176px)' }}><Stack direction="row" justifyContent="space-between" spacing={2}><Box><Typography variant="h5">{offer.room_type_name}</Typography><Typography variant="body2" color="text.secondary">{offer.room_type_code}</Typography></Box><Chip color={offer.available_rooms <= 1 ? 'warning' : 'success'} label={roomsLabel} /></Stack>{offer.description && <Typography sx={{ mt: 2 }}>{offer.description}</Typography>}<Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}><Chip size="small" icon={<PeopleOutlineIcon />} label={`Up to ${offer.max_occupancy} guests`} />{offer.bed_type && <Chip size="small" icon={<KingBedOutlinedIcon />} label={`${offer.bed_count ? `${offer.bed_count} ` : ''}${offer.bed_type}`} />}{offer.features.slice(0, 4).map((feature) => <Chip key={feature} size="small" variant="outlined" label={feature} />)}</Stack><Divider sx={{ my: 2, mt: 'auto' }} /><Stack direction="row" justifyContent="space-between" alignItems="end" spacing={2}><Box><Typography variant="caption" color="text.secondary">Stay total</Typography><Typography variant="h5">{money(offer.total_amount, offer.currency)}</Typography></Box><Button variant="contained" startIcon={<HotelIcon />} onClick={onSelect}>Select</Button></Stack></CardContent></Card>;
}

function LoadingQuote() { return <Paper sx={{ p: 4 }}><Stack direction="row" spacing={2} justifyContent="center" alignItems="center"><CircularProgress size={24} /><Typography>Confirming the latest price…</Typography></Stack></Paper>; }

function ReviewStage(props: { quote: GuestBookingQuote; search: GuestBookingSearch; vouchers: Voucher[]; voucherId: number | ''; selectedOffer: GuestBookingOffer; selectedVoucher?: Voucher; ineligibleVoucherKeys: Set<string>; specialRequests: string; cleaningPreference: boolean; isSubmitting: boolean; onVoucher: (value: number | '') => void; onRequests: (value: string) => void; onCleaning: (value: boolean) => void; onBack: () => void; onConfirm: () => void }) {
  const { quote, search, vouchers, voucherId, selectedOffer, selectedVoucher, ineligibleVoucherKeys, specialRequests, cleaningPreference, isSubmitting, onVoucher, onRequests, onCleaning, onBack, onConfirm } = props;
  return <Paper component="section" aria-labelledby="review-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}><Grid container spacing={4}><Grid size={{ xs: 12, md: 7 }}><Typography id="review-heading" variant="h5">Review your stay</Typography><Typography sx={{ mt: 1, fontWeight: 700 }}>{quote.room_type_name}</Typography><Typography color="text.secondary">{quote.check_in_date} to {quote.check_out_date} · {countStayNights(search)} night{countStayNights(search) === 1 ? '' : 's'} · {quote.adults} adults{quote.children > 0 ? ` · ${quote.children} children` : ''}</Typography><FormControl fullWidth sx={{ mt: 3 }}><InputLabel id="voucher-label">Voucher</InputLabel><Select labelId="voucher-label" label="Voucher" value={voucherId} onChange={(event) => { const value = String(event.target.value); onVoucher(value === '' ? '' : Number(value)); }}><MenuItem value="">No voucher</MenuItem>{vouchers.map((voucher) => { const isIneligible = ineligibleVoucherKeys.has(voucherStayEligibilityKey(voucher.id, selectedOffer.room_type_id, search)); return <MenuItem key={voucher.id} value={voucher.id} disabled={isIneligible}>{voucher.promotion_name} ({voucher.code ?? voucher.code_masked}){isIneligible ? ' — Not eligible for this stay' : ''}</MenuItem>; })}</Select></FormControl>{selectedVoucher && quote.voucher_name && <Alert severity="success" sx={{ mt: 2 }}>{quote.voucher_name} has been applied.</Alert>}<TextField label="Special requests" value={specialRequests} onChange={(event) => onRequests(event.target.value)} fullWidth multiline minRows={3} inputProps={{ maxLength: 1000 }} sx={{ mt: 3 }} /><FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={cleaningPreference} onChange={(event) => onCleaning(event.target.checked)} />} label="I would like daily room cleaning" /></Grid><Grid size={{ xs: 12, md: 5 }}><PriceSummary quote={quote} isSubmitting={isSubmitting} onBack={onBack} onConfirm={onConfirm} /></Grid></Grid></Paper>;
}

function PriceSummary({ quote, isSubmitting, onBack, onConfirm }: { quote: GuestBookingQuote; isSubmitting: boolean; onBack: () => void; onConfirm: () => void }) {
  const hasDiscount = Number(quote.discount_amount) > 0;
  return <Card variant="outlined" sx={{ position: { md: 'sticky' }, top: { md: 92 } }}><CardContent><Typography variant="h6">Price summary</Typography>{quote.nightly_rates.map((rate) => <Stack key={rate.date} direction="row" justifyContent="space-between" spacing={2} sx={{ mt: 1 }}><Typography variant="body2">{rate.date}</Typography><Typography variant="body2">{money(rate.amount, quote.currency)}</Typography></Stack>)}<Divider sx={{ my: 2 }} /><SummaryLine label="Subtotal" value={money(quote.subtotal, quote.currency)} />{hasDiscount ? <SummaryLine label="Discount" value={`-${money(quote.discount_amount, quote.currency)}`} color="success.main" /> : null}<SummaryLine label="Tax" value={money(quote.tax_amount, quote.currency)} /><Divider sx={{ my: 2 }} /><SummaryLine label="Total" value={money(quote.total_amount, quote.currency)} strong /><Alert severity="info" sx={{ mt: 2 }}>You can choose your payment method after submitting your booking request.</Alert><Stack direction={{ xs: 'column', sm: 'row', md: 'column' }} spacing={1} sx={{ mt: 3 }}><Button variant="outlined" onClick={onBack}>Change room</Button><Button variant="contained" disabled={isSubmitting} onClick={onConfirm}>{isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Continue to payment'}</Button></Stack></CardContent></Card>;
}

function SummaryLine({ label, value, strong = false, color }: { label: string; value: string; strong?: boolean; color?: string }) { return <Stack direction="row" justifyContent="space-between" color={color} sx={{ mt: 1 }}><Typography fontWeight={strong ? 700 : undefined}>{label}</Typography><Typography fontWeight={strong ? 700 : undefined}>{value}</Typography></Stack>; }

function ConfirmationStage({ confirmation, token, onStays, onAnother }: { confirmation: GuestBookingConfirmation; token: string; onStays: () => void; onAnother: () => void }) {
  const [paymentComplete, setPaymentComplete] = useState(confirmation.status === 'confirmed');
  const [completedPayment, setCompletedPayment] = useState<PaymentActionResponse | null>(null);
  const title = paymentComplete ? 'Booking confirmed' : 'Complete your payment';
  const handlePaymentResult = (result: PaymentActionResponse) => {
    if (result.status === 'completed') {
      setPaymentComplete(true);
      setCompletedPayment(result);
    }
  };
  return <Container maxWidth="sm" sx={{ py: { xs: 4, md: 7 } }}><Paper role="status" aria-live="polite" sx={{ p: { xs: 3, sm: 5 }, textAlign: 'center', border: '1px solid', borderColor: 'divider' }}><CheckCircleIcon color={paymentComplete ? 'success' : 'primary'} sx={{ fontSize: 64 }} /><Typography variant="h4" component="h1" sx={{ mt: 2 }}>{title}</Typography><Typography variant="overline" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Booking number</Typography><Typography variant="h3" color="primary.main" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{confirmation.booking_number}</Typography><Typography sx={{ mt: 3, fontWeight: 700 }}>{confirmation.room_type_name}</Typography><Typography color="text.secondary">{confirmation.check_in_date} to {confirmation.check_out_date}</Typography><Typography variant="h5" sx={{ mt: 2 }}>{money(confirmation.total_amount, confirmation.currency)}</Typography><Box sx={{ mt: 3, textAlign: 'left' }}><GuestPaymentPanel mode="session" bookingId={confirmation.booking_id} token={token} amount={confirmation.total_amount} currency={confirmation.currency} onPaid={handlePaymentResult} /></Box>{completedPayment ? <Paper component="section" aria-labelledby="payment-receipt-heading" variant="outlined" sx={{ mt: 3, p: 2.5, textAlign: 'left', bgcolor: 'success.50' }}><Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}><Box><Typography id="payment-receipt-heading" variant="h6">Payment receipt</Typography><Typography variant="body2" color="text.secondary">Payment received and your booking is confirmed.</Typography></Box><Chip color="success" label="Paid" size="small" /></Stack><Divider sx={{ my: 2 }} /><SummaryLine label="Booking" value={confirmation.booking_number} /><SummaryLine label="Receipt ID" value={`PAY-${completedPayment.payment_id}`} /><SummaryLine label="Stay" value={`${confirmation.check_in_date} – ${confirmation.check_out_date}`} /><SummaryLine label="Amount paid" value={money(confirmation.total_amount, confirmation.currency)} strong /><Button variant="outlined" fullWidth sx={{ mt: 2 }} onClick={() => window.print()}>Print receipt</Button></Paper> : null}<Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center" sx={{ mt: 3 }}><Button variant="outlined" onClick={onStays}>View my stays</Button><Button variant="contained" onClick={onAnother}>Book another stay</Button></Stack></Paper></Container>;
}

export default PortalBookingPage;
