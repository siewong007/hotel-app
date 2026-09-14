import {
  createHotelTheme,
  cssVarDeclarations,
  type ThemeMode,
} from '../../../theme';
import { guestDarkTokens, guestLightTokens } from './guestTokens';

/**
 * Constant brand chrome for the guest header — deep forest in BOTH modes so
 * the identity never flips. The Salim Inn logo asset is drawn for exactly this
 * background. Only shell chrome consumes these; page content uses `--hotel-*`
 * tokens.
 */
export const GUEST_BRAND = {
  bg: '#123A2E',
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
  createHotelTheme(guestTokensFor(mode), { displaySerif: true });

/** `--hotel-*` custom properties for a wrapper element — lets a guest-branded
 *  island render correctly inside a document whose :root carries other vars. */
export const guestPortalCssVars = (mode: ThemeMode): Record<string, string> =>
  cssVarDeclarations(guestTokensFor(mode));
