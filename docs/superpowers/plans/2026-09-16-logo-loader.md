# Logo-based loading system — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's spinner-centric loading UX with a brand-led system built on the Salim Inn monogram — a static pre-React splash, a staged logo loader (draw-on → breath → sheen), and consolidated loading primitives.

**Architecture:** One inline-SVG `BrandMark` (zero network requests, fixed brand colors) + one `LogoLoader` with `fullScreen`/`page`/`inline`/`overlay` variants and CSS entrance-delay flash prevention. Static splash lives in `index.html`/`guest.html` and crossfades into `BootSplash`. Skeletons, in-button `CircularProgress`, and `LinearProgress` stay.

**Tech Stack:** React 19, MUI v9 (`Box`, `keyframes`, `sx`), plain CSS keyframes, Vitest + Testing Library (jsdom), i18n via `useTranslation('common')`.

Spec: `docs/superpowers/specs/2026-09-16-logo-loader-design.md` (committed `a0e6f91e4`).

## Global Constraints

- **All work in `hotel-web-fe/`** — run every command with `cd hotel-web-fe` first.
- No new dependencies. Animation is Emotion `keyframes` + CSS only — no JS animation loops, no rAF.
- Tokens/palette only — no raw hex in component code EXCEPT the five literal brand colors inside `BrandMark` (`#0B211A`, `#D9B572`, `#FFFDF7`) and the static HTML splash (documented; they are the shipped icon's colors, not theme values).
- The monogram tile keeps brand colors in both themes — do not theme-swap it.
- `lint:strict` is a CI gate (`--max-warnings=0`). `no-restricted-syntax` bans `toISOString().split/.slice`, `*.response.json()`, `replace(/_/g,' ')`.
- Existing tests render components without `I18nProvider` — `useTranslation` resolves the `en` catalog standalone; new tests follow that convention.
- Do not touch `CircularProgress` inside buttons (`startIcon`, `endIcon`, `{loading ? <CircularProgress …/> : label}` children) — that pattern stays.
- Skeleton loading (`LoadingFallback`, page `Skeleton`s) stays untouched.
- Git: the tree has unrelated dirty files (channel-pricing backend work) — stage only files this plan touches. Never `git add -A`.
- This volume path contains a space — quote all shell paths.
- i18n parity: `en`/`ms`/`zh` resource files must keep identical key sets (a parity test enforces it). This plan reuses `common:aria.loading` ("Loading") — no new keys required.

---

### Task 1: `BrandMark` component

**Files:**
- Create: `hotel-web-fe/src/components/common/BrandMark.tsx`
- Test: `hotel-web-fe/src/components/common/BrandMark.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts` (add exports; keep existing `HotelSpinner`/`LoadingSpinner` exports — removed in Task 4)

**Interfaces:**
- Produces: `BrandMark` (default export) + `BrandMarkProps`. SVG parts carry class hooks `hotel-mark__roofline`, `hotel-mark__s`, `hotel-mark__baseline` (Task 2 animates them) and `pathLength={1}` on all three strokes.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`src/components/common/BrandMark.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BrandMark from './BrandMark';

describe('BrandMark', () => {
  afterEach(cleanup);

  it('renders an accessible image with a default name', () => {
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'Salim Inn' })).toBeTruthy();
  });

  it('honours a custom accessible name', () => {
    render(<BrandMark title="Aster Hotel" />);
    expect(screen.getByRole('img', { name: 'Aster Hotel' })).toBeTruthy();
  });

  it('is hidden from assistive tech when decorative', () => {
    const { container } = render(<BrandMark decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies the size to width and height', () => {
    const { container } = render(<BrandMark size={48} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('48');
    expect(svg?.getAttribute('height')).toBe('48');
  });

  it('tags the three strokes for the loader draw-on', () => {
    const { container } = render(<BrandMark />);
    for (const part of ['roofline', 's', 'baseline']) {
      const el = container.querySelector(`.hotel-mark__${part}`);
      expect(el, part).toBeTruthy();
      expect(el?.getAttribute('pathLength')).toBe('1');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd hotel-web-fe && bun run test src/components/common/BrandMark.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement BrandMark**

`src/components/common/BrandMark.tsx`:

```tsx
import React from 'react';

export interface BrandMarkProps {
  /** Edge length in px — the mark is square. */
  size?: number;
  /** Purely visual use: hide from assistive tech (loaders carry their own status text). */
  decorative?: boolean;
  /** Accessible name when not decorative. */
  title?: string;
}

/**
 * The Salim Inn monogram — the same mark shipped as the app icon, favicon and
 * PWA icons (deep-green tile, gold roofline, ivory S, gold baseline) — rebuilt
 * as inline SVG so it renders with zero network requests. The tile keeps its
 * brand colors in both themes, exactly like the app icon does.
 *
 * `pathLength={1}` + the `hotel-mark__*` classes let LogoLoader run a stroke
 * draw-on entrance (`stroke-dasharray: 1`) without measuring geometry. With no
 * animation applied the mark renders statically, identical to the asset.
 */
const BrandMark: React.FC<BrandMarkProps> = ({ size = 64, decorative = false, title = 'Salim Inn' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    role={decorative ? undefined : 'img'}
    aria-hidden={decorative || undefined}
    aria-label={decorative ? undefined : title}
    focusable="false"
    style={{ display: 'block' }}
  >
    <rect width="64" height="64" rx="15" fill="#0B211A" />
    <rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="none" stroke="#D9B572" strokeWidth="3" />
    <path
      className="hotel-mark__roofline"
      pathLength={1}
      d="M13 27 32 13l19 14"
      fill="none"
      stroke="#D9B572"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      className="hotel-mark__s"
      pathLength={1}
      d="M42 28c0-6-20-6-20 1 0 8 20 4 20 13 0 8-20 8-20 1"
      fill="none"
      stroke="#FFFDF7"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <path
      className="hotel-mark__baseline"
      pathLength={1}
      d="M16 51h32"
      stroke="#D9B572"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

export default BrandMark;
```

Add to `src/components/index.ts` next to the spinner exports:

```ts
export { default as BrandMark } from './common/BrandMark';
export type { BrandMarkProps } from './common/BrandMark';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd hotel-web-fe && bun run test src/components/common/BrandMark.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/components/common/BrandMark.tsx hotel-web-fe/src/components/common/BrandMark.test.tsx hotel-web-fe/src/components/index.ts
git commit -m "feat(fe): add BrandMark inline SVG monogram component"
```

---

### Task 2: `LogoLoader` component

**Files:**
- Create: `hotel-web-fe/src/components/common/LogoLoader.tsx`
- Test: `hotel-web-fe/src/components/common/LogoLoader.test.tsx`
- Modify: `hotel-web-fe/src/components/index.ts`

**Interfaces:**
- Consumes: `BrandMark` (Task 1), `useTranslation('common')` (`aria.loading` = "Loading"), `getHotelSettings` from `../../utils/hotelSettings`.
- Produces:

```ts
export type LogoLoaderVariant = 'fullScreen' | 'page' | 'inline' | 'overlay';
export interface LogoLoaderProps {
  variant?: LogoLoaderVariant;              // default 'page'
  size?: number;                            // mark px; defaults: fullScreen 80, page 48, inline 24, overlay 48
  label?: string;                           // visible status line; also the accessible status text
  delayMs?: number;                         // entrance delay; default 0 for fullScreen, 200 otherwise
  minHeight?: number | string;              // page/overlay region floor; default 240 (page) / '100%' (overlay)
}
```

- [ ] **Step 1: Write the failing test**

`src/components/common/LogoLoader.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/hotelSettings', () => ({
  getHotelSettings: () => ({ hotel_name: 'Test Hotel' }),
}));

