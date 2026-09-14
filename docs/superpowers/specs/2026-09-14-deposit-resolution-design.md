# Deposit resolution — checkout invoice redesign — design

Date: 2026-09-14
Status: approved (design)
Branch/worktree: `.worktrees/deposit-resolution` on `feat/deposit-resolution-ux`
Related:
- `2026-09-13-deposit-checkout-guard-design.md` — the checkout gate this UI resolves.
- `2026-09-14-deposit-refund-card-design.md` — the current `DepositSection` card this replaces.
- `2026-09-14-deposit-cancel-revert-design.md` — cancel/restore workflow this surfaces.
- `2026-09-13-legacy-deposit-refund-design.md` — flag-only deposit mint-then-refund path.

## Problem

The checkout invoice preview (`CheckoutInvoiceModal.tsx` → `DepositSection.tsx`)
exposes refund, forfeit, waive and cancel controls together in one dense
accounting-style card: the refund row is always visible while forfeit, waive
and cancel hide behind an "Other options" expander. Staff must already
understand the ledger model to pick the right control:

- **Waive** (booking update, `deposit_paid=false`) clears a mirror assertion —
  only valid when no deposit payment row exists; the backend rejects it
  otherwise.
- **Cancel deposit** (`DELETE /payments/{id}`) voids real deposit rows —
  the "recorded but never collected" correction for ledger-backed deposits.
- Refund method choices are hardcoded (`cash/card/bank_transfer/duitnow`),
  ignoring `hotelSettings.payment_methods`.
- No refund reference or note; forfeit takes one free-text reason with no
  category and no review step.
- Refund/forfeit buttons render for everyone — `payments:refund` is only
  enforced server-side, surfacing as a late 403.
- The checkout gate is expressed only as a disabled button + one amber alert;
  nothing states *what* is blocking or *when* the modal is ready.
- The balance strip under the payments list reads "Fully Paid" — ambiguous
  next to a held deposit that is still owed back to the guest.

## Existing architecture (verified by audit)

Backend — the `payments` ledger is the sole deposit authority;
`bookings.deposit_{paid,amount,paid_at}` is a synced mirror (collected −
forfeited), never a money source.

| Operation | Endpoint | Permission | Mechanism |
|---|---|---|---|
| Refund | `POST /payments/refund-deposit/{booking}` | `payments:refund` | `refund`/`refunded` row under booking `FOR UPDATE`; one active refund max; ceiling = collected − refunded − forfeited |
| Forfeit | `POST /payments/forfeit-deposit/{booking}` | `payments:refund` | `deposit_forfeited`/`completed` row; reason required; same ceiling |
| Revert refund | `POST /payments/revert-deposit-refund/{booking}` | `payments:manage` | voids the refund row |
| Cancel record | `DELETE /payments/{id}` | `payments:delete` | voids `deposit` rows (in-house only; refused post-checkout); refund rows refused |
| Restore | `POST /payments/revert-deposit-void/{booking}` | `payments:delete` | un-voids newest voided deposit row |
| Waive (mirror) | booking update `deposit_paid:false` | `bookings:update` | `reconcile_booking_deposit_tx` clears flag; rejected while deposit rows exist |
| Collect (mirror) | booking update `deposit_paid:true + amount` | `bookings:update` | mints the delta as a completed `deposit` row |

- Checkout gate: `ensure_checkout_balance_resolved` blocks
  `checked_out`/`completed` while `balance_due > 0` (exempt: company billing)
  **or** `max(deposit_collected, mirror) − refunded − forfeited > 0`.
- `GET /payments/workflow-summary/{booking}` (`payments:read`):
  `deposit_collected/refunded/forfeited`, `balance_due`, `warnings`,
  `next_action`.
- Audit events: `payment_refunded`, `payment_deposit_forfeited`,
  `payment_refund_reverted`, `deposit_void_reverted`, `payment_voided`,
  plus booking-history rows.
- Only `refund_deposit` mints `payment_type='refund'` rows — always with
  notes `'Keycard deposit refund'`; the dup-guard and revert matcher both
  key on that literal.

Frontend — `useCheckoutInvoiceData` loads all payment rows (voided included)
and derives `depositRefunded`; the modal derives
`recordedDeposit`/`refundableDeposit` from rows and `charges.depositRefund`
from the booking mirror; `useCheckoutFlow` owns the modal + confirm-checkout
orchestration for Bookings / Room Management / Customer Ledger pages.

