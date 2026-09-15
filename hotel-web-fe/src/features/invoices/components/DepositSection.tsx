import React, { useRef, useState } from 'react';
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Collapse,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material';
import {
  DiscFullOutlined as DepositIcon,
  RadioButtonChecked as RadioCheckedIcon,
  RadioButtonUnchecked as RadioUncheckedIcon,
} from '@mui/icons-material';
import StatusChip from '../../../components/common/StatusChip';
import type { StatusTone } from '../../../components/common/StatusChip';
import { useCurrency } from '../../../hooks/useCurrency';
import { useTranslation } from '../../../i18n';
import { formatHotelDateTime } from '../../../utils/date';
import type { HotelSettings } from '../../../utils/hotelSettings';
import { isGreaterMoney, isPositiveMoney, subtractMoney, toMoneyNumber } from '../../../utils/money';
import type { DepositResolution, DepositResolutionStatus } from '../hooks/useDepositResolution';

export interface DepositRefundInput {
  method: string;
  reference?: string;
  note?: string;
}

export interface DepositForfeitInput {
  amount: number;
  reason: string;
  notes?: string;
}

/**
 * Guided deposit-resolution contract — the modal computes `can.*` from
 * `useAuth().hasPermission` and forwards `useDepositResolution`'s
 * `deposit`/busy flags/actions verbatim.
 */
export interface DepositResolutionSectionProps {
  /** Derived deposit lifecycle from `useDepositResolution`. */
  resolution: DepositResolution;
  busy: {
    refunding: boolean;
    forfeiting: boolean;
    cancelling: boolean;
    reverting: boolean;
    restoring: boolean;
  };
  can: {
    /** `payments:refund`. */ refund: boolean;
    /** `payments:refund`. */ forfeit: boolean;
    /** `payments:delete` or `bookings:update` (the action auto-routes). */ cancel: boolean;
    /** `payments:manage`. */ revertRefund: boolean;
    /** `payments:delete`. */ restore: boolean;
  };
  readOnly: boolean;
  /**
   * Label override for the 'none' status chip — e.g. 'City Ledger - N/A'
   * for company-billing bookings where a deposit does not apply.
   */
  noDepositLabel?: string;
  hotelSettings: Pick<HotelSettings, 'payment_methods'>;
  onRefund: (input: DepositRefundInput) => void;
  onForfeit: (input: DepositForfeitInput) => void;
  onCancel: (reason: string) => void;
  onRevertRefund: () => void;
  onRestore: () => void;
}

export type DepositSectionProps = DepositResolutionSectionProps;

type ResolutionChoice = 'refund' | 'forfeit' | 'cancel';

const DEFAULT_REFUND_METHODS = ['Cash', 'Bank Transfer', 'E-Wallet', 'Other'];

const FORFEIT_REASONS = [
  { value: 'ROOM_DAMAGE', labelKey: 'deposit.forfeitReason.roomDamage', apiLabel: 'Room damage' },
  { value: 'MISSING_ITEM', labelKey: 'deposit.forfeitReason.missingItem', apiLabel: 'Missing item or key' },
  { value: 'OUTSTANDING_CHARGE', labelKey: 'deposit.forfeitReason.outstandingCharge', apiLabel: 'Outstanding charge' },
  { value: 'OTHER', labelKey: 'deposit.forfeitReason.other', apiLabel: 'Other' },
] as const;

/** Exported so the modal's confirm step can reuse the same chip wording. */
export const DEPOSIT_STATUS_CHIP: Record<DepositResolutionStatus, { labelKey: string; tone: StatusTone }> = {
  none: { labelKey: 'deposit.chip.none', tone: 'neutral' },
  pending: { labelKey: 'deposit.chip.pending', tone: 'warning' },
  refunded: { labelKey: 'deposit.chip.refunded', tone: 'success' },
  partially_forfeited: { labelKey: 'deposit.chip.partiallyForfeited', tone: 'warning' },
  forfeited: { labelKey: 'deposit.chip.forfeited', tone: 'warning' },
  cancelled: { labelKey: 'deposit.chip.cancelled', tone: 'neutral' },
  waived: { labelKey: 'deposit.chip.waived', tone: 'neutral' },
};