import LogoLoader from './LogoLoader';

describe('LogoLoader', () => {
  afterEach(cleanup);

  it('exposes a polite status with a sr-only default label', () => {
    render(<LogoLoader variant="page" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading');
  });

  it('renders a visible label as the status content', () => {
    render(<LogoLoader variant="inline" label="Saving booking" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Saving booking');
    // visible label replaces — not duplicates — the sr-only text
    expect(status.textContent).not.toContain('Loading');
  });

  it('fullScreen shows the configured hotel name', () => {
    render(<LogoLoader variant="fullScreen" />);
    expect(screen.getByText('Test Hotel')).toBeTruthy();
  });

  it('keeps the brand mark decorative', () => {
    const { container } = render(<LogoLoader variant="page" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('applies the entrance delay as an inline animation-delay', () => {
    render(<LogoLoader variant="page" delayMs={350} />);
    const status = screen.getByRole('status');
    expect(status.style.animationDelay).toBe('350ms');
  });

  it('fullScreen defaults to no entrance delay', () => {
    render(<LogoLoader variant="fullScreen" />);
    expect(screen.getByRole('status').style.animationDelay ?? '').not.toBe('200ms');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd hotel-web-fe && bun run test src/components/common/LogoLoader.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LogoLoader**

`src/components/common/LogoLoader.tsx`:

```tsx
import React from 'react';
import { Box, Typography, keyframes } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTranslation } from '../../i18n';
import { getHotelSettings } from '../../utils/hotelSettings';
import BrandMark from './BrandMark';

export type LogoLoaderVariant = 'fullScreen' | 'page' | 'inline' | 'overlay';

export interface LogoLoaderProps {
  /** Which loading surface this is. */
  variant?: LogoLoaderVariant;
  /** Mark size in px. Defaults: fullScreen 80, page/overlay 48, inline 24. */
  size?: number;
  /** Optional visible status line. When set it is also the accessible status
   *  text; otherwise a visually-hidden "Loading" is announced instead. */
  label?: string;
  /** Entrance delay before the loader fades in — keeps sub-200ms waits from
   *  flashing. Defaults to 0 on fullScreen (nothing else is on screen) and
   *  200 elsewhere. */
  delayMs?: number;
  /** Region floor for `page` (default 240px) and `overlay` (default 100%). */
  minHeight?: number | string;
}

// ── Motion ─────────────────────────────────────────────────────────────
// One-shot entrance: strokes draw on roofline → S → baseline, then the mark
// settles into a slow breath while a champagne sheen crosses the tile ~every
// 4s. Everything runs on transform/opacity/stroke-dashoffset — compositor
// work only, no JS animation loop.
const drawStroke = keyframes`
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
`;
const markSettle = keyframes`
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
`;
const breathe = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.86; }
`;
const sheenSweep = keyframes`
  0% { transform: translateX(-140%) skewX(-18deg); }
  38%, 100% { transform: translateX(260%) skewX(-18deg); }
`;
const loaderReveal = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;
const nameRise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
`;

const SR_ONLY: SxProps<Theme> = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const MARK_SIZES: Record<LogoLoaderVariant, number> = {
  fullScreen: 80,
  page: 48,
  inline: 24,
  overlay: 48,
};

/**
 * The app's logo-based loading element. Use by surface size — never spinners:
 *   fullScreen — app boot / auth resolve (BootSplash, desktop service gate)
 *   page       — a route or panel whose content is not yet loaded
 *   inline     — inside a card/section alongside other content
 *   overlay    — blocking wait over a positioned ancestor (scrim + mark)
 *
 * Skeletons still beat this for content-shaped page loads (route Suspense
 * fallbacks); buttons keep their small CircularProgress.
 */
const LogoLoader: React.FC<LogoLoaderProps> = ({
  variant = 'page',
  size,
  label,
  delayMs,
  minHeight,
}) => {
  const { t } = useTranslation('common');
  const isFullScreen = variant === 'fullScreen';
  const effectiveDelay = delayMs ?? (isFullScreen ? 0 : 200);
  const markSize = size ?? MARK_SIZES[variant];
  const hotelName = isFullScreen ? getHotelSettings().hotel_name.trim() : '';

  const mark = (
    <Box
      sx={{
        position: 'relative',
        width: markSize,
        height: markSize,
        flexShrink: 0,
        animation: `${markSettle} 0.5s cubic-bezier(0.2, 0.6, 0.2, 1) both, ${breathe} 3.6s ease-in-out 1s infinite`,
        '& .hotel-mark__roofline, & .hotel-mark__s, & .hotel-mark__baseline': {
          strokeDasharray: 1,
          strokeDashoffset: 1,
          animation: `${drawStroke} 0.5s ease-out forwards`,
        },
        '& .hotel-mark__roofline': { animationDelay: '0.15s' },
        '& .hotel-mark__s': { animationDelay: '0.35s', animationDuration: '0.6s' },
        '& .hotel-mark__baseline': { animationDelay: '0.8s', animationDuration: '0.35s' },
      }}
    >
      <BrandMark size={markSize} decorative />
      {/* Champagne sheen sweeping the tile — clipped to its rounded corners. */}
      <Box
        aria-hidden
        className="hotel-loader__sheen"
        sx={{ position: 'absolute', inset: 0, borderRadius: '23.4%', overflow: 'hidden' }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: '-25%',
            bottom: '-25%',
            left: 0,
            width: '45%',
            background:
              'linear-gradient(90deg, transparent, rgba(255, 253, 247, 0.10) 30%, rgba(217, 181, 114, 0.28) 50%, rgba(255, 253, 247, 0.10) 70%, transparent)',
            animation: `${sheenSweep} 4.4s ease-in-out 1.4s infinite`,
          }}
        />
      </Box>
    </Box>
  );

  const containerSx: SxProps<Theme> = {
    fullScreen: {
      minHeight: '100vh',
      '@supports (min-height: 100dvh)': { minHeight: '100dvh' },
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: 'background.default',
      px: 3,
      pt: 'var(--sat)',
      pb: 'var(--sab)',
    },
    page: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: minHeight ?? 240,
      py: 4,
    },
    inline: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 1,
    },
    overlay: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: minHeight ?? '100%',
      bgcolor: 'var(--hotel-scrim)',
      zIndex: 2,
      borderRadius: 'inherit',
    },
  }[variant];

  return (
    <Box
      role="status"
      sx={[
        containerSx,
        effectiveDelay > 0 && { animation: `${loaderReveal} 0.2s ease-out both` },
        // Component-level reduced-motion: static mark, entrance only — the
        // global 0.01ms rule in index.css is the backstop, not the contract.
        {
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
            '& .hotel-mark__roofline, & .hotel-mark__s, & .hotel-mark__baseline': {
              animation: 'none',
              strokeDashoffset: 0,
            },
            '& .hotel-loader__sheen': { display: 'none' },
          },
        },
      ]}
      style={effectiveDelay > 0 ? { animationDelay: `${effectiveDelay}ms` } : undefined}
    >
      {mark}
      {isFullScreen && hotelName !== '' && (
        <Typography
          sx={{
            mt: 3,
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 'clamp(1.05rem, 0.95rem + 0.6vw, 1.35rem)',
            fontWeight: 500,
            letterSpacing: '0.01em',
            color: 'text.primary',
            animation: `${nameRise} 0.4s ease-out 0.35s both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {hotelName}
        </Typography>
      )}
      {label !== undefined ? (
        <Typography
          variant="body2"
          sx={{
            mt: variant === 'inline' ? 0 : 1.5,
            color: 'text.secondary',
            fontSize: variant === 'inline' ? '0.8125rem' : undefined,
          }}
        >
          {label}
        </Typography>
      ) : (
        <Box component="span" sx={SR_ONLY}>
          {t('aria.loading')}
        </Box>
      )}
    </Box>
  );
};

export default LogoLoader;
```

Add to `src/components/index.ts`:

```ts
export { default as LogoLoader } from './common/LogoLoader';
export type { LogoLoaderProps, LogoLoaderVariant } from './common/LogoLoader';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd hotel-web-fe && bun run test src/components/common/LogoLoader.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add hotel-web-fe/src/components/common/LogoLoader.tsx hotel-web-fe/src/components/common/LogoLoader.test.tsx hotel-web-fe/src/components/index.ts
git commit -m "feat(fe): add LogoLoader with fullScreen/page/inline/overlay variants"
```

---

### Task 3: Rewire `RouteFallbacks`

**Files:**
- Modify: `hotel-web-fe/src/router/RouteFallbacks.tsx`

**Interfaces:**
- Consumes: `LogoLoader` from `../components` (Task 2 barrel).
- Produces: unchanged public API — `BootSplash`, `LoadingFallback`, `MinimalLoadingFallback` keep their names and call sites.

- [ ] **Step 1: Rewrite the file**

```tsx
import { Box, Skeleton } from '@mui/material';
import { LogoLoader } from '../components';
import { useTranslation } from '../i18n';

// Full-viewport boot screen shown while auth resolves, before any shell exists.
// Deliberately NOT a page-shaped skeleton — a fake dashboard reads as a wrong
// page flashing by on every refresh (the access token is in-memory only, so
// every reload pays for the refresh round trip here). The brand mark carries
// the wait; the static #boot-splash in index.html/guest.html fades into this
// identical centered mark, so the pre-React → React handoff is invisible.
export const BootSplash = () => <LogoLoader variant="fullScreen" />;

export const LoadingFallback = () => {
  const { t } = useTranslation('common');
  return (
    <Box
      role="status"
      aria-label={t('aria.loading')}
      sx={{ minHeight: 'calc(100vh - 200px)', pt: 1 }}
    >
      <Skeleton variant="text" width={260} height={44} sx={{ mb: 2 }} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 2,
          mb: 3,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={96} />
        ))}
      </Box>
      <Skeleton variant="rounded" height={44} sx={{ mb: 1.5 }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} variant="text" height={34} sx={{ mb: 0.5 }} />
      ))}
    </Box>
  );
};

