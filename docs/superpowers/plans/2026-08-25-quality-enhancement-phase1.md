# Quality Enhancement — Phase 1 (Stabilize CI Signal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the four flaky payment-idempotency CI failures (plus the related fifth suite) and fix the guest-portal support-widget focus bug, changing no runtime behavior.

**Architecture:** Test-only fake-timer conversion using the repo-blessed `vi.useFakeTimers({ shouldAdvanceTime: true })` pattern (precedent: `BookingsPage.test.tsx:671`), and moving the widget's focus call into the `Slide` transition's `onEntered` callback where the close button is guaranteed mounted.

**Tech Stack:** Vitest + Testing Library (frontend), MUI v9 transitions. No new dependencies.

## Global Constraints

Spec: `docs/superpowers/specs/2026-08-25-quality-enhancement-design.md` (approved 2026-08-25).
- Volume path has a trailing space (`…EXTERNAL SSD `) — always quote shell paths.
- No runtime behavior changes; no route/response/permission changes.
- No new npm/cargo dependencies.
- FE gates are independent: `bun run typecheck`, `bun run lint`, `bun run test` (run from `hotel-web-fe/`).
- Concurrent sessions share this tree: `git status --short` before every edit; never touch dirty files you didn't create.
- Do not reformat untouched code; format touched lines only.

---

### Task 1: Fake-timer the two CheckoutInvoiceModal idempotency tests

**Files:**
- Modify: `hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx:146-177` and `:179-213`

**Interfaces:**
- Consumes: nothing (self-contained test change)
- Produces: deterministic versions of `reuses a failed booking-payment key…` and `reuses a failed ledger-payment key…`

- [ ] **Step 1: Wrap test 1 body in fake timers**

Inside `it('reuses a failed booking-payment key, rotates it after an edit, and clears it after success', …)` (line 146), wrap the entire existing body:

```tsx
it('reuses a failed booking-payment key, rotates it after an edit, and clears it after success', async () => {
  // Fake timers with automatic advancement make RTL's waitFor polling
  // deterministic under parallel-suite load; the code under test has no
  // timers of its own (same pattern as BookingsPage timezone test).
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    // …existing body unchanged, indented one level…
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 2: Same wrap for test 2**

Identical wrap for `it('reuses a failed ledger-payment key, rotates it after an edit, and clears it after success', …)` (line 179).

- [ ] **Step 3: Leave the file-level mitigation header in place**

The `configure({ asyncUtilTimeout: 10_000 })` header (lines 4–10) stays: the third test in this file (lost-response retention, line ~215) is not converted, so the wider window still serves it. Update the header comment to say the two idempotency suites are now fake-timer'd and the window covers the remaining lost-response suite.

- [ ] **Step 4: Run the file repeatedly**

Run (from `hotel-web-fe/`): `bun run test src/features/invoices/components/CheckoutInvoiceModal.test.tsx --run` five times consecutively.
Expected: PASS every run.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/invoices/components/CheckoutInvoiceModal.test.tsx
git commit -m "test(invoices): fake-timer the payment idempotency suites"
```

### Task 2: Fake-timer the BookingsPage idempotency test

**Files:**
- Modify: `hotel-web-fe/src/features/bookings/components/Bookings/BookingsPage.test.tsx:611-646`

- [ ] **Step 1: Wrap the test body**

Same wrap as Task 1 for `it('reuses a failed booking payment key, rotates it after a material edit, and clears it after success', …)` (line 611). Header comment (lines 4–10) updated to match reality (one unconverted lost-response-style sibling remains in this file? verify by grep for `mockRejectedValueOnce(new Error('timeout'))` — if none remains besides converted ones, note the header now only covers non-idempotency waits; keep the window either way).

- [ ] **Step 2: Run the file**

Run (from `hotel-web-fe/`): `bun run test src/features/bookings/components/Bookings/BookingsPage.test.tsx --run` five times.
Expected: PASS every run.

- [ ] **Step 3: Commit**

```bash
git add hotel-web-fe/src/features/bookings/components/Bookings/BookingsPage.test.tsx
git commit -m "test(bookings): fake-timer the payment idempotency suite"
```

### Task 3: Fake-timer the EnhancedCheckInModal idempotency test

**Files:**
- Modify: `hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.test.tsx:109-152`

- [ ] **Step 1: Wrap the test body**

Same wrap for `it('retries only the payment after check-in, reuses its key, and rotates it after an amount edit', …)` (line 109). Note this file's `afterEach` already calls `vi.restoreAllMocks()`; the in-test `finally { vi.useRealTimers() }` is still required (restoreAllMocks does not restore timers).

- [ ] **Step 2: Run the file**

Run (from `hotel-web-fe/`): `bun run test src/features/bookings/components/EnhancedCheckInModal.test.tsx --run` five times.
Expected: PASS every run.

