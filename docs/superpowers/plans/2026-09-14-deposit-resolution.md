# Deposit resolution — checkout invoice redesign — implementation plan

Spec: `docs/superpowers/specs/2026-09-14-deposit-resolution-design.md`
Worktree: `.worktrees/deposit-resolution`, branch `feat/deposit-resolution-ux`.

Reference docs: `booking-workflow.md`, `ledger-workflow.md`, `payment-workflow.md`,
`invoice-print-workflow.md`, `security-guardrails.md`, `testing-runbook.md`.

## Conventions to follow

- Backend: `param!`/`current_timestamp()` helpers, parameterized SQL only,
  `decimal_to_db`, transactions for multi-step mutations, `AuditLog::log_event`
  per mutation, `cargo fmt` + `clippy -D warnings`.
- Frontend: MUI v9 + `alpha()` theme colors, `useAuth().hasPermission`,
  `toApiError`, `useConfirmDialog` (the modal's `confirm` callback pattern),
  `formatHotelDate`/`formatHotelDateTime`/`formatMoney`, `toMoneyNumber`,
  `isPositiveMoney`. No new dependencies.
- No schema changes, no new endpoints, no permission-name changes.
- `bun run test`, `typecheck`, `lint` are three independent gates.

## Task 1 — Backend: refund reference/note + forfeit notes + semantic matchers

Files:
- `hotel-app-be/src/repositories/payment.rs`
- `hotel-app-be/src/services/payments.rs`
- `hotel-app-be/tests/deposit_checkout_guard.rs`

- [ ] **Step 1 — failing tests.** Append to `tests/deposit_checkout_guard.rs`
  (all `DATABASE_URL`-gated, reuse the file's fixture helpers):
  - `refund_deposit_stores_reference_and_note` — call
    `PaymentRepository::refund_deposit` with `transaction_reference =
    Some("RF-9001")`, `note = Some("handed to guest at desk")`; assert the
    inserted row's `transaction_id` = `'RF-9001'` and `notes` =
    `'Keycard deposit refund — handed to guest at desk'`; assert
    `transaction_reference` is exposed in the returned `PaymentEntryRow`.
  - `refund_deposit_still_blocks_second_active_refund` — refund once with a
    note, then a second `refund_deposit` call (any note) must still
    `BadRequest("Deposit already refunded")` — proves the matcher no longer
    depends on the literal note.
  - `revert_deposit_refund_matches_type_and_status` — refund with a custom
    note, then `revert_deposit_refund`; assert it voids the row (status
    flips to `void`).
  - `forfeit_deposit_appends_staff_notes` — forfeit with `notes =
    Some("broken lamp, photo on file")`; assert row notes =
    `'Deposit forfeited: Room damage — broken lamp, photo on file'`.
  - Run: `cd hotel-app-be && DATABASE_URL=... cargo test --test
    deposit_checkout_guard` — new tests FAIL (extra args don't compile →
    that's the red state; compile-error red is acceptable for signature
    changes — note it in the commit message).
- [ ] **Step 2 — repository changes.**
  - `refund_deposit(pool, user_id, booking_id, payment_method,
    deposit_amount, transaction_reference: Option<&str>, note: Option<&str>)`:
    - dup-guard (line ~1281): drop `AND notes = 'Keycard deposit refund'`
      → `payment_type = 'refund' AND status = 'refunded'`.
    - INSERT: add `transaction_id` column + bind `transaction_reference`
      (`Option<&str>` binds as nullable text); notes bind =
      `format!("Keycard deposit refund{}", note.map(|n| format!(" — {n}")).unwrap_or_default())`;
      RETURNING `transaction_id AS transaction_reference` (replace the
      `NULL::text AS` placeholder).
  - `revert_deposit_refund` (line ~1477): same matcher change →
    `payment_type = 'refund' AND status = 'refunded'` (keep
    `ORDER BY id DESC LIMIT 1`). Update the comment about "marker text".
  - `forfeit_deposit(..., reason: &str, notes: Option<&str>)`: row notes =
    `format!("Deposit forfeited: {reason}")` +
    `notes.map(|n| format!(" — {}", n.trim())).filter(|s| s.len() > 22)`
    — simpler: build `let row_notes = match notes.map(str::trim).filter(|n|
    !n.is_empty()) { Some(n) => format!("Deposit forfeited: {reason} — {n}"),
    None => format!("Deposit forfeited: {reason}") }`.
- [ ] **Step 3 — service changes.**
  - `services/payments.rs::refund_deposit` (~line 543): parse
    `body.get("transaction_reference").and_then(as_str)` and
    `body.get("note").and_then(as_str)` (trim → `Option`); pass to repo;
    audit details add `"transaction_reference"` and `"note"` keys when
    present.
  - `forfeit_deposit` (~line 608): parse `body.get("notes")` the same way;
    pass through; audit details add `"notes"`.
- [ ] **Step 4 — green + gates.** `cargo test --test deposit_checkout_guard`
  passes; `cargo fmt`; `cargo clippy --all-features -- -D warnings`;
  `cargo check --all-features`. Commit:
  `feat(be): deposit refund/forfeit accept reference and staff notes`.

## Task 2 — FE service: extended signatures

File: `hotel-web-fe/src/api/invoices.service.ts`

- [ ] `refundDeposit(bookingId, paymentMethod, amount, extras?: {
  transaction_reference?: string; note?: string })` — include the two keys
  in `json` when non-empty after trim.
- [ ] `forfeitDeposit(bookingId, amount, reason, notes?: string)` — include
  `notes` when non-empty.
- [ ] `bun run typecheck`. Commit with Task 3 (small change).

## Task 3 — `useCheckoutInvoiceData` void-row fix + `useDepositResolution` hook

Files:
- `hotel-web-fe/src/features/invoices/hooks/useCheckoutInvoiceData.ts`
- `hotel-web-fe/src/features/invoices/hooks/useDepositResolution.ts` (new)
- `hotel-web-fe/src/features/invoices/hooks/useDepositResolution.test.ts` (new)

- [ ] **Step 1 — keep void rows.** In `useCheckoutInvoiceData.reloadPayments`:
  remove the `payment_status !== 'void'` filter (folio display already
  filters by status via `completedPayments`/`refundedPayments` in the
  modal); tighten `hasRefund` to `p.payment_status === 'refunded'` only
  (drop the `payment_type`/notes fallbacks — a voided refund row would
  otherwise keep the deposit "refunded" after revert).
- [ ] **Step 2 — failing hook tests** (`renderHook`): derivation returns
  `{ collected, refunded, forfeited, remaining, method, collectedAt,
  status, voidedDepositCount, mirrorDue }`; status enum covers the table in
  the spec (pending / refunded / partially forfeited / fully forfeited /
  cancelled / waived / none). Use `toMoneyNumber`/`isPositiveMoney` math.
- [ ] **Step 3 — implement `useDepositResolution`** with the derivation plus
  busy flags and the action handlers moved out of the modal:
  - `refund({method, reference, note})` — legacy mint first
    (`updateBooking` when `deposit_paid && !depositRows`), then
    `InvoicesService.refundDeposit`, then `reloadPayments` +
    `queryClient.invalidateQueries(invoices.payments + invoice.status)`.
  - `forfeit({amount, reason, notes})`.
  - `cancelUncollected(reason)` — auto-route: `depositRows.length === 0` →
    `BookingsService.updateBooking({deposit_paid:false, deposit_amount:0,
    payment_note: append('Deposit waived: {reason}')})` (keep the 'waived'
    vocabulary — `payment_note` sniffing is the existing reopen detection);
    rows exist → `deletePayment` each completed `deposit` row.
  - `revertRefund()`, `restoreDeposit()` — existing endpoints.
  - Each handler: set busy flag, `setError('')`, try/catch →
    `setError(toApiError)` preserving state, finally clear busy.
    Confirm-dialog prompts stay in the modal (they're orchestration).
- [ ] **Step 4 — green + typecheck + commit** with Task 2:
  `feat(fe): deposit resolution hook + voided-deposit derivation fix`.

## Task 4 — `DepositSection` rewrite

File: `hotel-web-fe/src/features/invoices/components/DepositSection.tsx`
(full rewrite of the card body; keep the filename).

- [ ] **Step 1 — update `CheckoutInvoiceModal.test.tsx` deposit tests to the
  new contract first** (they'll fail):
  - summary line shows held/collected-method/status chip;
  - three option rows; clicking mounts only that form;
  - refund CTA reads `Refund RM50.00`, calls service with
    method/reference/note;
  - forfeit flow: reason required → `Review forfeiture` → review copy
    "retaining RM20.00 … RM30.00 will remain to refund" → `Forfeit RM20.00`;
  - cancel: reason required; routes to updateBooking (no rows) or
    deletePayment (rows); warning copy present;
  - permission-missing → option disabled with "Requires …" caption;
  - resolved states → strip (refunded/forfeited/cancelled) + Revert/Restore
    per permission.
- [ ] **Step 2 — implement.** New prop contract (single `resolution` object
  from the hook + `busy` + `can*` flags + action callbacks + `readOnly` +
  `hotelSettings`):
  - Header row: `DiscOutlinedIcon` + "Security deposit" + `Chip` (status,
    spec colors) + held amount right-aligned (`fontVariantNumeric:
    'tabular-nums'`).
  - Summary `Typography` lines: collected via {method} · {collectedAt via
    `formatHotelDateTime`}; refunded/forfeited/remaining line when any
    non-zero.
  - When pending && !readOnly: "How should this deposit be resolved?" +
    three `Paper`/`ButtonBase` option rows (aria `role="radio"`,
    `aria-checked`, `tabIndex`), selected → `borderColor: primary.main`.
    Only selected option's `Collapse` mounts.
  - Refund panel: `formatMoney(remaining)` display, method `Select` from
    `hotelSettings.payment_methods`, `Reference` + `Note` optional fields,
    contained success CTA `Refund {formatMoney(remaining)}`, busy spinner.
  - Forfeit panel: amount `TextField` (inputMode decimal, default
    remaining, validate `>0 && <= remaining`), live "Remaining to refund
    after: RMx", reason `Select` (`ROOM_DAMAGE`/`MISSING_ITEM`/
    `OUTSTANDING_CHARGE`/`OTHER` → labels per spec; OTHER → notes
    `required`), `Review forfeiture` → review box with exact split →
    destructive `Forfeit {amount}` + `Back` (resets to form).
  - Cancel panel: recorded amount, "no money was received" explainer,
    required reason `TextField`, warning Alert "This does not issue a
    refund", warning CTA `Cancel deposit record`.
  - Resolved strips: refunded (success, shows method/time/reference +
    `Revert refund` under `payments:manage`), forfeited (warning, shows
    reason + split), cancelled (neutral) + `Restore deposit` under
    `payments:delete` when `voidedDepositCount > 0`.
  - Remove: "Other options" expander, separate Waive/Cancel/Restore
    buttons, the standalone refund method row.
- [ ] **Step 3 — green** (`bun run test -- CheckoutInvoiceModal`). Commit:
  `feat(fe): guided deposit resolution section`.

## Task 5 — `CheckoutInvoiceModal` wiring + readiness strip

File: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.tsx`

- [ ] Replace local deposit derivation/handlers (`recordedDeposit`,
  `depositRefunded` logic, `handleRefundDeposit`, `handleForfeitDeposit`,
  `handleWaiveDeposit`, `handleCancelDeposit`, `handleRestoreDeposit`,
  `handleRevertDepositRefund`, and their busy states) with the hook.
- [ ] `fullScreen={isPhone}` on the `Dialog` (portal pattern).
- [ ] Readiness strip replacing both old deposit alerts + confirm-step
  duplicate: compute `blockers: string[]` (deposit pending → "Resolve the
  {amt} security deposit"; `isPositiveMoney(remainingBalance) &&
  !canBillToCompany` → "Settle the outstanding bill balance of {amt}"):
  blockers.length ? amber "Checkout is not ready — …" : green "Ready for
  checkout — Bill paid · Deposit {resolved wording}".
- [ ] Balance strip: "Bill balance: RM0.00 — Paid/Partially paid/
  Outstanding" (explicit; replaces bare "Fully Paid"/"Balance Due").
- [ ] "No payments recorded" empty-state check uses displayable rows
  (`payments.length` now includes void rows → use
  `completedPayments.length + refundedPayments.length`).
- [ ] `handleDeletePayment`'s local refund-detection: `status ===
  'refunded'` only (void refund rows no longer removed upstream).
- [ ] Update confirm-step copy to reuse the same resolution wording.
- [ ] Green: `bun run test -- CheckoutInvoiceModal` + `typecheck` + `lint`.
  Commit: `feat(fe): checkout readiness strip + deposit resolution wiring`.

## Task 6 — remaining tests + cleanup

- [ ] Modal tests for readiness strip wording (blocked/ready), bill-balance
  label, permission-gated options, cancel auto-routing (both paths),
  refund reference/note passed to service.
- [ ] Check `useCheckoutFlow.test.tsx` and any `DepositSection`-direct tests
  for stale props.
- [ ] `git grep` for `Keycard deposit refund` in FE — confirm no FE code
  depends on the literal (the notes regex `/deposit\s*refund/i` still
  matches the composed note).
- [ ] Commit: `test(fe): deposit resolution coverage`.

## Task 7 — verification + review

- [ ] `hotel-app-be`: `cargo fmt --check`, `cargo check --all-features`,
  `cargo clippy --all-features -- -D warnings`, `cargo test --all-features`
  (record whether `DATABASE_URL` was set; integration files skip without
  it).
- [ ] `hotel-web-fe`: `bun run typecheck && bun run lint && bun run test &&
  bun run build`.
- [ ] Invoke `requesting-code-review` for the diff.
- [ ] Final summary per the spec's deliverables list.