export const MinimalLoadingFallback = () => <LogoLoader variant="page" minHeight={100} />;
```

- [ ] **Step 2: Verify dependent tests still pass**

Run: `cd hotel-web-fe && bun run test src/features/bookings/pages/BookingDetailPage.test.tsx src/test`
Expected: PASS (the ARIA contract — `role="status"` + "Loading" — is unchanged).

- [ ] **Step 3: Commit**

```bash
git add hotel-web-fe/src/router/RouteFallbacks.tsx
git commit -m "refactor(fe): route boot/minimal fallbacks through LogoLoader"
```

---

### Task 4: Migrate legacy spinner consumers, delete `HotelSpinner`/`LoadingSpinner`

**Files:**
- Modify: `hotel-web-fe/src/features/bookings/pages/BookingDetailPage.tsx` (imports + the `bookingQuery.isPending` branch ~line 85-88)
- Modify: `hotel-web-fe/src/features/loyalty/components/LoyaltyDashboard.tsx` (line ~340 panel wait, line ~1454 button startIcon)
- Modify: `hotel-web-fe/src/features/auth/components/LoginPage.tsx` (lines ~471, ~614 — both in-button)
- Modify: `hotel-web-fe/src/features/auth/components/RegisterPage.tsx` (line ~464 — in-button)
- Modify: `hotel-web-fe/src/features/auth/components/CompleteProfilePage.tsx` (lines ~69-75 full-viewport wait, ~243 in-button)
- Modify: `hotel-web-fe/src/features/bookings/pages/BookingDetailPage.test.tsx` if it references `LoadingSpinner` (line 13 — check whether it mocks or queries it; update to `LogoLoader`/`role="status"`)
- Modify: `hotel-web-fe/src/components/index.ts` (remove the two legacy exports)
- Delete: `hotel-web-fe/src/components/common/HotelSpinner.tsx`, `hotel-web-fe/src/components/common/LoadingSpinner.tsx`

**Interfaces:**
- Consumes: `LogoLoader` (Task 2). In-button waits standardize on MUI `CircularProgress size={20} color="inherit"` — the same convention the other ~100 button sites use.

**Replacement rules:**

| Site | Today | Becomes |
|---|---|---|
| BookingDetailPage pending | `<Box py:10 center><LoadingSpinner size={36}/></Box>` | `<LogoLoader variant="page" />` (drop the wrapper Box) |
| LoyaltyDashboard ~340 | `<Box minHeight:60vh center><LoadingSpinner size={80}/></Box>` | `<LogoLoader variant="page" minHeight="60vh" size={72} />` |
| LoyaltyDashboard ~1454 | `startIcon={loading ? <LoadingSpinner size={20}/> : <RedeemIcon/>}` | `startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <RedeemIcon />}` |
| LoginPage ~471 | `{loading ? <LoadingSpinner size={24}/> : t('twoFactor.verify')}` | `{loading ? <CircularProgress size={20} /> : t('twoFactor.verify')}` |
| LoginPage ~614 | `{loading ? <LoadingSpinner size={24} color="inherit"/> : t('login.submit')}` | `{loading ? <CircularProgress size={20} color="inherit" /> : t('login.submit')}` |
| RegisterPage ~464 | `{loading ? <LoadingSpinner size={24}/> : t('register.submit')}` | `{loading ? <CircularProgress size={20} color="inherit" /> : t('register.submit')}` |
| CompleteProfilePage ~69 | `isLoading` → `<Box minHeight:100vh center><LoadingSpinner size={40}/></Box>` | `return <LogoLoader variant="fullScreen" />;` |
| CompleteProfilePage ~243 | `{submitting ? <LoadingSpinner size={24}/> : t('completeProfile.continue')}` | `{submitting ? <CircularProgress size={20} color="inherit" /> : t('completeProfile.continue')}` |

For each file: swap the import (`LoadingSpinner`/`HotelSpinner` → `LogoLoader` from the components barrel or `CircularProgress` added to the existing `@mui/material` import). Check each file's existing imports first — most already import `CircularProgress` or the barrel.

- [ ] **Step 1: Apply the seven migrations** (edit each file per the table; run `grep -rn "LoadingSpinner\|HotelSpinner" src` after to confirm zero references remain outside `components/index.ts`)

- [ ] **Step 2: Remove barrel exports and delete files**

In `components/index.ts` delete:

```ts
export { default as HotelSpinner } from './common/HotelSpinner';
export { default as LoadingSpinner } from './common/LoadingSpinner';
```

Then `rm src/components/common/HotelSpinner.tsx src/components/common/LoadingSpinner.tsx`.

- [ ] **Step 3: Run affected tests**

Run: `cd hotel-web-fe && bun run test src/features/bookings/pages/BookingDetailPage.test.tsx src/features/auth`
Expected: PASS.

- [ ] **Step 4: Typecheck the touched files**

Run: `cd hotel-web-fe && bun run typecheck`
Expected: clean (no unused imports left behind).

- [ ] **Step 5: Commit**

```bash
git add -u hotel-web-fe/src
git commit -m "refactor(fe): consolidate legacy spinners onto LogoLoader and button CircularProgress"
```

---

### Task 5: Route-level Suspense fallbacks → `LogoLoader page`

**Files:**
- Modify: `hotel-web-fe/src/routes/bookings.$bookingId.tsx` (~line 23)
- Modify: `hotel-web-fe/src/routes/guest-relations/guests/$guestId.tsx` (~line 21)
- Modify: `hotel-web-fe/src/routes/guest-relations/follow-ups.tsx` (~line 24)
- Modify: `hotel-web-fe/src/routes/booking.recover-payment.$token.tsx` (~line 16)
- Modify: `hotel-web-fe/src/routes/help.$slug.tsx` (~line 21)
- Modify: `hotel-web-fe/src/routes/unsubscribe.$token.tsx` (~line 15)
- Modify: `hotel-web-fe/src/guest/guestRouter.tsx` (~line 51, unsubscribe route)

**Interfaces:**
- Consumes: `LogoLoader` — in `src/routes/*` files import from `'../components'`; in `guestRouter.tsx` import from `'../components'` as well (same barrel, path `../components`).

- [ ] **Step 1: Swap each fallback**

Pattern per file — before:

```tsx
import { CircularProgress } from '@mui/material';
…
<Suspense fallback={<CircularProgress sx={{ m: 8 }} />}>
```

after:

```tsx
import { LogoLoader } from '../components';
…
<Suspense fallback={<LogoLoader variant="page" />}>
```

Remove the `CircularProgress` import where it becomes unused (guestRouter also uses none after the swap — verify).

- [ ] **Step 2: Verify**

Run: `cd hotel-web-fe && grep -rn "CircularProgress sx={{ m: 8 }}" src` → expect zero hits; `bun run typecheck`.

- [ ] **Step 3: Commit**

```bash
git add hotel-web-fe/src/routes hotel-web-fe/src/guest/guestRouter.tsx
git commit -m "refactor(fe): replace bare route CircularProgress with LogoLoader page"
```

---

### Task 6: Standalone `CircularProgress` sweep (non-button)

**Files:** any file where `CircularProgress` is the *entire* loading surface of a region — not inside a `Button`/`IconButton`/`startIcon`/`endIcon`/`{loading ? … : label}` pattern.

- [ ] **Step 1: Enumerate candidates**

Run:

```bash
cd hotel-web-fe && grep -rn "CircularProgress" src --include="*.tsx" | grep -v "\.test\." | grep -v "size={1[0-9]}\|size={2[0-4]}\|color=\"inherit\""
```

Then `grep -n -B3 -A3` each hit to classify: convert ONLY when the spinner stands alone as a section/page wait (own centered wrapper, own line in a conditional branch, or a Suspense fallback). Convert to `<LogoLoader variant="inline" />` inside the existing centered wrapper, or `variant="page"` when it owns a tall region (`minHeight`/large padding). Leave anything inside a button, chip, list item adornment, or ambiguous context untouched, and leave `LinearProgress` everywhere.

Known likely candidates from the audit (verify each): `UnsubscribePage.tsx` (~line 64), `PortalSupportTab.tsx` (multiple — check which are buttons), `EkycManagementPage.tsx` (~264), `AuditLogPage.tsx` (~606), `SystemHealthPage.tsx` (~73/87), `JobsPage.tsx` (~55/73), `ReceptionistDashboard.tsx` (~560/1258), `SettingsPage.tsx` (~521/1334), `NightAuditPage.tsx` (~638/658/765/990), `PortalBookingPage.tsx`, `PortalDashboardSections.tsx`, `GuestPaymentPanel.tsx`, `LoyaltyPortal.tsx` (~1113), `RBACManagementPage.tsx` (~448/475/783/827/849).

- [ ] **Step 2: Typecheck + run tests on touched directories**

Run: `cd hotel-web-fe && bun run typecheck && bun run test`
Expected: clean; suite green.

- [ ] **Step 3: Commit**

```bash
git add -u hotel-web-fe/src
git commit -m "refactor(fe): move standalone CircularProgress waits to LogoLoader"
```

---

### Task 7: Sidebar brand + desktop service gate

**Files:**
- Modify: `hotel-web-fe/src/components/layout/sidebar/SidebarContent.tsx` (brand tile ~lines 121-134, `HotelIcon` import line 6)
- Modify: `hotel-web-fe/src/desktop/DesktopServiceGate.tsx` (tile ~lines 243-245, `CircularProgress`/`StorageIcon` imports)

**Interfaces:**
- Consumes: `BrandMark` (Task 1).

- [ ] **Step 1: Sidebar brand tile → BrandMark**

Replace the gold-tile Box + `HotelIcon` (lines ~121-134) with:

```tsx
<BrandMark size={32} decorative />
```

(the wrapping `Link` already carries `aria-label={hotelName || tNav('aria.brand')}`). Drop `import HotelIcon from '@mui/icons-material/Hotel';`. Check `SidebarContent.test.tsx` — if it asserts on the Hotel icon, update to query `svg`/`aria-hidden`.

- [ ] **Step 2: DesktopServiceGate status tile → BrandMark**

Replace (lines ~243-245):

```tsx
<Box sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: 'primary.main', display: 'grid', placeItems: 'center', color: 'primary.contrastText' }}>
  {status?.backend_starting || isRestarting ? <CircularProgress size={24} color="inherit" /> : <StorageIcon />}
</Box>
```

with:

```tsx
<BrandMark size={48} decorative />
```

`LinearProgress` below stays — it carries the actual startup-progress meaning. Remove `CircularProgress` and `StorageIcon` from imports if now unused (`CircularProgress` is still imported at line 6 — check for other uses in the file first; `StorageIcon` import at line 18 — remove if unused).

- [ ] **Step 3: Test + commit**

Run: `cd hotel-web-fe && bun run test src/components/layout/sidebar && bun run typecheck`

```bash
git add hotel-web-fe/src/components/layout/sidebar/SidebarContent.tsx hotel-web-fe/src/components/layout/sidebar/SidebarContent.test.tsx hotel-web-fe/src/desktop/DesktopServiceGate.tsx
git commit -m "feat(fe): unify sidebar and desktop boot on the BrandMark monogram"
```

---

### Task 8: Static pre-React splash (index.html + guest.html)

**Files:**
- Modify: `hotel-web-fe/index.html`
- Modify: `hotel-web-fe/guest.html`
- Modify: `hotel-web-fe/public/guest-branding.js`
- Create: `hotel-web-fe/src/utils/bootSplash.ts`
- Modify: `hotel-web-fe/src/index.tsx`, `hotel-web-fe/src/guest/main.tsx`

**Interfaces:**
- Produces: `dismissBootSplash()` in `src/utils/bootSplash.ts`; `#boot-splash` element + `boot-splash--done` class contract shared by both HTML shells and the dismiss util; `data-boot-theme` attribute on `<html>` set by `guest-branding.js`.

- [ ] **Step 1: Add the splash to `index.html`**

Inside `<body>`, before `<div id="root">` (keep markup + style self-contained — `style-src 'unsafe-inline'` is already in both CSPs; NO inline `<script>`):

```html
    <!-- Pre-React splash: the brand mark is visible during bundle download
         instead of a blank page. index.tsx dismisses it (fade + remove) right
         after the first render; BootSplash then shows the same mark centered,
         so the handoff is invisible. Kept in lockstep with BrandMark.tsx and
         LogoLoader's entrance. -->
    <div id="boot-splash" role="status" aria-label="Loading">
      <style>
        #boot-splash{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0B0E13;transition:opacity .22s ease-out}
        html[data-boot-theme="light"] #boot-splash{background:#F3F0E9}
        #boot-splash.boot-splash--done{opacity:0;pointer-events:none}
        .boot-mark{display:block;animation:boot-settle .5s cubic-bezier(.2,.6,.2,1) both}
        .boot-mark .bm-roof,.boot-mark .bm-s,.boot-mark .bm-base{stroke-dasharray:1;stroke-dashoffset:1;animation:boot-draw .5s ease-out forwards}
        .boot-mark .bm-roof{animation-delay:.15s}
        .boot-mark .bm-s{animation-delay:.35s;animation-duration:.6s}
        .boot-mark .bm-base{animation-delay:.8s;animation-duration:.35s}
        @keyframes boot-settle{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
        @keyframes boot-draw{to{stroke-dashoffset:0}}
        @media (prefers-reduced-motion:reduce){.boot-mark,.boot-mark path{animation:none;stroke-dashoffset:0}}
      </style>
      <svg class="boot-mark" width="80" height="80" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="15" fill="#0B211A"/>
        <rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="none" stroke="#D9B572" stroke-width="3"/>
        <path class="bm-roof" pathLength="1" d="M13 27 32 13l19 14" fill="none" stroke="#D9B572" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path class="bm-s" pathLength="1" d="M42 28c0-6-20-6-20 1 0 8 20 4 20 13 0 8-20 8-20 1" fill="none" stroke="#FFFDF7" stroke-width="4" stroke-linecap="round"/>
        <path class="bm-base" pathLength="1" d="M16 51h32" stroke="#D9B572" stroke-width="3" stroke-linecap="round"/>
      </svg>
    </div>
```

- [ ] **Step 2: Add the splash to `guest.html`** — identical block, except the guest surfaces: `background:#0B1814` and `html[data-boot-theme="light"] #boot-splash{background:#F3EFE4}` (guest tokens `surfaces.app`, not the staff values).

- [ ] **Step 3: `guest-branding.js` — set `data-boot-theme` pre-paint**

In `public/guest-branding.js`, inside the existing `try` (it already reads localStorage):

```js
    const themeMode = localStorage.getItem('themeMode');
    document.documentElement.dataset.bootTheme = themeMode === 'light' ? 'light' : 'dark';
```

(Anything non-'light' — including legacy 'night' and absent — resolves dark, matching `normalizeThemeMode`.)

- [ ] **Step 4: `src/utils/bootSplash.ts`**

```ts
/**
 * Fades out and removes the static pre-React splash injected by index.html /
 * guest.html. Called once after the first root render; no-op where the splash
 * never existed (tests, error paths that already removed it).
 */
