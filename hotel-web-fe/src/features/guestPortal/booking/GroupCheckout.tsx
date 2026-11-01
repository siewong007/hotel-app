/**
 * Multi-room booking UI: the per-type quantity stepper, the sticky cart bar
 * and the group checkout / confirmation stages.
 *
 * Mobile-first: every control is at least 44px tall, the bar is pinned to the
 * bottom of the viewport (clear of the iOS home indicator) and the checkout
 * stacks into one column below `md`.
 */
import React, { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RemoveIcon from '@mui/icons-material/Remove';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Divider,
  FormControl, FormControlLabel, Grid, IconButton, InputLabel, MenuItem, Paper, Portal, Select,
  Stack, Typography,
} from '@mui/material';

import { useTranslation } from '../../../i18n';
import { numberFormatter } from '../../../i18n/format';
import { placementFromQuote, toggleCreditNight } from './creditPlacement';
import type { Voucher } from '../../promotions/types';
import { GuestPaymentPanel } from '../components/GuestPaymentPanel';
import type { PaymentActionResponse } from '../../../types';
import { type Cart, type CartRoom, MAX_CART_ROOMS } from './cart';
import type { GroupBookingConfirmation, GroupQuote, GroupCreditNight } from './types';

/** WCAG 2.5.5 / Apple HIG minimum touch target. */
export const TOUCH_TARGET = 44;

function money(amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return numberFormatter({ style: 'currency', currency }).format(Number.isFinite(value) ? value : 0);
}

const stepButtonSx = {
  width: TOUCH_TARGET,
  height: TOUCH_TARGET,
  border: '1px solid',
  borderColor: 'divider',
} as const;

/** Friendly, non-blocking notice when the cart sleeps fewer guests than searched. */
export function CapacityNotice({ capacity, partySize, compact = false }: { capacity: number; partySize: number; compact?: boolean }) {
  const { t } = useTranslation('guestPortal');
  if (capacity <= 0 || capacity >= partySize) return null;
  return (
    <Alert severity="warning" role="status" data-testid="capacity-notice" sx={compact ? { py: 0, mb: 1, '& .MuiAlert-message': { py: 0.75 } } : { mt: 2 }}>
      {t('book.cart.capacityShort', { count: capacity, guests: partySize })}
    </Alert>
  );
}

/** "− n +" with a visible count and a labelled live value. */
export function QuantityStepper({
  value, min = 0, max, onChange, label, disabled = false, decreaseLabel, increaseLabel,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
  disabled?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <Stack direction="row" spacing={1} role="group" aria-label={label} sx={{ alignItems: 'center' }}>
      <IconButton aria-label={decreaseLabel} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} sx={stepButtonSx}>
        <RemoveIcon />
      </IconButton>
      <Typography aria-live="polite" sx={{ minWidth: 28, textAlign: 'center', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      <IconButton aria-label={increaseLabel} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} color="primary" sx={{ ...stepButtonSx, borderColor: 'primary.main' }}>
        <AddIcon />
      </IconButton>
    </Stack>
  );
}

/** Per-offer "rooms of this type" stepper shown on every offer card. */
export function OfferRoomStepper({
  roomTypeName, count, remaining, onAdd, onRemove, disabled,
}: {
  roomTypeName: string;
  count: number;
  remaining: number;
  onAdd: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('guestPortal');
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('book.cart.roomsOfType')}</Typography>
      <QuantityStepper
        value={count}
        max={count + remaining}
        disabled={disabled}
        onChange={(next) => (next > count ? onAdd() : onRemove())}
        label={t('book.cart.roomsOfTypeLabel', { room: roomTypeName })}
        decreaseLabel={t('book.cart.removeRoom', { room: roomTypeName })}
        increaseLabel={t('book.cart.addRoom', { room: roomTypeName })}
      />
    </Stack>
  );
}

/**
 * The sticky bar. Visible whenever the cart holds a room — on the offer list
 * it reads "Checkout", inside checkout it submits ("Continue to payment").
 */
