import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HotelIcon from '@mui/icons-material/Hotel';
import KingBedOutlinedIcon from '@mui/icons-material/KingBedOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutlined';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Collapse,
  Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  FormControlLabel, FormHelperText, FormLabel, Grid, InputLabel, MenuItem, Paper, Radio,
  RadioGroup, Select, Stack, Step, StepLabel, Stepper, TextField, Typography, useMediaQuery,
} from '@mui/material';

import { Navigate, useNavigate } from '../../../router';
import { PortalPromotionsApi } from '../../promotions/api/portalPromotionsApi';
import type { Voucher } from '../../promotions/types';
import { usePortalSessionBootstrap } from '../hooks/usePortalSessionBootstrap';
import { LogoLoader } from '../../../components';
import { GuestPaymentPanel } from '../components/GuestPaymentPanel';
import { HTTPError } from 'ky';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { GroupBookingApi, GuestBookingApi, PublicBookingApi, PublicGroupBookingApi } from './api';
import { addRoom, type Cart, cartCapacity, countOfType, emptyCart, estimatedTotal, loadCart, remainingForOffer, removeLine, removeOneOfType, sameStay, saveCart, toGroupRooms, updateLine } from './cart';
import { CartBar, GroupCheckoutStage, GroupConfirmationStage, OfferRoomStepper } from './GroupCheckout';
import { useTranslation } from '../../../i18n';
import { ConsentBlock } from '../../legal/components/ConsentBlock';
import { BOOKING_CONSENTS } from '../../legal/content';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import { useConsent, type ConsentState } from '../../legal/useConsent';
import type { AnonymousGuestDetails, AvailabilityEvent, GroupBookingConfirmation, GroupQuote, GuestBookingConfirmation, GuestBookingOffer, GuestBookingQuote, GuestBookingSearch, SmokingPreference } from './types';
import type { PaymentActionResponse } from '../../../types';
import { calendarDateInput, countStayNights, shouldInterruptSelectedOffer, stayOverlapsAvailabilityEvent, validateGuestBookingSearch } from './utils';
import { useAvailabilitySocket } from './useAvailabilitySocket';
import { findPrefilledOffer, parseBookingPrefill } from './prefill';
import { guestErrorMessage } from '../utils/feedback';
import { RoomMedia, ROOM_MEDIA_HEIGHT } from './RoomMedia';
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';
import { numberFormatter } from '../../../i18n/format';

const EMPTY_GUEST_DETAILS: AnonymousGuestDetails = {
  first_name: '', email: '', phone: '', tourism_type: '',
};

/** Client-side check only; the server validates these again and is authoritative. */
function guestDetailsError(
  details: AnonymousGuestDetails,
  t: (key: string) => string,
): string | null {
  if (!details.first_name.trim()) return t('book.errors.nickname');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) return t('book.errors.email');
  // Tourism type decides whether tourism tax applies, so it is never defaulted.
  if (details.tourism_type !== 'local' && details.tourism_type !== 'foreign') return t('book.errors.tourismType');
  return null;
}

