# Cross-domain seams audit — booking / payment / ledger / invoice / guest-portal

Scope: hotel-app-be. All line numbers verified in-session via Grep/Read against the
working tree on 2026-07-27 (paths relative to `hotel-app-be/`).

## 1. Call graph

### guest_booking (modules/guest_booking) — self-contained booking core
`modules/guest_booking/service.rs` and `repository.rs` implement their OWN
availability, pricing and booking-insert logic. They call OUT to the legacy
domains at exactly these points (grepped `src/modules/guest_booking/*.rs` and
`src/services/guest_portal.rs` for `crate::repositories::bookings`,
`crate::services::bookings`, `crate::services::payments`,
`crate::repositories::payment`, `crate::repositories::ledger`):

- `modules/guest_booking/service.rs:506` → `repositories::bookings::record_booking_history_tx` (shared history writer; the ONLY call from guest_booking into the legacy bookings repository).
- `services/guest_portal.rs:399` → `services::bookings::cancel_pending_booking_by_guest` (shared cancel/void core).
- `services/guest_portal.rs:478,524` → `services::payments::create_bank_transfer_claim`.
- `services/guest_portal.rs:505,551` → `services::payments::create_paypal_order`.
- `services/guest_portal.rs:516,561` → `services::payments::capture_paypal_payment`.
- `services/guest_portal.rs:488,535` → `repositories::payment::PaymentRepository::get_payment_for_review`.
- `services/guest_portal.rs:496,543` → `services::payments::save_payment_receipt`.

No call from `modules/guest_booking/*` or `services/guest_portal.rs` into
`repositories/ledger.rs` or `services/ledgers.rs` (grepped, zero hits) —
guest/portal code never touches the ledger domain directly.

### services/payments.rs — the real shared seam
`services/payments.rs` is the ONE place both channels converge:
- Admin/staff entry points (`handlers/payments.rs:32,205,229`) call
  `create_payment`, `approve_payment`, `reject_payment`.
- Guest entry points (`services/guest_portal.rs`, listed above) call
  `create_bank_transfer_claim`, `create_paypal_order`, `capture_paypal_payment`.
- The PayPal webhook (`handlers/webhooks.rs:152`) calls
  `apply_paypal_webhook_event`.
- ALL of these paths bottom out in the same `payments` table writes and the
  same `recompute_payment_status_tx` (`services/payments.rs:96`) and
  `confirm_booking_tx` (`repositories/bookings/lifecycle.rs:3168`, called via
  `complete_and_confirm` at `services/payments.rs:1548` and directly from
  `record_payment` at `services/payments.rs:261`). This is a genuinely unified
  seam — booking confirmation-on-payment behaves the same regardless of
  channel. `services/payments.rs:12` imports
  `repositories::guest_portal::GuestPortalRepository` (used at line 1244 to
  re-fetch the booking for amount verification), so payments.rs is not fully
  domain-pure, but the dependency is one-directional (payments → guest_portal
  repository, never back).

### repositories/ledger.rs / services/ledgers.rs
`services/ledgers.rs` is a thin passthrough to `repositories/ledger.rs`
(confirmed prior session, re-verified: no guest/portal caller reaches either
module — grepped `ledger::`/`ledgers::` in `services/guest_portal.rs`,
`modules/guest_booking/*.rs`, zero hits). Ledger rows are posted only from
`repositories/bookings/lifecycle.rs` (company-billing auto-post at
lines ~611-644) and from checkout/night-audit flows — entirely admin-side.
**This means the guest/online booking channel has no ledger integration at
all**: a company-billed booking can only be created admin-side today (the
guest portal has no company/city-ledger concept), so this asymmetry is by
current design, not a bug — but an extraction must decide whether "booking
core" owns ledger-posting or leaves it a legacy-only add-on.

### services/invoice_numbers.rs — clean single-writer utility
`next_invoice_number` (services/invoice_numbers.rs:19) is called from 5 sites
(`repositories/bookings/lifecycle.rs:625`, `repositories/ledger.rs:411,1013`,
`services/payments.rs:499,662`) — one function, no duplication, regardless of
which channel created the booking. Good precedent for how a shared module API
should look.

### Circular dependencies / inversions
None found in the guest⇄legacy direction: grepped every legacy booking/payment
file (`repositories/bookings/*.rs`, `services/bookings.rs`, `services/payments.rs`,
`repositories/payment.rs`, `repositories/ledger.rs`) for `modules::guest_booking`
and `services::guest_portal` — zero hits. The dependency graph is one-directional
(guest → legacy), which is the easy direction to refactor from. No
repository-calling-service inversions found in the files read for this audit.

