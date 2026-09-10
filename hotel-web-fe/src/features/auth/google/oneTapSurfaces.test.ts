import { describe, expect, it } from 'vitest';
import { googleOneTapSurface } from './oneTapSurfaces';

describe('googleOneTapSurface', () => {
  it('allows the offers page', () => {
    expect(googleOneTapSurface('/offers', '')).toBe('offers');
    expect(googleOneTapSurface('/offers/', '')).toBe('offers');
  });

  it('allows the anonymous booking flow under both of its URLs', () => {
    expect(googleOneTapSurface('/guest-portal', '?view=booking')).toBe('booking');
    expect(googleOneTapSurface('/guest-portal', 'view=booking')).toBe('booking');
    expect(googleOneTapSurface('/portal', '?view=booking')).toBe('booking');
    expect(googleOneTapSurface('/portal/book', '')).toBe('booking');
  });

  it('stays off the portal dashboard, which signed-out visitors never reach', () => {
    expect(googleOneTapSurface('/guest-portal', '')).toBeNull();
    expect(googleOneTapSurface('/guest-portal', '?section=stays')).toBeNull();
  });

  it('stays off the sign-in and sign-up pages, which already show the button', () => {
    expect(googleOneTapSurface('/login', '')).toBeNull();
    expect(googleOneTapSurface('/register', '')).toBeNull();
  });

  it('stays off every other guest page', () => {
    for (const path of [
      '/',
      '/complete-profile',
      '/verify-email',
      '/guest-checkin',
      '/guest-checkin/verify',
      '/legal/terms',
      '/unsubscribe/abc123',
    ]) {
      expect(googleOneTapSurface(path, '')).toBeNull();
    }
  });
});
