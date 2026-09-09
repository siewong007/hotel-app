import { describe, expect, it } from 'vitest';

import {
  hrefFromAppPath,
  isGuestDocumentPath,
  isPublicGuestPath,
  shouldUseDocumentNavigation,
} from './guestDocumentPaths';

describe('isGuestDocumentPath', () => {
  it('treats Gmail payment and pre-check-in URLs as the guest document', () => {
    expect(isGuestDocumentPath('/guest-checkin/form')).toBe(true);
    expect(isGuestDocumentPath('/guest-checkin')).toBe(true);
    expect(isGuestDocumentPath('/guest-checkin/verify')).toBe(true);
    expect(isGuestDocumentPath('/guest-checkin/confirm')).toBe(true);
  });

  it('treats public guest booking, portal, offers, and legal URLs as the guest document', () => {
    expect(isGuestDocumentPath('/guest-portal')).toBe(true);
    expect(isGuestDocumentPath('/portal')).toBe(true);
    expect(isGuestDocumentPath('/portal/book')).toBe(true);
    expect(isGuestDocumentPath('/offers')).toBe(true);
    expect(isGuestDocumentPath('/offers/weekend')).toBe(true);
    expect(isGuestDocumentPath('/legal/terms')).toBe(true);
    expect(isGuestDocumentPath('/unsubscribe/abc')).toBe(true);
  });

  it('treats shared auth pages as the guest document', () => {
    expect(isGuestDocumentPath('/login')).toBe(true);
    expect(isGuestDocumentPath('/register')).toBe(true);
    expect(isGuestDocumentPath('/verify-email')).toBe(true);
    expect(isGuestDocumentPath('/complete-profile')).toBe(true);
  });

  it('leaves the staff ERP and marketing home on the staff document', () => {
    expect(isGuestDocumentPath('/')).toBe(false);
    expect(isGuestDocumentPath('/admin-portal')).toBe(false);
    expect(isGuestDocumentPath('/bookings')).toBe(false);
    expect(isGuestDocumentPath('/login-help')).toBe(false);
  });
});

describe('isPublicGuestPath', () => {
  it('does not require a staff session for payment, booking, offers, or auth screens', () => {
    expect(isPublicGuestPath('/guest-checkin/form', '')).toBe(true);
    expect(isPublicGuestPath('/guest-portal', '?view=booking')).toBe(true);
    expect(isPublicGuestPath('/portal/book', '')).toBe(true);
    expect(isPublicGuestPath('/offers', '')).toBe(true);
    expect(isPublicGuestPath('/login', '')).toBe(true);
    expect(isPublicGuestPath('/legal/privacy', '')).toBe(true);
  });

  it('requires a session for the signed-in guest portal dashboard', () => {
    expect(isPublicGuestPath('/guest-portal', '')).toBe(false);
    expect(isPublicGuestPath('/guest-portal', '?section=stays')).toBe(false);
  });
});

describe('shouldUseDocumentNavigation', () => {
  it('crosses documents when staff sign-in leaves the guest HTML for /admin-portal', () => {
    expect(shouldUseDocumentNavigation('/admin-portal', '/login')).toBe(true);
  });

  it('stays in-document for Gmail payment to login, and for staff ERP paths', () => {
    expect(shouldUseDocumentNavigation('/login', '/guest-checkin/form')).toBe(false);
    expect(shouldUseDocumentNavigation('/bookings', '/admin-portal')).toBe(false);
  });

  it('keeps query strings on a same-origin path href', () => {
    expect(hrefFromAppPath('/guest-portal?view=booking')).toBe('/guest-portal?view=booking');
  });
});
