/**
 * Design tokens — the single source of truth for the app's visual language.
 *
 * Every color the UI renders is declared here per theme mode, then published
 * in two shapes:
 *   1. the MUI palette (via `createAppTheme`), and
 *   2. `--hotel-*` CSS custom properties on `:root` (via `MuiCssBaseline`),
 *      for contexts outside the emotion theme — plain CSS files, inline SVG
 *      chart fills, and generated markup.
 *
 * Components must consume semantic roles (`surface`, `border`, `success.fg`),
 * never raw palette values. If a needed role is missing, add it here — do not
 * scatter one-off hex values through components.
 *
 * Print/PDF output is the one documented exception: paper output keeps its own
 * literal palette (see `PRINT_*` constants in the invoice/ledger print files).
 */

export type ThemeMode = 'light' | 'dark';

/** A status tone rendered as a readable foreground + tinted fill + outline. */
export interface StatusToneTokens {
  /** Readable status text/icon color on any surface. */
  fg: string;
  /** Tinted badge / alert background. */
  bg: string;
  /** Badge / alert / card outline for this status. */
  border: string;
}

export interface DesignTokens {
  surfaces: {
    /** Application background — the darkest layer. */
    app: string;
    /** Cards, sidebar, table containers. */
    base: string;
    /** Nested panels, table headers, raised cards. */
    raised: string;
    /** Dialogs, menus, popovers, tooltips. */
    overlay: string;
    /** Recessed wells: input fills, code/preview blocks. */
    sunken: string;
    /** Hover fill on rows, ghost buttons, icon buttons. */
    hover: string;
    /** Pressed / toggle-on neutral fill. */
    active: string;
    /** Selected rows/nav — accent-tinted. */
    selected: string;
  };
  text: {
    primary: string;
    secondary: string;
    /** Placeholders, captions, metadata — lowest legible tier. */
    muted: string;
    disabled: string;
  };
  border: {
    /** In-card separators, table row lines. */
    subtle: string;
    /** Card outlines, dividers, container edges. */
    base: string;
    /** Input outlines, focus-adjacent edges. */
    strong: string;
  };
  primary: {
    main: string;
    hover: string;
    active: string;
    /** Accent-tinted selection fill (active nav, selected rows). */
    subtle: string;
    /** Outline for accent-tinted surfaces. */
    subtleBorder: string;
    /** Text/icons placed ON `main` (e.g. contained button label). */
    contrastText: string;
    /** Primary color used as readable text on surfaces. */
    onSurface: string;
  };
  secondary: {
    main: string;
    contrastText: string;
  };
  status: {
    success: StatusToneTokens;
    warning: StatusToneTokens;
    danger: StatusToneTokens;
    info: StatusToneTokens;
    neutral: StatusToneTokens;
  };
  chart: {
    /** Ordered categorical series — gold first, max 5, no rainbow. */
    series: [string, string, string, string, string];
    grid: string;
    axis: string;
    tooltipBg: string;
    positive: string;
    negative: string;
  };
  focusRing: string;
  /** Modal/drawer backdrop. */
  scrim: string;
  scrollbar: {
    track: string;
    thumb: string;
    thumbHover: string;
  };
  shadow: {
    sm: string;
    md: string;
    lg: string;
  };
}

/**
 * Dark — the flagship "cinematic charcoal + champagne" experience.
 * Layered blue-charcoal surfaces; never pure black. The champagne-gold accent
 * is reserved for action, selection, and focus — not decorative fill.
 */
export const darkTokens: DesignTokens = {
  surfaces: {
    app: '#0B0E13',
    base: '#12161D',
    raised: '#171C24',
    overlay: '#1C222C',
    sunken: '#0D1117',
    hover: '#222936',
    active: '#29313F',
    selected: 'rgba(201, 169, 106, 0.12)',
  },
  text: {
    primary: '#E9EAF0',
    secondary: '#A7AEBC',
    muted: '#7B8494',
    disabled: '#59616F',
  },
  border: {
    subtle: '#202733',
    base: '#2A3242',
    strong: '#3C4659',
  },
  primary: {
    main: '#C9A96A',
    hover: '#D8BD85',
    active: '#B8965A',
    subtle: 'rgba(201, 169, 106, 0.14)',
    subtleBorder: 'rgba(201, 169, 106, 0.38)',
    contrastText: '#1A1410',
    onSurface: '#D8BD85',
  },
  secondary: {
    main: '#7FA8DC',
    contrastText: '#10151D',
  },
  status: {
    success: { fg: '#5FBF8F', bg: 'rgba(95, 191, 143, 0.13)', border: 'rgba(95, 191, 143, 0.32)' },
    warning: { fg: '#E3A63F', bg: 'rgba(227, 166, 63, 0.13)', border: 'rgba(227, 166, 63, 0.32)' },
    danger: { fg: '#E16D66', bg: 'rgba(225, 109, 102, 0.13)', border: 'rgba(225, 109, 102, 0.32)' },
    info: { fg: '#7FA8DC', bg: 'rgba(127, 168, 220, 0.13)', border: 'rgba(127, 168, 220, 0.32)' },
    neutral: { fg: '#9AA2B0', bg: 'rgba(154, 162, 176, 0.12)', border: 'rgba(154, 162, 176, 0.26)' },
  },
  chart: {
    series: ['#C9A96A', '#7FA8DC', '#5FBF8F', '#9E8FC0', '#8A93A3'],
    grid: 'rgba(233, 234, 240, 0.06)',
    axis: '#7B8494',
    tooltipBg: '#1C222C',
    positive: '#5FBF8F',
    negative: '#E16D66',
  },
  focusRing: 'rgba(201, 169, 106, 0.55)',
  scrim: 'rgba(4, 6, 10, 0.62)',
  scrollbar: { track: '#12161D', thumb: '#3C4659', thumbHover: '#4A5468' },
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.32)',
    md: '0 4px 16px rgba(0, 0, 0, 0.40)',
    lg: '0 16px 48px rgba(0, 0, 0, 0.55)',
  },
};

