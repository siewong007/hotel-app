# hotel-app design system — how to build with it

These components are the shared UI primitives from **hotel-app** (a property-management app). They are built on **MUI v7 + Emotion** and are themed through an MUI `ThemeProvider`. Everything below is what you need to compose them correctly and on-brand.

## Wrapping & setup (required)

Every component reads its palette, typography, and shape from MUI's theme context. **Wrap your app root once in `AppThemeProvider`** (exported on the bundle as `window.HotelDS.AppThemeProvider`). Without it, MUI components fall back to the default *blue* Material theme instead of the hotel **teal** brand.

```jsx
import { AppThemeProvider, StatCard } from 'hotel-web-fe';

<AppThemeProvider>
  {/* your screen */}
</AppThemeProvider>
```

`AppThemeProvider` mounts the light-mode hotel theme plus `<CssBaseline/>`. (The app itself also supports `dark` and `night` modes, but previews/designs use light.)

## Styling idiom: MUI `sx`, not CSS classes

There is **no utility-class system and no CSS-module vocabulary**. Style with MUI's `sx` prop and theme-token strings — never hand-written class names or raw hex when a token exists:

- **Palette tokens** (pass as strings): `primary.main` (teal `#26a69a`), `primary.dark` (`#00796b`), `secondary.main` (cyan `#00bcd4`), `text.primary`, `text.secondary`, `background.default`, `background.paper`, `divider`, and status colors `success.main` / `info.main` / `warning.main` / `error.main`.
- **Spacing**: numeric `sx` units are 8px steps — `sx={{ p: 2, gap: 1.5 }}` = 16px padding, 12px gap.
- **Typography**: use MUI `<Typography variant="h6|subtitle2|body2|caption">`; don't set font-family manually.

```jsx
<Box sx={{ display: 'flex', gap: 2, p: 2, bgcolor: 'background.paper' }}>
  <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Occupancy</Typography>
</Box>
```

The bundle also re-exports the MUI primitives you'll most often need for layout/scaffolding so they share the same themed instance: `Box`, `Paper`, `Typography`, `Tabs`, `Tab`, `Chip`. Import them from `'hotel-web-fe'` (not `'@mui/material'`) so they pick up the hotel theme.

## The components

- **`StatCard`** — dashboard metric card. `title` + `value` are required; add `icon`, `subtitle`, `trend={{ value, label }}`, and `appearance="gradient"` (with a `gradient` CSS string) for hero cards. Accepts all MUI `CardProps`.
- **`DataTable`** — TanStack-Table-backed table. Pass `data` (row objects) and `columns` (`{ accessorKey, header, cell? }[]`); `emptyMessage`, `enablePagination`, `pageSize`, `onRowClick` are optional.
- **`TabPanel`** — pair with MUI `<Tabs>`; renders `children` only when `value === index`.
- **`ModernDatePicker`** — controlled date field; `label`, `value` (`YYYY-MM-DD`), `onChange` required; supports `error`/`helperText`, `size`, `required`.
- **`HotelSpinner`** — branded full-screen loader (`size` in px).
- **`LoadingSpinner`** — inline loader; `variant="circular" | "dots"`, `size`, `color`.

## Where the truth lives

Read each component's `<Name>.d.ts` (the exact prop contract) and `<Name>.prompt.md` (usage) before composing. The theme itself is defined in `src/theme.ts` in the source repo — refer to it for the full palette across all three modes.

## One idiomatic example

```jsx
import { AppThemeProvider, StatCard, Box } from 'hotel-web-fe';
import HotelIcon from '@mui/icons-material/Hotel';

<AppThemeProvider>
  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', p: 2 }}>
    <StatCard title="Occupancy" value="82%" subtitle="128 of 156 rooms" icon={<HotelIcon />} />
    <StatCard title="Revenue" value="RM 42,180" appearance="gradient"
      gradient="linear-gradient(135deg, #2f8d66 0%, #1f6f52 100%)" />
  </Box>
</AppThemeProvider>
```
