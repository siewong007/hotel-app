# Booking workflow — staff + guest portal

Booking CRUD + check-in/checkout + void + guest-portal self-service. Read
`backend-architecture.md` first. Code under `hotel-app-be/src/modules/bookings/`
(the domain-module migration moved every domain under `modules/<domain>/`);
frontend under `hotel-web-fe/src/features/bookings/` +
`hotel-web-fe/src/routes/_authenticated/bookings/`. Verified 2026-09-17 against
master.

## Layers

- `modules/bookings/routes.rs` (356 lines) — RBAC gate + dispatch, 28 routes.
- `modules/bookings/handlers.rs` (268 lines) — thin request → service wrappers:
  `void_booking_handler` (:102, renamed from `delete_booking_handler`),
  `manual_checkin_handler` (:125), `reactivate_booking_handler` (:260).
- `modules/bookings/service.rs` (1027 lines) — service-layer permission and
  cross-domain helpers: `can_book_with_credits_for_guest` (:37),
  `cancel_pending_booking_by_guest` (:88), `release_pending_payment_booking`
  (:184), `release_stale_unpaid_holds` (:377 — driven by
  `modules/bookings/unpaid_hold_scheduler.rs`), `void_booking` (:429),
  `manual_checkin` (:536), `checkin_booking_flow` (:575),
  `reactivate_booking` (:813).
- `modules/bookings/lifecycle.rs` (3726 lines) — most booking logic: create /
  list / get / update / checkout / reactivate / void tx helpers.
- Split-out siblings in the same directory: `checkin_advisory.rs`,
  `complimentary.rs`, `credits.rs`, `auto_checkin.rs`, `emails.rs`,
  `helpers.rs`, `list.rs`, `queries.rs`, `summary.rs`.

## Status vocabulary

`bookings.status` CHECK constraint (`bookings_status_check`, baseline :1624):
`pending`, `pending_payment`, `pending_confirmation`, `confirmed`,
`checked_in`, `auto_checked_in`, `checked_out`, `no_show`, `completed`,
`comp_void`, `partial_complimentary`, `fully_complimentary`, `voided`.
`cancelled`, `complimentary`, `unpaid`/`paid` (that's `payment_status`) are
**not** legal booking statuses.

`late_checkout` is **not** a valid status — several dead branches still check
for it: `modules/bookings/lifecycle.rs`:220, :1624, :2484 and
`modules/analytics/repository.rs`:1305. Don't copy the pattern.

## Routes (staff)

`modules/bookings/routes.rs` gates each of the 28 routes with
`bookings:read|create|update|delete|manage` (manage = delete/void/reactivate).
Guest-portal self-service lives in `modules/guest_portal/routes.rs` under
`/api/guest-portal`.

## Key logic

- `create_booking_handler` (`lifecycle.rs`:1063) — locks the room row with
  `FOR UPDATE OF r` (:1096) before insert, so a first insert can't race a
  conflicting one. Channel economics resolve here when `booking_channel_id`
  is set: quote lookup computes `commission_amount`,
  `channel_pricing_snapshot`, and `net_revenue` (:1192–:1279) — but only for
  non-staff-priced bookings (staff `daily_rates`/`room_rate_override` wins,
  :1217). `daily_rates` summed for subtotal when provided (:1174);
  `canonical_tourism_tax_for_guest` (:289, called :1161) supplies the default
  tax amount.
- `update_booking_handler` (`lifecycle.rs`:1526) — rebuilding `daily_rates`
  when dates/nights change; `ensure_checkout_balance_resolved` (:883) blocks
  checkout while balance outstanding, except company-billed;
  `auto_post_company_ledger` (:608); the ledger delta sync at :2188
  re-replaces room lines; `fetch_booking_detail` joins `booking_channels`.
- `manual_checkin_handler` (`handlers.rs`:125) → `service.rs:manual_checkin`
  (:536) → `checkin_booking_flow` (:575) →
  `checkin_booking_flow_for_booking`.
- `void_booking_handler` (`handlers.rs`:102) → `service.rs:void_booking`
  (:429) → `lifecycle.rs:void_booking_tx` (:2687) which calls
  `release_room_tx` (:2759), `void_booking_payments_tx` (:2771),
  `void_booking_ledgers_tx` (:2805), `restore_complimentary_credits_tx`
  (:2874). Soft-voids (keeps the row for history).
- `reactivate_booking` (`service.rs`:813) → lifecycle (:2516).

## Frontend

`features/bookings/BookingsPage.tsx` — the staff bookings list;
`features/bookings/components/BookingDetailDrawer.tsx` (:431 →
`createCheckoutInvoice` → `CheckoutInvoiceModal`) hosts the checkout flow
including `handleConfirmCheckout` (`CheckoutInvoiceModal.tsx`:512, posts to
`/api/invoices` then `/api/bookings/:id/checkout`). State lives in page
hooks under `features/bookings/hooks/`; there is no
`useBookingsPageState` hook (removed 2026-09-09).
