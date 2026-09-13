import { createTheme, type Shadows, type Theme, type ThemeOptions } from '@mui/material/styles';
import {
  darkTokens,
  lightTokens,
  normalizeThemeMode,
  statusToneVars,
  tokensFor,
  type DesignTokens,
  type StatusTone,
  type ThemeMode,
} from './tokens';

export {
  darkTokens,
  lightTokens,
  normalizeThemeMode,
  statusToneVars,
  tokensFor,
};
export type { DesignTokens, StatusTone, ThemeMode };

/**
 * Absolute neutral ramp (bluish greys) for legacy `grey[n]` consumers. These
 * are raw shades, not theme-relative — semantic usages are migrated to tokens,
 * the ramp remains for hairline/utility cases.
 */
const NEUTRAL_GREY = {
  50: '#F5F6F8',
  100: '#E9EAF0',
  200: '#C9CFDA',
  300: '#A7AEBC',
  400: '#79828F',
  500: '#5A6270',
  600: '#454C59',
  700: '#333A46',
  800: '#222936',
  900: '#151A22',
};

const SERIF_STACK = 'Georgia, "Times New Roman", serif';
const SANS_STACK = '"Inter", "Roboto", "Helvetica", "Arial", sans-serif';

/** Elevation ramp: near-flat on surfaces, real lift only for overlays. */
const buildShadows = (t: DesignTokens): Shadows =>
  [
    'none',
    ...Array<Shadows[number]>(3).fill(t.shadow.sm),
    ...Array<Shadows[number]>(9).fill(t.shadow.md),
    ...Array<Shadows[number]>(12).fill(t.shadow.lg),
  ] as Shadows;

/** Every token published as a `--hotel-*` custom property so plain CSS files,
 *  SVG chart fills, and generated markup share the active theme. */
const cssVarDeclarations = (t: DesignTokens): Record<string, string> => ({
  '--hotel-bg': t.surfaces.app,
  '--hotel-surface': t.surfaces.base,
  '--hotel-surface-raised': t.surfaces.raised,
  '--hotel-surface-overlay': t.surfaces.overlay,
  '--hotel-surface-sunken': t.surfaces.sunken,
  '--hotel-hover': t.surfaces.hover,
  '--hotel-active': t.surfaces.active,
  '--hotel-selected': t.surfaces.selected,
  '--hotel-text': t.text.primary,
  '--hotel-text-secondary': t.text.secondary,
  '--hotel-text-muted': t.text.muted,
  '--hotel-text-disabled': t.text.disabled,
  '--hotel-border-subtle': t.border.subtle,
  '--hotel-border': t.border.base,
  '--hotel-border-strong': t.border.strong,
  '--hotel-primary': t.primary.main,
  '--hotel-primary-hover': t.primary.hover,
  '--hotel-primary-active': t.primary.active,
  '--hotel-primary-subtle': t.primary.subtle,
  '--hotel-primary-border': t.primary.subtleBorder,
  '--hotel-on-primary': t.primary.contrastText,
  '--hotel-primary-text': t.primary.onSurface,
  '--hotel-secondary': t.secondary.main,
  '--hotel-success': t.status.success.fg,
  '--hotel-success-bg': t.status.success.bg,
  '--hotel-success-border': t.status.success.border,
  '--hotel-warning': t.status.warning.fg,
  '--hotel-warning-bg': t.status.warning.bg,
  '--hotel-warning-border': t.status.warning.border,
  '--hotel-danger': t.status.danger.fg,
  '--hotel-danger-bg': t.status.danger.bg,
  '--hotel-danger-border': t.status.danger.border,
  '--hotel-info': t.status.info.fg,
  '--hotel-info-bg': t.status.info.bg,
  '--hotel-info-border': t.status.info.border,
  '--hotel-neutral': t.status.neutral.fg,
  '--hotel-neutral-bg': t.status.neutral.bg,
  '--hotel-neutral-border': t.status.neutral.border,
  '--hotel-chart-1': t.chart.series[0],
  '--hotel-chart-2': t.chart.series[1],
  '--hotel-chart-3': t.chart.series[2],
  '--hotel-chart-4': t.chart.series[3],
  '--hotel-chart-5': t.chart.series[4],
  '--hotel-chart-grid': t.chart.grid,
  '--hotel-chart-axis': t.chart.axis,
  '--hotel-tooltip-bg': t.chart.tooltipBg,
  '--hotel-focus-ring': t.focusRing,
  '--hotel-scrim': t.scrim,
  '--hotel-scrollbar-track': t.scrollbar.track,
  '--hotel-scrollbar-thumb': t.scrollbar.thumb,
  '--hotel-scrollbar-thumb-hover': t.scrollbar.thumbHover,
  '--hotel-shadow-sm': t.shadow.sm,
  '--hotel-shadow-md': t.shadow.md,
  '--hotel-shadow-lg': t.shadow.lg,
});

