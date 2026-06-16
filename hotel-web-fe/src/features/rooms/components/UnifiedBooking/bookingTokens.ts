import { alpha, type Theme } from '@mui/material/styles';

/**
 * Design tokens for the New Booking modal's single-screen layout.
 * Derived from the active MUI theme so the modal tracks light/dark mode.
 * Shared by UnifiedBookingModal and its extracted section components.
 */
export interface BookingTokens {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderHi: string;
  ink: string;
  ink2: string;
  ink3: string;
  emerald: string;
  emeraldDeep: string;
  emeraldSoft: string;
  blue: string;
  blueSoft: string;
  green: string;
  amber: string;
  purple: string;
  purpleSoft: string;
  orange: string;
  orangeSoft: string;
}

export function buildBookingTokens(theme: Theme): BookingTokens {
  const isDark = theme.palette.mode === 'dark';
  const primary = theme.palette.primary.main;
  const secondary = theme.palette.secondary.main;
  const info = theme.palette.info.main;
  const warning = theme.palette.warning.main;
  const success = theme.palette.success.main;

  return {
    bg: theme.palette.background.default,
    surface: theme.palette.background.paper,
    surface2: isDark ? 'var(--hotel-popup-muted-bg)' : '#F8FAFB',
    surface3: isDark ? 'var(--hotel-subtle-bg)' : '#EFF2F5',
    border: isDark ? 'var(--hotel-popup-border)' : '#E2E6EC',
    borderHi: isDark ? theme.palette.grey[400] : '#CBD2DA',
    ink: theme.palette.text.primary,
    ink2: theme.palette.text.secondary,
    ink3: isDark ? theme.palette.grey[500] : '#7B8794',
    emerald: primary,
    emeraldDeep: theme.palette.primary.dark,
    emeraldSoft: alpha(primary, isDark ? 0.18 : 0.12),
    blue: info,
    blueSoft: alpha(info, isDark ? 0.18 : 0.10),
    green: success,
    amber: warning,
    purple: secondary,
    purpleSoft: alpha(secondary, isDark ? 0.18 : 0.12),
    orange: isDark ? '#fb9a73' : '#D97757',
    orangeSoft: alpha(isDark ? '#fb9a73' : '#D97757', isDark ? 0.18 : 0.12),
  };
}