function money(amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return numberFormatter({ style: 'currency', currency }).format(Number.isFinite(value) ? value : 0);
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
//
// ky 2 pre-consumes the error body into `error.data`, so reading
// `error.response.json()` here throws on an already-used stream — silently, since
// the failure landed in a `.catch(() => null)` and read as "not a profile error",
// stranding the guest on a generic message instead of profile completion.
// See src/api/client.ts and lessons theme 13.
async function readProfileIncompleteFields(error: unknown): Promise<string[] | null> {
  if (!(error instanceof HTTPError) || error.response.status !== 422) return null;
  const body = (error as { data?: unknown }).data;
  if (!body || typeof body !== 'object' || (body as { code?: unknown }).code !== 'profile_incomplete') {
    return null;
  }
  const missing = (body as { missing_profile_fields?: unknown }).missing_profile_fields;
  return Array.isArray(missing) ? missing.filter((field): field is string => typeof field === 'string') : [];
}

// The backend rejects a duplicate nickname with 409 `code: "guest_name_taken"`
// (`ApiError::GuestNameTaken`). Match that exact shape rather than the message
// text, which is localised and may be rewritten.
//
// ky 2 pre-consumes the error body into `error.data`, so reading
// `error.response.json()` here would throw on an already-used stream —
// see src/api/client.ts and lessons theme 13.
function readGuestNameTaken(error: unknown): boolean {
  if (!(error instanceof HTTPError) || error.response.status !== 409) return false;
  const body = (error as { data?: unknown }).data;
  return Boolean(body && typeof body === 'object' && (body as { code?: unknown }).code === 'guest_name_taken');
}

const PortalBookingPage: React.FC = () => {
  const navigate = useNavigate();
  const { token, status: sessionStatus, error: sessionError, canRetry, needsLogin, isStaffAccount, retry, restartSignIn } = usePortalSessionBootstrap();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // BOOK DIRECT on the public site hands its selection over in the URL. A
  // valid handoff seeds the form, runs the search on arrival and highlights
  // the chosen room in Choose; anything invalid leaves the normal Search step.
  const [prefill] = useState(() => parseBookingPrefill(window.location.search));
  // The multi-room cart survives navigation and refresh (sessionStorage). A
  // restored cart also restores its stay dates so the cart and the search
  // never disagree.
  const [cart, setCart] = useState<Cart | null>(() => loadCart());
  const [search, setSearch] = useState<GuestBookingSearch>(() => prefill?.search ?? (cart ? { check_in_date: cart.check_in_date, check_out_date: cart.check_out_date, adults: 1, children: 0 } : { check_in_date: calendarDateInput(1), check_out_date: calendarDateInput(2), adults: 1, children: 0 }));
  const [groupCheckout, setGroupCheckout] = useState(false);
  const [groupQuote, setGroupQuote] = useState<GroupQuote | null>(null);
  const [groupQuoteNonce, setGroupQuoteNonce] = useState(0);
  const [groupVoucherId, setGroupVoucherId] = useState<number | ''>('');
  const [useGroupCredits, setUseGroupCredits] = useState(false);
  const [groupRequestId, setGroupRequestId] = useState(newRequestId);
  const [groupConfirmation, setGroupConfirmation] = useState<GroupBookingConfirmation | null>(null);
  // A one-room cart checks out through the single-booking flow (it keeps
  // PayPal and per-night credit picking); that room's own party is priced,
  // not the search's.
  const [singleParty, setSinglePartyState] = useState<{ adults: number; children: number } | null>(null);
  const stay = useMemo<GuestBookingSearch>(() => (singleParty ? { ...search, ...singleParty } : search), [search, singleParty]);
  const [prefillPending, setPrefillPending] = useState(Boolean(prefill));
  const [nicknameTaken, setNicknameTaken] = useState(false);
  const [offers, setOffers] = useState<GuestBookingOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<GuestBookingOffer | null>(null);
  const [quote, setQuote] = useState<GuestBookingQuote | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [vouchersError, setVouchersError] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<number | ''>('');
  const [eligibleVoucherIds, setEligibleVoucherIds] = useState<Set<number>>(() => new Set());
  const [ineligibleVoucherKeys, setIneligibleVoucherKeys] = useState<Set<string>>(() => new Set());
  const [complimentaryDates, setComplimentaryDates] = useState<string[]>([]);
  const [specialRequests, setSpecialRequests] = useState('');
  const [cleaningPreference, setCleaningPreference] = useState(false);
  // '' = no preference (the default); the field is then left out of the request.
  const [smokingPreference, setSmokingPreference] = useState<SmokingPreference | ''>('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirmation, setConfirmation] = useState<GuestBookingConfirmation | null>(null);
  const consent = useConsent(BOOKING_CONSENTS);
  const { locale: legalLocale } = useLegalLocale();
  const { t } = useTranslation('guestPortal');
  const steps = [t('book.steps.search'), t('book.steps.choose'), t('book.steps.review'), t('book.steps.payment')];
  const [isSearching, setIsSearching] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [availabilityLost, setAvailabilityLost] = useState(false);
  // Default to complete: a portal backend that predates this field, or a
  // transient fetch failure, must never trap the guest in a completion loop.
  // The backend booking guard (`ApiError::ProfileIncomplete`) remains
  // authoritative regardless of this client-side value.
  const [profileComplete, setProfileComplete] = useState(true);
  const [guestDetails, setGuestDetails] = useState<AnonymousGuestDetails>(EMPTY_GUEST_DETAILS);
  // Search, quote, voucher, credits and create failures all land on the one
  // form-level alert below — but only failures the guest asked for take
  // focus. Background re-prices (the tourism-type re-quote, socket-driven
  // re-search and the post-failure fallback search) render in the same alert
  // without yanking the reader out of the form.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const setError = useCallback((message: string | null, submit = true) => {
    setErrorState(message);
    setSubmitError(submit ? message : null);
  }, []);
  const errorRef = useAutoFocusError(submitError);

  // A visitor with no account books anonymously instead of being bounced to a
  // sign-up form — that detour is what made booking unreachable from the public
  // site. `needsLogin` is specifically "the session exchange finished and found
  // no account", as opposed to still checking or having failed part-way, which
  // still belong on the session gate below.
  const isAnonymous = !token && needsLogin;
  const canQuery = Boolean(token) || isAnonymous;

  useEffect(() => {
    if (!isAnonymous || !selectedOffer) return;
    if (guestDetails.tourism_type !== 'local' && guestDetails.tourism_type !== 'foreign') return;
    let cancelled = false;
    setIsQuoting(true);
    void PublicBookingApi.quote({
      ...stay,
      room_type_id: selectedOffer.room_type_id,
      tourism_type: guestDetails.tourism_type,
    })
      .then((next) => {
        if (cancelled) return;
        setQuote(next);
        setRequestId(newRequestId());
      })
      .catch((quoteError) => {
        if (!cancelled) setError(guestErrorMessage(quoteError, t('book.errors.refreshPriceFailed')), false);
      })
      .finally(() => {
        if (!cancelled) setIsQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [guestDetails.tourism_type, isAnonymous, stay, selectedOffer, setError, t]);

  // Vouchers are a secondary surface next to the quote: a load failure warns
  // inline at the picker rather than masking the search flow behind `error`.
  const loadVouchers = useCallback(async () => {
    if (!token) return;
    setVouchersError(null);
    try {
      const response = await PortalPromotionsApi.listVouchers({ page_size: 100 }, token);
      setVouchers(response.items.filter((voucher) => voucher.status === 'available'));
    } catch (vouchersLoadError) {
      setVouchers([]);
      setVouchersError(
        guestErrorMessage(vouchersLoadError, t('book.errors.vouchersLoadFailed')),
      );
    }
  }, [t, token]);

  useEffect(() => {
    void loadVouchers();
  }, [loadVouchers]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void GuestPortalDashboardService.me(token)
      .then((me) => { if (!cancelled) setProfileComplete(me.profile_complete ?? true); })
      .catch(() => { if (!cancelled) setProfileComplete(true); });
    return () => { cancelled = true; };
  }, [token]);

  const runSearch = useCallback(async (opts?: { background?: boolean }) => {
    if (!canQuery) return;
    const submit = !opts?.background;
    const validationError = validateGuestBookingSearch(search, t);
    if (validationError) { setError(validationError, submit); return; }
    setIsSearching(true); setError(null); setOffers([]);
    try {
      const nextOffers = token
        ? await GuestBookingApi.search(search, token)
        : await PublicBookingApi.search(search);
      setOffers(nextOffers);
      if (nextOffers.length === 0) setError(t('book.errors.noRooms'), submit);
    } catch (searchError) {
      setError(guestErrorMessage(searchError, t('book.errors.searchFailed')), submit);
      setOffers([]);
    } finally { setIsSearching(false); }
  }, [canQuery, search, setError, t, token]);

  // Run the prefilled search once the session can query. Until it settles the
  // page carries data-boot-hold, which keeps the static boot splash up, so the
  // guest sees one loading screen and lands directly on Choose.
  const prefillStarted = useRef(false);
  useEffect(() => {
    if (!prefillPending || !canQuery || prefillStarted.current) return;
    prefillStarted.current = true;
    void runSearch().finally(() => setPrefillPending(false));
  }, [canQuery, prefillPending, runSearch]);
  const prefilledOffer = useMemo(() => findPrefilledOffer(offers, prefill?.roomTypeCode ?? null), [offers, prefill]);
  const orderedOffers = useMemo(
    () => (prefilledOffer ? [prefilledOffer, ...offers.filter((offer) => offer !== prefilledOffer)] : offers),
    [offers, prefilledOffer],
  );

  const selectOffer = useCallback(async (offer: GuestBookingOffer, party?: { adults: number; children: number }) => {
    const base = party ? { ...search, ...party } : stay;
    setSinglePartyState(party ?? null);
    if (!canQuery || isQuoting) return;
    setSelectedOffer(offer); setVoucherId(''); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); setRequestId(newRequestId()); setIsQuoting(true); setError(null);
    try {
      if (token) {
        const voucherOptions = await GuestBookingApi.voucherOptions(
          { ...base, room_type_id: offer.room_type_id },
          token,
        );
        setQuote(voucherOptions.quote);
        setEligibleVoucherIds(new Set(voucherOptions.eligible_voucher_ids));
      } else {
        // No account, so no voucher eligibility to resolve — just the price.
        setQuote(await PublicBookingApi.quote({
          ...base,
          room_type_id: offer.room_type_id,
          ...(guestDetails.tourism_type === 'local' || guestDetails.tourism_type === 'foreign'
            ? { tourism_type: guestDetails.tourism_type }
            : {}),
        }));
      }
    }
    catch (quoteError) { setSelectedOffer(null); setError(guestErrorMessage(quoteError, t('book.errors.quoteFailed'))); }
    finally { setIsQuoting(false); }
  }, [canQuery, guestDetails.tourism_type, isQuoting, search, stay, setError, t, token]);

  const applyVoucher = useCallback(async (nextVoucherId: number | '') => {
    if (isQuoting) return;
    if (nextVoucherId !== '' && !eligibleVoucherIds.has(nextVoucherId)) return;
    const eligibilityKey = nextVoucherId === '' || !selectedOffer ? null : voucherStayEligibilityKey(nextVoucherId, selectedOffer.room_type_id, stay);
    if (eligibilityKey && ineligibleVoucherKeys.has(eligibilityKey)) return;
    setVoucherId(nextVoucherId);
    if (!token || !selectedOffer) return;
    setIsQuoting(true); setError(null);
    try {
      setQuote(await GuestBookingApi.quote({ ...stay, room_type_id: selectedOffer.room_type_id, voucher_id: nextVoucherId === '' ? undefined : nextVoucherId, complimentary_dates: complimentaryDates }, token));
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
      setError(guestErrorMessage(quoteError, t('book.errors.voucherFailed')));
    } finally { setIsQuoting(false); }
  }, [complimentaryDates, eligibleVoucherIds, ineligibleVoucherKeys, isQuoting, stay, selectedOffer, setError, t, token]);

  // Complimentary nights are re-priced server-side on every toggle: the credit
  // is worth exactly the rate of the night it is spent on, so the guest sees
  // the real total before committing.
  const applyComplimentaryDates = useCallback(async (nextDates: string[]) => {
    if (!token || !selectedOffer || isQuoting) return;
    const previousDates = complimentaryDates;
    setComplimentaryDates(nextDates);
    setIsQuoting(true); setError(null);
    try {
      setQuote(await GuestBookingApi.quote({ ...stay, room_type_id: selectedOffer.room_type_id, voucher_id: voucherId === '' ? undefined : voucherId, complimentary_dates: nextDates }, token));
      setRequestId(newRequestId());
    } catch (quoteError) {
      setComplimentaryDates(previousDates);
      setError(guestErrorMessage(quoteError, t('book.errors.creditsFailed')));
    } finally { setIsQuoting(false); }
  }, [complimentaryDates, isQuoting, stay, selectedOffer, setError, t, token, voucherId]);

  const submitAnonymousBooking = useCallback(async () => {
    if (!quote) return;
    setNicknameTaken(false);
    const detailsError = guestDetailsError(guestDetails, t);
    if (detailsError) { setError(detailsError); return; }
    // Mirrors the server check so the guest sees which box they missed rather
    // than a generic rejection. The server is what actually binds.
    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setError(t('book.consentRequired'));
      return;
    }
    const consentPayload = consent.buildPayload(legalLocale);
    setIsSubmitting(true); setError(null);
    try {
      const result = await PublicBookingApi.create({
        ...stay,
        room_type_id: quote.room_type_id,
        client_request_id: requestId,
        expected_total: quote.total_amount,
        special_requests: specialRequests.trim() || undefined,
        cleaning_preference: cleaningPreference,
        ...(smokingPreference ? { smoking_preference: smokingPreference } : {}),
        consents: consentPayload.consents,
        marketing_opt_in: consentPayload.marketing_opt_in,
        guest: {
          first_name: guestDetails.first_name.trim(),
          email: guestDetails.email.trim(),
          phone: guestDetails.phone?.trim() || undefined,
          tourism_type: guestDetails.tourism_type,
        },
      });
      setConfirmation(result);
    } catch (createError) {
      // A taken nickname is the guest's to fix in the form: the stay, the room
      // and therefore the price are all unchanged, so re-quoting here would
      // churn the total (and risk losing the offer) over a name collision.
      if (readGuestNameTaken(createError)) {
        setError(t('book.errors.nicknameTaken'));
        setNicknameTaken(true);
        return;
      }
      setError(guestErrorMessage(createError, t('book.errors.createFailed')));
      // Re-price so the guest is never left looking at a total the server has
      // moved on from; if the room itself is gone, fall back to a fresh search.
      try {
        setQuote(await PublicBookingApi.quote({
          ...stay,
          room_type_id: quote.room_type_id,
          ...(guestDetails.tourism_type === 'local' || guestDetails.tourism_type === 'foreign'
            ? { tourism_type: guestDetails.tourism_type }
            : {}),
        }));
      }
      catch { setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); await runSearch({ background: true }); }
    } finally { setIsSubmitting(false); }
  }, [cleaningPreference, consent, guestDetails, legalLocale, quote, requestId, runSearch, stay, setError, smokingPreference, specialRequests, t]);

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
    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setError(t('book.consentRequired'));
      return;
    }
    const consentPayload = consent.buildPayload(legalLocale);
    setIsSubmitting(true); setError(null);
    try {
      // Submit the nights the server itself priced, so what is booked is
      // exactly what the guest just reviewed.
      const result = await GuestBookingApi.create({ ...stay, room_type_id: quote.room_type_id, voucher_id: quote.voucher_id ?? undefined, complimentary_dates: quote.complimentary_dates, client_request_id: requestId, expected_total: quote.total_amount, special_requests: specialRequests.trim() || undefined, cleaning_preference: cleaningPreference, ...(smokingPreference ? { smoking_preference: smokingPreference } : {}), consents: consentPayload.consents }, token);
      setConfirmation(result);
    } catch (createError) {
      const missingFields = await readProfileIncompleteFields(createError);
      if (missingFields) {
        setProfileComplete(false);
        navigate(COMPLETE_PROFILE_REDIRECT);
        return;
      }
      setError(guestErrorMessage(createError, t('book.errors.createFailed')));
      try { setQuote(await GuestBookingApi.quote({ ...stay, room_type_id: quote.room_type_id, voucher_id: quote.voucher_id ?? undefined, complimentary_dates: quote.complimentary_dates }, token)); }
      catch { setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); await runSearch({ background: true }); }
    } finally { setIsSubmitting(false); }
  }, [cleaningPreference, consent, isAnonymous, legalLocale, navigate, profileComplete, quote, requestId, runSearch, stay, setError, smokingPreference, specialRequests, submitAnonymousBooking, t, token]);

  useEffect(() => { saveCart(cart); }, [cart]);
  const cartRooms = cart?.rooms.length ?? 0;
  const capacity = cart ? cartCapacity(cart) : 0;
  const partySize = Math.max(0, (Number(search.adults) || 0) + (Number(search.children) || 0));
  useEffect(() => { if (cartRooms === 0) setGroupCheckout(false); }, [cartRooms]);

  const addToCart = useCallback((offer: GuestBookingOffer) => {
    setCart((current) => addRoom(current && sameStay(current, search) ? current : emptyCart(search), offer, search));
  }, [search]);
  const removeFromCart = useCallback((roomTypeId: number) => {
    setCart((current) => (current ? removeOneOfType(current, roomTypeId) : current));
  }, []);

  // The server prices the whole cart; re-quote whenever it or the discounts
  // change. A failed quote keeps the guest in checkout with the error shown.
  const groupTourism = guestDetails.tourism_type === 'local' || guestDetails.tourism_type === 'foreign' ? guestDetails.tourism_type : undefined;
  useEffect(() => {
    if (!groupCheckout || !cart || cart.rooms.length === 0 || !canQuery) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsQuoting(true);
      const request = { check_in_date: cart.check_in_date, check_out_date: cart.check_out_date, rooms: toGroupRooms(cart) };
      const pending = token
        ? GroupBookingApi.quote({ ...request, voucher_id: groupVoucherId === '' ? undefined : groupVoucherId, use_credits: useGroupCredits }, token)
        : PublicGroupBookingApi.quote({ ...request, ...(groupTourism ? { tourism_type: groupTourism } : {}) });
      void pending
        .then((next) => { if (!cancelled) { setGroupQuote(next); setGroupRequestId(newRequestId()); } })
        .catch((quoteError) => {
          if (cancelled) return;
          setGroupQuote(null);
          if (groupVoucherId !== '' && isVoucherEligibilityError(quoteError)) setGroupVoucherId('');
          setError(guestErrorMessage(quoteError, t('book.errors.quoteFailed')));
        })
        .finally(() => { if (!cancelled) setIsQuoting(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [canQuery, cart, groupCheckout, groupQuoteNonce, groupTourism, groupVoucherId, setError, t, token, useGroupCredits]);

  const openGroupCheckout = useCallback(() => {
    if (!cart || cart.rooms.length === 0) return;
    // One plain room: the single-booking review (PayPal, per-night credits).
    const only = cart.rooms.length === 1 ? cart.rooms[0] : null;
    const onlyOffer = only && only.extra_beds === 0 ? offers.find((offer) => offer.room_type_id === only.room_type_id) : undefined;
    if (only && onlyOffer && sameStay(cart, search)) {
      setGroupCheckout(false);
      void selectOffer(onlyOffer, { adults: only.adults, children: only.children });
      return;
    }
    setSelectedOffer(null); setQuote(null); setError(null); setGroupQuote(null); setGroupCheckout(true);
    window.scrollTo?.({ top: 0, behavior: 'auto' });
  }, [cart, offers, search, selectOffer, setError]);

  const submitGroup = useCallback(async () => {
    if (!cart || !groupQuote || isSubmitting || isQuoting) return;
    if (isAnonymous) {
      setNicknameTaken(false);
      const detailsError = guestDetailsError(guestDetails, t);
      if (detailsError) { setError(detailsError); return; }
    } else if (!profileComplete) { navigate(COMPLETE_PROFILE_REDIRECT); return; }
    if (!consent.allRequiredGranted) { consent.setShowErrors(true); setError(t('book.consentRequired')); return; }
    const consentPayload = consent.buildPayload(legalLocale);
    const common = {
      client_request_id: groupRequestId,
      check_in_date: cart.check_in_date,
      check_out_date: cart.check_out_date,
      rooms: toGroupRooms(cart),
      expected_total: groupQuote.total_amount,
      special_requests: specialRequests.trim() || undefined,
      cleaning_preference: cleaningPreference,
      ...(smokingPreference ? { smoking_preference: smokingPreference } : {}),
      consents: consentPayload.consents,
    };
    setIsSubmitting(true); setError(null);
    try {
      const result = token
        ? await GroupBookingApi.create({ ...common, voucher_id: groupQuote.voucher_id ?? undefined, use_credits: useGroupCredits }, token)
        : await PublicGroupBookingApi.create({
          ...common,
          marketing_opt_in: consentPayload.marketing_opt_in,
          guest: { first_name: guestDetails.first_name.trim(), email: guestDetails.email.trim(), phone: guestDetails.phone?.trim() || undefined, tourism_type: guestDetails.tourism_type },
        });
      setGroupConfirmation(result);
      setCart(null);
      setGroupCheckout(false);
    } catch (createError) {
      if (await readProfileIncompleteFields(createError)) { setProfileComplete(false); navigate(COMPLETE_PROFILE_REDIRECT); return; }
      if (readGuestNameTaken(createError)) { setNicknameTaken(true); setError(t('book.errors.nicknameTaken')); return; }
      // All-or-nothing: nothing was booked. Show which room failed (the server
      // names it) and re-price what is left so the guest can adjust.
      setError(guestErrorMessage(createError, t('book.errors.createFailed')));
      setGroupQuoteNonce((value) => value + 1);
    } finally { setIsSubmitting(false); }
  }, [cart, cleaningPreference, consent, groupQuote, groupRequestId, guestDetails, isAnonymous, isQuoting, isSubmitting, legalLocale, navigate, profileComplete, setError, smokingPreference, specialRequests, t, token, useGroupCredits]);

  const handleAvailabilityChange = useCallback((event: AvailabilityEvent) => {
    if (!stayOverlapsAvailabilityEvent(event, search)) return;
    if (event.room_type_id !== null && event.remaining_rooms !== null) setOffers((current) => current.map((offer) => offer.room_type_id === event.room_type_id ? { ...offer, available_rooms: event.remaining_rooms ?? offer.available_rooms } : offer));
    if (shouldInterruptSelectedOffer(event, search, selectedOffer?.room_type_id ?? null) && !isSubmitting && !confirmation) {
      setSelectedOffer(null); setQuote(null); setAvailabilityLost(true); void runSearch({ background: true });
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
  if (groupConfirmation) return <Container maxWidth="sm" sx={{ py: { xs: 4, md: 7 } }}><GroupConfirmationStage confirmation={groupConfirmation} token={token ?? groupConfirmation.access_token ?? null} paymentMode={token ? 'session' : 'token'} isAnonymous={isAnonymous} onStays={() => navigate(isAnonymous ? '/salim-inn/index.html' : '/guest-portal?section=stays')} onAnother={() => { setGroupConfirmation(null); setOffers([]); setGroupQuote(null); setGroupVoucherId(''); setUseGroupCredits(false); setSpecialRequests(''); setCleaningPreference(false); setSmokingPreference(''); }} /></Container>;
  if (confirmation) return <ConfirmationStage confirmation={confirmation} token={token ?? confirmation.access_token ?? null} paymentMode={token ? 'session' : 'token'} isAnonymous={isAnonymous} onStays={() => navigate(isAnonymous ? '/salim-inn/index.html' : '/guest-portal?section=stays')} onAnother={() => { setConfirmation(null); setSelectedOffer(null); setQuote(null); setOffers([]); setVoucherId(''); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); setSpecialRequests(''); setCleaningPreference(false); setSmokingPreference(''); setRequestId(newRequestId()); }} />;

  return (
    <Container maxWidth="lg" data-boot-hold={prefillPending ? 'true' : undefined} sx={{ py: { xs: 3, md: 5 }, pb: cartRooms > 0 ? { xs: capacity < partySize ? 20 : 14, md: 14 } : undefined }}>
      {isAnonymous
        ? <Button startIcon={<ArrowBackIcon />} href="/salim-inn/index.html" sx={{ mb: 2 }}>{t('book.backToHotel')}</Button>
        : <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/guest-portal')} sx={{ mb: 2 }}>{t('book.backToAccount')}</Button>}
      <Typography variant="h3" component="h1">{t('book.title')}</Typography>
      <Typography
        sx={{
          color: "text.secondary",
          mt: 1,
          mb: 3
        }}>{t('book.subtitle')}</Typography>
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: { xs: 3, md: 4 }, '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.8125rem' } } }}>
        {steps.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      <SearchStage search={search} isSearching={isSearching} onChange={setSearch} onSearch={() => { if (cart && !sameStay(cart, search)) setCart(null); setGroupCheckout(false); setSelectedOffer(null); setQuote(null); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); void runSearch(); }} />
      <Collapse in={Boolean(error)} timeout={animationTimeout}><Box sx={{ mt: 2 }}>{error && <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1}>{error}</Alert>}</Box></Collapse>
      {groupCheckout && cart ? (
        <Box sx={{ mt: 3 }}>
          <GroupCheckoutStage
            cart={cart}
            quote={groupQuote}
            isQuoting={isQuoting}
            isSubmitting={isSubmitting}
            isAnonymous={isAnonymous}
            capacity={capacity}
            partySize={partySize}
            vouchers={vouchers}
            voucherId={groupVoucherId}
            useCredits={useGroupCredits}
            onVoucher={setGroupVoucherId}
            onUseCredits={setUseGroupCredits}
            onChangeRoom={(lineId, patch) => setCart((current) => (current ? updateLine(current, lineId, patch) : current))}
            onRemoveRoom={(lineId) => setCart((current) => (current ? removeLine(current, lineId) : current))}
            onAddMore={() => { setGroupCheckout(false); setError(null); if (offers.length === 0) void runSearch(); }}
            details={isAnonymous ? <GuestDetailsForm details={guestDetails} onChange={setGuestDetails} nicknameTaken={nicknameTaken} /> : null}
            consent={<ConsentBlock prompts={BOOKING_CONSENTS} state={consent} />}
            extras={<><TextField label={t('book.specialRequests')} value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value)} fullWidth multiline minRows={3} sx={{ mt: 3 }} slotProps={{ htmlInput: { maxLength: 1000 } }} /><FormControlLabel sx={{ mt: 1, minHeight: 44 }} control={<Checkbox checked={cleaningPreference} onChange={(event) => setCleaningPreference(event.target.checked)} />} label={t('book.dailyCleaning')} /><SmokingPreferenceField value={smokingPreference} onChange={setSmokingPreference} disabled={isSubmitting} /></>}
          />
        </Box>
      ) : null}
      <Collapse in={!groupCheckout && !selectedOffer && offers.length > 0} timeout={animationTimeout} unmountOnExit>
        <Box sx={{ mt: 3 }}><Typography variant="h5" component="h2" sx={{ mb: 2 }}>{t('book.chooseRoom')}</Typography><Grid container spacing={3}>{orderedOffers.map((offer) => <Grid key={offer.room_type_id} size={{ xs: 12, md: 6 }}><OfferCard offer={offer} highlighted={offer === prefilledOffer} disabled={isQuoting} cartCount={cart && sameStay(cart, search) ? countOfType(cart, offer.room_type_id) : 0} cartRemaining={remainingForOffer(cart && sameStay(cart, search) ? cart : emptyCart(search), offer)} onAddToCart={() => addToCart(offer)} onRemoveFromCart={() => removeFromCart(offer.room_type_id)} /></Grid>)}</Grid></Box>
      </Collapse>
      <Collapse in={Boolean(selectedOffer)} timeout={animationTimeout} unmountOnExit>
        <Box sx={{ mt: 3 }}>{!quote ? <LoadingQuote /> : <ReviewStage isAnonymous={isAnonymous} consent={consent} guestDetails={guestDetails} onGuestDetails={setGuestDetails} nicknameTaken={nicknameTaken} quote={quote} search={stay} vouchers={vouchers} vouchersError={vouchersError} onRetryVouchers={() => void loadVouchers()} voucherId={voucherId} selectedOffer={selectedOffer!} selectedVoucher={selectedVoucher} eligibleVoucherIds={eligibleVoucherIds} ineligibleVoucherKeys={ineligibleVoucherKeys} specialRequests={specialRequests} cleaningPreference={cleaningPreference} smokingPreference={smokingPreference} isSubmitting={isSubmitting || isQuoting} onVoucher={(value) => void applyVoucher(value)} onComplimentaryDates={(value) => void applyComplimentaryDates(value)} onRequests={setSpecialRequests} onCleaning={setCleaningPreference} onSmokingPreference={setSmokingPreference} onBack={() => { setSinglePartyState(null); setSelectedOffer(null); setQuote(null); setEligibleVoucherIds(new Set()); setComplimentaryDates([]); }} />}</Box>
      </Collapse>
      {cart && cartRooms > 0 ? (
        <CartBar
          roomCount={cartRooms}
          total={selectedOffer && quote ? quote.total_amount : groupCheckout && groupQuote ? groupQuote.total_amount : estimatedTotal(cart)}
          currency={(selectedOffer && quote?.currency) || groupQuote?.currency || cart.rooms[0].currency}
          estimated={!((selectedOffer && quote) || (groupCheckout && groupQuote))}
          phase={selectedOffer || groupCheckout ? 'checkout' : 'browse'}
          primaryLabel={selectedOffer && quote && Number(quote.complimentary_discount) > 0 && Number(quote.total_amount) <= 0 ? t('book.confirmFreeStay') : undefined}
          busy={isSubmitting || isQuoting || (groupCheckout && !groupQuote) || (Boolean(selectedOffer) && !quote)}
          capacity={capacity}
          partySize={partySize}
          onPrimary={selectedOffer ? () => void submitBooking() : groupCheckout ? () => void submitGroup() : openGroupCheckout}
        />
      ) : null}
      <Dialog open={availabilityLost} onClose={() => setAvailabilityLost(false)}><DialogTitle>{t('book.availabilityChangedTitle')}</DialogTitle><DialogContent><Typography>{t('book.availabilityChangedBody')}</Typography></DialogContent><DialogActions><Button variant="contained" onClick={() => setAvailabilityLost(false)}>{t('book.viewAvailable')}</Button></DialogActions></Dialog>
    </Container>
  );
};

