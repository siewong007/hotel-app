# Implementation Plan — Guest Portal Redesign

Spec: `docs/superpowers/specs/2026-09-14-guest-portal-redesign-design.md`
(all paths below relative to `hotel-web-fe/`)

## Step 1 — Guest token layer

**New file `src/features/guestPortal/theme/guestTokens.ts`:**

- `guestDarkTokens: DesignTokens` and `guestLightTokens: DesignTokens` (import
  type from `../../../theme`). Copy the staff `darkTokens`/`lightTokens`
  structure verbatim, then apply the palette from spec §1 (surfaces, text,
  border, primary, secondary, status reuse, chart, focusRing, scrim,
  scrollbar, shadow — every field, same shape).
- `normalizeGuestThemePreference(v): 'system'|'light'|'dark'` — `'light'`/
  `'dark'` pass through, everything else → `'system'`.

**Edit `src/features/guestPortal/theme/guestPortalTheme.ts`** (replace file):

```ts
import { createHotelTheme, cssVarDeclarations, type ThemeMode } from '../../../theme';
import { guestDarkTokens, guestLightTokens } from './guestTokens';

export const GUEST_BRAND = {
  bg: '#123A2E',
  hover: 'rgba(255, 253, 247, 0.08)',
  active: 'rgba(255, 253, 247, 0.16)',
  text: '#FFFDF7',
  muted: '#C9D8D0',
  accent: '#D9B572',
  accentText: '#231B0C',
  border: 'rgba(217, 181, 114, 0.35)',
} as const;

export const guestTokensFor = (mode: ThemeMode) =>
  mode === 'light' ? guestLightTokens : guestDarkTokens;

export const createGuestPortalTheme = (mode: ThemeMode) =>
  createHotelTheme(guestTokensFor(mode), { displaySerif: true });

export const guestPortalCssVars = (mode: ThemeMode): Record<string, string> =>
  cssVarDeclarations(guestTokensFor(mode));
```

`guestPortalTheme` eager export is removed — only caller is
`GuestPortalThemeProvider` (grep-confirmed).

**Edit `src/theme/index.ts`:** add `cssVarDeclarations` to the export block
(additive; currently module-private at line ~54).

## Step 2 — Mode-aware provider + guest theme preference context

**Rewrite `src/features/guestPortal/theme/GuestPortalThemeProvider.tsx`:**

```tsx
export function GuestPortalThemeProvider({ children, mode }: {
  children: ReactNode; mode?: ThemeMode;
}) {
  const ctx = useContext(ThemeModeContext);              // throws-safe: useContext, not useThemeMode
  const resolved = mode ?? ctx?.themeMode
    ?? normalizeThemeMode(storage.getItem('themeMode')); // bare-test fallback
  const theme = useMemo(() => createGuestPortalTheme(resolved), [resolved]);
  const vars = useMemo(() => guestPortalCssVars(resolved), [resolved]);
  return (
    <ThemeProvider theme={theme}>
      <Box sx={vars as SxProps}>{children}</Box>
    </ThemeProvider>
  );
}
```

(Custom properties in `sx` pass through to inline style — Emotion forwards
unknown `--*` keys.)

**New file `src/features/guestPortal/theme/guestThemePreference.tsx`:**

```ts
export type GuestThemePreference = 'system' | 'light' | 'dark';
export const GUEST_THEME_STORAGE_KEY = 'guestThemeMode';
export const GuestThemePreferenceContext =
  createContext<{ preference: GuestThemePreference;
    onPreferenceChange: (p: GuestThemePreference) => void } | null>(null);
export function useGuestThemePreference() { return useContext(GuestThemePreferenceContext); }
export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
```

## Step 3 — `src/guest/GuestApp.tsx`

- State: `preference = normalizeGuestThemePreference(storage.getItem(GUEST_THEME_STORAGE_KEY) ?? storage.getItem('themeMode'))`.
- `systemDark` state seeded by `systemPrefersDark()`; `useEffect` attaches a
  `change` listener on `matchMedia('(prefers-color-scheme: dark)')` (guarded).
- `themeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference`.
- `activeTheme = createGuestPortalTheme(themeMode)` (replaces `createAppTheme`).
- `handleThemeModeChange(mode)` → `setPreference(mode)` + persist to
  `GUEST_THEME_STORAGE_KEY` (keeps ThemeModeContext contract; nothing else
  writes it).
- Wrap tree: `<GuestThemePreferenceContext.Provider value={{preference, onPreferenceChange: setPreference}}>`
  inside `ThemeModeContext.Provider`.

## Step 4 — `src/guest/GuestRootLayout.tsx`

- `const isOffers = pathname === '/offers';` → join the shell branch:
  `if (isPortal || isLegal || isOffers)` (public-visibility branch, same
  `showAccountNav` computation).
- Final bare fallback becomes
  `<GuestPortalThemeProvider>{page}</GuestPortalThemeProvider>` so auth,
  guest-checkin, and unsubscribe pages get the guest theme + scoped vars in
  both documents. (Portal/legal/offers branches keep the provider inside the
  shell.)