- [ ] **Step 3: Commit**

```bash
git add hotel-web-fe/src/features/bookings/components/EnhancedCheckInModal.test.tsx
git commit -m "test(checkin): fake-timer the payment idempotency suite"
```

### Task 4: Fake-timer the CustomerLedgerPage key-reuse tests

**Files:**
- Modify: `hotel-web-fe/src/features/admin/components/CustomerLedger/CustomerLedgerPage.test.tsx` (~lines 839–1285)

- [ ] **Step 1: Identify the exact tests**

Read lines 830–1290. Convert ONLY the tests that assert idempotency-key retention/reuse around retried `createLedgerPayment` calls (first: `retains the idempotency key when the payment commits but the refetch fails`, line 839; second: `replays a lost-response single payment before validating an edited receipt with a new key`, line 869; continue to ~1285 and include any further key-reuse assertions, excluding unrelated pagination/print/filter tests).

- [ ] **Step 2: Apply the same wrap**

Each selected test gets the identical `vi.useFakeTimers({ shouldAdvanceTime: true })` / `try` / `finally { vi.useRealTimers() }` treatment. This file uses `act()` heavily — the wrap composes fine with `await act(async () => …)`.

- [ ] **Step 3: Run the file**

Run (from `hotel-web-fe/`): `bun run test src/features/admin/components/CustomerLedger/CustomerLedgerPage.test.tsx --run` five times.
Expected: PASS every run.

- [ ] **Step 4: Commit**

```bash
git add hotel-web-fe/src/features/admin/components/CustomerLedger/CustomerLedgerPage.test.tsx
git commit -m "test(admin-ledger): fake-timer the idempotency key-reuse suites"
```

### Task 5: Full-suite stability check

- [ ] **Step 1: Run the complete frontend suite once**

Run (from `hotel-web-fe/`): `bun run test`
Expected: all green in a single parallel run (the historical failure mode).

### Task 6: Fix PortalSupportWidget focus + regression test

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/components/PortalSupportWidget.tsx:41-50` (remove effect), `:81` (add `onEntered`)
- Modify: `hotel-web-fe/src/features/guestPortal/components/PortalSupportWidget.test.tsx` (Slide mock + assertion)

**Interfaces:**
- Produces: Slide receives `onEntered?: () => void`; close button receives focus after the enter transition completes.

- [ ] **Step 1: Write the failing test first**

In `PortalSupportWidget.test.tsx`, extend the Slide mock to honor `onEntered` after children mount (child effects run after refs attach):

```tsx
const React = await import('react');
// …inside the vi.mock factory:
Slide: function FakeSlide({
  in: isIn,
  onEntered,
  children,
}: { in?: boolean; onEntered?: () => void } & { children?: React.ReactNode }) {
  React.useEffect(() => {
    if (isIn) onEntered?.();
  }, [isIn, onEntered]);
  return isIn ? <>{children}</> : null;
},
```

Then replace the NOTE comment (lines 70–71) with a real assertion in `renders the support tab inside the panel when open…`:

```tsx
const closeButtons = document.querySelectorAll<HTMLButtonElement>('[aria-label="Close support"]');
expect(closeButtons.length).toBeGreaterThan(0);
expect(document.activeElement).toBe(closeButtons[closeButtons.length - 1]);
```

Run: `bun run test src/features/guestPortal/components/PortalSupportWidget.test.tsx --run`
Expected: FAIL (focus never moves — current bug).

- [ ] **Step 2: Move focus into onEntered**

In `PortalSupportWidget.tsx`: delete the focus `useEffect` block (lines 42–50, keeping the Escape effect above it) and pass the handler to the transition:

```tsx
<Slide
  in={open}
  direction="up"
  mountOnEnter
  unmountOnExit
  onEntered={() => closeButtonRef.current?.focus()}
>
```

- [ ] **Step 3: Run the widget suite**

Run: `bun run test src/features/guestPortal/components/PortalSupportWidget.test.tsx --run`
Expected: PASS.

- [ ] **Step 4: All three gates**

Run (from `hotel-web-fe/`): `bun run typecheck && bun run lint && bun run test`
Expected: all three green independently.

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/features/guestPortal/components/PortalSupportWidget.tsx \
        hotel-web-fe/src/features/guestPortal/components/PortalSupportWidget.test.tsx
git commit -m "fix(guest-portal): focus the support panel close button via onEntered"
```

### Task 7: Update the tracker

- [ ] **Step 1: Prune docs/ongoing-dev.md**

Delete the P2 bullet about flaky FE idempotency tests and the P2 a11y `PortalSupportWidget` focus bullet. Keep entries style: one line, deleted-when-done.

- [ ] **Step 2: Commit**

```bash
git add docs/ongoing-dev.md
git commit -m "docs(dev): retire shipped flaky-test and support-widget-focus items"
```
