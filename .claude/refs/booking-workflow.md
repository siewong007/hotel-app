# Booking Workflow (reference)

Rewritten 2026-09-15 against `origin/master` (`923c12bfd`). Every anchor below was
produced by `grep -n "fn <name>" <file>` on that commit — re-verify before relying
on one; anchors rot as code moves. The previous version of this file (2026-07-12,
anchors "re-verified" 2026-07-26) had drifted on **every** anchor and placed two
handlers in the wrong file, so treat any number here as a starting grep, not a fact.

**Four layers.** The load-bearing correction versus the old version: `services/`
is no longer a two-function bypass layer — it has grown to 1024 lines and now owns
the guest-cancel, unpaid-hold and reactivate flows as well.

- `routes/bookings.rs` — RBAC gate (`require_permission_helper`) + thin dispatch into `handlers::bookings::*`. 26 routes.
- `handlers/bookings.rs` (262 lines) — thin wrappers. **`delete_booking_handler` (:86) and `manual_checkin_handler` (:119) live HERE**, not in `lifecycle.rs` as the previous version of this doc claimed.
- `services/bookings.rs` (1024 lines) — `can_book_with_credits_for_guest` (:37), `cancel_pending_booking_by_guest` (:88), `release_pending_payment_booking` (:183), `release_stale_unpaid_holds` (:376, driven by `services/unpaid_hold_scheduler.rs`), `void_booking` (:428), `manual_checkin` (:535), `checkin_booking_flow` (:574), `reactivate_booking` (:810). These do permission/ownership checks beyond the route gate, then delegate to the repository.
- `repositories/bookings/lifecycle.rs` (3366 lines) — where most booking logic actually lives.
- `repositories/bookings/{checkin_advisory,complimentary,credits}.rs` — split-out sub-areas.

**Status vocabulary** — the baseline `bookings_status_check` CHECK allows exactly:
`pending`, `pending_payment`, `pending_confirmation`, `confirmed`, `checked_in`,
`auto_checked_in`, `checked_out`, `no_show`, `completed`, `comp_void`,
`partial_complimentary`, `fully_complimentary`, `voided`. No patch alters it.

> **`late_checkout` is NOT a legal booking status** — it is absent from the CHECK
> constraint, yet three code paths still test for it (`lifecycle.rs:168`,
> `lifecycle.rs:1456`, `repositories/analytics.rs:1305`). Those branches can never
> match. The previous version of this doc listed it as a real off-path status.
> Don't build on it; removing it is a behavior decision, not a cleanup.

**Routes** (`hotel-app-be/src/routes/bookings.rs`) — per-route
`bookings:<read|create|update|delete|manage>` via `require_permission_helper`;
code lookups (`/rate-codes`, `/market-codes`) are auth-only. Guests reach their own
bookings only through the guest portal (`/guest-portal/me/bookings`,
`routes/guest_portal.rs`); the legacy `/bookings/my-bookings` endpoints were
removed 2026-07-27.

Key logic in `repositories/bookings/lifecycle.rs`:

- **`create_booking_handler`** (:1003) — opens a tx, locks the room with `SELECT … FOR UPDATE OF r` (:1035), checks overlapping active bookings, then computes `is_tourist`/tourism tax from the guest via the shared helper **`canonical_tourism_tax_for_guest`** (:237, called at :1098) rather than trusting the request. Subtotal comes from `daily_rates` when supplied, else `room_rate × nights` (:1112). When `booking_channel_id` is set, channel economics are resolved and **snapshotted** onto the row: `commission_amount`, `net_revenue`, `channel_pricing_snapshot` jsonb (resolved rule + rates), plus `rate_plan_id` and optional `commission_*_override` inputs — explicit staff `daily_rates`/`room_rate_override` still win over channel rules. Inserts with status `'confirmed'` hardcoded, sets the room `reserved`/`reserved_dirty` (dirty/cleaning rooms take the `_dirty` suffix), and optionally records a deposit `payment` row inside the same tx before committing.
- **`update_booking_handler`** (:1358) — RBAC + room/date conflict re-check; when dates change with no explicit `daily_rates` payload it **rebuilds `daily_rates`** (:1529) across the new `[check_in, check_out)` range, preserving existing per-night values by date and filling new nights at `room_rate` (without this, shrinking leaves orphan keys → over-charge; extending leaves missing keys → under-charge). When the channel/dates/rates inputs change, the commission + net-revenue snapshot is **re-resolved and re-written**; `commission_*_override` fields survive repricing and win over the snapshot in reports. Before a `checked_out`/`completed` transition **`ensure_checkout_balance_resolved`** (:824) blocks checkout with a balance due unless the booking is company-billed. On the transition: room → `dirty`, invoice via `services::payments::ensure_invoice_for_booking` (best-effort — failure logged, not fatal), and if company-billed **`auto_post_company_ledger`** (:549). A non-checkout edit that changes the total **syncs `customer_ledgers.amount` by delta** (:1649) — only `pending`/`partial` `room_charge` rows, preserving user-added extras.
- **`manual_checkin_handler`** — in `handlers/bookings.rs:119`; calls `services::bookings::manual_checkin` (:535), which permission-checks (`bookings:update`/`bookings:manage`, or the booking's creator) and delegates to `checkin_booking_flow_for_booking`. Sets `checked_in` + `actual_check_in`, records optional deposit/payment, sets room `occupied`.
- **`delete_booking_handler`** — in `handlers/bookings.rs:86`; calls `services::bookings::void_booking` (:428), which checks `bookings:update`/`bookings:delete`/`bookings:manage` or ownership. Soft-void in a tx: status → `voided` (`void_booking_tx`, :2343), frees the room (`release_room_tx`, :2415), cancels linked payments (`void_booking_payments_tx`, :2427) so they stay out of night audit, **voids open unpaid linked ledger rows** (`void_booking_ledgers_tx`, :2459 — rows with `paid_amount > 0` are deliberately left open for reconciliation), and restores complimentary nights (`restore_complimentary_credits_tx`, :2528).
- **`reactivate_booking_handler`** (:2172) — via `services::bookings::reactivate_booking` (:810).

**Frontend**: `src/api/bookings.service.ts` (`BookingsService`) wraps the endpoints;
`features/bookings/hooks/` holds `useBookings.ts`, `useBookingQueries.ts`
(`useBookingsPage` uses `placeholderData: keepPreviousData`), `useBookingActions.ts`,
`useCheckInFormData.ts`, `useEnhancedCheckInModalState.ts`.
**`useBookingsPageState.ts` no longer exists** — the previous version of this doc
pointed `handleConfirmCheckout` at it; that function now lives in
`features/invoices/components/CheckoutInvoiceModal.tsx:510`.
`features/bookings/components/Bookings/BookingsPage.tsx` is now **488 lines** (was
2703 before the split) and renders `BookingDetailDrawer` (:471) for row clicks.
`features/invoices/hooks/useCheckoutFlow.ts` is the shared checkout flow, also used
by `CustomerLedgerPage`; `useDepositResolution.ts` alongside it owns the
deposit-refund/forfeit resolution shipped with patch `1.2 deposit-forfeited`.