## Design decisions (user-approved)

1. **Unified "Cancel uncollected deposit" choice** auto-routes: no completed
   deposit rows → waive via booking update; rows exist → void each via
   `DELETE /payments/{id}` then offer Restore.
2. **Additive backend extensions**: refund accepts optional
   `transaction_reference` + `note`; forfeit accepts optional `notes`.
3. **Fixed full-amount refund** — the refund action always returns the full
   remaining refundable balance; a partial outcome is reached via partial
   forfeit → refund remainder. (The backend's one-active-refund rule would
   make partial refunds a trap.)
4. **No schema change** — the ledger already carries amount/method/time/
   reference/notes; no new endpoints (no openapi drift).

## Deposit status model (derived, no schema)

```
collected  = Σ payments(type='deposit', status='completed')
refunded   = Σ payments(type='refund',  status='refunded')
forfeited  = Σ payments(type='deposit_forfeited', status='completed')
remaining  = collected − refunded − forfeited          (refundable ceiling)
mirrorDue  = booking.deposit_paid ? booking.deposit_amount : 0
pending    = remaining > 0  OR  (collected = 0 AND mirrorDue > 0)
```

| Condition | Chip |
|---|---|
| pending (any path) | `Pending resolution` — warning |
| remaining = 0, refunded > 0, forfeited = 0 | `Refunded` — success |
| remaining = 0, forfeited > 0, refunded = 0 | `Fully forfeited` — warning |
| remaining = 0, forfeited > 0, refunded > 0 | `Partially forfeited` — warning |
| forfeited > 0, remaining > 0 | `Pending resolution` — warning (caption shows "RMx forfeited · RMy still held") |
| collected = 0, voided rows > 0 | `Cancelled` — neutral + Restore |
| mirror cleared by waive | `Cancelled — not collected` — neutral |
| nothing recorded | `No deposit` — neutral |

The flag-only legacy case (`deposit_paid=true`, no rows) reads "Pending
resolution" with a "recorded on the booking" caption — refund mints the
missing row first (existing reconciliation), cancel waives the flag.

## Section structure

```
┌ Security deposit ──────────────────── [ Pending resolution ] ┐
│ Held RM50.00 · Collected via Cash · 12 Sep, 2:32 PM          │
│ Refunded RM0.00 · Forfeited RM0.00 · Remaining RM50.00       │
│                                                              │
│ How should this deposit be resolved?                         │
│ (•) Refund deposit — return RM50.00 to the guest             │
│ ( ) Forfeit deposit — keep some or all for an approved reason│
│ ( ) Cancel uncollected deposit — recorded, no money received │
│                                                              │
│ ── selected option's form expands inline ──                  │
└──────────────────────────────────────────────────────────────┘
```

- **Refund panel**: held amount display (fixed), method `Select` from
  `hotelSettings.payment_methods`, optional `Reference`, optional `Note`,
  CTA `Refund RM50.00` (contained, success). Success → green strip: amount,
  method, date/time, reference; `Revert refund` shown only with
  `payments:manage`.