const componentOverrides = (t: DesignTokens): ThemeOptions['components'] => ({
  MuiCssBaseline: {
    styleOverrides: {
      ':root': cssVarDeclarations(t),
      'html, body, #root': {
        minHeight: '100%',
        backgroundColor: t.surfaces.app,
        color: t.text.primary,
      },
      body: {
        visibility: 'visible',
        backgroundColor: t.surfaces.app,
        color: t.text.primary,
        // Hotel ops = numbers everywhere (rates, IDs, dates); tabular figures
        // keep columns aligned and scannable.
        fontVariantNumeric: 'tabular-nums',
      },
      '#root': {
        backgroundColor: t.surfaces.app,
      },
      'body :focus-visible': {
        outline: `2px solid ${t.focusRing}`,
        outlineOffset: 2,
      },

    },
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        backgroundImage: 'none',
        backgroundColor: t.surfaces.base,
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.base,
        border: `1px solid ${t.border.subtle}`,
        borderRadius: 12,
        boxShadow: t.shadow.sm,
      },
    },
  },
  MuiCardHeader: {
    styleOverrides: {
      root: {
        borderBottom: `1px solid ${t.border.subtle}`,
        paddingBottom: 12,
      },
      title: {
        fontWeight: 600,
      },
    },
  },
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 600,
        borderRadius: 8,
        padding: '7px 16px',
        transition:
          'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
      },
      contained: {
        backgroundColor: t.primary.main,
        color: t.primary.contrastText,
        '&:hover': { backgroundColor: t.primary.hover },
        '&:active': { backgroundColor: t.primary.active },
        '&.Mui-disabled': {
          backgroundColor: t.surfaces.active,
          color: t.text.disabled,
        },
      },
      outlined: {
        borderColor: t.border.strong,
        color: t.text.primary,
        backgroundColor: 'transparent',
        '&:hover': {
          backgroundColor: t.surfaces.hover,
          borderColor: t.border.strong,
        },
      },
      text: {
        color: t.text.secondary,
        '&:hover': { backgroundColor: t.surfaces.hover, color: t.text.primary },
      },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        color: t.text.secondary,
        '&:hover': { backgroundColor: t.surfaces.hover, color: t.text.primary },
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        fontWeight: 600,
        borderRadius: 6,
        border: '1px solid transparent',
        '& .MuiChip-icon, & .MuiChip-deleteIcon': { color: 'inherit' },
      },
      // Tinted status badges: subtle fill + readable fg + tone border — never
      // a saturated solid block. Applies to both filled and outlined variants.
      colorDefault: {
        backgroundColor: t.status.neutral.bg,
        color: t.status.neutral.fg,
        borderColor: t.status.neutral.border,
      },
      colorPrimary: {
        backgroundColor: t.primary.subtle,
        color: t.primary.onSurface,
        borderColor: t.primary.subtleBorder,
      },
      colorSecondary: {
        backgroundColor: t.status.info.bg,
        color: t.status.info.fg,
        borderColor: t.status.info.border,
      },
      colorSuccess: {
        backgroundColor: t.status.success.bg,
        color: t.status.success.fg,
        borderColor: t.status.success.border,
      },
      colorWarning: {
        backgroundColor: t.status.warning.bg,
        color: t.status.warning.fg,
        borderColor: t.status.warning.border,
      },
      colorError: {
        backgroundColor: t.status.danger.bg,
        color: t.status.danger.fg,
        borderColor: t.status.danger.border,
      },
      colorInfo: {
        backgroundColor: t.status.info.bg,
        color: t.status.info.fg,
        borderColor: t.status.info.border,
      },
    },
  },
  MuiTableContainer: {
    styleOverrides: {
      root: {
        border: `1px solid ${t.border.base}`,
        borderRadius: 12,
        backgroundColor: t.surfaces.base,
        boxShadow: t.shadow.sm,
      },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      head: {
        backgroundColor: t.surfaces.raised,
        color: t.text.secondary,
        fontWeight: 600,
        fontSize: '0.75rem',
        letterSpacing: '0.04em',
        borderBottom: `1px solid ${t.border.base}`,
      },
      body: {
        color: t.text.primary,
        borderBottom: `1px solid ${t.border.subtle}`,
      },
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: {
        '&:hover': { backgroundColor: t.surfaces.hover },
        '&.Mui-selected': {
          backgroundColor: t.primary.subtle,
          '&:hover': { backgroundColor: t.primary.subtle },
        },
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        backgroundColor: t.surfaces.sunken,
        transition: 'box-shadow 0.15s ease',
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: t.border.strong,
        },
        '&.Mui-focused': {
          boxShadow: `0 0 0 3px ${t.primary.subtle}`,
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: t.primary.main,
          borderWidth: 1,
        },
        '&.Mui-error .MuiOutlinedInput-notchedOutline': {
          borderColor: t.status.danger.fg,
        },
        '&.Mui-disabled': {
          backgroundColor: t.surfaces.sunken,
          color: t.text.disabled,
        },
      },
      notchedOutline: {
        borderColor: t.border.base,
        borderWidth: 1,
      },
      input: {
        '&::placeholder': { color: t.text.muted, opacity: 1 },
      },
    },
  },
  MuiFilledInput: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.sunken,
        borderRadius: 8,
        '&:hover': { backgroundColor: t.surfaces.hover },
        '&.Mui-focused': { backgroundColor: t.surfaces.sunken },
      },
    },
  },
  MuiInputLabel: {
    styleOverrides: {
      root: {
        color: t.text.muted,
        '&.Mui-focused': { color: t.primary.onSurface },
        '&.Mui-error': { color: t.status.danger.fg },
      },
    },
  },
  MuiInputAdornment: {
    styleOverrides: {
      root: { color: t.text.muted },
    },
  },
  MuiFormHelperText: {
    styleOverrides: {
      root: {
        color: t.text.muted,
        '&.Mui-error': { color: t.status.danger.fg },
      },
    },
  },
  MuiSelect: {
    styleOverrides: {
      icon: { color: t.text.secondary },
    },
  },
  MuiCheckbox: {
    styleOverrides: {
      root: {
        color: t.text.muted,
        '&.Mui-checked': { color: t.primary.main },
        '&.Mui-disabled': { color: t.text.disabled },
      },
    },
  },
  MuiRadio: {
    styleOverrides: {
      root: {
        color: t.text.muted,
        '&.Mui-checked': { color: t.primary.main },
      },
    },
  },
  MuiSwitch: {
    styleOverrides: {
      root: {
        '& .MuiSwitch-switchBase.Mui-checked': { color: t.primary.main },
        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
          backgroundColor: t.primary.main,
          opacity: 0.5,
        },
        '& .MuiSwitch-track': {
          backgroundColor: t.border.strong,
          opacity: 1,
        },
      },
    },
  },
  MuiSlider: {
    styleOverrides: {
      root: { color: t.primary.main },
    },
  },
  MuiTabs: {
    styleOverrides: {
      root: {
        borderBottom: `1px solid ${t.border.subtle}`,
        minHeight: 44,
      },
      indicator: {
        backgroundColor: t.primary.main,
        height: 2,
      },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        fontWeight: 600,
        minHeight: 44,
        textTransform: 'none',
        color: t.text.secondary,
        '&.Mui-selected': { color: t.text.primary },
      },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        '&:hover': { backgroundColor: t.surfaces.hover },
        '&.Mui-selected': {
          backgroundColor: t.primary.subtle,
          '&:hover': { backgroundColor: t.primary.subtle },
        },
      },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        color: t.text.primary,
        '&:hover': { backgroundColor: t.surfaces.hover },
        '&.Mui-selected': {
          backgroundColor: t.primary.subtle,
          '&:hover': { backgroundColor: t.primary.subtle },
        },
      },
    },
  },
  MuiMenu: {
    styleOverrides: {
      paper: {
        backgroundColor: t.surfaces.overlay,
        color: t.text.primary,
        border: `1px solid ${t.border.base}`,
        boxShadow: t.shadow.md,
      },
      list: { padding: '4px' },
    },
  },
  MuiAutocomplete: {
    styleOverrides: {
      paper: {
        backgroundColor: t.surfaces.overlay,
        color: t.text.primary,
        border: `1px solid ${t.border.base}`,
        boxShadow: t.shadow.md,
      },
      option: {
        color: t.text.primary,
        '&[aria-selected="true"], &.Mui-focused': {
          backgroundColor: t.primary.subtle,
        },
      },
      tag: {
        backgroundColor: t.surfaces.active,
        color: t.text.primary,
      },
    },
  },
  MuiPopover: {
    styleOverrides: {
      paper: {
        backgroundColor: t.surfaces.overlay,
        color: t.text.primary,
        border: `1px solid ${t.border.base}`,
        boxShadow: t.shadow.md,
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: ({ theme }) => ({
        backgroundColor: t.surfaces.overlay,
        color: t.text.primary,
        border: `1px solid ${t.border.base}`,
        backgroundImage: 'none',
        borderRadius: 14,
        boxShadow: t.shadow.lg,
        // Phones get a full-height sheet instead of a floating card — dense
        // workflows are unusable in a floating dialog on a ~375px viewport.
        [theme.breakpoints.down('sm')]: {
          margin: 0,
          width: '100%',
          maxWidth: 'none',
          height: '100dvh',
          maxHeight: '100dvh',
          borderRadius: 0,
          border: 'none',
        },
      }),
    },
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: ({ theme }) => ({
        fontWeight: 650,
        borderBottom: `1px solid ${t.border.subtle}`,
        [theme.breakpoints.down('sm')]: {
          position: 'sticky',
          top: 0,
          zIndex: 1,
          backgroundColor: t.surfaces.overlay,
        },
      }),
    },
  },
  MuiDialogContent: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.overlay,
      },
    },
  },
  MuiDialogActions: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: t.surfaces.overlay,
        borderTop: `1px solid ${t.border.subtle}`,
        padding: '12px 20px',
        // Keep confirm/cancel reachable without scrolling a tall sheet.
        [theme.breakpoints.down('sm')]: {
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
        },
      }),
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: {
        backgroundColor: t.surfaces.base,
        borderColor: t.border.subtle,
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
      },
    },
  },
  MuiAppBar: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.base,
        color: t.text.primary,
        boxShadow: 'none',
        borderBottom: `1px solid ${t.border.subtle}`,
        backgroundImage: 'none',
      },
    },
  },
  MuiBackdrop: {
    styleOverrides: {
      root: {
        backgroundColor: t.scrim,
        transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        backgroundColor: t.surfaces.raised,
        color: t.text.primary,
        border: `1px solid ${t.border.base}`,
        boxShadow: t.shadow.md,
        fontSize: '0.75rem',
        fontWeight: 500,
      },
      arrow: { color: t.surfaces.raised },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: 10,
        border: '1px solid transparent',
        color: t.text.primary,
        '&.MuiAlert-standardSuccess, &.MuiAlert-colorSuccess': {
          backgroundColor: t.status.success.bg,
          borderColor: t.status.success.border,
          '& .MuiAlert-icon': { color: t.status.success.fg },
        },
        '&.MuiAlert-standardWarning, &.MuiAlert-colorWarning': {
          backgroundColor: t.status.warning.bg,
          borderColor: t.status.warning.border,
          '& .MuiAlert-icon': { color: t.status.warning.fg },
        },
        '&.MuiAlert-standardError, &.MuiAlert-colorError': {
          backgroundColor: t.status.danger.bg,
          borderColor: t.status.danger.border,
          '& .MuiAlert-icon': { color: t.status.danger.fg },
        },
        '&.MuiAlert-standardInfo, &.MuiAlert-colorInfo': {
          backgroundColor: t.status.info.bg,
          borderColor: t.status.info.border,
          '& .MuiAlert-icon': { color: t.status.info.fg },
        },
      },
    },
  },
  MuiSnackbarContent: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.overlay,
        color: t.text.primary,
        border: `1px solid ${t.border.base}`,
        boxShadow: t.shadow.md,
      },
    },
  },
  MuiSkeleton: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.hover,
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: {
        borderRadius: 999,
        backgroundColor: t.surfaces.hover,
      },
      bar: { backgroundColor: t.primary.main },
    },
  },
  MuiDivider: {
    styleOverrides: {
      root: { borderColor: t.border.subtle },
    },
  },
  MuiAccordion: {
    styleOverrides: {
      root: {
        backgroundColor: t.surfaces.base,
        border: `1px solid ${t.border.subtle}`,
        borderRadius: 10,
        boxShadow: 'none',
        overflow: 'hidden',
        '&:before': { display: 'none' },
      },
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        borderColor: t.border.base,
        color: t.text.secondary,
        textTransform: 'none',
        '&.Mui-selected': {
          backgroundColor: t.primary.subtle,
          color: t.primary.onSurface,
          '&:hover': { backgroundColor: t.primary.subtle },
        },
      },
    },
  },
  MuiPagination: {
    styleOverrides: {
      root: {
        '& .MuiPaginationItem-root.Mui-selected': {
          backgroundColor: t.primary.subtle,
          color: t.primary.onSurface,
        },
      },
    },
  },
  MuiBreadcrumbs: {
    styleOverrides: {
      separator: { color: t.text.muted },
    },
  },
});

