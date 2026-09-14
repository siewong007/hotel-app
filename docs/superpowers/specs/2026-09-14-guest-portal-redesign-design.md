# Guest Portal Redesign — Design Spec

## Goal

Transform the guest-facing experience into a cohesive, production-quality product
with its own hospitality identity (Salim Inn forest green + champagne gold + ivory),
real light/dark support, grouped navigation, and first-class profile/logout access —
without touching the Admin/Staff portal experiences.

## Scope

**In scope — everything served by `guest.html`** (`src/guest/` + `guestDocumentPaths`):

- `src/features/guestPortal/` — shell, dashboard, sections, booking flow, bell,
  support widget/tab, payment panel, theme.
- `src/guest/GuestRootLayout.tsx`, `src/guest/GuestApp.tsx` — provider/layout wiring.
- `src/features/bookings/components/GuestCheckIn*` — guest-only check-in wizard.
- `src/features/promotions` guest-facing components (`PromotionCatalog`,
  `PromotionCard`, `VoucherWallet`, `VoucherCard`, `OffersPage`) — style-level
  alignment only; these render through the guest theme so most changes are free.
- `src/features/legal/pages/*`, `ConsentBlock`, `UnsubscribePage` — light alignment
  via the shared guest theme.
- `src/i18n/resources/{en,ms}/guestPortal.json` — new nav/account keys.
- `src/theme/index.ts` — **additive only**: export `cssVarDeclarations` so the guest
  provider can scope-publish vars. No existing export or value changes.

**Out of scope:** staff routes/components (`src/routes/*`, staff layout, admin
features), API contracts, `?section=`/`?view=` URL params, backend.

**Shared components, handled carefully:** `LoginPage`/`RegisterPage`/etc. are shared
with the staff app — they are not edited directly; they pick up the guest palette
through the provider when rendered in the guest document. `LanguageSwitcher`,
`StatusPage`, `ConfirmProvider` unchanged.

## Bugs being fixed

1. **Invisible header** — `GuestPortalShell` AppBar sets `bgcolor:
   var(--hotel-text)` and nav text to `var(--hotel-text)`/`--hotel-text-secondary`:
   near-white on near-white; the white logo is invisible too.
2. **Theme leak** — portal forces dark MUI theme but inherits `:root` `--hotel-*`
   vars from the outer app, so a stored `light` mode produces dark chrome +
   light-var text/backgrounds (or vice-versa).
3. **No account area** — Sign Out exists only inside the dashboard card header;
   no identity, no menu, nothing on the booking view or in the mobile More sheet.
4. **Duplicate titles** — card header prints the section title *and* each section
   prints it again via `SectionHeading`.
5. **Clutter** — `CancellationUnavailable` block rendered on every
   non-cancellable booking row; mobile booking cards stack 3–4 buttons.
6. **Bad color refs** — `success.50` (nonexistent palette key → silently
   transparent) in `PortalBookingPage`/`PortalDashboardSections`; `color="secondary"`
   (info blue) on the urgent receipt CTA in the bell; misleading `FOREST`/`LINEN`/
   `GOLD` aliases bound to wrong vars.
7. **Disconnected chrome** — `/offers` ships its own gradient hero outside the
   shell; `guest-checkin` uses default MUI with no brand; auth pages use a third
   visual system.

## Architecture

### 1. Guest token layer (`features/guestPortal/theme/`)

- `guestTokens.ts` — `guestDarkTokens: DesignTokens` and
  `guestLightTokens: DesignTokens`, same shape as `theme/tokens.ts` so
  `createHotelTheme` and every component override apply unchanged.

  Dark (flagship, matches the public site):
  - surfaces: app `#0B1814`, base `#10221B`, raised `#143024`, overlay `#1A3A2E`,
    sunken `#08100C`, hover `#1C3A2E`, active `#234739`, selected gold-tinted
    `rgba(217,181,114,0.12)`
  - text: `#F2EEE3` / `#BCC9C2` / `#8A978F` / `#5A675F`
  - border: `#1D332A` / `#2A463A` / `#3D5C4D`
  - primary gold: main `#D9B572`, hover `#E5C68A`, active `#C7A45B`,
    contrastText `#231B0C`, onSurface `#E5C68A`
  - secondary sage `#9ED5BD`; status tones reuse the dark set (harmonized);
    focusRing `rgba(217,181,114,0.55)`; scrim `rgba(3,8,6,0.62)`

  Light (ivory paper):
  - surfaces: app `#F3EFE4`, base `#FFFCF5`, raised `#FFFDF7`, overlay `#FFFDF7`,
    sunken `#EFE8D9`, hover `#EFEADB`, active `#E4DCC8`,
    selected `rgba(138,106,51,0.10)`
  - text: `#1A241E` / `#4A5A51` / `#6E7D73` / `#A2AFA5`
  - border: `#E2DBC8` / `#CFC6AC` / `#AEA385`
  - primary bronze-gold: main `#8A6A33`, hover `#77592A`, active `#654B22`,
    contrastText `#FFFDF7`, onSurface `#77592A`
  - secondary forest `#3F6B58`; status tones reuse the light set.