const cardSx = {
  border: '1px solid var(--hotel-border)',
  borderRadius: 2,
  bgcolor: 'var(--hotel-surface)',
  overflow: 'hidden',
  mb: 3,
} as const;

/** Foreground color for a strip/icon — 'neutral' has no palette key. */
const toneColor = (theme: Theme, tone: StatusTone): string => {
  switch (tone) {
    case 'neutral':
      return theme.palette.text.secondary;
    case 'primary':
      return theme.palette.primary.main;
    case 'secondary':
      return theme.palette.secondary.main;
    default:
      return theme.palette[tone].main;
  }
};

/** One-line tinted strip used by every resolved deposit state. */
const ResolutionStrip: React.FC<{
  tone: 'success' | 'warning' | 'neutral';
  title: React.ReactNode;
  caption?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ tone, title, caption, actions }) => (
  <Box
    sx={(theme: Theme) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      flexWrap: 'wrap',
      px: 1.5,
      py: 1.25,
      borderRadius: 1,
      bgcolor: alpha(toneColor(theme, tone), 0.08),
      borderLeft: `3px solid ${toneColor(theme, tone)}`,
    })}
  >
    <Box sx={{ flex: 1, minWidth: 160 }}>
      <Typography
        variant="body2"
        sx={(theme: Theme) => ({ fontWeight: 600, color: toneColor(theme, tone) })}
      >
        {title}
      </Typography>
      {caption ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          {caption}
        </Typography>
      ) : null}
    </Box>
    {actions}
  </Box>
);

interface PanelProps {
  formatMoney: (value: number) => string;
}