## Step 5 — `src/features/guestPortal/hooks/useGuestSignOut.ts` (new)

```ts
export function useGuestSignOut() {
  const { logout: logoutPortal } = usePortalSession();
  const { logout: logoutAccount } = useAuth();
  return useCallback(() => { logoutPortal(); logoutAccount(); },
    [logoutAccount, logoutPortal]);
}
```

Same ordering as `usePortalSessionBootstrap.signOut` (comment preserved).

## Step 6 — `GuestPortalShell.tsx` rewrite

New nav model (all `?section=` targets unchanged):

- `primarySections` — Home, Stays, Points (unchanged).
- `rewardsSections` — Offers, Vouchers, Free nights.
- `accountSections` — Profile, Identity, Security, Preferences.
- `currentGuestSection` unchanged. `isSecondaryActive` splits into
  `isRewardsActive` / `isAccountActive`; `mobileValue` → `MORE_VALUE` when
  either group is active.

Desktop AppBar (always `GUEST_BRAND.bg`, border `GUEST_BRAND.border`):
- Logo link (unchanged).
- Nav: three primary `Button`s + a **Rewards** `Button` (`aria-haspopup="menu"`,
  `aria-expanded`, KeyboardArrowDown icon, `aria-current` when a rewards
  section is active) opening a MUI `Menu` with the three rewards links
  (each `component={Link}`, `aria-current` on the active one).
- Right cluster: `LanguageSwitcher`, `GuestPortalNotificationBell`,
  **account `IconButton`** — `Avatar` (initials from `user.full_name ??
  user.username`, `bgcolor: GUEST_BRAND.accent`, `color: accentText`) with
  `aria-haspopup="menu"` — then the gold Book CTA
  (`bgcolor: GUEST_BRAND.accent`, `color: GUEST_BRAND.accentText`).
- Account `Menu`: non-interactive identity row (avatar, name, email) →
  account section `MenuItem`s (icon + label, `aria-current`) → `Divider` →
  "Explore hotel" (`component="a"`, `target` same-tab) → `Divider` →
  **Sign out** (`LogoutOutlinedIcon`, `color: 'var(--hotel-danger)'`,
  calls `useGuestSignOut()`).
- Nav text `GUEST_BRAND.muted` → `GUEST_BRAND.text` on hover/active; active
  gets a 2px `GUEST_BRAND.accent` bottom border. All `var(--hotel-*)` refs in
  header chrome replaced by `GUEST_BRAND.*`.
- `showAccountNav=false` keeps the existing Sign-in button (brand colors).

Mobile:
- Bottom bar unchanged (items + styling already token-driven).
- More `Drawer`: identity header (avatar + name + email) when authenticated;
  `ListSubheader`-style "Rewards" group (3 items) and "Account" group
  (4 items); "Explore hotel" row; **Sign out** row (danger icon+text);
  close via existing nav effect. `minHeight: 52` rows preserved.
- `useAuth()` + `useGuestSignOut()` wired in; `signOut` only rendered when
  `showAccountNav` and a user exists.

Delete `FOREST`/`LINEN`/`GOLD` aliases (`LINEN` → `bgcolor: 'var(--hotel-bg)'`
inline on the root Box, or `bgcolor: 'background.default'`).

## Step 7 — `PortalDashboardPage.tsx`

- Delete `SECTION_TITLES`, the outer `Paper`, its header `Box` (title + Sign
  Out button), and the `signOut` prop on `AuthenticatedDashboard`.
- `Container` → `Fade`-keyed `Box component="section"` directly, keeping
  `p`/`mt`/`mb` spacing. Sections' `SectionHeading` is now the single heading.
- `usePortalSessionBootstrap` keeps returning `signOut` (still used by
  `restartSignIn`); the page stops destructuring it.

## Step 8 — `PortalDashboardSections.tsx`

- **BookingsSection rows:** action cell/card → `Upload receipt` (contained
  `color="error"`, only when `requiresPaymentReceipt`) + `View details`.
  Delete the duplicate `View receipt` button (same handler), the per-row
  Cancel button, and the `CancellationUnavailable` component entirely.
- **`BookingDetailsDialog`:** new prop `onRequestCancel(booking)`. In
  `DialogActions`, before Close: when `booking.can_cancel`, an outlined
  `color="error"` button labelled `completed_payment_id != null ?
  "Request cancellation" : "Cancel booking"` → `onRequestCancel(booking)`
  (parent sets `bookingToCancel` and closes the view dialog); when
  `!can_cancel`, an inline cancellation note in `DialogContent`:
  `cancellation_pending` → `Chip` "Cancellation under review", else
  `Alert severity="info"` with `cancellation_unavailable_reason` (existing
  fallback text).
- **`EmbeddedSection` preferences branch:** render `<AppearancePreferenceCard/>`
  above `<PortalNotificationPreferences>`. New local component (this file or
  a small sibling `AppearancePreferenceCard.tsx`): `useGuestThemePreference()`
  → null → render nothing; else a `Card` with `RadioGroup row` of three
  `FormControlLabel` radios (System / Light / Dark) calling
  `onPreferenceChange`.
