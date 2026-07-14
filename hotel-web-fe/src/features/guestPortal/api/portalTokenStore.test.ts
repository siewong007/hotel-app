import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPortalToken,
  getValidPortalToken,
  getPortalToken,
  getPortalTokenExpiresAt,
  isPortalTokenExpired,
  setPortalToken,
} from './portalTokenStore';

describe('portalTokenStore', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('round-trips token and expiry through sessionStorage', () => {
    setPortalToken('abc123', '2026-07-08T00:00:00Z');
    expect(getPortalToken()).toBe('abc123');
    expect(getPortalTokenExpiresAt()).toBe('2026-07-08T00:00:00Z');
  });

  it('returns null when no session has been stored', () => {
    expect(getPortalToken()).toBeNull();
    expect(getPortalTokenExpiresAt()).toBeNull();
  });

  it('clears both token and expiry together', () => {
    setPortalToken('abc123', '2026-07-08T00:00:00Z');
    clearPortalToken();
    expect(getPortalToken()).toBeNull();
    expect(getPortalTokenExpiresAt()).toBeNull();
  });

  it('rejects and clears an expired session token', () => {
    setPortalToken('expired', '2000-01-01T00:00:00Z');

    expect(isPortalTokenExpired()).toBe(true);
    expect(getValidPortalToken()).toBeNull();
    expect(getPortalToken()).toBeNull();
  });

  it('keeps a future session token available', () => {
    setPortalToken('current', '2999-01-01T00:00:00Z');

    expect(isPortalTokenExpired()).toBe(false);
    expect(getValidPortalToken()).toBe('current');
  });
});
