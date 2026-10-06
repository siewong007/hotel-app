# Hotel App — application structure for designers

This design system serves a **hotel property-management system (PMS)**. One React
frontend ships to two platforms with identical pages: the staff web app and a Tauri
desktop app. Guest-facing routes serve guests on their own devices (mobile-first).
When designing a screen, match the conventions of the area it belongs to below.

Regenerated 2026-10-05 from `src/navigation/routeRegistry.tsx` and `navGroups.ts`. If
the routes or the sidebar change, update this file and re-run the design-sync driver.

## Surfaces and audiences

| Surface | Audience | Feel |
|---|---|---|
| Staff app (sidebar groups below) | Front-desk staff, managers, finance, admins | Dense, data-first: tables, filters, stat summaries |
| Guest portal (`/guest-portal`, `/portal`, `/portal/book`) | Guests with an account or a booking access link | Simple dashboard: stays, booking, payments, identity, support |
| Guest self-check-in (`/guest-checkin/*`) | Hotel guests on their own device | Mobile-first wizard: one task per step, large touch targets |
| Sign-in and account setup (`/login`, `/register`, `/verify-email`, `/complete-profile`, `/enroll-two-factor`) | Staff and guests (one sign-in screen for both) | Minimal, centered card layouts |
| Public pages (`/offers`, `/legal/*`, `/help`) | Anyone | Readable content pages |
| Salim Inn landing page (`/salim-inn/`) | Prospective guests | A separate document with its own film-style design. It does **not** use these components. |

## Sitemap (routes and their purpose)

The staff sidebar has eight groups, in this order. `Overview`, `Insights` and the
utility items render without a heading. Access is permission-driven per role, so
each person sees the subset their role's permissions allow.

### Overview
- `/` — the role dashboard when signed in. Signed-out visitors get the landing page.

### Front Office
- `/bookings` — Bookings: search, create, edit, check-in/out; the busiest screen.
  `/bookings/$bookingId` opens one booking.
- `/timeline` — room-reservation timeline: rooms × dates calendar grid
- `/room-management` — Rooms: the room status board (occupancy, housekeeping state)
- `/housekeeping` — housekeeping and maintenance task board

### Guests
- `/guest-relations` — Guest Relations overview (CRM dashboard, follow-up queue)
- `/guest-relations/guests` — the guest directory. Each guest opens a 360 page at
  `/guest-relations/guests/$guestId`, and `/guest-config` redirects here.
- `/loyalty` — loyalty-program administration (`/my-rewards` is the guest-facing view)
- `/support` — guest support conversations

### Revenue
- `/revenue` — Revenue overview (ADR/RevPAR, occupancy, channel mix)
- `/rates` — rate plans, rate calendar, rate codes
- `/channels` — booking channels: pricing and commission rules (`/channels/$channelId`)
- `/online-inventory` — online inventory and pricing matrix
- `/campaigns` — deals and vouchers (`/promotions` redirects here)
- `/segments` — rule-based guest segments
- `/communications` — email campaigns and deliveries

### Finance
- `/company-ledger` — city/company ledger: invoices, balances, payments
- `/payment-approvals` — pending guest payment claims to approve or reject
- `/night-audit` — end-of-day audit and reconciliation
- `/complimentary` — complimentary-night allocation

### Insights
- `/insights` — report catalog and analytics dashboards (`/reports` redirects here)

### Administration
- `/settings` — Hotel Settings
- `/room-config` — room types, rates, amenities
- `/rbac` — Access Control: roles and permissions
- `/audit-log` — system audit trail (read-only table)
- `/data-transfer` — data export/import
- `/ekyc-admin` — review/approve guest identity verification (`/ekyc` is the guest-facing form)
- `/system-health`, `/jobs` — service health and background-job history

### Utility (bottom of the sidebar)
- `/notifications` — Deliveries: outbound guest email feed
- `/help` — help centre (`/help/$slug` opens an article)

### Not in the sidebar
- `/profile` — the signed-in user's account
- `/guest-checkin` → `/guest-checkin/verify` → `/guest-checkin/form` →
  `/guest-checkin/confirm` — the four-step guest self-check-in wizard
- `/guest-portal` (`?view=booking` opens booking) and `/portal`, `/portal/book` — the
  guest portal
- `/booking/recover-payment/$token`, `/unsubscribe/$token` — token pages reached
  from guest email
- `/legal/terms`, `/legal/privacy`, `/legal/payment-terms`,
  `/legal/identity-verification` — legal notices in four languages

## Where the library components are used today

Verified against the code's import graph — follow these precedents when designing
similar screens:

- **DataTable** — the workhorse of staff screens: bookings lists, guest lists,
  admin tables (audit log, ledger). Any staff list/report screen should use it.
- **StatCard** — dashboard KPI tiles (occupancy, revenue, arrivals). Use rows of
  StatCards at the top of dashboard/report screens.
- **TabPanel** — multi-section admin pages (e.g. night audit sections).
- **ModernDatePicker** — every date input: booking dates, eKYC forms, report ranges.
- **BrandMark** — the Salim Inn monogram (deep-green tile, gold roofline, ivory S)
  as inline SVG. Use for brand slots: sidebar tile, boot/service screens.
- **LogoLoader** — the branded loading element; pick the variant by surface:
  `fullScreen` (boot/auth), `page` (routes and panels where a skeleton is the
  wrong shape), `inline` (cards/sections/rows), `overlay` (blocking waits).
  Skeletons still own content-shaped lazy-route fallbacks; small
  `CircularProgress` stays inside buttons and input adornments only.

## Screen conventions

- Staff pages: page title + primary action top-right, optional StatCard row,
  filter bar, then a DataTable. Row click opens a detail dialog/drawer — details
  are modals over the list, not separate routes.
- Wizards (guest check-in, eKYC): one step per screen, progress indication,
  primary action full-width at the bottom on mobile.
- Every data screen needs loading (`LogoLoader variant="page"`, or skeletons when
  the layout is known), empty, and error states.
- Use realistic but fictional hotel data in mocks (rooms "101"–"412", names like
  "A. Tan", never real guest data, IDs, or payment details).
