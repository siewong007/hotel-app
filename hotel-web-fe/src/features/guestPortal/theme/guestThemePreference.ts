import { createContext, useContext } from 'react';
import type { GuestThemePreference } from './guestTokens';

export interface GuestThemePreferenceContextValue {
  /** The guest's stored preference — 'system' follows the browser/OS. */
  preference: GuestThemePreference;
  onPreferenceChange: (preference: GuestThemePreference) => void;
}

/**
 * Provided by GuestApp only. Consumers must tolerate null: bare test renders
 * and the staff-document compat paths have no provider.
 */
export const GuestThemePreferenceContext =
  createContext<GuestThemePreferenceContextValue | null>(null);

export function useGuestThemePreference(): GuestThemePreferenceContextValue | null {
  return useContext(GuestThemePreferenceContext);
}

/** Guarded `prefers-color-scheme` read — jsdom has no matchMedia. */
export function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}
