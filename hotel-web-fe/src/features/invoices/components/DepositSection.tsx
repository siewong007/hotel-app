import React, { useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Collapse,
  FormControl,
  Grid,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import {
  AccountBalanceWallet as DepositIcon,
  ExpandMore as ExpandMoreIcon,
  Payment as PaymentIcon,
} from '@mui/icons-material';
import StatusChip from '../../../components/common/StatusChip';
import { statusToneVars, type StatusTone } from '../../../theme/tokens';
import { isGreaterMoney, isPositiveMoney, toMoneyNumber } from '../../../utils/money';

export interface DepositSectionProps {
  /** Amount of deposit held that still needs resolution. */
  depositRefund: number;
  /** Ceiling for the forfeit amount field (recorded − refunded − forfeited). */
  refundableDeposit: number;
  /** `isPositiveMoney(recordedDeposit)` — a real deposit payment row exists. */
  hasRecordedDeposit: boolean;
  depositRefunded: boolean;
  depositForfeited: boolean;
  depositWaived: boolean;
  depositWaiveReason: string;
  forfeitReason: string;
  forfeitAmount: number;
  refundPaymentMethod: string;
  refundingDeposit: boolean;
  revertingRefund: boolean;
  waivingDeposit: boolean;
  forfeitingDeposit: boolean;
  cancellingDeposit: boolean;
  restoringDeposit: boolean;
  readOnly: boolean;
  canCancelDeposit: boolean;
  /** Count of voided deposit rows eligible for restore. */
  voidedDepositCount: number;
  /** Chip label for the no-deposit state. */
  noDepositLabel: string;
  /** True when the no-deposit chip should read as a waive (warning tone). */
  noDepositWaived: boolean;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
  onRefundMethodChange: (method: string) => void;
  onWaiveReasonChange: (reason: string) => void;
  onForfeitReasonChange: (reason: string) => void;
  onForfeitAmountChange: (amount: number) => void;
  onRefund: () => void;
  onRevertRefund: () => void;
  onWaive: () => void;
  onForfeit: () => void;
  onCancelDeposit: () => void;
  onRestoreDeposit: () => void;
}

const cardSx = {
  border: '1px solid var(--hotel-border)',
  borderRadius: 2,
  bgcolor: 'var(--hotel-surface)',
  overflow: 'hidden',
  mb: 3,
} as const;

/** One-line tinted strip used by every resolved deposit state. */
const StatusStrip: React.FC<{
  tone: StatusTone;
  title: React.ReactNode;
  caption?: React.ReactNode;
  chip: React.ReactNode;
  amount?: string;
  actions?: React.ReactNode;
}> = ({ tone, title, caption, chip, amount, actions }) => {
  const t = statusToneVars(tone);
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        flexWrap: 'wrap',
        p: 1.5,
        bgcolor: t.bg,
        borderLeft: `3px solid ${t.fg}`,
      }}
    >
      <Box sx={{ color: t.fg, display: 'flex', flexShrink: 0 }}>
        <DepositIcon fontSize="small" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 140 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: t.fg }}>
          {title}
        </Typography>
        {caption ? (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            {caption}
          </Typography>
        ) : null}
      </Box>
      {amount ? (
        <Typography variant="body2" sx={{ fontWeight: 700, color: t.fg }}>
          {amount}
        </Typography>
      ) : null}
      {chip}
      {actions}
    </Box>
  );
};

/**
 * Deposit status card for the checkout invoice preview. The pending state
 * keeps the common path — refund — one click away; waive, forfeit and cancel
 * live behind the "Other options" expander. Resolved states (refunded,
 * forfeited, waived, none) render as a single tinted strip in the same shell.
 * Presentational only: all derivation and service calls stay in the parent
 * modal and arrive as props.
 */