export function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.classList.add('boot-splash--done');
  const remove = () => splash.remove();
  splash.addEventListener('transitionend', remove, { once: true });
  // Backstop: reduced-motion collapses the transition so transitionend may
  // never fire — and a missing stylesheet must not wedge the splash on top.
  window.setTimeout(remove, 500);
}
```

- [ ] **Step 5: Dismiss from both entries**

`src/index.tsx` — after `root.render(<App />)`; also in the `catch` path after the error render (the splash must not cover the error UI):

```tsx
  root.render(<App />);
  dismissBootSplash();
```

and in `bootstrap().catch`, after `root.render(<div …/>)`: `dismissBootSplash();`

`src/guest/main.tsx` — same two call sites (after success render and in catch).

- [ ] **Step 6: Verify build + typecheck**

Run: `cd hotel-web-fe && bun run typecheck && bun run build`
Expected: clean build; `dist/index.html` and `dist/guest.html` both contain `boot-splash`.

- [ ] **Step 7: Commit**

```bash
git add hotel-web-fe/index.html hotel-web-fe/guest.html hotel-web-fe/public/guest-branding.js hotel-web-fe/src/utils/bootSplash.ts hotel-web-fe/src/index.tsx hotel-web-fe/src/guest/main.tsx
git commit -m "feat(fe): static brand splash for pre-React paint on both HTML entries"
```

---

### Task 9: Docs + full gates

**Files:**
- Modify: `docs/DESIGN_SYSTEM.md` (new section)
- Modify: `hotel-web-fe/design-guidelines/app-structure.md` (lines ~69-71, ~80)

- [ ] **Step 1: `docs/DESIGN_SYSTEM.md`** — append a `## Loading states` section:

