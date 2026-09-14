# Deposit Refund Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the deposit refund area of the checkout invoice preview as a single status card using theme tokens, with waive/forfeit/cancel collapsed behind an expander.

**Architecture:** Extract the deposit JSX (~L1328–1602 of `CheckoutInvoiceModal.tsx`) into a presentational `DepositSection.tsx`. All derivation and handlers stay in the modal and pass in as props. All literal hex colors become `statusToneVars()` / `var(--hotel-*)` references.

**Tech Stack:** React 19, MUI v9, TypeScript strict, Vitest + Testing Library, bun.

Spec: `docs/superpowers/specs/2026-09-14-deposit-refund-card-design.md`

## Global Constraints

- Zero literal hex colors in the new component — `statusToneVars(tone)` and `var(--hotel-*)` only.
- Preserve exact show/hide conditions, service calls, payloads, and checkout-gate semantics. `readOnly` gating stays exactly where it is today (waive and refund controls are NOT readOnly-gated today; forfeit and cancel are).
- Strings tests rely on stay verbatim: `Refund {amount}` button, `Waive Deposit`, `Forfeit Deposit`, `Cancel deposit (recorded but not collected)`, placeholders `Reason for waiving deposit` / `Reason for forfeiting deposit`, label `Forfeit amount`, caption `Must be refunded, forfeited, or waived before checkout`.
- Keep the `PhoneCollapsibleSection` wrapper (`title="Deposit adjustments"`, `collapseOnPhone`) — it now wraps `DepositSection` for all three states (previously only the pending branch was wrapped; harmless consistency improvement, note in summary).
- Run commands from `hotel-web-fe/` (bun, no package-lock).
- The worktree is shared — never touch `hotel-app-be/tests/guest_relations.rs` or `payment_characterization.rs` (another session's dirty files).

---

### Task 1: Create `DepositSection.tsx`

**Files:**
- Create: `hotel-web-fe/src/features/invoices/components/DepositSection.tsx`

**Interfaces:**
- Produces: `export interface DepositSectionProps` and default-exported `DepositSection: React.FC<DepositSectionProps>` consumed by Task 2.

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Typecheck the new file**

Run: `cd hotel-web-fe && bun run typecheck`
Expected: no errors in `DepositSection.tsx` (unused modal-side imports are cleaned in Task 2, so modal errors at this stage are OK to note but the new file itself must be clean). Better: run `bunx tsc --noEmit` after Task 2 wiring instead — if doing it now, expect errors only from the modal's unused vars, not this file.

- [ ] **Step 3: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/DepositSection.tsx
git commit -m "Add DepositSection component for checkout invoice deposit states"
```

---

### Task 2: Wire `DepositSection` into `CheckoutInvoiceModal.tsx`

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx` (~L1328–1602 replaced; imports updated)

**Interfaces:**
- Consumes: `DepositSection` default export + `DepositSectionProps` from Task 1.
- All values already exist in the modal: `charges.depositRefund`, `refundableDeposit`, `recordedDeposit`, `depositRefunded`, `depositForfeited`, `depositWaived`, `depositWaiveReason`, `forfeitReason`, `forfeitAmount`, `refundPaymentMethod`, all six busy flags, `voidedDepositRows`, `canCancelDeposit`, `readOnly`, `formatCurrency`, `currencySymbol`, `booking`, and the six handlers.

- [ ] **Step 1: Add the import**

In the import block, add:

```tsx
import DepositSection from './DepositSection';
```

- [ ] **Step 2: Replace the old JSX**

Delete the entire `{isPositiveMoney(charges.depositRefund) && !depositWaived ? (…) : depositWaived ? (…) : (…)}` ternary (currently ~L1328–1602) and replace with:

```tsx
{/* Deposit status card — refund/forfeit/waive/cancel workflow. */}
<PhoneCollapsibleSection isPhone={isPhone} title="Deposit adjustments" collapseOnPhone>
  <DepositSection
    depositRefund={charges.depositRefund}
    refundableDeposit={refundableDeposit}
    hasRecordedDeposit={isPositiveMoney(recordedDeposit)}
    depositRefunded={depositRefunded}
    depositForfeited={depositForfeited}
    depositWaived={depositWaived}
    depositWaiveReason={depositWaiveReason}
    forfeitReason={forfeitReason}
    forfeitAmount={forfeitAmount}
    refundPaymentMethod={refundPaymentMethod}
    refundingDeposit={refundingDeposit}
    revertingRefund={revertingRefund}
    waivingDeposit={waivingDeposit}
    forfeitingDeposit={forfeitingDeposit}
    cancellingDeposit={cancellingDeposit}
    restoringDeposit={restoringDeposit}
    readOnly={readOnly}
    canCancelDeposit={canCancelDeposit}
    voidedDepositCount={voidedDepositRows.length}
    noDepositLabel={booking?.company_id ? 'City Ledger - N/A' : booking?.payment_note?.includes('waived') ? 'Waived' : 'No Deposit Collected'}
    noDepositWaived={Boolean(booking?.payment_note?.includes('waived'))}
    currencySymbol={currencySymbol}
    formatCurrency={formatCurrency}
    onRefundMethodChange={setRefundPaymentMethod}
    onWaiveReasonChange={setDepositWaiveReason}
    onForfeitReasonChange={setForfeitReason}
    onForfeitAmountChange={setForfeitAmount}
    onRefund={handleRefundDeposit}
    onRevertRefund={handleRevertDepositRefund}
    onWaive={handleWaiveDeposit}
    onForfeit={handleForfeitDeposit}
    onCancelDeposit={handleCancelDeposit}
    onRestoreDeposit={handleRestoreDeposit}
  />
</PhoneCollapsibleSection>
```

- [ ] **Step 3: Check for now-unused imports**

`Collapse` was imported for the old JSX — grep the modal for remaining `Collapse` usage; remove from the import if unused. `Chip`, `Select`, `MenuItem`, `FormControl`, `InputAdornment`, `TextField`, `PaymentIcon` are all still used elsewhere in the file — verify before removing anything.

- [ ] **Step 4: Typecheck**

Run: `cd hotel-web-fe && bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx
git commit -m "Use DepositSection in checkout invoice modal"
```

---

### Task 3: Update tests for the collapsed "Other options" area

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx`

**Interfaces:**
- The expander is a `ButtonBase` → `getByRole('button', { name: /other options/i })`. Collapsed content is unmounted (`unmountOnExit`), so tests must expand before querying waive/forfeit/cancel controls.

- [ ] **Step 1: Add the helper**

Near `renderModal` in the test file:

```ts
const expandOtherOptions = (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole('button', { name: /other options/i }));
};
```

- [ ] **Step 2: Update the 7 affected tests** — insert `expandOtherOptions(dialog);` after `const dialog = await screen.findByRole('dialog');` (and before the first waive/forfeit/cancel query) in:

1. `'persists a deposit waive through updateBooking and unblocks checkout'`
2. `'keeps the checkout gate locked and surfaces the error when the server rejects the waive'`
3. `'forfeits the deposit through the service and releases the checkout gate on a full forfeit'`
4. `'keeps the checkout gate locked after a partial forfeit'`
5. `'keeps the checkout gate locked when a partial forfeit row leaves money held'` (before the `getByLabelText('Forfeit amount')` default check)
6. `'flags an over-ceiling forfeit amount and keeps the action disabled'`
7. `'shows Cancel deposit under payments:delete and calls deletePayment for each held deposit row'`

- [ ] **Step 3: Run the suite**

Run: `cd hotel-web-fe && bun run test -- CheckoutInvoiceModal`
Expected: all tests pass.

- [ ] **Step 4: Lint**

Run: `cd hotel-web-fe && bun run lint`
Expected: clean (CI runs `lint:strict` — run that too if `lint` passes: `bun run lint:strict`).

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx
git commit -m "Update invoice modal tests for collapsed deposit options"
```

---

## Self-review notes

- Spec coverage: card shell, pending layout, expander, all four resolved strips, token-only colors, extraction, conditions preserved, test updates, PhoneCollapsibleSection retained — all covered in Tasks 1–3.
- Type consistency: prop names in Task 2 wiring match `DepositSectionProps` in Task 1 verbatim.
- Known deviations from the old UI (all intentional): titles change from `Deposit Refund`/`Deposit` to `Security deposit`/`Deposit refunded`/etc. (no test asserts them); the expander hides waive/forfeit/cancel by default (the point of the redesign); waived/none strips are now also phone-collapsible.