- `GUEST_BRAND` constant (mode-independent forest header):
  `{ bg: '#123A2E', hover: 'rgba(255,253,247,0.08)', active:
  'rgba(255,253,247,0.16)', text: '#FFFDF7', muted: '#C9D8D0', accent: '#D9B572',
  accentText: '#231B0C', border: 'rgba(217,181,114,0.35)' }` — consumed directly
  from `guestPortalTheme.ts`; no CSS vars needed because the value never varies
  per mode and only the shell header uses it.

- `guestPortalTheme.ts` — `createGuestPortalTheme(mode)` =
  `createHotelTheme(guestTokensFor(mode), { displaySerif: true })`; export
  `guestPortalCssVars(mode)` (calls the now-exported `cssVarDeclarations`).

### 2. Theming flow — Light / Dark / System

- New guest-only preference, stored under a **separate** key `guestThemeMode`
  (`'light' | 'dark' | 'system'`, default `'system'`; falls back to the legacy
  `themeMode` value once when present). Keeping it out of the shared
  `themeMode` key means the staff app's `normalizeThemeMode` never sees
  `'system'` — zero blast radius.
- `GuestApp.tsx`: resolves `preference` → effective `ThemeMode` via
  `window.matchMedia('(prefers-color-scheme: dark)')` (guarded for jsdom,
  live `change` listener), keeps `ThemeModeContext` populated with the
  *effective* mode, and provides a new
  `GuestThemePreferenceContext { preference, onPreferenceChange }`.
  `createGuestPortalTheme(effectiveMode)` replaces
  `createAppTheme(themeMode)` → its `CssBaseline` publishes guest `--hotel-*`
  vars on `:root` for the whole guest document, including portaled overlays
  (dialogs, menus, drawers, One Tap). Staff app unaffected (separate
  document, separate storage key).
- `GuestPortalThemeProvider`: accepts/derives `mode` from `ThemeModeContext`
  (via `useContext`, falling back to the resolved stored/staff mode —
  `useThemeMode` throws when no provider exists and tests render components
  bare). Provides the guest MUI theme **and** wraps children in a `Box`
  carrying `guestPortalCssVars(mode)` as scoped custom properties. This keeps
  the staff-app compat render of `/guest-portal` (which shares `index.html`
  with the staff theme) guest-branded for inline content.
- The **Preferences** section gains an "Appearance" card (System / Light /
  Dark radio group) consuming `GuestThemePreferenceContext` via `useContext`;
  the card is hidden when the context is absent (staff-doc compat renders,
  bare tests). No theme control in the shell menus.
- `GuestRootLayout`: wrap `page` in `GuestPortalThemeProvider` in every branch,
  so auth, guest-checkin, offers (already self-wrapped — becomes a no-op
  duplicate, kept for safety), legal, and unsubscribe all render under the
  guest theme even when reached through the staff document.

### 3. Shell (`GuestPortalShell.tsx`)

Desktop AppBar (always `GUEST_BRAND.bg` forest):
- Left: logo (drawn for dark/forest — now correctly on forest).
- Center nav (md+): Home, Stays, Points, **Rewards ▾** menu (Offers, Vouchers,
  Free nights). Text `GUEST_BRAND.muted`, active `GUEST_BRAND.text` with a
  2px `GUEST_BRAND.accent` underline; hover `GUEST_BRAND.hover`.
- Right cluster: `LanguageSwitcher` (inherit), `GuestPortalNotificationBell`,
  **account menu** — `Avatar` with guest initials (from `useAuth().user`:
  `full_name` → `username` fallback) + name on lg+, opening a `Menu`:
  identity header (name + email), Profile, Identity, Security, Preferences,
  divider, Explore hotel (external ↗), divider, **Sign out** (danger).
- Far right: gold **Book a stay** contained CTA (`GUEST_BRAND.accent` bg,
  `accentText` label).

Mobile (`<md`): same bottom bar items (Home, Stays, Points, Book, More) with
token-driven colors; **More sheet** redesigned:
- Identity header (avatar, name, email) + close affordance.
- Group `Rewards`: Offers, Vouchers, Free nights.
- Group `Account`: Profile, Identity, Security, Preferences.
- Utility rows: Explore hotel (external).
- **Sign out** row, danger-styled, at the bottom.

Removes `FOREST`/`LINEN`/`GOLD` aliases; keeps skip-link, safe-area padding,
`aria-current`, support-widget deep-link behavior, and `?section=` mapping
unchanged.