```markdown
## Loading states

One loading vocabulary, by surface size. Do not introduce new spinner styles.

- `LogoLoader` (`src/components/common/LogoLoader.tsx`) — the brand-mark
  loader. Variants: `fullScreen` (app boot/auth resolve; shows the hotel
  name), `page` (route/panel waits), `inline` (in-card waits), `overlay`
  (blocking wait over a positioned ancestor). Non-fullScreen variants delay
  their entrance ~200ms so fast waits never flash.
- `BrandMark` (`src/components/common/BrandMark.tsx`) — the monogram itself,
  for chrome use (sidebar) — not a loader.
- Skeletons — preferred for content-shaped page/section loads (the route
  Suspense `LoadingFallback`).
- `CircularProgress` — only inside buttons/submit adornments (size 18–20,
  `color="inherit"`).
- `LinearProgress` — only when progress is a real phased operation.
- Boot: `index.html`/`guest.html` carry a static `#boot-splash` for pre-React
  paint, dismissed by `dismissBootSplash()` on mount; keep its keyframes in
  sync with `LogoLoader`'s entrance when either changes.

Motion contract: strokes draw on once (roofline → S → baseline), then the mark
breathes and a champagne sheen crosses the tile ~every 4s. No spinning,
bouncing, or flashing. `prefers-reduced-motion` renders a static mark.
```

- [ ] **Step 2: `design-guidelines/app-structure.md`** — replace the two library rows:

```markdown
- **LogoLoader** — logo-based loader: `fullScreen` for app-level waits,
  `page` for route/panel loads, `inline` inside cards, `overlay` for blocking
  waits. Skeletons stay the pick for content-shaped page loads.
