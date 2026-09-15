# Logo-based loading system — design

Status: approved direction, pre-implementation.
Scope: `hotel-web-fe` only (staff web + guest document + Tauri webview, which
serves the same bundle). No backend, no schema, no dependency changes.

## Goal

Replace the app's spinner-centric loading UX with a calm, brand-led system where
the Salim Inn monogram is the loading element for app-level and page-level
waits. Skeletons stay where they outperform a spinner. Button-level and
real-progress indicators keep their existing, correct primitives.

## Audit findings (baseline)

Brand assets:

- `public/salim-inn/salim-inn-icon.svg` — 64×64 monogram tile: deep-green
  (`#0b211a`) rounded square, gold inner border, gold roofline, ivory `S`,
  gold baseline. All strokes.
- `public/salim-inn/salim-inn-logo.svg` — 440×96 horizontal lockup (monogram +
  serif wordmark + tagline). Used in `GuestPortalShell`.
- Raster copies: `favicon.png`, `icons/icon-*.png`, `maskable-512.png`.
- The staff sidebar brand is a generic MUI `HotelIcon` in a gold tile — it does
  not match the shipped product icon.
- Hotel name is dynamic white-label text from `getHotelSettings()`
  (localStorage, refreshed from `settings/public`).

Existing loading implementations (the duplication this removes):

| Layer | Today | File |
|---|---|---|
| Pre-React paint | Blank dark page until bundle + React mount | `index.html`, `guest.html` |
| Auth resolve | `BootSplash`: hotel name + `HotelSpinner` | `src/router/RouteFallbacks.tsx` |
| Lazy route chunks | `LoadingFallback` skeleton (keep) | same |
| Small Suspense | `MinimalLoadingFallback` (centered `HotelSpinner`) | same |
| Route-level fallbacks | Bare `<CircularProgress sx={{ m: 8 }} />` in ~7 route files | `src/routes/*.tsx`, `guestRouter.tsx` |
| Page/section waits | `HotelSpinner` (rotating ring, 0.8s), `LoadingSpinner` (circular + dots) | `src/components/common/` |
| Consumers of the two spinners | BookingDetailPage, LoyaltyDashboard, LoginPage, RegisterPage, CompleteProfilePage | features |
| Buttons/mutations | `CircularProgress` size 14–24 across ~102 files | keep as-is |
| Real progress | `LinearProgress` (DesktopServiceGate, eKYC refresh) | keep as-is |
| Desktop service gate | one-off card: `CircularProgress` inside gold tile + `LinearProgress` | `src/desktop/DesktopServiceGate.tsx` |
| Route transitions | `AnimatedRoute` (fade/slide/grow CSS keyframes) | keep as-is |

Infrastructure facts that shape the design:

- No animation library in `package.json`; Emotion `keyframes` + plain CSS are
  the established mechanism. No new dependency is needed.
- `index.css` already ships a global `prefers-reduced-motion` kill-switch
  (0.01ms) — the loader additionally carries its own reduced-motion styling so
  it degrades to a static mark even if the global rule is ever narrowed.
- `public/guest-branding.js` is a classic external script (allowed by the
  `script-src 'self'` CSP on both nginx and Tauri) that already reads
  localStorage and writes to the DOM before first paint.
- Theme mode persists in `localStorage.themeMode` (`light|dark`, legacy `night`
  → dark; default dark).
- Both CSPs allow `style-src 'unsafe-inline'` — inline `<style>` in the HTML
  shells is permitted (inline `<script>` is not).
- `index.css` publishes safe-area vars `--sat/--sab/--sal/--sar`; full-screen
  surfaces consume them.

## Selected motion concept

Three concepts were evaluated:

- **A — Elegant Pulse** (scale/opacity breathing). Calm but generic.
- **B — Light Sweep** (periodic champagne highlight across the gold strokes).
  Brand-native (lobby brass, champagne accent) but thin alone.
- **C — Logo Reveal** (stroke draw-on via `pathLength`/`stroke-dashoffset`).
  Crafted, engraved feel; busy if looped.

**Chosen: staged sequence — reveal → sheen → breathe** (combines C as a
one-shot entrance with B+A as the idle loop):

1. Entrance (once): mark fades 0→1 and scales 0.96→1 (300ms,
   `cubic-bezier(0.2, 0.6, 0.2, 1)`); the three gold strokes draw on
   sequentially — roofline, `S`, baseline — staggered ~150ms apart (~700ms
   total) using `pathLength="1"`, `stroke-dasharray: 1`, `stroke-dashoffset`
   1→0. Pure CSS, no path measurement.
