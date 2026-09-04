# Anonymous online booking

## Goal

Visitors can search availability, choose a room, enter a mandatory guest name
with optional email and phone, create a booking, and pay immediately without
creating an account or an authenticated guest-portal session.

## Scope

- Add a public booking page and public API surface for search, quote, and
  booking creation.
- Reuse the existing availability, allocation, room-rate, and booking-price
  validation rules.
- Create or reuse a guest record without creating a `users` row.
- Return a booking-scoped opaque payment capability after a successful
  anonymous booking. It permits payment for that booking only; it is not a
  login or portal session.
- Offer the existing immediate PayPal and bank-transfer payment paths using
  that capability.
- Send a booking confirmation and payment link only when the visitor supplied
  an email address.

## Explicit exclusions

- No account creation, automatic sign-in, or guest-portal session.
- No vouchers, complimentary-night credits, member pricing, portal booking
  history, cancellation, or profile features for anonymous checkout.
- The signed-in guest booking flow remains unchanged.

## Backend design

Public endpoints live under a dedicated public booking prefix and expose only
availability, public rates, booking creation, and the payment capability.
The public quote never accepts a voucher or complimentary credits. Booking
creation validates the name, sanitizes optional free text, reruns the quote,
checks the expected total, locks and allocates the room in the existing
transaction, and records the normal audit/history entries.

The booking receives a high-entropy opaque payment token, stored only as a
hash. Token payment routes resolve exactly one booking and retain their
existing payment validation; no route accepts a guest or user identifier from
the browser. Public search and booking creation receive dedicated per-IP rate
limits. Creation uses the existing client request id for idempotency.

## Frontend design

The landing-page booking CTAs open the public booking page. The page has four
steps: search, choose, guest details/review, and payment. Search and review
show standard online prices. Checkout requires a non-blank guest name; email
and phone are optional. After a successful creation the page displays the
booking reference and immediate payment controls. If email is absent, the
page tells the guest to retain the displayed reference and payment link.

## Error handling

The server remains authoritative for availability and price. A changed price
or lost room returns a conflict and moves the visitor back to a refreshed
review/search state. Invalid contact input produces field-level feedback.
Payment failures leave the booking pending payment and allow a retry through
the same booking-scoped capability.

## Verification

- Backend tests cover validation, public endpoint rate limiting, no-user guest
  creation, idempotency, token scope, and revalidation of price/availability.
- Frontend tests cover anonymous search, mandatory name validation, optional
  contact fields, the immediate-payment transition, and no redirect to login
  or registration.
- Run the relevant frontend tests plus frontend typecheck/lint, and backend
  targeted tests plus `cargo check --all-features`.
