# Claude Design ↔ Application Page Reconciliation

Last reviewed: 2026-07-10
Claude Design project: **Hotel App Design System** (`03f1e68f-8bc7-42c2-97d2-32f663b92470`, https://claude.ai/design/p/03f1e68f-8bc7-42c2-97d2-32f663b92470)
Source of app-page truth: `hotel-web-fe/src/routes/` + `src/navigation/routeRegistry.tsx` (routes verified in agreement, 2026-07-10). `hotel-desktop` reuses the same pages (`frontendDist: ../../hotel-web-fe/dist`), so Platform = Web + Desktop for every row unless noted.

## Determination (page-level sync)

The configured Claude Design integration is a **design-system sync**: the project holds the
compiled component library (bundle, tokens/theme, per-component previews, `.d.ts` contracts,
usage prompts) that Claude Design's agent then uses to build screens **interactively**.
Page-level design documents mirroring app routes are **not a synced artifact type** in this
integration — there is no supported mechanism to create "design pages" from code, and the
prior sync (2026-07-03, see `.design-sync/NOTES.md`) deliberately scoped the sync to the MUI
theme + 6 shared primitives because feature pages are app/data-coupled.

Consequently **no application page is marked `missing`**: nothing was silently skipped, but
creating page mockups by hand would (a) fall outside the supported artifact types, (b) be a
reimplementation rather than a sync of built code, and (c) be deleted by the next anchored
re-sync's reconciliation pass. Changing this is a scope decision for a human (see
"Unresolved" below).

## Claude Design inventory (component level — all preserved, none modified)

| Design entry | Section | Status |
|---|---|---|
| StatCard | components/common | already_synced (component) |
| TabPanel | components/common | already_synced (component) |
| ModernDatePicker | components/common | already_synced (component) |
| HotelSpinner | components/common | already_synced (component) |
| LoadingSpinner | components/common | already_synced (component) |
| DataTable | components/data-table | already_synced (component) |
| Theme/bundle/styles/vendor/anchor | root | already_synced (infrastructure) |

Source drift check (2026-07-10): none of the 6 component sources nor `src/theme.ts` changed
since the 2026-07-03 upload; no uncommitted edits to them. Component sync is current.

## Page reconciliation manifest

Shared fields for all rows: **Matching Claude Design page:** none exists (project contains no
page-type artifacts) · **Match confidence:** n/a · **Status:** `intentionally_excluded` ·
**Reason:** page-type artifacts unsupported by the configured design-system integration +
documented 2026-07-03 scope decision · **Required action:** none automatic; pages are designed
interactively in Claude Design using the synced components (human scope decision needed to
change this — see Unresolved).

| Application route | Page name | Area | User role / visibility | Platform |
|---|---|---|---|---|
| / (unauth) | LandingPage | Auth | Public | Web+Desktop |
| / (auth) | DashboardRouter | Dashboard | Role-based redirect (admin/employee/guest) | Web+Desktop |
| /login | LoginPage | Auth | Public | Web+Desktop |
| /register | RegisterPage | Auth | Public | Web+Desktop |
| /verify-email | EmailVerificationPage | Auth | Public | Web+Desktop |
| /guest-checkin | GuestCheckInLanding | Guest Portal | Public (guest) | Web (guest device) |
| /guest-checkin/verify | GuestCheckInVerify | Guest Portal | Public (guest) | Web (guest device) |
| /guest-checkin/form | GuestCheckInForm | Guest Portal | Public (guest); multi-step | Web (guest device) |
| /guest-checkin/confirm | GuestCheckInConfirmation | Guest Portal | Public (guest) | Web (guest device) |
| /portal/login | PortalLoginPage | Guest Portal | Guest session auth | Web (guest device) |
| /portal | PortalDashboardPage | Guest Portal | Guest session auth | Web (guest device) |
| /bookings | BookingsPage | Main | Staff (access-controlled) | Web+Desktop |
| /my-bookings | MyBookingsPage | Main | Auth user (access-controlled) | Web+Desktop |
| /timeline | RoomReservationTimeline | Main | Staff (access-controlled) | Web+Desktop |
| /guest-config | GuestConfigurationPage | Main | Staff (access-controlled) | Web+Desktop |
| /room-management | RoomManagementPage | Main | Staff (access-controlled) | Web+Desktop |
| /reports | ModernReportsPage | Operations | Staff (access-controlled) | Web+Desktop |
| /housekeeping | HousekeepingPage | Operations | Staff (access-controlled) | Web+Desktop |
| /company-ledger | CustomerLedgerPage | Operations | Staff (access-controlled) | Web+Desktop |
| /profile | UserProfilePage | User | Any auth user | Web+Desktop |
| /help | HelpSupportPage | User | Any auth user | Web+Desktop |
| /ekyc | EkycRegistrationPage | User | Any auth user; multi-step UI | Web+Desktop |
| /my-rewards | LoyaltyDashboard | User | Guest role | Web+Desktop |
| /settings | SettingsPage | Config | Staff (access-controlled) | Web+Desktop |
| /room-config | RoomConfigurationPage | Config | Staff (access-controlled) | Web+Desktop |
| /rbac | RBACManagementPage | Config | Admin (access-controlled) | Web+Desktop |
| /night-audit | NightAuditPage | Admin | Admin (access-controlled) | Web+Desktop |
| /audit-log | AuditLogPage | Admin | Admin (access-controlled) | Web+Desktop |
| /complimentary | ComplimentaryManagementPage | Admin | Admin (access-controlled) | Web+Desktop |
| /loyalty | LoyaltyPortal | Admin | Admin (access-controlled) | Web+Desktop |
| /data-transfer | DataTransferPage | Admin | Admin (access-controlled) | Web+Desktop |
| /ekyc-admin | EkycManagementPage | Admin | Admin (access-controlled) | Web+Desktop |
| /$ (catch-all) | NotFoundComponent | Error | Public (redirects to /) | Web+Desktop |

Modal overlays (not separate pages, per dynamic/modal policy): FirstLoginPasskeyPrompt
(first-login passkey setup, rendered in RootLayout) — would be a state/variant of its parent
screen if page designs are ever authored.

Role note: role-based access is data-driven (RouteAccessPolicy from the backend), so the
role column reflects the code's nav grouping (`main`/`operations`/`admin`/`config`), not a
hardcoded matrix. `/` materially differs by role (LandingPage vs role-routed dashboard) and
is kept as two rows.

## Unresolved / requires human decision

1. **Page-level designs in Claude Design**: unsupported as a synced artifact. Options if
   wanted: (a) design screens interactively in the Claude Design project (its intended
   workflow — the agent already has the synced theme + primitives); (b) expand the component
   sync's scope (`componentSrcMap` + `.ds-entry.tsx`) to include more presentational
   components pages are built from; (c) add an app sitemap to the synced `guidelines/` via
   the converter config so the design agent knows the app's page structure. All three are
   scope decisions — not applied.
2. **Git object corruption**: `git log` on some component paths fails (missing tree
   `c4528a11…`); flagged as a separate task 2026-07-10. Does not affect this reconciliation.