/** Refund is always the full remaining balance — the backend's one-active-refund rule makes partial refunds a trap. */
const RefundPanel: React.FC<PanelProps & {
  amount: number;
  methods: string[];
  busy: boolean;
  onSubmit: (input: DepositRefundInput) => void;
}> = ({ amount, methods, busy, formatMoney, onSubmit }) => {
  const { t } = useTranslation('finance');
  const [method, setMethod] = useState(methods[0] ?? 'Cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('deposit.refund.fixedNote')}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(amount)}
        </Typography>
      </Box>
      <Grid container spacing={1}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="deposit-refund-method-label">{t('deposit.refund.method')}</InputLabel>
            <Select
              labelId="deposit-refund-method-label"
              label={t('deposit.refund.method')}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {methods.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label={t('checkout.field.referenceOptional')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label={t('deposit.refund.noteOptional')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Grid>
      </Grid>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant="contained"
          color="success"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
          onClick={() =>
            onSubmit({
              method,
              reference: reference.trim() || undefined,
              note: note.trim() || undefined,
            })
          }
          sx={{ fontSize: '0.75rem', py: 0.5 }}
        >
          {t('deposit.refund.submit', { amount: formatMoney(amount) })}
        </Button>
      </Box>
    </Box>
  );
};

/** Amount + categorized reason, then an inline review of the retain/refund split before the destructive submit. */
const ForfeitPanel: React.FC<PanelProps & {
  remaining: number;
  busy: boolean;
  currencySymbol: string;
  onSubmit: (input: DepositForfeitInput) => void;
}> = ({ remaining, busy, currencySymbol, formatMoney, onSubmit }) => {
  const { t } = useTranslation('finance');
  const [amountInput, setAmountInput] = useState(remaining.toFixed(2));
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState(false);

  const amount = toMoneyNumber(amountInput);
  const overCeiling = isGreaterMoney(amount, remaining);
  const notPositive = !isPositiveMoney(amount);
  const reason = FORFEIT_REASONS.find((r) => r.value === reasonCode);
  const reasonLabelKey = reason?.labelKey;
  const reasonApiLabel = reason?.apiLabel ?? '';
  const notesRequired = reasonCode === 'OTHER';
  const reasonValid = reasonCode !== '' && (!notesRequired || notes.trim() !== '');
  const canReview = !notPositive && !overCeiling && reasonValid;
  const remainder = isPositiveMoney(subtractMoney(remaining, amount))
    ? subtractMoney(remaining, amount)
    : 0;

  const amountHelper = (() => {
    if (amountInput.trim() === '') return t('deposit.forfeit.helpEmpty', { amount: formatMoney(remaining) });
    if (overCeiling) return t('deposit.forfeit.helpOver', { amount: formatMoney(remaining) });
    if (notPositive) return t('deposit.forfeit.helpNotPositive');
    return t('deposit.forfeit.helpRemainder', { amount: formatMoney(remainder) });
  })();

  if (review) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box
          sx={(theme: Theme) => ({
            p: 1.5,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.warning.main, 0.08),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
          })}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('deposit.forfeit.reviewNote', { amount: formatMoney(amount), remainder: formatMoney(remainder) })}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
            {t('deposit.forfeit.reviewReason', { reason: reasonLabelKey ? t(reasonLabelKey) : '' })}
            {notes.trim() ? ` — ${notes.trim()}` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button size="small" variant="text" onClick={() => setReview(false)} disabled={busy}>
            {t('common:actions.back')}
          </Button>
          <Button
            size="small"
            variant="contained"
            color="error"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={14} /> : undefined}
            onClick={() =>
              onSubmit({ amount, reason: reasonApiLabel, notes: notes.trim() || undefined })
            }
            sx={{ fontSize: '0.75rem', py: 0.5 }}
          >
            {t('deposit.forfeit.submit', { amount: formatMoney(amount) })}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('deposit.forfeit.intro')}
      </Typography>
      <Grid container spacing={1}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label={t('deposit.forfeit.amount')}
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            error={amountInput.trim() !== '' && (overCeiling || notPositive)}
            helperText={amountHelper}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">{currencySymbol}</InputAdornment>
                ),
              },
              htmlInput: { inputMode: 'decimal' },
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="deposit-forfeit-reason-label">{t('deposit.forfeit.reason')}</InputLabel>
            <Select
              labelId="deposit-forfeit-reason-label"
              label={t('deposit.forfeit.reason')}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {FORFEIT_REASONS.map((r) => (
                <MenuItem key={r.value} value={r.value}>
                  {t(r.labelKey)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label={t('deposit.forfeit.staffNotes')}
            required={notesRequired}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            helperText={notesRequired ? t('deposit.forfeit.notesRequired') : undefined}
          />
        </Grid>
      </Grid>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={!canReview || busy}
          onClick={() => setReview(true)}
          sx={{ fontSize: '0.75rem', py: 0.5 }}
        >
          {t('deposit.forfeit.review')}
        </Button>
      </Box>
    </Box>
  );
};

/** For a deposit that was recorded but never collected — auto-routes to waive (no rows) or void (rows). */
const CancelPanel: React.FC<PanelProps & {
  recorded: number;
  busy: boolean;
  onSubmit: (reason: string) => void;
}> = ({ recorded, busy, formatMoney, onSubmit }) => {
  const { t } = useTranslation('finance');
  const [reason, setReason] = useState('');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t('deposit.cancel.recorded')}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(recorded)}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('deposit.cancel.note')}
      </Typography>
      <TextField
        size="small"
        fullWidth
        required
        label={t('deposit.cancel.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Alert severity="warning" sx={{ py: 0.5 }}>
        {t('deposit.cancel.noRefund')}
      </Alert>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          variant="contained"
          color="warning"
          disabled={!reason.trim() || busy}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
          onClick={() => onSubmit(reason.trim())}
          sx={{ fontSize: '0.75rem', py: 0.5 }}
        >
          {t('deposit.cancel.submit')}
        </Button>
      </Box>
    </Box>
  );
};

/**
 * Guided deposit-resolution card for the checkout invoice. Pending deposits
 * pick one of three radio-style options (refund / forfeit / cancel
 * uncollected) and only the selected form expands; resolved states render a
 * single status strip. Presentational only — derivation and mutations arrive
 * via props from `useDepositResolution`, wired by CheckoutInvoiceModal.
 */
