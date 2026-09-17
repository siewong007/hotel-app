# Changelog

Release history for the Hotel Management System — the backend API (`hotel-app-be`),
the web application (`hotel-web-fe`) and the desktop application (`hotel-desktop`),
which are versioned and released together.

Entries describe what shipped in each release, grouped by user impact. Internal
refactors, dependency bumps and tooling changes are omitted unless they affect
users, administrators, deployment or security. Published releases and downloads:
[github.com/siewong007/hotel-app/releases](https://github.com/siewong007/hotel-app/releases).

## Unreleased

Development has continued on `master` since v0.2.0 without a tagged release.
See the [compare view](https://github.com/siewong007/hotel-app/compare/v0.2.0...master)
for the current state. Highlights so far:

- **Internationalization** — the full staff UI and guest portal now ship in
  English, Bahasa Melayu, Simplified Chinese, and Traditional Chinese
  (`zh-TW`; `zh-Hant*` tags resolve there), including backend email catalogs,
  with parity tests on both sides.
- **Booking channels** — channel pricing rules (markup/discount/fixed/net-rate)
  and dated commission rules with a preview/matrix; commission and net revenue
  are snapshotted onto each booking at write time (`bookings.booking_channel_id`
  remains the canonical attribution).
- **Guest relations phase 2** — follow-up queue, interactions, preferences,
  and reviews in the staff CRM workspace.
- **Data transfer hardening** — dedicated `data_transfer:*` RBAC permissions
  replace `settings:manage`/super-admin gates; tiered export scopes
  (standard/full/backup) plus an encrypted, passphrase-protected `system`
  scope; step-up re-authentication and a transfer history log.
- **Deposits** — `deposit_forfeited` payment type and a deposit-resolution
  flow in the checkout workspace.
- **Audit log** — usability overhaul: filtering, CSV/PDF export, and a
  redesigned viewer.
- **Help centre** — public `/help` catalogue with searchable, localized
  articles (zh-TW reads the zh set).
- **Brand loading** — `BrandMark`/`LogoLoader` loading system replaces
  spinner-centric UX (static pre-React splash, staged draw-on loader).
- **Desktop packaging** — Windows (NSIS/MSI + portable) and Linux
  (deb/AppImage + portable) CI jobs with install smoke tests, alongside the
  verified macOS build.
- **Backend structure** — domain-module migration completed: all 39 domains
  live under `modules/<domain>/` (38 routed).

## v0.2.0 — 2026-07-27

Opens the property to guests directly: a self-service guest portal with online
payments, loyalty and promotions, guest messaging, and marketing campaigns —
alongside housekeeping and maintenance workflows for staff. Also hardens
authentication and moves the platform to PostgreSQL only.

### Highlights

- **Guest portal** — guest accounts with booking history, self-service cancellation, credits and benefits, plus self-service booking backed by live availability and quotes.
- **Online payments** — PayPal and bank transfer, with payment receipt upload and an admin approvals queue that surfaces payment conflicts.
- **Loyalty** — guest self-enrolment, points activity, and reward redemption with administrator approval, tiers and earning rules.
- **Promotions and vouchers** — public promotion pages, guest voucher claiming, and administrator publish, pause, archive and revoke controls.
- **Guest messaging** — two-way support conversations between guests and staff, with live updates.
- **Marketing communications** — campaign templates, audience targeting, scheduling and delivery tracking, with consent and suppression handling, plus automated birthday vouchers.
- **Staff operations** — a housekeeping board with tasks, maintenance requests, team management and booking channel configuration.
- **Identity verification** — guests can now submit eKYC documents from the portal, feeding the existing administrator review workflow.
- **Night audit** — paginated audit listings with date filtering, and automatic runs at a configured time.

### Security

- Refresh tokens moved to `HttpOnly` cookies, with session tracking and device metadata.
- HTTP security headers, JWT issuer and audience validation, and HSTS at the edge.
- Removed an unauthenticated pre-check-in endpoint.
- Two-factor enrolment QR codes are now rendered locally; the TOTP secret is no longer sent to a third-party service.

### Upgrade and deployment notes

- **Breaking:** SQLite support has been removed. PostgreSQL is now the only supported database.
- HTTPS deployment via Caddy, container health checks, and basic request and error-rate observability.
- Desktop application metadata intentionally remains `1.0.0` for release `v0.2.0`. Desktop builds are unsigned: no Apple Developer ID signing or notarization is configured.

## v0.1.0 — 2026-06-16

First tagged release of the Hotel Management System: a property management system
covering the full front-desk and billing workflow, delivered as a web application
and as a desktop application that bundles its own PostgreSQL database.

### Highlights

- **Reservations** — bookings, rooms, guests and rate management, including hourly stays, back-dated check-in and mid-stay room changes.
- **Billing** — deposits and payments, guest and city ledgers, checkout invoicing, and a night audit with separate tourism and service tax breakdowns.
- **Reporting** — analytics dashboards, operational reports and a system-wide audit log.
- **Access control** — permission-driven role-based access control, two-factor authentication, passkey sign-in, and API rate limiting with account lockout.
- **Desktop application** — Tauri build with an embedded PostgreSQL instance, for sites without a server.
- **Data portability** — export and import of guest and booking data.

### Notes

- No release artifacts were attached to this release; it marks the source tree only.
