# Deposit Refund Guard Design

## Goal

Prevent a keycard-deposit refund when no deposit is recorded for the booking or
when the requested refund exceeds the recorded amount.

## Deposit source

Inside the refund transaction, lock the booking row and determine the refundable
amount as follows:

1. Use `bookings.deposit_amount` when `bookings.deposit_paid` is true and the
   amount is positive. This is the authoritative legacy source used by existing
   hotel data.
2. Otherwise, use the sum of completed `payments` rows whose `payment_type` is
   `deposit`. This preserves the current payment-recording workflow.

The two sources are alternatives, not additive, so a deposit represented in both
places cannot be counted twice.

## Transaction and behavior

The repository transaction will lock the booking, reject a missing or excessive
deposit, check for an existing refund, insert the refund, and commit. Partial
refunds remain allowed to avoid expanding the behavioral change beyond the
confirmed defect; the existing one-refund-per-booking rule remains unchanged.

No schema or API response-shape change is required.