- **BrandMark** — the monogram itself (chrome/sidebar use), not a loader.
```

and change `Every data screen needs loading (HotelSpinner), empty, and error states.` → `(LogoLoader or Skeleton)`.

- [ ] **Step 3: Full gate run**

Run: `cd hotel-web-fe && bun run typecheck && bun run lint:strict && bun run test && bun run build`
Expected: all four clean.

Also run the repo markdown link check if docs links were added: `python3 scripts/check-doc-links.py` (the new docs use no relative links — expect clean).

- [ ] **Step 4: Commit**

```bash
git add docs/DESIGN_SYSTEM.md hotel-web-fe/design-guidelines/app-structure.md
git commit -m "docs: loading-state conventions for the logo loader system"
```

---

### Task 10: Visual validation pass (manual, in-session)

- [ ] **Step 1:** `cd hotel-web-fe && bun run start` (Vite :3000), open preview.
- [ ] **Step 2:** Verify matrix: boot splash → BootSplash handoff (throttle CPU/network in devtools or observe on slow reload), dark + light mode (Settings), phone width (~375px) + safe area, `prefers-reduced-motion` (devtools emulation), route transition to a lazy page, a dialog submit, a table refresh, login page.
- [ ] **Step 3:** Polish timing/spacing from what the screen actually shows — adjust only keyframes/tokens inside `LogoLoader.tsx` and the static splash block; keep the two entrances in sync.
- [ ] **Step 4:** Commit any polish changes.

## Self-review notes

- Spec coverage: BrandMark ✓ (T1), LogoLoader+variants+delay ✓ (T2), BootSplash/MinimalLoadingFallback rewire ✓ (T3), spinner deletion+consumers ✓ (T4), route fallbacks ✓ (T5), standalone sweep ✓ (T6), sidebar+desktop ✓ (T7), static splash+theme+dismissal ✓ (T8), docs+gates ✓ (T9), validation matrix ✓ (T10). i18n reuses existing keys — no parity risk. Buttons/skeletons/LinearProgress explicitly untouched per spec.
- Type consistency: `LogoLoaderProps.variant`/`size`/`label`/`delayMs`/`minHeight` used identically in T3-T6; `BrandMark size/decorative/title` used in T2/T7.
- Deliberate refinement vs spec wording: in-button `LoadingSpinner` sites migrate to `CircularProgress` (the house button convention), not `LogoLoader` — consistent with the spec's "buttons keep CircularProgress" rule.
