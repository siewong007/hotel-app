import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPortalToken,
  getPortalToken,
  getPortalTokenExpiresAt,
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
});
