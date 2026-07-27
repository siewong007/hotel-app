# Guest Booking Cancel Action Design

## Goal

Make the guest portal distinguish an unpaid booking cancellation from a paid booking refund.

## Behavior

- When `completed_payment_id` is absent, show **Cancel booking** and cancellation-specific dialog and success copy.
- When `completed_payment_id` is present, keep the existing **Refund** action and refund copy.
- Both paths retain the existing cancellation endpoint, eligibility checks, and reason selection flow.

## Design

`GuestPortalBookingSummary.completed_payment_id` is already returned only for completed payments. The bookings section will derive the action copy from that field, so desktop and mobile actions and the shared dialog stay consistent without changing the API contract or backend workflow.

## Validation

Add guest-portal UI regression coverage for unpaid and paid booking actions, then run the focused Vitest file, TypeScript check, and production build.
