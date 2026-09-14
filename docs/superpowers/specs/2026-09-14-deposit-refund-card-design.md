# Deposit refund area redesign — design

Date: 2026-09-14
Status: approved (design)
Related:
- `2026-09-14-deposit-cancel-revert-design.md` — cancel/restore workflow this card surfaces.
- `2026-09-13-deposit-checkout-guard-design.md` — the checkout gate this card resolves.

## Problem

The deposit refund area of the checkout invoice preview
(`hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`,
~L1328–1602) is ugly for two structural reasons:

1. **Hardcoded light-theme hex everywhere** — `#fff3e0`, `#e65100`, `#e8f5e9`,
   `#2e7d32`, `#fafafa`, `#e3f2fd`, `#1565c0`, `#ddd` — bypassing
   `src/theme/tokens.ts`. The flagship theme is dark "charcoal + champagne";
   these literal light-mode fills fight it (and the warm-paper light theme).
2. **Four always-visible stacked forms** — refund row, waive form, forfeit
   form, cancel button — each in its own bordered, differently-tinted strip.
   The common path (refund) is visually buried under rare paths (forfeit,
   waive, cancel).

## Direction

Status card + collapsed secondary actions (user-approved). One card whose
header always shows deposit status; pending keeps the refund one click away;
waive/forfeit/cancel live behind a collapsed expander.

## Design

### Pending (deposit unresolved)

```
┌──────────────────────────────────────────────────────────┐
│ (icon) Security deposit                     [ Pending ]  │
│        RM 50.00 held — refund, forfeit, or waive it      │
│        before checkout                                   │
├──────────────────────────────────────────────────────────┤
│ Refund via [ Cash ▾ ]                ( Refund RM 50.00 ) │
├──────────────────────────────────────────────────────────┤
│ ▸ Other options                                          │
│   Forfeit — keep for damage / lost items                 │
│   [ Reason… ] [ Amount ]              [ Forfeit deposit ]│
│   Waive — recorded but never collected                   │
│   [ Reason… ]                          [ Waive deposit ] │
│   · Cancel deposit (recorded but not collected)          │
└──────────────────────────────────────────────────────────┘
```

- Card shell: `border: 1px solid var(--hotel-border)`, `borderRadius: 2`,
  `bgcolor: var(--hotel-surface)`, `mb: 3` — same shell across all states.
- Header: small tinted icon disc (`statusToneVars('warning')` bg/border,
  `AccountBalanceWallet`-style icon) + "Security deposit" + amount; right side
  `StatusChip` tone `warning`, label "Pending".
- Refund row: method `Select` (existing cash/card/bank_transfer/duitnow
  options) + contained success `Refund {amount}` button — unchanged handler.
- "Other options": quiet full-width `ButtonBase` + rotating `ExpandMore`
  chevron with `aria-expanded` driving a `Collapse` (same pattern as
  `CollapsibleSection`). Inside, the three secondary blocks keep their
  existing visibility conditions and handlers:
  - **Forfeit** — only when `!readOnly && isPositiveMoney(recordedDeposit)`:
    reason field + amount field (helper text = refundable ceiling) +
    `Forfeit Deposit` button.
  - **Waive** — whenever pending (`!depositRefunded && !depositForfeited`):
    reason field + `Waive Deposit` button.
  - **Cancel deposit** — only under `canCancelDeposit`
    (`payments:delete` && !readOnly && !isLedgerView): text/error button,
    unchanged label.

### Resolved states — single tinted strip in the same shell

| State      | Tone      | Content                                             |
|------------|-----------|-----------------------------------------------------|
| Refunded   | success   | "Deposit refunded" + amount + chip + Revert (!readOnly) |
| Forfeited  | orange    | "Deposit forfeited" + amount + chip                  |
| Waived     | warning   | "Deposit waived — {reason}" + chip                   |
| None/void  | neutral   | "Deposit" + chip (City Ledger - N/A / Waived / No Deposit Collected) + Restore button when `voidedDepositRows.length > 0 && canCancelDeposit` |

### Styling rules

- Colors only via `statusToneVars(tone)` (`fg`/`bg`/`border`) and
  `var(--hotel-*)` surface/border/text vars. Zero literal hex.
- Chips via shared `StatusChip` with explicit `tone`.
- Keep the `PhoneCollapsibleSection` wrapper (`title="Deposit adjustments"`,
  `collapseOnPhone`) unchanged.

## Structure

- New presentational component
  `src/features/invoices/components/DepositSection.tsx`. All derivation stays
  in the modal (`recordedDeposit`, `refundableDeposit`, `depositRefunded`,
  `depositForfeited`, `depositWaived`, `voidedDepositRows`, busy flags,
  handlers) and passes in as props — pure move, no logic changes.
- `CheckoutInvoiceModal.tsx` sheds ~275 JSX lines (modal is ~2600 lines;
  AGENTS.md directs splitting by workflow).

## Behavior preserved

- Identical show/hide conditions, service calls, payloads, and
  checkout-gate semantics.
- Strings the tests rely on stay verbatim: `Refund RM…` button name,
  `Waive Deposit`, `Forfeit Deposit`, `Cancel deposit (recorded but not
  collected)`, placeholders `Reason for waiving deposit` /
  `Reason for forfeiting deposit`, label `Forfeit amount`.
- Untouched: payments-list `Deposit held`/`Deposit forfeited` chips and
  `Deposits — collateral` group (L1795+), the gate `Alert`s (L2153+),
  confirm-step summary, print view.

## Tests

`CheckoutInvoiceModal.test.tsx`: tests reaching waive/forfeit/cancel controls
first expand "Other options" via a small `expandOtherOptions(dialog)` helper —
~7 tests touched. No service-contract changes.

## Verification

In `hotel-web-fe/`: `bun run test`, `bun run typecheck`, `bun run lint`.