## 2. Guest vs Admin divergence table

| # | Rule | Guest-side | Admin-side | Verdict |
|---|---|---|---|---|
| a | Availability/overlap detection | `modules/guest_booking/repository.rs:225-264` (`ensure_online_room_available_tx`) and `:286-328` (`list_inventory`) use the same active-status set (local const `ACTIVE_BOOKING_STATUSES`, repository.rs:15) as admin's create path | `repositories/bookings/lifecycle.rs:984-992` (`create_booking_handler`'s inline conflict query) uses an identical literal status list | **Agree** at booking-creation time. **Diverge** at the admin room-search endpoint: `repositories/rooms_queries.rs:172-178` (`SEARCH_ROOMS_WITH_DATES_QUERY`, backs `GET /rooms?check_in_date=&check_out_date=`, `rooms:read`) uses a SHORTER list `('reserved','confirmed','checked_in','auto_checked_in','pending')` that omits `pending_payment` and `pending_confirmation` — a room a guest just reserved online (status `pending_payment`) shows as available in this admin search, so a front-desk agent can double-book it. |
| b | Rate & total computation incl. taxes/tourism tax | `nightly_rates`/`applicable_rate` (`modules/guest_booking/service.rs:46-76`, `repository.rs:344-384`) look up `rate_plans`/`room_rates` by date + day-of-week, falling back to `room_types.weekday_rate`/`weekend_rate`. Tax: hardcoded `tax_amount = Decimal::ZERO` (`service.rs:154`, `insert_booking_tx` literal `0` at `repository.rs:567`); `is_tourist`/`tourism_tax_amount` are never set (not in the guest INSERT's column list at all, `repository.rs:559-569`). | `create_booking_handler` (`lifecycle.rs:1008-1033`) ignores `rate_plans`/`room_rates` entirely (grepped both files for `rate_plan`/`room_rates` — 0 hits) — it always prices off `rooms.custom_price`/`room_types.base_price` (or `room_rate_override`). It DOES call `canonical_tourism_tax_for_guest` (`lifecycle.rs:1009`, defined `:240-265`) to set `is_tourist`/`tourism_tax_amount` when `guests.tourism_type = 'foreign'`. `repositories/bookings_queries.rs:112,120` (admin bookings-list balance-due calc) bills `total_amount + tourism_tax_amount + extra_bed_charge` — i.e. tourism tax IS a real extra charge collected at checkout for admin-created bookings. | **Diverge**, two independent ways: (1) rate source (rate-plan vs flat room price) can differ for the identical room+date; (2) tourism tax for a foreign guest is charged when staff create the booking but **never charged at all** when the same guest books online — a real, silent revenue leak, not a documented policy choice. |
| c | Min/max stay & advance-booking limits | `modules/guest_booking/validation.rs:7-8,44-71` hardcodes `MAX_BOOKING_NIGHTS=30`, `MAX_ADVANCE_BOOKING_MONTHS=3`, and rejects a past check-in date. | `create_booking_handler` (`lifecycle.rs:913-1202`) has no equivalent checks at all — only `check_out >= check_in` (`:923-927`). Grepped the whole admin booking-create/update path for `min_advance`/`max_advance`/nights caps — the only `min_nights`/`max_nights`/`min_advance_booking`/`max_advance_booking` columns in the schema belong to `rate_plans` (`repositories/rate.rs`) and are used only for promotion-voucher eligibility (`modules/guest_booking/repository.rs:409-410,461-462`, table alias `p`=`promotions`), never as a general stay-length/lead-time policy. | **Only-one-side** — guest portal enforces stay-length/lead-time limits, admin walk-in/phone bookings have none. Could be intentional (staff need override capacity) — flag as a policy question, not a bug, if intentional; currently looks like an oversight since there is no admin equivalent to opt out of. |
| d | Deposit requirements | `create_bank_transfer_claim` (`services/payments.rs:735-800`) always claims `booking.total_amount` in FULL (comment at :734: "for the full booking total"); `create_paypal_order` likewise sizes the order off the full booking total. No partial/deposit concept exists anywhere in `modules/guest_booking` or the guest payment-claim functions. | `create_booking_handler` accepts an optional `input.amount_paid` of ANY size as a deposit (`lifecycle.rs:1152-1165`), and `services::payments::record_payment` (`:187-274`) explicitly supports partial payments, only auto-confirming the booking once `settles_balance_in_full` (`:238`). | **Diverge** — admin path supports arbitrary partial/deposit payments; guest-portal path is full-payment-only with no deposit option. This is a genuine product/policy question (should guests be able to pay a deposit online?), not something to silently "fix" one way. |
| e | Booking status on creation | `insert_booking_tx` always creates status `'pending_payment'` (`modules/guest_booking/repository.rs:567`). | `create_booking_handler`'s INSERT always creates status `'confirmed'` (`lifecycle.rs:1082`, literal in the VALUES clause) — admin bookings never pass through a "pending" state even when no `amount_paid` was supplied. | **Diverge by design** — reflects that admin/walk-in bookings are treated as committed at creation while online bookings wait for payment. Documented behavior (both `confirm_booking_tx` at `lifecycle.rs:3168-3185` and `services/bookings.rs:75-83`'s comments describe this explicitly), not a defect — but it means "booking status on creation" is NOT a single rule an extracted module can apply uniformly; it has to stay channel-aware. |
| f | Payment recording — what row(s) | Guest flows insert into `payments` as `'pending'` first (`create_bank_transfer_claim`, `create_paypal_order`), then the PayPal webhook/capture path (`apply_webhook_capture_completed`, `services/payments.rs:1197-1317`) or staff bank-transfer approval updates that SAME row to `'completed'`/`'failed'`, via `complete_and_confirm` (`:1548`) which also calls `confirm_booking_tx`. | Admin manual payment inserts a new `'completed'` `payments` row directly (`create_payment` → `PaymentRepository::create_completed_payment`, `services/payments.rs:128-185`), or `record_payment` (`:187-314`) which can be partial and calls `confirm_booking_tx` only when it fully settles. | **Agree** on the write target (both channels write the same `payments` table row shape and go through the same `recompute_payment_status_tx`/`confirm_booking_tx`) — this is the best-unified seam in the whole system. The only structural difference is insert-then-update (async gateway capture) vs insert-once-completed (synchronous staff entry), which is inherent to the payment method, not a policy divergence. |
| g | Cancellation/void rules | `cancel_pending_booking_by_guest` (`services/bookings.rs:86-138`) — ownership-gated (`user_owns_booking`), restricted to `is_guest_cancellable_booking` statuses (`:78-83`: pending/pending_payment/pending_confirmation/confirmed), voids ONLY uncompleted payments (`void_uncompleted_booking_payments_tx`, `lifecycle.rs:2816-2829`, comment explains completed payments are kept "for reconciliation and any later refund"). | `void_booking` (`services/bookings.rs:140-230`) — permission-gated (`bookings:update`/`delete`/`manage`, OR ownership as an unreachable fallback — see finding below), allowed from ANY non-voided status including `checked_in`/`checked_out`, voids ALL payments including completed ones (`void_booking_payments_tx`, `lifecycle.rs:2798-2812`), and additionally restores complimentary-night credits (`restore_complimentary_credits_tx`). | **Diverge, intentionally** for the payment-voiding behavior (documented in-code) and **agree** on the shared transactional core (`void_booking_tx`, `release_room_tx`, `record_booking_history_tx`, `record_booking_void_modification_tx` are called by BOTH paths — good DRY seam). The admin path's broader status range and full payment-voiding (including completed payments, with no refund/reversal trail — see Finding 8 below) is the one part that looks under-specified rather than deliberately designed. |
| h | Who may see/modify | Two parallel "my bookings" surfaces with DIFFERENT ownership joins: `GET /guest-portal/me/bookings` (`services/guest_portal.rs:339-361`) resolves via the guest-portal session's `guest_id` directly. `GET /bookings/my-bookings` (`handlers/bookings.rs:886-911`) instead joins `bookings.guest_id → guests.email` against `users.email` for the JWT-authenticated caller (`repositories/bookings_queries.rs:96-135`, `WHERE g.email = $1`) — a THIRD, weaker ownership model than the `user_guests`/`users.guest_id` relation `user_owns_booking` (`lifecycle.rs:2697-2712`) uses for cancel/void authorization. | Admin list/get (`bookings:read`) and modify (`bookings:update`/`delete`/`manage`) are permission-gated, no ownership concept. | **Diverge in a way that's a real bug, not just a policy choice** — see Finding 1 below (email-based ownership vs FK-based ownership can both leak another guest's bookings and hide the caller's own). |