export function CartBar({
  roomCount, total, currency, estimated, phase, busy, onPrimary, primaryLabel, capacity = 0, partySize = 0,
}: {
  primaryLabel?: string;
  capacity?: number;
  partySize?: number;
  roomCount: number;
  total: number | string;
  currency: string;
  estimated: boolean;
  phase: 'browse' | 'checkout';
  busy: boolean;
  onPrimary: () => void;
}) {
  const { t } = useTranslation('guestPortal');
  if (roomCount < 1) return null;
  // Portalled to <body>: the app shell's <main> carries a transform from its
  // page transition, which would make `position: fixed` scroll with the page.
  return (
    <Portal>
    <Paper
      component="aside"
      aria-label={t('book.cart.barLabel')}
      elevation={8}
      data-testid="cart-bar"
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: (theme) => theme.zIndex.appBar,
        borderTop: '2px solid', borderColor: 'primary.main', borderRadius: 0,
        bgcolor: 'background.paper', backdropFilter: 'blur(8px)',
        px: { xs: 2, sm: 3 }, pt: 1.5, pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}><CapacityNotice capacity={capacity} partySize={partySize} compact /></Box>
      <Stack direction="row" spacing={2} sx={{ maxWidth: 1200, mx: 'auto', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
          <ShoppingBagOutlinedIcon color="primary" aria-hidden />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{t('book.cart.roomCount', { count: roomCount })}</Typography>
            <Typography variant="h6" component="div" sx={{ lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
              {estimated ? `≈ ${money(total, currency)}` : money(total, currency)}
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="contained"
          size="large"
          disabled={busy}
          onClick={onPrimary}
          sx={{ minHeight: TOUCH_TARGET, px: { xs: 2.5, sm: 4 }, flexShrink: 0, fontWeight: 700 }}
        >
          {busy ? <CircularProgress size={22} color="inherit" /> : primaryLabel ?? (phase === 'browse' ? t('book.cart.checkout') : t('book.continueToPayment'))}
        </Button>
      </Stack>
    </Paper>
    </Portal>
  );
}

function RoomLine({
  room, index, quoteTotal, currency, disabled, onChange, onRemove,
}: {
  room: CartRoom;
  index: number;
  quoteTotal?: string | number;
  currency: string;
  disabled: boolean;
  onChange: (patch: Partial<Pick<CartRoom, 'adults' | 'children' | 'extra_beds'>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('guestPortal');
  const name = `${t('book.cart.roomN', { n: index + 1 })} · ${room.room_type_name}`;
  return (
    <Card variant="outlined" component="li" sx={{ listStyle: 'none' }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{name}</Typography>
          <IconButton aria-label={t('book.cart.removeLine', { room: name })} disabled={disabled} onClick={onRemove} sx={{ width: TOUCH_TARGET, height: TOUCH_TARGET }}>
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('book.adults')}</Typography>
            <QuantityStepper value={room.adults} min={1} max={room.max_occupancy} disabled={disabled} onChange={(adults) => onChange({ adults })}
              label={`${name}: ${t('book.adults')}`} decreaseLabel={t('book.cart.fewer', { what: t('book.adults') })} increaseLabel={t('book.cart.more', { what: t('book.adults') })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('book.children')}</Typography>
            <QuantityStepper value={room.children} max={room.max_occupancy - room.adults} disabled={disabled} onChange={(children) => onChange({ children })}
              label={`${name}: ${t('book.children')}`} decreaseLabel={t('book.cart.fewer', { what: t('book.children') })} increaseLabel={t('book.cart.more', { what: t('book.children') })} />
          </Grid>
          {room.max_extra_beds > 0 ? (
            <Grid size={{ xs: 12, sm: 4 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('book.cart.extraBeds', { price: money(room.extra_bed_charge, room.currency) })}
              </Typography>
              <QuantityStepper value={room.extra_beds} max={room.max_extra_beds} disabled={disabled} onChange={(extra_beds) => onChange({ extra_beds })}
                label={`${name}: ${t('book.cart.extraBedsShort')}`} decreaseLabel={t('book.cart.fewer', { what: t('book.cart.extraBedsShort') })} increaseLabel={t('book.cart.more', { what: t('book.cart.extraBedsShort') })} />
            </Grid>
          ) : null}
        </Grid>
        {quoteTotal != null ? (
          <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('book.cart.roomTotal')}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{money(quoteTotal, currency)}</Typography>
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Line({ label, value, strong = false, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1, color }}>
      <Typography sx={{ fontWeight: strong ? 700 : undefined }}>{label}</Typography>
      <Typography sx={{ fontWeight: strong ? 700 : undefined, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Stack>
  );
}

/**
 * Per-room choice of which nights the complimentary credits cover. The quote
 * starts on the cheapest nights; the guest can move a credit to another room
 * of the same type (credits are per room type).
 */
export function CreditNightsPicker({ quote, disabled, onChange }: { quote: GroupQuote; disabled: boolean; onChange: (placement: GroupCreditNight[]) => void }) {
  const { t } = useTranslation('guestPortal');
  const current = placementFromQuote(quote);
  const balanceOf = (typeId: number) => Math.max(0, quote.credits_available.find((entry) => entry.room_type_id === typeId)?.nights_available ?? 0);
  const rooms = quote.rooms.filter((room) => balanceOf(room.quote.room_type_id) > 0);
  if (rooms.length === 0) return null;
  return (
    <Box component="fieldset" data-testid="credit-nights-picker" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, m: 0, mt: 1 }}>
      <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>{t('book.cart.creditNightsTitle')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('book.cart.creditNightsHint')}</Typography>
      {rooms.map((room) => {
        const name = `${t('book.cart.roomN', { n: room.index + 1 })} · ${room.quote.room_type_name}`;
        return (
          <Box key={room.index} sx={{ mt: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{name}</Typography>
            {room.quote.nightly_rates.map((rate) => {
              const checked = current.some((night) => night.room_index === room.index && night.date === rate.date);
              const next = toggleCreditNight(quote, current, room.index, rate.date);
              return (
                <FormControlLabel
                  key={rate.date}
                  sx={{ display: 'flex', ml: 0, justifyContent: 'space-between', minHeight: TOUCH_TARGET }}
                  labelPlacement="start"
                  control={<Checkbox checked={checked} disabled={disabled || next === null} onChange={() => { if (next) onChange(next); }}
                    slotProps={{ input: { 'aria-label': t('book.cart.creditNightLabel', { room: name, date: rate.date }) } }} />}
                  label={<Typography variant="body2" sx={{ textDecoration: checked ? 'line-through' : undefined }}>{rate.date} · {money(rate.amount, quote.currency)}</Typography>}
                />
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

export function GroupSummary({ quote }: { quote: GroupQuote }) {
  const { t } = useTranslation('guestPortal');
  const credits = Number(quote.complimentary_discount) || 0;
  const voucher = Number(quote.voucher_discount) || 0;
  const extraBeds = Number(quote.extra_bed_charge) || 0;
  const settled = Number(quote.total_amount) <= 0;
  return (
    <Card variant="outlined" sx={{ position: { md: 'sticky' }, top: { md: 92 } }}>
      <CardContent>
        <Typography variant="h6" component="h2">{t('book.priceSummary')}</Typography>
        <Line label={t('book.cart.roomCount', { count: quote.room_count })} value={money(quote.subtotal, quote.currency)} />
        {extraBeds > 0 ? <Line label={t('book.cart.extraBedsShort')} value={money(extraBeds, quote.currency)} /> : null}
        {credits > 0 ? <Line label={t('book.complimentaryNights', { count: quote.complimentary_nights })} value={`-${money(credits, quote.currency)}`} color="success.main" /> : null}
        {voucher > 0 ? <Line label={quote.voucher_name ?? t('book.discount')} value={`-${money(voucher, quote.currency)}`} color="success.main" /> : null}
        <Line label={t('book.tax')} value={money(quote.tax_amount, quote.currency)} />
        <Divider sx={{ my: 2 }} />
        <Line label={t('book.total')} value={money(quote.total_amount, quote.currency)} strong />
        <Alert severity={settled ? 'success' : 'info'} sx={{ mt: 2 }}>{settled ? t('book.coveredInFull') : t('book.cart.payOnce')}</Alert>
        {quote.hold_release_hours ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
            {t('book.cart.holdWindow', { hours: quote.hold_release_hours })}
          </Typography>
        ) : null}
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>{t('book.cancellationSummary')}</Typography>
      </CardContent>
    </Card>
  );
}

export function GroupCheckoutStage({
  cart, quote, isQuoting, isSubmitting, isAnonymous, capacity, partySize, vouchers, voucherId, useCredits,
  onVoucher, onUseCredits, onCreditPlacement, onChangeRoom, onRemoveRoom, onAddMore, details, consent, extras,
}: {
  cart: Cart;
  quote: GroupQuote | null;
  isQuoting: boolean;
  isSubmitting: boolean;
  isAnonymous: boolean;
  capacity: number;
  partySize: number;
  vouchers: Voucher[];
  voucherId: number | '';
  useCredits: boolean;
  onVoucher: (value: number | '') => void;
  onUseCredits: (value: boolean) => void;
  /** Move credits between room-nights (signed-in only). */
  onCreditPlacement?: (placement: GroupCreditNight[]) => void;
  onChangeRoom: (lineId: string, patch: Partial<Pick<CartRoom, 'adults' | 'children' | 'extra_beds'>>) => void;
  onRemoveRoom: (lineId: string) => void;
  onAddMore: () => void;
  /** Contact details (anonymous only). */
  details: React.ReactNode;
  consent: React.ReactNode;
  /** Special requests, cleaning and smoking preference. */
  extras: React.ReactNode;
}) {
  const { t } = useTranslation('guestPortal');
  const busy = isQuoting || isSubmitting;
  const creditTotal = quote?.credits_available.reduce((sum, balance) => sum + Math.max(0, balance.nights_available), 0) ?? 0;
  const currency = quote?.currency ?? cart.rooms[0]?.currency ?? 'MYR';
  return (
    <Paper component="section" aria-labelledby="group-checkout-heading" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider' }}>
      <Grid container spacing={4}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Typography id="group-checkout-heading" variant="h5" component="h2">{t('book.cart.title')}</Typography>
            <Chip label={t('book.cart.stay', { checkIn: cart.check_in_date, checkOut: cart.check_out_date })} size="small" />
 </Stack>
          <CapacityNotice capacity={capacity} partySize={partySize} />
          <Box component="ol" sx={{ p: 0, m: 0, mt: 2, display: 'grid', gap: 2 }}>
            {cart.rooms.map((room, index) => (
              <RoomLine
                key={room.line_id}
                room={room}
                index={index}
                currency={currency}
                quoteTotal={quote?.rooms[index]?.room_total}
                disabled={busy}
                onChange={(patch) => onChangeRoom(room.line_id, patch)}
                onRemove={() => onRemoveRoom(room.line_id)}
              />
            ))}
          </Box>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={onAddMore} disabled={isSubmitting || cart.rooms.length >= MAX_CART_ROOMS}
            sx={{ mt: 2, minHeight: TOUCH_TARGET }} fullWidth>
            {cart.rooms.length >= MAX_CART_ROOMS ? t('book.cart.maxRooms', { count: MAX_CART_ROOMS }) : t('book.cart.addMore')}
          </Button>
          {!isAnonymous ? (
            <Box sx={{ mt: 3 }}>
              {creditTotal > 0 ? (
                <FormControlLabel
                  sx={{ minHeight: TOUCH_TARGET }}
                  control={<Checkbox checked={useCredits} disabled={busy} onChange={(event) => onUseCredits(event.target.checked)} />}
                  label={t('book.cart.useCredits', { count: creditTotal })}
                />
              ) : null}
              {creditTotal > 0 && useCredits && quote && onCreditPlacement ? (
                <CreditNightsPicker quote={quote} disabled={busy} onChange={onCreditPlacement} />
              ) : null}
              <FormControl fullWidth sx={{ mt: 1 }}>
                <InputLabel id="group-voucher-label">{t('book.voucher')}</InputLabel>
                <Select labelId="group-voucher-label" label={t('book.voucher')} value={voucherId} disabled={busy}
                  onChange={(event) => { const value = String(event.target.value); onVoucher(value === '' ? '' : Number(value)); }}>
                  <MenuItem value="">{t('book.noVoucher')}</MenuItem>
                  {vouchers.map((voucher) => (
                    <MenuItem key={voucher.id} value={voucher.id}>
                      {voucher.promotion_name} ({voucher.code ?? voucher.code_masked}){voucher.is_cancellable === false ? t('book.voucherNonCancellable') : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {quote?.voucher_name ? <Alert severity="success" sx={{ mt: 2 }}>{t('book.voucherApplied', { name: quote.voucher_name })}</Alert> : null}
              {quote?.voucher_is_cancellable === false ? <Alert severity="warning" sx={{ mt: 2 }}>{t('book.voucherLocksCancellation')}</Alert> : null}
            </Box>
          ) : null}
          {details}
          {consent}
          {extras}
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          {quote ? <GroupSummary quote={quote} /> : (
            <Card variant="outlined"><CardContent><Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}><CircularProgress size={22} /><Typography>{t('book.confirmingPrice')}</Typography></Stack></CardContent></Card>
          )}
        </Grid>
      </Grid>
    </Paper>
  );
}

export function GroupConfirmationStage({
  confirmation, token, paymentMode, isAnonymous, onStays, onAnother,
}: {
  confirmation: GroupBookingConfirmation;
  token: string | null;
  paymentMode: 'session' | 'token';
  isAnonymous: boolean;
  onStays: () => void;
  onAnother: () => void;
}) {
  const { t } = useTranslation('guestPortal');
  const owed = Number(confirmation.total_amount) > 0 && confirmation.status !== 'confirmed';
  const [paid, setPaid] = useState<PaymentActionResponse | null>(null);
  const done = !owed || paid?.status === 'completed';
  return (
    <Paper role="status" aria-live="polite" sx={{ p: { xs: 3, sm: 5 }, border: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ textAlign: 'center' }}>
        <CheckCircleIcon color={done ? 'success' : 'primary'} sx={{ fontSize: 64 }} />
        <Typography variant="h4" component="h1" sx={{ mt: 2 }}>
          {done ? t('book.confirmation.confirmedTitle') : t('book.confirmation.payTitle')}
        </Typography>
        <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', mt: 2 }}>{t('book.cart.groupNumber')}</Typography>
        <Typography variant="h3" component="div" sx={{ color: 'primary.main', mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{confirmation.group_number}</Typography>
        <Typography sx={{ color: 'text.secondary', mt: 1 }}>
          {t('book.confirmation.stayDates', { checkIn: confirmation.check_in_date, checkOut: confirmation.check_out_date })}
        </Typography>
      </Box>
      <Box component="ul" sx={{ p: 0, m: 0, mt: 3, listStyle: 'none' }}>
        {confirmation.rooms.map((room, index) => (
          <Stack component="li" key={room.booking_id} direction="row" spacing={2} sx={{ justifyContent: 'space-between', py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>{t('book.cart.roomN', { n: index + 1 })} · {room.room_type_name}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{room.booking_number}</Typography>
            </Box>
            <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(room.total_amount, room.currency)}</Typography>
          </Stack>
        ))}
      </Box>
      <Line label={t('book.total')} value={money(confirmation.total_amount, confirmation.currency)} strong />
      {owed ? (
        <Box sx={{ mt: 3 }}>
          <GuestPaymentPanel
            mode={paymentMode}
            groupId={confirmation.group_id}
            token={token ?? ''}
            amount={confirmation.total_amount}
            currency={confirmation.currency}
            paymentMethodName="group-payment-method"
            onPaid={setPaid}
          />
        </Box>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'center', mt: 3 }}>
        <Button variant="outlined" onClick={onStays} sx={{ minHeight: TOUCH_TARGET }}>{isAnonymous ? t('book.backToHotel') : t('dashboard.overview.viewStays')}</Button>
        <Button variant="contained" onClick={onAnother} sx={{ minHeight: TOUCH_TARGET }}>{t('book.confirmation.bookAnother')}</Button>
      </Stack>
      <Alert severity="info" sx={{ mt: 3 }}>
        {t('book.cart.emailNote')}
        {isAnonymous ? <> {t('book.confirmation.keepBookingPre')} <strong>{confirmation.group_number}</strong>{t('book.confirmation.keepBookingPost')}</> : null}
      </Alert>
    </Paper>
  );
}