const DepositSection: React.FC<DepositSectionProps> = (props) => {
  const {
    depositRefund,
    refundableDeposit,
    hasRecordedDeposit,
    depositRefunded,
    depositForfeited,
    depositWaived,
    depositWaiveReason,
    forfeitReason,
    forfeitAmount,
    refundPaymentMethod,
    refundingDeposit,
    revertingRefund,
    waivingDeposit,
    forfeitingDeposit,
    cancellingDeposit,
    restoringDeposit,
    readOnly,
    canCancelDeposit,
    voidedDepositCount,
    noDepositLabel,
    noDepositWaived,
    currencySymbol,
    formatCurrency,
    onRefundMethodChange,
    onWaiveReasonChange,
    onForfeitReasonChange,
    onForfeitAmountChange,
    onRefund,
    onRevertRefund,
    onWaive,
    onForfeit,
    onCancelDeposit,
    onRestoreDeposit,
  } = props;

  const [optionsOpen, setOptionsOpen] = useState(false);
  const warn = statusToneVars('warning');
  const pending = !depositRefunded && !depositForfeited;
  // Same visibility rules as before the extraction: forfeit needs a real
  // collected deposit row and is hidden in readOnly; waive shows whenever the
  // deposit is unresolved; cancel only ever lived inside the forfeit block.
  const showForfeit = pending && !readOnly && hasRecordedDeposit;
  const showWaive = pending;
  const showCancel = showForfeit && canCancelDeposit;

  if (isPositiveMoney(depositRefund) && !depositWaived) {
    return (
      <Box sx={cardSx}>
        {depositRefunded ? (
          <StatusStrip
            tone="success"
            title="Deposit refunded"
            caption="Refunded separately to guest"
            amount={formatCurrency(depositRefund)}
            chip={<StatusChip status="refunded" label="Refunded" tone="success" />}
            actions={
              !readOnly ? (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={onRevertRefund}
                  disabled={revertingRefund}
                  startIcon={revertingRefund ? <CircularProgress size={14} /> : undefined}
                  sx={{ fontSize: '0.7rem', py: 0.25 }}
                >
                  Revert
                </Button>
              ) : undefined
            }
          />
        ) : depositForfeited ? (
          <StatusStrip
            tone="orange"
            title="Deposit forfeited"
            caption="Forfeited to the hotel"
            amount={formatCurrency(depositRefund)}
            chip={<StatusChip status="forfeited" label="Forfeited" tone="warning" />}
          />
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, flexWrap: 'wrap' }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  bgcolor: warn.bg,
                  border: `1px solid ${warn.border}`,
                  color: warn.fg,
                }}
              >
                <DepositIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 160 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Security deposit
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                  {formatCurrency(depositRefund)} — must be refunded, forfeited, or waived before checkout
                </Typography>
              </Box>
              <StatusChip status="pending" label="Pending" tone="warning" />
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1.25,
                borderTop: '1px solid var(--hotel-border-subtle)',
                flexWrap: 'wrap',
              }}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Refund via
              </Typography>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <Select
                  value={refundPaymentMethod}
                  onChange={(e) => onRefundMethodChange(e.target.value)}
                  size="small"
                  sx={{ fontSize: '0.8rem' }}
                >
                  <MenuItem value="cash">Cash</MenuItem>
                  <MenuItem value="card">Card</MenuItem>
                  <MenuItem value="bank_transfer">Bank Transfer</MenuItem>
                  <MenuItem value="duitnow">DuitNow</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={onRefund}
                disabled={refundingDeposit}
                startIcon={refundingDeposit ? <CircularProgress size={14} /> : <PaymentIcon />}
                sx={{ fontSize: '0.75rem', py: 0.5 }}
              >
                Refund {formatCurrency(depositRefund)}
              </Button>
            </Box>
            <ButtonBase
              onClick={() => setOptionsOpen((o) => !o)}
              aria-expanded={optionsOpen}
              sx={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                px: 1.5,
                py: 0.75,
                borderTop: '1px solid var(--hotel-border-subtle)',
                color: 'text.secondary',
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}
              >
                Other options
              </Typography>
              <ExpandMoreIcon
                fontSize="small"
                sx={{
                  transform: optionsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: (theme) => theme.transitions.create('transform'),
                }}
              />
            </ButtonBase>
            <Collapse in={optionsOpen} unmountOnExit>
              <Box
                sx={{
                  px: 1.5,
                  py: 1.5,
                  bgcolor: 'var(--hotel-surface-sunken)',
                  borderTop: '1px solid var(--hotel-border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {showForfeit && (
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mb: 1, color: 'text.secondary' }}
                    >
                      Forfeit — keep the deposit (e.g., lost keycard, damage):
                    </Typography>
                    <Grid container spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <Grid size={{ xs: 12, sm: 5 }}>
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="Reason for forfeiting deposit"
                          value={forfeitReason}
                          onChange={(e) => onForfeitReasonChange(e.target.value)}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 3 }}>
                        <TextField
                          size="small"
                          fullWidth
                          type="number"
                          label="Forfeit amount"
                          value={forfeitAmount || ''}
                          onChange={(e) => onForfeitAmountChange(toMoneyNumber(e.target.value))}
                          error={isGreaterMoney(forfeitAmount, refundableDeposit)}
                          helperText={
                            isGreaterMoney(forfeitAmount, refundableDeposit)
                              ? `Cannot exceed refundable deposit of ${formatCurrency(refundableDeposit)}`
                              : `Refundable deposit: ${formatCurrency(refundableDeposit)}`
                          }
                          slotProps={{
                            input: {
                              startAdornment: (
                                <InputAdornment position="start">{currencySymbol}</InputAdornment>
                              ),
                            },
                            htmlInput: { min: 0, max: refundableDeposit, step: 0.01 },
                          }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          fullWidth
                          onClick={onForfeit}
                          disabled={
                            !forfeitReason.trim()
                            || !isPositiveMoney(forfeitAmount)
                            || isGreaterMoney(forfeitAmount, refundableDeposit)
                            || forfeitingDeposit
                          }
                          startIcon={forfeitingDeposit ? <CircularProgress size={14} /> : undefined}
                          sx={{ fontSize: '0.75rem', py: 0.5 }}
                        >
                          Forfeit Deposit
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                )}
                {showWaive && (
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mb: 1, color: 'text.secondary' }}
                    >
                      Deposit recorded but never collected — waive it:
                    </Typography>
                    <Grid container spacing={1} sx={{ alignItems: 'center' }}>
                      <Grid size={{ xs: 12, sm: 8 }}>
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="Reason for waiving deposit (e.g., recorded in error)"
                          value={depositWaiveReason}
                          onChange={(e) => onWaiveReasonChange(e.target.value)}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          fullWidth
                          onClick={onWaive}
                          disabled={!depositWaiveReason.trim() || waivingDeposit}
                          startIcon={waivingDeposit ? <CircularProgress size={14} /> : undefined}
                          sx={{ fontSize: '0.75rem', py: 0.5 }}
                        >
                          Waive Deposit
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                )}
                {showCancel && (
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    onClick={onCancelDeposit}
                    disabled={cancellingDeposit}
                    startIcon={cancellingDeposit ? <CircularProgress size={14} /> : undefined}
                    sx={{ fontSize: '0.75rem', alignSelf: 'flex-start' }}
                  >
                    Cancel deposit (recorded but not collected)
                  </Button>
                )}
              </Box>
            </Collapse>
          </>
        )}
      </Box>
    );
  }

  if (depositWaived) {
    return (
      <Box sx={cardSx}>
        <StatusStrip
          tone="warning"
          title="Deposit waived"
          caption={depositWaiveReason ? `Waived: ${depositWaiveReason}` : undefined}
          chip={<StatusChip status="waived" label="Waived" tone="warning" />}
        />
      </Box>
    );
  }

  return (
    <Box sx={cardSx}>
      <StatusStrip
        tone="info"
        title="Deposit"
        chip={
          <StatusChip
            status={noDepositLabel}
            label={noDepositLabel}
            tone={noDepositWaived ? 'warning' : 'info'}
          />
        }
        actions={
          canCancelDeposit && voidedDepositCount > 0 ? (
            <Button
              size="small"
              variant="outlined"
              onClick={onRestoreDeposit}
              disabled={restoringDeposit}
              startIcon={restoringDeposit ? <CircularProgress size={14} /> : undefined}
              sx={{ fontSize: '0.75rem' }}
            >
              Restore deposit{voidedDepositCount > 1 ? ` (${voidedDepositCount} cancelled)` : ''}
            </Button>
          ) : undefined
        }
      />
    </Box>
  );
};

export default DepositSection;
