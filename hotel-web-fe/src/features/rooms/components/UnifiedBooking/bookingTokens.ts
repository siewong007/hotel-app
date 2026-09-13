import type { Theme } from '@mui/material/styles';

/**
 * Design tokens for the New Booking modal's single-screen layout.
 * `var(--hotel-*)` references resolve through the active theme mode, so the
 * modal tracks light/dark automatically. Shared by UnifiedBookingModal and
 * its extracted section components.
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

// The `theme` argument is kept for call-site compatibility; every value is a
// CSS variable that already follows the active mode.
export function buildBookingTokens(_theme: Theme): BookingTokens {
  return {
    bg: 'var(--hotel-bg)',
    surface: 'var(--hotel-surface)',
    surface2: 'var(--hotel-surface-raised)',
    surface3: 'var(--hotel-surface-sunken)',
    border: 'var(--hotel-border)',
    borderHi: 'var(--hotel-border-strong)',
    ink: 'var(--hotel-text)',
    ink2: 'var(--hotel-text-secondary)',
    ink3: 'var(--hotel-text-muted)',
    emerald: 'var(--hotel-primary)',
    emeraldDeep: 'var(--hotel-primary-hover)',
    emeraldSoft: 'var(--hotel-primary-subtle)',
    blue: 'var(--hotel-info)',
    blueSoft: 'var(--hotel-info-bg)',
    green: 'var(--hotel-success)',
    amber: 'var(--hotel-warning)',
    purple: 'var(--hotel-chart-4)',
    purpleSoft: 'color-mix(in srgb, var(--hotel-chart-4) 16%, transparent)',
    orange: 'var(--hotel-warning)',
    orangeSoft: 'var(--hotel-warning-bg)',
  };
}
