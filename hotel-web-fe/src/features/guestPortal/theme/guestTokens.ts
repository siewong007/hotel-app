/**
 * Guest-facing design tokens — the Salim Inn identity: deep forest surfaces,
 * champagne-gold accent, ivory text. Same `DesignTokens` shape as the staff
 * palette so `createHotelTheme` and every component override apply unchanged.
 */

import type { DesignTokens } from '../../../theme';

export type GuestThemePreference = 'system' | 'light' | 'dark';

export const GUEST_THEME_STORAGE_KEY = 'guestThemeMode';

/** Normalize a persisted/unknown preference. Anything unrecognized — including
 *  the shared `themeMode` key's values — folds to 'system'. */
export const normalizeGuestThemePreference = (
  value: unknown,
): GuestThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system';

/**
 * Dark — flagship guest experience, matching the public site: near-black-green
 * app ground rising through forest surfaces; champagne gold reserved for
 * action, selection, and focus.
 */
export const guestDarkTokens: DesignTokens = {
  surfaces: {
    app: '#0B1814',
    base: '#10221B',
    raised: '#143024',
    overlay: '#1A3A2E',
    sunken: '#08100C',
    hover: '#1C3A2E',
    active: '#234739',
    selected: 'rgba(217, 181, 114, 0.12)',
  },
  text: {
    primary: '#F2EEE3',
    secondary: '#BCC9C2',
    muted: '#8A978F',
    disabled: '#5A675F',
  },
  border: {
    subtle: '#1D332A',
    base: '#2A463A',
    strong: '#3D5C4D',
  },
  primary: {
    main: '#D9B572',
    hover: '#E5C68A',
    active: '#C7A45B',
    subtle: 'rgba(217, 181, 114, 0.14)',
    subtleBorder: 'rgba(217, 181, 114, 0.38)',
    contrastText: '#231B0C',
    onSurface: '#E5C68A',
  },
  secondary: {
    main: '#9ED5BD',
    contrastText: '#0C1A14',
  },
  status: {
    success: { fg: '#5FBF8F', bg: 'rgba(95, 191, 143, 0.13)', border: 'rgba(95, 191, 143, 0.32)' },
    warning: { fg: '#E3A63F', bg: 'rgba(227, 166, 63, 0.13)', border: 'rgba(227, 166, 63, 0.32)' },
    danger: { fg: '#E16D66', bg: 'rgba(225, 109, 102, 0.13)', border: 'rgba(225, 109, 102, 0.32)' },
    info: { fg: '#8FB8DC', bg: 'rgba(143, 184, 220, 0.13)', border: 'rgba(143, 184, 220, 0.32)' },
    neutral: { fg: '#A8B5AD', bg: 'rgba(168, 181, 173, 0.12)', border: 'rgba(168, 181, 173, 0.26)' },
    orange: { fg: '#E08A48', bg: 'rgba(224, 138, 72, 0.13)', border: 'rgba(224, 138, 72, 0.32)' },
    violet: { fg: '#9E8FC0', bg: 'rgba(158, 143, 192, 0.13)', border: 'rgba(158, 143, 192, 0.32)' },
  },
  chart: {
    series: ['#D9B572', '#9ED5BD', '#E08A48', '#9E8FC0', '#8A978F'],
    grid: 'rgba(242, 238, 227, 0.06)',
    axis: '#8A978F',
    tooltipBg: '#1A3A2E',
    positive: '#5FBF8F',
    negative: '#E16D66',
  },
  focusRing: 'rgba(217, 181, 114, 0.55)',
  scrim: 'rgba(3, 8, 6, 0.62)',
  scrollbar: { track: '#10221B', thumb: '#3D5C4D', thumbHover: '#4E7060' },
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.32)',
    md: '0 4px 16px rgba(0, 0, 0, 0.40)',
    lg: '0 16px 48px rgba(0, 0, 0, 0.55)',
  },
};

/**
 * Light — ivory-paper counterpart: linen surfaces, forest-ink text, and a
 * deeper bronze-gold accent (AA-safe on paper). Hierarchy maps 1:1 with dark.
 */
export const guestLightTokens: DesignTokens = {
  surfaces: {
    app: '#F3EFE4',
    base: '#FFFCF5',
    raised: '#FFFDF7',
    overlay: '#FFFDF7',
    sunken: '#EFE8D9',
    hover: '#EFEADB',
    active: '#E4DCC8',
    selected: 'rgba(138, 106, 51, 0.10)',
  },
  text: {
    primary: '#1A241E',
    secondary: '#4A5A51',
    muted: '#6E7D73',
    disabled: '#A2AFA5',
  },
  border: {
    subtle: '#E2DBC8',
    base: '#CFC6AC',
    strong: '#AEA385',
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
    main: '#3F6B58',
    contrastText: '#FFFFFF',
  },
  status: {
    success: { fg: '#1E7A4E', bg: 'rgba(30, 122, 78, 0.10)', border: 'rgba(30, 122, 78, 0.30)' },
    warning: { fg: '#96650F', bg: 'rgba(150, 101, 15, 0.10)', border: 'rgba(150, 101, 15, 0.30)' },
    danger: { fg: '#B23A30', bg: 'rgba(178, 58, 48, 0.09)', border: 'rgba(178, 58, 48, 0.30)' },
    info: { fg: '#2F639E', bg: 'rgba(47, 99, 158, 0.10)', border: 'rgba(47, 99, 158, 0.30)' },
    neutral: { fg: '#5D6470', bg: 'rgba(93, 100, 112, 0.09)', border: 'rgba(93, 100, 112, 0.24)' },
    orange: { fg: '#A85B1D', bg: 'rgba(168, 91, 29, 0.10)', border: 'rgba(168, 91, 29, 0.30)' },
    violet: { fg: '#7A6AA8', bg: 'rgba(122, 106, 168, 0.10)', border: 'rgba(122, 106, 168, 0.30)' },
  },
  chart: {
    series: ['#8A6A33', '#3F6B58', '#A85B1D', '#7A6AA8', '#6E7D73'],
    grid: 'rgba(26, 36, 30, 0.07)',
    axis: '#6E7D73',
    tooltipBg: '#FFFDF7',
    positive: '#1E7A4E',
    negative: '#B23A30',
  },
  focusRing: 'rgba(138, 106, 51, 0.50)',
  scrim: 'rgba(20, 25, 20, 0.45)',
  scrollbar: { track: '#EFE8D9', thumb: '#C9BFA5', thumbHover: '#AA9F80' },
  shadow: {
    sm: '0 1px 2px rgba(28, 25, 18, 0.06)',
    md: '0 4px 16px rgba(28, 25, 18, 0.10)',
    lg: '0 16px 48px rgba(28, 25, 18, 0.18)',
  },
};
