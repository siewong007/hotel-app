import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeGuestThemePreference } from './guestTokens';
import { systemPrefersDark } from './guestThemePreference';

describe('normalizeGuestThemePreference', () => {
  it('passes through explicit modes', () => {
    expect(normalizeGuestThemePreference('light')).toBe('light');
    expect(normalizeGuestThemePreference('dark')).toBe('dark');
  });

  it('falls back to system for anything else', () => {
    expect(normalizeGuestThemePreference('system')).toBe('system');
    expect(normalizeGuestThemePreference('night')).toBe('system');
    expect(normalizeGuestThemePreference(null)).toBe('system');
    expect(normalizeGuestThemePreference(undefined)).toBe('system');
  });
});

describe('systemPrefersDark', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads prefers-color-scheme when matchMedia exists', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(systemPrefersDark()).toBe(true);
  });

  it('returns false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(systemPrefersDark()).toBe(false);
  });
});