const DepositSection: React.FC<DepositResolutionSectionProps> = ({
  resolution,
  busy,
  can,
  readOnly,
  noDepositLabel,
  hotelSettings,
  onRefund,
  onForfeit,
  onCancel,
  onRevertRefund,
  onRestore,
}) => {
  const { t } = useTranslation('finance');
  const { format: formatMoney, symbol: currencySymbol } = useCurrency();
  const [selected, setSelected] = useState<ResolutionChoice | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The amount actually held: the refundable ledger remainder — or the
  // mirror's post-mint ceiling when the booking asserts more than the rows
  // show (flag-only legacy deposit, or rows that under-cover the mirror).
  // Matches what `refund` in useDepositResolution will actually draw, so the
  // CTA amount is honest.
  const postMintCeiling = subtractMoney(
    subtractMoney(resolution.mirrorDue, resolution.refunded),
    resolution.forfeited,
  );
  const held = isGreaterMoney(postMintCeiling, resolution.remaining)
    ? postMintCeiling
    : resolution.remaining;
  const pending = resolution.status === 'pending';
  const chip = DEPOSIT_STATUS_CHIP[resolution.status];
  const chipLabel =
    resolution.status === 'none' && noDepositLabel ? noDepositLabel : t(chip.labelKey);
  const methods = hotelSettings.payment_methods.length
    ? hotelSettings.payment_methods
    : DEFAULT_REFUND_METHODS;

  const collectedLine = isPositiveMoney(resolution.collected)
    ? t('deposit.collectedLine', {
        amount: formatMoney(resolution.collected),
        method: resolution.method ? ` via ${resolution.method}` : '',
        at: resolution.collectedAt ? ` · ${formatHotelDateTime(resolution.collectedAt)}` : '',
      })
    : isPositiveMoney(resolution.mirrorDue)
      ? t('deposit.recordedOnBooking', {
          at: resolution.collectedAt ? ` · ${formatHotelDateTime(resolution.collectedAt)}` : '',
        })
      : null;
  // Only non-zero legs render — a fresh pending deposit reads "Remaining
  // RM50.00", not "Refunded RM0.00 · …". Remaining always shows: it is the
  // ledger's still-held answer regardless of the other legs.
  const breakdownLine =
    isPositiveMoney(resolution.refunded)
    || isPositiveMoney(resolution.forfeited)
    || isPositiveMoney(resolution.remaining)
      ? [
          isPositiveMoney(resolution.refunded)
            ? t('deposit.leg.refunded', { amount: formatMoney(resolution.refunded) })
            : null,
          isPositiveMoney(resolution.forfeited)
            ? t('deposit.leg.forfeited', { amount: formatMoney(resolution.forfeited) })
            : null,
          t('deposit.leg.remaining', { amount: formatMoney(resolution.remaining) }),
        ]
          .filter((leg): leg is string => leg !== null)
          .join(' · ')
      : null;

  const options: Array<{
    key: ResolutionChoice;
    title: string;
    description: string;
    enabled: boolean;
    disabledReason?: string;
  }> = [
    {
      key: 'refund',
      title: t('deposit.option.refund.title'),
      description: t('deposit.option.refund.description', { amount: formatMoney(held) }),
      enabled: can.refund,
      disabledReason: t('deposit.option.requiresRefundPerm'),
    },
    {
      key: 'forfeit',
      title: t('deposit.option.forfeit.title'),
      description: t('deposit.option.forfeit.description'),
      enabled: can.forfeit && isPositiveMoney(resolution.remaining),
      disabledReason: !can.forfeit
        ? t('deposit.option.requiresRefundPerm')
        : t('deposit.option.noDepositToForfeit'),
    },
    {
      key: 'cancel',
      title: t('deposit.option.cancel.title'),
      description: t('deposit.option.cancel.description'),
      enabled: can.cancel,
      // The cancel action auto-routes on the same row count the modal's
      // permission gate uses: completed rows → per-row void
      // (payments:delete); none → the booking-mirror waive
      // (bookings:update). Name the permission the route actually needs.
      disabledReason: resolution.completedDepositCount > 0
        ? t('deposit.option.requiresDeletePerm')
        : t('deposit.option.requiresBookingsPerm'),
    },
  ];

  // While any resolution action is in flight the choice is locked — the
  // `key`-remount would otherwise drop a submitting form mid-flight.
  const anyBusy =
    busy.refunding || busy.forfeiting || busy.cancelling || busy.reverting || busy.restoring;

  // Radio-group keyboard behavior: arrows/Home/End always move focus to the
  // target option — a permission-disabled option is still focusable — and
  // only the SELECTION is skipped when that option is disabled or a
  // resolution action is busy. Enter/Space select the focused option under
  // the same gate; preventDefault keeps the native button activation from
  // double-firing the click.
  const handleOptionKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (options[index].enabled && !anyBusy) setSelected(options[index].key);
      return;
    }
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (index + 1) % options.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (index + options.length - 1) % options.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = options.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
    if (options[next].enabled && !anyBusy) setSelected(options[next].key);
  };

  const resolvedStrip = (() => {
    switch (resolution.status) {
      case 'refunded':
        return (
          <ResolutionStrip
            tone="success"
            title={t('deposit.strip.refunded')}
            caption={t('deposit.strip.refundedCaption', {
              amount: formatMoney(resolution.refunded),
              method: resolution.refundMethod ? ` via ${resolution.refundMethod}` : '',
              at: resolution.refundedAt ? ` · ${formatHotelDateTime(resolution.refundedAt)}` : '',
              ref: resolution.refundReference ? ` · Ref ${resolution.refundReference}` : '',
            })}
            actions={
              can.revertRefund && !readOnly ? (
                <Button
                  size="small"
                  variant="text"
                  color="warning"
                  onClick={onRevertRefund}
                  disabled={busy.reverting}
                  startIcon={busy.reverting ? <CircularProgress size={14} /> : undefined}
                  sx={{ fontSize: '0.75rem' }}
                >
                  {t('deposit.revertRefund')}
                </Button>
              ) : undefined
            }
          />
        );
      case 'forfeited':
      case 'partially_forfeited':
        return (
          <ResolutionStrip
            tone="warning"
            title={
              resolution.status === 'partially_forfeited'
                ? t('deposit.strip.partiallyForfeited')
                : t('deposit.strip.forfeited')
            }
            caption={t('deposit.strip.forfeitedCaption', {
              amount: formatMoney(resolution.forfeited),
              reason: resolution.forfeitReason ? ` — ${resolution.forfeitReason}` : '',
              remainder: isPositiveMoney(resolution.refunded)
                ? ` · ${t('deposit.strip.remainderRefunded', { amount: formatMoney(resolution.refunded) })}`
                : '',
            })}
          />
        );
      case 'cancelled':
      case 'waived':
        return (
          <ResolutionStrip
            tone="neutral"
            title={t('deposit.strip.cancelled')}
            caption={
              resolution.status === 'waived'
                ? t('deposit.strip.waivedCaption')
                : t('deposit.strip.voidedCaption')
            }
            actions={
              resolution.status === 'cancelled'
              && resolution.voidedDepositCount > 0
              && can.restore
              && !readOnly ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={onRestore}
                  disabled={busy.restoring}
                  startIcon={busy.restoring ? <CircularProgress size={14} /> : undefined}
                  sx={{ fontSize: '0.75rem' }}
                >
                  {t('deposit.restoreDeposit')}
                </Button>
              ) : undefined
            }
          />
        );
      default:
        return null;
    }
  })();

  return (
    <Box sx={cardSx}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, flexWrap: 'wrap' }}>
        <Box
          sx={(theme: Theme) => ({
            width: 32,
            height: 32,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            bgcolor: alpha(toneColor(theme, chip.tone), 0.12),
            color: toneColor(theme, chip.tone),
          })}
        >
          <DepositIcon fontSize="small" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('deposit.securityDeposit')}
          </Typography>
          {collectedLine ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              {collectedLine}
            </Typography>
          ) : null}
          {breakdownLine ? (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              {breakdownLine}
            </Typography>
          ) : null}
        </Box>
        {isPositiveMoney(held) ? (
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatMoney(held)}
          </Typography>
        ) : null}
        <StatusChip status={resolution.status} label={chipLabel} tone={chip.tone} />
      </Box>

      {pending && !readOnly ? (
        <Box
          sx={{
            px: 1.5,
            py: 1.5,
            borderTop: '1px solid var(--hotel-border-subtle)',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('deposit.resolvePrompt')}
          </Typography>
          <Box
            role="radiogroup"
            aria-label={t('deposit.resolveGroup')}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {options.map((option, index) => (
              <ButtonBase
                key={option.key}
                ref={(el: HTMLButtonElement | null) => {
                  optionRefs.current[index] = el;
                }}
                role="radio"
                aria-checked={selected === option.key}
                aria-disabled={!option.enabled || anyBusy}
                tabIndex={selected ? (selected === option.key ? 0 : -1) : index === 0 ? 0 : -1}
                onClick={() => option.enabled && !anyBusy && setSelected(option.key)}
                onKeyDown={(e) => handleOptionKeyDown(e, index)}
                sx={(theme: Theme) => ({
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.25,
                  width: '100%',
                  px: 1.5,
                  py: 1.25,
                  textAlign: 'left',
                  borderRadius: 1.5,
                  border: '1px solid',
                  borderColor:
                    selected === option.key ? theme.palette.primary.main : 'divider',
                  bgcolor:
                    selected === option.key
                      ? alpha(theme.palette.primary.main, 0.06)
                      : 'transparent',
                  opacity: option.enabled && !anyBusy ? 1 : 0.55,
                  cursor: option.enabled && !anyBusy ? 'pointer' : 'not-allowed',
                  transition: theme.transitions.create(['border-color', 'background-color']),
                  '&:hover': option.enabled && !anyBusy
                    ? { bgcolor: alpha(theme.palette.primary.main, 0.04) }
                    : {},
                })}
              >
                {selected === option.key ? (
                  <RadioCheckedIcon fontSize="small" sx={{ color: 'primary.main', mt: '1px' }} />
                ) : (
                  <RadioUncheckedIcon
                    fontSize="small"
                    sx={{ color: 'text.disabled', mt: '1px' }}
                  />
                )}
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {option.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', color: 'text.secondary' }}
                  >
                    {option.description}
                  </Typography>
                  {!option.enabled && option.disabledReason ? (
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', color: 'warning.main' }}
                    >
                      {option.disabledReason}
                    </Typography>
                  ) : null}
                </Box>
              </ButtonBase>
            ))}
          </Box>
          <Collapse in={selected !== null} unmountOnExit>
            {/* `key` remounts the panel on option switch so each form starts clean. */}
            <Box
              key={selected ?? 'none'}
              sx={{
                mt: 1.5,
                p: 1.5,
                border: '1px solid var(--hotel-border-subtle)',
                borderRadius: 1.5,
                bgcolor: 'var(--hotel-surface-sunken)',
              }}
            >
              {selected === 'refund' && (
                <RefundPanel
                  amount={held}
                  methods={methods}
                  busy={busy.refunding}
                  formatMoney={formatMoney}
                  onSubmit={onRefund}
                />
              )}
              {selected === 'forfeit' && (
                <ForfeitPanel
                  remaining={resolution.remaining}
                  busy={busy.forfeiting}
                  currencySymbol={currencySymbol}
                  formatMoney={formatMoney}
                  onSubmit={onForfeit}
                />
              )}
              {selected === 'cancel' && (
                <CancelPanel
                  recorded={
                    isPositiveMoney(resolution.collected)
                      ? resolution.collected
                      : resolution.mirrorDue
                  }
                  busy={busy.cancelling}
                  formatMoney={formatMoney}
                  onSubmit={onCancel}
                />
              )}
            </Box>
          </Collapse>
        </Box>
      ) : null}

      {resolvedStrip ? <Box sx={{ px: 1.5, pb: 1.5 }}>{resolvedStrip}</Box> : null}
    </Box>
  );
};

export default DepositSection;
