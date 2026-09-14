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
  { value: 'ROOM_DAMAGE', label: 'Room damage' },
  { value: 'MISSING_ITEM', label: 'Missing item or key' },
  { value: 'OUTSTANDING_CHARGE', label: 'Outstanding charge' },
  { value: 'OTHER', label: 'Other' },
] as const;

/** Exported so the modal's confirm step can reuse the same chip wording. */
export const DEPOSIT_STATUS_CHIP: Record<DepositResolutionStatus, { label: string; tone: StatusTone }> = {
  none: { label: 'No deposit', tone: 'neutral' },
  pending: { label: 'Pending resolution', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'success' },
  partially_forfeited: { label: 'Partially forfeited', tone: 'warning' },
  forfeited: { label: 'Fully forfeited', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  waived: { label: 'Cancelled — not collected', tone: 'neutral' },
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
  const [method, setMethod] = useState(methods[0] ?? 'Cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Refund amount — fixed to the full held balance:
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(amount)}
        </Typography>
      </Box>
      <Grid container spacing={1}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="deposit-refund-method-label">Refund method</InputLabel>
            <Select
              labelId="deposit-refund-method-label"
              label="Refund method"
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
            label="Reference (optional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label="Note (optional)"
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
          Refund {formatMoney(amount)}
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
  const [amountInput, setAmountInput] = useState(remaining.toFixed(2));
  const [reasonCode, setReasonCode] = useState('');
  const [notes, setNotes] = useState('');
  const [review, setReview] = useState(false);

  const amount = toMoneyNumber(amountInput);
  const overCeiling = isGreaterMoney(amount, remaining);
  const notPositive = !isPositiveMoney(amount);
  const reasonLabel = FORFEIT_REASONS.find((r) => r.value === reasonCode)?.label ?? '';
  const notesRequired = reasonCode === 'OTHER';
  const reasonValid = reasonCode !== '' && (!notesRequired || notes.trim() !== '');
  const canReview = !notPositive && !overCeiling && reasonValid;
  const remainder = isPositiveMoney(subtractMoney(remaining, amount))
    ? subtractMoney(remaining, amount)
    : 0;

  const amountHelper = (() => {
    if (amountInput.trim() === '') return `Refundable deposit: ${formatMoney(remaining)}`;
    if (overCeiling) return `Cannot exceed ${formatMoney(remaining)}`;
    if (notPositive) return 'Enter an amount above 0';
    return `Remaining to refund after: ${formatMoney(remainder)}`;
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
            You are retaining {formatMoney(amount)} of the deposit — {formatMoney(remainder)} will
            remain to refund.
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
            Reason: {reasonLabel}
            {notes.trim() ? ` — ${notes.trim()}` : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button size="small" variant="text" onClick={() => setReview(false)} disabled={busy}>
            Back
          </Button>
          <Button
            size="small"
            variant="contained"
            color="error"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={14} /> : undefined}
            onClick={() =>
              onSubmit({ amount, reason: reasonLabel, notes: notes.trim() || undefined })
            }
            sx={{ fontSize: '0.75rem', py: 0.5 }}
          >
            Forfeit {formatMoney(amount)}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Keep part or all of the deposit — the rest stays refundable.
      </Typography>
      <Grid container spacing={1}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label="Forfeit amount"
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
            <InputLabel id="deposit-forfeit-reason-label">Forfeit reason</InputLabel>
            <Select
              labelId="deposit-forfeit-reason-label"
              label="Forfeit reason"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {FORFEIT_REASONS.map((r) => (
                <MenuItem key={r.value} value={r.value}>
                  {r.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            size="small"
            fullWidth
            label="Staff notes"
            required={notesRequired}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            helperText={notesRequired ? 'Required when the reason is Other' : undefined}
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
          Review forfeiture
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
  const [reason, setReason] = useState('');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Recorded deposit:
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(recorded)}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Use this only when the deposit was recorded but no money was actually received.
      </Typography>
      <TextField
        size="small"
        fullWidth
        required
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Alert severity="warning" sx={{ py: 0.5 }}>
        This does not issue a refund.
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
          Cancel deposit record
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
  hotelSettings,
  onRefund,
  onForfeit,
  onCancel,
  onRevertRefund,
  onRestore,
}) => {
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
  const methods = hotelSettings.payment_methods.length
    ? hotelSettings.payment_methods
    : DEFAULT_REFUND_METHODS;

  const collectedLine = isPositiveMoney(resolution.collected)
    ? `Collected ${formatMoney(resolution.collected)}${
        resolution.method ? ` via ${resolution.method}` : ''
      }${resolution.collectedAt ? ` · ${formatHotelDateTime(resolution.collectedAt)}` : ''}`
    : isPositiveMoney(resolution.mirrorDue)
      ? `Recorded on the booking${
          resolution.collectedAt ? ` · ${formatHotelDateTime(resolution.collectedAt)}` : ''
        }`
      : null;
  const breakdownLine =
    isPositiveMoney(resolution.refunded)
    || isPositiveMoney(resolution.forfeited)
    || isPositiveMoney(resolution.remaining)
      ? `Refunded ${formatMoney(resolution.refunded)} · Forfeited ${formatMoney(
          resolution.forfeited,
        )} · Remaining ${formatMoney(resolution.remaining)}`
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
      title: 'Refund deposit',
      description: `Return ${formatMoney(held)} to the guest`,
      enabled: can.refund,
      disabledReason: 'Requires the payments:refund permission',
    },
    {
      key: 'forfeit',
      title: 'Forfeit deposit',
      description: 'Keep some or all of it for an approved reason',
      enabled: can.forfeit && isPositiveMoney(resolution.remaining),
      disabledReason: !can.forfeit
        ? 'Requires the payments:refund permission'
        : 'No collected deposit to forfeit',
    },
    {
      key: 'cancel',
      title: 'Cancel uncollected deposit',
      description: 'It was recorded but no money was received',
      enabled: can.cancel,
      disabledReason: 'Requires the payments:delete or bookings:update permission',
    },
  ];

  // While any resolution action is in flight the choice is locked — the
  // `key`-remount would otherwise drop a submitting form mid-flight.
  const anyBusy =
    busy.refunding || busy.forfeiting || busy.cancelling || busy.reverting || busy.restoring;

  // Radio-group keyboard behavior: arrows/Home/End move focus and select the
  // newly focused option (skipped when that option is permission-disabled or
  // a resolution action is busy).
  const handleOptionKeyDown = (event: React.KeyboardEvent, index: number) => {
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
            title="Deposit refunded"
            caption={`${formatMoney(resolution.refunded)}${
              resolution.refundMethod ? ` via ${resolution.refundMethod}` : ''
            }${
              resolution.refundedAt ? ` · ${formatHotelDateTime(resolution.refundedAt)}` : ''
            }${resolution.refundReference ? ` · Ref ${resolution.refundReference}` : ''}`}
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
                  Revert refund
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
                ? 'Deposit partially forfeited'
                : 'Deposit forfeited'
            }
            caption={`Kept ${formatMoney(resolution.forfeited)}${
              resolution.forfeitReason ? ` — ${resolution.forfeitReason}` : ''
            }${
              isPositiveMoney(resolution.refunded)
                ? ` · Remainder refunded ${formatMoney(resolution.refunded)}`
                : ''
            }`}
          />
        );
      case 'cancelled':
      case 'waived':
        return (
          <ResolutionStrip
            tone="neutral"
            title="Cancelled — not collected"
            caption={
              resolution.status === 'waived'
                ? 'The booking deposit flag was waived — no money was received.'
                : 'The deposit payment record was voided — no money was received.'
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
                  Restore deposit
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
            Security deposit
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
        <StatusChip status={resolution.status} label={chip.label} tone={chip.tone} />
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
            How should this deposit be resolved?
          </Typography>
          <Box
            role="radiogroup"
            aria-label="Deposit resolution"
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