function SessionGate({ error, status, canRetry, onRetry, onRestart }: { error: string | null; status: string; canRetry: boolean; onRetry: () => void; onRestart: () => void }) {
  const { t } = useTranslation('guestPortal');
  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>{error ? <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={canRetry ? onRetry : onRestart}>{canRetry ? t('book.retry') : t('book.signInAgain')}</Button>}>{error}</Alert> : <Stack direction="row" spacing={2} sx={{
      justifyContent: "center"
    }}><LogoLoader variant="inline" label={status === 'checking-account' ? t('book.checkingAccount') : t('book.openingPortal')} /></Stack>}</Container>
  );
}

function SearchStage({ search, isSearching, onChange, onSearch }: { search: GuestBookingSearch; isSearching: boolean; onChange: React.Dispatch<React.SetStateAction<GuestBookingSearch>>; onSearch: () => void }) {
  const { t } = useTranslation('guestPortal');
  const nights = countStayNights(search);
  return (
    <Paper component="section" aria-labelledby="booking-search-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}><Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{
        justifyContent: "space-between",
        mb: 2
      }}><Box><Typography id="booking-search-heading" variant="h5" component="h2">{t('book.searchHeading')}</Typography><Typography
      variant="body2"
      sx={{
        color: "text.secondary",
        mt: 0.5
      }}>{t('book.searchHint')}</Typography></Box>{nights > 0 ? <Chip label={t('common:count.nights', { count: nights })} size="small" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} /> : null}</Stack><Grid container spacing={2} sx={{
      alignItems: "center"
    }}><Grid size={{ xs: 12, sm: 3 }}><TextField label={t('booking.checkIn')} type="date" fullWidth value={search.check_in_date} onChange={(event) => onChange((current) => ({ ...current, check_in_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: calendarDateInput(0) } }} /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField label={t('booking.checkOut')} type="date" fullWidth value={search.check_out_date} onChange={(event) => onChange((current) => ({ ...current, check_out_date: event.target.value }))} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: search.check_in_date } }} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField label={t('book.adults')} type="number" fullWidth value={search.adults} onChange={(event) => onChange((current) => ({ ...current, adults: Number(event.target.value) }))} slotProps={{ htmlInput: { min: 1, max: 20 } }} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField label={t('book.children')} type="number" fullWidth value={search.children} onChange={(event) => onChange((current) => ({ ...current, children: Number(event.target.value) }))} slotProps={{ htmlInput: { min: 0, max: 20 } }} /></Grid><Grid size={{ xs: 12, sm: 2 }}><Button variant="contained" fullWidth size="large" disabled={isSearching} onClick={onSearch}>{isSearching ? <CircularProgress size={22} color="inherit" /> : t('book.search')}</Button></Grid></Grid></Paper>
  );
}