- **Color fixes:** `bgcolor: "success.50"` (receipt `Paper`) →
  `var(--hotel-success-bg)` + `borderColor: 'var(--hotel-success-border)'`;
  delete `FOREST`/`GOLD` consts → direct `var(--hotel-text)` /
  `var(--hotel-primary)` refs.

## Step 9 — Small component fixes

- `GuestPortalNotificationBell.tsx`: "View request" `color="secondary"` →
  `color="error"`; badge border `2px solid ${GUEST_BRAND.bg}` (import it);
  FOREST/URGENT consts removed or renamed.
- `PortalSupportWidget.tsx`: panel header `bgcolor` → `GUEST_BRAND.bg`,
  `color`/`IconButton` → `GUEST_BRAND.text`, hover `GUEST_BRAND.hover`; FAB
  keeps `var(--hotel-primary)` gold (rename `FOREST` → `ACCENT`).
- `PortalBookingPage.tsx`: `success.50`/`success.light` →
  `var(--hotel-success-bg)`/`var(--hotel-success-border)`; `divider` borders →
  `var(--hotel-border)`. Sweep for other raw palette refs in the file while
  there.
- `OffersPage.tsx`: drop the gradient `<header>` and the "Guest portal"
  button (shell supplies chrome now); keep a compact title block (h1 +
  subtitle) + `PromotionCatalog`; keep its `GuestPortalThemeProvider` wrapper
  (harmless inside the shell, needed for the staff-doc render).
- `IdentitySection`, `ProfileSection`, `SecuritySection`,
  `PortalNotificationPreferences`: replace `FOREST`/`GOLD_TEXT` aliases with
  direct `var(--hotel-*)` refs (no structural changes).
- `GuestCheckIn*` files: read each for hardcoded colors / oversized chrome;
  fix only raw-color or spacing outliers — they inherit the guest palette
  automatically via the root-layout provider wrap.

## Step 10 — i18n

`en/guestPortal.json` + `ms/guestPortal.json`, mirrored:

```json
"nav": { ..., "rewards": "Rewards" },
"account": {
  "title": "Account",
  "signOut": "Sign out",
  "guest": "Guest"
},
"groups": { "rewards": "Rewards", "account": "Account" },
"preferences": {
  "appearance": "Appearance",
  "themeSystem": "System — follow browser",
  "themeLight": "Light",
  "themeDark": "Dark"
}
```

(ms translations to match; `tOr` fallbacks keep bare keys readable.)

## Step 11 — Tests

- `GuestPortalShell.test.tsx`: add `vi.mock` for `../../../auth/AuthContext`
  (`useAuth` → `{ user: {full_name, username, email}, logout: spy }`) and
  `../api/usePortalSession` (`logout: spy`) — or mock the new
  `useGuestSignOut` hook directly. Update expectations: Rewards dropdown
  (open menu, assert Offers/Vouchers/Free nights `aria-current`), account
  menu (open, Profile/Security/Preferences/Sign out), Sign out calls both
  logouts, More sheet groups, unchanged deep-link/support assertions.
- `PortalDashboardPage.test.tsx`: drop h1/SECTION_TITLES + Sign Out
  assertions; assert the right section testid per `?section=`.
- `PortalDashboardSections.test.tsx`: `Cancellation unavailable`/`under
  review` assertions now open "View details" first; cancellation tests click
  the cancel button inside the details dialog; add "View receipt" absence
  assertion. Check `Preferences`/appearance coverage — add a
  `GuestThemePreferenceContext.Provider` render asserting the radio writes
  `guestThemeMode`.
- `GuestPortalThemeProvider.test.tsx`: add mode test — render with
  `ThemeModeContext.Provider value={{themeMode:'light',...}}` and assert the
  wrapper carries the light `--hotel-bg` value; keep existing tests.
- New `guestTokens.test.ts` (or fold into provider test): both token sets
  satisfy `DesignTokens` (type-level, plus a spot check on primary/bg).
- `GuestApp` preference resolution: unit-test `normalizeGuestThemePreference`
  + `systemPrefersDark` guard; if GuestApp itself is hard to mount, extract
  the resolver into the theme module and test it there.

## Step 12 — Gates

```bash
cd hotel-web-fe
bun run typecheck && bun run lint && bun run test && bun run build
```

Then a manual smoke pass (`bun run start` → guest.html): every `?section=`,
`?view=booking`, `/offers`, `/legal/*`, `/unsubscribe/x`, `/login`,
`/guest-checkin` at 375px / 768px / 1280px in both modes.

## Out-of-scope guardrails

- No changes to `src/routes/*`, staff layout, or `createAppTheme`/`tokens.ts`
  values — staff rendering is byte-identical except the one new export.
- `?section=`/`?view=` params, `parsePortalSection`, `currentGuestSection`
  mapping, `/portal*` redirects, API calls, and `portalTokenStore` unchanged.
- `PaymentsSection` stays (unreachable); token-aligned only if touched.
