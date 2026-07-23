/**
 * Guest portal session-token storage.
 *
 * The guest portal is an entirely separate, unauthenticated-by-staff-account
 * flow: a hotel guest authenticates with their regular account and gets a
 * short-lived bearer token scoped to `/api/guest-portal/me*` endpoints only.
 * That token must never be confused with the staff access token
 * (`src/auth/tokenStore.ts`, kept in memory) or written to the staff
 * `localStorage` keys (`src/utils/storage.ts`) — so this module owns its own
 * key in `sessionStorage` (cleared when the browser tab closes, unlike
 * localStorage) and nothing else touches it.
 */

const GUEST_PORTAL_TOKEN_KEY = 'guestPortalToken';
const GUEST_PORTAL_TOKEN_EXPIRES_KEY = 'guestPortalTokenExpiresAt';
/** Lets the guest shell react when the short-lived portal session is renewed. */
export const PORTAL_TOKEN_CHANGE_EVENT = 'guest-portal:token-changed';

function notifyPortalTokenChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PORTAL_TOKEN_CHANGE_EVENT));
  }
}

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

export function isPortalTokenExpired(expiresAt = getPortalTokenExpiresAt()): boolean {
  if (!expiresAt) return true;
  const timestamp = Date.parse(expiresAt);
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

export function getValidPortalToken(): string | null {
  const token = getPortalToken();
  if (!token) return null;
  if (!isPortalTokenExpired()) return token;
  clearPortalToken();
  return null;
}

export function setPortalToken(token: string, expiresAt: string): void {
  try {
    window.sessionStorage.setItem(GUEST_PORTAL_TOKEN_KEY, token);
    window.sessionStorage.setItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY, expiresAt);
    notifyPortalTokenChange();
  } catch {
    // sessionStorage unavailable (e.g. private browsing edge cases) — the
    // portal session simply won't persist across a reload in that case.
  }
}

export function clearPortalToken(): void {
  try {
    window.sessionStorage.removeItem(GUEST_PORTAL_TOKEN_KEY);
    window.sessionStorage.removeItem(GUEST_PORTAL_TOKEN_EXPIRES_KEY);
    notifyPortalTokenChange();
  } catch {
    // no-op
  }
}