function OfferCard({ offer, highlighted = false, disabled, cartCount = 0, cartRemaining = 0, onAddToCart, onRemoveFromCart }: { offer: GuestBookingOffer; highlighted?: boolean; disabled?: boolean; cartCount?: number; cartRemaining?: number; onAddToCart?: () => void; onRemoveFromCart?: () => void }) {
  const { t } = useTranslation('guestPortal');
  const cardRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  }, [highlighted]);
  const roomsLabel = t('book.roomsLeft', { count: offer.available_rooms });
  return (
    <Card ref={cardRef} component="article" variant="outlined" data-prefilled-room={highlighted ? 'true' : undefined} aria-label={highlighted ? `${t('book.yourSelection')}: ${offer.room_type_name}` : undefined} sx={{ height: '100%', overflow: 'hidden', ...(highlighted && { borderColor: 'primary.main', borderWidth: 2, boxShadow: '0 0 0 3px var(--hotel-primary-subtle)' }), transition: 'transform 200ms ease, box-shadow 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 } }}><RoomMedia offer={offer} /><CardContent sx={{ display: 'flex', flexDirection: 'column', height: `calc(100% - ${ROOM_MEDIA_HEIGHT}px)` }}><Stack direction="row" spacing={2} sx={{
      justifyContent: "space-between"
    }}><Box>{highlighted && <Chip size="small" color="primary" icon={<CheckCircleIcon />} label={t('book.yourSelection')} sx={{ mb: 1 }} />}<Typography variant="h5" component="h3">{offer.room_type_name}</Typography><Typography variant="body2" sx={{
      color: "text.secondary"
    }}>{offer.room_type_code}</Typography></Box><Chip color={offer.available_rooms <= 1 ? 'warning' : 'success'} label={roomsLabel} /></Stack>{offer.description && <Typography sx={{ mt: 2 }}>{offer.description}</Typography>}<Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{
        flexWrap: "wrap",
        mt: 2
      }}><Chip size="small" icon={<PeopleOutlineIcon />} label={t('book.upToGuests', { count: offer.max_occupancy })} />{offer.bed_type && <Chip size="small" icon={<KingBedOutlinedIcon />} label={`${offer.bed_count ? `${offer.bed_count} ` : ''}${offer.bed_type}`} />}{offer.features.slice(0, 4).map((feature) => <Chip key={feature} size="small" variant="outlined" label={feature} />)}</Stack><Divider sx={{ my: 2, mt: 'auto' }} /><Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: "end"
      }}><Box><Typography variant="caption" sx={{
      color: "text.secondary"
    }}>{t('book.stayTotal')}</Typography><Typography variant="h5" component="div">{money(offer.total_amount, offer.currency)}</Typography></Box></Stack>{onAddToCart && onRemoveFromCart ? <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed', borderColor: 'divider' }}><OfferRoomStepper roomTypeName={offer.room_type_name} count={cartCount} remaining={cartRemaining} onAdd={onAddToCart} onRemove={onRemoveFromCart} disabled={disabled} /></Box> : null}</CardContent></Card>
  );
}