## 3. Tables written from more than one domain (derived via `grep -rln "INSERT INTO <table>"` / `"UPDATE <table>"` across `hotel-app-be/src/`)

- **`bookings` (status column)** — `UPDATE bookings SET status` appears in
  `repositories/booking.rs`, `repositories/bookings/complimentary.rs`,
  `repositories/bookings/lifecycle.rs`, `repositories/data_transfer.rs`,
  `repositories/ekyc.rs`, `repositories/guest_portal.rs`,
  `repositories/night_audit.rs`, `repositories/payment.rs`,
  `repositories/rooms_queries.rs`, and `modules/settings/repository.rs`
  (auto-checkin/late-checkout batch job, `:140-147,181-188`) — **10 files**
  write this one column. `INSERT INTO bookings` happens in 4 places:
  `repositories/booking.rs` (dead, see Finding 2), `repositories/bookings/lifecycle.rs`,
  `repositories/bookings/credits.rs`, `modules/guest_booking/repository.rs`.
- **`payments`** — `INSERT INTO payments` in `repositories/payment.rs` and
  `repositories/bookings/lifecycle.rs` (the admin at-creation deposit path,
  which calls into `record_checkin_payment_tx` — itself defined in
  lifecycle.rs and reused by both the create-booking deposit and the
  check-in/checkout deposit flows).
