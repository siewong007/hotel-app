# Notifications v2 (Email Triggers) — Design

Date: 2026-08-26
Status: Approved by owner (approach A, outbox-native)
Scope: hotel-app-be primarily; no frontend changes required (preferences and
campaign UIs are unaffected). SMS channel deferred to its own future spec.

## Goal

Add two transactional email triggers to the existing durable outbox —
**checkout receipt** and **pre-arrival reminder** — and fix, by design, the v1
consent gate that suppresses every transactional `booking_confirmation`
delivery.

## Background (verified 2026-08-26)

- Outbox: `email_deliveries` table; worker (`modules/communications/worker.rs`)
  claims rows with a 5-minute lease, max 5 attempts, exponential backoff.
- Scheduler: `scheduler.rs` runs a 60s loop (campaigns, birthday vouchers).
- Consent: `notification_subscriptions.topics` CHECK allows only
  `announcement|promotion|birthday_voucher`. The worker's pre-send recheck
  (`repository.rs::is_guest_deliverable`) requires a subscribed row for
  `delivery.topic` — but no row for topic `booking_confirmation` can exist, so
  all transactional booking confirmations appear to be marked `suppressed`.
- Checkout is not an endpoint: it is the checked-out branch of
  `repositories/bookings/lifecycle.rs::update_booking_handler`, which
  idempotently generates the invoice via
  `services/payments.rs::ensure_invoice_for_booking_tx` (~lifecycle.rs:1943).
  Night audit auto-checkout flows through the same transition.
- No PDF infrastructure exists server-side; receipt is inline HTML.

## Design

### 1. Data model

One checksum-verified catalog patch under `database/postgres/patches/` plus the
identical change in `0001_v1_baseline.sql`:

1. `email_deliveries.kind` CHECK extended with `'checkout_receipt'`,
   `'pre_arrival_reminder'` (existing kinds untouched).
2. New `system_settings` keys:
   - `pre_arrival_reminder_enabled` — boolean, default **false** (opt-in).
   - `pre_arrival_reminder_hours_before` — integer, default **48**, clamped
     to 2–168 by validation wherever read.

Patch follows the manifest/apply rules: published versions immutable, desktop
`postgres/patches.rs` picks it up automatically.

### 2. Checkout receipt

- Enqueued in the checkout transition's post-commit best-effort block,
  immediately after `ensure_invoice_for_booking` succeeds (that helper opens
  its own transaction after the booking tx commits — relocating it would
  change working payment-adjacent behavior). Capture the returned invoice
  number (currently discarded) for the idempotency key. Enqueue failure is
  logged, matching every sibling side effect.
- Idempotency key: `checkout-receipt:{invoice_number}` — staff re-saves,
  retries, and night-audit auto-checkouts cannot double-send.
- Recipient: guest email. Skipped when the folio is company-billed (no personal
  receipt for corporate stays) or the guest has no email on file.
- Content: greeting, booking number, invoice number, stay dates, room/night
  summary, total charged, payments received, remaining balance, unsubscribe
  footer link. (`invoices.line_items` is stored as an empty JSON array today,
  so the receipt summarizes from booking + payment totals rather than pretend
  to itemize.)
  (kept deliberately), and a link to the guest portal's bookings page
  (`/portal` front-end route; session required). Portal-less walk-in guests
  need no link — the inline itemization IS the receipt. There is no public
  per-token bill view today; building one stays out of scope.
- Body lives as a code-side constant next to the other four transactional
  templates (consistent with current practice; DB-editable templates remain
  campaign-only).

### 3. Pre-arrival reminder

- New `tick_pre_arrival_reminders` in `scheduler.rs`'s 60s loop.
- Selection: bookings with status `confirmed|pending`, check-in date within
  `[today, today + hours_before]`, guest has email, not suppressed, and no
  prior delivery with key `pre-arrival:{booking_id}`.
- Settings toggle off → tick returns immediately.
- Idempotency key makes it once-per-booking across restarts and scheduler
  races (unique conflict = already queued/sent).

### 4. Consent gate fix

`is_guest_deliverable` becomes kind-aware:

- Transactional kinds (`booking_confirmation`, `online_room_assignment`,
  `payment_receipt_request`, `payment_rejected`, `checkout_receipt`,
  `pre_arrival_reminder`) **skip the subscription-row requirement**; hard
  suppressions (`bounce`, `complaint`, manual) still apply.
- Marketing kinds (`campaign`, `birthday_voucher`) unchanged: subscription +
  suppression checks as today.

Regression test (live PostgreSQL, `#[ignore]`-gated like its peers): a
`booking_confirmation` delivery sends successfully with zero subscription rows
for the guest — fails on v1 code.

### 5. Hardening rider

Attach the existing `sensitive` rate-limiter tier to both
`GET/POST /communications/unsubscribe/{token}` (currently unthrottled).

## Testing

- Backend unit: hours clamp, selection window boundaries, idempotency-key
  collision behavior.
- Integration (DATABASE_URL-gated): checkout transition enqueues exactly one
  receipt per invoice; company-billed skips; night-audit auto-checkout path;
  reminder fires inside window once, not twice; consent regression test from §4;
  status-vocabulary guard updated for the widened kind CHECK.
- Frontend: none required (no UI changes); existing suites must stay green.
- Gates: `cargo clippy --all-features -- -D warnings`, full backend suite,
  FE three gates unaffected but run before merge.

## Out of scope

SMS channel, PDF attachments, DB-editable transactional templates, digests/
batching, non-email channels of any kind.