function LoadingQuote() {
  const { t } = useTranslation('guestPortal');
  return (
  <Paper sx={{ p: 4 }}><Stack
    direction="row"
    spacing={2}
    sx={{
      justifyContent: "center",
      alignItems: "center"
    }}><LogoLoader variant="inline" label={t('book.confirmingPrice')} /></Stack></Paper>
  );
}

function ReviewStage(props: { isAnonymous: boolean; consent: ConsentState; guestDetails: AnonymousGuestDetails; onGuestDetails: (value: AnonymousGuestDetails) => void; nicknameTaken: boolean; quote: GuestBookingQuote; search: GuestBookingSearch; vouchers: Voucher[]; vouchersError: string | null; onRetryVouchers: () => void; voucherId: number | ''; selectedOffer: GuestBookingOffer; selectedVoucher?: Voucher; eligibleVoucherIds: Set<number>; ineligibleVoucherKeys: Set<string>; specialRequests: string; cleaningPreference: boolean; smokingPreference: SmokingPreference | ''; isSubmitting: boolean; onVoucher: (value: number | '') => void; onComplimentaryDates: (value: string[]) => void; onRequests: (value: string) => void; onCleaning: (value: boolean) => void; onSmokingPreference: (value: SmokingPreference | '') => void; onBack: () => void }) {
  const { t } = useTranslation('guestPortal');
  const { isAnonymous, consent, guestDetails, onGuestDetails, nicknameTaken, quote, search, vouchers, vouchersError, onRetryVouchers, voucherId, selectedOffer, selectedVoucher, eligibleVoucherIds, ineligibleVoucherKeys, specialRequests, cleaningPreference, smokingPreference, isSubmitting, onVoucher, onComplimentaryDates, onRequests, onCleaning, onSmokingPreference, onBack } = props;
  const nightsLabel = t('common:count.nights', { count: countStayNights(search) });
  const childrenLabel = quote.children > 0 ? t('book.childrenSuffix', { count: quote.children }) : '';
  return (
    <Paper component="section" aria-labelledby="review-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}><Grid container spacing={4}><Grid size={{ xs: 12, md: 7 }}><Typography id="review-heading" variant="h5" component="h2">{t('book.reviewStay')}</Typography><Typography sx={{ mt: 1, fontWeight: 700 }}>{quote.room_type_name}</Typography><Typography sx={{
        color: "text.secondary"
      }}>{t('book.staySummary', { checkIn: quote.check_in_date, checkOut: quote.check_out_date, nights: nightsLabel, adults: quote.adults, children: childrenLabel })}</Typography>{isAnonymous ? <GuestDetailsForm details={guestDetails} onChange={onGuestDetails} nicknameTaken={nicknameTaken} /> : <><ComplimentaryNights quote={quote} onChange={onComplimentaryDates} disabled={isSubmitting} />{vouchersError ? <Alert severity="warning" role="alert" sx={{ mt: 3 }} action={<Button color="inherit" size="small" onClick={onRetryVouchers}>{t('common:actions.retry')}</Button>}>{vouchersError}</Alert> : null}<FormControl fullWidth sx={{ mt: 3 }}><InputLabel id="voucher-label">{t('book.voucher')}</InputLabel><Select labelId="voucher-label" label={t('book.voucher')} value={voucherId} disabled={isSubmitting} onChange={(event) => { const value = String(event.target.value); onVoucher(value === '' ? '' : Number(value)); }}><MenuItem value="">{t('book.noVoucher')}</MenuItem>{vouchers.map((voucher) => { const isIneligible = !eligibleVoucherIds.has(voucher.id) || ineligibleVoucherKeys.has(voucherStayEligibilityKey(voucher.id, selectedOffer.room_type_id, search)); return <MenuItem key={voucher.id} value={voucher.id} disabled={isIneligible}>{voucher.promotion_name} ({voucher.code ?? voucher.code_masked}){isIneligible ? t('book.notEligible') : ''}{voucher.is_cancellable === false ? t('book.voucherNonCancellable') : ''}</MenuItem>; })}</Select></FormControl>{selectedVoucher && quote.voucher_name && <Alert severity="success" role="alert" sx={{ mt: 2 }}>{t('book.voucherApplied', { name: quote.voucher_name })}</Alert>}{quote.voucher_is_cancellable === false && <Alert severity="warning" role="alert" sx={{ mt: 2 }}>{t('book.voucherLocksCancellation')}</Alert>}</>}<ConsentBlock prompts={BOOKING_CONSENTS} state={consent} /><TextField label={t('book.specialRequests')} value={specialRequests} onChange={(event) => onRequests(event.target.value)} fullWidth multiline minRows={3} sx={{ mt: 3 }} slotProps={{
        htmlInput: { maxLength: 1000 }
      }} /><FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={cleaningPreference} onChange={(event) => onCleaning(event.target.checked)} />} label={t('book.dailyCleaning')} /><SmokingPreferenceField value={smokingPreference} onChange={onSmokingPreference} disabled={isSubmitting} /></Grid><Grid size={{ xs: 12, md: 5 }}><PriceSummary quote={quote} onBack={onBack} /></Grid></Grid></Paper>
  );
}