- **`rooms` (status column)** — `UPDATE rooms SET status` in
  `repositories/bookings/credits.rs`, `repositories/bookings/lifecycle.rs`,
  `repositories/rooms_queries.rs`, plus `modules/settings/repository.rs`
  (`mark_auto_checked_in_rooms_occupied`, `:162-178`).
- **`customer_ledgers`** — written only from `repositories/bookings/lifecycle.rs`
  (company-billing auto-post + total-change sync) and `repositories/ledger.rs`
  proper — never from guest/portal code (confirmed, see call graph above).
- **`vouchers` / `voucher_redemptions`** — written only from
  `modules/guest_booking/repository.rs:595-644` (`redeem_voucher_tx`) — no
  admin-side voucher redemption path exists at all (admin bookings have no
  voucher/promotion application in `create_booking_handler`).

The `bookings.status` and `rooms.status` fan-in (10 and 4 writer files
respectively) is the single biggest coupling risk for any module-boundary
rework: a status-machine extraction has to either absorb `modules/settings`'
scheduled job and `repositories/ekyc.rs`/`night_audit.rs` as first-class
callers of the new module's API, or those call sites will keep writing SQL
directly against a table another module now "owns".

## 4. Minimal public API an extracted booking/payment/ledger module would need

Derived from the concrete cross-domain call sites in §1 (not aspirational):

- **Booking core**: a single `create_booking(channel, ...) -> Booking` that
  both `create_booking_handler` (admin) and `modules::guest_booking::service::create`
  can call, parameterized on rate source (flat price vs rate-plan) and initial
  status (confirmed vs pending_payment) — today these are two independent
  implementations of insert+availability+pricing that happen to agree only by
  discipline, not by construction (see Findings 3, 4 below).
  Plus: `record_booking_history_tx`, `void_booking_tx` /
  `void_uncompleted_booking_payments_tx` / `void_booking_payments_tx`,
  `release_room_tx`, `confirm_booking_tx`, `record_booking_void_modification_tx`,
  `user_owns_booking` — these six are ALREADY the correctly-shared surface
  (guest cancel and admin void both call them) and should be the literal
  extracted API, not reinvented.
- **Payments**: `create_payment`, `record_payment`, `create_bank_transfer_claim`,
  `create_paypal_order`, `capture_paypal_payment`, `apply_paypal_webhook_event`,
  `recompute_payment_status(_tx)` — already a clean single module
  (`services/payments.rs`); extraction here is mostly a file move, not a
  redesign.
- **Ledger**: `next_invoice_number`, plus the company-billing auto-post
  functions in `lifecycle.rs:540-644` — currently booking-core-shaped code
  that arguably belongs in the ledger module instead (it directly INSERTs
  `customer_ledgers` rows from inside the bookings repository).
- **Notably NOT needed from guest_booking by the rest of the system**: nothing
  in `modules/guest_booking` is called from legacy code (confirmed in §1) — it
  is a legitimate candidate to be the "guest entry point" layered on top of a
  shared booking core, once the availability/pricing/status logic is unified.

## 5. Findings

Findings are listed in the structured output. Summary of the most severe:
email-based booking ownership (bookings_queries.rs:135) can leak or hide
bookings across accounts; the admin room-search endpoint's stale status list
(rooms_queries.rs:176) allows double-booking a room a guest just reserved
online; guest-portal bookings never compute tourism tax (modules/guest_booking
insert path) while admin bookings do, and admin bookings never apply rate
plans while guest bookings do — both are silent money divergences for
identical stays depending only on which channel created the booking.
