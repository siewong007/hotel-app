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
   *  200 elsewhere. The delay is opacity-only: the status node is in the
   *  a11y tree immediately, so a fast resolve can still announce "Loading"
   *  for a loader that never painted. */
  delayMs?: number;
  /** Region floor for `page` (default 240px) and `overlay` (default 100%). */
  minHeight?: number | string;
  /** Render the mark already settled — skip the draw-on entrance when an
   *  identical static mark was already on screen (the #boot-splash handoff). */
  skipEntrance?: boolean;
  /** Spacing tweaks for the outer container. */
  sx?: SxProps<Theme>;
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
 *   fullScreen — app boot / auth resolve (BootSplash)
 *   page       — a route or panel whose content is not yet loaded
 *   inline     — inside a card/section alongside other content
 *   overlay    — blocking wait over a positioned ancestor (scrim + mark)
 *
 * Skeletons still beat this for content-shaped page loads (the route Suspense
 * fallbacks); buttons keep their small CircularProgress.
 */
const LogoLoader: React.FC<LogoLoaderProps> = ({
  variant = 'page',
  size,
  label,
  delayMs,
  minHeight,
  skipEntrance = false,
  sx,
}) => {
  const { t } = useTranslation('common');
  const isFullScreen = variant === 'fullScreen';
  const effectiveDelay = delayMs ?? (isFullScreen ? 0 : 200);
  const markSize = size ?? MARK_SIZES[variant];
  // Stored settings are user-controlled JSON — a null/non-string hotel_name
  // must degrade to '' rather than crash the loader into an ErrorBoundary.
  const hotelName = isFullScreen ? String(getHotelSettings().hotel_name ?? '').trim() : '';

  const mark = (
    <Box
      className="hotel-loader__mark"
      sx={{
        position: 'relative',
        width: markSize,
        height: markSize,
        flexShrink: 0,
        animation: skipEntrance
          ? `${breathe} 3.6s ease-in-out 1s infinite`
          : `${markSettle} 0.5s cubic-bezier(0.2, 0.6, 0.2, 1) both, ${breathe} 3.6s ease-in-out 1s infinite`,
        ...(!skipEntrance && {
          '& .hotel-mark__roofline, & .hotel-mark__s, & .hotel-mark__baseline': {
            strokeDasharray: 1,
            strokeDashoffset: 1,
            animation: `${drawStroke} 0.5s ease-out forwards`,
          },
          '& .hotel-mark__roofline': { animationDelay: '0.15s' },
          '& .hotel-mark__s': { animationDelay: '0.35s', animationDuration: '0.6s' },
          '& .hotel-mark__baseline': { animationDelay: '0.8s', animationDuration: '0.35s' },
        }),
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
      pl: 'calc(24px + var(--sal))',
      pr: 'calc(24px + var(--sar))',
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
        ...(Array.isArray(sx) ? sx : [sx]),
        // Component-level reduced-motion: static mark, entrance only — the
        // global 0.01ms rule in index.css is the backstop, not the contract.
        {
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none',
            '& .hotel-loader__mark': { animation: 'none' },
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
      {label ? (
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