### 4. Dashboard page (`PortalDashboardPage.tsx`)

- Drop the outer `Paper` card, `SECTION_TITLES`, and the in-card Sign Out
  button. The `Container` hosts the active section directly; each section's
  `SectionHeading` (eyebrow + title + description) is the single page heading.
- `AuthenticatedDashboard` loses its `signOut` prop (sign-out lives in the
  shell); a `useGuestSignOut()` helper is extracted next to
  `usePortalSessionBootstrap` (composes `usePortalSession().logout` +
  `useAuth().logout`, preserving the comment's ordering semantics) and shared
  with the shell menu.

### 5. Sections (`PortalDashboardSections.tsx`, siblings)

- `BookingsSection`: remove the per-row `CancellationUnavailable` block; the
  reason text moves into `BookingDetailsDialog` ("Cancellation" info line when
  `!can_cancel`); pending state becomes a small chip. Row actions collapse to
  **View details** (+ **Upload receipt** danger CTA when required); Cancel
  moves into the details dialog footer (opens the existing
  `RefundBookingDialog`) for both desktop table and mobile cards — one action
  surface, no button stacks.
- `BookingDetailsDialog`/`RefundBookingDialog`: `success.50` →
  `var(--hotel-success-bg)` + `--hotel-success-border`.
- `OverviewSection`, `CreditsSection`, `PointsHistorySection`,
  `ProfileSection`, `SecuritySection`, `DevicesSection`, `IdentitySection`:
  replace FOREST/GOLD aliases with direct `var(--hotel-*)` refs; normalize
  headings/spacing to the SectionHeading pattern where already present.
- `PortalNotificationPreferences` section: add the "Appearance" card
  described in §2 (System / Light / Dark), rendered above the notification
  channels and only when `GuestThemePreferenceContext` is present.
- `GuestPortalNotificationBell`: urgent receipt CTA `color="secondary"` →
  `color="error"` contained; badge border uses `--hotel-surface`.
- `PortalSupportWidget`: panel header stays gold-accented or moves to
  `GUEST_BRAND` forest for brand consistency; FAB stays gold.

### 6. Booking page (`PortalBookingPage.tsx`)

- `success.50`/`success.light` → `var(--hotel-success-*)` tokens; `divider`
  borders → `--hotel-border`; stepper + cards inherit the guest theme. Layout
  unchanged (it already follows the pattern).

### 7. Other guest pages (provider gives them the palette; light restyle)

- `OffersPage`: drop the bespoke gradient hero; render inside
  `GuestPortalShell` (new `isOffers` branch in `GuestRootLayout`, with
  `showAccountNav` only for signed-in guests) so it gets nav, account menu,
  and support widget like the rest. Keep a slim in-page title block.
- `GuestCheckIn*`: keep structure; they inherit guest palette/typography.
- Auth pages: unchanged code — `.auth-card` CSS reads the (now guest) vars.
- `UnsubscribePage`, `StatusPage`s: inherit theme via provider wrap.
- `PromotionCatalog`/`VoucherWallet`/`PortalNotificationPreferences`/
  `ConsentBlock`/`PortalSupportTab`: already token-driven — verify contrast
  under both palettes, fix any raw color refs found.

### 8. i18n

New keys in `guestPortal.json` (en + ms): `nav.rewards` ("Rewards"), account
menu labels reusing existing `nav.*` section keys, `account.title`
("Account"), `account.signOut` ("Sign out"), `account.exploreHotel` reuse,
plus `preferences.appearance` ("Appearance"), `preferences.themeSystem`
("System — follow browser"), `preferences.themeLight`, `preferences.themeDark`.

## Testing

- Update `GuestPortalShell.test.tsx` (new nav structure, account menu, sign
  out, More sheet groups), `PortalDashboardPage.test.tsx` (no card header/sign
  out), `PortalDashboardSections.test.tsx` (booking action consolidation),
  `OffersPage.test.tsx`, `GuestPortalThemeProvider.test.tsx` (mode behavior).
- New coverage: Appearance card writes `guestThemeMode` and re-themes;
  `'system'` resolves through a mocked `matchMedia`; sign out calls both
  logouts; `?section=` mapping and deep-link support unchanged.
- Gates: `bun run typecheck && bun run lint && bun run test && bun run build`
  in `hotel-web-fe/`.

## Risks / non-goals

- `?section=` and `?view=booking` params, deep links, and the
  `/portal*` redirects are preserved verbatim.
- Staff-document renders of guest routes keep working; inline portal content
  is guest-branded there while portaled overlays use the staff theme vars —
  accepted compat-path limitation (guest.html is the real surface).
- `PaymentsSection` is unreachable today (`section=payments` → stays); left in
  place, token-aligned only.