- **Forfeit panel**: amount field (≤ remaining, default = remaining), live
  "Remaining to refund after: RMxx", reason `Select` (`Room damage` /
  `Missing item or key` / `Outstanding charge` / `Other`) + notes
  (required when `Other`) → `Review forfeiture` → inline review card
  ("You are retaining RM20.00 of the deposit — RM30.00 will remain to
  refund") → `Forfeit RM20.00` (destructive) + `Back`.
- **Cancel panel**: recorded amount, "no money was received" explainer,
  required reason, warning "this does not issue a refund" → `Cancel deposit
  record` (warning) — auto-routes waive vs void.
- Options render as full-width selectable rows (radio semantics:
  `role="radio"` group via ToggleButtonGroup-style buttons or
  ButtonBase + aria-checked); only the selected form is mounted.

## Checkout readiness

A single readiness strip at the end of the preview body replaces the two
scattered deposit alerts:

- Blocked (amber): "Checkout is not ready — Resolve the RM50.00 security
  deposit" and/or "Settle the outstanding bill balance of RMx" — lists every
  unmet condition.
- Ready (green): "Ready for checkout — Bill paid · Deposit refunded RM50.00
  via Cash" (or forfeited/cancelled wording).

`Proceed to Checkout` / `Print Preview` keep their existing disabled
conditions (same derived values; the backend gate stays authoritative).

## Bill vs deposit separation

- Payments-list balance strip: `Bill balance: RM0.00 — Paid` /
  `— Partially paid` / `— Outstanding` (explicit, no bare "Fully Paid").
- Deposit rows keep their own "Deposits — collateral, not bill payments"
  folio group; the deposit card owns the running resolution totals.

## Backend changes (additive only)

`services/payments.rs` + `repositories/payment.rs`:

1. `refund_deposit` body gains optional `transaction_reference` and `note`:
   inserted row stores `transaction_id = reference`,
   `notes = 'Keycard deposit refund' + note.map(" — {note}")`;
   RETURNING exposes `transaction_id AS transaction_reference`.
2. `forfeit_deposit` body gains optional `notes`: row notes become
   `'Deposit forfeited: {reason}' + notes.map(" — {notes}")`; audit details
   carry `reason` and `notes` separately.
3. The two `notes = 'Keycard deposit refund'` matchers (dup-guard L~1281,
   revert-select L~1477) change to `payment_type='refund' AND
   status='refunded'` — equivalent today (sole writer) and no longer
   defeated by an appended note or an edited row.

`invoices.service.ts`: `refundDeposit(id, method, amount, reference?, note?)`,
`forfeitDeposit(id, amount, reason, notes?)`.

## Frontend structure

- New `features/invoices/hooks/useDepositResolution.ts`: deposit derivation
  (amounts, method, collected-at, status enum), busy flags, and handlers
  `refund` / `forfeit` / `cancelUncollected` (auto-route) / `revertRefund` /
  `restore` — extracted from the modal, which keeps only orchestration.
- `DepositSection.tsx` rewritten as above (same file; prop contract
  replaced).
- `CheckoutInvoiceModal.tsx`: wires the hook + section; gains
  `fullScreen={isPhone}`; balance strip + readiness strip relabelled.
- Waived-state detection keeps the existing `payment_note` convention
  (legacy rows), plus the local flag.

## Permissions

| Action | UI gate | Backend gate |
|---|---|---|
| Refund | `payments:refund` | same |
| Forfeit | `payments:refund` | same |
| Cancel (waive path) | `bookings:update` | same |
| Cancel (void path) | `payments:delete` | same |
| Revert refund | `payments:manage` | same |
| Restore | `payments:delete` | same |

An option whose permission is missing renders disabled with a caption
("Requires the payments:refund permission"). Backend remains authoritative.

## Errors

Backend messages surface via `toApiError` into the modal's single `error`
Alert; client-side validation shows field helper text instead of toasting.
Copy: "Refund amount cannot exceed the collected deposit", "A reason is
required before forfeiting the deposit", "This deposit was recorded but has
not been marked as collected — no refund can be issued", "This deposit has
already been resolved — refresh the summary to continue".

## Tests

Update `CheckoutInvoiceModal.test.tsx` (the "Other options" expander is
gone → new selectors) and extend it:

- Resolution choice switching mounts only the selected form.
- Refund: calls service with method/reference/note; success strip; revert
  hidden without `payments:manage`.
- Forfeit: reason required; notes required for Other; review step shows the
  retain/refund split; partial forfeit keeps the gate locked; over-ceiling
  blocked.
- Cancel: no rows → updateBooking waive; rows → deletePayment per row;
  reason required; restore shown for voided rows under `payments:delete`.
- Readiness strip wording for blocked/ready; bill-balance label.
- Permission-missing states render disabled options.

Backend (`deposit_checkout_guard.rs` or `payment_characterization.rs`
style, `DATABASE_URL`-gated): refund stores reference/note and still blocks
a second active refund; revert matches by type+status regardless of notes;
forfeit stores composed notes.

## Out of scope

- Editable/partial refund amount (user decision: full remaining only).
- An opt-out setting for the deposit checkout guard — the guard codifies
  current policy; a `system_settings` escape can follow via the patch
  catalog if policy ever changes.
- Restructuring the paper-invoice preview layout itself.
- Per-row delete affordances on the deposit folio group (deliberately kept
  off since the cancel workflow exists).

## Verification

`hotel-web-fe`: `bun run typecheck`, `bun run lint`, `bun run test`,
`bun run build`. `hotel-app-be`: `cargo check --all-features`,
`cargo clippy --all-features -- -D warnings`, `cargo test --all-features`
(DATABASE_URL-gated files skip without a database).
