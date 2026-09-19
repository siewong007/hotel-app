# Invoice paper island + glass blur preference — design

Date: 2026-09-19
Status: approved by user (interactive choices: restyled paper, all frosted surfaces)

## Problem

1. The checkout **Invoice Preview** (`CheckoutInvoiceModal`) looks wrong inside the
   dark shell: the "paper document" block hardcodes the default-MUI palette
   (`#FFFFFF`, `#1976d2`, `#666`, `#ddd`, …) while token-driven children inside
   it (`DepositSection`, inputs, chips, alerts) resolve **dark** theme values —
   so the sheet contains a dark card inside a white page inside a dark dialog.
   `CompanyInvoiceDialog` duplicates the same literal palette.
2. The global toast (`ApiNotificationHost`, `variant="filled"` Alert) inherits
   `status.*.bg` — a **13%-alpha badge tint** — so page content bleeds through
   and reads as "blurry". There is no real `backdrop-filter` on it.
3. Users want control over background blurriness.

## Decisions

- On-screen invoice previews keep the **paper document metaphor**, restyled with
  the design system's warm-paper palette + bronze accents (not a dark panel).
- One **`--hotel-glass-blur`** user preference drives every frosted surface
  (toasts, dialog/drawer scrims, portal nav). At 0 everything renders solid.
- Printed output keeps a literal paper palette — but the literals are upgraded
  to the same warm-paper/bronze values so preview ↔ print stay identical.

## Design

### Paper island

`cssVarDeclarations` is already exported for scoped theme islands and
`GuestPortalThemeProvider` is the precedent. New shared component:

```tsx
// src/components/common/PaperIsland.tsx
const PAPER_THEME = createAppTheme('light');       // module-level, built once
const PAPER_VARS = cssVarDeclarations(lightTokens); // module-level
<ThemeProvider theme={PAPER_THEME}>
  <Box style={PAPER_VARS} sx={sx}>{children}</Box>
</ThemeProvider>
```

Inside the island, MUI props (`text.secondary`, `color="success"`, inputs,
chips, alerts, `alpha(theme.palette.*)`) resolve the **light** palette and every
`var(--hotel-*)` resolves light values — `DepositSection` becomes paper-correct
with no edits to it.

`tokens.ts` gains `paperTokens` — semantic paper roles mapped to `lightTokens`
values, for contexts CSS vars can't reach (the print iframe document and the
hidden `CheckoutInvoicePrintView` cloned into it).

### Literal → var map (preview JSX)

| Literal | Var |
|---|---|
| `#FFFFFF` sheet | `var(--hotel-surface)` (#FCFBF7) |
| `#333` | `var(--hotel-text)` |
| `#666` | `var(--hotel-text-secondary)` |
| `#1976d2` bands / accent text | `var(--hotel-primary)` / `var(--hotel-primary-text)` |
| `'white'` on accent bands | `var(--hotel-on-primary)` |
| `#ddd` | `var(--hotel-border)` |
| `#eee` | `var(--hotel-border-subtle)` |
| `#fafafa` `#f5f5f5` `#eceff1` | `var(--hotel-surface-sunken)` |
| `#2e7d32` | `var(--hotel-success)` |
| `#e65100` | `var(--hotel-orange)` |
| `#f1f8e9` `#e8f5e9` | `var(--hotel-success-bg)` |
| `#fff3e0` | `var(--hotel-warning-bg)` |

### Glass blur preference

- `storage.ts`: `'glassBlur'` key.
- `src/theme/glassBlur.ts`: `DEFAULT_GLASS_BLUR_PX = 10`, `MAX_GLASS_BLUR_PX = 20`,
  `normalizeGlassBlur(value)`, `applyGlassBlur(px)` which writes
  `--hotel-glass-blur: <px>px` and `--hotel-glass-alpha: 82% | 100%` (100% when
  px = 0 → solid) on `document.documentElement`.
- `src/router/GlassBlurContext.tsx`: `{ glassBlur, onGlassBlurChange }` +
  `useGlassBlur()` — mirrors `ThemeModeContext`.
- `App.tsx`: state from storage, effect calls `applyGlassBlur`, provider added.
- `cssVarDeclarations` publishes the defaults (`10px` / `82%`) so un-set
  sessions and the guest island have values.
- `MuiAlert`: filled variants get
  `backdrop-filter: blur(var(--hotel-glass-blur))` (+`-webkit-`),
  `backgroundColor: color-mix(in srgb, <overlay> var(--hotel-glass-alpha), transparent)`,
  a per-tone `backgroundImage` tint layer, tone border, `t.shadow.md`. Rules sit
  after the `colorSuccess` badge rules so they win at equal specificity.
- `MuiBackdrop`: `backdrop-filter: blur(calc(var(--hotel-glass-blur) * 0.5))` —
  scrims frost at half the user value.
- Existing frost consumers repointed at the var:
  `GuestPortalShell` nav (full value + `--hotel-glass-alpha` bg),
  `GuestFormDialog` scrim (×0.5), `reports.css` lock overlay (×0.5).
  `.locked-blur` (`filter: blur(5px)`) is content censorship, not glass — unchanged.
- `AppearanceCard`: slider 0–20 step 1 with px label + hint text; new props
  `glassBlur`, `onGlassBlurChange`. `SettingsPage` passes them from
  `useGlassBlur()`.
- i18n: `settings.glassBlur`, `settings.glassBlurHint` in en/ms/zh/zh-TW
  `admin.json`.

## Files

- New: `components/common/PaperIsland.tsx`, `theme/glassBlur.ts`,
  `router/GlassBlurContext.tsx`, `theme/glassBlur.test.ts`.
- Edit: `theme/tokens.ts`, `theme/index.ts`, `utils/storage.ts`, `App.tsx`,
  `features/user/components/settings/AppearanceCard.tsx`,
  `features/user/components/SettingsPage.tsx`,
  `features/invoices/components/CheckoutInvoiceModal.tsx`,
  `features/invoices/components/CheckoutInvoicePrintView.tsx`,
  `features/admin/components/CustomerLedger/components/CompanyInvoiceDialog.tsx`,
  `features/guestPortal/components/GuestPortalShell.tsx`,
  `features/guestRelations/components/GuestFormDialog.tsx`,
  `features/dashboard/components/reports/reports.css`,
  `i18n/resources/{en,ms,zh,zh-TW}/admin.json`,
  `features/user/components/settings/AppearanceCard.test.tsx`,
  `docs/DESIGN_SYSTEM.md`.

## Out of scope

- Dark invoice preview variant / per-user preview toggle (rejected option).
- `.locked-blur` and other content filters — not glass surfaces.
- Any change to printed output structure — only its literal palette values.

## Verification

`bun run typecheck && bun run lint:strict && bun run test && bun run build`
in `hotel-web-fe/`. New tests: `normalizeGlassBlur` clamp/parse,
AppearanceCard slider → `onGlassBlurChange`. i18n parity test covers new keys.