export interface HotelThemeOptions {
  /** Serif display headings — the hospitality signature used on guest-facing
   *  surfaces (portal, auth). Staff screens stay on Inter. */
  displaySerif?: boolean;
}

/** Shared builder: staff app and guest-facing surfaces consume the same
 *  tokens and component language; only the display face differs. */
export const createHotelTheme = (
  t: DesignTokens,
  options: HotelThemeOptions = {},
): Theme => {
  const displayFamily = options.displaySerif ? SERIF_STACK : SANS_STACK;
  const displayWeight = options.displaySerif ? 700 : 650;

  return createTheme({
    palette: {
      mode: t === lightTokens ? 'light' : 'dark',
      primary: {
        main: t.primary.main,
        light: t.primary.hover,
        dark: t.primary.active,
        contrastText: t.primary.contrastText,
      },
      secondary: {
        main: t.secondary.main,
        contrastText: t.secondary.contrastText,
      },
      background: {
        default: t.surfaces.app,
        paper: t.surfaces.base,
      },
      text: {
        primary: t.text.primary,
        secondary: t.text.secondary,
        disabled: t.text.disabled,
      },
      divider: t.border.base,
      grey: NEUTRAL_GREY,
      action: {
        active: t.text.secondary,
        hover: t.surfaces.hover,
        selected: t.surfaces.active,
        disabled: t.text.disabled,
        disabledBackground:
          t === lightTokens
            ? 'rgba(28, 30, 36, 0.08)'
            : 'rgba(233, 234, 240, 0.10)',
        focus: t.surfaces.hover,
      },
      success: {
        main: t.status.success.fg,
        light: t.status.success.fg,
        dark: t.status.success.fg,
        contrastText: t === lightTokens ? '#FFFFFF' : '#0C1410',
      },
      warning: {
        main: t.status.warning.fg,
        light: t.status.warning.fg,
        dark: t.status.warning.fg,
        contrastText: t === lightTokens ? '#FFFFFF' : '#171006',
      },
      error: {
        main: t.status.danger.fg,
        light: t.status.danger.fg,
        dark: t.status.danger.fg,
        contrastText: t === lightTokens ? '#FFFFFF' : '#1A0B0A',
      },
      info: {
        main: t.status.info.fg,
        light: t.status.info.fg,
        dark: t.status.info.fg,
        contrastText: t === lightTokens ? '#FFFFFF' : '#0C131C',
      },
    },
    typography: {
      fontFamily: SANS_STACK,
      h1: { fontFamily: displayFamily, fontWeight: displayWeight, fontSize: '2rem', letterSpacing: options.displaySerif ? '-0.03em' : '-0.02em' },
      h2: { fontFamily: displayFamily, fontWeight: displayWeight, fontSize: '1.625rem', letterSpacing: options.displaySerif ? '-0.025em' : '-0.015em' },
      h3: { fontFamily: displayFamily, fontWeight: displayWeight, fontSize: '1.375rem', letterSpacing: options.displaySerif ? '-0.02em' : '-0.01em' },
      h4: { fontFamily: displayFamily, fontWeight: displayWeight, fontSize: '1.1875rem' },
      h5: { fontFamily: displayFamily, fontWeight: displayWeight, fontSize: '1.0625rem' },
      h6: { fontFamily: displayFamily, fontWeight: displayWeight, fontSize: '0.9375rem' },
      button: { fontWeight: 600 },
    },
    shape: { borderRadius: 8 },
    shadows: buildShadows(t),
    components: componentOverrides(t),
  });
};

export const createAppTheme = (themeMode: ThemeMode = 'dark'): Theme =>
  createHotelTheme(tokensFor(themeMode));

export const theme = createAppTheme('dark');