/**
 * Contact details for a booking made without an account.
 *
 * Deliberately short: a name, an email and the tourism type. Everything else a
 * stay eventually needs (IC, address, full party details) is collected at
 * check-in, so the booking itself stays fast.
 */
function GuestDetailsForm({ details, onChange, nicknameTaken }: { details: AnonymousGuestDetails; onChange: (value: AnonymousGuestDetails) => void; nicknameTaken: boolean }) {
  const { t } = useTranslation('guestPortal');
  const set = (patch: Partial<AnonymousGuestDetails>) => onChange({ ...details, ...patch });
  return (
    <Box component="section" aria-labelledby="guest-details-heading" sx={{ mt: 3 }}>
      <Typography id="guest-details-heading" variant="h6" component="h3">{t('book.yourDetails')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 2 }}>
        {t('book.detailsHint')}
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 12 }}>
          <TextField
            label={t('book.nickname')}
            required
            fullWidth
            value={details.first_name}
            onChange={(event) => set({ first_name: event.target.value })}
            error={nicknameTaken}
            helperText={nicknameTaken ? t('book.errors.nicknameTaken') : t('book.nicknameHint')}
            slotProps={{ htmlInput: { maxLength: 100, autoComplete: 'nickname' } }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label={t('book.email')} type="email" required fullWidth value={details.email} onChange={(event) => set({ email: event.target.value })} helperText={t('book.emailHint')} slotProps={{ htmlInput: { maxLength: 255, autoComplete: 'email' } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label={t('book.phone')} fullWidth value={details.phone ?? ''} onChange={(event) => set({ phone: event.target.value })} slotProps={{ htmlInput: { maxLength: 20, autoComplete: 'tel' } }} />
        </Grid>
        <Grid size={{ xs: 12 }}>
          {/* Never defaulted: this decides whether tourism tax is charged. */}
          <FormControl fullWidth required>
            <InputLabel id="tourism-type-label">{t('book.guestType')}</InputLabel>
            <Select labelId="tourism-type-label" label={t('book.guestType')} value={details.tourism_type} onChange={(event) => set({ tourism_type: event.target.value as AnonymousGuestDetails['tourism_type'] })}>
              <MenuItem value="local">{t('book.localTourist')}</MenuItem>
              <MenuItem value="foreign">{t('book.foreignTourist')}</MenuItem>
            </Select>
          </FormControl>
        </Grid>
      </Grid>
      <Alert severity="info" sx={{ mt: 2 }}>
        {t('book.anonymousLead')}{' '}
        <Box component="a" href="/login?redirect=%2Fguest-portal%3Fview%3Dbooking" sx={{ color: 'inherit', fontWeight: 700 }}>{t('book.signIn')}</Box>
        {' '}{t('book.anonymousTrail')}
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
function ComplimentaryNights({ quote, onChange, disabled = false }: { quote: GuestBookingQuote; onChange: (value: string[]) => void; disabled?: boolean }) {
  const { t } = useTranslation('guestPortal');
  const selected = quote.complimentary_dates ?? [];
  const available = quote.credits_available ?? 0;
  if (available <= 0) return null;
  const atLimit = selected.length >= available;
  const toggle = (date: string) => {
    onChange(selected.includes(date) ? selected.filter((value) => value !== date) : [...selected, date]);
  };
  return (
    <Card variant="outlined" sx={{ mt: 3, borderColor: 'var(--hotel-success-border)', bgcolor: 'var(--hotel-success-bg)' }}>
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            justifyContent: "space-between",
            alignItems: "center"
          }}>
          <Typography variant="subtitle1" component="div" sx={{
            fontWeight: 700
          }}>{t('book.useComplimentary')}</Typography>
          <Chip color="success" size="small" label={t('book.creditsAvailable', { count: available })} />
        </Stack>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mt: 0.5
          }}>
          {t('book.creditsHint', { count: available, room: quote.room_type_name })}
        </Typography>
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, mt: 1.5 }}>
          <Typography component="legend" variant="caption" sx={{
            color: "text.secondary"
          }}>{t('book.nightsOfStay')}</Typography>
          {quote.nightly_rates.map((rate) => {
            const isSelected = selected.includes(rate.date);
            return (
              <FormControlLabel
                key={rate.date}
                sx={{ display: 'flex', ml: 0, justifyContent: 'space-between' }}
                labelPlacement="start"
                control={<Checkbox checked={isSelected} disabled={disabled || (!isSelected && atLimit)} onChange={() => toggle(rate.date)} />}
                label={<Typography variant="body2" sx={{ textDecoration: isSelected ? 'line-through' : undefined }}>{rate.date} · {money(rate.amount, quote.currency)}</Typography>}
              />
            );
          })}
        </Box>
        {atLimit && selected.length > 0 ? (
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {t('book.creditsAtLimit', { count: available })}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PriceSummary({ quote, onBack }: { quote: GuestBookingQuote; onBack: () => void }) {
  const { t } = useTranslation('guestPortal');
  const complimentaryAmount = Number(quote.complimentary_discount) || 0;
  // `discount_amount` is the combined discount; show the voucher's share of it
  // separately so the guest can tell what each one saved them.
  const voucherAmount = (Number(quote.discount_amount) || 0) - complimentaryAmount;
  const settledByCredits = complimentaryAmount > 0 && Number(quote.total_amount) <= 0;
  return (
    <Card variant="outlined" sx={{ position: { md: 'sticky' }, top: { md: 92 } }}><CardContent><Typography variant="h6" component="h2">{t('book.priceSummary')}</Typography>{quote.nightly_rates.map((rate) => <Stack
      key={rate.date}
      direction="row"
      spacing={2}
      sx={{
        justifyContent: "space-between",
        mt: 1
      }}><Typography variant="body2">{rate.date}</Typography><Typography variant="body2">{money(rate.amount, quote.currency)}</Typography></Stack>)}<Divider sx={{ my: 2 }} /><SummaryLine label={t('book.subtotal')} value={money(quote.subtotal, quote.currency)} />{complimentaryAmount > 0 ? <SummaryLine label={t('book.complimentaryNights', { count: quote.complimentary_nights })} value={`-${money(complimentaryAmount, quote.currency)}`} color="success.main" /> : null}{voucherAmount > 0 ? <SummaryLine label={t('book.discount')} value={`-${money(voucherAmount, quote.currency)}`} color="success.main" /> : null}<SummaryLine label={t('book.tax')} value={money(quote.tax_amount, quote.currency)} /><Divider sx={{ my: 2 }} /><SummaryLine label={t('book.total')} value={money(quote.total_amount, quote.currency)} strong /><Alert severity={settledByCredits ? 'success' : 'info'} sx={{ mt: 2 }}>{settledByCredits ? t('book.coveredInFull') : t('book.payAfterSubmit')}</Alert><Box sx={{ mt: 2 }}>{quote.hold_release_hours != null && quote.hold_release_hours > 0 ? <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t('book.holdWindow', { hours: quote.hold_release_hours })}</Typography> : null}<Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>{t('book.cancellationSummary')}</Typography></Box><Stack direction={{ xs: 'column', sm: 'row', md: 'column' }} spacing={1} sx={{ mt: 3 }}><Button variant="outlined" onClick={onBack} sx={{ minHeight: 44 }}>{t('book.changeRoom')}</Button></Stack></CardContent></Card>
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

/** Soft smoking-room preference. Steers room allocation only; the helper text
 *  tells the guest it is not guaranteed, and '' (no preference) is the default. */
function SmokingPreferenceField({ value, onChange, disabled }: { value: SmokingPreference | ''; onChange: (value: SmokingPreference | '') => void; disabled: boolean }) {
  const { t } = useTranslation('guestPortal');
  return (
    <FormControl component="fieldset" sx={{ mt: 2, display: 'block' }} disabled={disabled}>
      <FormLabel component="legend" id="smoking-preference-label">{t('book.smokingPreference.label')}</FormLabel>
      <RadioGroup
        row
        name="smoking_preference"
        aria-labelledby="smoking-preference-label"
        aria-describedby="smoking-preference-helper"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === 'smoking' || next === 'non_smoking' ? next : '');
        }}
      >
        <FormControlLabel value="smoking" control={<Radio />} label={t('book.smokingPreference.smoking')} />
        <FormControlLabel value="non_smoking" control={<Radio />} label={t('book.smokingPreference.nonSmoking')} />
        <FormControlLabel value="" control={<Radio />} label={t('book.smokingPreference.noPreference')} />
      </RadioGroup>
      <FormHelperText id="smoking-preference-helper" sx={{ mx: 0 }}>{t('book.smokingPreference.helper')}</FormHelperText>
    </FormControl>
  );
}

