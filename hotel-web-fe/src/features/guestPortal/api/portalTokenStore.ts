/**
 * Guest portal session-token storage.
 *
 * The guest portal is an entirely separate, unauthenticated-by-staff-account
 * flow: a hotel guest logs in with email + booking/member number and gets a
 * short-lived bearer token scoped to `/api/guest-portal/me*` endpoints only.
 * That token must never be confused with the staff access token
 * (`src/auth/tokenStore.ts`, kept in memory) or written to the staff
 * `localStorage` keys (`src/utils/storage.ts`) — so this module owns its own
 * key in `sessionStorage` (cleared when the browser tab closes, unlike
 * localStorage) and nothing else touches it.
 */

const GUEST_PORTAL_TOKEN_KEY = 'guestPortalToken';
const GUEST_PORTAL_TOKEN_EXPIRES_KEY = 'guestPortalTokenExpiresAt';

export function getPortalToken(): string | null {
  try {
    return window.sessionStorage.getItem(GUEST_PORTAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getPortalTokenExpiresAt(): string | null {
  try {
    return window.sessionStorage.getItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY);
  } catch {
    return null;
  }
}

export function setPortalToken(token: string, expiresAt: string): void {
  try {
    window.sessionStorage.setItem(GUEST_PORTAL_TOKEN_KEY, token);
    window.sessionStorage.setItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY, expiresAt);
  } catch {
    // sessionStorage unavailable (e.g. private browsing edge cases) — the
    // portal session simply won't persist across a reload in that case.
  }
}

export function clearPortalToken(): void {
  try {
    window.sessionStorage.removeItem(GUEST_PORTAL_TOKEN_KEY);
    window.sessionStorage.removeItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY);
  } catch {
    // no-op
  }
}
