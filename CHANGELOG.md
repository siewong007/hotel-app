# Changelog

Release history for the Hotel Management System — the backend API (`hotel-app-be`),
the web application (`hotel-web-fe`) and the desktop application (`hotel-desktop`),
which are versioned and released together.

Entries describe what shipped in each release, grouped by user impact. Internal
refactors, dependency bumps and tooling changes are omitted unless they affect
users, administrators, deployment or security. Published releases and downloads:
[github.com/siewong007/hotel-app/releases](https://github.com/siewong007/hotel-app/releases).

## v0.3.0 — 2026-09-19

Opens the property to a wider market: the product now speaks four languages,
sells through booking channels with commission tracking, and markets to
segmented guest audiences. Sign-in was rebuilt around a single screen with
Google, passkeys and Turnstile; the desktop application gained Windows and Linux
builds with signed auto-updates; and the backend now runs correctly behind
multiple replicas.

### Highlights

- **Four languages** — the full staff UI, guest portal and backend email
  catalogues ship in English, Bahasa Melayu, Simplified Chinese and Traditional
  Chinese (`zh-TW`; `zh-Hant*` tags resolve there), with key-parity tests on
  both sides.
- **One sign-in screen** — guests and staff sign in through the same door, with
  Google sign-in and One Tap, a second-factor picker, passkey registration
  behind a re-authentication prompt, and Cloudflare Turnstile on login and
  registration.
- **Booking channels** — channel pricing rules (markup/discount/fixed/net-rate)
  and dated commission rules with a preview matrix; commission and net revenue
  are snapshotted onto each booking at write time, and bookings link to their
  channel row instead of parsed remarks.
- **Revenue and marketing** — a Revenue Overview workspace behind a new
  `revenue:read` permission, a unified campaigns workspace with lifecycle,
  targeting and performance reporting, and rule-based guest segments.
- **Online inventory** — a 14-day pricing matrix with per-cell editing, bulk
  edits with weekday filters, staged changes, and an atomic, audited apply.
- **Guest portal** — a forest/gold/ivory redesign with system/light/dark
  themes, online pre-check-in from the emailed link through to self check-in,
  and self-service management of profile, sign-in credentials and signed-in
  devices.
- **Anonymous and fast booking** — checkout without an account, fast bookings
  that need only a guest name, and automatic release of stale unpaid online
  holds.
- **Guest relations** — follow-up queue, interactions, preferences and reviews
  in the staff CRM workspace.
- **Desktop application** — Windows (NSIS/MSI + portable), Linux
  (deb/AppImage/RPM + portable) and macOS builds; a managed backup/restore card
  pairing a verified dump with the uploads tarball, with safety dump and
  rollback; and an auto-updater served from this repository's GitHub Releases.
- **Staff administration** — staff lifecycle and invitations, session
  administration, scheduler heartbeats and a `/system/health` view.
- **Data transfer** — dedicated `data_transfer:*` permissions replace
  `settings:manage`/super-admin gates; tiered export scopes
  (standard/full/backup) plus an encrypted, passphrase-protected `system`
  scope, step-up re-authentication, and a transfer history log.
- **Payments** — idempotent payment recording end to end, a `deposit_forfeited`
  type with a deposit-resolution flow at checkout, emailed payment-retry links,
  and receipt upload for anonymous bookers.
- **Communications** — pre-arrival reminders and checkout receipts from the
  durable outbox, with a paged delivery feed in the notification centre.
- **Audit log** — filtering, CSV/PDF export, and a redesigned viewer.
- **Help centre** — a public `/help` catalogue with searchable, localized
  articles (zh-TW reads the zh set).
- **Multi-instance ready** — rate limits share fixed-window counters in
  `rate_limit_buckets`, RBAC and settings caches invalidate across replicas
  over `LISTEN`/`NOTIFY`, background schedulers run under `pg_advisory_lock`
  single-runner leadership, and staff data-change events fan out to every
  replica's websockets.

### Security

- Closed a guest-link IDOR, a credit race, an account-enumeration vector and a
  payment-integrity chain found in the production-readiness audit.
- Passkey ceremony challenges are now consumed atomically, preventing replay.
- TOTP secrets are encrypted at rest, and two-factor enrolment is enforced for
  privileged roles.
- Closed two voucher-leakage gaps, hardened upload handling and request
  tracing, and narrowed data-transfer credential scope.
- Cloudflare Turnstile protects login and registration; its secret is
  provisioned by CI rather than by hand on the host.

### Upgrade and deployment notes

- **Breaking — database lineage.** The original V1 convergence catalog
  (versions 1.2–1.23) was folded into the baseline and the catalog republished
  from empty; it now carries versions 2–8. A database that still records the
  pre-fold lineage aborts on a checksum-mismatch guard. Run the one-time
  lineage reset in [docs/guides/deployment.md](docs/guides/deployment.md)
  before `make db-patch`. Fresh installs, and databases created after the fold,
  are unaffected.
- **Desktop version realigned to `0.3.0`.** v0.2.0 shipped desktop metadata at
  `1.0.0`; the updater manifest requires the release tag and the bundled
  version to match, so all three projects now version together.
- Desktop installers are not OS-signed — no Apple Developer ID or Windows
  code-signing certificate is configured. Updater artifacts are minisign-signed
  and verified against the public key baked into the bundle.
- PostgreSQL stays on the 19 beta track: servers pin `19beta3`, desktop bundles
  `19beta2`. Beta on-disk formats have no supported upgrade path to GA, so
  moving to 19 GA will require a `pg_dump`/`pg_restore` into a fresh volume.
- Multi-replica deployments still require sticky sessions for staged import
  uploads, in-process import-job polling, and websocket connections; see the
  deployment guide's multi-replica section.
- gRPC service adapters are merged into the backend router for internal and
  development use; the production edge does not route `/hotel.*` paths.

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