function ConfirmationStage({ confirmation, token, paymentMode, isAnonymous, onStays, onAnother }: { confirmation: GuestBookingConfirmation; token: string | null; paymentMode: 'session' | 'token'; isAnonymous: boolean; onStays: () => void; onAnother: () => void }) {
  const { t } = useTranslation('guestPortal');
  const [paymentComplete, setPaymentComplete] = useState(confirmation.status === 'confirmed');
  const [completedPayment, setCompletedPayment] = useState<PaymentActionResponse | null>(null);
  const title = paymentComplete ? t('book.confirmation.confirmedTitle') : t('book.confirmation.payTitle');
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
      }}>{t('booking.bookingNumber')}</Typography><Typography
      variant="h3"
      component="div"
      sx={{
        color: "primary.main",
        mt: 0.5,
        fontVariantNumeric: 'tabular-nums'
      }}>{confirmation.booking_number}</Typography><Typography sx={{ mt: 3, fontWeight: 700 }}>{confirmation.room_type_name}</Typography><Typography sx={{
      color: "text.secondary"
    }}>{t('book.confirmation.stayDates', { checkIn: confirmation.check_in_date, checkOut: confirmation.check_out_date })}</Typography>{confirmation.smoking_preference ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{t('book.confirmation.smokingPreference', { value: confirmation.smoking_preference === 'smoking' ? t('book.smokingPreference.smoking') : t('book.smokingPreference.nonSmoking') })}</Typography> : null}<Typography variant="h5" component="div" sx={{ mt: 2 }}>{money(confirmation.total_amount, confirmation.currency)}</Typography><Box sx={{ mt: 3, textAlign: 'left' }}><GuestPaymentPanel mode={paymentMode} bookingId={confirmation.booking_id} token={token ?? ''} amount={confirmation.total_amount} currency={confirmation.currency} onPaid={handlePaymentResult} /></Box>{completedPayment ? <Paper component="section" aria-labelledby="payment-receipt-heading" variant="outlined" sx={{ mt: 3, p: 2.5, textAlign: 'left', bgcolor: 'var(--hotel-success-bg)', borderColor: 'var(--hotel-success-border)' }}><Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: "space-between",
        alignItems: "flex-start"
      }}><Box><Typography id="payment-receipt-heading" variant="h6" component="h2">{t('book.confirmation.receiptTitle')}</Typography><Typography variant="body2" sx={{
      color: "text.secondary"
    }}>{t('book.confirmation.receiptBody')}</Typography></Box><Chip color="success" label={t('dashboard.bookings.details.paid')} size="small" /></Stack><Divider sx={{ my: 2 }} /><SummaryLine label={t('dashboard.bookings.colBooking')} value={confirmation.booking_number} /><SummaryLine label={t('dashboard.bookings.details.receiptId')} value={`PAY-${completedPayment.payment_id}`} /><SummaryLine label={t('dashboard.bookings.details.stay')} value={`${confirmation.check_in_date} – ${confirmation.check_out_date}`} /><SummaryLine label={t('book.confirmation.amountPaid')} value={money(confirmation.total_amount, confirmation.currency)} strong /><Button variant="outlined" fullWidth sx={{ mt: 2 }} onClick={() => window.print()}>{t('dashboard.bookings.details.printReceipt')}</Button></Paper> : null}<Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{
        justifyContent: "center",
        mt: 3
      }}><Button variant="outlined" onClick={onStays}>{isAnonymous ? t('book.backToHotel') : t('dashboard.overview.viewStays')}</Button><Button variant="contained" onClick={onAnother}>{t('book.confirmation.bookAnother')}</Button></Stack><Alert severity="info" sx={{ mt: 3, textAlign: 'left' }}>{t('book.confirmation.emailNote')}{isAnonymous ? <> {t('book.confirmation.keepBookingPre')} <strong>{confirmation.booking_number}</strong>{t('book.confirmation.keepBookingPost')}</> : null}</Alert></Paper></Container>
  );
}

export default PortalBookingPage;
