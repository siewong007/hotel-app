# Feature Registry

Canonical list of what the application currently supports. Statuses:
**Delivered** (implemented end to end), **Partially Delivered** (usable subset
shipped), **Experimental**, **Deprecated**.

| Feature | Status | Frontend | Backend | Notes |
|---|---|---|---|---|
| Staff authentication (JWT + refresh) | Delivered | ✓ `features/auth` | ✓ `routes/auth.rs` | In-memory access token, HttpOnly refresh cookie, revocable refresh rows |
| Two-factor (TOTP + recovery codes) | Delivered | ✓ | ✓ `routes/two_factor.rs` | Secrets encrypted at rest (`TOTP_ENCRYPTION_KEY`, `enc1:` prefix) |
| Passkeys (WebAuthn) | Delivered | ✓ | ✓ `routes/passkey.rs` | Enrollment step-up; revoked on password change/reset |
| Google sign-in / One Tap | Delivered | ✓ | ✓ (`services/google_identity.rs`) | Staff and guest surfaces |
| RBAC roles & permissions | Delivered | ✓ `features/admin/rbac` | ✓ `routes/rbac.rs` | `<resource>:<action>`; `:manage` implies all; route-layer enforcement |
| User & team management | Delivered | ✓ `features/admin` | ✓ `routes/users.rs`, `modules/teams` | |
| Rooms & room types | Delivered | ✓ `features/rooms` | ✓ `routes/rooms.rs` | Status board, room events |
| Housekeeping | Delivered | ✓ `features/housekeeping` | ✓ `routes/housekeeping.rs` | |
| Maintenance | Delivered | ✓ | ✓ `routes/maintenance.rs` | |
| Bookings (create/check-in/checkout/void) | Delivered | ✓ `features/bookings` | ✓ `routes/bookings.rs` | Deposits, folio, transfers; allocation race-safe |
| Online inventory / availability grid | Delivered | ✓ `features/onlineInventory` | ✓ | |
| Revenue overview | Delivered | ✓ `features/revenue` | ✓ `modules/revenue` | ADR/RevPAR, occupancy, channel mix, period comparison |
| Rates, rate plans, rate codes | Delivered | ✓ `features/rates` | ✓ `routes/rates.rs` | Plan CRUD, rate calendar, bulk bands; market/rate codes, channel net revenue |
| Booking channels | Delivered | ✓ | ✓ `routes/booking_channels.rs` | |
| Guests & companies | Delivered | ✓ `features/guests` | ✓ `routes/{guests,companies}.rs` | |
| Invoices & folio | Delivered | ✓ `features/invoices` | ✓ (`services/invoice_numbers.rs`) | Numbered invoices, checkout receipts |
| Payments (PayPal + staff-recorded) | Delivered | ✓ | ✓ `routes/payments.rs` | Idempotency keys + fingerprints; conflict audit events |
| PayPal webhooks | Delivered | — | ✓ `routes/webhooks.rs` | Signature-verified, IP-limited, no bearer by design |
| PayPal auto-refund/dispute apply | Partially Delivered | — | ✓ | Refund webhooks verified + audit-logged, not auto-applied (manual reconciliation, open product call) |
| Customer / city ledgers | Delivered | ✓ `features/customer-ledger` | ✓ `routes/ledgers.rs` | Company payment allocation across entries in one tx |
| Deposit refunds | Delivered | ✓ | ✓ | Bounded by held deposit; one-refund-per-booking + partial refunds |
| Payment retry / recovery | Delivered | ✓ `features/paymentRecovery` | ✓ `routes/payment_retry.rs` | |
| Campaigns (deals + vouchers) | Delivered | ✓ `features/promotions` (`/campaigns`) | ✓ `modules/promotions` | Derived lifecycle (scheduled/live/expired/cancelled), channel + loyalty-tier targeting, `promotions:approve` publish gate, performance report |
| Vouchers | Delivered | ✓ (via promotions) | ✓ `/api/admin/vouchers*`, guest endpoints | Issue/revoke, summary, portal claim/options |
| Loyalty | Delivered | ✓ `features/loyalty` | ✓ `modules/loyalty` | Member portal + admin |
| Night audit | Delivered | ✓ `features/night-audit` | ✓ `routes/night_audit.rs` | Scheduler loop in `main.rs` |
| Analytics & reports | Delivered | ✓ `features/{dashboard,reports}` | ✓ `routes/analytics.rs`, `modules/analytics` | |
| Audit log viewer | Delivered | ✓ `features/audit-log` | ✓ `routes/audit.rs` | Partitioned append-only store |
| eKYC | Delivered | ✓ `features/ekyc` | ✓ `modules/ekyc` | Submission + staff review queue |
| Guest portal (booking, pre-check-in, docs) | Delivered | ✓ `guest/`, `features/guestPortal` | ✓ `routes/guest_portal.rs`, `modules/guest_booking` | Booking access tokens, consent gate |
| Guest segments | Delivered | ✓ `features/segments` (`/segments`) | ✓ `modules/segments` | JSONB rules compiled to bound-parameter SQL; dynamic evaluation — membership never materialized |
| Communications (email campaigns) | Delivered | ✓ `features/communications` | ✓ `modules/communications` | lettre SMTP worker; per-guest preferences; transactional sends; optional `segment_id` audience intersection |
| SMS channel | Not delivered | — | — | Open item; no implementation |
| Support tickets | Delivered | ✓ `features/support` | ✓ `modules/support` | Incl. guest-portal support widget |
| Notifications (in-app + email triggers) | Delivered | ✓ `features/notifications` | ✓ | Checkout receipt + pre-arrival reminder (patch 0008) |
| Data transfer (import/export) | Delivered | ✓ `features/data-transfer` | ✓ `routes/data_transfer.rs` | CSV/JSON, formula-injection guarded |
| System settings | Delivered | ✓ `features/user` (settings) | ✓ `modules/settings` | Timezone drives hotel business day |
| Internationalization (EN + BM) | Delivered | ✓ `src/i18n` | ✓ `core/i18n.rs` | Intl-based, in-house (ADR 012) |
| Search (global) | Delivered | ✓ | ✓ `routes/search.rs` | |
| Desktop app (Tauri + embedded PG) | Delivered | ✓ shared | ✓ `hotel-desktop/src-tauri` | Sidecar backend; bundled postgres; auto-updater plugin |
| Realtime (WebSocket) | Delivered | ✓ | ✓ `modules/realtime` | Loyalty/notifications hubs, reconnect + lag-drop logging |
| Turnstile bot protection | Delivered | ✓ | ✓ `services/turnstile.rs` | Public guest forms |
| Unpaid online-hold release | Delivered | — | ✓ `services/unpaid_hold_scheduler.rs` | `unpaid_hold_release_hours` (24 default, 0 disables) |
| MCP server | Not delivered | — | — | ADR 009: recorded historically, never implemented |

## Intentional absences

- **No client-state library** — server state is TanStack Query; see ADR 006.
- **No sqlx migration runner** — schema lifecycle is baseline + seed +
  checksum-verified patch catalog; see ADR 010.
- **No external rate-limit store** — in-memory limiter bounds deployment to a
  single backend instance; see ADR 005.
