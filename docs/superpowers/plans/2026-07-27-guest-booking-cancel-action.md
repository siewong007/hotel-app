# Guest Booking Cancel Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show cancellation wording for unpaid guest bookings and retain refund wording only after a completed payment.

**Architecture:** Reuse `GuestPortalBookingSummary.completed_payment_id`, which the backend already emits for completed payments. Derive action copy in the shared guest bookings view so its desktop action, mobile action, dialog, and outcome message remain aligned while both flows use the current cancellation endpoint.

**Tech Stack:** React 19, TypeScript, MUI, Vitest, Testing Library.

## Global Constraints

- Preserve the existing guest cancellation endpoint and `can_cancel` eligibility behavior.
- Treat a non-null `completed_payment_id` as the sole completed-payment signal.
- Do not add dependencies or change the guest-portal API contract.

---

### Task 1: Guest booking action copy

**Files:**
- Modify: `hotel-web-fe/src/features/guestPortal/components/dashboard/PortalDashboardSections.tsx`
- Test: `hotel-web-fe/src/features/guestPortal/components/dashboard/PortalDashboardSections.test.tsx`

**Interfaces:**
- Consumes: `GuestPortalBookingSummary.completed_payment_id?: number | null`
- Produces: paid bookings retain refund copy; all other cancellable bookings use cancellation copy.

- [ ] **Step 1: Write the failing test**

```tsx
it('shows Cancel booking rather than Refund before payment is completed', async () => {
  mocks.bookings.mockResolvedValue({
    items: [{ ...booking, completed_payment_id: null }],
    total: 1,
  });

  render(<BookingsSection token="guest-token" />);

  expect(await screen.findAllByRole('button', { name: 'Cancel booking' })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/features/guestPortal/components/dashboard/PortalDashboardSections.test.tsx`

Expected: FAIL because the current component renders `Refund` for every cancellable booking.

- [ ] **Step 3: Write minimal implementation**

```tsx
const hasCompletedPayment = booking.completed_payment_id != null;
const actionLabel = hasCompletedPayment ? 'Refund' : 'Cancel booking';
```

Use the derived value for both action buttons and the shared dialog’s title, warning, reason label, submit label, and success message. Do not alter the endpoint call.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- --run src/features/guestPortal/components/dashboard/PortalDashboardSections.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run project checks**

Run: `npx tsc --noEmit && npm run build`

Expected: both commands exit 0.
