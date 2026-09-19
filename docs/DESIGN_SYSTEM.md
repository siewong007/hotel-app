# Design System

Single semantic token layer (`hotel-web-fe/src/theme/tokens.ts`) feeding the MUI theme
(`src/theme/index.ts`), which publishes every token as a `--hotel-*` CSS custom
property. Components consume semantic roles — never raw palette values.

## Modes

- `dark` — flagship. Layered blue-charcoal surfaces, muted champagne-gold accent.
- `light` — warm paper counterpart; same token names, darker bronze accent for AA.

`ThemeMode = 'light' | 'dark'`. Legacy persisted `night` values normalize to dark.

## Surfaces (elevation)

| Token | Dark | Use |
|---|---|---|
| `--hotel-bg` | `#0B0E13` | app background |
| `--hotel-surface` | `#12161D` | cards, sidebar, tables |
| `--hotel-surface-raised` | `#171C24` | nested panels, header bands |
| `--hotel-surface-overlay` | `#1D232E` | dialogs, menus, popovers |
| `--hotel-surface-sunken` | `#0D1117` | inset wells, table header bands |
| `--hotel-hover` / `--hotel-active` | | row hover / pressed |
| `--hotel-selected` | | selected rows/items |

Never pure `#000`/`#fff` for surfaces. Elevation differences stay subtle.

## Text

`--hotel-text`, `--hotel-text-secondary`, `--hotel-text-muted`, `--hotel-text-disabled`.

## Borders

`--hotel-border-subtle` (dividers), `--hotel-border` (cards/tables),
`--hotel-border-strong` (inputs, emphasis).

## Accent — champagne gold

`--hotel-primary`, `--hotel-primary-hover`, `--hotel-primary-active`,
`--hotel-primary-subtle` (tinted fill), `--hotel-primary-border`,
`--hotel-on-primary` (text on gold), `--hotel-primary-text` (gold text on surfaces),
`--hotel-focus-ring`.

Use gold only for: primary actions, active nav, focus, links, key metrics.
Never flood a surface with it.

## Status tones

Each status has `{fg, bg, border}`: `--hotel-{success,warning,danger,info,neutral}`,
`-bg`, `-border`. Badges/alerts use the tinted pattern — subtle bg + fg + border —
never a saturated solid block. `StatusChip` and the `MuiChip` overrides already
implement this; don't hand-roll per-page badge colors.

## Charts

`--hotel-chart-1..5` (series), `--hotel-chart-grid`, `--hotel-chart-axis`,
`--hotel-tooltip-bg`. The Nivo wrappers in `src/components/charts/` and the
custom SVG charts both consume these. No rainbow palettes, no literal hexes
in chart props.

## Misc

`--hotel-scrim` (dialog backdrop), `--hotel-scrollbar-{track,thumb,thumb-hover}`,
`--hotel-shadow-{sm,md,lg}`.

## Loading

Loading uses the Salim Inn monogram — `BrandMark`
(`src/components/common/BrandMark.tsx`, inline SVG, zero network requests) inside
`LogoLoader` (`src/components/common/LogoLoader.tsx`). No spinning rings; skeletons
stay for content-shaped waits.

| Variant | Use | Notes |
|---|---|---|
| `fullScreen` | app boot, auth resolution, desktop service start | mark + hotel name; shows immediately |
| `page` | a route or panel whose content is not loaded and a skeleton is the wrong shape | ~200ms entrance delay; `minHeight` sizes the region (default 240px) |
| `inline` | inside a card/section/row alongside other content | 24px mark; `label` adds a status line |
| `overlay` | blocking wait over a positioned ancestor | scrim + centered mark |

- `label` is a visible status line *and* the accessible name; without it a
  visually-hidden "Loading" is announced once via `role="status"`. No
  repeated live-region announcements, no fake percentages.
- Non-`fullScreen` variants wait ~200ms (`delayMs`) before fading in, so fast
  requests never flash.
- `prefers-reduced-motion` renders a static mark — entrance only, no
  breath/sheen (component-level; the global CSS rule is the backstop).
- Motion: one-shot stroke draw-on → slow opacity breath → periodic champagne
  sheen across the tile. Pure CSS on transform/opacity/stroke-dashoffset —
  no JS loops, no animation dependency.

Hierarchy — pick the smallest surface that fits:

```text
#boot-splash (static HTML, pre-React; themed by guest-branding.js)
  → LogoLoader fullScreen   (boot/auth)
  → LogoLoader page         (routes, panels, dialog bodies)
  → LogoLoader inline       (sections, rows)
  → CircularProgress ≤24px  (buttons, input adornments only — never standalone)
  → LinearProgress          (only when real progress is known)
```

Skeletons (`LoadingFallback`, `Skeleton`) still own content-shaped lazy-route
fallbacks. Never put LogoLoader inside a button, and never replace a skeleton
with a spinner when the skeleton communicates the page structure better.

## Rules

- **`alpha()` cannot parse `var(...)`** — it throws. Use `color-mix(in srgb, var(--hotel-x) N%, transparent)` for tints, or the dedicated `*-bg`/`*-border` tokens.
- **`${color}NN` hex-alpha suffixes are invalid on var()** — same fix.
- `grey.NN` MUI palette values are absolute shades (near-white in dark) — use surface/border/text tokens instead.
- Guest-facing portal keeps Georgia serif display headings on the same tokens.
- **Print/PDF output (invoices, ledgers) intentionally stays paper-light** — it's a printed document, not app UI. On-screen invoice previews render inside `PaperIsland` (nested light `ThemeProvider` + republished `--hotel-*` vars on the wrapper), so the sheet, its text, and token-driven children (deposit card, inputs, chips) all read the warm-paper palette inside the dark shell. Print iframes can't see the vars — the print styles interpolate `paperTokens` literals for the same palette.
- **Frosted glass is user-tunable** — `--hotel-glass-blur` (0–20px, default 10) and `--hotel-glass-alpha` on `:root` drive every blurred surface (filled toasts, `MuiBackdrop` scrims at ×0.5, portal nav). At 0 the alpha goes 100% so surfaces render solid instead of translucent. Set via Settings → Appearance → Background blur (`glassBlur` localStorage key, `GlassBlurContext`).
- OTA channel badges (Agoda/Booking/Expedia/Airbnb) keep their brand colors — external identities, not app palette.
- Loyalty tier colors (bronze/silver/gold/platinum metals) are tier identities — kept as hues, rendered as tints.
