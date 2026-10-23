import { createTheme } from '@mui/material/styles';
import {
  createHotelTheme,
  cssVarDeclarations,
  type ThemeMode,
} from '../../../theme';
import { guestDarkTokens, guestLightTokens } from './guestTokens';

/**
 * Constant brand chrome for the guest header — the landing page's dark ink and
 * champagne gold in BOTH modes so
 * the identity never flips. The Salim Inn logo asset is drawn for exactly this
 * background. Only shell chrome consumes these; page content uses `--hotel-*`
 * tokens.
 */
export const GUEST_BRAND = {
  /** The public landing page's ink — the portal header continues it. */
  bg: '#06110E',
  hover: 'rgba(255, 253, 247, 0.08)',
  active: 'rgba(255, 253, 247, 0.16)',
  text: '#FFFDF7',
  muted: '#C9D8D0',
  accent: '#D9B572',
  accentHover: '#E5C68A',
  accentText: '#231B0C',
  border: 'rgba(217, 181, 114, 0.35)',
} as const;

export const guestTokensFor = (mode: ThemeMode) =>
  mode === 'light' ? guestLightTokens : guestDarkTokens;

/** `displaySerif` keeps the Georgia display headings as the hospitality
 *  signature guests see; staff screens stay on Inter. */
export const createGuestPortalTheme = (mode: ThemeMode) =>
  createTheme(createHotelTheme(guestTokensFor(mode), { displaySerif: true }), {
    components: {
      MuiButton: {
        styleOverrides: {
          // Guest surfaces are touch-first: every button keeps the 44px tap
          // floor, not just on coarse pointers.
          // Primary actions carry the landing page's gold pill with ink text
          // in both modes (ink on #D9B572 is ~10:1). Light mode keeps its
          // bronze primary for text-coloured uses, which stay AA on paper.
          // Compound selector: the base theme's `contained` slot would
          // otherwise win over a `containedPrimary` slot.
          root: {
            minHeight: 44,
            '&.MuiButton-contained.MuiButton-colorPrimary:not(.Mui-disabled)': {
              backgroundColor: GUEST_BRAND.accent,
              color: GUEST_BRAND.accentText,
              '&:hover': { backgroundColor: GUEST_BRAND.accentHover },
              '&:active': { backgroundColor: '#C7A45B' },
            },
          },
        },
      },
      MuiStepIcon: {
        styleOverrides: {
          root: {
            '&.Mui-active, &.Mui-completed': { color: GUEST_BRAND.accent },
            '&.Mui-active .MuiStepIcon-text': { fill: GUEST_BRAND.accentText },
          },
        },
      },
      MuiStepConnector: {
        styleOverrides: {
          root: {
            '&.Mui-active .MuiStepConnector-line, &.Mui-completed .MuiStepConnector-line': {
              borderColor: GUEST_BRAND.accent,
            },
          },
        },
      },
    },
  });

/** `--hotel-*` custom properties for a wrapper element — lets a guest-branded
 *  island render correctly inside a document whose :root carries other vars. */
export const guestPortalCssVars = (mode: ThemeMode): Record<string, string> =>
  cssVarDeclarations(guestTokensFor(mode));