/**
 * Light — the warm-paper counterpart. Same token roles, darker bronze accent
 * (AA-safe on paper). The visual hierarchy maps 1:1 with dark mode.
 */
export const lightTokens: DesignTokens = {
  surfaces: {
    app: '#F3F0E9',
    base: '#FCFBF7',
    raised: '#FFFFFF',
    overlay: '#FFFFFF',
    sunken: '#ECE8DE',
    hover: '#EDE9DF',
    active: '#E3DDCE',
    selected: 'rgba(138, 106, 51, 0.10)',
  },
  text: {
    primary: '#1C1E24',
    secondary: '#535A68',
    muted: '#767E8E',
    disabled: '#A6ACB8',
  },
  border: {
    subtle: '#E6E1D4',
    base: '#D6CFBD',
    strong: '#B4AB93',
  },
  primary: {
    main: '#8A6A33',
    hover: '#77592A',
    active: '#654B22',
    subtle: 'rgba(138, 106, 51, 0.12)',
    subtleBorder: 'rgba(138, 106, 51, 0.35)',
    contrastText: '#FFFDF7',
    onSurface: '#77592A',
  },
  secondary: {
    main: '#4A6FA0',
    contrastText: '#FFFFFF',
  },
  status: {
    success: { fg: '#1E7A4E', bg: 'rgba(30, 122, 78, 0.10)', border: 'rgba(30, 122, 78, 0.30)' },
    warning: { fg: '#96650F', bg: 'rgba(150, 101, 15, 0.10)', border: 'rgba(150, 101, 15, 0.30)' },
    danger: { fg: '#B23A30', bg: 'rgba(178, 58, 48, 0.09)', border: 'rgba(178, 58, 48, 0.30)' },
    info: { fg: '#2F639E', bg: 'rgba(47, 99, 158, 0.10)', border: 'rgba(47, 99, 158, 0.30)' },
    neutral: { fg: '#5D6470', bg: 'rgba(93, 100, 112, 0.09)', border: 'rgba(93, 100, 112, 0.24)' },
  },
  chart: {
    series: ['#8A6A33', '#4A6FA0', '#1E7A4E', '#7A6AA8', '#6B7280'],
    grid: 'rgba(28, 30, 36, 0.07)',
    axis: '#767E8E',
    tooltipBg: '#FFFFFF',
    positive: '#1E7A4E',
    negative: '#B23A30',
  },
  focusRing: 'rgba(138, 106, 51, 0.50)',
  scrim: 'rgba(28, 25, 18, 0.45)',
  scrollbar: { track: '#ECE8DE', thumb: '#C7BFA9', thumbHover: '#A79D83' },
  shadow: {
    sm: '0 1px 2px rgba(28, 25, 18, 0.06)',
    md: '0 4px 16px rgba(28, 25, 18, 0.10)',
    lg: '0 16px 48px rgba(28, 25, 18, 0.18)',
  },
};

export const tokensFor = (mode: ThemeMode): DesignTokens =>
  mode === 'light' ? lightTokens : darkTokens;

/** Normalize a persisted/unknown value to a supported mode. Legacy 'night'
 *  folds into 'dark'; dark is the product default. */
export const normalizeThemeMode = (value: unknown): ThemeMode =>
  value === 'light' ? 'light' : 'dark';

/** Status tones understood by the badge system (`StatusChip`). */
export type StatusTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'primary';

const TONE_VAR: Record<StatusTone, string> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
  primary: 'primary',
};

/** `var(--hotel-*)` references for a status tone — for `sx` and SVG fills so
 *  custom markup follows the active theme without reading the MUI palette. */
export const statusToneVars = (tone: StatusTone): StatusToneTokens => ({
  fg: `var(--hotel-${TONE_VAR[tone]})`,
  bg: `var(--hotel-${TONE_VAR[tone]}-bg)`,
  border: `var(--hotel-${TONE_VAR[tone]}-border)`,
});
