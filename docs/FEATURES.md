# Feature Registry

Canonical list of what the application currently supports. Statuses:
**Delivered** (implemented end to end), **Partially Delivered** (usable subset
shipped), **Experimental**, **Deprecated**, **Not delivered**, **In progress**.

| Feature | Status | Frontend | Backend | Notes |
|---|---|---|---|---|
| Staff authentication (JWT + refresh) | Delivered | ✓ `features/auth` | ✓ `routes/auth.rs` | In-memory access token, HttpOnly refresh cookie, revocable refresh rows |
| Two-factor (TOTP + recovery codes) | Delivered | ✓ | ✓ `routes/two_factor.rs` | Secrets encrypted at rest when `TOTP_ENCRYPTION_KEY` is set (`enc1:` prefix) |
| Passkeys (WebAuthn) | Delivered | ✓ | ✓ `routes/passkey.rs` | Enrollment step-up; revoked on password change/reset |
| Google sign-in / One Tap | Delivered | ✓ | ✓ (`services/google_identity.rs`) | Staff and guest surfaces |
| Email verification | Delivered | ✓ `/verify-email` | ✓ | `SKIP_EMAIL_VERIFICATION` bypass for desktop/dev |
| RBAC roles & permissions | Delivered | ✓ `features/admin/components/rbac` | ✓ `routes/rbac.rs` | `<resource>:<action>`; `:manage` implies all; route-layer enforcement |
| User & team management | Delivered | ✓ `features/admin`, `features/user` | ✓ `routes/users.rs`, `modules/teams` | |
| Rooms & room types | Delivered | ✓ `features/rooms` (`/room-management`, `/room-config`, `/timeline`) | ✓ `routes/rooms.rs` | Status board, room events, room-type photos |
| Housekeeping | Delivered | ✓ `features/housekeeping` | ✓ `routes/housekeeping.rs` | Shared room-status dialog with rooms |
| Maintenance | Delivered | ✓ | ✓ `routes/maintenance.rs` | |
| Bookings (create/check-in/checkout/void) | Delivered | ✓ `features/bookings` | ✓ `routes/bookings.rs` | Deposits, folio, transfers; allocation race-safe (`FOR UPDATE` / `SKIP LOCKED`) |
| Online inventory / availability grid | Delivered | ✓ `features/onlineInventory` (`/online-inventory`) | ✓ `online_inventory_allocations` | |
| Revenue overview | Delivered | ✓ `features/revenue` (`/revenue`) | ✓ `modules/revenue` | ADR/RevPAR, occupancy, channel mix, receivables ageing, period comparison |
| Rates, rate plans, rate codes | Delivered | ✓ `features/rates` (`/rates`) | ✓ `routes/rates.rs` | Plan CRUD, rate calendar, bulk bands; market/rate codes, channel net revenue |
| Booking channels | Delivered | ✓ | ✓ `routes/booking_channels.rs` | `bookings.booking_channel_id` is canonical attribution |
| Guests & companies | Delivered | ✓ `features/guests` | ✓ `routes/{guests,companies}.rs` | Corporate accounts + city-ledger links; `nick_name` booking display name + `guest_name_taken` conflict code |
| Guest relations (CRM 360) | Delivered | ✓ `features/guestRelations` (`/guest-relations/*`) | ✓ `modules/guest_relations` | Overview dashboard, follow-up queue, interactions, preferences, reviews — see `architecture/guest-relations.md` |
| Invoices & folio | Delivered | ✓ `features/invoices` | ✓ (`services/invoice_numbers.rs`) | Numbered invoices, checkout receipts |
| Payments (PayPal + staff-recorded) | Delivered | ✓ | ✓ `routes/payments.rs` | Idempotency keys + fingerprints; conflict audit events |
| Payment approvals | Delivered | ✓ `/payment-approvals` | ✓ `/api/admin/payments/*` | Incl. `paypal-conflicts` endpoint (`payments:read`) |
| PayPal webhooks | Delivered | — | ✓ `routes/webhooks.rs` (`/api/webhooks/paypal`) | Signature-verified, IP-limited, no bearer by design |
| PayPal auto-refund/dispute apply | Partially Delivered | — | ✓ | Refund webhooks verified + audit-logged, not auto-applied (manual reconciliation, open product call) |
| Customer / city ledgers | Delivered | ✓ `features/customer-ledger` + `features/admin/components/CustomerLedger` (`/company-ledger`) | ✓ `routes/ledgers.rs` | Company payment allocation across entries in one tx |
| Deposit refunds | Delivered | ✓ | ✓ | Bounded by held deposit; one-refund-per-booking + partial refunds; `deposit_forfeited` payment type (patch 1.2) |
| Payment retry / recovery | Delivered | ✓ `features/paymentRecovery` (`/booking.recover-payment/$token`) | ✓ `routes/payment_retry.rs` | Public token page reached from payment-rejected email |
| Campaigns (deals + vouchers) | Delivered | ✓ `features/promotions` (`/campaigns`; `/promotions` redirects) | ✓ `modules/promotions` | Derived lifecycle, channel + loyalty-tier targeting, `promotions:approve` publish gate, performance report |
| Vouchers | Delivered | ✓ (via promotions) | ✓ `/api/admin/vouchers*`, guest endpoints | Issue/revoke, summary, portal claim/options |
| Guest segments | Delivered | ✓ `features/segments` (`/segments`) | ✓ `modules/segments` | JSONB rules compiled to bound-parameter SQL; live evaluation, never materialized |
| Loyalty | Delivered | ✓ `features/loyalty` (`/loyalty`, `/my-rewards`) | ✓ `modules/loyalty` | Member portal + admin; realtime hub. Includes **point redemption with an approval workflow**: `POST /api/loyalty/rewards/{id}/redeem`, `GET /api/admin/loyalty/redemptions`, `PUT …/{id}/{approve,reject}` |
| Night audit | Delivered | ✓ `features/night-audit` + `features/admin/components/NightAuditPage` | ✓ `routes/night_audit.rs` | Scheduler loop in `main.rs` |
| Insights / report catalog | Delivered | ✓ `features/insights` (`/insights`; `/reports` redirects) | ✓ `modules/insights`, `routes/analytics.rs` | `report_catalog.rs` registry; arrivals/departures rosters |
| Audit log viewer | Delivered | ✓ `features/audit-log` + `features/admin/components/AuditLogPage` | ✓ `routes/audit.rs` | Partitioned append-only store |
| eKYC | Delivered | ✓ `features/ekyc` (`/ekyc`, `/ekyc-admin`) | ✓ `modules/ekyc` | Submission + staff review queue; sensitive-field reveal permissions |
| Guest portal (booking, pre-check-in, docs) | Delivered | ✓ `guest/` entry + `features/guestPortal` | ✓ `routes/guest_portal.rs`, `modules/guest_booking` | Booking access tokens, consent gate, portal WS sockets, guest feedback submission |
| Guest self check-in wizard | Delivered | ✓ `/guest-checkin/*` | ✓ | Token-gated multi-step flow; `auto_checkin` + eKYC-gated auto check-in |
| Communications (email campaigns) | Delivered | ✓ `features/communications` (`/communications`) | ✓ `modules/communications` | lettre SMTP worker; per-guest preferences; transactional sends; `segment_id` audience intersection |
| SMS channel | Not delivered | — | — | Open item; no implementation |
| Support tickets | Delivered | ✓ `features/support` (`/support`) | ✓ `modules/support` | Incl. guest-portal support widget + WS |
| Notifications | Delivered | ✓ `features/notifications` (`/notifications` "Guest Deliveries") + topbar bell | ✓ `staff_notifications`, `email_deliveries` | Checkout receipt + pre-arrival reminder triggers |
| Data transfer (backup/restore) | Delivered | ✓ `features/data-transfer` + `features/admin/components/DataTransferPage` | ✓ `routes/data_transfer.rs` | Versioned `hotel-backup` v1 JSON: streamed export (standard/full/backup scopes) + staged upload→preview→execute→poll import; dedicated `data_transfer:*` permissions + step-up re-auth; credentials/eKYC never exported — see `guides/data-transfer.md` |
| System settings | Delivered | ✓ `features/user` (`/settings`) | ✓ `modules/settings` | Timezone drives hotel business day |
| System health & jobs | Delivered | ✓ `features/admin/system` (`/system-health`, `/jobs`) | ✓ `modules/system`, `core/job_runs.rs` | `/api/system/health`, job-failure feed, `job_runs` records |
| Help centre | Delivered | ✓ `features/help` (`/help`, `/help/$slug`) | — (content bundles) | |
| Legal/policy pages | Delivered | ✓ `features/legal` (`/legal/*`) | — | Terms, privacy, payment terms, identity verification |
| Offers landing | Delivered | ✓ `/offers` (public) | ✓ public `/api/promotions*` | |
| Complimentary stays | Delivered | ✓ `features/admin/components/ComplimentaryManagementPage` (`/complimentary`) | ✓ `guest_complimentary_credits` | Credit allocation + restoration on void |
| Internationalization (EN + BM) | Delivered | ✓ `src/i18n` | ✓ `core/i18n.rs` + `core/locales/` | Intl-based, in-house (ADR 012); parity tests both sides |
| Simplified Chinese locale | In progress | branch `feat/i18n-zh` (worktree) | — | Not merged; `docs/superpowers/plans/2026-09-14-i18n-zh.md` |
| Search (global) | Delivered | ✓ | ✓ `routes/search.rs` | |
| Desktop app (Tauri + embedded PG) | Delivered | ✓ shared | ✓ `hotel-desktop/src-tauri` | Sidecar backend; bundled postgres **19beta2** while the server stack runs 19beta3 (see `ARCHITECTURE.md` → Desktop flow); updater plugin wired but **not armed** (`hotel-desktop/UPDATER.md`) |
| Realtime (WebSocket) | Delivered | ✓ | ✓ `modules/realtime`, loyalty/support hubs | `/api/updates/socket` (staff), `/api/admin/loyalty/socket`, `/api/guest-portal/me/{loyalty,support}/socket`; reconnect + lag-drop logging |
| Turnstile bot protection | Delivered | ✓ | ✓ `services/turnstile.rs` | Public guest forms |
| Unpaid online-hold release | Delivered | — | ✓ `services/unpaid_hold_scheduler.rs` | `unpaid_hold_release_hours` (24 default, 0 disables) |
| Phone/tablet UX | Delivered | ✓ `useIsPhone`, `MobileNavBar`, per-page phone layouts | — | Phone-first pass across staff + guest surfaces; bookings + online-inventory grids. Shared primitives in `components/common/`: `ActionsMenu`, `BottomSheet`, `CollapsibleSection`, `ResponsiveTabs`, `StickyActionBar` |
| Row-detail drawers | Delivered | ✓ `BookingDetailDrawer`, `GuestDetailDrawer` | — | Row clicks in `/bookings` and `/guest-relations/guests` open a right-side drawer (details + quick-edit + actions); full detail pages still reachable from inside the drawer |
| Auto-refresh | Delivered | ✓ | — | Live pages poll/invalidate on a cadence; sockets cover the realtime domains |
| MCP server | Not delivered | — | — | ADR 009: recorded historically, never implemented |

## Intentional absences

- **No client-state library** — server state is TanStack Query; see ADR 006.
- **No sqlx migration runner** — schema lifecycle is baseline + seed +
  checksum-verified patch catalog; see ADR 010.
- **No external rate-limit store** — in-memory limiter bounds deployment to a
  single backend instance; see ADR 005.
- **No payroll/HR module** — staff management stops at `teams`/`team_members`;
  `staging.sql` deliberately seeds no payroll tables. (Re-verified 2026-09-15:
  zero `payroll` matches in `src/`, zero payroll tables in the baseline.)
- **No inventory / purchasing / stock module** — no purchase orders, suppliers,
  or stock items exist in the schema or code. The only "supplier" matches are
  prose in the privacy notice.
- **No separate "Hot Deals" module** — public offers are promotions.
  `features/promotions` (`/campaigns`, public `/offers`) covers deals and
  vouchers; there is no distinct hot-deals entity.
- **No "Front Desk" module** — front-desk work is served by the bookings, rooms
  and housekeeping features rather than a dedicated surface.
