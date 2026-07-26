# Hotel App — application structure for designers

This design system serves a **hotel property-management system (PMS)**. One React
frontend ships to two platforms with identical pages: the staff web app and a Tauri
desktop app. A separate set of guest-facing routes serves guests on their own
devices (mobile-first). When designing a screen, match the conventions of the area
it belongs to below.

## Surfaces and audiences

| Surface | Audience | Feel |
|---|---|---|
| Staff app (`main`/`operations`/`config`/`admin` nav groups) | Front-desk staff, managers, admins | Dense, data-first: tables, filters, stat summaries |
| Guest self-check-in (`/guest-checkin/*`) | Hotel guests, own device | Mobile-first wizard: one task per step, large touch targets |
| Guest portal (`/portal/*`) | Checked-in guests | Simple dashboard: booking summary, requests |
| Auth (`/login`, `/register`, `/verify-email`) | All users | Minimal, centered card layouts |

## Sitemap (routes and their purpose)

Navigation is grouped into four sidebar sections. Access is permission-driven per
role (admin / employee / guest); admin sees everything, employees see a subset,
guests see only their own pages.

### Main (daily front-desk work)
- `/bookings` — Bookings: search, create, edit, check-in/out; the busiest screen
- `/timeline` — room-reservation timeline: rooms × dates calendar grid
- `/guest-config` — guest profiles and guest data management
- `/room-management` — room status board (occupancy, housekeeping state)

### Operations
- `/reports` — analytics dashboards: occupancy, revenue, channel performance
- `/housekeeping` — housekeeping and maintenance task board
- `/company-ledger` — city/company ledger: invoices, balances, payments

### Config
- `/settings` — application settings and preferences
- `/room-config` — room types, rates, amenities
- `/rbac` — roles and permissions management

### Admin
- `/night-audit` — end-of-day audit and reconciliation
- `/audit-log` — system audit trail (read-only table)
- `/complimentary` — complimentary-night allocation
- `/loyalty` — loyalty-program administration (`/my-rewards` is the guest-facing view)
- `/data-transfer` — data export/import
- `/ekyc-admin` — review/approve guest identity verification (`/ekyc` is the guest-facing form)

### Not in the sidebar
- `/` — logged-out landing page; when authenticated, redirects by role
  (admin → analytics, employee → profile, guest → guest-portal)
- `/profile`, `/help` — user account and help/support pages
- `/guest-checkin` → `/guest-checkin/verify` → `/guest-checkin/form` →
  `/guest-checkin/confirm` — the four-step guest self-check-in wizard
- `/portal/login`, `/portal` — guest portal auth + dashboard

## Where the library components are used today

Verified against the code's import graph — follow these precedents when designing
similar screens:

- **DataTable** — the workhorse of staff screens: bookings lists, guest lists,
  admin tables (audit log, ledger). Any staff list/report screen should use it.
- **StatCard** — dashboard KPI tiles (occupancy, revenue, arrivals). Use rows of
  StatCards at the top of dashboard/report screens.
- **TabPanel** — multi-section admin pages (e.g. night audit sections).
- **ModernDatePicker** — every date input: booking dates, eKYC forms, report ranges.
- **HotelSpinner** — full-page route loading state (Suspense fallback). Use it for
  whole-screen loading, not inline waits.
- **LoadingSpinner** — inline/in-card loading (auth flows, loyalty widgets).

## Screen conventions

- Staff pages: page title + primary action top-right, optional StatCard row,
  filter bar, then a DataTable. Row click opens a detail dialog/drawer — details
  are modals over the list, not separate routes.
- Wizards (guest check-in, eKYC): one step per screen, progress indication,
  primary action full-width at the bottom on mobile.
- Every data screen needs loading (HotelSpinner), empty, and error states.
- Use realistic but fictional hotel data in mocks (rooms "101"–"412", names like
  "A. Tan", never real guest data, IDs, or payment details).
