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
`--hotel-tooltip-bg`. Recharts and the custom SVG charts both consume these.
No rainbow palettes, no literal hexes in chart props.

## Misc

`--hotel-scrim` (dialog backdrop), `--hotel-scrollbar-{track,thumb,thumb-hover}`,
`--hotel-shadow-{sm,md,lg}`.

## Rules

- **`alpha()` cannot parse `var(...)`** — it throws. Use `color-mix(in srgb, var(--hotel-x) N%, transparent)` for tints, or the dedicated `*-bg`/`*-border` tokens.
- **`${color}NN` hex-alpha suffixes are invalid on var()** — same fix.
- `grey.NN` MUI palette values are absolute shades (near-white in dark) — use surface/border/text tokens instead.
- Guest-facing portal keeps Georgia serif display headings on the same tokens.
- **Print/PDF output (invoices, ledgers) intentionally stays paper-light** — it's a printed document, not app UI. On-screen invoice previews are wrapped in paper surfaces so they read correctly inside the dark shell.
- OTA channel badges (Agoda/Booking/Expedia/Airbnb) keep their brand colors — external identities, not app palette.
- Loyalty tier colors (bronze/silver/gold/platinum metals) are tier identities — kept as hues, rendered as tints.