2. Idle (looping): the mark breathes opacity 1↔0.88 over 3.6s `ease-in-out`;
   every ~4s a narrow champagne-gradient sheen sweeps left→right across the
   strokes for ~1.2s (implemented as a masked overlay translating on
   `transform`, GPU-only).
3. Exit (where the component controls it — `fullScreen` handoff): opacity
   fade ~200ms. React Suspense unmounts elsewhere are instant by nature; the
   entrance delay (below) prevents that being perceived as a cut.

No rotation, no bouncing, no flashing, no gradients-as-decoration — the sheen
is a light effect on the mark itself.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` inside the component: entrance becomes
an instant static mark (no draw-on, no breath, no sheen). The global 0.01ms
rule already collapses the keyframes; the local rule also removes
`animation-delay` so the mark does not sit at opacity 0 during the delay.

## Component architecture

### `BrandMark` — `src/components/common/BrandMark.tsx`

Inline SVG recreation of `salim-inn-icon.svg`. Props: `size?: number`
(default 64). The tile keeps brand colors in both themes (`#0b211a` /
`#d9b572` / ivory) — it is the literal app icon and reads correctly on light
surfaces, same as the favicon does. Optional `decorative` flag toggles
`aria-hidden` vs `role="img"` + title. Used by `LogoLoader`, the sidebar brand,
and available to future brand surfaces. ≈0.8KB, zero network requests, no
FOUC on the logo asset itself.

### `LogoLoader` — `src/components/common/LogoLoader.tsx`

```tsx
interface LogoLoaderProps {
  variant?: 'fullScreen' | 'page' | 'inline' | 'overlay';
  size?: number;          // mark size in px; variant-dependent default
  label?: string;         // optional visible status line (sr-only text always present)
  delayMs?: number;       // entrance delay; 0 for fullScreen, ~200 default elsewhere
}
```

| Variant | Chrome | Use |
|---|---|---|
| `fullScreen` | fixed full-viewport surface (`background.default`), centered mark (~96px desktop / 72px phone), serif hotel name, optional `label` status line; safe-area padded | app boot/auth resolve, desktop service gate |
| `page` | centered block, `minHeight` region | route-level fallbacks, whole-panel waits |
| `inline` | inline-flex mark (+ optional label) | in-card/in-section waits; replaces both legacy spinners |
| `overlay` | absolute-fill scrim (`--hotel-scrim`) + centered mark over parent region | blocking waits where content must stay mounted |

Semantics: outer element gets `role="status"` + a visually hidden
`common:aria.loading` string (existing i18n key); when `label` is provided it
is visible text and is the accessible name. One announcement per mount — no
live-region churn, no fake percentages.

Flash prevention: non-`fullScreen` variants render at `opacity: 0` and fade in
after `delayMs` via a CSS animation — if the wait resolves under the threshold
the loader is removed before it ever painted. `fullScreen` skips the delay:
there is nothing else on screen, and hiding it would just show a blank frame.

### Static pre-React splash — `index.html`, `guest.html`

A sibling `<div id="boot-splash">` (not inside `#root`, so React's mount does
not hard-remove it mid-fade): inline monogram SVG + a small inline `<style>`
with the same entrance keyframes. Background via
`html[data-boot-theme="light"]` selector; `guest-branding.js` sets that
attribute from `localStorage.themeMode` (3 lines, same pattern as its existing
hotel-name read). Dark is the default when the attribute is absent.

`index.tsx` (and the guest entry) removes it after `root.render()`: add a
`boot-splash--done` class → 200ms opacity fade → `remove()` on
`transitionend` with a `setTimeout` backstop. Because the static mark and the
`fullScreen` loader mark share the same centered layout and size, the
crossfade is invisible; when auth is still resolving, `BootSplash` is already
rendering underneath it.

### Migration & consolidation

- `BootSplash` keeps its name and contract (full-viewport, hotel name,
  `role="status"`) but renders `LogoLoader variant="fullScreen"` internally.
- `LoadingFallback` unchanged — page-shaped skeleton stays the lazy-route
  fallback.
- `MinimalLoadingFallback` → `LogoLoader variant="page"`.
- `HotelSpinner` and `LoadingSpinner` deleted; consumers migrate to
  `LogoLoader variant="inline"` (or `page` where the wait owns the panel):
  `BookingDetailPage`, `LoyaltyDashboard`, `LoginPage`, `RegisterPage`,
  `CompleteProfilePage`, `RouteFallbacks`, `components/index.ts`.
- Bare `<CircularProgress sx={{ m: 8 }} />` route fallbacks →
  `<LogoLoader variant="page" />`: `routes/bookings.$bookingId.tsx`,
  `routes/guest-relations/guests/$guestId.tsx`, `routes/guest-relations/follow-ups.tsx`,
  `routes/booking.recover-payment.$token.tsx`, `routes/help.$slug.tsx`,
  `routes/unsubscribe.$token.tsx`, `guest/guestRouter.tsx` (unsubscribe route).
- `DesktopServiceGate`: the `CircularProgress`-in-gold-tile becomes
  `BrandMark` (or `LogoLoader inline`); `LinearProgress` stays — startup is a
  real phased wait.
- `SidebarContent` brand tile: MUI `HotelIcon` → `BrandMark` (unifies the
  staff chrome with the product icon).
- Buttons (`CircularProgress` 14–24px), `Skeleton`s, `LinearProgress`,
  `AnimatedRoute`: untouched.

### Loading hierarchy after the change

```
pre-React paint        static HTML splash (index.html/guest.html)
app/auth boot          LogoLoader fullScreen      (BootSplash, DesktopServiceGate)
route/page wait        LogoLoader page | LoadingFallback skeleton
section/component wait LogoLoader inline | existing Skeletons
blocking region        LogoLoader overlay
action/submit          CircularProgress in-button (unchanged)
measured progress      LinearProgress (unchanged)
```

## Accessibility

- `role="status"` + `aria-label` (or visible `label`) — announced once per
  mount; no `aria-live` regions, no percentage.
- `prefers-reduced-motion`: static mark, entrance-only (see motion spec).
- Focus: loaders are non-interactive; `overlay` variant does not steal focus —
  the triggering control's disabled state carries the semantics.
- Contrast: brand tile colors are fixed and already ship as the app icon;
  `label` text uses `text.secondary`/`text.muted` tokens (AA-checked roles).

## Performance

- Inline SVG only — no logo network request, no raster decode, single shared
  asset (also dedupes the sidebar usage).
- All animation is `transform`/`opacity`/`stroke-dashoffset`/gradient-position
  on a masked element — compositor-friendly; no JS rAF loops, no layout reads.
- CSS entrance delay = zero-JS flash prevention.
- Unmount removes the DOM subtree; no timers or listeners to leak (the only
  timer is the boot-splash removal backstop, cleared on transitionend).

## Testing

Vitest + Testing Library (jsdom), following existing component-test patterns:

- `LogoLoader.test.tsx`: variant rendering (`role="status"` presence/absence
  of chrome), `label` visible + accessible name, default sr-only label,
  `delayMs` produces the entrance-delay style, reduced-motion class/style
  applied when `matchMedia` matches (mock per existing tests).
- `BrandMark.test.tsx`: `aria-hidden` when decorative, `role="img"` +
  accessible name otherwise.
- `BootSplash` consumers: existing tests keep passing (markup changes, ARIA
  contract identical).
- Gates: `bun run typecheck`, `bun run lint:strict`, `bun run test`,
  `bun run build`.

Manual/visual validation matrix (documented in the plan, executed at the end):
desktop + phone widths, dark + light, reduced motion, slow-3G boot (static
splash visible), fast load (no flash), route transition, login submit, dialog
submit, table refresh.

## Documentation

- New "Loading states" section in `docs/DESIGN_SYSTEM.md` — variant table,
  when-to-use rules, motion spec, reduced-motion behavior, threshold guidance.
- `design-guidelines/app-structure.md` — replace the `HotelSpinner`/
  `LoadingSpinner` rows with `LogoLoader`/`BrandMark` and the hierarchy above.
- Component docstrings in house style (purpose, contract, usage boundary).
- i18n: reuse `common:aria.loading`; if `label` defaults are needed, add to
  `en`/`ms`/`zh` `common.json` — the parity test enforces all locales.

## Out of scope

- No changes to `CircularProgress` button/mutation usage (~102 files).
- No backend, schema, CSP, or routing changes; no new dependencies.
- No loader for operations under ~200ms (the delay mechanism already handles
  this — nothing is rendered).
- `guest.html` splash mirrors `index.html`; the guest router's other fallbacks
  (`fallback={null}` on public pages) stay — public guest pages swap content
  without a spinner by design.
